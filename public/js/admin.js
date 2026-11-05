'use strict';
(async function () {
  const { api, el, brl, iniciais, exigir, sair, toast, DIAS, ORDEM_DIAS } = window.App;
  const $ = (id) => document.getElementById(id);

  const estado = { servicos: [], barbeiros: [] };

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
    const [{ servicos }, { barbeiros }] = await Promise.all([
      api.get('/api/servicos'),
      api.get('/api/barbeiros'),
    ]);
    estado.servicos = servicos;
    estado.barbeiros = barbeiros;
    desenharServicos();
    desenharBarbeiros();
    preencheSelectBarbeiros();
  }

  function statusPill(ativo) {
    return el('span', { class: `pill ${ativo ? 'pill-ok' : 'pill-off'}`, text: ativo ? 'Ativo' : 'Inativo' });
  }

  function tabela(colunas, linhas, vazio) {
    if (!linhas.length) return el('div', { class: 'vazio', text: vazio });
    return el('table', {},
      el('thead', {}, el('tr', {}, colunas.map(([nome, classe]) => el('th', { scope: 'col', class: classe, text: nome })))),
      el('tbody', {}, linhas));
  }

  // ───────────── navegação ─────────────

  function mostrar(secao) {
    for (const nome of ['servicos', 'barbeiros', 'agenda', 'bloqueios']) {
      $(`view-${nome}`).hidden = nome !== secao;
      const botao = $(`nav-${nome}`);
      if (botao) {
        if (nome === secao) botao.setAttribute('aria-current', 'page');
        else botao.removeAttribute('aria-current');
      }
    }
  }
  $('nav-servicos').addEventListener('click', () => mostrar('servicos'));
  $('nav-barbeiros').addEventListener('click', () => mostrar('barbeiros'));
  $('nav-agenda').addEventListener('click', () => { mostrar('agenda'); carregarAgendaAdmin(); });
  $('nav-bloqueios').addEventListener('click', () => { mostrar('bloqueios'); carregarBloqueios(); });
  $('sair').addEventListener('click', sair);

  // ───────────── serviços ─────────────

  function desenharServicos() {
    const linhas = estado.servicos.map((s) => el('tr', {},
      el('td', {}, el('strong', { text: s.nome })),
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
      [['Serviço'], ['Duração'], ['Preço'], ['Status'], ['', 'acoes']],
      linhas, 'Nenhum serviço cadastrado. Comece criando o primeiro.'));
  }

  async function alternarServico(s) {
    try {
      await api.put(`/api/servicos/${s.id}`, {
        nome: s.nome, duracao_min: s.duracao_min, preco_centavos: s.preco_centavos, ativo: !s.ativo,
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

  // ───────────── Preenche selects de barbeiros ─────────────

  function preencheSelectBarbeiros() {
    const ativos = estado.barbeiros.filter(b => b.ativo);
    const selects = ['adm-barbeiro', 'bl-barbeiro'];
    for (const selId of selects) {
      const sel = $(selId);
      if (!sel) continue;
      const valorAtual = sel.value;
      sel.innerHTML = '<option value="">Todos os barbeiros</option>';
      for (const b of ativos) {
        sel.append(el('option', { value: String(b.id) }, b.nome));
      }
      sel.value = valorAtual || '';
    }
  }

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
          el('span', { style: 'font-size: 32px; display: block; margin-bottom: 8px;', text: '📅' }),
          el('div', { text: 'Nenhum agendamento para esta data' })));
        return;
      }

      const linhas = agendamentos.map((a) => {
        const dt = new Date(a.inicio);
        const dataFmt = dt.toLocaleDateString('pt-BR');
        const hora = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const statusClass = { pendente: 'pill-pendente', confirmado: 'pill-confirmado', cancelado: 'pill-cancelado', concluido: 'pill-concluido' }[a.status];
        const statusLabel = { pendente: 'Pendente', confirmado: 'Confirmado', cancelado: 'Cancelado', concluido: 'Concluído' }[a.status];

        return el('tr', {},
          el('td', { text: dataFmt }),
          el('td', { text: hora }),
          el('td', { text: a.cliente_nome }),
          el('td', { text: a.barbeiro_nome }),
          el('td', { text: a.servico_nome }),
          el('td', {}, el('span', { class: `pill ${statusClass}`, text: statusLabel })),
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
    // Workaround: cancelar com status concluído - ideal ter endpoint próprio
    try {
      await api.put(`/api/agendamentos/${id}/cancelar`);
      toast('Use a API diretamente para marcar como concluído. Por enquanto foi cancelado.');
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

  // ───────────── início ─────────────

  try {
    const usuario = await exigir('admin');
    $('avatar').textContent = iniciais(usuario.nome);
    $('nome-admin').textContent = usuario.nome;

    // Default dates
    const hoje = new Date().toISOString().split('T')[0];
    $('adm-data').value = hoje;
    $('bl-data').value = hoje;

    await recarregar();
  } catch (erro) {
    toast(erro.message, true);
  }
})();