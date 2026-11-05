'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { abrirBanco, garantirAdmin } = require('../src/db');
const { criarServidor } = require('../server');

let servidor;
let base;
const ADMIN = { email: 'admin@teste.local', senha: 'senha-admin-123' };

test.before(async () => {
  const db = abrirBanco(':memory:');
  await garantirAdmin(db, ADMIN);
  servidor = criarServidor({ db, pastaPublica: path.join(__dirname, '..', 'public') });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

test.after(() => servidor.close());

// Pequeno cliente: devolve { status, corpo, cookie }.
async function chamar(metodo, url, corpo, cookie) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const resp = await fetch(base + url, {
    method: metodo,
    headers,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await resp.text();
  const setCookie = resp.headers.get('set-cookie');
  return {
    status: resp.status,
    corpo: texto ? JSON.parse(texto) : null,
    cookie: setCookie ? setCookie.split(';')[0] : null,
  };
}

async function loginAdmin() {
  const r = await chamar('POST', '/api/auth/login', ADMIN);
  assert.equal(r.status, 200);
  return r.cookie;
}

test('cadastro cria cliente, abre sessão e permite /me', async () => {
  const r = await chamar('POST', '/api/auth/cadastro', {
    nome: 'Rafael Mendes', email: 'Rafael@Email.com', telefone: '(68) 99999-0000', senha: 'minhasenha1',
  });
  assert.equal(r.status, 201);
  assert.equal(r.corpo.usuario.papel, 'cliente');
  assert.equal(r.corpo.usuario.email, 'rafael@email.com');
  assert.ok(r.cookie.startsWith('sid='));
  const me = await chamar('GET', '/api/auth/me', undefined, r.cookie);
  assert.equal(me.status, 200);
  assert.equal(me.corpo.usuario.nome, 'Rafael Mendes');
});

test('cadastro rejeita e-mail repetido, senha curta e e-mail inválido', async () => {
  const dados = { nome: 'Outro', email: 'rafael@email.com', senha: 'minhasenha1' };
  assert.equal((await chamar('POST', '/api/auth/cadastro', dados)).status, 409);
  assert.equal((await chamar('POST', '/api/auth/cadastro', { ...dados, email: 'novo@email.com', senha: '123' })).status, 400);
  assert.equal((await chamar('POST', '/api/auth/cadastro', { ...dados, email: 'sem-arroba' })).status, 400);
});

test('login: erra com 401, acerta com 200 e logout derruba a sessão', async () => {
  assert.equal((await chamar('POST', '/api/auth/login', { email: 'rafael@email.com', senha: 'errada123' })).status, 401);
  assert.equal((await chamar('POST', '/api/auth/login', { email: 'nao@existe.com', senha: 'qualquer123' })).status, 401);
  const ok = await chamar('POST', '/api/auth/login', { email: 'rafael@email.com', senha: 'minhasenha1' });
  assert.equal(ok.status, 200);
  assert.equal((await chamar('POST', '/api/auth/logout', {}, ok.cookie)).status, 200);
  assert.equal((await chamar('GET', '/api/auth/me', undefined, ok.cookie)).status, 401);
});

test('login: bloqueia após 5 tentativas erradas (429)', async () => {
  const dados = { email: 'forca@bruta.com', senha: 'errada123' };
  for (let i = 0; i < 5; i++) assert.equal((await chamar('POST', '/api/auth/login', dados)).status, 401);
  assert.equal((await chamar('POST', '/api/auth/login', dados)).status, 429);
});

test('API exige Content-Type JSON em escritas (415)', async () => {
  const resp = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'email=a&senha=b',
  });
  assert.equal(resp.status, 415);
});

test('serviços: só admin escreve; público vê só os ativos', async () => {
  const cliente = (await chamar('POST', '/api/auth/cadastro', {
    nome: 'Cliente Serviço', email: 'cli.servico@email.com', senha: 'minhasenha1',
  })).cookie;
  const admin = await loginAdmin();
  const novo = { nome: 'Corte', duracao_min: 40, preco_centavos: 4500 };

  assert.equal((await chamar('POST', '/api/servicos', novo)).status, 401);
  assert.equal((await chamar('POST', '/api/servicos', novo, cliente)).status, 403);

  const criado = await chamar('POST', '/api/servicos', novo, admin);
  assert.equal(criado.status, 201);
  assert.equal(criado.corpo.servico.ativo, true);

  const barba = await chamar('POST', '/api/servicos', { nome: 'Barba', duracao_min: 30, preco_centavos: 3500 }, admin);
  assert.equal((await chamar('POST', '/api/servicos', { ...novo, duracao_min: 0 }, admin)).status, 400);
  assert.equal((await chamar('POST', '/api/servicos', { ...novo, preco_centavos: 45.5 }, admin)).status, 400);
  assert.equal((await chamar('POST', '/api/servicos', { ...novo, nome: '' }, admin)).status, 400);

  const desativado = await chamar('PUT', `/api/servicos/${barba.corpo.servico.id}`, {
    nome: 'Barba', duracao_min: 30, preco_centavos: 3500, ativo: false,
  }, admin);
  assert.equal(desativado.status, 200);
  assert.equal(desativado.corpo.servico.ativo, false);

  const publico = await chamar('GET', '/api/servicos');
  assert.deepEqual(publico.corpo.servicos.map((s) => s.nome), ['Corte']);
  const comoAdmin = await chamar('GET', '/api/servicos', undefined, admin);
  assert.equal(comoAdmin.corpo.servicos.length, 2);
  assert.equal((await chamar('PUT', '/api/servicos/9999', novo, admin)).status, 404);
});

test('barbeiros: cadastro, jornada, visão pública e desativação', async () => {
  const admin = await loginAdmin();
  const corte = (await chamar('POST', '/api/servicos', { nome: 'Corte + barba', duracao_min: 60, preco_centavos: 7000 }, admin)).corpo.servico;

  const criado = await chamar('POST', '/api/barbeiros', {
    nome: 'Diego Santos', email: 'diego@barbearia.com', telefone: '68 98888-1111',
    senha: 'diego-senha-1', comissao_pct: 40, servicos: [corte.id],
  }, admin);
  assert.equal(criado.status, 201);
  const diego = criado.corpo.barbeiro;
  assert.deepEqual(diego.servicos, [corte.id]);
  assert.equal(diego.comissao_pct, 40);

  assert.equal((await chamar('POST', '/api/barbeiros', {
    nome: 'Repetido', email: 'diego@barbearia.com', senha: 'diego-senha-1', servicos: [],
  }, admin)).status, 409);
  assert.equal((await chamar('POST', '/api/barbeiros', {
    nome: 'Serviço fantasma', email: 'fantasma@barbearia.com', senha: 'diego-senha-1', servicos: [99999],
  }, admin)).status, 400);

  // Jornada: dois turnos de segunda e sexta.
  const horarios = [
    { dia_semana: 5, inicio: '09:00', fim: '12:00' },
    { dia_semana: 1, inicio: '13:30', fim: '18:00' },
    { dia_semana: 1, inicio: '09:00', fim: '12:00' },
  ];
  const salvo = await chamar('PUT', `/api/barbeiros/${diego.id}/horarios`, { horarios }, admin);
  assert.equal(salvo.status, 200);
  assert.deepEqual(salvo.corpo.barbeiro.horarios.map((h) => `${h.dia_semana} ${h.inicio}`), ['1 09:00', '1 13:30', '5 09:00']);

  for (const ruim of [
    [{ dia_semana: 1, inicio: '12:00', fim: '09:00' }],
    [{ dia_semana: 1, inicio: '09:00', fim: '12:00' }, { dia_semana: 1, inicio: '11:00', fim: '13:00' }],
    [{ dia_semana: 7, inicio: '09:00', fim: '12:00' }],
    [{ dia_semana: 1, inicio: '9h', fim: '12:00' }],
  ]) {
    assert.equal((await chamar('PUT', `/api/barbeiros/${diego.id}/horarios`, { horarios: ruim }, admin)).status, 400);
  }
  // Uma jornada inválida não apaga a anterior.
  const depois = await chamar('GET', '/api/barbeiros', undefined, admin);
  assert.equal(depois.corpo.barbeiros.find((b) => b.id === diego.id).horarios.length, 3);

  // Visão pública não vaza e-mail, telefone nem comissão.
  const publico = await chamar('GET', '/api/barbeiros');
  const visto = publico.corpo.barbeiros.find((b) => b.id === diego.id);
  assert.equal(visto.nome, 'Diego Santos');
  assert.equal(visto.email, undefined);
  assert.equal(visto.telefone, undefined);
  assert.equal(visto.comissao_pct, undefined);

  // O barbeiro entra e vê a própria jornada; não acessa o painel do admin.
  const login = await chamar('POST', '/api/auth/login', { email: 'diego@barbearia.com', senha: 'diego-senha-1' });
  assert.equal(login.status, 200);
  assert.equal(login.corpo.usuario.papel, 'barbeiro');
  const meu = await chamar('GET', '/api/meu-barbeiro', undefined, login.cookie);
  assert.equal(meu.corpo.barbeiro.horarios.length, 3);
  assert.equal((await chamar('POST', '/api/servicos', { nome: 'X', duracao_min: 10, preco_centavos: 1 }, login.cookie)).status, 403);
  assert.equal((await chamar('PUT', `/api/barbeiros/${diego.id}`, { nome: 'Hack', comissao_pct: 100, servicos: [] }, login.cookie)).status, 403);

  // Desativar derruba a sessão, bloqueia o login e some da lista pública.
  const edit = await chamar('PUT', `/api/barbeiros/${diego.id}`, {
    nome: 'Diego Santos', telefone: '68 98888-1111', comissao_pct: 45, servicos: [corte.id], ativo: false,
  }, admin);
  assert.equal(edit.status, 200);
  assert.equal(edit.corpo.barbeiro.comissao_pct, 45);
  assert.equal((await chamar('GET', '/api/meu-barbeiro', undefined, login.cookie)).status, 401);
  assert.equal((await chamar('POST', '/api/auth/login', { email: 'diego@barbearia.com', senha: 'diego-senha-1' })).status, 403);
  const lista = await chamar('GET', '/api/barbeiros');
  assert.equal(lista.corpo.barbeiros.find((b) => b.id === diego.id), undefined);
});

test('rotas desconhecidas e métodos errados', async () => {
  assert.equal((await chamar('GET', '/api/nada')).status, 404);
  assert.equal((await chamar('DELETE', '/api/servicos/1')).status, 405);
});

test('arquivos estáticos: serve a página inicial e não escapa da pasta public', async () => {
  const raiz = await fetch(base + '/');
  assert.equal(raiz.status, 200);
  assert.match(raiz.headers.get('content-type'), /text\/html/);
  assert.ok(raiz.headers.get('content-security-policy'));

  const fora = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: servidor.address().port, path: '/../server.js' }, (res) => {
      let corpo = '';
      res.on('data', (d) => (corpo += d));
      res.on('end', () => resolve({ status: res.statusCode, corpo }));
    });
  });
  assert.equal(fora.status, 404);
  assert.ok(!fora.corpo.includes('criarServidor'));
});

