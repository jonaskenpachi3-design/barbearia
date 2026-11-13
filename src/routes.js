'use strict';
const { Roteador, ErroHttp } = require('./http');
const { transacao } = require('./db');
const { hashSenha, conferirSenha } = require('./senha');
const auth = require('./auth');
const v = require('./validar');

// Hash válido, mas de senha desconhecida: gasta o mesmo tempo quando o e-mail não existe.
const HASH_FALSO = `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`;

const ehDuplicado = (erro) => /UNIQUE constraint failed/i.test(String(erro && erro.message));
const publico = (u) => ({ id: u.id, nome: u.nome, email: u.email, telefone: u.telefone, papel: u.papel });

function servicoParaJson(s) {
  return { id: s.id, nome: s.nome, categoria: s.categoria, duracao_min: s.duracao_min, preco_centavos: s.preco_centavos, ativo: !!s.ativo };
}

// Carrega barbeiros com serviços e horários. `admin` inclui e-mail, telefone e comissão.
function carregarBarbeiros(db, { admin = false, id = null } = {}) {
  const linhas = db.prepare(`
    SELECT b.id, b.comissao_pct, b.ativo, u.nome, u.email, u.telefone
      FROM barbeiros b JOIN usuarios u ON u.id = b.usuario_id
     ${id ? 'WHERE b.id = ?' : ''}
     ORDER BY u.nome COLLATE NOCASE
  `).all(...(id ? [id] : []));

  const servicos = new Map();
  for (const r of db.prepare('SELECT barbeiro_id, servico_id FROM barbeiro_servicos ORDER BY servico_id').all()) {
    if (!servicos.has(r.barbeiro_id)) servicos.set(r.barbeiro_id, []);
    servicos.get(r.barbeiro_id).push(r.servico_id);
  }
  const horarios = new Map();
  for (const r of db.prepare(
    'SELECT barbeiro_id, dia_semana, inicio, fim FROM horarios_trabalho ORDER BY dia_semana, inicio'
  ).all()) {
    if (!horarios.has(r.barbeiro_id)) horarios.set(r.barbeiro_id, []);
    horarios.get(r.barbeiro_id).push({ dia_semana: r.dia_semana, inicio: r.inicio, fim: r.fim });
  }

  return linhas
    .filter((b) => admin || b.ativo)
    .map((b) => {
      const base = {
        id: b.id,
        nome: b.nome,
        ativo: !!b.ativo,
        servicos: servicos.get(b.id) || [],
        horarios: horarios.get(b.id) || [],
      };
      return admin
        ? { ...base, email: b.email, telefone: b.telefone, comissao_pct: b.comissao_pct }
        : base;
    });
}

