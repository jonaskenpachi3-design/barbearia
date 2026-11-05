'use strict';
// Mini-roteador e utilitários HTTP (sem Express).

class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

const LIMITE_CORPO = 100 * 1024;

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let total = 0;
    req.on('data', (parte) => {
      total += parte.length;
      if (total > LIMITE_CORPO) {
        reject(new ErroHttp(413, 'Corpo da requisição grande demais.'));
        req.destroy();
        return;
      }
      partes.push(parte);
    });
    req.on('end', () => resolve(Buffer.concat(partes).toString('utf8')));
    req.on('error', reject);
  });
}

async function lerJson(req) {
  const tipo = String(req.headers['content-type'] || '');
  // Exigir JSON também protege contra envios de formulário de outros sites (CSRF).
  if (!tipo.toLowerCase().startsWith('application/json')) {
    throw new ErroHttp(415, 'Use Content-Type: application/json.');
  }
  const texto = await lerCorpo(req);
  if (!texto.trim()) return {};
  try {
    const dados = JSON.parse(texto);
    if (dados === null || typeof dados !== 'object' || Array.isArray(dados)) {
      throw new Error('não é objeto');
    }
    return dados;
  } catch {
    throw new ErroHttp(400, 'JSON inválido.');
  }
}

class Roteador {
  constructor() {
    this.rotas = [];
  }

  adicionar(metodo, padrao, ...handlers) {
    const nomes = [];
    const regex = new RegExp(
      '^' + padrao.replace(/:([a-z_]+)/gi, (_, nome) => (nomes.push(nome), '([^/]+)')) + '/?$'
    );
    this.rotas.push({ metodo, regex, nomes, handlers });
  }

  get(p, ...h) { this.adicionar('GET', p, ...h); }
  post(p, ...h) { this.adicionar('POST', p, ...h); }
  put(p, ...h) { this.adicionar('PUT', p, ...h); }
  delete(p, ...h) { this.adicionar('DELETE', p, ...h); }

  // Retorna { achou, metodoPermitido } e executa a rota se existir.
  encontrar(metodo, caminho) {
    let caminhoExiste = false;
    for (const rota of this.rotas) {
      const m = rota.regex.exec(caminho);
      if (!m) continue;
      caminhoExiste = true;
      if (rota.metodo !== metodo) continue;
      const params = {};
      rota.nomes.forEach((nome, i) => {
        try {
          params[nome] = decodeURIComponent(m[i + 1]);
        } catch {
          params[nome] = m[i + 1];
        }
      });
      return { rota, params };
    }
    return { rota: null, caminhoExiste };
  }
}

function enviarJson(res, status, corpo) {
  const texto = corpo === undefined ? '' : JSON.stringify(corpo);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(texto);
}

function lerCookies(req) {
  const cookies = {};
  for (const par of String(req.headers.cookie || '').split(';')) {
    const i = par.indexOf('=');
    if (i < 0) continue;
    cookies[par.slice(0, i).trim()] = par.slice(i + 1).trim();
  }
  return cookies;
}

module.exports = { ErroHttp, Roteador, lerJson, enviarJson, lerCookies };