// ───────────────────────── Fase 2: Agendamentos ─────────────────────────

// Helper: cria cenário base com dados únicos usando sufixo baseado no nome do teste
async function criarCenario(sufixo) {
  const admin = await loginAdmin();
  const corte = (await chamar('POST', '/api/servicos', { nome: 'Corte' + sufixo, duracao_min: 30, preco_centavos: 4000 }, admin)).corpo.servico;
  const barba = (await chamar('POST', '/api/servicos', { nome: 'Barba' + sufixo, duracao_min: 20, preco_centavos: 3000 }, admin)).corpo.servico;
  const barbeiro = (await chamar('POST', '/api/barbeiros', {
    nome: 'João' + sufixo, email: 'joao' + sufixo + '@barbearia.com', senha: 'senha1234', comissao_pct: 40, servicos: [corte.id, barba.id],
  }, admin)).corpo.barbeiro;

  // Jornada: seg-sex 09:00-18:00
  const horarios = [];
  for (let d = 1; d <= 5; d++) horarios.push({ dia_semana: d, inicio: '09:00', fim: '18:00' });
  await chamar('PUT', `/api/barbeiros/${barbeiro.id}/horarios`, { horarios }, admin);

  const cliente = (await chamar('POST', '/api/auth/cadastro', {
    nome: 'Cliente' + sufixo, email: 'cliente' + sufixo + '@teste.com', senha: 'senha1234',
  })).cookie;

  const loginBarbeiro = await chamar('POST', '/api/auth/login', { email: 'joao' + sufixo + '@barbearia.com', senha: 'senha1234' });

  return { admin, corte, barba, barbeiro, cliente, loginBarbeiro };
}