function exigirServicosExistentes(db, ids) {
  if (!ids.length) return;
  const marcas = ids.map(() => '?').join(',');
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM servicos WHERE id IN (${marcas})`).get(...ids);
  if (total !== ids.length) throw new ErroHttp(400, 'Algum serviço informado não existe.');
}

function definirServicos(db, barbeiroId, ids) {
  db.prepare('DELETE FROM barbeiro_servicos WHERE barbeiro_id = ?').run(barbeiroId);
  const inserir = db.prepare('INSERT INTO barbeiro_servicos (barbeiro_id, servico_id) VALUES (?, ?)');
  for (const id of ids) inserir.run(barbeiroId, id);
}

// ───────────────────────── Fase 2: Agendamentos ─────────────────────────

// Converte HH:MM para minutos desde meia-noite
function hhmmParaMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Converte minutos para HH:MM
function minParaHhmm(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Gera slots de 15 min entre inicio e fim (exclusive fim)
function gerarSlots(inicioMin, fimMin, passo = 15) {
  const slots = [];
  for (let m = inicioMin; m + passo <= fimMin; m += passo) {
    slots.push(minParaHhmm(m));
  }
  return slots;
}

// Verifica se um intervalo [ini, fim) colide com outro [a, b)
function colide(ini, fim, a, b) {
  return ini < b && fim > a;
}

// Calcula horários livres para um barbeiro numa data, dado um serviço
function calcularHorariosLivres(db, barbeiroId, dataISO, servicoId) {
  const servico = db.prepare('SELECT duracao_min FROM servicos WHERE id = ? AND ativo = 1').get(servicoId);
  if (!servico) return { slots: [], servico: null };

  const duracao = servico.duracao_min;
  const passo = 15; // granularidade base

  // 1. Jornada do barbeiro nesse dia da semana
  const diaSemana = new Date(dataISO + 'T00:00:00').getDay(); // 0=dom
  const jornada = db.prepare(
    'SELECT inicio, fim FROM horarios_trabalho WHERE barbeiro_id = ? AND dia_semana = ? ORDER BY inicio'
  ).all(barbeiroId, diaSemana);

  if (!jornada.length) return { slots: [], servico: { id: servicoId, duracao_min: duracao } };

  // 2. Agendamentos confirmados/pendentes do barbeiro nessa data
  const iniDia = dataISO + 'T00:00:00';
  const fimDia = dataISO + 'T23:59:59';
  const agendamentos = db.prepare(`
    SELECT inicio, fim FROM agendamentos
    WHERE barbeiro_id = ? AND status IN ('pendente','confirmado')
      AND inicio < ? AND fim > ?
  `).all(barbeiroId, fimDia, iniDia);

  // 3. Bloqueios (do barbeiro específico + globais)
  const bloqueios = db.prepare(`
    SELECT inicio, fim FROM bloqueios
    WHERE (barbeiro_id = ? OR barbeiro_id IS NULL)
      AND inicio < ? AND fim > ?
  `).all(barbeiroId, fimDia, iniDia);

  // 4. Para cada turno da jornada, gerar slots e filtrar os ocupados
  const todosSlots = [];
  for (const t of jornada) {
    const iniMin = hhmmParaMin(t.inicio);
    const fimMin = hhmmParaMin(t.fim);
    const slotsTurno = gerarSlots(iniMin, fimMin, passo);

    for (const slotHora of slotsTurno) {
      const slotIni = new Date(`${dataISO}T${slotHora}:00`);
      const slotFim = new Date(slotIni.getTime() + duracao * 60000);
      const slotFimStr = slotFim.toISOString().slice(0, 19).replace('T', 'T');

      // Verifica colisão com agendamentos
      let ocupado = false;
      for (const a of agendamentos) {
        const aIni = new Date(a.inicio);
        const aFim = new Date(a.fim);
        if (colide(slotIni, slotFim, aIni, aFim)) { ocupado = true; break; }
      }
      // Verifica colisão com bloqueios
      if (!ocupado) {
        for (const b of bloqueios) {
          const bIni = new Date(b.inicio);
          const bFim = new Date(b.fim);
          if (colide(slotIni, slotFim, bIni, bFim)) { ocupado = true; break; }
        }
      }
      if (!ocupado) todosSlots.push(slotHora);
    }
  }

  return {
    slots: todosSlots,
    servico: { id: servicoId, duracao_min: duracao, passo }
  };
}

function agendamentoParaJson(a, incluirRelacoes = false) {
  const base = {
    id: a.id,
    cliente_id: a.cliente_id,
    barbeiro_id: a.barbeiro_id,
    servico_id: a.servico_id,
    inicio: a.inicio,
    fim: a.fim,
    status: a.status,
    criado_em: a.criado_em,
    atualizado_em: a.atualizado_em,
  };
  if (!incluirRelacoes) return base;
  return {
    ...base,
    cliente: a.cliente_nome ? { id: a.cliente_id, nome: a.cliente_nome } : undefined,
    barbeiro: a.barbeiro_nome ? { id: a.barbeiro_id, nome: a.barbeiro_nome } : undefined,
    servico: a.servico_nome ? { id: a.servico_id, nome: a.servico_nome, duracao_min: a.servico_duracao, preco_centavos: a.servico_preco } : undefined,
  };
}

/**
 * Verifica se o cliente tem uma assinatura ativa com o benefício especificado.
 * @param {Object} db - Database connection
 * @param {number} clienteId - ID do cliente
 * @param {string} beneficio - Nome do benefício a verificar (ex: 'agendamento_prioritario', 'desconto_servicos', 'produtos_inclusos')
 * @returns {Object|null} Retorna a assinatura com plano se tiver o benefício, null caso contrário
 */
function verificarBeneficioPlano(db, clienteId, beneficio) {
  const assinatura = db.prepare(`
    SELECT a.*, p.beneficios as plano_beneficios
    FROM assinaturas a
    JOIN planos p ON p.id = a.plano_id
    WHERE a.cliente_id = ? AND a.status IN ('ativa', 'pendente')
    ORDER BY a.criado_em DESC LIMIT 1
  `).get(clienteId);

  if (!assinatura) return null;

  const beneficios = assinatura.plano_beneficios ? JSON.parse(assinatura.plano_beneficios) : [];
  if (!beneficios.includes(beneficio)) return null;

  return assinatura;
}

/**
 * Obtém o desconto percentual do plano do cliente (se houver benefício 'desconto_servicos' ou 'desconto_produtos')
 * @param {Object} db - Database connection
 * @param {number} clienteId - ID do cliente
 * @param {string} tipo - 'servicos' ou 'produtos'
 * @returns {number} Percentual de desconto (0-100), 0 se não tiver benefício
 */
function obterDescontoPlano(db, clienteId, tipo) {
  const assinatura = db.prepare(`
    SELECT a.*, p.beneficios as plano_beneficios
    FROM assinaturas a
    JOIN planos p ON p.id = a.plano_id
    WHERE a.cliente_id = ? AND a.status IN ('ativa', 'pendente')
    ORDER BY a.criado_em DESC LIMIT 1
  `).get(clienteId);

  if (!assinatura) return 0;

  const beneficios = assinatura.plano_beneficios ? JSON.parse(assinatura.plano_beneficios) : [];
  const beneficioChave = tipo === 'servicos' ? 'desconto_servicos' : 'desconto_produtos';

  if (!beneficios.includes(beneficioChave)) return 0;

  // O benefício pode ser um objeto com percentual: { desconto_servicos: { percentual: 20 } }
  // ou apenas string 'desconto_servicos' (assume 10% padrão)
  const beneficioObj = typeof assinatura.plano_beneficios === 'string'
    ? JSON.parse(assinatura.plano_beneficios).find(b => typeof b === 'object' && b[beneficioChave])
    : null;

  if (beneficioObj && beneficioObj[beneficioChave] && typeof beneficioObj[beneficioChave].percentual === 'number') {
    return Math.min(100, Math.max(0, beneficioObj[beneficioChave].percentual));
  }

  // Desconto padrão de 10% se o benefício existir mas não tiver percentual definido
  return 10;
}

function criarRotas(db, { limitador = new auth.LimitadorLogin() } = {}) {
  const r = new Roteador();
  const soAdmin = auth.exigirPapel('admin');
  const soBarbeiro = auth.exigirPapel('barbeiro');
  const soCliente = auth.exigirPapel('cliente');

  // ───────────────────────── Autenticação ─────────────────────────

  r.post('/api/auth/cadastro', async (ctx) => {
    const nome = v.texto(ctx.body.nome, 'o nome', { min: 2, max: 80 });
    const email = v.email(ctx.body.email);
    const telefone = v.telefone(ctx.body.telefone);
    const senha = v.senha(ctx.body.senha);
    const senhaHash = await hashSenha(senha);
    let id;
    try {
      id = db.prepare(
        "INSERT INTO usuarios (nome, email, telefone, senha_hash, papel) VALUES (?, ?, ?, ?, 'cliente')"
      ).run(nome, email, telefone, senhaHash).lastInsertRowid;
    } catch (erro) {
      if (ehDuplicado(erro)) throw new ErroHttp(409, 'Este e-mail já está cadastrado.');
      throw erro;
    }
    // Sync com clientes_simples (apenas se telefone fornecido)
    if (telefone) {
      db.prepare('INSERT OR REPLACE INTO clientes_simples (nome, telefone) VALUES (?, ?)').run(nome, telefone);
    }
    ctx.res.setHeader('Set-Cookie', auth.cookieSessao(auth.criarSessao(db, Number(id))));
    ctx.status = 201;
    return { usuario: { id: Number(id), nome, email, telefone, papel: 'cliente' } };
  });

  r.post('/api/auth/login', async (ctx) => {
    const email = String(ctx.body.email || '').trim().toLowerCase();
    const senha = typeof ctx.body.senha === 'string' ? ctx.body.senha : '';
    const chave = `${ctx.ip}|${email}`;
    limitador.verificar(chave);

    const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
    const confere = await conferirSenha(senha, usuario ? usuario.senha_hash : HASH_FALSO);
    if (!usuario || !confere) {
      limitador.registrarFalha(chave);
      throw new ErroHttp(401, 'E-mail ou senha incorretos.');
    }
    if (!usuario.ativo) throw new ErroHttp(403, 'Esta conta está desativada.');

    limitador.limpar(chave);
    ctx.res.setHeader('Set-Cookie', auth.cookieSessao(auth.criarSessao(db, usuario.id)));
    return { usuario: publico(usuario) };
  });

  r.post('/api/auth/logout', (ctx) => {
    auth.encerrarSessao(db, ctx.token);
    ctx.res.setHeader('Set-Cookie', auth.cookieLimpo());
    return { ok: true };
  });

  r.get('/api/auth/me', auth.exigirLogin, (ctx) => {
    ctx.res.setHeader('Cache-Control', 'no-store');
    return { usuario: ctx.usuario };
  });

  // ───────────────────────── Serviços ─────────────────────────

  r.get('/api/servicos', (ctx) => {
    const admin = ctx.usuario && ctx.usuario.papel === 'admin';
    const orderBy = admin ? 'categoria, nome COLLATE NOCASE' : "categoria, preco_centavos DESC";
    const linhas = db.prepare(
      `SELECT * FROM servicos ${admin ? '' : 'WHERE ativo = 1'} ORDER BY ${orderBy}`
    ).all();
    return { servicos: linhas.map(servicoParaJson) };
  });

  r.post('/api/servicos', soAdmin, (ctx) => {
    const nome = v.texto(ctx.body.nome, 'o nome do serviço', { max: 60 });
    const categoria = v.texto(ctx.body.categoria, 'a categoria', { max: 20 }, 'individual');
    const duracao = v.inteiro(ctx.body.duracao_min, 'A duração', { min: 5, max: 480 });
    const preco = v.inteiro(ctx.body.preco_centavos, 'O preço', { min: 0, max: 10_000_000 });
    const ativo = v.booleano(ctx.body.ativo, 'ativo', true);
    const id = db.prepare(
      'INSERT INTO servicos (nome, categoria, duracao_min, preco_centavos, ativo) VALUES (?, ?, ?, ?, ?)'
    ).run(nome, categoria, duracao, preco, ativo ? 1 : 0).lastInsertRowid;
    ctx.status = 201;
    return { servico: servicoParaJson(db.prepare('SELECT * FROM servicos WHERE id = ?').get(id)) };
  });

  r.put('/api/servicos/:id', soAdmin, (ctx) => {
    const id = v.idDaUrl(ctx.params.id);
    const atual = db.prepare('SELECT * FROM servicos WHERE id = ?').get(id);
    if (!atual) throw new ErroHttp(404, 'Serviço não encontrado.');
    const nome = v.texto(ctx.body.nome, 'o nome do serviço', { max: 60 });
    const categoria = ctx.body.categoria !== undefined
      ? v.texto(ctx.body.categoria, 'a categoria', { max: 20 })
      : atual.categoria;
    const duracao = v.inteiro(ctx.body.duracao_min, 'A duração', { min: 5, max: 480 });
    const preco = v.inteiro(ctx.body.preco_centavos, 'O preço', { min: 0, max: 10_000_000 });
    const ativo = v.booleano(ctx.body.ativo, 'ativo', !!atual.ativo);
    db.prepare('UPDATE servicos SET nome = ?, categoria = ?, duracao_min = ?, preco_centavos = ?, ativo = ? WHERE id = ?')
      .run(nome, categoria, duracao, preco, ativo ? 1 : 0, id);
    return { servico: servicoParaJson(db.prepare('SELECT * FROM servicos WHERE id = ?').get(id)) };
  });

  // ───────────────────────── Barbeiros ─────────────────────────

  r.get('/api/barbeiros', (ctx) => {
    const admin = !!ctx.usuario && ctx.usuario.papel === 'admin';
    return { barbeiros: carregarBarbeiros(db, { admin }) };
  });

  r.post('/api/barbeiros', soAdmin, async (ctx) => {
    const nome = v.texto(ctx.body.nome, 'o nome', { min: 2, max: 80 });
    const email = v.email(ctx.body.email);
    const telefone = v.telefone(ctx.body.telefone);
    const senha = v.senha(ctx.body.senha);
    const comissao = v.inteiro(ctx.body.comissao_pct ?? 40, 'A comissão', { min: 0, max: 100 });
    const servicos = v.listaDeIds(ctx.body.servicos, 'Serviços');
    exigirServicosExistentes(db, servicos);
    const senhaHash = await hashSenha(senha);

    let barbeiroId;
    try {
      barbeiroId = transacao(db, () => {
        const usuarioId = db.prepare(
          "INSERT INTO usuarios (nome, email, telefone, senha_hash, papel) VALUES (?, ?, ?, ?, 'barbeiro')"
        ).run(nome, email, telefone, senhaHash).lastInsertRowid;
        const id = db.prepare('INSERT INTO barbeiros (usuario_id, comissao_pct) VALUES (?, ?)')
          .run(usuarioId, comissao).lastInsertRowid;
        definirServicos(db, id, servicos);
        return Number(id);
      });
    } catch (erro) {
      if (ehDuplicado(erro)) throw new ErroHttp(409, 'Este e-mail já está cadastrado.');
      throw erro;
    }
    ctx.status = 201;
    return { barbeiro: carregarBarbeiros(db, { admin: true, id: barbeiroId })[0] };
  });

  r.put('/api/barbeiros/:id', soAdmin, (ctx) => {
    const id = v.idDaUrl(ctx.params.id);
    const atual = db.prepare('SELECT * FROM barbeiros WHERE id = ?').get(id);
    if (!atual) throw new ErroHttp(404, 'Barbeiro não encontrado.');
    const nome = v.texto(ctx.body.nome, 'o nome', { min: 2, max: 80 });
    const telefone = v.telefone(ctx.body.telefone);
    const comissao = v.inteiro(ctx.body.comissao_pct, 'A comissão', { min: 0, max: 100 });
    const ativo = v.booleano(ctx.body.ativo, 'ativo', !!atual.ativo);
    const servicos = v.listaDeIds(ctx.body.servicos, 'Serviços');
    exigirServicosExistentes(db, servicos);

    transacao(db, () => {
      db.prepare('UPDATE usuarios SET nome = ?, telefone = ?, ativo = ? WHERE id = ?')
        .run(nome, telefone, ativo ? 1 : 0, atual.usuario_id);
      db.prepare('UPDATE barbeiros SET comissao_pct = ?, ativo = ? WHERE id = ?')
        .run(comissao, ativo ? 1 : 0, id);
      definirServicos(db, id, servicos);
      if (!ativo) db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(atual.usuario_id);
    });
    return { barbeiro: carregarBarbeiros(db, { admin: true, id })[0] };
  });

  r.put('/api/barbeiros/:id/horarios', soAdmin, (ctx) => {
    const id = v.idDaUrl(ctx.params.id);
    if (!db.prepare('SELECT id FROM barbeiros WHERE id = ?').get(id)) {
      throw new ErroHttp(404, 'Barbeiro não encontrado.');
    }
    const itens = v.jornada(ctx.body.horarios);
    transacao(db, () => {
      db.prepare('DELETE FROM horarios_trabalho WHERE barbeiro_id = ?').run(id);
      const inserir = db.prepare(
        'INSERT INTO horarios_trabalho (barbeiro_id, dia_semana, inicio, fim) VALUES (?, ?, ?, ?)'
      );
      for (const h of itens) inserir.run(id, h.dia_semana, h.inicio, h.fim);
    });
    return { barbeiro: carregarBarbeiros(db, { admin: true, id })[0] };
  });

  r.get('/api/meu-barbeiro', soBarbeiro, (ctx) => {
    const b = db.prepare('SELECT id FROM barbeiros WHERE usuario_id = ?').get(ctx.usuario.id);
    if (!b) throw new ErroHttp(404, 'Cadastro de barbeiro não encontrado.');
    return { barbeiro: carregarBarbeiros(db, { admin: true, id: b.id })[0] };
  });

  // ───────────────────────── Fase 2: Horários Livres ─────────────────────────

  r.get('/api/horarios-livres', (ctx) => {
    const barbeiroId = v.inteiro(ctx.query.barbeiro, 'ID do barbeiro', { min: 1 });
    const data = v.dataISO(ctx.query.data, 'A data');
    const servicoId = v.inteiro(ctx.query.servico, 'ID do serviço', { min: 1 });

    if (!db.prepare('SELECT id FROM barbeiros WHERE id = ? AND ativo = 1').get(barbeiroId)) {
      throw new ErroHttp(404, 'Barbeiro não encontrado ou inativo.');
    }
    if (!db.prepare('SELECT id FROM servicos WHERE id = ? AND ativo = 1').get(servicoId)) {
      throw new ErroHttp(404, 'Serviço não encontrado ou inativo.');
    }

    const resultado = calcularHorariosLivres(db, barbeiroId, data, servicoId);
    return {
      data,
      barbeiro_id: barbeiroId,
      servico_id: servicoId,
      servico: resultado.servico,
      slots: resultado.slots
    };
  });

  // ───────────────────────── Fase 2: Agendamentos ─────────────────────────

  r.post('/api/agendamentos', soCliente, (ctx) => {
    const barbeiroId = v.inteiro(ctx.body.barbeiro_id, 'O barbeiro', { min: 1 });
    const servicoId = v.inteiro(ctx.body.servico_id, 'O serviço', { min: 1 });
    const inicio = v.dataHoraISO(ctx.body.inicio, 'O início');

    // Verifica barbeiro ativo
    const barbeiro = db.prepare('SELECT id FROM barbeiros WHERE id = ? AND ativo = 1').get(barbeiroId);
    if (!barbeiro) throw new ErroHttp(404, 'Barbeiro não encontrado ou inativo.');

    // Verifica serviço ativo
    const servico = db.prepare('SELECT duracao_min FROM servicos WHERE id = ? AND ativo = 1').get(servicoId);
    if (!servico) throw new ErroHttp(404, 'Serviço não encontrado ou inativo.');

    // Verifica se barbeiro atende esse serviço
    const atende = db.prepare(
      'SELECT 1 FROM barbeiro_servicos WHERE barbeiro_id = ? AND servico_id = ?'
    ).get(barbeiroId, servicoId);
    if (!atende) throw new ErroHttp(400, 'Este barbeiro não realiza esse serviço.');

    const fim = new Date(inicio);
    fim.setMinutes(fim.getMinutes() + servico.duracao_min);
    // Formatar como ISO local (YYYY-MM-DDTHH:MM:SS) sem conversão de fuso
    const fimISO = `${fim.getFullYear()}-${String(fim.getMonth()+1).padStart(2,'0')}-${String(fim.getDate()).padStart(2,'0')}T${String(fim.getHours()).padStart(2,'0')}:${String(fim.getMinutes()).padStart(2,'0')}:${String(fim.getSeconds()).padStart(2,'0')}`;

    // Valida se está dentro da jornada
    const diaSemana = new Date(inicio).getDay();
    const jornada = db.prepare(
      'SELECT inicio, fim FROM horarios_trabalho WHERE barbeiro_id = ? AND dia_semana = ?'
    ).all(barbeiroId, diaSemana);

    const iniMin = hhmmParaMin(inicio.slice(11, 16));
    const fimMin = hhmmParaMin(fimISO.slice(11, 16));
    const dentroJornada = jornada.some(t =>
      hhmmParaMin(t.inicio) <= iniMin && fimMin <= hhmmParaMin(t.fim)
    );
    if (!dentroJornada) throw new ErroHttp(400, 'Horário fora da jornada do barbeiro.');

    // Verifica benefício do plano: agendamento_prioritario
    const temPrioridade = verificarBeneficioPlano(db, ctx.usuario.id, 'agendamento_prioritario');

    // Verifica conflitos com agendamentos existentes
    const conflito = db.prepare(`
      SELECT 1 FROM agendamentos
      WHERE barbeiro_id = ? AND status IN ('pendente','confirmado')
        AND inicio < ? AND fim > ?
    `).get(barbeiroId, fimISO, inicio);
    if (conflito && !temPrioridade) throw new ErroHttp(409, 'Horário não disponível (conflito com outro agendamento).');

    // Verifica bloqueios (admin bloqueios sempre valem, mesmo com prioridade)
    const bloqueio = db.prepare(`
      SELECT 1 FROM bloqueios
      WHERE (barbeiro_id = ? OR barbeiro_id IS NULL)
        AND inicio < ? AND fim > ?
    `).get(barbeiroId, fimISO, inicio);
    if (bloqueio) throw new ErroHttp(409, 'Horário bloqueado pelo administrador.');

    const id = transacao(db, () => {
      return db.prepare(`
        INSERT INTO agendamentos (cliente_id, barbeiro_id, servico_id, inicio, fim, status)
        VALUES (?, ?, ?, ?, ?, 'pendente')
      `).run(ctx.usuario.id, barbeiroId, servicoId, inicio, fimISO).lastInsertRowid;
    });

    ctx.status = 201;
    const agend = db.prepare(`
      SELECT a.*, s.nome as servico_nome, s.duracao_min as servico_duracao, s.preco_centavos as servico_preco,
             u.nome as barbeiro_nome
      FROM agendamentos a
      JOIN servicos s ON s.id = a.servico_id
      JOIN barbeiros b ON b.id = a.barbeiro_id
      JOIN usuarios u ON u.id = b.usuario_id
      WHERE a.id = ?
    `).get(id);
    return { agendamento: agendamentoParaJson(agend, true) };
  });

  // ───────────────────────── Fase 4: Agendamento Público (nome + telefone) ─────────────────────────

  // POST /api/agendamentos-publico — Cliente agenda só com nome + telefone (sem login)
  r.post('/api/agendamentos-publico', async (ctx) => {
    const { nome, telefone, barbeiro_id, servico_id, inicio } = v.agendamentoPublicoDados(ctx.body);

    // Verifica barbeiro ativo
    const barbeiro = db.prepare('SELECT id FROM barbeiros WHERE id = ? AND ativo = 1').get(barbeiro_id);
    if (!barbeiro) throw new ErroHttp(404, 'Barbeiro não encontrado ou inativo.');

    // Verifica serviço ativo
    const servico = db.prepare('SELECT duracao_min FROM servicos WHERE id = ? AND ativo = 1').get(servico_id);
    if (!servico) throw new ErroHttp(404, 'Serviço não encontrado ou inativo.');

    // Verifica se barbeiro atende esse serviço
    const atende = db.prepare(
      'SELECT 1 FROM barbeiro_servicos WHERE barbeiro_id = ? AND servico_id = ?'
    ).get(barbeiro_id, servico_id);
    if (!atende) throw new ErroHttp(400, 'Este barbeiro não realiza esse serviço.');

    const fim = new Date(inicio);
    fim.setMinutes(fim.getMinutes() + servico.duracao_min);
    const fimISO = `${fim.getFullYear()}-${String(fim.getMonth()+1).padStart(2,'0')}-${String(fim.getDate()).padStart(2,'0')}T${String(fim.getHours()).padStart(2,'0')}:${String(fim.getMinutes()).padStart(2,'0')}:${String(fim.getSeconds()).padStart(2,'0')}`;

    // Valida se está dentro da jornada
    const diaSemana = new Date(inicio).getDay();
    const jornada = db.prepare(
      'SELECT inicio, fim FROM horarios_trabalho WHERE barbeiro_id = ? AND dia_semana = ?'
    ).all(barbeiro_id, diaSemana);

    const iniMin = hhmmParaMin(inicio.slice(11, 16));
    const fimMin = hhmmParaMin(fimISO.slice(11, 16));
    const dentroJornada = jornada.some(t =>
      hhmmParaMin(t.inicio) <= iniMin && fimMin <= hhmmParaMin(t.fim)
    );
    if (!dentroJornada) throw new ErroHttp(400, 'Horário fora da jornada do barbeiro.');

    // Busca ou cria usuário cliente (para integridade com FK agendamentos.cliente_id -> usuarios)
    let usuario = db.prepare('SELECT id FROM usuarios WHERE telefone = ? AND papel = \'cliente\'').get(telefone);
    if (!usuario) {
      // Senha dummy (não usada para login público) e email dummy único
      const dummyHash = await hashSenha('publico_' + Date.now() + Math.random());
      const dummyEmail = `publico_${telefone.replace(/\D/g, '')}_${Date.now()}@barbearia.local`;
      const result = db.prepare('INSERT INTO usuarios (nome, email, telefone, senha_hash, papel) VALUES (?, ?, ?, ?, \'cliente\')').run(nome, dummyEmail, telefone, dummyHash);
      usuario = { id: result.lastInsertRowid };
    }

    // Verifica benefício do plano: agendamento_prioritario (se o usuário já tem conta)
    const temPrioridade = verificarBeneficioPlano(db, usuario.id, 'agendamento_prioritario');

    // Verifica conflitos
    const conflito = db.prepare(`
      SELECT 1 FROM agendamentos
      WHERE barbeiro_id = ? AND status IN ('pendente','confirmado')
        AND inicio < ? AND fim > ?
    `).get(barbeiro_id, fimISO, inicio);
    if (conflito && !temPrioridade) throw new ErroHttp(409, 'Horário não disponível (conflito com outro agendamento).');

    // Verifica bloqueios (admin bloqueios sempre valem, mesmo com prioridade)
    const bloqueio = db.prepare(`
      SELECT 1 FROM bloqueios
      WHERE (barbeiro_id = ? OR barbeiro_id IS NULL)
        AND inicio < ? AND fim > ?
    `).get(barbeiro_id, fimISO, inicio);
    if (bloqueio) throw new ErroHttp(409, 'Horário bloqueado pelo administrador.');

    // Também registra/atualiza em clientes_simples para busca por telefone (sync)
    if (telefone) {
      db.prepare('INSERT OR REPLACE INTO clientes_simples (nome, telefone) VALUES (?, ?)').run(nome, telefone);
    }

    // Gera código de cancelamento (6 dígitos)
    const codigoCancelamento = String(Math.floor(100000 + Math.random() * 900000));

    const id = transacao(db, () => {
      return db.prepare(`
        INSERT INTO agendamentos (cliente_id, barbeiro_id, servico_id, inicio, fim, status, codigo_cancelamento)
        VALUES (?, ?, ?, ?, ?, 'pendente', ?)
      `).run(usuario.id, barbeiro_id, servico_id, inicio, fimISO, codigoCancelamento).lastInsertRowid;
    });

    ctx.status = 201;
    const agend = db.prepare(`
      SELECT a.*, s.nome as servico_nome, s.duracao_min as servico_duracao, s.preco_centavos as servico_preco,
             u.nome as barbeiro_nome,
             u2.nome as cliente_nome
      FROM agendamentos a
      JOIN servicos s ON s.id = a.servico_id
      JOIN barbeiros b ON b.id = a.barbeiro_id
      JOIN usuarios u ON u.id = b.usuario_id
      JOIN usuarios u2 ON u2.id = a.cliente_id
      WHERE a.id = ?
    `).get(id);
    return { agendamento: agendamentoParaJson(agend, true), codigo_cancelamento: codigoCancelamento };
  });

  // POST /api/agendamentos/:id/cancelar-publico — Cancelamento público com código
  r.post('/api/agendamentos/:id/cancelar-publico', (ctx) => {
    const id = v.idDaUrl(ctx.params.id);
    const { codigo } = v.cancelamentoPublicoDados(ctx.body);

    const agend = db.prepare('SELECT * FROM agendamentos WHERE id = ?').get(id);
    if (!agend) throw new ErroHttp(404, 'Agendamento não encontrado.');

    if (agend.codigo_cancelamento !== codigo) {
      throw new ErroHttp(403, 'Código de cancelamento inválido.');
    }

    if (agend.status === 'cancelado') {
      throw new ErroHttp(400, 'Agendamento já cancelado.');
    }

    if (agend.status === 'concluido') {
      throw new ErroHttp(400, 'Não é possível cancelar agendamento concluído.');
    }

    // Verifica regra de 2 horas
    const agora = new Date();
    const inicioAgend = new Date(agend.inicio);
    const diffMs = inicioAgend - agora;
    const diffHoras = diffMs / (1000 * 60 * 60);
    if (diffHoras < 2) {
      throw new ErroHttp(400, 'Cancelamento só permitido com 2 horas de antecedência.');
    }

    db.prepare("UPDATE agendamentos SET status = 'cancelado', atualizado_em = datetime('now') WHERE id = ?").run(id);

    return { ok: true, mensagem: 'Agendamento cancelado com sucesso.' };
  });

  r.put('/api/agendamentos/:id/confirmar', auth.exigirPapel('barbeiro', 'admin'), (ctx) => {
    const id = v.idDaUrl(ctx.params.id);
    const agend = db.prepare('SELECT * FROM agendamentos WHERE id = ?').get(id);
    if (!agend) throw new ErroHttp(404, 'Agendamento não encontrado.');

    // Barbeiro só pode confirmar os seus; admin confirma qualquer
    if (ctx.usuario.papel === 'barbeiro') {
      const meuBarbeiro = db.prepare('SELECT id FROM barbeiros WHERE usuario_id = ?').get(ctx.usuario.id);
      if (!meuBarbeiro || meuBarbeiro.id !== agend.barbeiro_id) {
        throw new ErroHttp(403, 'Você só pode confirmar seus próprios agendamentos.');
      }
    }

    if (agend.status !== 'pendente') {
      throw new ErroHttp(400, 'Só é possível confirmar agendamentos pendentes.');
    }

    db.prepare("UPDATE agendamentos SET status = 'confirmado', atualizado_em = datetime('now') WHERE id = ?").run(id);

    const atualizado = db.prepare(`
      SELECT a.*, s.nome as servico_nome, s.duracao_min as servico_duracao, s.preco_centavos as servico_preco,
             u2.nome as barbeiro_nome, u.nome as cliente_nome
      FROM agendamentos a
      JOIN servicos s ON s.id = a.servico_id
      JOIN barbeiros b ON b.id = a.barbeiro_id
      JOIN usuarios u ON u.id = a.cliente_id
      JOIN usuarios u2 ON u2.id = b.usuario_id
      WHERE a.id = ?
    `).get(id);
    return { agendamento: agendamentoParaJson(atualizado, true) };
  });

  r.put('/api/agendamentos/:id/concluir', auth.exigirPapel('barbeiro', 'admin'), (ctx) => {
    const id = v.idDaUrl(ctx.params.id);
    const agend = db.prepare('SELECT * FROM agendamentos WHERE id = ?').get(id);
    if (!agend) throw new ErroHttp(404, 'Agendamento não encontrado.');

    // Barbeiro só pode concluir os seus; admin conclui qualquer
    if (ctx.usuario.papel === 'barbeiro') {
      const meuBarbeiro = db.prepare('SELECT id FROM barbeiros WHERE usuario_id = ?').get(ctx.usuario.id);
      if (!meuBarbeiro || meuBarbeiro.id !== agend.barbeiro_id) {
        throw new ErroHttp(403, 'Você só pode concluir seus próprios agendamentos.');
      }
    }

    if (agend.status !== 'confirmado') {
      throw new ErroHttp(400, 'Só é possível concluir agendamentos confirmados.');
    }

    db.prepare("UPDATE agendamentos SET status = 'concluido', atualizado_em = datetime('now') WHERE id = ?").run(id);

    const atualizado = db.prepare(`
      SELECT a.*, s.nome as servico_nome, s.duracao_min as servico_duracao, s.preco_centavos as servico_preco,
             u2.nome as barbeiro_nome, u.nome as cliente_nome
      FROM agendamentos a
      JOIN servicos s ON s.id = a.servico_id
      JOIN barbeiros b ON b.id = a.barbeiro_id
      JOIN usuarios u ON u.id = a.cliente_id
      JOIN usuarios u2 ON u2.id = b.usuario_id
      WHERE a.id = ?
    `).get(id);
    return { agendamento: agendamentoParaJson(atualizado, true) };
  });

  r.put('/api/agendamentos/:id/cancelar', auth.exigirLogin, (ctx) => {
    const id = v.idDaUrl(ctx.params.id);
    const agend = db.prepare('SELECT * FROM agendamentos WHERE id = ?').get(id);
    if (!agend) throw new ErroHttp(404, 'Agendamento não encontrado.');

    const agora = new Date();
    const inicioAgend = new Date(agend.inicio);
    const diffHoras = (inicioAgend - agora) / (1000 * 60 * 60);

    // Permissões de cancelamento
    const isDono = agend.cliente_id === ctx.usuario.id;
    const isBarbeiro = ctx.usuario.papel === 'barbeiro';
    const isAdmin = ctx.usuario.papel === 'admin';

    if (isDono) {
      // Cliente cancela até 2h antes
      if (diffHoras < 2) throw new ErroHttp(400, 'Cancelamento só permitido até 2 horas antes do horário.');
    } else if (isBarbeiro) {
      // Barbeiro só cancela os seus
      const meuBarbeiro = db.prepare('SELECT id FROM barbeiros WHERE usuario_id = ?').get(ctx.usuario.id);
      if (!meuBarbeiro || meuBarbeiro.id !== agend.barbeiro_id) {
        throw new ErroHttp(403, 'Você só pode cancelar seus próprios agendamentos.');
      }
    } else if (!isAdmin) {
      throw new ErroHttp(403, 'Sem permissão para cancelar este agendamento.');
    }

    if (agend.status === 'cancelado') throw new ErroHttp(400, 'Agendamento já cancelado.');
    if (agend.status === 'concluido') throw new ErroHttp(400, 'Não é possível cancelar agendamento concluído.');

    db.prepare("UPDATE agendamentos SET status = 'cancelado', atualizado_em = datetime('now') WHERE id = ?").run(id);

    const atualizado = db.prepare(`
      SELECT a.*, s.nome as servico_nome, s.duracao_min as servico_duracao, s.preco_centavos as servico_preco,
             u2.nome as barbeiro_nome, u.nome as cliente_nome
      FROM agendamentos a
      JOIN servicos s ON s.id = a.servico_id
      JOIN barbeiros b ON b.id = a.barbeiro_id
      JOIN usuarios u ON u.id = a.cliente_id
      JOIN usuarios u2 ON u2.id = b.usuario_id
      WHERE a.id = ?
    `).get(id);
    return { agendamento: agendamentoParaJson(atualizado, true) };
  });

  // ───────────────────────── Fase 2: Minha Agenda (Cliente) ─────────────────────────

  r.get('/api/minha-agenda', soCliente, (ctx) => {
    // Paginação
    const page = Math.max(1, v.inteiro(ctx.query.page, 'page', { min: 1, max: 10000, opcional: true }) || 1);
    const limit = Math.min(100, Math.max(1, v.inteiro(ctx.query.limit, 'limit', { min: 1, max: 100, opcional: true }) || 50));
    const offset = (page - 1) * limit;

    const whereBase = 'WHERE a.cliente_id = ?';
    const paramsBase = [ctx.usuario.id];

    // Total count
    const totalRow = db.prepare(`SELECT COUNT(*) as total FROM agendamentos a ${whereBase}`).get(...paramsBase);
    const total = totalRow.total;

    const agendamentos = db.prepare(`
      SELECT a.*, s.nome as servico_nome, s.duracao_min as servico_duracao, s.preco_centavos as servico_preco,
             u.nome as barbeiro_nome
      FROM agendamentos a
      JOIN servicos s ON s.id = a.servico_id
      JOIN barbeiros b ON b.id = a.barbeiro_id
      JOIN usuarios u ON u.id = b.usuario_id
      ${whereBase}
      ORDER BY a.inicio DESC
      LIMIT ? OFFSET ?
    `).all(...paramsBase, limit, offset);

    const agora = new Date().toISOString().slice(0, 19).replace('T', 'T');
    const proximos = agendamentos.filter(a => a.inicio >= agora && a.status !== 'cancelado');
    const historico = agendamentos.filter(a => a.inicio < agora || a.status === 'cancelado');

    return {
      proximos: proximos.map(a => agendamentoParaJson(a, true)),
      historico: historico.map(a => agendamentoParaJson(a, true)),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  });

  // ───────────────────────── Fase 2: Agenda do Barbeiro ─────────────────────────

  r.get('/api/agenda-barbeiro', soBarbeiro, (ctx) => {
    const meuBarbeiro = db.prepare('SELECT id FROM barbeiros WHERE usuario_id = ?').get(ctx.usuario.id);
    if (!meuBarbeiro) throw new ErroHttp(404, 'Cadastro de barbeiro não encontrado.');

    const data = ctx.query.data ? v.dataISO(ctx.query.data) : new Date().toISOString().slice(0, 10);
    const status = ctx.query.status; // opcional: pendente, confirmado, cancelado, concluido

    let where = 'WHERE a.barbeiro_id = ? AND date(a.inicio) = date(?)';
    const params = [meuBarbeiro.id, data];

    if (status) {
      const permitidos = ['pendente','confirmado','cancelado','concluido'];
      if (!permitidos.includes(status)) throw new ErroHttp(400, 'Status inválido.');
      where += ' AND a.status = ?';
      params.push(status);
    }

    // Paginação
    const page = Math.max(1, v.inteiro(ctx.query.page, 'page', { min: 1, max: 10000, opcional: true }) || 1);
    const limit = Math.min(100, Math.max(1, v.inteiro(ctx.query.limit, 'limit', { min: 1, max: 100, opcional: true }) || 50));
    const offset = (page - 1) * limit;

    // Total count
    const totalRow = db.prepare(`SELECT COUNT(*) as total FROM agendamentos a ${where}`).get(...params);
    const total = totalRow.total;

    const agendamentos = db.prepare(`
      SELECT a.*, s.nome as servico_nome, s.duracao_min as servico_duracao, s.preco_centavos as servico_preco,
             u.nome as cliente_nome, u.telefone as cliente_telefone
      FROM agendamentos a
      JOIN servicos s ON s.id = a.servico_id
      JOIN usuarios u ON u.id = a.cliente_id
      ${where}
      ORDER BY a.inicio
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    return {
      data,
      agendamentos: agendamentos.map(a => agendamentoParaJson(a, true)),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  });

  // ───────────────────────── Fase 2: Agenda do Admin ─────────────────────────

  r.get('/api/agenda-admin', soAdmin, (ctx) => {
    const data = ctx.query.data ? v.dataISO(ctx.query.data) : new Date().toISOString().slice(0, 10);
    const barbeiroId = ctx.query.barbeiro ? v.inteiro(ctx.query.barbeiro, 'ID do barbeiro', { min: 1 }) : null;
    const status = ctx.query.status;

    let where = 'WHERE date(a.inicio) = date(?)';
    const params = [data];

    if (barbeiroId) {
      where += ' AND a.barbeiro_id = ?';
      params.push(barbeiroId);
    }
    if (status) {
      const permitidos = ['pendente','confirmado','cancelado','concluido'];
      if (!permitidos.includes(status)) throw new ErroHttp(400, 'Status inválido.');
      where += ' AND a.status = ?';
      params.push(status);
    }

    // Paginação
    const page = Math.max(1, v.inteiro(ctx.query.page, 'page', { min: 1, max: 10000, opcional: true }) || 1);
    const limit = Math.min(100, Math.max(1, v.inteiro(ctx.query.limit, 'limit', { min: 1, max: 100, opcional: true }) || 50));
    const offset = (page - 1) * limit;

    // Total count
    const totalRow = db.prepare(`SELECT COUNT(*) as total FROM agendamentos a ${where}`).get(...params);
    const total = totalRow.total;

    const agendamentos = db.prepare(`
      SELECT a.*, s.nome as servico_nome, s.duracao_min as servico_duracao, s.preco_centavos as servico_preco,
             u2.nome as barbeiro_nome, u.nome as cliente_nome, u.telefone as cliente_telefone
      FROM agendamentos a
      JOIN servicos s ON s.id = a.servico_id
      JOIN barbeiros b ON b.id = a.barbeiro_id
      JOIN usuarios u ON u.id = a.cliente_id
      JOIN usuarios u2 ON u2.id = b.usuario_id
      ${where}
      ORDER BY a.inicio
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    return {
      data,
      agendamentos: agendamentos.map(a => agendamentoParaJson(a, true)),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  });

  // ───────────────────────── Fase 2: Bloqueios (Admin) ─────────────────────────

  r.get('/api/bloqueios', soAdmin, (ctx) => {
    const barbeiroId = ctx.query.barbeiro ? v.inteiro(ctx.query.barbeiro, 'ID do barbeiro', { min: 1 }) : null;
    const data = ctx.query.data ? v.dataISO(ctx.query.data) : null;

    let where = 'WHERE 1=1';
    const params = [];
    if (barbeiroId) { where += ' AND (barbeiro_id = ? OR barbeiro_id IS NULL)'; params.push(barbeiroId); }
    if (data) { where += ' AND date(inicio) = date(?)'; params.push(data); }

    // Paginação
    const page = Math.max(1, v.inteiro(ctx.query.page, 'page', { min: 1, max: 10000, opcional: true }) || 1);
    const limit = Math.min(100, Math.max(1, v.inteiro(ctx.query.limit, 'limit', { min: 1, max: 100, opcional: true }) || 50));
    const offset = (page - 1) * limit;

    // Total count
    const totalRow = db.prepare(`SELECT COUNT(*) as total FROM bloqueios ${where}`).get(...params);
    const total = totalRow.total;

    const bloqueios = db.prepare(`
      SELECT b.*, u.nome as criador_nome
      FROM bloqueios b
      JOIN usuarios u ON u.id = b.criado_por
      ${where}
      ORDER BY b.inicio
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    return {
      bloqueios,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  });

  r.post('/api/bloqueios', soAdmin, (ctx) => {
    const dados = v.bloqueioDados(ctx.body);
    const barbeiroId = ctx.body.barbeiro_id ? v.inteiro(ctx.body.barbeiro_id, 'ID do barbeiro', { min: 1 }) : null;

    if (barbeiroId && !db.prepare('SELECT id FROM barbeiros WHERE id = ?').get(barbeiroId)) {
      throw new ErroHttp(404, 'Barbeiro não encontrado.');
    }

    // Verifica se há agendamentos conflitantes
    const conflitos = db.prepare(`
      SELECT 1 FROM agendamentos
      WHERE (barbeiro_id = ? OR ? IS NULL)
        AND status IN ('pendente','confirmado')
        AND inicio < ? AND fim > ?
    `).get(barbeiroId, barbeiroId, dados.fim, dados.inicio);

    if (conflitos) throw new ErroHttp(409, 'Há agendamentos nesse período. Cancele-os antes de bloquear.');

    const id = db.prepare(`
      INSERT INTO bloqueios (barbeiro_id, inicio, fim, motivo, criado_por)
      VALUES (?, ?, ?, ?, ?)
    `).run(barbeiroId, dados.inicio, dados.fim, dados.motivo, ctx.usuario.id).lastInsertRowid;

    ctx.status = 201;
    const bloqueio = db.prepare(`
      SELECT b.*, u.nome as criador_nome
      FROM bloqueios b JOIN usuarios u ON u.id = b.criado_por
      WHERE b.id = ?
    `).get(id);
    return { bloqueio };
  });

  r.delete('/api/bloqueios/:id', soAdmin, (ctx) => {
    const id = v.idDaUrl(ctx.params.id);
    const bloqueio = db.prepare('SELECT * FROM bloqueios WHERE id = ?').get(id);
    if (!bloqueio) throw new ErroHttp(404, 'Bloqueio não encontrado.');

    db.prepare('DELETE FROM bloqueios WHERE id = ?').run(id);
    return { ok: true };
  });

  // ───────────────────────── Fase 3: Produtos ─────────────────────────

  function produtoParaJson(p) {
    return {
      id: p.id,
      sku: p.sku,
      nome: p.nome,
      descricao: p.descricao,
      custo_centavos: p.custo_centavos,
      preco_centavos: p.preco_centavos,
      quantidade: p.quantidade,
      qtd_minima: p.qtd_minima,
      comissao_pct: p.comissao_pct,
      comissao_fixo: p.comissao_fixo,
      ativo: !!p.ativo,
      estoque_baixo: p.quantidade <= p.qtd_minima && p.qtd_minima > 0,
    };
  }

  r.get('/api/produtos', auth.exigirLogin, (ctx) => {
    const admin = ctx.usuario.papel === 'admin';
    const where = admin ? '' : 'WHERE ativo = 1';

    // Paginação
    const page = Math.max(1, v.inteiro(ctx.query.page, 'page', { min: 1, max: 10000, opcional: true }) || 1);
    const limit = Math.min(100, Math.max(1, v.inteiro(ctx.query.limit, 'limit', { min: 1, max: 100, opcional: true }) || 50));
    const offset = (page - 1) * limit;

    // Total count
    const totalRow = db.prepare(`SELECT COUNT(*) as total FROM produtos ${where}`).get();
    const total = totalRow.total;

    const linhas = db.prepare(
      `SELECT * FROM produtos ${where} ORDER BY nome COLLATE NOCASE LIMIT ? OFFSET ?`
    ).all(limit, offset);
    return {
      produtos: linhas.map(produtoParaJson),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  });

  r.get('/api/produtos/baixo-estoque', soAdmin, (ctx) => {
    // Paginação
    const page = Math.max(1, v.inteiro(ctx.query.page, 'page', { min: 1, max: 10000, opcional: true }) || 1);
    const limit = Math.min(100, Math.max(1, v.inteiro(ctx.query.limit, 'limit', { min: 1, max: 100, opcional: true }) || 50));
    const offset = (page - 1) * limit;

    // Total count
    const totalRow = db.prepare(
      'SELECT COUNT(*) as total FROM produtos WHERE ativo = 1 AND qtd_minima > 0 AND quantidade <= qtd_minima'
    ).get();
    const total = totalRow.total;

    const linhas = db.prepare(
      'SELECT * FROM produtos WHERE ativo = 1 AND qtd_minima > 0 AND quantidade <= qtd_minima ORDER BY (quantidade * 1.0 / qtd_minima) ASC LIMIT ? OFFSET ?'
    ).all(limit, offset);
    return {
      produtos: linhas.map(produtoParaJson),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  });

  r.post('/api/produtos', soAdmin, (ctx) => {
    const dados = v.produtoDados(ctx.body);
    // Verifica SKU único
    if (db.prepare('SELECT id FROM produtos WHERE sku = ?').get(dados.sku)) {
      throw new ErroHttp(409, 'SKU já cadastrado.');
    }
    const id = db.prepare(`
      INSERT INTO produtos (sku, nome, descricao, custo_centavos, preco_centavos, quantidade, qtd_minima, comissao_pct, comissao_fixo, ativo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(dados.sku, dados.nome, dados.descricao, dados.custo_centavos, dados.preco_centavos,
           dados.quantidade, dados.qtd_minima, dados.comissao_pct, dados.comissao_fixo, dados.ativo ? 1 : 0).lastInsertRowid;
    ctx.status = 201;
    return { produto: produtoParaJson(db.prepare('SELECT * FROM produtos WHERE id = ?').get(id)) };
  });

  r.put('/api/produtos/:id', soAdmin, (ctx) => {
    const id = v.idDaUrl(ctx.params.id);
    const atual = db.prepare('SELECT * FROM produtos WHERE id = ?').get(id);
    if (!atual) throw new ErroHttp(404, 'Produto não encontrado.');
    const dados = v.produtoDados(ctx.body);
    // Verifica SKU único (exceto o próprio)
    if (dados.sku !== atual.sku && db.prepare('SELECT id FROM produtos WHERE sku = ?').get(dados.sku)) {
      throw new ErroHttp(409, 'SKU já cadastrado.');
    }
    db.prepare(`
      UPDATE produtos SET sku = ?, nome = ?, descricao = ?, custo_centavos = ?, preco_centavos = ?,
        quantidade = ?, qtd_minima = ?, comissao_pct = ?, comissao_fixo = ?, ativo = ?
      WHERE id = ?
    `).run(dados.sku, dados.nome, dados.descricao, dados.custo_centavos, dados.preco_centavos,
           dados.quantidade, dados.qtd_minima, dados.comissao_pct, dados.comissao_fixo, dados.ativo ? 1 : 0, id);
    return { produto: produtoParaJson(db.prepare('SELECT * FROM produtos WHERE id = ?').get(id)) };
  });

  r.post('/api/produtos/:id/entrada', soAdmin, (ctx) => {
    const id = v.idDaUrl(ctx.params.id);
    const produto = db.prepare('SELECT * FROM produtos WHERE id = ?').get(id);
    if (!produto) throw new ErroHttp(404, 'Produto não encontrado.');
    const qtd = v.inteiro(ctx.body.quantidade, 'A quantidade', { min: 1, max: 10000 });
    db.prepare('UPDATE produtos SET quantidade = quantidade + ? WHERE id = ?').run(qtd, id);
    return { produto: produtoParaJson(db.prepare('SELECT * FROM produtos WHERE id = ?').get(id)) };
  });

  // ───────────────────────── Fase 3: Comissão por Serviço ─────────────────────────

  r.get('/api/servicos/:id/comissao', soAdmin, (ctx) => {
    const id = v.idDaUrl(ctx.params.id);
    if (!db.prepare('SELECT id FROM servicos WHERE id = ?').get(id)) throw new ErroHttp(404, 'Serviço não encontrado.');
    const comissao = db.prepare('SELECT * FROM servico_comissao WHERE servico_id = ?').get(id);
    return { servico_id: id, comissao: comissao ? { tipo: comissao.tipo, valor: comissao.valor } : null };
  });

  r.put('/api/servicos/:id/comissao', soAdmin, (ctx) => {
    const id = v.idDaUrl(ctx.params.id);
    if (!db.prepare('SELECT id FROM servicos WHERE id = ?').get(id)) throw new ErroHttp(404, 'Serviço não encontrado.');
    const dados = v.servicoComissaoDados(ctx.body);
    db.prepare(`
      INSERT INTO servico_comissao (servico_id, tipo, valor) VALUES (?, ?, ?)
      ON CONFLICT(servico_id) DO UPDATE SET tipo = excluded.tipo, valor = excluded.valor
    `).run(id, dados.tipo, dados.valor);
    return { servico_id: id, comissao: { tipo: dados.tipo, valor: dados.valor } };
  });

  r.delete('/api/servicos/:id/comissao', soAdmin, (ctx) => {
    const id = v.idDaUrl(ctx.params.id);
    db.prepare('DELETE FROM servico_comissao WHERE servico_id = ?').run(id);
    return { ok: true };
  });

  // ───────────────────────── Fase 3: PDV / Vendas ─────────────────────────

  function calcularComissaoItem(db, barbeiroId, tipo, referenciaId, precoUnitCentavos, quantidade) {
    let comissaoPct = 0;
    let comissaoFixo = 0;

    if (tipo === 'servico') {
      // Verifica regra específica do serviço
      const regra = db.prepare('SELECT tipo, valor FROM servico_comissao WHERE servico_id = ?').get(referenciaId);
      if (regra) {
        if (regra.tipo === 'percentual') {
          comissaoPct = regra.valor; // já em centésimos de % (ex: 4000 = 40%)
        } else {
          comissaoFixo = regra.valor; // em centavos
        }
      } else {
        // Usa comissão padrão do barbeiro
        const b = db.prepare('SELECT comissao_pct FROM barbeiros WHERE id = ?').get(barbeiroId);
        if (b) comissaoPct = b.comissao_pct * 100; // converter % para centésimos (40 -> 4000)
      }
    } else if (tipo === 'produto') {
      // Usa comissão do produto
      const p = db.prepare('SELECT comissao_pct, comissao_fixo FROM produtos WHERE id = ?').get(referenciaId);
      if (p) {
        comissaoPct = p.comissao_pct * 100;
        comissaoFixo = p.comissao_fixo;
      }
    }

    let comissaoCentavos = 0;
    const subtotal = precoUnitCentavos * quantidade;
    if (comissaoFixo > 0) {
      comissaoCentavos = comissaoFixo * quantidade;
    } else if (comissaoPct > 0) {
      comissaoCentavos = Math.round(subtotal * comissaoPct / 10000);
    }
    return comissaoCentavos;
  }

  function vendaParaJson(venda, itens = null) {
    const base = {
      id: venda.id,
      cliente_id: venda.cliente_id,
      barbeiro_id: venda.barbeiro_id,
      caixa_id: venda.caixa_id,
      subtotal_centavos: venda.subtotal_centavos,
      desconto_centavos: venda.desconto_centavos,
      total_centavos: venda.total_centavos,
      forma_pagamento: venda.forma_pagamento,
      dinheiro_recebido: venda.dinheiro_recebido,
      troco_centavos: Math.max(0, venda.dinheiro_recebido - venda.total_centavos),
      status: venda.status,
      observacao: venda.observacao,
      criado_em: venda.criado_em,
    };
    if (itens) {
      return { ...base, itens };
    }
    return base;
  }

  // Obter caixa aberto do dia
  function obterCaixaAberto(db, dataISO = null) {
    const data = dataISO || new Date().toISOString().slice(0, 10);
    return db.prepare('SELECT * FROM caixa WHERE data = ? AND status = \'aberto\'').get(data);
  }

  r.get('/api/caixa/aberto', soAdmin, (ctx) => {
    const caixa = obterCaixaAberto(db);
    return { caixa: caixa || null };
  });

  r.post('/api/caixa/abrir', soAdmin, (ctx) => {
    const hoje = new Date().toISOString().slice(0, 10);
    const existente = db.prepare('SELECT * FROM caixa WHERE data = ?').get(hoje);
    if (existente) throw new ErroHttp(409, 'Caixa já aberto para hoje.');
    const dados = v.caixaAberturaDados(ctx.body);
    const id = db.prepare(`
      INSERT INTO caixa (data, aberto_por, valor_inicial_centavos, observacao_abertura, status)
      VALUES (?, ?, ?, ?, 'aberto')
    `).run(hoje, ctx.usuario.id, dados.valor_inicial_centavos, dados.observacao).lastInsertRowid;
    ctx.status = 201;
    return { caixa: db.prepare('SELECT * FROM caixa WHERE id = ?').get(id) };
  });

  r.post('/api/caixa/:id/sangria', soAdmin, (ctx) => {
    const id = v.idDaUrl(ctx.params.id);
    const caixa = db.prepare('SELECT * FROM caixa WHERE id = ?').get(id);
    if (!caixa) throw new ErroHttp(404, 'Caixa não encontrado.');
    if (caixa.status !== 'aberto') throw new ErroHttp(400, 'Caixa não está aberto.');
    const dados = v.sangriaDados(ctx.body);
    db.prepare('INSERT INTO sangrias (caixa_id, valor_centavos, responsavel_id, motivo) VALUES (?, ?, ?, ?)')
      .run(id, dados.valor_centavos, ctx.usuario.id, dados.motivo);
    db.prepare('UPDATE caixa SET sangrias_centavos = sangrias_centavos + ? WHERE id = ?').run(dados.valor_centavos, id);
    return { ok: true, caixa: db.prepare('SELECT * FROM caixa WHERE id = ?').get(id) };
  });

  r.get('/api/caixa/:id', soAdmin, (ctx) => {
    const id = v.idDaUrl(ctx.params.id);
    const caixa = db.prepare('SELECT * FROM caixa WHERE id = ?').get(id);
    if (!caixa) throw new ErroHttp(404, 'Caixa não encontrado.');
    const sangrias = db.prepare('SELECT s.*, u.nome as responsavel_nome FROM sangrias s JOIN usuarios u ON u.id = s.responsavel_id WHERE s.caixa_id = ? ORDER BY s.criado_em').all(id);
    const vendas = db.prepare(`
      SELECT v.*, u.nome as barbeiro_nome, u2.nome as cliente_nome
      FROM vendas v
      JOIN barbeiros b ON b.id = v.barbeiro_id
      JOIN usuarios u ON u.id = b.usuario_id
      LEFT JOIN usuarios u2 ON u2.id = v.cliente_id
      WHERE v.caixa_id = ? ORDER BY v.criado_em
    `).all(id);
    return { caixa, sangrias, vendas };
  });

  r.put('/api/caixa/:id/fechar', soAdmin, (ctx) => {
    const id = v.idDaUrl(ctx.params.id);
    const caixa = db.prepare('SELECT * FROM caixa WHERE id = ?').get(id);
    if (!caixa) throw new ErroHttp(404, 'Caixa não encontrado.');
    if (caixa.status !== 'aberto') throw new ErroHttp(400, 'Caixa já fechado.');
    const dados = v.caixaFechamentoDados(ctx.body);

    // Calcula totais reais das vendas
    const totais = db.prepare(`
      SELECT
        SUM(CASE WHEN forma_pagamento = 'dinheiro' THEN total_centavos ELSE 0 END) as dinheiro,
        SUM(CASE WHEN forma_pagamento = 'cartao' THEN total_centavos ELSE 0 END) as cartao,
        SUM(CASE WHEN forma_pagamento = 'pix' THEN total_centavos ELSE 0 END) as pix,
        SUM(CASE WHEN forma_pagamento = 'misto' THEN total_centavos ELSE 0 END) as misto
      FROM vendas WHERE caixa_id = ? AND status = 'concluida'
    `).get(id);

    const totalDinheiro = (totais.dinheiro || 0) + (totais.misto || 0); // simplificação: misto conta como dinheiro no fechamento
    const totalCartao = totais.cartao || 0;
    const totalPix = totais.pix || 0;
    const totalVendas = totalDinheiro + totalCartao + totalPix;
    const esperado = caixa.valor_inicial_centavos + totalVendas - caixa.sangrias_centavos;
    const diferenca = dados.valor_final_centavos - esperado;

    db.prepare(`
      UPDATE caixa SET
        fechado_por = ?, valor_final_centavos = ?, total_dinheiro_centavos = ?, total_cartao_centavos = ?,
        total_pix_centavos = ?, total_misto_centavos = ?, observacao_fechamento = ?,
        status = 'fechado', fechado_em = datetime('now')
      WHERE id = ?
    `).run(ctx.usuario.id, dados.valor_final_centavos, totalDinheiro, totalCartao, totalPix, (totais.misto || 0), dados.observacao, id);

    return { caixa: db.prepare('SELECT * FROM caixa WHERE id = ?').get(id), esperado, diferenca };
  });

  r.get('/api/caixa/historico', soAdmin, (ctx) => {
    const data = ctx.query.data ? v.dataISO(ctx.query.data) : null;
    let where = 'WHERE 1=1';
    const params = [];
    if (data) { where += ' AND data = ?'; params.push(data); }
    const caixas = db.prepare(`
      SELECT c.*, u1.nome as aberto_por_nome, u2.nome as fechado_por_nome
      FROM caixa c
      JOIN usuarios u1 ON u1.id = c.aberto_por
      LEFT JOIN usuarios u2 ON u2.id = c.fechado_por
      ${where}
      ORDER BY c.data DESC
    `).all(...params);
    return { caixas };
  });

  // Vendas
  r.post('/api/vendas', auth.exigirPapel('barbeiro', 'admin'), (ctx) => {
    // Idempotency-Key header (opcional, evita duplicação de clique duplo)
    const idempotencyKey = ctx.req.headers['idempotency-key'] || ctx.req.headers['idempotency_key'];
    if (idempotencyKey) {
      const existente = db.prepare('SELECT venda_id FROM venda_idempotencia WHERE chave = ?').get(idempotencyKey);
      if (existente) {
        // Retorna a venda já criada
        const venda = db.prepare(`
          SELECT v.*, u.nome as barbeiro_nome, u2.nome as cliente_nome
          FROM vendas v
          JOIN barbeiros b ON b.id = v.barbeiro_id
          JOIN usuarios u ON u.id = b.usuario_id
          LEFT JOIN usuarios u2 ON u2.id = v.cliente_id
          WHERE v.id = ?
        `).get(existente.venda_id);
        const itens = db.prepare('SELECT * FROM venda_itens WHERE venda_id = ?').all(existente.venda_id);
        return { venda: { ...vendaParaJson(venda, itens), barbeiro_nome: venda.barbeiro_nome, cliente_nome: venda.cliente_nome }, idempotente: true };
      }
    }

    // Barbeiro só pode vender se houver caixa aberto
    const caixa = obterCaixaAberto(db);
    if (!caixa) throw new ErroHttp(400, 'Não há caixa aberto. O administrador deve abrir o caixa primeiro.');

    // Barbeiro só pode registrar venda para si mesmo; admin pode para qualquer
    let barbeiroId;
    if (ctx.usuario.papel === 'barbeiro') {
      const b = db.prepare('SELECT id FROM barbeiros WHERE usuario_id = ?').get(ctx.usuario.id);
      if (!b) throw new ErroHttp(404, 'Cadastro de barbeiro não encontrado.');
      barbeiroId = b.id;
    } else {
      barbeiroId = v.inteiro(ctx.body.barbeiro_id, 'O barbeiro', { min: 1 });
    }

    const dados = v.vendaDados(ctx.body);
    if (dados.barbeiro_id !== barbeiroId) throw new ErroHttp(403, 'Você só pode registrar vendas para si mesmo.');

    // Verifica benefícios do plano do cliente (se houver cliente_id)
    let descontoServicosPct = 0;
    let descontoProdutosPct = 0;
    if (dados.cliente_id) {
      descontoServicosPct = obterDescontoPlano(db, dados.cliente_id, 'servicos');
      descontoProdutosPct = obterDescontoPlano(db, dados.cliente_id, 'produtos');
    }

    // Validar itens e calcular totais
    let subtotal = 0;
    const itensProcessados = [];

    for (const item of dados.itens) {
      const itemVal = v.vendaItemDados(item);
      let precoUnit = 0;
      let referenciaNome = '';
      let descontoItemPct = 0;

      if (itemVal.tipo === 'servico') {
        const s = db.prepare('SELECT id, nome, preco_centavos, duracao_min FROM servicos WHERE id = ? AND ativo = 1').get(itemVal.referencia_id);
        if (!s) throw new ErroHttp(404, `Serviço ${itemVal.referencia_id} não encontrado ou inativo.`);
        precoUnit = s.preco_centavos;
        referenciaNome = s.nome;
        descontoItemPct = descontoServicosPct;
      } else {
        const p = db.prepare('SELECT id, nome, preco_centavos, quantidade FROM produtos WHERE id = ? AND ativo = 1').get(itemVal.referencia_id);
        if (!p) throw new ErroHttp(404, `Produto ${itemVal.referencia_id} não encontrado ou inativo.`);
        if (p.quantidade < itemVal.quantidade) throw new ErroHttp(400, `Estoque insuficiente para ${p.nome}. Disponível: ${p.quantidade}`);
        precoUnit = p.preco_centavos;
        referenciaNome = p.nome;
        descontoItemPct = descontoProdutosPct;
      }

      // Aplica desconto do plano se houver
      if (descontoItemPct > 0) {
        precoUnit = Math.round(precoUnit * (100 - descontoItemPct) / 100);
      }

      const comissaoCentavos = calcularComissaoItem(db, barbeiroId, itemVal.tipo, itemVal.referencia_id, precoUnit, itemVal.quantidade);
      subtotal += precoUnit * itemVal.quantidade;

      itensProcessados.push({
        tipo: itemVal.tipo,
        referencia_id: itemVal.referencia_id,
        quantidade: itemVal.quantidade,
        preco_unit_centavos: precoUnit,
        comissao_centavos: comissaoCentavos,
        barbeiro_id: barbeiroId,
        _referencia_nome: referenciaNome,
      });
    }

    const total = subtotal - dados.desconto_centavos;
    if (total < 0) throw new ErroHttp(400, 'Desconto não pode ser maior que o subtotal.');

    // Valida dinheiro recebido se for dinheiro ou misto
    if ((dados.forma_pagamento === 'dinheiro' || dados.forma_pagamento === 'misto') && dados.dinheiro_recebido < total) {
      throw new ErroHttp(400, 'Dinheiro recebido deve ser maior ou igual ao total.');
    }

    const vendaId = transacao(db, () => {
      const id = db.prepare(`
        INSERT INTO vendas (cliente_id, barbeiro_id, caixa_id, subtotal_centavos, desconto_centavos,
          total_centavos, forma_pagamento, dinheiro_recebido, status, observacao)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'concluida', ?)
      `).run(dados.cliente_id, barbeiroId, caixa.id, subtotal, dados.desconto_centavos,
             total, dados.forma_pagamento, dados.dinheiro_recebido, dados.observacao).lastInsertRowid;

      const inserirItem = db.prepare(`
        INSERT INTO venda_itens (venda_id, tipo, referencia_id, quantidade, preco_unit_centavos, comissao_centavos, barbeiro_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of itensProcessados) {
        const resultadoItem = inserirItem.run(id, item.tipo, item.referencia_id, item.quantidade, item.preco_unit_centavos, item.comissao_centavos, item.barbeiro_id);
        const vendaItemId = resultadoItem.lastInsertRowid;

        // Baixa estoque se for produto
        if (item.tipo === 'produto') {
          db.prepare('UPDATE produtos SET quantidade = quantidade - ? WHERE id = ?').run(item.quantidade, item.referencia_id);
        }

        // Cria comissão a receber
        if (item.comissao_centavos > 0) {
          db.prepare(`
            INSERT INTO comissoes (venda_item_id, barbeiro_id, valor_centavos, status)
            VALUES (?, ?, ?, 'a_receber')
          `).run(vendaItemId, barbeiroId, item.comissao_centavos);
        }
      }

      // Atualiza totais do caixa
      if (dados.forma_pagamento === 'dinheiro') {
        db.prepare('UPDATE caixa SET total_dinheiro_centavos = total_dinheiro_centavos + ? WHERE id = ?').run(total, caixa.id);
      } else if (dados.forma_pagamento === 'cartao') {
        db.prepare('UPDATE caixa SET total_cartao_centavos = total_cartao_centavos + ? WHERE id = ?').run(total, caixa.id);
      } else if (dados.forma_pagamento === 'pix') {
        db.prepare('UPDATE caixa SET total_pix_centavos = total_pix_centavos + ? WHERE id = ?').run(total, caixa.id);
      } else if (dados.forma_pagamento === 'misto') {
        db.prepare('UPDATE caixa SET total_dinheiro_centavos = total_dinheiro_centavos + ?, total_misto_centavos = total_misto_centavos + ? WHERE id = ?')
          .run(total, total, caixa.id);
      }

      // Registra idempotency key se fornecida
      if (idempotencyKey) {
        db.prepare('INSERT INTO venda_idempotencia (chave, venda_id) VALUES (?, ?)').run(idempotencyKey, id);
      }

      return Number(id);
    });

    ctx.status = 201;
    // Retorna venda completa com itens
    const venda = db.prepare(`
      SELECT v.*, u.nome as barbeiro_nome, u2.nome as cliente_nome
      FROM vendas v
      JOIN barbeiros b ON b.id = v.barbeiro_id
      JOIN usuarios u ON u.id = b.usuario_id
      LEFT JOIN usuarios u2 ON u2.id = v.cliente_id
      WHERE v.id = ?
    `).get(vendaId);
    const itens = db.prepare('SELECT * FROM venda_itens WHERE venda_id = ?').all(vendaId);
    return { venda: { ...vendaParaJson(venda, itens), barbeiro_nome: venda.barbeiro_nome, cliente_nome: venda.cliente_nome } };
  });

  r.get('/api/vendas', auth.exigirLogin, (ctx) => {
    const admin = ctx.usuario.papel === 'admin';
    const barbeiro = ctx.usuario.papel === 'barbeiro';

    let where = 'WHERE 1=1';
    const params = [];

    if (barbeiro) {
      const b = db.prepare('SELECT id FROM barbeiros WHERE usuario_id = ?').get(ctx.usuario.id);
      if (!b) throw new ErroHttp(404, 'Cadastro de barbeiro não encontrado.');
      where += ' AND v.barbeiro_id = ?';
      params.push(b.id);
    } else if (ctx.query.barbeiro) {
      where += ' AND v.barbeiro_id = ?';
      params.push(v.inteiro(ctx.query.barbeiro, 'O barbeiro', { min: 1 }));
    }
    if (ctx.query.cliente) {
      where += ' AND v.cliente_id = ?';
      params.push(v.inteiro(ctx.query.cliente, 'O cliente', { min: 1 }));
    }
    if (ctx.query.data_inicio) {
      where += ' AND date(v.criado_em) >= date(?)';
      params.push(v.dataISO(ctx.query.data_inicio));
    }
    if (ctx.query.data_fim) {
      where += ' AND date(v.criado_em) <= date(?)';
      params.push(v.dataISO(ctx.query.data_fim));
    }
    if (ctx.query.caixa) {
      where += ' AND v.caixa_id = ?';
      params.push(v.inteiro(ctx.query.caixa, 'O caixa', { min: 1 }));
    }

    // Paginação
    const page = Math.max(1, v.inteiro(ctx.query.page, 'page', { min: 1, max: 10000, opcional: true }) || 1);
    const limit = Math.min(100, Math.max(1, v.inteiro(ctx.query.limit, 'limit', { min: 1, max: 100, opcional: true }) || 50));
    const offset = (page - 1) * limit;

    // Total count
    const totalRow = db.prepare(`SELECT COUNT(*) as total FROM vendas v ${where}`).get(...params);
    const total = totalRow.total;

    const vendas = db.prepare(`
      SELECT v.*, u.nome as barbeiro_nome, u2.nome as cliente_nome
      FROM vendas v
      JOIN barbeiros b ON b.id = v.barbeiro_id
      JOIN usuarios u ON u.id = b.usuario_id
      LEFT JOIN usuarios u2 ON u2.id = v.cliente_id
      ${where}
      ORDER BY v.criado_em DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    return {
      vendas: vendas.map(v => vendaParaJson(v)),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  });

  r.get('/api/vendas/:id', auth.exigirLogin, (ctx) => {
    const id = v.idDaUrl(ctx.params.id);
    const venda = db.prepare(`
      SELECT v.*, u.nome as barbeiro_nome, u2.nome as cliente_nome
      FROM vendas v
      JOIN barbeiros b ON b.id = v.barbeiro_id
      JOIN usuarios u ON u.id = b.usuario_id
      LEFT JOIN usuarios u2 ON u2.id = v.cliente_id
      WHERE v.id = ?
    `).get(id);
    if (!venda) throw new ErroHttp(404, 'Venda não encontrada.');

    // Barbeiro só vê suas vendas
    if (ctx.usuario.papel === 'barbeiro') {
      const b = db.prepare('SELECT id FROM barbeiros WHERE usuario_id = ?').get(ctx.usuario.id);
      if (!b || b.id !== venda.barbeiro_id) throw new ErroHttp(403, 'Acesso negado.');
    }

    const itens = db.prepare('SELECT * FROM venda_itens WHERE venda_id = ?').all(id);
    // Enriquece itens com nomes
    for (const item of itens) {
      if (item.tipo === 'servico') {
        const s = db.prepare('SELECT nome, duracao_min FROM servicos WHERE id = ?').get(item.referencia_id);
        if (s) { item.referencia_nome = s.nome; item.duracao_min = s.duracao_min; }
      } else {
        const p = db.prepare('SELECT nome FROM produtos WHERE id = ?').get(item.referencia_id);
        if (p) item.referencia_nome = p.nome;
      }
    }

    return { venda: { ...vendaParaJson(venda, itens), barbeiro_nome: venda.barbeiro_nome, cliente_nome: venda.cliente_nome } };
  });

  // PUT /api/vendas/:id/cancelar - cancela venda com estorno completo (admin only)
  r.put('/api/vendas/:id/cancelar', soAdmin, (ctx) => {
    const id = v.idDaUrl(ctx.params.id);
    const venda = db.prepare('SELECT * FROM vendas WHERE id = ?').get(id);
    if (!venda) throw new ErroHttp(404, 'Venda não encontrada.');

    if (venda.status === 'cancelada') throw new ErroHttp(400, 'Venda já cancelada.');

    // Verifica se o caixa da venda ainda está aberto (não pode cancelar se caixa fechado)
    const caixa = db.prepare('SELECT * FROM caixa WHERE id = ?').get(venda.caixa_id);
    if (!caixa) throw new ErroHttp(400, 'Caixa da venda não encontrado.');
    if (caixa.status === 'fechado') throw new ErroHttp(400, 'Não é possível cancelar venda de caixa já fechado.');

    const itens = db.prepare('SELECT * FROM venda_itens WHERE venda_id = ?').all(id);

    transacao(db, () => {
      // 1. Estorna estoque de produtos
      for (const item of itens) {
        if (item.tipo === 'produto') {
          db.prepare('UPDATE produtos SET quantidade = quantidade + ? WHERE id = ?').run(item.quantidade, item.referencia_id);
        }
      }

      // 2. Cancela comissões (marca como 'cancelada' ou remove se 'a_receber')
      const comissoes = db.prepare('SELECT * FROM comissoes WHERE venda_item_id IN (SELECT id FROM venda_itens WHERE venda_id = ?)').all(id);
      for (const c of comissoes) {
        if (c.status === 'a_receber') {
          db.prepare('DELETE FROM comissoes WHERE id = ?').run(c.id);
        } else if (c.status === 'pago') {
          // Se já foi pago, marca como estornado (não apaga para auditoria)
          db.prepare("UPDATE comissoes SET status = 'estornado', observacao = COALESCE(observacao, '') || ' | ESTORNO: venda cancelada' WHERE id = ?").run(c.id);
        }
      }

      // 3. Reverte totais do caixa
      const total = venda.total_centavos;
      if (venda.forma_pagamento === 'dinheiro') {
        db.prepare('UPDATE caixa SET total_dinheiro_centavos = total_dinheiro_centavos - ? WHERE id = ?').run(total, caixa.id);
      } else if (venda.forma_pagamento === 'cartao') {
        db.prepare('UPDATE caixa SET total_cartao_centavos = total_cartao_centavos - ? WHERE id = ?').run(total, caixa.id);
      } else if (venda.forma_pagamento === 'pix') {
        db.prepare('UPDATE caixa SET total_pix_centavos = total_pix_centavos - ? WHERE id = ?').run(total, caixa.id);
      } else if (venda.forma_pagamento === 'misto') {
        db.prepare('UPDATE caixa SET total_dinheiro_centavos = total_dinheiro_centavos - ?, total_misto_centavos = total_misto_centavos - ? WHERE id = ?')
          .run(total, total, caixa.id);
      }

      // 4. Marca venda como cancelada
      db.prepare("UPDATE vendas SET status = 'cancelada', observacao = COALESCE(observacao, '') || ' | CANCELADA EM ' || datetime('now') WHERE id = ?").run(id);

      // 5. Remove idempotency key se existir (permite recriar a venda com mesma chave)
      db.prepare('DELETE FROM venda_idempotencia WHERE venda_id = ?').run(id);
    });

    const vendaCancelada = db.prepare(`
      SELECT v.*, u.nome as barbeiro_nome, u2.nome as cliente_nome
      FROM vendas v
      JOIN barbeiros b ON b.id = v.barbeiro_id
      JOIN usuarios u ON u.id = b.usuario_id
      LEFT JOIN usuarios u2 ON u2.id = v.cliente_id
      WHERE v.id = ?
    `).get(id);
    const itensCancelados = db.prepare('SELECT * FROM venda_itens WHERE venda_id = ?').all(id);

    return { venda: { ...vendaParaJson(vendaCancelada, itensCancelados), barbeiro_nome: vendaCancelada.barbeiro_nome, cliente_nome: vendaCancelada.cliente_nome } };
  });

  // ───────────────────────── Fase 3: Comissões ─────────────────────────

  r.get('/api/comissoes', auth.exigirLogin, (ctx) => {
    const admin = ctx.usuario.papel === 'admin';
    const barbeiro = ctx.usuario.papel === 'barbeiro';

    let where = 'WHERE 1=1';
    const params = [];

    if (barbeiro) {
      const b = db.prepare('SELECT id FROM barbeiros WHERE usuario_id = ?').get(ctx.usuario.id);
      if (!b) throw new ErroHttp(404, 'Cadastro de barbeiro não encontrado.');
      where += ' AND c.barbeiro_id = ?';
      params.push(b.id);
    } else if (ctx.query.barbeiro) {
      where += ' AND c.barbeiro_id = ?';
      params.push(v.inteiro(ctx.query.barbeiro, 'O barbeiro', { min: 1 }));
    }
    if (ctx.query.status) {
      where += ' AND c.status = ?';
      params.push(v.texto(ctx.query.status, 'O status'));
    }
    if (ctx.query.data_inicio) {
      where += ' AND date(vi.criado_em) >= date(?)';
      params.push(v.dataISO(ctx.query.data_inicio));
    }
    if (ctx.query.data_fim) {
      where += ' AND date(vi.criado_em) <= date(?)';
      params.push(v.dataISO(ctx.query.data_fim));
    }

    // Paginação
    const page = Math.max(1, v.inteiro(ctx.query.page, 'page', { min: 1, max: 10000, opcional: true }) || 1);
    const limit = Math.min(100, Math.max(1, v.inteiro(ctx.query.limit, 'limit', { min: 1, max: 100, opcional: true }) || 50));
    const offset = (page - 1) * limit;

    // Total count
    const totalRow = db.prepare(`
      SELECT COUNT(*) as total
      FROM comissoes c
      JOIN venda_itens vi ON vi.id = c.venda_item_id
      JOIN vendas v ON v.id = vi.venda_id
      JOIN barbeiros b ON b.id = c.barbeiro_id
      JOIN usuarios u ON u.id = b.usuario_id
      ${where}
    `).get(...params);
    const total = totalRow.total;

    const comissoes = db.prepare(`
      SELECT c.*, vi.tipo as item_tipo, vi.referencia_id, vi.quantidade, vi.preco_unit_centavos,
             v.id as venda_id, v.criado_em as venda_criado_em, v.forma_pagamento,
             u.nome as barbeiro_nome
      FROM comissoes c
      JOIN venda_itens vi ON vi.id = c.venda_item_id
      JOIN vendas v ON v.id = vi.venda_id
      JOIN barbeiros b ON b.id = c.barbeiro_id
      JOIN usuarios u ON u.id = b.usuario_id
      ${where}
      ORDER BY v.criado_em DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    // Enriquece com nome do serviço/produto
    for (const c of comissoes) {
      if (c.item_tipo === 'servico') {
        const s = db.prepare('SELECT nome FROM servicos WHERE id = ?').get(c.referencia_id);
        if (s) c.item_nome = s.nome;
      } else {
        const p = db.prepare('SELECT nome FROM produtos WHERE id = ?').get(c.referencia_id);
        if (p) c.item_nome = p.nome;
      }
    }

    return {
      comissoes,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  });

  r.get('/api/comissoes/resumo', auth.exigirLogin, (ctx) => {
    const admin = ctx.usuario.papel === 'admin';
    const barbeiro = ctx.usuario.papel === 'barbeiro';

    let where = 'WHERE 1=1';
    const params = [];

    if (barbeiro) {
      const b = db.prepare('SELECT id FROM barbeiros WHERE usuario_id = ?').get(ctx.usuario.id);
      if (!b) throw new ErroHttp(404, 'Cadastro de barbeiro não encontrado.');
      where += ' AND c.barbeiro_id = ?';
      params.push(b.id);
    } else if (ctx.query.barbeiro) {
      where += ' AND c.barbeiro_id = ?';
      params.push(v.inteiro(ctx.query.barbeiro, 'O barbeiro', { min: 1 }));
    }
    if (ctx.query.data_inicio) {
      where += ' AND date(v.criado_em) >= date(?)';
      params.push(v.dataISO(ctx.query.data_inicio));
    }
    if (ctx.query.data_fim) {
      where += ' AND date(v.criado_em) <= date(?)';
      params.push(v.dataISO(ctx.query.data_fim));
    }

    const resumo = db.prepare(`
      SELECT
        c.barbeiro_id,
        u.nome as barbeiro_nome,
        SUM(CASE WHEN c.status = 'a_receber' THEN c.valor_centavos ELSE 0 END) as a_receber,
        SUM(CASE WHEN c.status = 'pago' THEN c.valor_centavos ELSE 0 END) as pago,
        COUNT(*) as total_itens
      FROM comissoes c
      JOIN venda_itens vi ON vi.id = c.venda_item_id
      JOIN vendas v ON v.id = vi.venda_id
      JOIN barbeiros b ON b.id = c.barbeiro_id
      JOIN usuarios u ON u.id = b.usuario_id
      ${where}
      GROUP BY c.barbeiro_id, u.nome
      ORDER BY u.nome
    `).all(...params);

    return { resumo };
  });

  r.put('/api/comissoes/lote/pagar', soAdmin, (ctx) => {
    const ids = v.listaDeIds(ctx.body.ids, 'IDs das comissões');
    if (!ids.length) throw new ErroHttp(400, 'Informe pelo menos uma comissão.');
    const dados = v.comissaoPagamentoDados(ctx.body);

    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`UPDATE comissoes SET status = 'pago', pago_em = datetime('now'), pago_por = ?, observacao = ? WHERE id IN (${placeholders})`)
      .run(ctx.usuario.id, dados.observacao, ...ids);

    return { ok: true, pagas: ids.length };
  });

  r.put('/api/comissoes/:id/pagar', soAdmin, (ctx) => {
    const id = v.idDaUrl(ctx.params.id);
    const comissao = db.prepare('SELECT * FROM comissoes WHERE id = ?').get(id);
    if (!comissao) throw new ErroHttp(404, 'Comissão não encontrada.');
    if (comissao.status === 'pago') throw new ErroHttp(400, 'Comissão já paga.');

    const dados = v.comissaoPagamentoDados(ctx.body);
    db.prepare("UPDATE comissoes SET status = 'pago', pago_em = datetime('now'), pago_por = ?, observacao = ? WHERE id = ?")
      .run(ctx.usuario.id, dados.observacao, id);

    return { comissao: db.prepare('SELECT * FROM comissoes WHERE id = ?').get(id) };
  });

  // ───────────────────────── Fase 3: Observações do Cliente ─────────────────────────

  r.get('/api/clientes/:id/observacoes', auth.exigirPapel('barbeiro', 'admin'), (ctx) => {
    const clienteId = v.idDaUrl(ctx.params.id);
    // Verifica se cliente existe
    if (!db.prepare('SELECT id FROM usuarios WHERE id = ? AND papel = \'cliente\'').get(clienteId)) {
      throw new ErroHttp(404, 'Cliente não encontrado.');
    }

    const obs = db.prepare(`
      SELECT o.*, u.nome as barbeiro_nome
      FROM cliente_observacoes o
      JOIN barbeiros b ON b.id = o.barbeiro_id
      JOIN usuarios u ON u.id = b.usuario_id
      WHERE o.cliente_id = ?
      ORDER BY o.criado_em DESC
    `).all(clienteId);

    return { observacoes: obs };
  });

  r.post('/api/clientes/:id/observacoes', auth.exigirPapel('barbeiro', 'admin'), (ctx) => {
    const clienteId = v.idDaUrl(ctx.params.id);
    if (!db.prepare('SELECT id FROM usuarios WHERE id = ? AND papel = \'cliente\'').get(clienteId)) {
      throw new ErroHttp(404, 'Cliente não encontrado.');
    }

    let barbeiroId;
    if (ctx.usuario.papel === 'barbeiro') {
      const b = db.prepare('SELECT id FROM barbeiros WHERE usuario_id = ?').get(ctx.usuario.id);
      if (!b) throw new ErroHttp(404, 'Cadastro de barbeiro não encontrado.');
      barbeiroId = b.id;
    } else {
      barbeiroId = v.inteiro(ctx.body.barbeiro_id, 'O barbeiro', { min: 1 });
    }

    const dados = v.observacaoDados(ctx.body);
    const id = db.prepare(`
      INSERT INTO cliente_observacoes (cliente_id, barbeiro_id, conteudo)
      VALUES (?, ?, ?)
    `).run(clienteId, barbeiroId, dados.conteudo).lastInsertRowid;

    ctx.status = 201;
    return { observacao: db.prepare(`
      SELECT o.*, u.nome as barbeiro_nome
      FROM cliente_observacoes o
      JOIN barbeiros b ON b.id = o.barbeiro_id
      JOIN usuarios u ON u.id = b.usuario_id
      WHERE o.id = ?
    `).get(id) };
  });

  // ───────────────────────── Fase 3: Histórico Completo do Cliente ─────────────────────────

  r.get('/api/clientes/:id/historico', auth.exigirPapel('barbeiro', 'admin'), (ctx) => {
    const clienteId = v.idDaUrl(ctx.params.id);
    if (!db.prepare('SELECT id FROM usuarios WHERE id = ? AND papel = \'cliente\'').get(clienteId)) {
      throw new ErroHttp(404, 'Cliente não encontrado.');
    }

    // Agendamentos concluídos
    const agendamentos = db.prepare(`
      SELECT a.*, s.nome as servico_nome, s.duracao_min, s.preco_centavos,
             u.nome as barbeiro_nome
      FROM agendamentos a
      JOIN servicos s ON s.id = a.servico_id
      JOIN barbeiros b ON b.id = a.barbeiro_id
      JOIN usuarios u ON u.id = b.usuario_id
      WHERE a.cliente_id = ? AND a.status = 'concluido'
      ORDER BY a.inicio DESC
    `).all(clienteId);

    // Vendas (serviços avulsos + produtos)
    const vendas = db.prepare(`
      SELECT v.*, u.nome as barbeiro_nome
      FROM vendas v
      JOIN barbeiros b ON b.id = v.barbeiro_id
      JOIN usuarios u ON u.id = b.usuario_id
      WHERE v.cliente_id = ? AND v.status = 'concluida'
      ORDER BY v.criado_em DESC
    `).all(clienteId);

    // Itens das vendas
    for (const venda of vendas) {
      venda.itens = db.prepare('SELECT * FROM venda_itens WHERE venda_id = ?').all(venda.id);
      for (const item of venda.itens) {
        if (item.tipo === 'servico') {
          const s = db.prepare('SELECT nome, duracao_min FROM servicos WHERE id = ?').get(item.referencia_id);
          if (s) { item.referencia_nome = s.nome; item.duracao_min = s.duracao_min; }
        } else {
          const p = db.prepare('SELECT nome FROM produtos WHERE id = ?').get(item.referencia_id);
          if (p) item.referencia_nome = p.nome;
        }
      }
    }

    // Observações
    const observacoes = db.prepare(`
      SELECT o.*, u.nome as barbeiro_nome
      FROM cliente_observacoes o
      JOIN barbeiros b ON b.id = o.barbeiro_id
      JOIN usuarios u ON u.id = b.usuario_id
      WHERE o.cliente_id = ?
      ORDER BY o.criado_em DESC
    `).all(clienteId);

    return { agendamentos, vendas, observacoes };
  });

  // ───────────────────────── Dashboard Admin ─────────────────────────

  // Helper: período padrão (últimos 30 dias)
  function obterPeriodoPadrao(ctx) {
    const dataFim = ctx.query.data_fim ? v.dataISO(ctx.query.data_fim) : new Date().toISOString().slice(0, 10);
    const dataInicio = ctx.query.data_inicio
      ? v.dataISO(ctx.query.data_inicio)
      : (() => {
          const d = new Date(dataFim);
          d.setDate(d.getDate() - 29); // 30 dias inclusive
          return d.toISOString().slice(0, 10);
        })();
    return { dataInicio, dataFim };
  }

  // Helper: calcula faturamento e atendimentos no período
  function calcularFaturamentoPeriodo(db, dataInicio, dataFim) {
    const vendas = db.prepare(`
      SELECT SUM(total_centavos) as total, COUNT(*) as qtd
      FROM vendas
      WHERE status = 'concluida' AND date(criado_em) BETWEEN date(?) AND date(?)
    `).get(dataInicio, dataFim);
    return { total: vendas.total || 0, qtd: vendas.qtd || 0 };
  }

  // GET /api/admin/dashboard - Métricas gerais do dashboard
  r.get('/api/admin/dashboard', soAdmin, (ctx) => {
    const { dataInicio, dataFim } = obterPeriodoPadrao(ctx);

    // Faturamento e qtd de vendas no período
    const { total: faturamentoTotal, qtd: qtdVendas } = calcularFaturamentoPeriodo(db, dataInicio, dataFim);
    const ticketMedio = qtdVendas > 0 ? Math.round(faturamentoTotal / qtdVendas) : 0;

    // Agendamentos no período - para ocupação e no-show
    const agendamentos = db.prepare(`
      SELECT status, COUNT(*) as total FROM agendamentos
      WHERE date(inicio) BETWEEN date(?) AND date(?)
      GROUP BY status
    `).all(dataInicio, dataFim);

    const agendStats = { pendente: 0, confirmado: 0, cancelado: 0, concluido: 0 };
    for (const a of agendamentos) agendStats[a.status] = a.total;
    const totalAgendamentos = agendStats.pendente + agendStats.confirmado + agendStats.cancelado + agendStats.concluido;

    // Ocupação = (confirmado + concluido) / total * 100
    const ocupacao = totalAgendamentos > 0
      ? Math.round(((agendStats.confirmado + agendStats.concluido) / totalAgendamentos) * 100)
      : 0;

    // No-show = cancelado / total * 100
    const noShow = totalAgendamentos > 0
      ? Math.round((agendStats.cancelado / totalAgendamentos) * 100)
      : 0;

    return {
      kpis: {
        ocupacao_pct: ocupacao,
        no_show_pct: noShow,
        ticket_medio_centavos: ticketMedio,
        faturamento_centavos: faturamentoTotal,
      }
    };
  });

  // GET /api/admin/relatorio-financeiro - Relatório financeiro detalhado
  r.get('/api/admin/relatorio-financeiro', soAdmin, (ctx) => {
    const { dataInicio, dataFim } = obterPeriodoPadrao(ctx);

    // 1. Faturamento por serviço (agendamentos concluídos + vendas walk-in)
    const servicosAgg = db.prepare(`
      SELECT
        s.id as servico_id,
        s.nome as servico_nome,
        SUM(vi.preco_unit_centavos * vi.quantidade) as total_centavos,
        SUM(vi.quantidade) as quantidade
      FROM venda_itens vi
      JOIN vendas v ON v.id = vi.venda_id
      JOIN servicos s ON s.id = vi.referencia_id
      WHERE vi.tipo = 'servico' AND v.status = 'concluida' AND date(v.criado_em) BETWEEN date(?) AND date(?)
      GROUP BY s.id, s.nome
      ORDER BY total_centavos DESC
    `).all(dataInicio, dataFim);

    const faturamentoPorServicoArray = servicosAgg.map(s => ({
      servico_id: s.servico_id,
      servico_nome: s.servico_nome,
      quantidade: s.quantidade,
      total_centavos: s.total_centavos
    }));

    // 2. Faturamento por período (dia a dia)
    const faturamentoPorPeriodo = db.prepare(`
      SELECT date(criado_em) as data, SUM(total_centavos) as total, COUNT(*) as qtd_atendimentos
      FROM vendas
      WHERE status = 'concluida' AND date(criado_em) BETWEEN date(?) AND date(?)
      GROUP BY date(criado_em)
      ORDER BY date(criado_em)
    `).all(dataInicio, dataFim);

    // 3. Faturamento por barbeiro
    const barbeiroMap = new Map();
    // Agendamentos concluídos
    const agendConc = db.prepare(`
      SELECT b.id as barbeiro_id, u.nome as barbeiro_nome,
             SUM(s.preco_centavos) as total_centavos, COUNT(*) as qtd
      FROM agendamentos a
      JOIN servicos s ON s.id = a.servico_id
      JOIN barbeiros b ON b.id = a.barbeiro_id
      JOIN usuarios u ON u.id = b.usuario_id
      WHERE a.status = 'concluido' AND date(a.inicio) BETWEEN date(?) AND date(?)
      GROUP BY b.id, u.nome
    `).all(dataInicio, dataFim);
    for (const a of agendConc) {
      barbeiroMap.set(a.barbeiro_id, {
        barbeiro_id: a.barbeiro_id,
        barbeiro_nome: a.barbeiro_nome,
        total_centavos: a.total_centavos,
        qtd_atendimentos: a.qtd
      });
    }
    // Vendas walk-in
    const vendasBarbeiro = db.prepare(`
      SELECT b.id as barbeiro_id, u.nome as barbeiro_nome,
             SUM(v.total_centavos) as total_centavos, COUNT(*) as qtd
      FROM vendas v
      JOIN barbeiros b ON b.id = v.barbeiro_id
      JOIN usuarios u ON u.id = b.usuario_id
      WHERE v.status = 'concluida' AND date(v.criado_em) BETWEEN date(?) AND date(?)
      GROUP BY b.id, u.nome
    `).all(dataInicio, dataFim);
    for (const v of vendasBarbeiro) {
      const existing = barbeiroMap.get(v.barbeiro_id);
      if (existing) {
        existing.total_centavos += v.total_centavos;
        existing.qtd_atendimentos += v.qtd;
      } else {
        barbeiroMap.set(v.barbeiro_id, {
          barbeiro_id: v.barbeiro_id,
          barbeiro_nome: v.barbeiro_nome,
          total_centavos: v.total_centavos,
          qtd_atendimentos: v.qtd
        });
      }
    }

    const faturamentoPorBarbeiroArray = Array.from(barbeiroMap.values()).map(b => ({
      ...b,
      ticket_medio: b.qtd_atendimentos > 0 ? Math.round(b.total_centavos / b.qtd_atendimentos) : 0
    })).sort((a, b) => b.total_centavos - a.total_centavos);

    // 4. Comissões
    const comissoes = db.prepare(`
      SELECT c.barbeiro_id, u.nome as barbeiro_nome,
             SUM(CASE WHEN c.status = 'a_receber' THEN c.valor_centavos ELSE 0 END) as a_receber,
             SUM(CASE WHEN c.status = 'pago' THEN c.valor_centavos ELSE 0 END) as pago,
             SUM(c.valor_centavos) as total
      FROM comissoes c
      JOIN venda_itens vi ON vi.id = c.venda_item_id
      JOIN vendas v ON v.id = vi.venda_id
      JOIN barbeiros b ON b.id = c.barbeiro_id
      JOIN usuarios u ON u.id = b.usuario_id
      WHERE v.criado_em >= ? AND v.criado_em <= ?
      GROUP BY c.barbeiro_id, u.nome
      ORDER BY u.nome
    `).all(dataInicio, dataFim);

    return {
      periodo: { data_inicio: dataInicio, data_fim: dataFim },
      faturamento_por_servico: faturamentoPorServicoArray,
      faturamento_por_periodo: faturamentoPorPeriodo,
      faturamento_por_barbeiro: faturamentoPorBarbeiroArray,
      comissoes
    };
  });

  // ───────────────────────── Planos & Assinaturas ─────────────────────────

  const { getPagamentoGateway } = require('./pagamento');
  const gateway = getPagamentoGateway();

  function planoParaJson(p) {
    return {
      id: p.id,
      nome: p.nome,
      descricao: p.descricao,
      preco_centavos: p.preco_centavos,
      intervalo_dias: p.intervalo_dias,
      beneficios: p.beneficios ? JSON.parse(p.beneficios) : [],
      ativo: !!p.ativo,
    };
  }

  function assinaturaParaJson(a) {
    return {
      id: a.id,
      plano_id: a.plano_id,
      gateway: a.gateway,
      gateway_assinatura_id: a.gateway_assinatura_id,
      status: a.status,
      forma_pagamento: a.forma_pagamento,
      proxima_cobranca: a.proxima_cobranca,
      cancelada_em: a.cancelada_em,
      criado_em: a.criado_em,
    };
  }

  function metodoPagamentoParaJson(m) {
    return {
      id: m.id,
      gateway: m.gateway,
      tipo: m.tipo,
      marca: m.marca,
      ultimos4: m.ultimos4,
      expiracao: m.expiracao,
      padrao: !!m.padrao,
      criado_em: m.criado_em,
    };
  }

  function faturaParaJson(f) {
    return {
      id: f.id,
      assinatura_id: f.assinatura_id,
      gateway_fatura_id: f.gateway_fatura_id,
      valor_centavos: f.valor_centavos,
      status: f.status,
      vencimento: f.vencimento,
      paga_em: f.paga_em,
      metodo_pagamento_id: f.metodo_pagamento_id,
      criado_em: f.criado_em,
    };
  }

  // GET /api/planos - clientes veem planos ativos; admin também vê inativos.
  r.get('/api/planos', (ctx) => {
    const admin = ctx.usuario && ctx.usuario.papel === 'admin';
    const planos = db.prepare(`SELECT * FROM planos ${admin ? '' : 'WHERE ativo = 1'} ORDER BY preco_centavos ASC`).all();
    return { planos: planos.map(planoParaJson) };
  });

  // POST /api/planos - cria plano (admin)
  r.post('/api/planos', soAdmin, (ctx) => {
    const nome = v.texto(ctx.body.nome, 'o nome do plano', { max: 60 });
    const descricao = v.texto(ctx.body.descricao, 'a descrição', { max: 500, opcional: true });
    const preco = v.inteiro(ctx.body.preco_centavos, 'o preço', { min: 0, max: 10_000_000 });
    const intervalo = v.inteiro(ctx.body.intervalo_dias, 'o intervalo em dias', { min: 1, max: 365 }, 30);
    const beneficios = ctx.body.beneficios ? JSON.stringify(ctx.body.beneficios) : null;
    const ativo = v.booleano(ctx.body.ativo, 'ativo', true);
    const id = db.prepare(
      'INSERT INTO planos (nome, descricao, preco_centavos, intervalo_dias, beneficios, ativo) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(nome, descricao, preco, intervalo, beneficios, ativo ? 1 : 0).lastInsertRowid;
    ctx.status = 201;
    return { plano: planoParaJson(db.prepare('SELECT * FROM planos WHERE id = ?').get(id)) };
  });

  // PUT /api/planos/:id - atualiza plano (admin)
  r.put('/api/planos/:id', soAdmin, (ctx) => {
    const id = v.idDaUrl(ctx.params.id);
    const atual = db.prepare('SELECT * FROM planos WHERE id = ?').get(id);
    if (!atual) throw new ErroHttp(404, 'Plano não encontrado.');
    const nome = v.texto(ctx.body.nome, 'o nome do plano', { max: 60 });
    const descricao = v.texto(ctx.body.descricao, 'a descrição', { max: 500, opcional: true });
    const preco = v.inteiro(ctx.body.preco_centavos, 'o preço', { min: 0, max: 10_000_000 });
    const intervalo = v.inteiro(ctx.body.intervalo_dias, 'o intervalo em dias', { min: 1, max: 365 });
    const beneficios = ctx.body.beneficios !== undefined ? JSON.stringify(ctx.body.beneficios) : atual.beneficios;
    const ativo = v.booleano(ctx.body.ativo, 'ativo', !!atual.ativo);
    db.prepare(
      'UPDATE planos SET nome = ?, descricao = ?, preco_centavos = ?, intervalo_dias = ?, beneficios = ?, ativo = ? WHERE id = ?'
    ).run(nome, descricao, preco, intervalo, beneficios, ativo ? 1 : 0, id);
    return { plano: planoParaJson(db.prepare('SELECT * FROM planos WHERE id = ?').get(id)) };
  });

  // DELETE /api/planos/:id - desativa plano (admin)
  r.delete('/api/planos/:id', soAdmin, (ctx) => {
    const id = v.idDaUrl(ctx.params.id);
    db.prepare('UPDATE planos SET ativo = 0 WHERE id = ?').run(id);
    return { ok: true };
  });

  // GET /api/minha-assinatura - assinatura ativa do cliente logado
  r.get('/api/minha-assinatura', auth.exigirLogin, (ctx) => {
    const assinatura = db.prepare(
      `SELECT a.*, p.nome as plano_nome, p.preco_centavos as plano_preco, p.beneficios as plano_beneficios
       FROM assinaturas a
       JOIN planos p ON p.id = a.plano_id
       WHERE a.cliente_id = ? AND a.status IN ('pendente','ativa','atrasada')
       ORDER BY a.criado_em DESC LIMIT 1`
    ).get(ctx.usuario.id);
    if (!assinatura) return { assinatura: null };
    return {
      assinatura: {
        ...assinaturaParaJson(assinatura),
        plano: {
          id: assinatura.plano_id,
          nome: assinatura.plano_nome,
          preco_centavos: assinatura.plano_preco,
          beneficios: assinatura.plano_beneficios ? JSON.parse(assinatura.plano_beneficios) : [],
        },
      },
    };
  });

  // GET /api/assinaturas - lista assinaturas (admin)
  r.get('/api/assinaturas', soAdmin, (ctx) => {
    const assinaturas = db.prepare(
      `SELECT a.*, u.nome as cliente_nome, u.email as cliente_email, p.nome as plano_nome
       FROM assinaturas a
       JOIN usuarios u ON u.id = a.cliente_id
       JOIN planos p ON p.id = a.plano_id
       ORDER BY a.criado_em DESC`
    ).all();
    return { assinaturas: assinaturas.map(a => ({
      ...assinaturaParaJson(a),
      cliente_nome: a.cliente_nome,
      cliente_email: a.cliente_email,
      plano_nome: a.plano_nome,
    })) };
  });

  // POST /api/assinaturas - criar assinatura (cliente logado)
  r.post('/api/assinaturas', auth.exigirLogin, async (ctx) => {
    const planoId = v.inteiro(ctx.body.plano_id, 'o plano', { min: 1 });
    const metodoId = v.inteiro(ctx.body.metodo_pagamento_id, 'o método de pagamento', { min: 1 });
    const formaPagamento = v.texto(ctx.body.forma_pagamento, 'a forma de pagamento', { max: 10 }, 'cartao');

    const plano = db.prepare('SELECT * FROM planos WHERE id = ? AND ativo = 1').get(planoId);
    if (!plano) throw new ErroHttp(404, 'Plano não encontrado ou inativo.');

    const metodo = db.prepare('SELECT * FROM metodos_pagamento WHERE id = ? AND cliente_id = ?').get(metodoId, ctx.usuario.id);
    if (!metodo) throw new ErroHttp(404, 'Método de pagamento não encontrado.');

    // Verifica se já tem assinatura ativa
    const existente = db.prepare(
      "SELECT id FROM assinaturas WHERE cliente_id = ? AND status IN ('pendente','ativa','atrasada')"
    ).get(ctx.usuario.id);
    if (existente) throw new ErroHttp(409, 'Você já possui uma assinatura ativa.');

    // Cria cliente no gateway se não existir
    const gateway = getPagamentoGateway();
    let clienteGatewayId = ctx.usuario.gateway_id; // TODO: adicionar coluna gateway_id em usuarios
    if (!clienteGatewayId) {
      const clienteGateway = await gateway.criarCliente({
        nome: ctx.usuario.nome,
        email: ctx.usuario.email,
        telefone: ctx.usuario.telefone,
      });
      clienteGatewayId = clienteGateway.id;
      // TODO: salvar gateway_id no usuario
    }

    // Cria assinatura no gateway
    const assinaturaGateway = await gateway.criarAssinatura({
      clienteGatewayId,
      planoNome: plano.nome,
      precoCentavos: plano.preco_centavos,
      intervaloDias: plano.intervalo_dias,
      cartaoId: metodo.gateway_token,
      formaPagamento,
    });

    const proximaCobranca = assinaturaGateway.proxima_cobranca || new Date(Date.now() + plano.intervalo_dias * 24 * 60 * 60 * 1000).toISOString();

    const id = transacao(db, () => {
      const assinaturaId = db.prepare(
        `INSERT INTO assinaturas (cliente_id, plano_id, gateway, gateway_assinatura_id, status, forma_pagamento, proxima_cobranca)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(ctx.usuario.id, planoId, gateway.gateway, assinaturaGateway.id, 'ativa', formaPagamento, proximaCobranca).lastInsertRowid;

      // Cria primeira fatura
      db.prepare(
        `INSERT INTO faturas (assinatura_id, gateway_fatura_id, valor_centavos, status, vencimento)
         VALUES (?, ?, ?, 'pendente', ?)`
      ).run(assinaturaId, assinaturaGateway.id, plano.preco_centavos, proximaCobranca);

      return assinaturaId;
    });

    const nova = db.prepare(
      `SELECT a.*, p.nome as plano_nome, p.preco_centavos as plano_preco, p.beneficios as plano_beneficios
       FROM assinaturas a JOIN planos p ON p.id = a.plano_id WHERE a.id = ?`
    ).get(id);

    return { assinatura: { ...assinaturaParaJson(nova), plano: { id: nova.plano_id, nome: nova.plano_nome, preco_centavos: nova.plano_preco, beneficios: nova.plano_beneficios ? JSON.parse(nova.plano_beneficios) : [] } } };
  });

  // PUT /api/assinaturas/:id/cancelar - cancelar assinatura (cliente dono ou admin)
  r.put('/api/assinaturas/:id/cancelar', auth.exigirLogin, async (ctx) => {
    const id = v.idDaUrl(ctx.params.id);
    const assinatura = db.prepare('SELECT * FROM assinaturas WHERE id = ?').get(id);
    if (!assinatura) throw new ErroHttp(404, 'Assinatura não encontrada.');

    // Só o dono ou admin pode cancelar
    if (assinatura.cliente_id !== ctx.usuario.id && ctx.usuario.papel !== 'admin') {
      throw new ErroHttp(403, 'Não autorizado.');
    }

    if (assinatura.status === 'cancelada') throw new ErroHttp(400, 'Assinatura já cancelada.');

    const gateway = getPagamentoGateway();
    if (assinatura.gateway_assinatura_id) {
      await gateway.cancelarAssinatura(assinatura.gateway_assinatura_id);
    }

    db.prepare("UPDATE assinaturas SET status = 'cancelada', cancelada_em = datetime('now') WHERE id = ?").run(id);
    // Cancela faturas pendentes
    db.prepare("UPDATE faturas SET status = 'cancelada' WHERE assinatura_id = ? AND status = 'pendente'").run(id);

    return { ok: true, message: 'Assinatura cancelada.' };
  });

  // POST /api/metodos-pagamento - salva token do cartão (cliente logado)
  r.post('/api/metodos-pagamento', auth.exigirLogin, async (ctx) => {
    const gatewayToken = v.texto(ctx.body.gateway_token, 'o token do gateway', { min: 10 });
    const tipo = v.texto(ctx.body.tipo, 'o tipo', { max: 10 }, 'cartao');
    const marca = v.texto(ctx.body.marca, 'a marca', { max: 20, opcional: true });
    const ultimos4 = v.texto(ctx.body.ultimos4, 'os últimos 4 dígitos', { max: 4, opcional: true });
    const expiracao = v.texto(ctx.body.expiracao, 'a expiração MM/AA', { max: 5, opcional: true });
    const padrao = v.booleano(ctx.body.padrao, 'padrão', false);

    const gateway = getPagamentoGateway();

    // Se for padrão, remove padrão anterior
    if (padrao) {
      db.prepare('UPDATE metodos_pagamento SET padrao = 0 WHERE cliente_id = ?').run(ctx.usuario.id);
    }

    const id = db.prepare(
      `INSERT INTO metodos_pagamento (cliente_id, gateway, gateway_token, tipo, marca, ultimos4, expiracao, padrao)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(ctx.usuario.id, gateway.gateway, gatewayToken, tipo, marca, ultimos4, expiracao, padrao ? 1 : 0).lastInsertRowid;

    return { metodo: metodoPagamentoParaJson(db.prepare('SELECT * FROM metodos_pagamento WHERE id = ?').get(id)) };
  });

  // GET /api/metodos-pagamento - lista métodos do cliente
  r.get('/api/metodos-pagamento', auth.exigirLogin, (ctx) => {
    const metodos = db.prepare('SELECT * FROM metodos_pagamento WHERE cliente_id = ? ORDER BY padrao DESC, criado_em DESC').all(ctx.usuario.id);
    return { metodos: metodos.map(metodoPagamentoParaJson) };
  });

  // DELETE /api/metodos-pagamento/:id - remove método
  r.delete('/api/metodos-pagamento/:id', auth.exigirLogin, (ctx) => {
    const id = v.idDaUrl(ctx.params.id);
    db.prepare('DELETE FROM metodos_pagamento WHERE id = ? AND cliente_id = ?').run(id, ctx.usuario.id);
    return { ok: true };
  });

  // POST /api/webhook/mercadopago - webhook do Mercado Pago
  r.post('/api/webhook/mercadopago', async (ctx) => {
    const signature = ctx.req.headers['x-signature'] || ctx.req.headers['x-mp-signature'];
    const payload = ctx.body;

    // Idempotency: usa o ID do evento do Mercado Pago (data.id) ou hash do payload
    const eventoId = payload?.data?.id || payload?.id || require('node:crypto').createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);

    // Registra o evento ANTES de processar (idempotência real - evita race condition)
    const insertResult = db.prepare('INSERT OR IGNORE INTO webhook_eventos (evento_id, gateway, tipo, payload, processado_em) VALUES (?, ?, ?, ?, datetime(\'now\'))')
      .run(eventoId, gateway.gateway, 'pendente', JSON.stringify(payload));

    // Se não inseriu (já existia), retorna duplicado
    if (insertResult.changes === 0) {
      return { received: true, duplicado: true };
    }

    try {
      const evento = await gateway.processarWebhook(payload, signature);

      // Atualiza o tipo do evento agora que sabemos qual é
      db.prepare('UPDATE webhook_eventos SET tipo = ? WHERE evento_id = ? AND gateway = ?')
        .run(evento.tipo, eventoId, gateway.gateway);

      switch (evento.tipo) {
        case 'pagamento_aprovado': {
          const fatura = db.prepare('SELECT * FROM faturas WHERE gateway_fatura_id = ?').get(evento.dados.fatura_id);
          if (fatura) {
            db.prepare("UPDATE faturas SET status = 'paga', paga_em = datetime('now') WHERE id = ?").run(fatura.id);
            // Atualiza próxima cobrança da assinatura
            const assinatura = db.prepare('SELECT * FROM assinaturas WHERE id = ?').get(fatura.assinatura_id);
            if (assinatura && assinatura.status === 'ativa') {
              const plano = db.prepare('SELECT intervalo_dias FROM planos WHERE id = ?').get(assinatura.plano_id);
              const proxima = new Date(new Date(fatura.vencimento).getTime() + plano.intervalo_dias * 24 * 60 * 60 * 1000).toISOString();
              db.prepare("UPDATE assinaturas SET proxima_cobranca = ? WHERE id = ?").run(proxima, assinatura.id);
              // Cria próxima fatura
              db.prepare(
                `INSERT INTO faturas (assinatura_id, gateway_fatura_id, valor_centavos, status, vencimento)
                 VALUES (?, ?, ?, 'pendente', ?)`
              ).run(assinatura.id, `next_${Date.now()}`, fatura.valor_centavos, proxima);
            }
          }
          break;
        }
        case 'pagamento_recusado': {
          const fatura = db.prepare('SELECT * FROM faturas WHERE gateway_fatura_id = ?').get(evento.dados.fatura_id);
          if (fatura) {
            db.prepare("UPDATE faturas SET status = 'falhou' WHERE id = ?").run(fatura.id);
            db.prepare("UPDATE assinaturas SET status = 'atrasada' WHERE id = ?").run(fatura.assinatura_id);
          }
          break;
        }
        case 'assinatura_cancelada': {
          const assinatura = db.prepare('SELECT * FROM assinaturas WHERE gateway_assinatura_id = ?').get(evento.dados.assinatura_id);
          if (assinatura) {
            db.prepare("UPDATE assinaturas SET status = 'cancelada', cancelada_em = datetime('now') WHERE id = ?").run(assinatura.id);
            db.prepare("UPDATE faturas SET status = 'cancelada' WHERE assinatura_id = ? AND status = 'pendente'").run(assinatura.id);
          }
          break;
        }
      }

      return { received: true };
    } catch (erro) {
      console.error('Webhook erro:', erro);
      throw new ErroHttp(400, 'Webhook inválido');
    }
  });

  return r;
}

module.exports = { criarRotas };
