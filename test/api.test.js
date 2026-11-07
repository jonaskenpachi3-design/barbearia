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

// Retorna a próxima data de dia útil (seg-sex) no formato YYYY-MM-DD
function proximaDataUtil() {
  const d = new Date();
  // Se hoje for sábado (6) ou domingo (0), avança para segunda (1)
  // Se hoje for dia útil, usa hoje
  const dia = d.getDay();
  if (dia === 0) d.setDate(d.getDate() + 1); // Domingo -> Segunda
  else if (dia === 6) d.setDate(d.getDate() + 2); // Sábado -> Segunda
  // Se for dia útil (1-5), usa hoje
  return d.toISOString().split('T')[0];
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

// ───────────────────────── Fase 3: Operação & Financeiro ─────────────────────────

// Helper para Fase 3: cria cenário com caixa aberto
async function criarCenarioFase3(sufixo) {
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

  // Abre caixa (ou usa existente)
  const hoje = new Date().toISOString().split('T')[0];
  let caixaAberto = await chamar('POST', '/api/caixa/abrir', { valor_inicial_centavos: 10000, observacao: 'Teste' }, admin);
  if (caixaAberto.status === 409) {
    // Caixa já existe, obtém o aberto
    caixaAberto = await chamar('GET', '/api/caixa/aberto', undefined, admin);
    assert.ok(caixaAberto.corpo.caixa, 'Deveria haver um caixa aberto');
  } else {
    assert.equal(caixaAberto.status, 201);
  }

  const cliente = (await chamar('POST', '/api/auth/cadastro', {
    nome: 'Cliente' + sufixo, email: 'cliente' + sufixo + '@teste.com', senha: 'senha1234',
  })).cookie;

  const loginBarbeiro = await chamar('POST', '/api/auth/login', { email: 'joao' + sufixo + '@barbearia.com', senha: 'senha1234' });

  return { admin, corte, barba, barbeiro, cliente, loginBarbeiro };
}

test('produtos: CRUD completo', async () => {
  const admin = await loginAdmin();

  // Criar
  const criado = await chamar('POST', '/api/produtos', {
    sku: 'SHAMP-001', nome: 'Shampoo 250ml', descricao: 'Shampoo profissional',
    custo_centavos: 1500, preco_centavos: 3500, quantidade: 20, qtd_minima: 5,
    comissao_pct: 10, comissao_fixo: 0, ativo: true,
  }, admin);
  assert.equal(criado.status, 201);
  assert.equal(criado.corpo.produto.sku, 'SHAMP-001');
  assert.equal(criado.corpo.produto.quantidade, 20);
  const id = criado.corpo.produto.id;

  // Listar
  const lista = await chamar('GET', '/api/produtos', undefined, admin);
  assert.equal(lista.corpo.produtos.length, 1);
  assert.equal(lista.corpo.produtos[0].nome, 'Shampoo 250ml');

  // Editar
  const editado = await chamar('PUT', `/api/produtos/${id}`, {
    sku: 'SHAMP-001', nome: 'Shampoo 250ml', descricao: 'Atualizado',
    custo_centavos: 1600, preco_centavos: 3600, quantidade: 20, qtd_minima: 5,
    comissao_pct: 10, comissao_fixo: 0, ativo: true,
  }, admin);
  assert.equal(editado.status, 200);
  assert.equal(editado.corpo.produto.descricao, 'Atualizado');
  assert.equal(editado.corpo.produto.preco_centavos, 3600);

  // Entrada de estoque
  const entrada = await chamar('POST', `/api/produtos/${id}/entrada`, { quantidade: 10 }, admin);
  assert.equal(entrada.status, 200);
  assert.equal(entrada.corpo.produto.quantidade, 30);

  // SKU duplicado falha
  const dup = await chamar('POST', '/api/produtos', {
    sku: 'SHAMP-001', nome: 'Outro', custo_centavos: 1000, preco_centavos: 2000, quantidade: 1,
  }, admin);
  assert.equal(dup.status, 409);
});

test('produtos: alerta de estoque baixo', async () => {
  const admin = await loginAdmin();
  await chamar('POST', '/api/produtos', {
    sku: 'POMADE-001', nome: 'Pomada', custo_centavos: 2000, preco_centavos: 5000,
    quantidade: 2, qtd_minima: 5, comissao_pct: 15,
  }, admin);

  const baixo = await chamar('GET', '/api/produtos/baixo-estoque', undefined, admin);
  assert.equal(baixo.corpo.produtos.length, 1);
  assert.equal(baixo.corpo.produtos[0].nome, 'Pomada');
  assert.equal(baixo.corpo.produtos[0].estoque_baixo, true);
});

test('servico comissao: define e remove regra específica', async () => {
  const admin = await loginAdmin();
  const servico = (await chamar('POST', '/api/servicos', { nome: 'Corte Especial', duracao_min: 45, preco_centavos: 6000 }, admin)).corpo.servico;

  // Sem regra = usa comissão do barbeiro
  const semRegra = await chamar('GET', `/api/servicos/${servico.id}/comissao`, undefined, admin);
  assert.equal(semRegra.corpo.comissao, null);

  // Define regra percentual (50% = 5000 centésimos)
  const regra = await chamar('PUT', `/api/servicos/${servico.id}/comissao`, { tipo: 'percentual', valor: 5000 }, admin);
  assert.equal(regra.status, 200);
  assert.equal(regra.corpo.comissao.tipo, 'percentual');
  assert.equal(regra.corpo.comissao.valor, 5000);

  // Verifica
  const comRegra = await chamar('GET', `/api/servicos/${servico.id}/comissao`, undefined, admin);
  assert.equal(comRegra.corpo.comissao.valor, 5000);

  // Remove
  await chamar('DELETE', `/api/servicos/${servico.id}/comissao`, undefined, admin);
  const removida = await chamar('GET', `/api/servicos/${servico.id}/comissao`, undefined, admin);
  assert.equal(removida.corpo.comissao, null);
});

test('pdv: venda de serviço walk-in', async () => {
  const { admin, corte, barbeiro, loginBarbeiro } = await criarCenarioFase3('_pdv1');

  const r = await chamar('POST', '/api/vendas', {
    barbeiro_id: barbeiro.id,
    itens: [{ tipo: 'servico', referencia_id: corte.id, quantidade: 1 }],
    forma_pagamento: 'dinheiro',
    dinheiro_recebido: 5000,
    desconto_centavos: 0,
  }, loginBarbeiro.cookie);
  assert.equal(r.status, 201);
  assert.equal(r.corpo.venda.total_centavos, 4000);
  assert.equal(r.corpo.venda.troco_centavos, 1000);
  assert.equal(r.corpo.venda.forma_pagamento, 'dinheiro');
  // Comissão calculada (40% de 4000 = 1600 centavos = 16,00)
  assert.equal(r.corpo.venda.itens[0].comissao_centavos, 1600);
});

test('pdv: venda de produto com baixa de estoque', async () => {
  const { admin, barbeiro, loginBarbeiro } = await criarCenarioFase3('_pdv2');

  const produto = (await chamar('POST', '/api/produtos', {
    sku: 'OLEO-001', nome: 'Óleo para barba', custo_centavos: 1000, preco_centavos: 3000,
    quantidade: 10, qtd_minima: 2, comissao_pct: 10,
  }, admin)).corpo.produto;

  const r = await chamar('POST', '/api/vendas', {
    barbeiro_id: barbeiro.id,
    itens: [{ tipo: 'produto', referencia_id: produto.id, quantidade: 2 }],
    forma_pagamento: 'pix',
    desconto_centavos: 0,
  }, loginBarbeiro.cookie);
  assert.equal(r.status, 201);
  assert.equal(r.corpo.venda.total_centavos, 6000);
  assert.equal(r.corpo.venda.forma_pagamento, 'pix');
  // Comissão do produto: 10% de 6000 = 600 centavos
  assert.equal(r.corpo.venda.itens[0].comissao_centavos, 600);

  // Verifica baixa de estoque
  const p = await chamar('GET', '/api/produtos', undefined, admin);
  assert.equal(p.corpo.produtos.find(x => x.id === produto.id).quantidade, 8);
});

test('pdv: venda mista (serviço + produto) com desconto', async () => {
  const { admin, corte, barbeiro, loginBarbeiro } = await criarCenarioFase3('_pdv3');

  const produto = (await chamar('POST', '/api/produtos', {
    sku: 'BALM-001', nome: 'Balm', custo_centavos: 800, preco_centavos: 2500,
    quantidade: 15, qtd_minima: 3, comissao_pct: 10,
  }, admin)).corpo.produto;

  const r = await chamar('POST', '/api/vendas', {
    barbeiro_id: barbeiro.id,
    itens: [
      { tipo: 'servico', referencia_id: corte.id, quantidade: 1 },
      { tipo: 'produto', referencia_id: produto.id, quantidade: 1 },
    ],
    forma_pagamento: 'cartao',
    desconto_centavos: 500, // 5,00 de desconto
  }, loginBarbeiro.cookie);
  assert.equal(r.status, 201);
  // Subtotal = 4000 + 2500 = 6500, desconto 500 = total 6000
  assert.equal(r.corpo.venda.total_centavos, 6000);
  assert.equal(r.corpo.venda.desconto_centavos, 500);
});

test('comissoes: geradas na venda, listagem e pagamento em lote', async () => {
  const { admin, corte, barbeiro, loginBarbeiro } = await criarCenarioFase3('_com1');

  // Conta comissões existentes para este barbeiro
  const antes = await chamar('GET', `/api/comissoes?barbeiro=${barbeiro.id}`, undefined, admin);
  const countAntes = antes.corpo.comissoes.length;

  // Faz uma venda
  await chamar('POST', '/api/vendas', {
    barbeiro_id: barbeiro.id,
    itens: [{ tipo: 'servico', referencia_id: corte.id, quantidade: 1 }],
    forma_pagamento: 'dinheiro',
    dinheiro_recebido: 5000,
  }, loginBarbeiro.cookie);

  // Lista comissões (filtrando pelo barbeiro do teste)
  const lista = await chamar('GET', `/api/comissoes?barbeiro=${barbeiro.id}`, undefined, admin);
  assert.equal(lista.corpo.comissoes.length, countAntes + 1);
  const novaComissao = lista.corpo.comissoes.find(c => c.valor_centavos === 1600 && c.status === 'a_receber');
  assert.ok(novaComissao, 'Nova comissão deve ser criada');
  assert.equal(novaComissao.valor_centavos, 1600); // 40% de 4000
  const comissaoId = novaComissao.id;

  // Resumo
  const resumo = await chamar('GET', '/api/comissoes/resumo', undefined, admin);
  assert.ok(resumo.corpo.resumo.length >= 1);

  // Paga a comissão
  const pago = await chamar('PUT', `/api/comissoes/${comissaoId}/pagar`, { observacao: 'Pago em dinheiro' }, admin);
  assert.equal(pago.status, 200);
  assert.equal(pago.corpo.comissao.status, 'pago');

  // Verifica no resumo
  const resumo2 = await chamar('GET', '/api/comissoes/resumo', undefined, admin);
  const barbeiroResumo = resumo2.corpo.resumo.find(r => r.barbeiro_id === barbeiro.id);
  assert.ok(barbeiroResumo, 'Resumo deve conter o barbeiro');
  assert.equal(barbeiroResumo.pago, 1600);
});

test('comissoes: pagamento em lote', async () => {
  const { admin, corte, barbeiro, loginBarbeiro } = await criarCenarioFase3('_com2');

  // Conta comissões existentes
  const antes = await chamar('GET', `/api/comissoes?barbeiro=${barbeiro.id}`, undefined, admin);
  const countAntes = antes.corpo.comissoes.filter(c => c.status === 'a_receber').length;

  // Duas vendas
  await chamar('POST', '/api/vendas', {
    barbeiro_id: barbeiro.id,
    itens: [{ tipo: 'servico', referencia_id: corte.id, quantidade: 1 }],
    forma_pagamento: 'dinheiro', dinheiro_recebido: 5000,
  }, loginBarbeiro.cookie);
  await chamar('POST', '/api/vendas', {
    barbeiro_id: barbeiro.id,
    itens: [{ tipo: 'servico', referencia_id: corte.id, quantidade: 1 }],
    forma_pagamento: 'pix',
  }, loginBarbeiro.cookie);

  const lista = await chamar('GET', `/api/comissoes?barbeiro=${barbeiro.id}`, undefined, admin);
  const novasComissoes = lista.corpo.comissoes.filter(c => c.valor_centavos === 1600 && c.status === 'a_receber');
  assert.equal(novasComissoes.length, 2);
  const ids = novasComissoes.map(c => c.id);

  // Paga em lote
  const lote = await chamar('PUT', '/api/comissoes/lote/pagar', { ids }, admin);
  assert.equal(lote.status, 200);
  assert.equal(lote.corpo.pagas, 2);

  const lista2 = await chamar('GET', `/api/comissoes?barbeiro=${barbeiro.id}`, undefined, admin);
  const naoPagas = lista2.corpo.comissoes.filter(c => c.status === 'a_receber' && c.valor_centavos === 1600);
  assert.equal(naoPagas.length, 0); // Todas as novas comissoes devem estar pagas
});

test('cliente observacoes: barbeiro adiciona anotação', async () => {
  const { admin, corte, barbeiro, cliente, loginBarbeiro } = await criarCenarioFase3('_obs1');

  // Cria agendamento e conclui para ter cliente no histórico
  const data = proximaDataUtil();
  const inicio = `${data}T10:00:00`;
  const ag = await chamar('POST', '/api/agendamentos', { barbeiro_id: barbeiro.id, servico_id: corte.id, inicio }, cliente);
  await chamar('PUT', `/api/agendamentos/${ag.corpo.agendamento.id}/confirmar`, {}, loginBarbeiro.cookie);
  await chamar('PUT', `/api/agendamentos/${ag.corpo.agendamento.id}/concluir`, {}, loginBarbeiro.cookie);

  const clienteId = ag.corpo.agendamento.cliente_id;

  // Adiciona observação
  const obs = await chamar('POST', `/api/clientes/${clienteId}/observacoes`, { conteudo: 'Prefere corte reto, topo baixo' }, loginBarbeiro.cookie);
  assert.equal(obs.status, 201);
  assert.equal(obs.corpo.observacao.conteudo, 'Prefere corte reto, topo baixo');

  // Lista observações
  const lista = await chamar('GET', `/api/clientes/${clienteId}/observacoes`, undefined, loginBarbeiro.cookie);
  assert.equal(lista.corpo.observacoes.length, 1);
});

test('cliente historico: agendamentos, vendas e observações', async () => {
  const { admin, corte, barbeiro, cliente, loginBarbeiro } = await criarCenarioFase3('_hist1');

  // Agendamento
  const data = proximaDataUtil();
  const inicio = `${data}T10:00:00`;
  const ag = await chamar('POST', '/api/agendamentos', { barbeiro_id: barbeiro.id, servico_id: corte.id, inicio }, cliente);
  await chamar('PUT', `/api/agendamentos/${ag.corpo.agendamento.id}/confirmar`, {}, loginBarbeiro.cookie);
  await chamar('PUT', `/api/agendamentos/${ag.corpo.agendamento.id}/concluir`, {}, loginBarbeiro.cookie);

  // Venda walk-in (com cliente_id para aparecer no histórico)
  await chamar('POST', '/api/vendas', {
    barbeiro_id: barbeiro.id,
    cliente_id: ag.corpo.agendamento.cliente_id,
    itens: [{ tipo: 'servico', referencia_id: corte.id, quantidade: 1 }],
    forma_pagamento: 'cartao',
  }, loginBarbeiro.cookie);

  // Observação
  const clienteId = ag.corpo.agendamento.cliente_id;
  await chamar('POST', `/api/clientes/${clienteId}/observacoes`, { conteudo: 'Teste' }, loginBarbeiro.cookie);

  // Histórico
  const hist = await chamar('GET', `/api/clientes/${clienteId}/historico`, undefined, loginBarbeiro.cookie);
  assert.equal(hist.corpo.agendamentos.length, 1);
  assert.equal(hist.corpo.vendas.length, 1);
  assert.equal(hist.corpo.observacoes.length, 1);
});

test('agendamentos: barbeiro/admin conclui agendamento', async () => {
  const { admin, corte, barbeiro, cliente, loginBarbeiro } = await criarCenarioFase3('_ag11');
  const data = proximaDataUtil();
  const inicio = `${data}T10:00:00`;

  const criado = await chamar('POST', '/api/agendamentos', { barbeiro_id: barbeiro.id, servico_id: corte.id, inicio }, cliente);
  const id = criado.corpo.agendamento.id;

  await chamar('PUT', `/api/agendamentos/${id}/confirmar`, {}, loginBarbeiro.cookie);
  const r = await chamar('PUT', `/api/agendamentos/${id}/concluir`, {}, loginBarbeiro.cookie);
  assert.equal(r.status, 200);
  assert.equal(r.corpo.agendamento.status, 'concluido');
});

// ─── Caixa test (executa por último para não fechar o caixa dos outros testes) ───
test('caixa: abrir, sangria, fechar', async () => {
  const admin = await loginAdmin();

  // Tenta abrir caixa - se já existir um aberto, usa ele
  let aberto = await chamar('POST', '/api/caixa/abrir', { valor_inicial_centavos: 5000, observacao: 'Início do dia' }, admin);

  let caixaId;
  if (aberto.status === 409) {
    // Caixa já existe, obtém o aberto
    const existente = await chamar('GET', '/api/caixa/aberto', undefined, admin);
    assert.ok(existente.corpo.caixa, 'Deveria haver um caixa aberto');
    caixaId = existente.corpo.caixa.id;
  } else {
    assert.equal(aberto.status, 201);
    assert.equal(aberto.corpo.caixa.status, 'aberto');
    caixaId = aberto.corpo.caixa.id;
  }

  // Verifica caixa aberto
  const caixaAberto = await chamar('GET', '/api/caixa/aberto', undefined, admin);
  assert.equal(caixaAberto.corpo.caixa.id, caixaId);
  assert.equal(caixaAberto.corpo.caixa.status, 'aberto');

  // Sangria
  const sangria = await chamar('POST', `/api/caixa/${caixaId}/sangria`, { valor_centavos: 2000, motivo: 'Pagamento fornecedor' }, admin);
  assert.equal(sangria.status, 200);
  assert.equal(sangria.corpo.caixa.sangrias_centavos, 2000);

  // Fechar caixa - calcula valor esperado: inicial + vendas - sangrias
  // O caixa pode ter vendas de testes anteriores, então soma as vendas concluídas
  const caixaAtual = await chamar('GET', `/api/caixa/${caixaId}`, undefined, admin);
  const valorInicial = caixaAtual.corpo.caixa.valor_inicial_centavos;
  const sangrias = caixaAtual.corpo.caixa.sangrias_centavos;
  const vendas = caixaAtual.corpo.vendas || [];
  const totalVendas = vendas
    .filter(v => v.status === 'concluida')
    .reduce((s, v) => s + (v.total_centavos || 0), 0);
  const esperado = valorInicial + totalVendas - sangrias;

  const fechado = await chamar('PUT', `/api/caixa/${caixaId}/fechar`, { valor_final_centavos: esperado, observacao: 'Fim do dia' }, admin);
  assert.equal(fechado.status, 200);
  assert.equal(fechado.corpo.caixa.status, 'fechado');
  assert.equal(fechado.corpo.caixa.valor_final_centavos, esperado);
  assert.equal(fechado.corpo.diferenca, 0);

  // Não pode fechar duas vezes
  const dup = await chamar('PUT', `/api/caixa/${caixaId}/fechar`, { valor_final_centavos: esperado }, admin);
  assert.equal(dup.status, 400);
});

// ─── Dashboard Admin ───
test('admin dashboard: retorna KPIs (ocupação, no-show, ticket médio, faturamento)', async () => {
  const admin = await loginAdmin();

  // Cria um serviço e barbeiro
  const servico = (await chamar('POST', '/api/servicos', { nome: 'Corte Dashboard', duracao_min: 30, preco_centavos: 4000 }, admin)).corpo.servico;
  const barbeiro = (await chamar('POST', '/api/barbeiros', {
    nome: 'João Dashboard', email: 'joao.dashboard@barbearia.com', senha: 'senha1234', comissao_pct: 40, servicos: [servico.id],
  }, admin)).corpo.barbeiro;

  // Jornada: seg-sex 09:00-18:00
  const horarios = [];
  for (let d = 1; d <= 5; d++) horarios.push({ dia_semana: d, inicio: '09:00', fim: '18:00' });
  await chamar('PUT', `/api/barbeiros/${barbeiro.id}/horarios`, { horarios }, admin);

  // Cria agendamento em um dia útil (usa data fixa para evitar fim de semana)
  const dataUtil = '2025-01-15'; // Quarta-feira
  const inicio = `${dataUtil}T10:00:00`;
  const cliente = (await chamar('POST', '/api/auth/cadastro', {
    nome: 'Cliente Dash', email: 'clientedash@teste.com', senha: 'senha1234',
  })).cookie;

  const ag = await chamar('POST', '/api/agendamentos', { barbeiro_id: barbeiro.id, servico_id: servico.id, inicio }, cliente);
  assert.equal(ag.status, 201);
  const agId = ag.corpo.agendamento.id;

  const loginBarbeiro = await chamar('POST', '/api/auth/login', { email: 'joao.dashboard@barbearia.com', senha: 'senha1234' });
  await chamar('PUT', `/api/agendamentos/${agId}/confirmar`, {}, loginBarbeiro.cookie);
  await chamar('PUT', `/api/agendamentos/${agId}/concluir`, {}, loginBarbeiro.cookie);

  // Cria venda walk-in
  await chamar('POST', '/api/vendas', {
    barbeiro_id: barbeiro.id,
    itens: [{ tipo: 'servico', referencia_id: servico.id, quantidade: 1 }],
    forma_pagamento: 'cartao',
  }, loginBarbeiro.cookie);

  // Abre caixa para o dia
  await chamar('POST', '/api/caixa/abrir', { valor_inicial_centavos: 10000, observacao: 'Teste dashboard' }, admin);

  // Chama dashboard
  const dash = await chamar('GET', '/api/admin/dashboard', undefined, admin);
  assert.equal(dash.status, 200);
  assert.ok(typeof dash.corpo.kpis.ocupacao_pct === 'number');
  assert.ok(typeof dash.corpo.kpis.no_show_pct === 'number');
  assert.ok(typeof dash.corpo.kpis.ticket_medio_centavos === 'number');
  assert.ok(typeof dash.corpo.kpis.faturamento_centavos === 'number');
  assert.ok(dash.corpo.kpis.faturamento_centavos > 0);
});

test('admin dashboard: nega acesso para não-admin', async () => {
  const barbeiro = (await chamar('POST', '/api/barbeiros', {
    nome: 'João Dash2', email: 'joao.dash2@barbearia.com', senha: 'senha1234', comissao_pct: 40, servicos: [],
  }, await loginAdmin())).corpo.barbeiro;
  const loginBarbeiro = await chamar('POST', '/api/auth/login', { email: 'joao.dash2@barbearia.com', senha: 'senha1234' });

  const dash = await chamar('GET', '/api/admin/dashboard', undefined, loginBarbeiro.cookie);
  assert.equal(dash.status, 403);
});

test('admin relatorio-financeiro: retorna faturamento por serviço, período e barbeiro', async () => {
  const admin = await loginAdmin();

  // Cria serviços e barbeiro
  const servico1 = (await chamar('POST', '/api/servicos', { nome: 'Corte Rel', duracao_min: 30, preco_centavos: 4000 }, admin)).corpo.servico;
  const servico2 = (await chamar('POST', '/api/servicos', { nome: 'Barba Rel', duracao_min: 20, preco_centavos: 3000 }, admin)).corpo.servico;
  const barbeiro = (await chamar('POST', '/api/barbeiros', {
    nome: 'João Rel', email: 'joao.rel@barbearia.com', senha: 'senha1234', comissao_pct: 40, servicos: [servico1.id, servico2.id],
  }, admin)).corpo.barbeiro;

  const horarios = [];
  for (let d = 1; d <= 5; d++) horarios.push({ dia_semana: d, inicio: '09:00', fim: '18:00' });
  await chamar('PUT', `/api/barbeiros/${barbeiro.id}/horarios`, { horarios }, admin);

  const dataUtil = '2025-01-15';
  const inicio = `${dataUtil}T10:00:00`;
  const cliente = (await chamar('POST', '/api/auth/cadastro', {
    nome: 'Cliente Rel', email: 'clienterel@teste.com', senha: 'senha1234',
  })).cookie;

  const ag = await chamar('POST', '/api/agendamentos', { barbeiro_id: barbeiro.id, servico_id: servico1.id, inicio }, cliente);
  const agId = ag.corpo.agendamento.id;

  const loginBarbeiro = await chamar('POST', '/api/auth/login', { email: 'joao.rel@barbearia.com', senha: 'senha1234' });
  await chamar('PUT', `/api/agendamentos/${agId}/confirmar`, {}, loginBarbeiro.cookie);
  await chamar('PUT', `/api/agendamentos/${agId}/concluir`, {}, loginBarbeiro.cookie);

  await chamar('POST', '/api/vendas', {
    barbeiro_id: barbeiro.id,
    itens: [{ tipo: 'servico', referencia_id: servico2.id, quantidade: 1 }],
    forma_pagamento: 'cartao',
  }, loginBarbeiro.cookie);

  await chamar('POST', '/api/caixa/abrir', { valor_inicial_centavos: 10000, observacao: 'Teste relatório' }, admin);

  const rel = await chamar('GET', '/api/admin/relatorio-financeiro', undefined, admin);
  assert.equal(rel.status, 200);
  assert.ok(Array.isArray(rel.corpo.faturamento_por_servico));
  assert.ok(Array.isArray(rel.corpo.faturamento_por_periodo));
  assert.ok(Array.isArray(rel.corpo.faturamento_por_barbeiro));
  assert.ok(Array.isArray(rel.corpo.comissoes));
  assert.ok(rel.corpo.faturamento_por_servico.length > 0);
  assert.ok(rel.corpo.faturamento_por_periodo.length > 0);
  assert.ok(rel.corpo.faturamento_por_barbeiro.length > 0);
});

test('admin relatorio-financeiro: aceita parâmetros data_inicio e data_fim', async () => {
  const admin = await loginAdmin();
  const rel = await chamar('GET', '/api/admin/relatorio-financeiro?data_inicio=2025-01-01&data_fim=2025-01-31', undefined, admin);
  assert.equal(rel.status, 200);
  assert.ok(Array.isArray(rel.corpo.faturamento_por_servico));
});

test('admin relatorio-financeiro: nega acesso para não-admin', async () => {
  const barbeiro = (await chamar('POST', '/api/barbeiros', {
    nome: 'João Rel2', email: 'joao.rel2@barbearia.com', senha: 'senha1234', comissao_pct: 40, servicos: [],
  }, await loginAdmin())).corpo.barbeiro;
  const loginBarbeiro = await chamar('POST', '/api/auth/login', { email: 'joao.rel2@barbearia.com', senha: 'senha1234' });

  const rel = await chamar('GET', '/api/admin/relatorio-financeiro', undefined, loginBarbeiro.cookie);
  assert.equal(rel.status, 403);
});

// ─── Agendamento Público (nome + telefone) ───
test('agendamento publico: cliente agenda só com nome + telefone', async () => {
  const admin = await loginAdmin();
  const servico = (await chamar('POST', '/api/servicos', { nome: 'Corte Público', duracao_min: 30, preco_centavos: 4000 }, admin)).corpo.servico;
  const barbeiro = (await chamar('POST', '/api/barbeiros', {
    nome: 'João Público', email: 'joao.publico@barbearia.com', senha: 'senha1234', comissao_pct: 40, servicos: [servico.id],
  }, admin)).corpo.barbeiro;

  const horarios = [];
  for (let d = 1; d <= 5; d++) horarios.push({ dia_semana: d, inicio: '09:00', fim: '18:00' });
  await chamar('PUT', `/api/barbeiros/${barbeiro.id}/horarios`, { horarios }, admin);

  // Abre caixa
  await chamar('POST', '/api/caixa/abrir', { valor_inicial_centavos: 10000, observacao: 'Teste público' }, admin);

  // Próxima quarta-feira (dia 3) no futuro
  const dataUtil = (() => {
    const d = new Date();
    d.setDate(d.getDate() + ((3 - d.getDay() + 7) % 7 || 7)); // Próxima quarta
    return d.toISOString().split('T')[0];
  })();
  const inicio = `${dataUtil}T10:00:00`;

  // Agenda sem login
  const ag = await chamar('POST', '/api/agendamentos-publico', {
    nome: 'Cliente Público',
    telefone: '(11) 99999-8888',
    barbeiro_id: barbeiro.id,
    servico_id: servico.id,
    inicio
  });
  assert.equal(ag.status, 201);
  assert.ok(ag.corpo.agendamento);
  assert.equal(ag.corpo.agendamento.cliente?.nome, 'Cliente Público');
  assert.ok(ag.corpo.codigo_cancelamento);
  assert.equal(ag.corpo.codigo_cancelamento.length, 6);

  const agendamentoId = ag.corpo.agendamento.id;
  const codigoCancelamento = ag.corpo.codigo_cancelamento;

  // Verifica que agendamento aparece na agenda do barbeiro
  const loginBarbeiro = await chamar('POST', '/api/auth/login', { email: 'joao.publico@barbearia.com', senha: 'senha1234' });
  const agendaBarbeiro = await chamar('GET', `/api/agenda-barbeiro?data=${dataUtil}`, undefined, loginBarbeiro.cookie);
  assert.equal(agendaBarbeiro.status, 200);
  assert.ok(agendaBarbeiro.corpo.agendamentos.some(a => a.id === agendamentoId));

  // Tenta cancelar com código errado
  const cancelarErrado = await chamar('POST', `/api/agendamentos/${agendamentoId}/cancelar-publico`, { codigo: '000000' });
  assert.equal(cancelarErrado.status, 403);

  // Cancela com código correto
  const cancelar = await chamar('POST', `/api/agendamentos/${agendamentoId}/cancelar-publico`, { codigo: codigoCancelamento });
  assert.equal(cancelar.status, 200);
  assert.equal(cancelar.corpo.mensagem, 'Agendamento cancelado com sucesso.');

  // Verifica que está cancelado
  const agendaApos = await chamar('GET', `/api/agenda-barbeiro?data=${dataUtil}`, undefined, loginBarbeiro.cookie);
  const agCancelado = agendaApos.corpo.agendamentos.find(a => a.id === agendamentoId);
  assert.equal(agCancelado.status, 'cancelado');
});

test('agendamento publico: valida dados obrigatórios', async () => {
  const res = await chamar('POST', '/api/agendamentos-publico', { nome: 'A', telefone: '123' });
  assert.equal(res.status, 400);
});

test('agendamento publico: impede horario fora da jornada', async () => {
  const admin = await loginAdmin();
  const servico = (await chamar('POST', '/api/servicos', { nome: 'Corte Teste', duracao_min: 30, preco_centavos: 4000 }, admin)).corpo.servico;
  const barbeiro = (await chamar('POST', '/api/barbeiros', {
    nome: 'João Teste', email: 'joao.teste@barbearia.com', senha: 'senha1234', comissao_pct: 40, servicos: [servico.id],
  }, admin)).corpo.barbeiro;

  const horarios = [];
  for (let d = 1; d <= 5; d++) horarios.push({ dia_semana: d, inicio: '09:00', fim: '18:00' });
  await chamar('PUT', `/api/barbeiros/${barbeiro.id}/horarios`, { horarios }, admin);

  const dataUtil = '2025-01-15';
  const inicioFora = `${dataUtil}T07:00:00`; // Antes das 09:00

  const res = await chamar('POST', '/api/agendamentos-publico', {
    nome: 'Cliente Teste', telefone: '(11) 99999-7777', barbeiro_id: barbeiro.id, servico_id: servico.id, inicio: inicioFora
  });
  assert.equal(res.status, 400);
  assert.ok(res.corpo.erro.includes('fora da jornada'));
});

test('agendamento publico: impede conflito de horario', async () => {
  const admin = await loginAdmin();
  const servico = (await chamar('POST', '/api/servicos', { nome: 'Corte Conflito', duracao_min: 30, preco_centavos: 4000 }, admin)).corpo.servico;
  const barbeiro = (await chamar('POST', '/api/barbeiros', {
    nome: 'João Conflito', email: 'joao.conflito@barbearia.com', senha: 'senha1234', comissao_pct: 40, servicos: [servico.id],
  }, admin)).corpo.barbeiro;

  const horarios = [];
  for (let d = 1; d <= 5; d++) horarios.push({ dia_semana: d, inicio: '09:00', fim: '18:00' });
  await chamar('PUT', `/api/barbeiros/${barbeiro.id}/horarios`, { horarios }, admin);

  const dataUtil = '2025-01-15';
  const inicio = `${dataUtil}T10:00:00`;

  // Primeiro agendamento
  await chamar('POST', '/api/agendamentos-publico', {
    nome: 'Cliente 1', telefone: '(11) 99999-1111', barbeiro_id: barbeiro.id, servico_id: servico.id, inicio
  });

  // Segundo no mesmo horário deve falhar
  const res = await chamar('POST', '/api/agendamentos-publico', {
    nome: 'Cliente 2', telefone: '(11) 99999-2222', barbeiro_id: barbeiro.id, servico_id: servico.id, inicio
  });
  assert.equal(res.status, 409);
  assert.ok(res.corpo.erro.includes('conflito'));
});

test('agendamento publico: cancelamento so ate 2h antes', async () => {
  const admin = await loginAdmin();
  const servico = (await chamar('POST', '/api/servicos', { nome: 'Corte Cancel', duracao_min: 30, preco_centavos: 4000 }, admin)).corpo.servico;
  const barbeiro = (await chamar('POST', '/api/barbeiros', {
    nome: 'João Cancel', email: 'joao.cancel@barbearia.com', senha: 'senha1234', comissao_pct: 40, servicos: [servico.id],
  }, admin)).corpo.barbeiro;

  const horarios = [];
  for (let d = 1; d <= 5; d++) horarios.push({ dia_semana: d, inicio: '09:00', fim: '18:00' });
  await chamar('PUT', `/api/barbeiros/${barbeiro.id}/horarios`, { horarios }, admin);

  const dataUtil = '2025-01-15';
  const inicio = `${dataUtil}T10:00:00`;

  const ag = await chamar('POST', '/api/agendamentos-publico', {
    nome: 'Cliente Cancel', telefone: '(11) 99999-3333', barbeiro_id: barbeiro.id, servico_id: servico.id, inicio
  });
  const agendamentoId = ag.corpo.agendamento.id;
  const codigo = ag.corpo.codigo_cancelamento;

  // Tenta cancelar "agora" (data do teste é no passado, mas a regra de 2h usa Date.now())
  // Como a data do agendamento é 2025-01-15 (passado), o cancelamento deve falhar por ser < 2h
  // Para testar corretamente, usamos uma data futura
  const futuro = new Date();
  futuro.setDate(futuro.getDate() + 2); // daqui 2 dias
  const dataFutura = futuro.toISOString().split('T')[0];
  const inicioFuturo = `${dataFutura}T14:00:00`;

  const ag2 = await chamar('POST', '/api/agendamentos-publico', {
    nome: 'Cliente Futuro', telefone: '(11) 99999-4444', barbeiro_id: barbeiro.id, servico_id: servico.id, inicio: inicioFuturo
  });
  const agendamentoId2 = ag2.corpo.agendamento.id;
  const codigo2 = ag2.corpo.codigo_cancelamento;

  // Cancela com mais de 2h de antecedência - deve funcionar
  const cancelar = await chamar('POST', `/api/agendamentos/${agendamentoId2}/cancelar-publico`, { codigo: codigo2 });
  assert.equal(cancelar.status, 200);
});