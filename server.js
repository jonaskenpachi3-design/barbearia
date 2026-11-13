'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { abrirBanco, garantirAdmin } = require('./src/db');
const { ErroHttp, lerJson, enviarJson, lerCookies } = require('./src/http');
const { criarRotas } = require('./src/routes');
const auth = require('./src/auth');
const { logger, requestLogger, logErro } = require('./src/logger');

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com https://api.mercadopago.com https://www.mercadopago.com.br",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

function cabecalhosDeSeguranca(res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
}

function servirArquivo(req, res, pastaPublica, caminho) {
  const relativo = caminho === '/' ? 'index.html' : caminho.replace(/^\/+/, '');
  const arquivo = path.resolve(pastaPublica, relativo);
  // Impede sair da pasta pública (../).
  if (arquivo !== pastaPublica && !arquivo.startsWith(pastaPublica + path.sep)) {
    return enviarJson(res, 404, { erro: 'Não encontrado.' });
  }
  fs.stat(arquivo, (erro, info) => {
    if (erro || !info.isFile()) return enviarJson(res, 404, { erro: 'Não encontrado.' });
    res.writeHead(200, {
      'Content-Type': TIPOS[path.extname(arquivo)] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(arquivo).pipe(res);
  });
}

function criarServidor({ db, pastaPublica = path.join(__dirname, 'public'), limitador } = {}) {
  const raiz = path.resolve(pastaPublica);
  const rotas = criarRotas(db, { limitador });

  const servidor = http.createServer(async (req, res) => {
    cabecalhosDeSeguranca(res);

    // Request logging middleware
    return new Promise((resolve) => {
      requestLogger(req, res, () => {
        (async () => {
          try {
            const url = new URL(req.url, 'http://localhost');
            const caminho = url.pathname;

            if (!caminho.startsWith('/api/')) {
              if (req.method !== 'GET' && req.method !== 'HEAD') {
                throw new ErroHttp(405, 'Método não permitido.');
              }
              return servirArquivo(req, res, raiz, caminho);
            }

            const { rota, params, caminhoExiste } = rotas.encontrar(req.method, caminho);
            if (!rota) {
              throw caminhoExiste ? new ErroHttp(405, 'Método não permitido.') : new ErroHttp(404, 'Rota não encontrada.');
            }

            const token = lerCookies(req).sid || null;
            const ctx = {
              req, res, params, token,
              query: Object.fromEntries(url.searchParams),
              ip: req.socket.remoteAddress || '',
              usuario: auth.usuarioDaSessao(db, token),
              body: {},
              status: 200,
            };
            if (req.method !== 'GET' && req.method !== 'HEAD') ctx.body = await lerJson(req);

            let resultado;
            for (const handler of rota.handlers) resultado = await handler(ctx);
            enviarJson(res, ctx.status, resultado);
          } catch (erro) {
            if (erro instanceof ErroHttp) return enviarJson(res, erro.status, { erro: erro.message });
            logErro(erro, { url: req.url, method: req.method, ip: req.socket.remoteAddress });
            enviarJson(res, 500, { erro: 'Erro interno. Tente novamente.' });
          }
          resolve();
        })();
      });
    });
  });

  return servidor;
}

async function iniciar() {
  const porta = Number(process.env.PORT) || 3000;
  const arquivoDb = process.env.DB_FILE || path.join(__dirname, 'data', 'barbearia.db');
  const db = abrirBanco(arquivoDb);
  await garantirAdmin(db, { email: process.env.ADMIN_EMAIL, senha: process.env.ADMIN_SENHA });
  auth.limparSessoesExpiradas(db);
  setInterval(() => auth.limparSessoesExpiradas(db), 60 * 60 * 1000).unref();

  criarServidor({ db }).listen(porta, () => {
    logger.info({ porta }, `Barbearia rodando em http://localhost:${porta}`);
  });
}

module.exports = { criarServidor };

if (require.main === module) {
  iniciar().catch((erro) => {
    logErro(erro);
    process.exit(1);
  });
}
