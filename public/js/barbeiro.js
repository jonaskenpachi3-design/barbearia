'use strict';
(async function () {
  const { api, el, brl, iniciais, exigir, sair, toast, DIAS, ORDEM_DIAS, turnosPorDia } = window.App;
  const $ = (id) => document.getElementById(id);

  $('sair').addEventListener('click', sair);

  const menuBtn = $('mobile-menu-btn');
  const sidebar = $('sidebar');
  const sidebarOverlay = $('sidebar-overlay');
  const menuMobile = window.matchMedia('(max-width: 1024px)');
  const sidebarTabs = sidebar.querySelectorAll('[data-tab-index]');
  const tituloPagina = $('titulo-pagina');
  const tabTitulos = ['Agenda de hoje', 'Minha jornada', 'Meus serviços', 'Comissões', 'Clientes'];
  const tabs = ['agenda', 'jornada', 'servicos', 'comissoes', 'clientes'];
  const tabPanels = tabs.map(t => $(`panel-${t}`));

  function definirMenuAberto(aberto, devolverFoco = false) {
    if (!menuMobile.matches) {
      sidebar.classList.remove('open');
      sidebarOverlay.classList.remove('visible');
      sidebarOverlay.setAttribute('aria-hidden', 'true');
      sidebar.removeAttribute('aria-hidden');
      sidebar.removeAttribute('inert');
      menuBtn.setAttribute('aria-expanded', 'false');
      menuBtn.setAttribute('aria-label', 'Abrir menu');
      return;
    }

    sidebar.classList.toggle('open', aberto);
    sidebarOverlay.classList.toggle('visible', aberto);
    sidebarOverlay.setAttribute('aria-hidden', String(!aberto));
    sidebar.setAttribute('aria-hidden', String(!aberto));
    if (aberto) sidebar.removeAttribute('inert');
    else sidebar.setAttribute('inert', '');
    menuBtn.setAttribute('aria-expanded', String(aberto));
    menuBtn.setAttribute('aria-label', aberto ? 'Fechar menu' : 'Abrir menu');
    if (aberto) {
      const firstNav = sidebar.querySelector('.nav-item');
      if (firstNav) firstNav.focus();
    } else if (devolverFoco) {
      menuBtn.focus();
    }
  }

  menuMobile.addEventListener('change', () => definirMenuAberto(false));
  definirMenuAberto(false);

  function mostrarTab(idx) {
    tabPanels.forEach((p, i) => p.hidden = i !== idx);
    sidebarTabs.forEach((b) => {
      const selecionado = Number(b.dataset.tabIndex) === idx;
      b.classList.toggle('active', selecionado);
      if (selecionado) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    if (tituloPagina) tituloPagina.textContent = tabTitulos[idx];
  }

  sidebarTabs.forEach((b) => b.addEventListener('click', () => {
    mostrarTab(Number(b.dataset.tabIndex));
    definirMenuAberto(false, true);
  }));
  menuBtn.addEventListener('click', () => definirMenuAberto(menuBtn.getAttribute('aria-expanded') !== 'true'));
  sidebarOverlay.addEventListener('click', () => definirMenuAberto(false, true));
  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && menuBtn.getAttribute('aria-expanded') === 'true') {
      definirMenuAberto(false, true);
    }
  });
  mostrarTab(0);

  try {
    const usuario = await exigir('barbeiro');
    $('sidebar-avatar').textContent = iniciais(usuario.nome);
    $('sidebar-user-name').textContent = usuario.nome;
    const primeiroNome = usuario.nome.split(' ')[0];

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
          container.append(el('div', { class: 'vazio-agenda', role: 'status' },
            el('span', { class: 'icon', 'aria-hidden': 'true' },
              el('svg', { 'aria-hidden': 'true' }, el('use', { href: 'icons/icons.svg#icon-calendar' }))
            ),
            el('div', { text: 'Nenhum agendamento para esta data' }),
            el('div', { class: 'small', text: status ? `Filtro ativo: ${status}` : 'Confira a data selecionada ou escolha outro status.' })
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
              el('span', { text: a.cliente?.nome ? `Cliente: ${a.cliente.nome}` : '' }),
              el('span', { text: a.cliente?.telefone ? `Tel: ${a.cliente.telefone}` : '' }),
              el('span', { text: a.servico?.preco_centavos ? `Preço: ${brl(a.servico.preco_centavos)}` : '' })
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
          container.append(el('div', { class: 'vazio-agenda', role: 'status' },
            el('span', { class: 'icon', 'aria-hidden': 'true' },
              el('svg', { 'aria-hidden': 'true' }, el('use', { href: 'icons/icons.svg#icon-money' }))
            ),
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
            el('td', { text: c.item_tipo === 'servico' ? 'Serviço' : 'Produto' }),
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
          )),
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
          )),
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
            el('span', { class: 'icon vazio-icon', innerHTML: '<svg class="icon-svg"><use href="icons/icons.svg#icon-users"/></svg>' }),
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
              el('span', { text: c.telefone ? `Tel: ${c.telefone}` : '' }),
              el('span', { text: `Total: ${brl(c.total)}` }),
              el('span', { text: `Última visita: ${ultVisita}` })
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
        // Create modal for client history with option to add observation
        const modal = document.createElement('dialog');
        modal.className = 'history-modal';
        modal.innerHTML = `
          <form class="dlg" method="dialog">
            <div class="dialog-header">
              <h2 class="dialog-title">Histórico de ${clienteNome}</h2>
              <button class="dialog-close" type="button" aria-label="Fechar">
                <svg class="icon" aria-hidden="true"><use href="icons/icons.svg#icon-x"/></svg>
              </button>
            </div>
            <div class="dialog-body" style="max-height: 60vh; overflow-y: auto;">
              ${buildHistoryHtml(agendamentos, vendas, observacoes)}
              <div class="field" style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border-light);">
                <label for="nova-obs" class="field-label">Nova anotação</label>
                <textarea class="input" id="nova-obs" rows="3" placeholder="Digite uma observação privada sobre este cliente..." maxlength="500"></textarea>
              </div>
            </div>
            <div class="dialog-actions">
              <button class="btn btn-line" type="button" id="btn-fechar-historico">Fechar</button>
              <button class="btn btn-primary" type="button" id="btn-salvar-obs">Salvar anotação</button>
            </div>
          </form>
        `;

        document.body.appendChild(modal);

        const closeBtn = modal.querySelector('.dialog-close');
        const fecharBtn = modal.querySelector('#btn-fechar-historico');
        const salvarBtn = modal.querySelector('#btn-salvar-obs');
        const obsInput = modal.querySelector('#nova-obs');

        const closeModal = () => {
          modal.close();
          modal.remove();
        };

        closeBtn?.addEventListener('click', closeModal);
        fecharBtn?.addEventListener('click', closeModal);

        salvarBtn?.addEventListener('click', async () => {
          const conteudo = obsInput.value.trim();
          if (!conteudo) {
            toast('Digite o conteúdo da anotação', true);
            return;
          }

          salvarBtn.disabled = true;
          salvarBtn.textContent = 'Salvando...';

          try {
            await api.post(`/api/clientes/${clienteId}/observacoes`, { conteudo });
            toast('Anotação salva!');
            closeModal();
            // Refresh client list to show updated history
            carregarClientes();
          } catch (e) {
            toast(e.message, true);
          } finally {
            salvarBtn.disabled = false;
            salvarBtn.textContent = 'Salvar anotação';
          }
        });

        modal.showModal();

        // Focus the textarea
        setTimeout(() => obsInput?.focus(), 100);

        // Close on backdrop click
        modal.addEventListener('click', (e) => {
          if (e.target === modal) closeModal();
        });
      }).catch(e => toast(e.message, true));
    }

    function buildHistoryHtml(agendamentos, vendas, observacoes) {
      let html = '';

      if (agendamentos.length) {
        html += '<h4 style="margin-bottom: 8px; margin-top: 16px;"><svg class="icon-svg inline-icon" style="width: 18px; height: 18px;"><use href="icons/icons.svg#icon-scissors"/></svg> Agendamentos concluídos</h4><ul style="margin-bottom: 16px;">';
        for (const a of agendamentos) {
          const dt = new Date(a.inicio).toLocaleDateString('pt-BR');
          const hora = new Date(a.inicio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          html += `<li style="margin-bottom: 4px;">${dt} ${hora} — ${a.servico_nome} (${a.barbeiro_nome}) — ${brl(a.servico_preco)}</li>`;
        }
        html += '</ul>';
      }

      if (vendas.length) {
        html += '<h4 style="margin-bottom: 8px; margin-top: 16px;"><svg class="icon-svg inline-icon" style="width: 18px; height: 18px;"><use href="icons/icons.svg#icon-money"/></svg> Vendas (walk-in / produtos)</h4><ul style="margin-bottom: 16px;">';
        for (const v of vendas) {
          const dt = new Date(v.criado_em).toLocaleDateString('pt-BR');
          const hora = new Date(v.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          html += `<li style="margin-bottom: 4px;">${dt} ${hora} — ${v.forma_pagamento} — ${brl(v.total_centavos)}`;
          if (v.itens.length) {
            html += '<ul style="margin-top: 4px; margin-left: 16px; font-size: var(--text-sm); color: var(--text-secondary);">';
            for (const item of v.itens) {
              const icon = item.tipo === 'servico' ? 'icon-scissors' : 'icon-box';
              html += `<li><svg class="icon-svg inline-icon" style="width: 14px; height: 14px; margin-right: 4px;"><use href="icons/icons.svg#${icon}"/></svg> ${item.referencia_nome} × ${item.quantidade} — ${brl(item.preco_unit_centavos * item.quantidade)}</li>`;
            }
            html += '</ul>';
          }
          html += '</li>';
        }
        html += '</ul>';
      }

      if (observacoes.length) {
        html += '<h4 style="margin-bottom: 8px; margin-top: 16px;">📝 Anotações anteriores</h4><ul style="margin-bottom: 16px;">';
        for (const o of observacoes) {
          const dt = new Date(o.criado_em).toLocaleDateString('pt-BR');
          html += `<li style="margin-bottom: 4px; padding: 8px; background: var(--bg-secondary); border-radius: var(--radius-md);">${dt} (${o.barbeiro_nome}): ${o.conteudo}</li>`;
        }
        html += '</ul>';
      }

      if (!agendamentos.length && !vendas.length && !observacoes.length) {
        html += '<p class="muted" style="margin-top: 16px;">Nenhum histórico encontrado.</p>';
      }

      return html;
    }

    $('bcl-busca').addEventListener('input', carregarClientes);

    // Carrega clientes iniciais
    carregarClientes();

  } catch (erro) {
    toast(erro.message, true);
  }
})();