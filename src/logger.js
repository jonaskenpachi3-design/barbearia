'use strict';
/**
 * Logger estruturado com Pino
 * Desenvolvimento: pretty print colorido
 * Produção: JSON estruturado para agregação (Loki, ELK, CloudWatch, etc.)
 */

const pino = require('pino');
const path = require('node:path');
const fs = require('node:fs');

// Diretório de logs
const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '..', 'logs');

// Garante que o diretório existe
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Configuração base
const isDev = process.env.NODE_ENV !== 'production';

const streams = [
  // Console (desenvolvimento: pretty, produção: JSON)
  {
    level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
    stream: isDev
      ? pino.transport({
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname',
            singleLine: false
          }
        })
      : process.stdout
  },
  // Arquivo de log geral (rotação diária simples)
  {
    level: 'info',
    stream: pino.destination({
      dest: path.join(LOG_DIR, 'app.log'),
      sync: false, // async para performance
      mkdir: true
    })
  },
  // Arquivo de erro separado
  {
    level: 'error',
    stream: pino.destination({
      dest: path.join(LOG_DIR, 'error.log'),
      sync: false,
      mkdir: true
    })
  }
];

// Cria logger principal
const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
  formatters: {
    level: (label) => ({ level: label })
  },
  // Redact sensitive fields
  redact: {
    paths: [
      '*.senha',
      '*.senha_hash',
      '*.password',
      '*.token',
      '*.authorization',
      '*.cookie',
      '*.set-cookie',
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers.set-cookie'
    ],
    censor: '[REDACTED]'
  }
}, pino.multistream(streams));

/**
 * Cria logger filho com contexto (ex: requestId, userId, module)
 */
function childLogger(bindings) {
  return logger.child(bindings);
}

/**
 * Middleware de logging de requisições HTTP
 * Adiciona: method, url, statusCode, responseTime, userId, ip
 */
function requestLogger(req, res, next) {
  const start = Date.now();
  const requestId = req.headers['x-request-id'] ||
    Math.random().toString(36).slice(2, 10);

  // Adiciona requestId ao request para uso posterior
  req.requestId = requestId;
  req.startTime = start;

  // Log da requisição entrada
  const log = logger.child({
    requestId,
    method: req.method,
    url: req.url,
    ip: req.ip || req.socket.remoteAddress,
    userAgent: req.headers['user-agent']
  });

  log.info({
    tipo: 'request_inicio',
    query: req.query,
    // Não loga body por segurança (pode ter senhas)
  }, 'Requisição iniciada');

  // Intercepta resposta para logar
  const originalSend = res.send;
  res.send = function(body) {
    const duration = Date.now() - start;
    const statusCode = res.statusCode;

    const logRes = logger.child({
      requestId,
      method: req.method,
      url: req.url,
      statusCode,
      durationMs: duration,
      userId: req.usuario?.id,
      userRole: req.usuario?.papel
    });

    if (statusCode >= 500) {
      logRes.error({
        tipo: 'request_erro',
        body: typeof body === 'string' ? body.slice(0, 500) : body
      }, `Erro ${statusCode} em ${req.method} ${req.url}`);
    } else if (statusCode >= 400) {
      logRes.warn({
        tipo: 'request_cliente_erro',
        body: typeof body === 'string' ? body.slice(0, 500) : body
      }, `Cliente erro ${statusCode} em ${req.method} ${req.url}`);
    } else {
      logRes.info({
        tipo: 'request_sucesso'
      }, `${req.method} ${req.url} - ${statusCode} (${duration}ms)`);
    }

    return originalSend.call(this, body);
  };

  if (next) next();
}

/**
 * Logger para operações de banco de dados (slow queries)
 */
function logQuery(sql, params, durationMs) {
  if (durationMs > 100) { // Loga queries lentas (>100ms)
    logger.warn({
      tipo: 'slow_query',
      sql: sql.slice(0, 200),
      params: params ? params.slice(0, 10) : [],
      durationMs
    }, 'Query lenta detectada');
  }
}

/**
 * Logger para eventos de negócio (auditoria)
 */
function logEvento(evento, dados) {
  logger.info({
    tipo: 'evento_negocio',
    evento,
    ...dados
  }, `Evento: ${evento}`);
}

/**
 * Logger para erros não tratados
 */
function logErro(erro, contexto = {}) {
  logger.error({
    tipo: 'erro_nao_tratado',
    mensagem: erro.message,
    stack: erro.stack,
    ...contexto
  }, 'Erro não tratado');
}

module.exports = {
  logger,
  childLogger,
  requestLogger,
  logQuery,
  logEvento,
  logErro,
};