// Helper: calcula próxima segunda-feira (ou dia útil)
function proximaSegunda() {
  const d = new Date();
  d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7));
  return d.toISOString().split('T')[0];
}

function proximoDiaUtil() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

test('horarios-livres: retorna slots disponíveis', async () => {
  const { admin, corte, barbeiro } = await criarCenario('_hl1');
  const data = proximaSegunda();

  const r = await chamar('GET', `/api/horarios-livres?barbeiro=${barbeiro.id}&data=${data}&servico=${corte.id}`, undefined, admin);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.corpo.slots));
  assert.ok(r.corpo.slots.length > 0);
  assert.equal(r.corpo.servico.duracao_min, 30);
});

test('horarios-livres: barbeiro inativo retorna 404', async () => {
  const { admin, corte, barbeiro } = await criarCenario('_hl2');
  // Precisa enviar nome válido (>= 2 chars) para o PUT funcionar
  await chamar('PUT', `/api/barbeiros/${barbeiro.id}`, { ativo: false, nome: 'João', telefone: '68 98888-1111', comissao_pct: 40, servicos: [] }, admin);
  const data = proximaSegunda();

  const r = await chamar('GET', `/api/horarios-livres?barbeiro=${barbeiro.id}&data=${data}&servico=${corte.id}`, undefined, admin);
  assert.equal(r.status, 404);
});

