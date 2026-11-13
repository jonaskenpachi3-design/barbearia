'use strict';
const { randomBytes, createHash } = require('node:crypto');
const { ErroHttp } = require('./http');

const DURACAO_SESSAO_S = 7 * 24 * 60 * 60; // 7 dias (máximo absoluto)
const INATIVIDADE_SESSAO_S = 30 * 60; // 30 minutos de inatividade
const agoraS = () => Math.floor(Date.now() / 1000);

// Só o hash do token fica no banco: um vazamento do banco não entrega sessões válidas.
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

function criarSessao(db, usuarioId) {
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessoes (token_hash, usuario_id, expira_em) VALUES (?, ?, ?)')
    .run(hashToken(token), usuarioId, agoraS() + DURACAO_SESSAO_S);
  // Atualiza ultimo_acesso do usuário
  db.prepare("UPDATE usuarios SET ultimo_acesso = datetime('now') WHERE id = ?").run(usuarioId);
  return token;
}

function usuarioDaSessao(db, token) {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const sessao = db.prepare(`
    SELECT s.usuario_id, s.expira_em, u.id, u.nome, u.email, u.telefone, u.papel, u.ativo
      FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
     WHERE s.token_hash = ? AND u.ativo = 1
  `).get(tokenHash);

  if (!sessao) return null;

  const agora = agoraS();

  // Verifica expiração absoluta (7 dias)
  if (sessao.expira_em <= agora) {
    db.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(tokenHash);
    return null;
  }

  // Verifica inatividade (30 min) - sliding window via ultimo_acesso
  const usuario = db.prepare("SELECT ultimo_acesso FROM usuarios WHERE id = ?").get(sessao.usuario_id);
  if (usuario) {
    const ultimoAcesso = Math.floor(new Date(usuario.ultimo_acesso).getTime() / 1000);
    if (agora - ultimoAcesso > INATIVIDADE_SESSAO_S) {
      db.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(tokenHash);
      return null;
    }
    // Atualiza ultimo_acesso (sliding window)
    db.prepare("UPDATE usuarios SET ultimo_acesso = datetime('now') WHERE id = ?").run(sessao.usuario_id);
    // Também estende a expiração da sessão se ainda tiver tempo
    const novaExpira = agora + DURACAO_SESSAO_S;
    if (novaExpira > sessao.expira_em) {
      db.prepare('UPDATE sessoes SET expira_em = ? WHERE token_hash = ?').run(novaExpira, tokenHash);
    }
  }

  return { id: sessao.id, nome: sessao.nome, email: sessao.email, telefone: sessao.telefone, papel: sessao.papel };
}

function encerrarSessao(db, token) {
  if (token) db.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(hashToken(token));
}

/**
 * Revoga TODAS as sessões de um usuário (logout global / segurança)
 */
function revogarTodasSessoes(db, usuarioId) {
  db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(usuarioId);
}

/**
 * Revoga uma sessão específica por token
 */
function revogarSessao(db, token) {
  if (token) db.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(hashToken(token));
}

function limparSessoesExpiradas(db) {
  db.prepare('DELETE FROM sessoes WHERE expira_em <= ?').run(agoraS());
}

function cookieSessao(token) {
  const secure = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
  return `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${DURACAO_SESSAO_S}${secure}`;
}

function cookieLimpo() {
  return 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0';
}

// Freia tentativas de adivinhar senha: 5 falhas por IP+e-mail a cada 15 minutos.
class LimitadorLogin {
  constructor({ maximo = 5, janelaMs = 15 * 60 * 1000 } = {}) {
    this.maximo = maximo;
    this.janelaMs = janelaMs;
    this.falhas = new Map();
  }

  verificar(chave) {
    const f = this.falhas.get(chave);
    if (!f) return;
    if (f.expiraEm <= Date.now()) { this.falhas.delete(chave); return; }
    if (f.contagem >= this.maximo) {
      throw new ErroHttp(429, 'Muitas tentativas. Aguarde alguns minutos e tente de novo.');
    }
  }

  registrarFalha(chave) {
    if (this.falhas.size > 5000) this.falhas.clear();
    const f = this.falhas.get(chave);
    if (!f || f.expiraEm <= Date.now()) {
      this.falhas.set(chave, { contagem: 1, expiraEm: Date.now() + this.janelaMs });
    } else {
      f.contagem += 1;
    }
  }

  limpar(chave) {
    this.falhas.delete(chave);
  }
}

function exigirLogin(ctx) {
  if (!ctx.usuario) throw new ErroHttp(401, 'Faça login para continuar.');
}

function exigirPapel(...papeis) {
  return (ctx) => {
    exigirLogin(ctx);
    if (!papeis.includes(ctx.usuario.papel)) throw new ErroHttp(403, 'Você não tem permissão para isso.');
  };
}

module.exports = {
  criarSessao, usuarioDaSessao, encerrarSessao, limparSessoesExpiradas,
  cookieSessao, cookieLimpo, LimitadorLogin, exigirLogin, exigirPapel,
  revogarTodasSessoes, revogarSessao,
};
