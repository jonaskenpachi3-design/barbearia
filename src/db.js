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

-- Fase 3: Produtos (estoque)
CREATE TABLE IF NOT EXISTS produtos (
  id              INTEGER PRIMARY KEY,
  sku             TEXT    NOT NULL UNIQUE,
  nome            TEXT    NOT NULL,
  descricao       TEXT,
  custo_centavos  INTEGER NOT NULL CHECK (custo_centavos >= 0),
  preco_centavos  INTEGER NOT NULL CHECK (preco_centavos >= 0),
  quantidade      INTEGER NOT NULL DEFAULT 0 CHECK (quantidade >= 0),
  qtd_minima      INTEGER NOT NULL DEFAULT 0 CHECK (qtd_minima >= 0),
  comissao_pct    INTEGER NOT NULL DEFAULT 0 CHECK (comissao_pct BETWEEN 0 AND 100),
  comissao_fixo   INTEGER NOT NULL DEFAULT 0 CHECK (comissao_fixo >= 0),
  ativo           INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_produtos_sku ON produtos (sku);

-- Fase 3: Regras de comissão por serviço (sobrescreve a do barbeiro se definido)
CREATE TABLE IF NOT EXISTS servico_comissao (
  servico_id   INTEGER PRIMARY KEY REFERENCES servicos(id) ON DELETE CASCADE,
  tipo         TEXT    NOT NULL CHECK (tipo IN ('percentual','fixo')),
  valor        INTEGER NOT NULL CHECK (valor >= 0)  -- centavos se fixo, % * 100 se percentual (ex: 4000 = 40%)
);

-- Fase 3: Vendas (PDV)
CREATE TABLE IF NOT EXISTS vendas (
  id                 INTEGER PRIMARY KEY,
  cliente_id         INTEGER     REFERENCES usuarios(id) ON DELETE SET NULL, -- NULL = walk-in
  barbeiro_id        INTEGER NOT NULL REFERENCES barbeiros(id) ON DELETE RESTRICT,
  caixa_id           INTEGER NOT NULL REFERENCES caixa(id) ON DELETE RESTRICT,
  subtotal_centavos  INTEGER NOT NULL CHECK (subtotal_centavos >= 0),
  desconto_centavos  INTEGER NOT NULL DEFAULT 0 CHECK (desconto_centavos >= 0),
  total_centavos     INTEGER NOT NULL CHECK (total_centavos >= 0),
  forma_pagamento    TEXT    NOT NULL CHECK (forma_pagamento IN ('dinheiro','cartao','pix','misto')),
  dinheiro_recebido  INTEGER NOT NULL DEFAULT 0, -- para troco
  status             TEXT    NOT NULL DEFAULT 'concluida' CHECK (status IN ('concluida','cancelada')),
  observacao         TEXT,
  criado_em          TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vendas_caixa ON vendas (caixa_id);
CREATE INDEX IF NOT EXISTS idx_vendas_barbeiro ON vendas (barbeiro_id, criado_em);
CREATE INDEX IF NOT EXISTS idx_vendas_cliente ON vendas (cliente_id, criado_em);

-- Fase 3: Itens da venda (serviços e/ou produtos)
CREATE TABLE IF NOT EXISTS venda_itens (
  id               INTEGER PRIMARY KEY,
  venda_id         INTEGER NOT NULL REFERENCES vendas(id) ON DELETE CASCADE,
  tipo             TEXT    NOT NULL CHECK (tipo IN ('servico','produto')),
  referencia_id    INTEGER NOT NULL, -- servico_id ou produto_id
  quantidade       INTEGER NOT NULL DEFAULT 1 CHECK (quantidade > 0),
  preco_unit_centavos INTEGER NOT NULL CHECK (preco_unit_centavos >= 0),
  comissao_centavos  INTEGER NOT NULL DEFAULT 0, -- calculado no momento da venda
  barbeiro_id      INTEGER NOT NULL REFERENCES barbeiros(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_vi_venda ON venda_itens (venda_id);

-- Fase 3: Caixa (abertura/fechamento diário)
CREATE TABLE IF NOT EXISTS caixa (
  id                   INTEGER PRIMARY KEY,
  data                 TEXT    NOT NULL UNIQUE, -- YYYY-MM-DD
  aberto_por           INTEGER NOT NULL REFERENCES usuarios(id),
  fechado_por          INTEGER     REFERENCES usuarios(id),
  valor_inicial_centavos INTEGER NOT NULL DEFAULT 0,
  valor_final_centavos   INTEGER,
  total_dinheiro_centavos  INTEGER NOT NULL DEFAULT 0,
  total_cartao_centavos    INTEGER NOT NULL DEFAULT 0,
  total_pix_centavos       INTEGER NOT NULL DEFAULT 0,
  total_misto_centavos     INTEGER NOT NULL DEFAULT 0,
  sangrias_centavos        INTEGER NOT NULL DEFAULT 0,
  observacao_abertura      TEXT,
  observacao_fechamento    TEXT,
  status                  TEXT    NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','fechado')),
  aberto_em               TEXT    NOT NULL DEFAULT (datetime('now')),
  fechado_em              TEXT
);
CREATE INDEX IF NOT EXISTS idx_caixa_data ON caixa (data);

-- Fase 3: Sangrias (retiradas do caixa durante o dia)
CREATE TABLE IF NOT EXISTS sangrias (
  id              INTEGER PRIMARY KEY,
  caixa_id        INTEGER NOT NULL REFERENCES caixa(id) ON DELETE CASCADE,
  valor_centavos  INTEGER NOT NULL CHECK (valor_centavos > 0),
  responsavel_id  INTEGER NOT NULL REFERENCES usuarios(id),
  motivo          TEXT,
  criado_em       TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sangrias_caixa ON sangrias (caixa_id);

-- Fase 3: Comissões a receber/pagar (uma por item de venda)
CREATE TABLE IF NOT EXISTS comissoes (
  id                 INTEGER PRIMARY KEY,
  venda_item_id      INTEGER NOT NULL REFERENCES venda_itens(id) ON DELETE CASCADE,
  barbeiro_id        INTEGER NOT NULL REFERENCES barbeiros(id) ON DELETE CASCADE,
  valor_centavos     INTEGER NOT NULL CHECK (valor_centavos >= 0),
  status             TEXT    NOT NULL DEFAULT 'a_receber' CHECK (status IN ('a_receber','pago')),
  pago_em            TEXT,
  pago_por           INTEGER REFERENCES usuarios(id),
  observacao         TEXT
);
CREATE INDEX IF NOT EXISTS idx_comissao_barbeiro ON comissoes (barbeiro_id, status);
CREATE INDEX IF NOT EXISTS idx_comissao_venda_item ON comissoes (venda_item_id);

-- Fase 3: Histórico/Observações do cliente (anotações do barbeiro)
CREATE TABLE IF NOT EXISTS cliente_observacoes (
  id              INTEGER PRIMARY KEY,
  cliente_id      INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  barbeiro_id     INTEGER NOT NULL REFERENCES barbeiros(id) ON DELETE CASCADE,
  conteudo        TEXT    NOT NULL,
  criado_em       TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_obs_cliente ON cliente_observacoes (cliente_id, criado_em DESC);
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
