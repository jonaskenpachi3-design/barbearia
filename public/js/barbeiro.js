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
    const tabs = ['agenda', 'jornada', 'servicos', 'comissoes', 'clientes'];
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
      if (!confirm('Marcar como concluído?')) return;
      try {
        await api.put(`/api/agendamentos/${id}/concluir`);
        toast('Agendamento concluído!');
        carregarAgenda();
        carregarComissoes(); // Atualiza comissões
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

    // ─── Comissões do Barbeiro ───
    async function carregarComissoes() {
      const status = $('bc-status').value || undefined;
      const dataInicio = $('bc-data-inicio').value || undefined;
      const dataFim = $('bc-data-fim').value || undefined;

      const container = $('bc-tabela');
      container.innerHTML = '<span class="muted small">Carregando comissões...</span>';

      try {
        let url = '/api/comissoes';
        const params = [];
        if (status) params.push(`status=${status}`);
        if (dataInicio) params.push(`data_inicio=${dataInicio}`);
        if (dataFim) params.push(`data_fim=${dataFim}`);
        if (params.length) url += '?' + params.join('&');

        const { comissoes } = await api.get(url);

        if (!comissoes.length) {
          container.innerHTML = '';
          container.append(el('p', { class: 'vazio-agenda' },
            el('span', { class: 'icon', text: '💰' }),
            el('div', { text: 'Nenhuma comissão encontrada' })
          ));
          $('bc-resumo').innerHTML = '';
          return;
        }

        const linhas = comissoes.map((c) => {
          const dataVenda = new Date(c.venda_criado_em).toLocaleDateString('pt-BR');
          const horaVenda = new Date(c.venda_criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          const statusClass = c.status === 'a_receber' ? 'pill-pendente' : 'pill-concluido';
          const statusLabel = c.status === 'a_receber' ? 'A receber' : 'Pago';
          return el('tr', {},
            el('td', { text: dataVenda }),
            el('td', { text: horaVenda }),
            el('td', { text: c.item_nome || `ID ${c.referencia_id}` }),
            el('td', { text: c.item_tipo === 'servico' ? '✂️ Serviço' : '📦 Produto' }),
            el('td', { text: brl(c.preco_unit_centavos) }),
            el('td', { text: String(c.quantidade) }),
            el('td', { text: brl(c.valor_centavos) }),
            el('td', {}, el('span', { class: `pill ${statusClass}`, text: statusLabel })),
          );
        });

        container.replaceChildren(el('table', {},
          el('thead', {}, el('tr', {},
            el('th', { text: 'Data' }),
            el('th', { text: 'Hora' }),
            el('th', { text: 'Item' }),
            el('th', { text: 'Tipo' }),
            el('th', { text: 'Preço unit.' }),
            el('th', { text: 'Qtd' }),
            el('th', { text: 'Comissão' }),
            el('th', { text: 'Status' }),
          ))),
          el('tbody', {}, linhas)
        ));

        // Resumo
        const aReceber = comissoes.filter(c => c.status === 'a_receber').reduce((s, c) => s + c.valor_centavos, 0);
        const pago = comissoes.filter(c => c.status === 'pago').reduce((s, c) => s + c.valor_centavos, 0);
        $('bc-resumo').replaceChildren(el('table', {},
          el('thead', {}, el('tr', {},
            el('th', { text: 'Total a receber' }),
            el('th', { text: 'Total pago' }),
            el('th', { text: 'Total geral' }),
          ))),
          el('tbody', {}, el('tr', {},
            el('td', { text: brl(aReceber), style: 'font-weight: 600; color: var(--cor-alerta);' }),
            el('td', { text: brl(pago), style: 'font-weight: 600; color: var(--cor-sucesso);' }),
            el('td', { text: brl(aReceber + pago), style: 'font-weight: 600; color: var(--cor-primaria);' }),
          ))
        ));

      } catch (e) {
        toast(e.message, true);
        container.innerHTML = '';
      }
    }

    $('bc-status').addEventListener('change', carregarComissoes);
    $('bc-data-inicio').addEventListener('change', carregarComissoes);
    $('bc-data-fim').addEventListener('change', carregarComissoes);

    // Carrega comissões iniciais
    carregarComissoes();

    // ─── Clientes (Histórico) ───
    async function carregarClientes() {
      const busca = $('bcl-busca').value.toLowerCase().trim();
      const container = $('bcl-lista');
      container.innerHTML = '<span class="muted small">Carregando clientes...</span>';

      try {
        // Buscar todos os agendamentos concluídos deste barbeiro
        const { agendamentos } = await api.get('/api/agenda-barbeiro?status=concluido');

        // Agrupar por cliente
        const porCliente = new Map();
        for (const a of agendamentos) {
          if (!porCliente.has(a.cliente_id)) {
            porCliente.set(a.cliente_id, {
              id: a.cliente_id,
              nome: a.cliente_nome,
              telefone: a.cliente_telefone,
              servicos: [],
              total: 0,
              ultima_visita: a.inicio,
            });
          }
          const c = porCliente.get(a.cliente_id);
          c.servicos.push({
            nome: a.servico_nome,
            data: a.inicio,
            preco: a.servico_preco,
          });
          c.total += a.servico_preco;
          if (new Date(a.inicio) > new Date(c.ultima_visita)) {
            c.ultima_visita = a.inicio;
          }
        }

        // Buscar vendas concluídas deste barbeiro
        const { vendas } = await api.get('/api/vendas?status=concluida');
        for (const v of vendas) {
          if (v.cliente_id && !porCliente.has(v.cliente_id)) {
            porCliente.set(v.cliente_id, {
              id: v.cliente_id,
              nome: v.cliente_nome || 'Walk-in',
              telefone: '',
              servicos: [],
              total: 0,
              ultima_visita: v.criado_em,
            });
          }
          if (v.cliente_id) {
            const c = porCliente.get(v.cliente_id);
            for (const item of v.itens) {
              c.servicos.push({
                nome: item.referencia_nome,
                data: v.criado_em,
                preco: item.preco_unit_centavos * item.quantidade,
              });
              c.total += item.preco_unit_centavos * item.quantidade;
            }
            if (new Date(v.criado_em) > new Date(c.ultima_visita)) {
              c.ultima_visita = v.criado_em;
            }
          }
        }

        let clientes = Array.from(porCliente.values())
          .filter(c => !busca || c.nome.toLowerCase().includes(busca))
          .sort((a, b) => new Date(b.ultima_visita) - new Date(a.ultima_visita));

        if (!clientes.length) {
          container.innerHTML = '';
          container.append(el('p', { class: 'vazio-agenda' },
            el('span', { class: 'icon', text: '👥' }),
            el('div', { text: busca ? 'Nenhum cliente encontrado' : 'Nenhum cliente atendido ainda' })
          ));
          return;
        }

        container.innerHTML = '';
        for (const c of clientes) {
          const ultVisita = new Date(c.ultima_visita).toLocaleDateString('pt-BR');
          const item = el('div', { class: 'item' },
            el('div', { class: 'top' },
              el('strong', { text: c.nome }),
              el('span', { class: 'pill pill-ok', text: `${c.servicos.length} atendimentos` })
            ),
            el('div', { class: 'detalhes' },
              el('span', { text: c.telefone ? `📞 ${c.telefone}` : '' }),
              el('span', { text: `💰 Total: ${brl(c.total)}` }),
              el('span', { text: `📅 Última visita: ${ultVisita}` })
            ),
            el('div', { class: 'acoes' },
              el('button', {
                class: 'btn btn-small btn-line',
                text: 'Ver histórico',
                onclick: () => abrirHistoricoCliente(c.id, c.nome)
              })
            )
          );
          container.append(item);
        }
      } catch (e) {
        toast(e.message, true);
        container.innerHTML = '';
      }
    }

    function abrirHistoricoCliente(clienteId, clienteNome) {
      api.get(`/api/clientes/${clienteId}/historico`).then(({ agendamentos, vendas, observacoes }) => {
        let html = `<h3>Histórico de ${clienteNome}</h3>`;

        if (agendamentos.length) {
          html += '<h4>✂️ Agendamentos concluídos</h4><ul>';
          for (const a of agendamentos) {
            const dt = new Date(a.inicio).toLocaleDateString('pt-BR');
            const hora = new Date(a.inicio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            html += `<li>${dt} ${hora} — ${a.servico_nome} (${a.barbeiro_nome}) — ${brl(a.servico_preco)}</li>`;
          }
          html += '</ul>';
        }

        if (vendas.length) {
          html += '<h4>💰 Vendas (walk-in / produtos)</h4><ul>';
          for (const v of vendas) {
            const dt = new Date(v.criado_em).toLocaleDateString('pt-BR');
            const hora = new Date(v.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            html += `<li>${dt} ${hora} — ${v.forma_pagamento} — ${brl(v.total_centavos)}`;
            if (v.itens.length) {
              html += '<ul>';
              for (const item of v.itens) {
                html += `<li>${item.tipo === 'servico' ? '✂️' : '📦'} ${item.referencia_nome} × ${item.quantidade} — ${brl(item.preco_unit_centavos * item.quantidade)}</li>`;
              }
              html += '</ul>';
            }
            html += '</li>';
          }
          html += '</ul>';
        }

        if (observacoes.length) {
          html += '<h4>📝 Anotações</h4><ul>';
          for (const o of observacoes) {
            const dt = new Date(o.criado_em).toLocaleDateString('pt-BR');
            html += `<li>${dt} (${o.barbeiro_nome}): ${o.conteudo}</li>`;
          }
          html += '</ul>';
        }

        if (!agendamentos.length && !vendas.length && !observacoes.length) {
          html += '<p class="muted">Nenhum histórico encontrado.</p>';
        }

        // Abre em modal simples (alert por enquanto)
        alert(html.replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' '));
      }).catch(e => toast(e.message, true));
    }

    $('bcl-busca').addEventListener('input', carregarClientes);

    // Carrega clientes iniciais
    carregarClientes();

  } catch (erro) {
    toast(erro.message, true);
  }
})();