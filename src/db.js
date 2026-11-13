'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { hashSenha } = require('./senha');

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS usuarios (
  id            INTEGER PRIMARY KEY,
  nome          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  telefone      TEXT,
  senha_hash    TEXT    NOT NULL,
  papel         TEXT    NOT NULL CHECK (papel IN ('cliente','barbeiro','admin')),
  ativo         INTEGER NOT NULL DEFAULT 1,
  criado_em     TEXT    NOT NULL DEFAULT (datetime('now'))
);
-- gateway_id e ultimo_acesso são adicionados via migração (após CREATE TABLE)

CREATE TABLE IF NOT EXISTS sessoes (
  token_hash  TEXT    PRIMARY KEY,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_em   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS servicos (
  id              INTEGER PRIMARY KEY,
  nome            TEXT    NOT NULL,
  categoria       TEXT    NOT NULL DEFAULT 'individual' CHECK (categoria IN ('individual','combo','plano')),
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
  id                   INTEGER PRIMARY KEY,
  cliente_id           INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  barbeiro_id          INTEGER NOT NULL REFERENCES barbeiros(id) ON DELETE CASCADE,
  servico_id           INTEGER NOT NULL REFERENCES servicos(id) ON DELETE CASCADE,
  inicio               TEXT    NOT NULL,                    -- ISO 8601: 'YYYY-MM-DDTHH:MM:SS'
  fim                  TEXT    NOT NULL,                    -- ISO 8601
  status               TEXT    NOT NULL CHECK (status IN ('pendente','confirmado','cancelado','concluido')),
  codigo_cancelamento  TEXT,                                -- 6 dígitos para cancelamento público
  criado_em            TEXT    NOT NULL DEFAULT (datetime('now')),
  atualizado_em        TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agend_barbeiro_data ON agendamentos (barbeiro_id, inicio);
CREATE INDEX IF NOT EXISTS idx_agend_cliente ON agendamentos (cliente_id, inicio);
-- idx_agend_codigo é criado na migração (após adicionar a coluna)

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

-- Fase 4: Clientes simplificados (apenas nome + telefone, sem login)
CREATE TABLE IF NOT EXISTS clientes_simples (
  id            INTEGER PRIMARY KEY,
  nome          TEXT    NOT NULL,
  telefone      TEXT    NOT NULL UNIQUE,
  criado_em     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_clientes_simples_telefone ON clientes_simples (telefone);

-- Fase 5: Planos de assinatura (assinatura mensal)
CREATE TABLE IF NOT EXISTS planos (
  id              INTEGER PRIMARY KEY,
  nome            TEXT    NOT NULL,
  descricao       TEXT,
  preco_centavos  INTEGER NOT NULL CHECK (preco_centavos >= 0),
  intervalo_dias  INTEGER NOT NULL DEFAULT 30 CHECK (intervalo_dias > 0),
  beneficios      TEXT, -- JSON array: ["cortes_ilimitados", "barba_inclusa", "desconto_20_produtos"]
  ativo           INTEGER NOT NULL DEFAULT 1
);

-- Fase 5: Assinaturas dos clientes
CREATE TABLE IF NOT EXISTS assinaturas (
  id                      INTEGER PRIMARY KEY,
  cliente_id              INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  plano_id                INTEGER NOT NULL REFERENCES planos(id) ON DELETE RESTRICT,
  gateway                 TEXT    NOT NULL DEFAULT 'mercadopago',
  gateway_assinatura_id   TEXT,
  status                  TEXT    NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','ativa','cancelada','atrasada','expirada')),
  forma_pagamento         TEXT    CHECK (forma_pagamento IN ('cartao','pix','boleto')),
  proxima_cobranca        TEXT,
  cancelada_em            TEXT,
  criado_em               TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assinaturas_cliente ON assinaturas (cliente_id, status);
CREATE INDEX IF NOT EXISTS idx_assinaturas_proxima ON assinaturas (proxima_cobranca);

-- Fase 5: Métodos de pagamento (tokens do gateway)
CREATE TABLE IF NOT EXISTS metodos_pagamento (
  id                INTEGER PRIMARY KEY,
  cliente_id        INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  gateway           TEXT    NOT NULL,
  gateway_token     TEXT    NOT NULL,
  tipo              TEXT    NOT NULL CHECK (tipo IN ('cartao','pix')),
  marca             TEXT,
  ultimos4          TEXT,
  expiracao         TEXT, -- MM/AA
  padrao            INTEGER NOT NULL DEFAULT 0,
  criado_em         TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_metodos_cliente ON metodos_pagamento (cliente_id);

-- Fase 5: Faturas/histórico de cobranças
CREATE TABLE IF NOT EXISTS faturas (
  id                    INTEGER PRIMARY KEY,
  assinatura_id         INTEGER NOT NULL REFERENCES assinaturas(id) ON DELETE CASCADE,
  gateway_fatura_id     TEXT,
  valor_centavos        INTEGER NOT NULL CHECK (valor_centavos > 0),
  status                TEXT    NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','paga','falhou','estornada','cancelada')),
  vencimento            TEXT    NOT NULL,
  paga_em               TEXT,
  metodo_pagamento_id   INTEGER REFERENCES metodos_pagamento(id),
  criado_em             TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_faturas_assinatura ON faturas (assinatura_id, status);
CREATE INDEX IF NOT EXISTS idx_faturas_vencimento ON faturas (vencimento);

-- Webhook idempotency (evita processamento duplicado)
CREATE TABLE IF NOT EXISTS webhook_eventos (
  id              INTEGER PRIMARY KEY,
  gateway         TEXT    NOT NULL,           -- mercadopago, asaas, stripe
  evento_id       TEXT    NOT NULL,           -- ID único do evento no gateway
  tipo            TEXT    NOT NULL,           -- payment_approved, subscription_cancelled, etc.
  payload         TEXT    NOT NULL,           -- JSON original do webhook
  processado_em   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_gateway_evento ON webhook_eventos (gateway, evento_id);
CREATE INDEX IF NOT EXISTS idx_webhook_processado ON webhook_eventos (processado_em);
`;

function abrirBanco(arquivo) {
  if (arquivo !== ':memory:') fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const db = new DatabaseSync(arquivo);
  db.exec('PRAGMA foreign_keys = ON;');
  if (arquivo !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(ESQUEMA);

  // Migração: adiciona codigo_cancelamento em agendamentos se não existir
  const cols = db.prepare("PRAGMA table_info(agendamentos)").all();
  const temCodigo = cols.some(c => c.name === 'codigo_cancelamento');
  if (!temCodigo) {
    db.exec("ALTER TABLE agendamentos ADD COLUMN codigo_cancelamento TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_agend_codigo ON agendamentos (codigo_cancelamento)");
  }

  // Migração: adiciona categoria em servicos se não existir
  const colsServicos = db.prepare("PRAGMA table_info(servicos)").all();
  const temCategoria = colsServicos.some(c => c.name === 'categoria');
  if (!temCategoria) {
    db.exec("ALTER TABLE servicos ADD COLUMN categoria TEXT NOT NULL DEFAULT 'individual' CHECK (categoria IN ('individual','combo','plano'))");
  }

  // Migração: adiciona gateway_id e ultimo_acesso em usuarios se não existirem
  const colsUsuarios = db.prepare("PRAGMA table_info(usuarios)").all();
  const temGatewayId = colsUsuarios.some(c => c.name === 'gateway_id');
  const temUltimoAcesso = colsUsuarios.some(c => c.name === 'ultimo_acesso');
  if (!temGatewayId) {
    // SQLite não permite ADD COLUMN UNIQUE em tabela com dados; adiciona sem UNIQUE e cria índice único depois
    db.exec("ALTER TABLE usuarios ADD COLUMN gateway_id TEXT");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_gateway ON usuarios (gateway_id)");
  }
  if (!temUltimoAcesso) {
    // SQLite não permite DEFAULT datetime('now') em ADD COLUMN; usa valor constante e atualiza depois
    db.exec("ALTER TABLE usuarios ADD COLUMN ultimo_acesso TEXT NOT NULL DEFAULT ''");
    db.exec("UPDATE usuarios SET ultimo_acesso = datetime('now') WHERE ultimo_acesso = ''");
  }

  // Migração: cria planos padrão se não existirem
  const planosCount = db.prepare("SELECT COUNT(*) as c FROM planos").get().c;
  if (planosCount === 0) {
    db.exec(`
      INSERT INTO planos (nome, descricao, preco_centavos, intervalo_dias, beneficios, ativo) VALUES
      -- Planos de Cabelo (Apenas Cabelo)
      ('Combo Plus', 'Corte Degradê — 4 serviços/mês', 12000, 30, '["4_cortes_mes","cabelo_apenas","degrade"]', 1),
      ('Combo Premium', 'Corte Navalhado — 4 serviços/mês', 14000, 30, '["4_cortes_mes","cabelo_apenas","navalhado"]', 1),
      ('Combo Basic', 'Corte Social — 3 serviços/mês', 7000, 30, '["3_cortes_mes","cabelo_apenas","social"]', 1),
      -- Planos Completos (Cabelo + Barba)
      ('Combo Mid', 'Degradê + Barba — 4 serviços/mês', 18000, 30, '["4_servicos_mes","cabelo_barba","degrade","barba_inclusa"]', 1),
      ('Combo Pro', 'Navalhado + Barba — 4 serviços/mês', 20000, 30, '["4_servicos_mes","cabelo_barba","navalhado","barba_inclusa"]', 1),
      ('Combo Mesc.', 'Navalhado + Barba Mesclada — 4 serviços/mês', 16000, 30, '["4_servicos_mes","cabelo_barba","navalhado","barba_mesclada"]', 1),
      ('Combo Mesc. Jr.', 'Degradê + Barba Mesclada — 4 serviços/mês', 15000, 30, '["4_servicos_mes","cabelo_barba","degrade","barba_mesclada"]', 1),
      ('Combo Basic Mesc.', 'Social + Barba — 3 serviços/mês', 10500, 30, '["3_servicos_mes","cabelo_barba","social","barba_inclusa"]', 1);
    `);
  }

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

async function resetarAdmin(db, { email = 'admin@barbearia.local', log = console.log } = {}) {
  const emailAdmin = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAdmin) || emailAdmin.length > 120) {
    throw new Error('ADMIN_EMAIL deve ser um endereço de e-mail válido com até 120 caracteres.');
  }

  const administrador = db.prepare(
    "SELECT id FROM usuarios WHERE papel = 'admin' ORDER BY id LIMIT 1"
  ).get();
  const conflito = db.prepare('SELECT papel FROM usuarios WHERE lower(email) = ?').get(emailAdmin);
  if (conflito && (!administrador || conflito.papel !== 'admin')) {
    throw new Error('O e-mail escolhido já pertence a outra conta. Defina outro ADMIN_EMAIL.');
  }

  const senhaAdmin = randomBytes(18).toString('base64url');
  const senhaHash = await hashSenha(senhaAdmin);

  transacao(db, () => {
    if (administrador) {
      db.prepare(`
        UPDATE usuarios
           SET email = ?, senha_hash = ?, ativo = 1
         WHERE id = ?
      `).run(emailAdmin, senhaHash, administrador.id);
      db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(administrador.id);
    } else {
      db.prepare(`
        INSERT INTO usuarios (nome, email, senha_hash, papel)
        VALUES ('Administrador', ?, ?, 'admin')
      `).run(emailAdmin, senhaHash);
    }
  });

  log('Acesso do administrador redefinido. Anote as credenciais (a senha não será exibida novamente):');
  log(`   e-mail: ${emailAdmin}`);
  log(`   senha:  ${senhaAdmin}`);
  return { email: emailAdmin, senha: senhaAdmin };
}

module.exports = { abrirBanco, transacao, garantirAdmin, resetarAdmin };