test('agendamentos: cliente cria agendamento pendente', async () => {
  const { admin, corte, barbeiro, cliente } = await criarCenario('_ag1');
  const data = proximaSegunda();
  const inicio = `${data}T10:00:00`;

  const r = await chamar('POST', '/api/agendamentos', { barbeiro_id: barbeiro.id, servico_id: corte.id, inicio }, cliente);
  assert.equal(r.status, 201);
  assert.equal(r.corpo.agendamento.status, 'pendente');
  assert.equal(r.corpo.agendamento.barbeiro_id, barbeiro.id);
  assert.equal(r.corpo.agendamento.servico_id, corte.id);
  assert.equal(r.corpo.agendamento.inicio, inicio);
  // Fim esperado em hora local (sem conversão UTC)
  const fimEsperado = new Date(inicio);
  fimEsperado.setMinutes(fimEsperado.getMinutes() + 30);
  const fimLocal = `${fimEsperado.getFullYear()}-${String(fimEsperado.getMonth()+1).padStart(2,'0')}-${String(fimEsperado.getDate()).padStart(2,'0')}T${String(fimEsperado.getHours()).padStart(2,'0')}:${String(fimEsperado.getMinutes()).padStart(2,'0')}:${String(fimEsperado.getSeconds()).padStart(2,'0')}`;
  assert.equal(r.corpo.agendamento.fim, fimLocal);
});

test('agendamentos: impede conflito de horário', async () => {
  const { admin, corte, barbeiro, cliente } = await criarCenario('_ag2');
  const data = proximaSegunda();
  const inicio = `${data}T10:00:00`;

  await chamar('POST', '/api/agendamentos', { barbeiro_id: barbeiro.id, servico_id: corte.id, inicio }, cliente);
  const r = await chamar('POST', '/api/agendamentos', { barbeiro_id: barbeiro.id, servico_id: corte.id, inicio }, cliente);
  assert.equal(r.status, 409);
});

test('agendamentos: impede horário fora da jornada', async () => {
  const { admin, corte, barbeiro, cliente } = await criarCenario('_ag3');
  const data = proximaSegunda();
  const inicio = `${data}T07:00:00`;

  const r = await chamar('POST', '/api/agendamentos', { barbeiro_id: barbeiro.id, servico_id: corte.id, inicio }, cliente);
  assert.equal(r.status, 400);
});

