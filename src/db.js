'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { hashSenha } = require('./senha');

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS usuarios (
  id          INTEGER PRIMARY KEY,
  nome        TEXT    NOT NULL,
  email       TEXT    NOT NULL UNIQUE,
  telefone    TEXT,
  senha_hash  TEXT    NOT NULL,
  papel       TEXT    NOT NULL CHECK (papel IN ('cliente','barbeiro','admin')),
  ativo       INTEGER NOT NULL DEFAULT 1,
  criado_em   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessoes (
  token_hash  TEXT    PRIMARY KEY,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_em   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS servicos (
  id              INTEGER PRIMARY KEY,
  nome            TEXT    NOT NULL,
  duracao_min     INTEGER NOT NULL CHECK (duracao_min > 0),
  preco_centavos  INTEGER NOT NULL CHECK (preco_centavos >= 0),
  ativo           INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS barbeiros (
  id            INTEGER PRIMARY KEY,
  usuario_id    INTEGER NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE CASCADE,
  comissao_pct  INTEGER NOT NULL DEFAULT 40 CHECK (comissao_pct BETWEEN 0 AND 100),
  ativo         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS barbeiro_servicos (
  barbeiro_id INTEGER NOT NULL REFERENCES barbeiros(id) ON DELETE CASCADE,
  servico_id  INTEGER NOT NULL REFERENCES servicos(id)  ON DELETE CASCADE,
  PRIMARY KEY (barbeiro_id, servico_id)
);

CREATE TABLE IF NOT EXISTS horarios_trabalho (
  id           INTEGER PRIMARY KEY,
  barbeiro_id  INTEGER NOT NULL REFERENCES barbeiros(id) ON DELETE CASCADE,
  dia_semana   INTEGER NOT NULL CHECK (dia_semana BETWEEN 0 AND 6), -- 0 = domingo
  inicio       TEXT    NOT NULL,                                    -- HH:MM
  fim          TEXT    NOT NULL                                     -- HH:MM
);
CREATE INDEX IF NOT EXISTS idx_horarios_barbeiro ON horarios_trabalho (barbeiro_id, dia_semana);

-- Fase 2: Agendamentos
CREATE TABLE IF NOT EXISTS agendamentos (
  id             INTEGER PRIMARY KEY,
  cliente_id     INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  barbeiro_id    INTEGER NOT NULL REFERENCES barbeiros(id) ON DELETE CASCADE,
  servico_id     INTEGER NOT NULL REFERENCES servicos(id) ON DELETE CASCADE,
  inicio         TEXT    NOT NULL,                    -- ISO 8601: 'YYYY-MM-DDTHH:MM:SS'
  fim            TEXT    NOT NULL,                    -- ISO 8601
  status         TEXT    NOT NULL CHECK (status IN ('pendente','confirmado','cancelado','concluido')),
  criado_em      TEXT    NOT NULL DEFAULT (datetime('now')),
  atualizado_em  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agend_barbeiro_data ON agendamentos (barbeiro_id, inicio);
CREATE INDEX IF NOT EXISTS idx_agend_cliente ON agendamentos (cliente_id, inicio);

-- Fase 2: Bloqueios manuais (feriado, manutenção, almoço estendido)
CREATE TABLE IF NOT EXISTS bloqueios (
  id           INTEGER PRIMARY KEY,
  barbeiro_id  INTEGER     REFERENCES barbeiros(id) ON DELETE CASCADE, -- NULL = todos os barbeiros
  inicio       TEXT    NOT NULL,                    -- ISO 8601
  fim          TEXT    NOT NULL,                    -- ISO 8601
  motivo       TEXT,
  criado_por   INTEGER NOT NULL REFERENCES usuarios(id)
);
CREATE INDEX IF NOT EXISTS idx_bloq_barbeiro_data ON bloqueios (barbeiro_id, inicio);
`;

function abrirBanco(arquivo) {
  if (arquivo !== ':memory:') fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const db = new DatabaseSync(arquivo);
  db.exec('PRAGMA foreign_keys = ON;');
  if (arquivo !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(ESQUEMA);
  return db;
}

// Executa fn dentro de uma transação; desfaz tudo se lançar erro.
function transacao(db, fn) {
  db.exec('BEGIN');
  try {
    const resultado = fn();
    db.exec('COMMIT');
    return resultado;
  } catch (erro) {
    db.exec('ROLLBACK');
    throw erro;
  }
}

// Cria o administrador na primeira execução. Sem ADMIN_SENHA no ambiente,
// gera uma senha aleatória e mostra uma única vez no console.
async function garantirAdmin(db, { email, senha, log = console.log } = {}) {
  const existe = db.prepare("SELECT id FROM usuarios WHERE papel = 'admin' LIMIT 1").get();
  if (existe) return null;
  const emailAdmin = (email || 'admin@barbearia.local').toLowerCase();
  const senhaAdmin = senha || randomBytes(9).toString('base64url');
  db.prepare("INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES (?, ?, ?, 'admin')")
    .run('Administrador', emailAdmin, await hashSenha(senhaAdmin));
  if (!senha) {
    log('────────────────────────────────────────────');
    log(' Administrador criado (anote, não será mostrado de novo):');
    log(`   e-mail: ${emailAdmin}`);
    log(`   senha:  ${senhaAdmin}`);
    log('────────────────────────────────────────────');
  }
  return emailAdmin;
}

module.exports = { abrirBanco, transacao, garantirAdmin };
