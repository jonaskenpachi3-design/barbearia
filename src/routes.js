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
  return { id: s.id, nome: s.nome, duracao_min: s.duracao_min, preco_centavos: s.preco_centavos, ativo: !!s.ativo };
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

  r.get('/api/auth/me', auth.exigirLogin, (ctx) => ({ usuario: ctx.usuario }));

  // ───────────────────────── Serviços ─────────────────────────

  r.get('/api/servicos', (ctx) => {
    const admin = ctx.usuario && ctx.usuario.papel === 'admin';
    const linhas = db.prepare(
      `SELECT * FROM servicos ${admin ? '' : 'WHERE ativo = 1'} ORDER BY nome COLLATE NOCASE`
    ).all();
    return { servicos: linhas.map(servicoParaJson) };
  });

  r.post('/api/servicos', soAdmin, (ctx) => {
    const nome = v.texto(ctx.body.nome, 'o nome do serviço', { max: 60 });
    const duracao = v.inteiro(ctx.body.duracao_min, 'A duração', { min: 5, max: 480 });
    const preco = v.inteiro(ctx.body.preco_centavos, 'O preço', { min: 0, max: 10_000_000 });
    const ativo = v.booleano(ctx.body.ativo, 'ativo', true);
    const id = db.prepare(
      'INSERT INTO servicos (nome, duracao_min, preco_centavos, ativo) VALUES (?, ?, ?, ?)'
    ).run(nome, duracao, preco, ativo ? 1 : 0).lastInsertRowid;
    ctx.status = 201;
    return { servico: servicoParaJson(db.prepare('SELECT * FROM servicos WHERE id = ?').get(id)) };
  });

  r.put('/api/servicos/:id', soAdmin, (ctx) => {
    const id = v.idDaUrl(ctx.params.id);
    const atual = db.prepare('SELECT * FROM servicos WHERE id = ?').get(id);
    if (!atual) throw new ErroHttp(404, 'Serviço não encontrado.');
    const nome = v.texto(ctx.body.nome, 'o nome do serviço', { max: 60 });
    const duracao = v.inteiro(ctx.body.duracao_min, 'A duração', { min: 5, max: 480 });
    const preco = v.inteiro(ctx.body.preco_centavos, 'O preço', { min: 0, max: 10_000_000 });
    const ativo = v.booleano(ctx.body.ativo, 'ativo', !!atual.ativo);
    db.prepare('UPDATE servicos SET nome = ?, duracao_min = ?, preco_centavos = ?, ativo = ? WHERE id = ?')
      .run(nome, duracao, preco, ativo ? 1 : 0, id);
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

    // Verifica conflitos com agendamentos existentes
    const conflito = db.prepare(`
      SELECT 1 FROM agendamentos
      WHERE barbeiro_id = ? AND status IN ('pendente','confirmado')
        AND inicio < ? AND fim > ?
    `).get(barbeiroId, fimISO, inicio);
    if (conflito) throw new ErroHttp(409, 'Horário não disponível (conflito com outro agendamento).');

    // Verifica bloqueios
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
    const agendamentos = db.prepare(`
      SELECT a.*, s.nome as servico_nome, s.duracao_min as servico_duracao, s.preco_centavos as servico_preco,
             u.nome as barbeiro_nome
      FROM agendamentos a
      JOIN servicos s ON s.id = a.servico_id
      JOIN barbeiros b ON b.id = a.barbeiro_id
      JOIN usuarios u ON u.id = b.usuario_id
      WHERE a.cliente_id = ?
      ORDER BY a.inicio DESC
    `).all(ctx.usuario.id);

    const agora = new Date().toISOString().slice(0, 19).replace('T', 'T');
    const proximos = agendamentos.filter(a => a.inicio >= agora && a.status !== 'cancelado');
    const historico = agendamentos.filter(a => a.inicio < agora || a.status === 'cancelado');

    return {
      proximos: proximos.map(a => agendamentoParaJson(a, true)),
      historico: historico.map(a => agendamentoParaJson(a, true))
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

    const agendamentos = db.prepare(`
      SELECT a.*, s.nome as servico_nome, s.duracao_min as servico_duracao, s.preco_centavos as servico_preco,
             u.nome as cliente_nome, u.telefone as cliente_telefone
      FROM agendamentos a
      JOIN servicos s ON s.id = a.servico_id
      JOIN usuarios u ON u.id = a.cliente_id
      ${where}
      ORDER BY a.inicio
    `).all(...params);

    return { data, agendamentos: agendamentos.map(a => agendamentoParaJson(a, true)) };
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
    `).all(...params);

    return { data, agendamentos: agendamentos.map(a => agendamentoParaJson(a, true)) };
  });

  // ───────────────────────── Fase 2: Bloqueios (Admin) ─────────────────────────

  r.get('/api/bloqueios', soAdmin, (ctx) => {
    const barbeiroId = ctx.query.barbeiro ? v.inteiro(ctx.query.barbeiro, 'ID do barbeiro', { min: 1 }) : null;
    const data = ctx.query.data ? v.dataISO(ctx.query.data) : null;

    let where = 'WHERE 1=1';
    const params = [];
    if (barbeiroId) { where += ' AND (barbeiro_id = ? OR barbeiro_id IS NULL)'; params.push(barbeiroId); }
    if (data) { where += ' AND date(inicio) = date(?)'; params.push(data); }

    const bloqueios = db.prepare(`
      SELECT b.*, u.nome as criador_nome
      FROM bloqueios b
      JOIN usuarios u ON u.id = b.criado_por
      ${where}
      ORDER BY b.inicio
    `).all(...params);

    return { bloqueios };
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

  return r;
}

module.exports = { criarRotas };
