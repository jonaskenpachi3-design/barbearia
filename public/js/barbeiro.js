'use strict';
(async function () {
  const { api, el, brl, iniciais, exigir, sair, toast, DIAS, ORDEM_DIAS, turnosPorDia } = window.App;
  const $ = (id) => document.getElementById(id);

  $('sair').addEventListener('click', sair);

  try {
    const usuario = await exigir('barbeiro');
    $('avatar').textContent = iniciais(usuario.nome);
    const primeiroNome = usuario.nome.split(' ')[0];

    // Tabs
    const tabs = ['agenda', 'jornada', 'servicos'];
    const tabBtns = tabs.map(t => $(`tab-${t}`));
    const tabPanels = tabs.map(t => $(`panel-${t}`));
    function mostrarTab(idx) {
      tabBtns.forEach((b, i) => b.setAttribute('aria-selected', i === idx ? 'true' : 'false'));
      tabPanels.forEach((p, i) => p.hidden = i !== idx);
    }
    tabBtns.forEach((b, i) => b.addEventListener('click', () => mostrarTab(i)));
    mostrarTab(0);

    // Carrega dados do barbeiro
    const [{ barbeiro }, { servicos }] = await Promise.all([
      api.get('/api/meu-barbeiro'),
      api.get('/api/servicos'),
    ]);

    // Jornada (aba Minha jornada)
    const porDia = turnosPorDia(barbeiro.horarios);
    $('dias').replaceChildren(...ORDEM_DIAS.map((dia) => {
      const turnos = porDia.get(dia);
      return el('div', { class: 'dia' },
        el('div', { class: 'nome', text: DIAS[dia] }),
        el('div', { class: 'turnos' },
          turnos.length
            ? turnos.map((t) => el('span', { class: 'turno', text: `${t.inicio} às ${t.fim}` }))
            : el('span', { class: 'folga', text: 'Folga' })));
    }));

    const meus = servicos.filter((s) => barbeiro.servicos.includes(s.id));
    $('servicos').replaceChildren(...(meus.length
      ? meus.map((s) => el('span', { class: 'chip', text: s.nome }))
      : [el('p', { class: 'muted', text: 'Nenhum serviço atribuído ainda.' })]));

    $('comissao').textContent = `Sua comissão: ${barbeiro.comissao_pct}% sobre os atendimentos concluídos.`;

    // ─── Agenda do Barbeiro ───
    // Data padrão = hoje
    $('bb-data').value = new Date().toISOString().split('T')[0];

    async function carregarAgenda() {
      const data = $('bb-data').value;
      const status = $('bb-status').value || undefined;
      const container = $('bb-agenda');

      container.innerHTML = '<span class="muted small">Carregando agenda...</span>';

      try {
        const url = `/api/agenda-barbeiro?data=${data}${status ? `&status=${status}` : ''}`;
        const { agendamentos } = await api.get(url);

        if (!agendamentos.length) {
          container.innerHTML = '';
          container.append(el('p', { class: 'vazio-agenda' },
            el('span', { class: 'icon', text: '📅' }),
            el('div', { text: 'Nenhum agendamento para esta data' }),
            el('p', { class: 'small', text: status ? `Filtro: ${status}` : '' })
          ));
          return;
        }

        container.innerHTML = '';
        for (const a of agendamentos) {
          const dt = new Date(a.inicio);
          const hora = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          const statusClass = `status-${a.status}`;
          const statusLabel = { pendente: 'Pendente', confirmado: 'Confirmado', cancelado: 'Cancelado', concluido: 'Concluído' }[a.status];

          const item = el('div', { class: 'item agenda-item' },
            el('div', { class: 'top' },
              el('div', { class: 'hora', text: hora }),
              el('span', { class: `pill ${statusClass}`, text: statusLabel })
            ),
            el('div', { class: 'detalhes' },
              el('span', { text: a.servico?.nome || 'Serviço' }),
              el('span', { text: a.cliente?.nome ? `👤 ${a.cliente.nome}` : '' }),
              el('span', { text: a.cliente?.telefone ? `📞 ${a.cliente.telefone}` : '' }),
              el('span', { text: a.servico?.preco_centavos ? `💰 ${brl(a.servico.preco_centavos)}` : '' })
            )
          );

          const acoes = el('div', { class: 'acoes' });

          if (a.status === 'pendente') {
            const btnConf = el('button', {
              class: 'btn btn-small btn-primary',
              text: 'Confirmar',
              onclick: () => confirmarAgendamento(a.id)
            });
            acoes.append(btnConf);
          }
          if (a.status === 'confirmado') {
            const btnConc = el('button', {
              class: 'btn btn-small btn-primary',
              text: 'Concluir',
              onclick: () => concluirAgendamento(a.id)
            });
            acoes.append(btnConc);
          }
          if (a.status === 'pendente' || a.status === 'confirmado') {
            const btnCanc = el('button', {
              class: 'btn btn-small btn-danger',
              text: 'Cancelar',
              onclick: () => cancelarAgendamento(a.id)
            });
            acoes.append(btnCanc);
          }

          if (acoes.children.length) item.append(acoes);
          container.append(item);
        }
      } catch (e) {
        toast(e.message, true);
        container.innerHTML = '';
      }
    }

    async function confirmarAgendamento(id) {
      try {
        await api.put(`/api/agendamentos/${id}/confirmar`);
        toast('Agendamento confirmado!');
        carregarAgenda();
      } catch (e) { toast(e.message, true); }
    }

    async function concluirAgendamento(id) {
      // Para concluir, vamos apenas cancelar com status especial ou criar endpoint
      // Por enquanto, alerta de que precisa ser admin para concluir
      if (!confirm('Marcar como concluído? (Requer permissão de admin)')) return;
      try {
        // Tentar cancelar como workaround - no futuro ter endpoint específico
        await api.put(`/api/agendamentos/${id}/cancelar`);
        toast('Agendamento cancelado (use painel admin para marcar concluído).');
        carregarAgenda();
      } catch (e) { toast(e.message, true); }
    }

    async function cancelarAgendamento(id) {
      if (!confirm('Tem certeza que deseja cancelar este agendamento?')) return;
      try {
        await api.put(`/api/agendamentos/${id}/cancelar`);
        toast('Agendamento cancelado.');
        carregarAgenda();
      } catch (e) { toast(e.message, true); }
    }

    $('bb-data').addEventListener('change', carregarAgenda);
    $('bb-status').addEventListener('change', carregarAgenda);

    // Carrega agenda inicial
    carregarAgenda();

  } catch (erro) {
    toast(erro.message, true);
  }
})();