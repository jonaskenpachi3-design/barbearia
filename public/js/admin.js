'use strict';
(async function () {
  const { api, el, brl, iniciais, exigir, sair, toast, DIAS, ORDEM_DIAS } = window.App;
  const $ = (id) => document.getElementById(id);

  const estado = { servicos: [], barbeiros: [], produtos: [], planos: [], clientes: [] };

  // ───────────── utilidades ─────────────

  function reaisParaCentavos(texto) {
    let t = String(texto).trim().replace(/\s/g, '');
    if (!t) return NaN;
    t = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
    return Math.round(Number(t) * 100);
  }
  const centavosParaReais = (c) => (c / 100).toFixed(2).replace('.', ',');

  function mostrarErro(id, mensagem) {
    $(id).textContent = mensagem || '';
    $(id).hidden = !mensagem;
  }

  async function recarregar() {
    const [{ servicos }, { barbeiros }, { produtos }, { planos }] = await Promise.all([
      api.get('/api/servicos'),
      api.get('/api/barbeiros'),
      api.get('/api/produtos'),
      api.get('/api/planos'),
    ]);
    estado.servicos = servicos;
    estado.barbeiros = barbeiros;
    estado.produtos = produtos;
    estado.planos = planos;
    // Clientes para PDV
    try {
      const resp = await api.get('/api/servicos'); // reuse auth
      estado.clientes = (await api.get('/api/auth/me')).usuario.papel === 'admin' ? [] : [];
    } catch {}
    desenharServicos();
    desenharBarbeiros();
    desenharProdutos();
    desenharPlanos();
    preencheSelectBarbeiros();
    preencheSelectClientes();
  }

  function statusPill(ativo) {
    return el('span', { class: `pill ${ativo ? 'pill-ok' : 'pill-off'}`, text: ativo ? 'Ativo' : 'Inativo' });
  }

  function statusPillAgend(status) {
    const map = { pendente: 'pill-pendente', confirmado: 'pill-confirmado', cancelado: 'pill-cancelado', concluido: 'pill-concluido' };
    const label = { pendente: 'Pendente', confirmado: 'Confirmado', cancelado: 'Cancelado', concluido: 'Concluído' };
    return el('span', { class: `pill ${map[status] || ''}`, text: label[status] || status });
  }

  function statusPillComissao(status) {
    const map = { a_receber: 'pill-pendente', pago: 'pill-concluido' };
    const label = { a_receber: 'A receber', pago: 'Pago' };
    return el('span', { class: `pill ${map[status] || ''}`, text: label[status] || status });
  }

  function statusPillCaixa(status) {
    const map = { aberto: 'pill-ok', fechado: 'pill-off' };
    const label = { aberto: 'Aberto', fechado: 'Fechado' };
    return el('span', { class: `pill ${map[status] || ''}`, text: label[status] || status });
  }

  function tabela(colunas, linhas, vazio) {
    if (!linhas.length) return el('div', { class: 'vazio', text: vazio });
    return el('table', {},
      el('thead', {}, el('tr', {}, colunas.map(([nome, classe]) => el('th', { scope: 'col', class: classe, text: nome })))),
      el('tbody', {}, linhas));
  }

  // ───────────── navegação ─────────────

  function mostrar(secao) {
    for (const nome of ['dashboard', 'servicos', 'barbeiros', 'agenda', 'bloqueios', 'produtos', 'planos', 'pdv', 'caixa', 'comissoes']) {
      $(`view-${nome}`).hidden = nome !== secao;
      const botao = $(`nav-${nome}`);
      if (botao) {
        if (nome === secao) botao.setAttribute('aria-current', 'page');
        else botao.removeAttribute('aria-current');
      }
    }
  }
  $('nav-dashboard').addEventListener('click', () => { mostrar('dashboard'); carregarDashboard(); });
  $('nav-servicos').addEventListener('click', () => mostrar('servicos'));
  $('nav-barbeiros').addEventListener('click', () => mostrar('barbeiros'));
  $('nav-agenda').addEventListener('click', () => { mostrar('agenda'); carregarAgendaAdmin(); });
  $('nav-bloqueios').addEventListener('click', () => { mostrar('bloqueios'); carregarBloqueios(); });
  $('nav-produtos').addEventListener('click', () => { mostrar('produtos'); });
  $('nav-planos').addEventListener('click', () => mostrar('planos'));
  $('nav-pdv').addEventListener('click', () => { mostrar('pdv'); initPDV(); });
  $('nav-caixa').addEventListener('click', () => { mostrar('caixa'); carregarCaixaHistorico(); });
  $('nav-comissoes').addEventListener('click', () => { mostrar('comissoes'); carregarComissoes(); carregarComissoesResumo(); });
  $('sair').addEventListener('click', sair);

  // ───────────── Dashboard ─────────────

  async function carregarDashboard() {
    try {
      // Carrega KPIs
      const { kpis } = await api.get('/api/admin/dashboard');
      atualizarKPIs(kpis);

      // Carrega dados para gráficos e tabela
      const relatorio = await api.get('/api/admin/relatorio-financeiro');
      desenharGraficoFaturamentoDia(relatorio.faturamento_por_periodo);
      desenharGraficoFaturamentoServico(relatorio.faturamento_por_servico);
      desenharTabelaFaturamentoBarbeiro(relatorio.faturamento_por_barbeiro);
    } catch (erro) {
      toast(erro.message, true);
      $('kpi-cards').innerHTML = '<div class="vazio">Erro ao carregar dashboard.</div>';
    }
  }

  function atualizarKPIs(kpis) {
    const container = $('kpi-cards');
    const cards = [
      { titulo: 'Ocupação', valor: `${kpis.ocupacao_pct}%`, cor: 'var(--accent)', icone: 'icon-chart' },
      { titulo: 'No-show', valor: `${kpis.no_show_pct}%`, cor: 'var(--bad)', icone: 'icon-alert' },
      { titulo: 'Ticket Médio', valor: brl(kpis.ticket_medio_centavos), cor: 'var(--ok)', icone: 'icon-percent' },
      { titulo: 'Faturamento (30d)', valor: brl(kpis.faturamento_centavos), cor: 'var(--muted)', icone: 'icon-money' },
    ];

    container.replaceChildren(...cards.map((c) => el('div', { class: 'kpi-card' },
      el('div', { class: 'kpi-icon', style: `background: ${c.cor}20; color: ${c.cor}` },
        el('svg', { class: 'kpi-icon-svg', 'aria-hidden': 'true' }, el('use', { href: `icons/icons.svg#${c.icone}` }))
      ),
      el('div', { class: 'kpi-content' },
        el('div', { class: 'kpi-label', text: c.titulo }),
        el('div', { class: 'kpi-value', style: `color: ${c.cor}`, text: c.valor })
      ))));
  }

  // Desenha gráfico de barras vertical simples em canvas
  function desenharGraficoBarras(canvasId, dados, { corBarra = 'var(--cor-primaria)', corTexto = 'var(--ink)', maxBarras = 30 } = {}) {
    const canvas = $(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const width = Math.max(rect.width - 32, 300);
    const height = 300;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.scale(dpr, dpr);

    // Limpa
    ctx.clearRect(0, 0, width, height);

    if (!dados || !dados.length) {
      ctx.font = '14px Inter';
      ctx.fillStyle = 'var(--muted)';
      ctx.textAlign = 'center';
      ctx.fillText('Sem dados para exibir', width / 2, height / 2);
      return;
    }

    // Limita número de barras
    const dadosExibicao = dados.slice(-maxBarras);
    const maxValor = Math.max(...dadosExibicao.map(d => d.total || d.valor || 0), 1);
    const padding = 40;
    const bottomPadding = 30;
    const topPadding = 20;
    const chartWidth = width - 2 * padding;
    const chartHeight = height - topPadding - bottomPadding;
    const barWidth = Math.max(chartWidth / dadosExibicao.length * 0.7, 8);
    const gap = (chartWidth - barWidth * dadosExibicao.length) / (dadosExibicao.length + 1);

    // Eixo Y (linhas de grade)
    ctx.strokeStyle = 'var(--line)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = topPadding + (chartHeight / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();

      // Valores no eixo Y
      const val = maxValor * (1 - i / 4);
      ctx.font = '11px Inter';
      ctx.fillStyle = 'var(--muted)';
      ctx.textAlign = 'right';
      ctx.fillText(brl(Math.round(val)), padding - 8, y + 4);
    }

    // Barras
    for (let i = 0; i < dadosExibicao.length; i++) {
      const item = dadosExibicao[i];
      const valor = item.total || item.valor || 0;
      const barHeight = (valor / maxValor) * chartHeight;
      const x = padding + gap + i * (barWidth + gap);
      const y = topPadding + chartHeight - barHeight;

      // Gradiente para a barra
      const gradient = ctx.createLinearGradient(0, topPadding + chartHeight, 0, topPadding);
      gradient.addColorStop(0, corBarra);
      gradient.addColorStop(1, corBarra + 'CC');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      const radius = 4;
      ctx.roundRect(x, y, barWidth, barHeight, radius);
      ctx.fill();

      // Label no eixo X (data ou nome do serviço)
      const label = item.data ? new Date(item.data + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
        : (item.nome || '').substring(0, 12);
      ctx.font = '10px Inter';
      ctx.fillStyle = 'var(--muted)';
      ctx.textAlign = 'center';
      ctx.fillText(label, x + barWidth / 2, height - bottomPadding + 16);
    }

    // Eixo X
    ctx.strokeStyle = 'var(--line)';
    ctx.beginPath();
    ctx.moveTo(padding, topPadding + chartHeight);
    ctx.lineTo(width - padding, topPadding + chartHeight);
    ctx.stroke();
  }

  function desenharGraficoFaturamentoDia(dados) {
    // Formata dados: { data, total }
    const dadosFormatados = (dados || []).map(d => ({ data: d.data, total: d.total }));
    desenharGraficoBarras('chart-faturamento-dia', dadosFormatados, { corBarra: 'var(--cor-primaria)' });
  }

  function desenharGraficoFaturamentoServico(dados) {
    // Formata dados: { nome, total }
    const dadosFormatados = (dados || []).map(d => ({ nome: d.servico_nome || d.nome, total: d.total_centavos || d.total }));
    desenharGraficoBarras('chart-faturamento-servico', dadosFormatados, { corBarra: 'var(--cor-sucesso)', maxBarras: 10 });
  }

  function desenharTabelaFaturamentoBarbeiro(dados) {
    const container = $('tabela-faturamento-barbeiro');
    if (!dados || !dados.length) {
      container.innerHTML = '<div class="vazio">Nenhum faturamento por barbeiro no período.</div>';
      return;
    }

    const linhas = dados.map((b) => el('tr', {},
      el('td', {}, el('strong', { text: b.barbeiro_nome })),
      el('td', { class: 'num', text: brl(b.total_centavos || b.faturamento || 0) }),
      el('td', { class: 'num', text: String(b.qtd_atendimentos || b.qtd_vendas || 0) }),
      el('td', { class: 'num', text: brl(Math.round((b.comissoes || 0) / (b.total_centavos || b.faturamento || 1) * 100)) + '%' })));

    container.replaceChildren(tabela(
      [['Barbeiro'], ['Faturamento', 'num'], ['Atendimentos', 'num'], ['% Comissão', 'num']],
      linhas));
  }

  // ───────────── Preenche selects ─────────────

  function preencheSelectBarbeiros() {
    const ativos = estado.barbeiros.filter(b => b.ativo);
    const selects = ['adm-barbeiro', 'bl-barbeiro', 'pdv-barbeiro', 'com-barbeiro'];
    for (const selId of selects) {
      const sel = $(selId);
      if (!sel) continue;
      const valorAtual = sel.value;
      const firstOpt = sel.querySelector('option');
      sel.innerHTML = '';
      if (firstOpt) sel.append(firstOpt);
      for (const b of ativos) {
        sel.append(el('option', { value: String(b.id) }, b.nome));
      }
      sel.value = valorAtual || '';
    }
  }

  function preencheSelectClientes() {
    // Clientes são carregados sob demanda no PDV
  }

  // ───────────── serviços ─────────────

  function desenharServicos() {
    const linhas = estado.servicos.map((s) => el('tr', {},
      el('td', {}, el('strong', { text: s.nome })),
      el('td', { text: categoriaLabel(s.categoria) }),
      el('td', { text: `${s.duracao_min} min` }),
      el('td', { text: brl(s.preco_centavos) }),
      el('td', {}, statusPill(s.ativo)),
      el('td', { class: 'acoes' },
        el('button', { class: 'btn btn-small btn-line', type: 'button', text: 'Editar', onclick: () => abrirServico(s) }),
        ' ',
        el('button', {
          class: 'btn btn-small btn-line', type: 'button', text: s.ativo ? 'Desativar' : 'Ativar',
          onclick: () => alternarServico(s),
        }))));
    $('tabela-servicos').replaceChildren(tabela(
      [['Serviço'], ['Categoria'], ['Duração'], ['Preço'], ['Status'], ['', 'acoes']],
      linhas, 'Nenhum serviço cadastrado. Comece criando o primeiro.'));
  }

  function categoriaLabel(cat) {
    const labels = { individual: 'Individual', combo: 'Conjunto / Combo', plano: 'Plano' };
    return labels[cat] || cat;
  }

  async function alternarServico(s) {
    try {
      await api.put(`/api/servicos/${s.id}`, {
        nome: s.nome, categoria: s.categoria, duracao_min: s.duracao_min, preco_centavos: s.preco_centavos, ativo: !s.ativo,
      });
      await recarregar();
      toast(s.ativo ? 'Serviço desativado.' : 'Serviço ativado.');
    } catch (erro) {
      toast(erro.message, true);
    }
  }

  let servicoEditando = null;
  function abrirServico(servico) {
    servicoEditando = servico || null;
    $('dlg-servico-titulo').textContent = servico ? 'Editar serviço' : 'Novo serviço';
    $('sv-nome').value = servico ? servico.nome : '';
    $('sv-categoria').value = servico ? servico.categoria : 'individual';
    $('sv-duracao').value = servico ? servico.duracao_min : 30;
    $('sv-preco').value = servico ? centavosParaReais(servico.preco_centavos) : '';
    $('sv-ativo').checked = servico ? servico.ativo : true;
    $('sv-ativo-wrap').hidden = !servico;
    mostrarErro('sv-erro', '');
    $('dlg-servico').showModal();
    $('sv-nome').focus();
  }
  $('novo-servico').addEventListener('click', () => abrirServico(null));
  $('sv-cancelar').addEventListener('click', () => $('dlg-servico').close());

  $('form-servico').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    mostrarErro('sv-erro', '');
    const preco = reaisParaCentavos($('sv-preco').value);
    if (Number.isNaN(preco)) return mostrarErro('sv-erro', 'Informe o preço, por exemplo 45,00.');
    const corpo = {
      nome: $('sv-nome').value,
      categoria: $('sv-categoria').value,
      duracao_min: parseInt($('sv-duracao').value, 10),
      preco_centavos: preco,
    };
    if (servicoEditando) corpo.ativo = $('sv-ativo').checked;
    $('sv-salvar').disabled = true;
    try {
      if (servicoEditando) await api.put(`/api/servicos/${servicoEditando.id}`, corpo);
      else await api.post('/api/servicos', corpo);
      $('dlg-servico').close();
      await recarregar();
      toast('Serviço salvo.');
    } catch (erro) {
      mostrarErro('sv-erro', erro.message);
    } finally {
      $('sv-salvar').disabled = false;
    }
  });

  // ───────────── barbeiros ─────────────

  function desenharBarbeiros() {
    const linhas = estado.barbeiros.map((b) => el('tr', {},
      el('td', {},
        el('div', { class: 'barber' },
          el('span', { class: 'avatar light', 'aria-hidden': 'true', text: iniciais(b.nome) }),
          el('div', {},
            el('strong', { text: b.nome }),
            el('div', { class: 'small muted', text: b.email })))),
      el('td', { text: `${b.servicos.length} serviço${b.servicos.length === 1 ? '' : 's'}` }),
      el('td', { text: resumoJornada(b.horarios) }),
      el('td', { text: `${b.comissao_pct}%` }),
      el('td', {}, statusPill(b.ativo)),
      el('td', { class: 'acoes' },
        el('button', { class: 'btn btn-small btn-line', type: 'button', text: 'Editar', onclick: () => abrirBarbeiro(b) }))));
    $('tabela-barbeiros').replaceChildren(tabela(
      [['Barbeiro'], ['Serviços'], ['Jornada'], ['Comissão'], ['Status'], ['', 'acoes']],
      linhas, 'Nenhum barbeiro cadastrado. Cadastre o primeiro para montar a equipe.'));
  }

  function resumoJornada(horarios) {
    if (!horarios.length) return 'Sem horários';
    const dias = new Set(horarios.map((h) => h.dia_semana));
    return `${dias.size} dia${dias.size === 1 ? '' : 's'} por semana`;
  }

  let jornada = {};
  let barbeiroEditando = null;

  function jornadaVazia() {
    return Object.fromEntries(ORDEM_DIAS.map((d) => [d, []]));
  }

  function desenharJornada() {
    $('jornada').replaceChildren(...ORDEM_DIAS.map((dia) => {
      const turnos = jornada[dia];
      return el('div', { class: 'dia' },
        el('div', { class: 'nome', text: DIAS[dia] }),
        el('div', { class: 'turnos' },
          turnos.length ? turnos.map((t, i) => campoTurno(dia, i, t)) : el('span', { class: 'folga', text: 'Folga' })),
        el('button', {
          class: 'btn btn-small btn-line', type: 'button', text: '+ Turno',
          'aria-label': `Adicionar turno de ${DIAS[dia]}`,
          onclick: () => { jornada[dia].push({ inicio: '09:00', fim: '18:00' }); desenharJornada(); },
        }));
    }));
  }

  function campoTurno(dia, i, turno) {
    const hora = (campo, rotulo) => el('input', {
      class: 'input time', type: 'time', value: turno[campo], required: true,
      'aria-label': `${DIAS[dia]}, turno ${i + 1}, ${rotulo}`,
      onchange: (e) => { turno[campo] = e.target.value; },
    });
    return el('div', { class: 'turno-edit' },
      hora('inicio', 'início'), el('span', { text: 'às' }), hora('fim', 'fim'),
      el('button', {
        class: 'icon-btn', type: 'button', text: '×',
        'aria-label': `Remover turno ${i + 1} de ${DIAS[dia]}`,
        onclick: () => { jornada[dia].splice(i, 1); desenharJornada(); },
      }));
  }

  function jornadaParaLista() {
    return ORDEM_DIAS.flatMap((dia) => jornada[dia].map((t) => ({ dia_semana: dia, inicio: t.inicio, fim: t.fim })));
  }

  $('bb-padrao').addEventListener('click', () => {
    jornada = jornadaVazia();
    for (const dia of [1, 2, 3, 4, 5]) jornada[dia].push({ inicio: '09:00', fim: '18:00' });
    desenharJornada();
  });
  $('bb-limpar').addEventListener('click', () => { jornada = jornadaVazia(); desenharJornada(); });

  function abrirBarbeiro(barbeiro) {
    barbeiroEditando = barbeiro || null;
    $('dlg-barbeiro-titulo').textContent = barbeiro ? 'Editar barbeiro' : 'Novo barbeiro';
    $('bb-nome').value = barbeiro ? barbeiro.nome : '';
    $('bb-telefone').value = barbeiro ? barbeiro.telefone || '' : '';
    $('bb-email').value = barbeiro ? barbeiro.email : '';
    $('bb-email').disabled = !!barbeiro;
    $('bb-senha').value = '';
    $('bb-senha-wrap').hidden = !!barbeiro;
    $('bb-comissao').value = barbeiro ? barbeiro.comissao_pct : 40;
    $('bb-ativo').checked = barbeiro ? barbeiro.ativo : true;
    $('bb-ativo-wrap').hidden = !barbeiro;

    const marcados = new Set(barbeiro ? barbeiro.servicos : []);
    $('bb-servicos').replaceChildren(...(estado.servicos.length
      ? estado.servicos.map((s) => el('label', { class: 'check' },
          el('input', { type: 'checkbox', value: String(s.id), checked: marcados.has(s.id) }),
          s.ativo ? s.nome : `${s.nome} (inativo)`))
      : [el('span', { class: 'muted small', text: 'Cadastre serviços primeiro.' })]));

    jornada = jornadaVazia();
    for (const h of barbeiro ? barbeiro.horarios : []) jornada[h.dia_semana].push({ inicio: h.inicio, fim: h.fim });
    desenharJornada();

    mostrarErro('bb-erro', '');
    $('dlg-barbeiro').showModal();
    $('bb-nome').focus();
  }
  $('novo-barbeiro').addEventListener('click', () => abrirBarbeiro(null));
  $('bb-cancelar').addEventListener('click', () => $('dlg-barbeiro').close());

  $('form-barbeiro').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    mostrarErro('bb-erro', '');
    const servicos = [...$('bb-servicos').querySelectorAll('input:checked')].map((i) => Number(i.value));
    const corpo = {
      nome: $('bb-nome').value,
      telefone: $('bb-telefone').value,
      comissao_pct: parseInt($('bb-comissao').value, 10),
      servicos,
    };
    $('bb-salvar').disabled = true;
    let salvoId = null;
    try {
      if (barbeiroEditando) {
        corpo.ativo = $('bb-ativo').checked;
        await api.put(`/api/barbeiros/${barbeiroEditando.id}`, corpo);
        salvoId = barbeiroEditando.id;
      } else {
        corpo.email = $('bb-email').value;
        corpo.senha = $('bb-senha').value;
        const { barbeiro } = await api.post('/api/barbeiros', corpo);
        salvoId = barbeiro.id;
        barbeiroEditando = barbeiro;
      }
      await api.put(`/api/barbeiros/${salvoId}/horarios`, { horarios: jornadaParaLista() });
      $('dlg-barbeiro').close();
      await recarregar();
      toast('Barbeiro salvo.');
    } catch (erro) {
      mostrarErro('bb-erro', salvoId ? `Dados salvos, mas a jornada não: ${erro.message}` : erro.message);
      if (salvoId) {
        $('bb-email').disabled = true;
        $('bb-senha-wrap').hidden = true;
        $('bb-ativo-wrap').hidden = false;
        $('bb-ativo').checked = true;
        await recarregar().catch(() => {});
      }
    } finally {
      $('bb-salvar').disabled = false;
    }
  });

  // ───────────── Agenda Admin ─────────────

  async function carregarAgendaAdmin() {
    const data = $('adm-data').value || new Date().toISOString().split('T')[0];
    $('adm-data').value = data;
    const barbeiroId = $('adm-barbeiro').value || undefined;
    const status = $('adm-status').value || undefined;

    const container = $('tabela-agenda');
    container.innerHTML = '<div class="vazio">Carregando agenda...</div>';

    try {
      let url = `/api/agenda-admin?data=${data}`;
      if (barbeiroId) url += `&barbeiro=${barbeiroId}`;
      if (status) url += `&status=${status}`;

      const { agendamentos } = await api.get(url);

      if (!agendamentos.length) {
        container.innerHTML = '';
        container.append(el('div', { class: 'vazio' },
          el('span', { class: 'vazio-icon', 'aria-hidden': 'true' },
            el('svg', { 'aria-hidden': 'true' }, el('use', { href: 'icons/icons.svg#icon-calendar' }))
          ),
          el('div', { text: 'Nenhum agendamento para esta data' })));
        return;
      }

      const linhas = agendamentos.map((a) => {
        const dt = new Date(a.inicio);
        const dataFmt = dt.toLocaleDateString('pt-BR');
        const hora = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

        return el('tr', {},
          el('td', { text: dataFmt }),
          el('td', { text: hora }),
          el('td', { text: a.cliente_nome }),
          el('td', { text: a.barbeiro_nome }),
          el('td', { text: a.servico_nome }),
          el('td', {}, statusPillAgend(a.status)),
          el('td', { class: 'acoes' },
            a.status === 'pendente' ? el('button', {
              class: 'btn btn-small btn-primary', type: 'button', text: 'Confirmar',
              onclick: () => confirmarAgendamentoAdmin(a.id)
            }) : '',
            a.status === 'confirmado' ? el('button', {
              class: 'btn btn-small btn-primary', type: 'button', text: 'Concluir',
              onclick: () => concluirAgendamentoAdmin(a.id)
            }) : '',
            (a.status === 'pendente' || a.status === 'confirmado') ? el('button', {
              class: 'btn btn-small btn-danger', type: 'button', text: 'Cancelar',
              onclick: () => cancelarAgendamentoAdmin(a.id)
            }) : ''
          ));
      });

      container.replaceChildren(tabela(
        [['Data'], ['Hora'], ['Cliente'], ['Barbeiro'], ['Serviço'], ['Status'], ['', 'acoes']],
        linhas));
    } catch (e) {
      toast(e.message, true);
      container.innerHTML = '<div class="vazio">Erro ao carregar agenda.</div>';
    }
  }

  async function confirmarAgendamentoAdmin(id) {
    try {
      await api.put(`/api/agendamentos/${id}/confirmar`);
      toast('Agendamento confirmado!');
      carregarAgendaAdmin();
    } catch (e) { toast(e.message, true); }
  }

  async function concluirAgendamentoAdmin(id) {
    if (!confirm('Marcar como concluído?')) return;
    try {
      await api.put(`/api/agendamentos/${id}/concluir`);
      toast('Agendamento concluído!');
      carregarAgendaAdmin();
    } catch (e) { toast(e.message, true); }
  }

  async function cancelarAgendamentoAdmin(id) {
    if (!confirm('Tem certeza que deseja cancelar este agendamento?')) return;
    try {
      await api.put(`/api/agendamentos/${id}/cancelar`);
      toast('Agendamento cancelado.');
      carregarAgendaAdmin();
    } catch (e) { toast(e.message, true); }
  }

  $('adm-data').addEventListener('change', carregarAgendaAdmin);
  $('adm-barbeiro').addEventListener('change', carregarAgendaAdmin);
  $('adm-status').addEventListener('change', carregarAgendaAdmin);

  // ───────────── Bloqueios ─────────────

  async function carregarBloqueios() {
    const data = $('bl-data').value || undefined;
    const barbeiroId = $('bl-barbeiro').value || undefined;

    const container = $('tabela-bloqueios');
    container.innerHTML = '<div class="vazio">Carregando bloqueios...</div>';

    try {
      let url = '/api/bloqueios';
      const params = [];
      if (barbeiroId) params.push(`barbeiro=${barbeiroId}`);
      if (data) params.push(`data=${data}`);
      if (params.length) url += '?' + params.join('&');

      const { bloqueios } = await api.get(url);

      if (!bloqueios.length) {
        container.innerHTML = '';
        container.append(el('div', { class: 'vazio' },
          el('span', { style: 'font-size: 32px; display: block; margin-bottom: 8px;', text: '🚫' }),
          el('div', { text: 'Nenhum bloqueio cadastrado' })));
        return;
      }

      const linhas = bloqueios.map((b) => {
        const ini = new Date(b.inicio);
        const fim = new Date(b.fim);
        const dataFmt = ini.toLocaleDateString('pt-BR');
        const horaFmt = `${ini.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} – ${fim.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
        const barbeiroNome = b.barbeiro_id ? (estado.barbeiros.find(x => x.id === b.barbeiro_id)?.nome || `ID ${b.barbeiro_id}`) : 'Todos';

        return el('tr', {},
          el('td', { text: dataFmt }),
          el('td', { text: horaFmt }),
          el('td', { text: barbeiroNome }),
          el('td', { text: b.motivo || '—' }),
          el('td', { text: b.criador_nome }),
          el('td', { class: 'acoes' },
            el('button', {
              class: 'btn btn-small btn-danger', type: 'button', text: 'Remover',
              onclick: () => removerBloqueio(b.id)
            })));
      });

      container.replaceChildren(tabela(
        [['Data'], ['Horário'], ['Barbeiro'], ['Motivo'], ['Criado por'], ['', 'acoes']],
        linhas));
    } catch (e) {
      toast(e.message, true);
      container.innerHTML = '<div class="vazio">Erro ao carregar bloqueios.</div>';
    }
  }

  function abrirBloqueio() {
    $('dlg-bloqueio-titulo').textContent = 'Bloquear horário';
    $('form-bloqueio').reset();
    $('bl-motivo').value = '';
    const agora = new Date();
    agora.setMinutes(Math.ceil(agora.getMinutes() / 15) * 15);
    const fim = new Date(agora.getTime() + 60 * 60 * 1000);
    $('bl-inicio').value = agora.toISOString().slice(0, 16);
    $('bl-fim').value = fim.toISOString().slice(0, 16);
    preencheSelectBarbeiros();
    mostrarErro('bl-erro', '');
    $('dlg-bloqueio').showModal();
    $('bl-motivo').focus();
  }
  $('novo-bloqueio').addEventListener('click', abrirBloqueio);
  $('bl-cancelar').addEventListener('click', () => $('dlg-bloqueio').close());

  $('form-bloqueio').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    mostrarErro('bl-erro', '');

    const barbeiroId = $('bl-barbeiro').value || null;
    const inicio = $('bl-inicio').value + ':00';
    const fim = $('bl-fim').value + ':00';

    if (new Date(fim) <= new Date(inicio)) {
      return mostrarErro('bl-erro', 'O fim deve ser depois do início.');
    }

    $('bl-salvar').disabled = true;
    try {
      await api.post('/api/bloqueios', {
        barbeiro_id: barbeiroId ? Number(barbeiroId) : null,
        inicio,
        fim,
        motivo: $('bl-motivo').value || undefined,
      });
      $('dlg-bloqueio').close();
      await carregarBloqueios();
      toast('Bloqueio criado.');
    } catch (erro) {
      mostrarErro('bl-erro', erro.message);
    } finally {
      $('bl-salvar').disabled = false;
    }
  });

  async function removerBloqueio(id) {
    if (!confirm('Tem certeza que deseja remover este bloqueio?')) return;
    try {
      await api.delete(`/api/bloqueios/${id}`);
      toast('Bloqueio removido.');
      carregarBloqueios();
    } catch (e) { toast(e.message, true); }
  }

  $('bl-data').addEventListener('change', carregarBloqueios);
  $('bl-barbeiro').addEventListener('change', carregarBloqueios);

  // ───────────── PLANOS (Fase 5) ─────────────

  function desenharPlanos() {
    const linhas = estado.planos.map((plano) => el('tr', {},
      el('td', {}, el('strong', { text: plano.nome })),
      el('td', { text: plano.descricao || '—' }),
      el('td', { text: brl(plano.preco_centavos) }),
      el('td', { text: `/${plano.intervalo_dias} dias` }),
      el('td', { text: (plano.beneficios || []).join(', ') || '—' }),
      el('td', {}, statusPill(plano.ativo)),
      el('td', { class: 'acoes' },
        el('button', { class: 'btn btn-small btn-line', type: 'button', text: 'Editar', onclick: () => abrirPlano(plano) }),
        ' ',
        el('button', {
          class: 'btn btn-small btn-line', type: 'button', text: plano.ativo ? 'Desativar' : 'Ativar',
          onclick: () => alternarPlano(plano),
        }))));
    $('tabela-planos').replaceChildren(tabela(
      [['Plano'], ['Descrição'], ['Preço'], ['Cobrança'], ['Benefícios'], ['Status'], ['', 'acoes']],
      linhas, 'Nenhum plano cadastrado. Comece criando o primeiro.'));
  }

  async function alternarPlano(plano) {
    try {
      await api.put(`/api/planos/${plano.id}`, {
        nome: plano.nome,
        descricao: plano.descricao || '',
        preco_centavos: plano.preco_centavos,
        intervalo_dias: plano.intervalo_dias,
        beneficios: plano.beneficios || [],
        ativo: !plano.ativo,
      });
      await recarregar();
      toast(plano.ativo ? 'Plano desativado.' : 'Plano ativado.');
    } catch (erro) {
      toast(erro.message, true);
    }
  }

  let planoEditando = null;
  function abrirPlano(plano) {
    planoEditando = plano || null;
    $('dlg-plano-titulo').textContent = plano ? 'Editar plano' : 'Novo plano';
    $('pl-nome').value = plano ? plano.nome : '';
    $('pl-descricao').value = plano ? plano.descricao || '' : '';
    $('pl-preco').value = plano ? centavosParaReais(plano.preco_centavos) : '';
    $('pl-intervalo').value = plano ? plano.intervalo_dias : 30;
    $('pl-beneficios').value = plano ? (plano.beneficios || []).join('\n') : '';
    $('pl-ativo').checked = plano ? plano.ativo : true;
    $('pl-ativo-wrap').hidden = !plano;
    mostrarErro('pl-erro', '');
    $('dlg-plano').showModal();
    $('pl-nome').focus();
  }
  $('novo-plano').addEventListener('click', () => abrirPlano(null));
  $('pl-cancelar').addEventListener('click', () => $('dlg-plano').close());

  $('form-plano').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    mostrarErro('pl-erro', '');
    const preco = reaisParaCentavos($('pl-preco').value);
    const intervalo = Number($('pl-intervalo').value);
    if (Number.isNaN(preco) || preco < 0) return mostrarErro('pl-erro', 'Informe um preço válido.');
    if (!Number.isInteger(intervalo) || intervalo < 1 || intervalo > 365) {
      return mostrarErro('pl-erro', 'Informe um intervalo entre 1 e 365 dias.');
    }
    const corpo = {
      nome: $('pl-nome').value.trim(),
      descricao: $('pl-descricao').value.trim(),
      preco_centavos: preco,
      intervalo_dias: intervalo,
      beneficios: $('pl-beneficios').value.split(/\r?\n/).map((beneficio) => beneficio.trim()).filter(Boolean),
      ativo: $('pl-ativo').checked,
    };
    $('pl-salvar').disabled = true;
    try {
      if (planoEditando) await api.put(`/api/planos/${planoEditando.id}`, corpo);
      else await api.post('/api/planos', corpo);
      $('dlg-plano').close();
      await recarregar();
      toast('Plano salvo.');
    } catch (erro) {
      mostrarErro('pl-erro', erro.message);
    } finally {
      $('pl-salvar').disabled = false;
    }
  });

  // ───────────── PRODUTOS (Fase 3) ─────────────

  function desenharProdutos() {
    const linhas = estado.produtos.map((p) => {
      const estoqueBaixo = p.quantidade <= p.qtd_minima && p.qtd_minima > 0;
      const statusClass = estoqueBaixo ? 'pill-pendente' : (p.ativo ? 'pill-ok' : 'pill-off');
      const statusText = estoqueBaixo ? `! Baixo (${p.quantidade}/${p.qtd_minima})` : (p.ativo ? 'Ativo' : 'Inativo');
      return el('tr', {},
        el('td', {}, el('code', { text: p.sku })),
        el('td', {}, el('strong', { text: p.nome })),
        el('td', { text: brl(p.custo_centavos) }),
        el('td', { text: brl(p.preco_centavos) }),
        el('td', { text: String(p.quantidade) }),
        el('td', { text: p.qtd_minima > 0 ? String(p.qtd_minima) : '—' }),
        el('td', { text: `${p.comissao_pct}%` + (p.comissao_fixo > 0 ? ` / ${brl(p.comissao_fixo)} fixo` : '') }),
        el('td', {}, el('span', { class: `pill ${statusClass}`, text: statusText })),
        el('td', { class: 'acoes' },
          el('button', { class: 'btn btn-small btn-line', type: 'button', text: 'Editar', onclick: () => abrirProduto(p) }),
          ' ',
          el('button', { class: 'btn btn-small btn-line', type: 'button', text: 'Entrada', onclick: () => abrirEntradaProduto(p) }),
          ' ',
          el('button', {
            class: 'btn btn-small btn-line', type: 'button', text: p.ativo ? 'Desativar' : 'Ativar',
            onclick: () => alternarProduto(p),
          }))) });
    $('tabela-produtos').replaceChildren(tabela(
      [['SKU'], ['Produto'], ['Custo'], ['Preço'], ['Estoque'], ['Mín.'], ['Comissão'], ['Status'], ['', 'acoes']],
      linhas, 'Nenhum produto cadastrado. Comece criando o primeiro.'));
  }

  async function alternarProduto(p) {
    try {
      await api.put(`/api/produtos/${p.id}`, {
        ...p, ativo: !p.ativo
      });
      await recarregar();
      toast(p.ativo ? 'Produto desativado.' : 'Produto ativado.');
    } catch (erro) {
      toast(erro.message, true);
    }
  }

  let produtoEditando = null;
  function abrirProduto(produto) {
    produtoEditando = produto || null;
    $('dlg-produto-titulo').textContent = produto ? 'Editar produto' : 'Novo produto';
    $('pr-sku').value = produto ? produto.sku : '';
    $('pr-sku').disabled = !!produto;
    $('pr-nome').value = produto ? produto.nome : '';
    $('pr-descricao').value = produto ? (produto.descricao || '') : '';
    $('pr-custo').value = produto ? centavosParaReais(produto.custo_centavos) : '';
    $('pr-preco').value = produto ? centavosParaReais(produto.preco_centavos) : '';
    $('pr-qtd').value = produto ? produto.quantidade : 0;
    $('pr-qtd-min').value = produto ? produto.qtd_minima : 0;
    $('pr-comissao-pct').value = produto ? produto.comissao_pct : 0;
    $('pr-comissao-fixo').value = produto ? (produto.comissao_fixo > 0 ? centavosParaReais(produto.comissao_fixo) : '') : '';
    $('pr-ativo').checked = produto ? produto.ativo : true;
    $('pr-ativo-wrap').hidden = !produto;
    mostrarErro('pr-erro', '');
    $('dlg-produto').showModal();
    $('pr-nome').focus();
  }
  $('novo-produto').addEventListener('click', () => abrirProduto(null));
  $('pr-cancelar').addEventListener('click', () => $('dlg-produto').close());

  $('form-produto').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    mostrarErro('pr-erro', '');
    const custo = reaisParaCentavos($('pr-custo').value);
    const preco = reaisParaCentavos($('pr-preco').value);
    const comissaoFixo = reaisParaCentavos($('pr-comissao-fixo').value);
    if (Number.isNaN(custo) || Number.isNaN(preco)) return mostrarErro('pr-erro', 'Informe custo e preço válidos.');
    const corpo = {
      sku: $('pr-sku').value.toUpperCase(),
      nome: $('pr-nome').value,
      descricao: $('pr-descricao').value || undefined,
      custo_centavos: custo,
      preco_centavos: preco,
      quantidade: parseInt($('pr-qtd').value, 10),
      qtd_minima: parseInt($('pr-qtd-min').value, 10),
      comissao_pct: parseInt($('pr-comissao-pct').value, 10),
      comissao_fixo: Number.isNaN(comissaoFixo) ? 0 : comissaoFixo,
      ativo: $('pr-ativo').checked,
    };
    $('pr-salvar').disabled = true;
    try {
      if (produtoEditando) await api.put(`/api/produtos/${produtoEditando.id}`, corpo);
      else await api.post('/api/produtos', corpo);
      $('dlg-produto').close();
      await recarregar();
      toast('Produto salvo.');
    } catch (erro) {
      mostrarErro('pr-erro', erro.message);
    } finally {
      $('pr-salvar').disabled = false;
    }
  });

  let produtoEntrada = null;
  function abrirEntradaProduto(produto) {
    produtoEntrada = produto;
    $('dlg-produto-entrada-titulo').textContent = `Entrada: ${produto.nome} (estoque: ${produto.quantidade})`;
    $('pe-quantidade').value = '';
    mostrarErro('pe-erro', '');
    $('dlg-produto-entrada').showModal();
    $('pe-quantidade').focus();
  }
  $('pe-cancelar').addEventListener('click', () => $('dlg-produto-entrada').close());

  $('form-produto-entrada').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    mostrarErro('pe-erro', '');
    const qtd = parseInt($('pe-quantidade').value, 10);
    if (!qtd || qtd < 1) return mostrarErro('pe-erro', 'Informe uma quantidade válida.');
    $('pe-salvar').disabled = true;
    try {
      await api.post(`/api/produtos/${produtoEntrada.id}/entrada`, { quantidade: qtd });
      $('dlg-produto-entrada').close();
      await recarregar();
      toast('Entrada registrada.');
    } catch (erro) {
      mostrarErro('pe-erro', erro.message);
    } finally {
      $('pe-salvar').disabled = false;
    }
  });

  // ───────────── PDV (Fase 3) ─────────────

  let pdvItens = [];
  let pdvClientesCache = [];

  async function initPDV() {
    await verificarCaixaAberto();
    await carregarClientesPDV();
    await carregarServicosPDV();
    await carregarProdutosPDV();
    pdvItens = [];
    renderPDVItens();
    atualizarPDVTotais();
  }

  async function verificarCaixaAberto() {
    try {
      const { caixa } = await api.get('/api/caixa/aberto');
      const statusEl = $('pdv-caixa-status');
      if (caixa) {
        statusEl.textContent = `Caixa aberto (inicial: ${brl(caixa.valor_inicial_centavos)})`;
        statusEl.style.color = 'var(--ok)';
        $('pdv-finalizar').disabled = false;
      } else {
        statusEl.textContent = '! Nenhum caixa aberto — o administrador deve abrir o caixa primeiro';
        statusEl.style.color = 'var(--bad)';
        $('pdv-finalizar').disabled = true;
      }
    } catch (e) {
      $('pdv-caixa-status').textContent = 'Erro ao verificar caixa';
    }
  }

  async function carregarClientesPDV() {
    try {
      // Buscar clientes via lista de usuários (precisamos criar endpoint ou usar busca)
      // Por enquanto, deixamos o select com apenas walk-in
      // TODO: criar endpoint /api/clientes para listar
    } catch {}
  }

  async function carregarServicosPDV() {
    const ativos = estado.servicos.filter(s => s.ativo);
    const sel = $('pds-servico');
    sel.innerHTML = '<option value="">Selecione um serviço</option>';
    for (const s of ativos) {
      sel.append(el('option', { value: String(s.id) }, `${s.nome} — ${brl(s.preco_centavos)} (${s.duracao_min}min)`));
    }
  }

  async function carregarProdutosPDV() {
    const ativos = estado.produtos.filter(p => p.ativo && p.quantidade > 0);
    const sel = $('pdp-produto');
    sel.innerHTML = '<option value="">Selecione um produto</option>';
    for (const p of ativos) {
      sel.append(el('option', { value: String(p.id) }, `${p.nome} — ${brl(p.preco_centavos)} (estoque: ${p.quantidade})`));
    }
  }

  function renderPDVItens() {
    const container = $('pdv-itens');
    if (!pdvItens.length) {
      container.innerHTML = '<div class="vazio">Nenhum item adicionado. Use os botões acima para adicionar serviços ou produtos.</div>';
      return;
    }
    const linhas = pdvItens.map((item, idx) => el('tr', {},
      el('td', { text: item.tipo === 'servico' ? 'Serviço' : 'Produto' }),
      el('td', { text: item.nome }),
      el('td', { text: brl(item.preco_unit) }),
      el('td', { text: String(item.quantidade) }),
      el('td', { text: brl(item.subtotal) }),
      el('td', { class: 'acoes' },
        el('button', {
          class: 'btn btn-small btn-danger', type: 'button', text: 'Remover',
          onclick: () => { pdvItens.splice(idx, 1); renderPDVItens(); atualizarPDVTotais(); }
        }))));
    container.replaceChildren(tabela(
      [['Tipo'], ['Item'], ['Preço unit.'], ['Qtd'], ['Subtotal'], ['', 'acoes']],
      linhas));
  }

  function atualizarPDVTotais() {
    const subtotal = pdvItens.reduce((s, i) => s + i.subtotal, 0);
    const desconto = reaisParaCentavos($('pdv-desconto').value) || 0;
    const total = Math.max(0, subtotal - desconto);
    const forma = $('pdv-forma').value;
    const dinheiroRecebido = reaisParaCentavos($('pdv-dinheiro').value) || 0;
    const troco = (forma === 'dinheiro' || forma === 'misto') ? Math.max(0, dinheiroRecebido - total) : 0;

    $('pdv-subtotal').textContent = brl(subtotal);
    $('pdv-total').textContent = brl(total);
    $('pdv-troco').textContent = brl(troco);
    $('pdv-dinheiro-wrap').style.display = (forma === 'dinheiro' || forma === 'misto') ? 'block' : 'none';
    $('pdv-troco-wrap').style.display = (forma === 'dinheiro' || forma === 'misto') ? 'block' : 'none';
  }

  $('pdv-add-servico').addEventListener('click', () => {
    $('form-pdv-servico').reset();
    $('pds-qtd').value = 1;
    mostrarErro('pds-erro', '');
    $('dlg-pdv-servico').showModal();
    $('pds-servico').focus();
  });

  $('pdv-add-produto').addEventListener('click', () => {
    $('form-pdv-produto').reset();
    $('pdp-qtd').value = 1;
    mostrarErro('pdp-erro', '');
    $('dlg-pdv-produto').showModal();
    $('pdp-produto').focus();
  });

  $('pds-cancelar').addEventListener('click', () => $('dlg-pdv-servico').close());
  $('pdp-cancelar').addEventListener('click', () => $('dlg-pdv-produto').close());

  $('form-pdv-servico').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const servicoId = parseInt($('pds-servico').value, 10);
    const qtd = parseInt($('pds-qtd').value, 10);
    if (!servicoId || !qtd) return mostrarErro('pds-erro', 'Selecione serviço e quantidade.');
    const servico = estado.servicos.find(s => s.id === servicoId);
    if (!servico) return mostrarErro('pds-erro', 'Serviço não encontrado.');
    pdvItens.push({
      tipo: 'servico',
      referencia_id: servicoId,
      nome: servico.nome,
      preco_unit: servico.preco_centavos,
      quantidade: qtd,
      subtotal: servico.preco_centavos * qtd,
    });
    $('dlg-pdv-servico').close();
    renderPDVItens();
    atualizarPDVTotais();
  });

  $('form-pdv-produto').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const produtoId = parseInt($('pdp-produto').value, 10);
    const qtd = parseInt($('pdp-qtd').value, 10);
    if (!produtoId || !qtd) return mostrarErro('pdp-erro', 'Selecione produto e quantidade.');
    const produto = estado.produtos.find(p => p.id === produtoId);
    if (!produto) return mostrarErro('pdp-erro', 'Produto não encontrado.');
    if (produto.quantidade < qtd) return mostrarErro('pdp-erro', `Estoque insuficiente. Disponível: ${produto.quantidade}`);
    pdvItens.push({
      tipo: 'produto',
      referencia_id: produtoId,
      nome: produto.nome,
      preco_unit: produto.preco_centavos,
      quantidade: qtd,
      subtotal: produto.preco_centavos * qtd,
    });
    $('dlg-pdv-produto').close();
    renderPDVItens();
    atualizarPDVTotais();
  });

  $('pdv-desconto').addEventListener('input', atualizarPDVTotais);
  $('pdv-forma').addEventListener('change', atualizarPDVTotais);
  $('pdv-dinheiro').addEventListener('input', atualizarPDVTotais);

  $('pdv-finalizar').addEventListener('click', async () => {
    if (!pdvItens.length) return toast('Adicione pelo menos um item.', true);
    const total = pdvItens.reduce((s, i) => s + i.subtotal, 0) - (reaisParaCentavos($('pdv-desconto').value) || 0);
    if (total <= 0) return toast('Total deve ser maior que zero.', true);
    const forma = $('pdv-forma').value;
    const dinheiroRecebido = reaisParaCentavos($('pdv-dinheiro').value) || 0;
    if ((forma === 'dinheiro' || forma === 'misto') && dinheiroRecebido < total) {
      return toast('Dinheiro recebido deve ser maior ou igual ao total.', true);
    }
    const barbeiroId = parseInt($('pdv-barbeiro').value, 10);
    if (!barbeiroId) return toast('Selecione o barbeiro responsável.', true);

    $('pdv-finalizar').disabled = true;
    try {
      const itens = pdvItens.map(i => ({
        tipo: i.tipo,
        referencia_id: i.referencia_id,
        quantidade: i.quantidade,
      }));
      await api.post('/api/vendas', {
        barbeiro_id: barbeiroId,
        itens,
        forma_pagamento: forma,
        dinheiro_recebido: dinheiroRecebido,
        desconto_centavos: reaisParaCentavos($('pdv-desconto').value) || 0,
      });
      toast('Venda finalizada com sucesso!');
      pdvItens = [];
      renderPDVItens();
      atualizarPDVTotais();
      await recarregar(); // atualiza estoque
    } catch (erro) {
      toast(erro.message, true);
    } finally {
      $('pdv-finalizar').disabled = false;
    }
  });

  // ───────────── CAIXA (Fase 3) ─────────────

  async function carregarCaixaHistorico() {
    const container = $('tabela-caixa');
    container.innerHTML = '<div class="vazio">Carregando histórico de caixas...</div>';
    try {
      const { caixas } = await api.get('/api/caixa/historico');
      if (!caixas.length) {
        container.innerHTML = '';
        container.append(el('div', { class: 'vazio' },
          el('span', { class: 'vazio-icon', 'aria-hidden': 'true' },
            el('svg', { 'aria-hidden': 'true' }, el('use', { href: 'icons/icons.svg#icon-money' }))
          ),
          el('div', { text: 'Nenhum caixa registrado' })));
        return;
      }
      const linhas = caixas.map((c) => {
        const dataFmt = new Date(c.data).toLocaleDateString('pt-BR');
        const diff = c.valor_final_centavos !== null && c.valor_final_centavos !== undefined
          ? c.valor_final_centavos - (c.valor_inicial_centavos + c.total_dinheiro_centavos + c.total_cartao_centavos + c.total_pix_centavos - c.sangrias_centavos)
          : 0;
        const diffClass = diff > 0 ? 'pill-ok' : (diff < 0 ? 'pill-danger' : 'pill-off');
        const diffText = diff !== 0 ? `${diff > 0 ? '+' : ''}${brl(diff)}` : '—';
        return el('tr', {},
          el('td', { text: dataFmt }),
          el('td', { text: c.aberto_por_nome }),
          el('td', { text: brl(c.valor_inicial_centavos) }),
          el('td', { text: brl(c.total_dinheiro_centavos) }),
          el('td', { text: brl(c.total_cartao_centavos) }),
          el('td', { text: brl(c.total_pix_centavos) }),
          el('td', { text: brl(c.sangrias_centavos) }),
          el('td', { text: c.valor_final_centavos !== null ? brl(c.valor_final_centavos) : '—' }),
          el('td', {}, el('span', { class: `pill ${diffClass}`, text: diffText })),
          el('td', {}, statusPillCaixa(c.status)),
          el('td', { class: 'acoes' },
            c.status === 'aberto' ? el('button', {
              class: 'btn btn-small btn-primary', type: 'button', text: 'Ver / Fechar',
              onclick: () => abrirDetalhesCaixa(c.id)
            }) : el('button', {
              class: 'btn btn-small btn-line', type: 'button', text: 'Ver detalhes',
              onclick: () => abrirDetalhesCaixa(c.id)
            })));
      });
      container.replaceChildren(tabela(
        [['Data'], ['Aberto por'], ['Inicial'], ['Dinheiro'], ['Cartão'], ['PIX'], ['Sangrias'], ['Final'], ['Dif.'], ['Status'], ['', 'acoes']],
        linhas));
    } catch (e) {
      toast(e.message, true);
      container.innerHTML = '<div class="vazio">Erro ao carregar caixas.</div>';
    }
  }

  let caixaDetalhesId = null;

  function abrirDetalhesCaixa(id) {
    caixaDetalhesId = id;
    api.get(`/api/caixa/${id}`).then(({ caixa, sangrias, vendas }) => {
      $('dlg-caixa-fechar-titulo').textContent = `Caixa ${new Date(caixa.data).toLocaleDateString('pt-BR')} — ${caixa.status === 'aberto' ? 'Aberto' : 'Fechado'}`;
      // Preenche dados para fechamento se aberto
      if (caixa.status === 'aberto') {
        const esperado = caixa.valor_inicial_centavos + caixa.total_dinheiro_centavos + caixa.total_cartao_centavos + caixa.total_pix_centavos - caixa.sangrias_centavos;
        $('cf-valor-final').placeholder = brl(esperado);
        $('cf-valor-final').value = '';
        mostrarErro('cf-erro', '');
        $('dlg-caixa-fechar').showModal();
      } else {
        // Mostra detalhes em toast ou modal simples
        const msg = `Inicial: ${brl(caixa.valor_inicial_centavos)}\nDinheiro: ${brl(caixa.total_dinheiro_centavos)}\nCartão: ${brl(caixa.total_cartao_centavos)}\nPIX: ${brl(caixa.total_pix_centavos)}\nSangrias: ${brl(caixa.sangrias_centavos)}\nFinal: ${caixa.valor_final_centavos ? brl(caixa.valor_final_centavos) : '—'}\nDiferença: ${caixa.valor_final_centavos !== null ? brl(caixa.valor_final_centavos - (caixa.valor_inicial_centavos + caixa.total_dinheiro_centavos + caixa.total_cartao_centavos + caixa.total_pix_centavos - caixa.sangrias_centavos)) : '—'}`;
        alert(msg);
      }
    }).catch(e => toast(e.message, true));
  }

  $('caixa-abrir').addEventListener('click', () => {
    $('form-caixa').reset();
    $('cx-valor-inicial').value = '0,00';
    mostrarErro('cx-erro', '');
    $('dlg-caixa').showModal();
    $('cx-valor-inicial').focus();
  });

  $('cx-cancelar').addEventListener('click', () => $('dlg-caixa').close());
  $('cf-cancelar').addEventListener('click', () => $('dlg-caixa-fechar').close());

  $('form-caixa').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    mostrarErro('cx-erro', '');
    const valor = reaisParaCentavos($('cx-valor-inicial').value);
    if (Number.isNaN(valor)) return mostrarErro('cx-erro', 'Informe um valor válido.');
    $('cx-salvar').disabled = true;
    try {
      await api.post('/api/caixa/abrir', {
        valor_inicial_centavos: valor,
        observacao: $('cx-obs').value || undefined,
      });
      $('dlg-caixa').close();
      toast('Caixa aberto!');
      await carregarCaixaHistorico();
      await verificarCaixaAberto();
    } catch (erro) {
      mostrarErro('cx-erro', erro.message);
    } finally {
      $('cx-salvar').disabled = false;
    }
  });

  $('form-caixa-fechar').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    mostrarErro('cf-erro', '');
    const valor = reaisParaCentavos($('cf-valor-final').value);
    if (Number.isNaN(valor)) return mostrarErro('cf-erro', 'Informe um valor válido.');
    $('cf-salvar').disabled = true;
    try {
      const { caixa, esperado, diferenca } = await api.put(`/api/caixa/${caixaDetalhesId}/fechar`, {
        valor_final_centavos: valor,
        observacao: $('cf-obs').value || undefined,
      });
      $('dlg-caixa-fechar').close();
      toast(`Caixa fechado! Esperado: ${brl(esperado)} | Diferença: ${brl(diferenca)}`);
      await carregarCaixaHistorico();
      await verificarCaixaAberto();
    } catch (erro) {
      mostrarErro('cf-erro', erro.message);
    } finally {
      $('cf-salvar').disabled = false;
    }
  });

  // Sangrias
  async function abrirSangria(caixaId) {
    caixaDetalhesId = caixaId;
    $('form-sangria').reset();
    mostrarErro('sg-erro', '');
    $('dlg-sangria').showModal();
    $('sg-valor').focus();
  }

  $('sg-cancelar').addEventListener('click', () => $('dlg-sangria').close());

  $('form-sangria').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    mostrarErro('sg-erro', '');
    const valor = reaisParaCentavos($('sg-valor').value);
    if (Number.isNaN(valor) || valor <= 0) return mostrarErro('sg-erro', 'Informe um valor válido.');
    $('sg-salvar').disabled = true;
    try {
      await api.post(`/api/caixa/${caixaDetalhesId}/sangria`, {
        valor_centavos: valor,
        motivo: $('sg-motivo').value || undefined,
      });
      $('dlg-sangria').close();
      toast('Sangria registrada.');
      await carregarCaixaHistorico();
      await verificarCaixaAberto();
    } catch (erro) {
      mostrarErro('sg-erro', erro.message);
    } finally {
      $('sg-salvar').disabled = false;
    }
  });

  // ───────────── COMISSÕES (Fase 3) ─────────────

  async function carregarComissoes() {
    const barbeiroId = $('com-barbeiro').value || undefined;
    const status = $('com-status').value || undefined;
    const dataInicio = $('com-data-inicio').value || undefined;
    const dataFim = $('com-data-fim').value || undefined;

    const container = $('tabela-comissoes');
    container.innerHTML = '<div class="vazio">Carregando comissões...</div>';

    try {
      let url = '/api/comissoes';
      const params = [];
      if (barbeiroId) params.push(`barbeiro=${barbeiroId}`);
      if (status) params.push(`status=${status}`);
      if (dataInicio) params.push(`data_inicio=${dataInicio}`);
      if (dataFim) params.push(`data_fim=${dataFim}`);
      if (params.length) url += '?' + params.join('&');

      const { comissoes } = await api.get(url);

      if (!comissoes.length) {
        container.innerHTML = '';
        container.append(el('div', { class: 'vazio' },
          el('span', { class: 'vazio-icon', 'aria-hidden': 'true' },
            el('svg', { 'aria-hidden': 'true' }, el('use', { href: 'icons/icons.svg#icon-money' }))
          ),
          el('div', { text: 'Nenhuma comissão encontrada' })));
        return;
      }

      const linhas = comissoes.map((c) => {
        const dataVenda = new Date(c.venda_criado_em).toLocaleDateString('pt-BR');
        const horaVenda = new Date(c.venda_criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        return el('tr', {},
          el('td', { text: dataVenda }),
          el('td', { text: horaVenda }),
          el('td', { text: c.barbeiro_nome }),
          el('td', { text: c.item_nome || `ID ${c.referencia_id}` }),
          el('td', { text: c.item_tipo === 'servico' ? 'Serviço' : 'Produto' }),
          el('td', { text: brl(c.preco_unit_centavos) }),
          el('td', { text: String(c.quantidade) }),
          el('td', { text: brl(c.valor_centavos) }),
          el('td', {}, statusPillComissao(c.status)),
          el('td', { class: 'acoes' },
            c.status === 'a_receber' ? el('button', {
              class: 'btn btn-small btn-primary', type: 'button', text: 'Marcar como paga',
              onclick: () => pagarComissao(c.id)
            }) : ''));
      });

      container.replaceChildren(tabela(
        [['Data'], ['Hora'], ['Barbeiro'], ['Item'], ['Tipo'], ['Preço unit.'], ['Qtd'], ['Comissão'], ['Status'], ['', 'acoes']],
        linhas));
    } catch (e) {
      toast(e.message, true);
      container.innerHTML = '<div class="vazio">Erro ao carregar comissões.</div>';
    }
  }

  async function carregarComissoesResumo() {
    const barbeiroId = $('com-barbeiro').value || undefined;
    const dataInicio = $('com-data-inicio').value || undefined;
    const dataFim = $('com-data-fim').value || undefined;

    const container = $('tabela-comissoes-resumo');
    try {
      let url = '/api/comissoes/resumo';
      const params = [];
      if (barbeiroId) params.push(`barbeiro=${barbeiroId}`);
      if (dataInicio) params.push(`data_inicio=${dataInicio}`);
      if (dataFim) params.push(`data_fim=${dataFim}`);
      if (params.length) url += '?' + params.join('&');

      const { resumo } = await api.get(url);

      if (!resumo.length) {
        container.innerHTML = '';
        return;
      }

      const linhas = resumo.map((r) => el('tr', {},
        el('td', { text: r.barbeiro_nome }),
        el('td', { text: brl(r.a_receber) }),
        el('td', { text: brl(r.pago) }),
        el('td', { text: brl(r.a_receber + r.pago) }),
        el('td', { text: String(r.total_itens) })));

      container.replaceChildren(tabela(
        [['Barbeiro'], ['A receber'], ['Pago'], ['Total'], ['Itens']],
        linhas));
    } catch (e) {
      container.innerHTML = '';
    }
  }

  async function pagarComissao(id) {
    if (!confirm('Marcar esta comissão como paga?')) return;
    try {
      await api.put(`/api/comissoes/${id}/pagar`, { observacao: 'Pagamento manual via painel admin' });
      toast('Comissão marcada como paga!');
      await carregarComissoes();
      await carregarComissoesResumo();
    } catch (e) { toast(e.message, true); }
  }

  $('com-barbeiro').addEventListener('change', () => { carregarComissoes(); carregarComissoesResumo(); });
  $('com-status').addEventListener('change', () => { carregarComissoes(); carregarComissoesResumo(); });
  $('com-data-inicio').addEventListener('change', () => { carregarComissoes(); carregarComissoesResumo(); });
  $('com-data-fim').addEventListener('change', () => { carregarComissoes(); carregarComissoesResumo(); });

  // ───────────── início ─────────────

  try {
    const usuario = await exigir('admin');
    $('avatar').textContent = iniciais(usuario.nome);
    $('nome-admin').textContent = usuario.nome;

    const hoje = new Date().toISOString().split('T')[0];
    $('adm-data').value = hoje;
    $('bl-data').value = hoje;

    await recarregar();
    mostrar('dashboard');
    await carregarDashboard();
  } catch (erro) {
    toast(erro.message, true);
  }
})();