test('agendamentos: impede serviço que barbeiro não atende', async () => {
  const { admin, barbeiro, cliente } = await criarCenario('_ag4');
  const outro = (await chamar('POST', '/api/servicos', { nome: 'Outro' + '_ag4', duracao_min: 30, preco_centavos: 1000 }, admin)).corpo.servico;
  const data = proximaSegunda();
  const inicio = `${data}T10:00:00`;

  const r = await chamar('POST', '/api/agendamentos', { barbeiro_id: barbeiro.id, servico_id: outro.id, inicio }, cliente);
  assert.equal(r.status, 400);
});

test('agendamentos: barbeiro/admin confirma agendamento', async () => {
  const { admin, corte, barbeiro, cliente, loginBarbeiro } = await criarCenario('_ag5');
  const data = proximaSegunda();
  const inicio = `${data}T10:00:00`;

  const criado = await chamar('POST', '/api/agendamentos', { barbeiro_id: barbeiro.id, servico_id: corte.id, inicio }, cliente);
  assert.equal(criado.status, 201);
  const id = criado.corpo.agendamento.id;

  const r = await chamar('PUT', `/api/agendamentos/${id}/confirmar`, {}, loginBarbeiro.cookie);
  assert.equal(r.status, 200);
  assert.equal(r.corpo.agendamento.status, 'confirmado');

  const criado2 = await chamar('POST', '/api/agendamentos', { barbeiro_id: barbeiro.id, servico_id: corte.id, inicio: `${data}T11:00:00` }, cliente);
  assert.equal(criado2.status, 201);
  const r2 = await chamar('PUT', `/api/agendamentos/${criado2.corpo.agendamento.id}/confirmar`, {}, admin);
  assert.equal(r2.status, 200);
});

test('agendamentos: cliente cancela até 2h antes', async () => {
  const { admin, corte, barbeiro, cliente } = await criarCenario('_ag6');
  const data = proximoDiaUtil();
  const inicio = `${data}T10:00:00`;

  const criado = await chamar('POST', '/api/agendamentos', { barbeiro_id: barbeiro.id, servico_id: corte.id, inicio }, cliente);
  const id = criado.corpo.agendamento.id;

  const r = await chamar('PUT', `/api/agendamentos/${id}/cancelar`, {}, cliente);
  assert.equal(r.status, 200);
  assert.equal(r.corpo.agendamento.status, 'cancelado');
});

test('agendamentos: barbeiro/admin cancela a qualquer hora', async () => {
  const { admin, corte, barbeiro, cliente, loginBarbeiro } = await criarCenario('_ag7');
  const data = proximoDiaUtil();
  const inicio = `${data}T10:00:00`;

  const criado = await chamar('POST', '/api/agendamentos', { barbeiro_id: barbeiro.id, servico_id: corte.id, inicio }, cliente);
  const id = criado.corpo.agendamento.id;

  const r = await chamar('PUT', `/api/agendamentos/${id}/cancelar`, {}, loginBarbeiro.cookie);
  assert.equal(r.status, 200);
  assert.equal(r.corpo.agendamento.status, 'cancelado');
});

test('minha-agenda: separa próximos e histórico', async () => {
  const { admin, corte, barbeiro, cliente } = await criarCenario('_ag8');
  const data = proximoDiaUtil();
  const inicio = `${data}T10:00:00`;

  await chamar('POST', '/api/agendamentos', { barbeiro_id: barbeiro.id, servico_id: corte.id, inicio }, cliente);

  const r = await chamar('GET', '/api/minha-agenda', undefined, cliente);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.corpo.proximos));
  assert.ok(Array.isArray(r.corpo.historico));
  assert.equal(r.corpo.proximos.length, 1);
  assert.equal(r.corpo.proximos[0].status, 'pendente');
});

test('agenda-barbeiro: lista agendamentos do dia com filtro', async () => {
  const { admin, corte, barbeiro, cliente, loginBarbeiro } = await criarCenario('_ag9');
  const data = proximoDiaUtil();
  const inicio = `${data}T10:00:00`;

  await chamar('POST', '/api/agendamentos', { barbeiro_id: barbeiro.id, servico_id: corte.id, inicio }, cliente);

  const r = await chamar('GET', `/api/agenda-barbeiro?data=${data}`, undefined, loginBarbeiro.cookie);
  assert.equal(r.status, 200);
  assert.equal(r.corpo.agendamentos.length, 1);
  assert.equal(r.corpo.agendamentos[0].cliente.nome, 'Cliente' + '_ag9');
});

test('agenda-admin: visão geral com filtros', async () => {
  const { admin, corte, barbeiro, cliente } = await criarCenario('_ag10');
  const data = proximoDiaUtil();
  const inicio = `${data}T10:00:00`;

  await chamar('POST', '/api/agendamentos', { barbeiro_id: barbeiro.id, servico_id: corte.id, inicio }, cliente);

  const r = await chamar('GET', `/api/agenda-admin?data=${data}&barbeiro=${barbeiro.id}`, undefined, admin);
  assert.equal(r.status, 200);
  assert.equal(r.corpo.agendamentos.length, 1);
  assert.ok(r.corpo.agendamentos[0].cliente?.nome);
  assert.ok(r.corpo.agendamentos[0].barbeiro?.nome);
});

test('bloqueios: admin cria e remove bloqueio', async () => {
  const { admin, corte, barbeiro } = await criarCenario('_bl1');
  const data = proximoDiaUtil();
  const inicio = `${data}T10:00:00`;
  const fim = `${data}T12:00:00`;

  const criado = await chamar('POST', '/api/bloqueios', { barbeiro_id: barbeiro.id, inicio, fim, motivo: 'Manutenção' }, admin);
  assert.equal(criado.status, 201);
  assert.equal(criado.corpo.bloqueio.motivo, 'Manutenção');

  // Verifica que bloqueio impede agendamento
  const r = await chamar('POST', '/api/agendamentos', { barbeiro_id: barbeiro.id, servico_id: corte.id, inicio }, (await chamar('POST', '/api/auth/cadastro', { nome: 'C2', email: 'c2_bl1@teste.com', senha: 'senha1234' })).cookie);
  assert.equal(r.status, 409);

  // Remove bloqueio
  await chamar('DELETE', `/api/bloqueios/${criado.corpo.bloqueio.id}`, undefined, admin);
  const r2 = await chamar('POST', '/api/agendamentos', { barbeiro_id: barbeiro.id, servico_id: corte.id, inicio }, (await chamar('POST', '/api/auth/cadastro', { nome: 'C3', email: 'c3_bl1@teste.com', senha: 'senha1234' })).cookie);
  assert.equal(r2.status, 201);
});

test('bloqueios: bloqueio global (sem barbeiro) afeta todos', async () => {
  const { admin, corte, barbeiro } = await criarCenario('_bl2');
  // Cria segundo barbeiro
  const barbeiro2 = (await chamar('POST', '/api/barbeiros', {
    nome: 'João2' + '_bl2', email: 'joao2_bl2@barbearia.com', senha: 'senha1234', comissao_pct: 40, servicos: [corte.id],
  }, admin)).corpo.barbeiro;
  const horarios = [];
  for (let d = 1; d <= 5; d++) horarios.push({ dia_semana: d, inicio: '09:00', fim: '18:00' });
  await chamar('PUT', `/api/barbeiros/${barbeiro2.id}/horarios`, { horarios }, admin);

  // Usa data distante para evitar poluição de testes anteriores
  const data = new Date();
  data.setDate(data.getDate() + 30);
  while (data.getDay() === 0 || data.getDay() === 6) data.setDate(data.getDate() + 1);
  const dataStr = data.toISOString().split('T')[0];
  const inicio = `${dataStr}T10:00:00`;
  const fim = `${dataStr}T12:00:00`;

  // Bloqueio global (sem barbeiro_id)
  const bloqueio = await chamar('POST', '/api/bloqueios', { inicio, fim, motivo: 'Feriado' }, admin);
  assert.equal(bloqueio.status, 201);

  const cadastro = await chamar('POST', '/api/auth/cadastro', { nome: 'Cliente Teste', email: 'c_bl2@teste.com', senha: 'senha1234' });
  assert.equal(cadastro.status, 201);
  const cliente = cadastro.cookie;
  const r1 = await chamar('POST', '/api/agendamentos', { barbeiro_id: barbeiro.id, servico_id: corte.id, inicio }, cliente);
  assert.equal(r1.status, 409);
  const r2 = await chamar('POST', '/api/agendamentos', { barbeiro_id: barbeiro2.id, servico_id: corte.id, inicio }, cliente);
  assert.equal(r2.status, 409);
});