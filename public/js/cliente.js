'use strict';
(async function () {
  const { api, el, brl, iniciais, exigir, sair, toast } = window.App;
  const $ = (id) => document.getElementById(id);

  $('sair').addEventListener('click', sair);

  const tabs = ['agendar', 'minha-agenda', 'planos', 'servicos', 'barbeiros'];
  const tabPanels = tabs.map(t => $(`panel-${t}`));
  const menuBtn = $('mobile-menu-btn');
  const sidebar = $('sidebar');
  const sidebarOverlay = $('sidebar-overlay');
  const menuCloseBtn = $('fechar-menu');
  const sidebarTabs = sidebar.querySelectorAll('[data-tab-index]');
  const tituloPagina = $('titulo-pagina');
  const titulos = ['Agendar', 'Minha Agenda', 'Planos', 'Serviços', 'Barbeiros'];
  const menuMobile = window.matchMedia('(max-width: 1024px)');
  let btnConfirmar = null;

  function mostrarTab(idx) {
    tabPanels.forEach((p, i) => p.hidden = i !== idx);
    sidebarTabs.forEach((b) => {
      const selecionado = Number(b.dataset.tabIndex) === idx;
      b.classList.toggle('active', selecionado);
      if (selecionado) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    tituloPagina.textContent = titulos[idx];
  }

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
    if (aberto) menuCloseBtn.focus();
    else if (devolverFoco) menuBtn.focus();
  }

  sidebarTabs.forEach((b) => b.addEventListener('click', () => {
    mostrarTab(Number(b.dataset.tabIndex));
    definirMenuAberto(false, true);
  }));
  menuBtn.addEventListener('click', () => definirMenuAberto(menuBtn.getAttribute('aria-expanded') !== 'true'));
  menuCloseBtn.addEventListener('click', () => definirMenuAberto(false, true));
  sidebarOverlay.addEventListener('click', () => definirMenuAberto(false, true));
  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && menuBtn.getAttribute('aria-expanded') === 'true') {
      definirMenuAberto(false, true);
    }
  });
  menuMobile.addEventListener('change', () => definirMenuAberto(false));
  definirMenuAberto(false);
  mostrarTab(0);

  try {
    const usuario = await exigir('cliente');
    $('avatar').textContent = iniciais(usuario.nome);
    $('sidebar-user-name').textContent = usuario.nome;

    // ─── Carrega serviços e barbeiros ───
    const [{ servicos }, { barbeiros }] = await Promise.all([
      api.get('/api/servicos'),
      api.get('/api/barbeiros'),
    ]);
    const servicoPorId = new Map(servicos.map(s => [s.id, s]));
    const barbeiroPorId = new Map(barbeiros.map(b => [b.id, b]));
    const nomePorId = new Map(servicos.map(s => [s.id, s.nome]));

    // Preenche selects
    function preencheSelect(elSelect, itens, labelCampo, placeholder, vazio) {
      elSelect.replaceChildren(el('option', {
        value: '',
        text: itens.length ? placeholder : vazio,
      }));
      elSelect.disabled = itens.length === 0;
      for (const item of itens) {
        elSelect.append(el('option', { value: item.id }, item[labelCampo]));
      }
    }
    const barbeirosAtivos = barbeiros.filter(b => b.ativo);
    preencheSelect($('ag-servico'), servicos, 'nome', 'Selecione o serviço', 'Nenhum serviço disponível');
    preencheSelect($('ag-barbeiro'), barbeirosAtivos, 'nome', 'Selecione o barbeiro', 'Nenhum barbeiro disponível');
    if (!servicos.length || !barbeirosAtivos.length) {
      $('ag-erro').textContent = !servicos.length
        ? 'Não há serviços ativos para agendar no momento.'
        : 'Não há barbeiros disponíveis para agendamento no momento.';
      $('ag-erro').hidden = false;
    }

    // Define data mínima = hoje
    $('ag-data').min = new Date().toISOString().split('T')[0];
    $('ag-data').value = $('ag-data').min;

    // ─── Agendamento ───
    let horarioSelecionado = null;

    function atualizarBotaoConfirmar() {
      if (!btnConfirmar) return;
      btnConfirmar.disabled = !(
        $('ag-data').value &&
        $('ag-servico').value &&
        $('ag-barbeiro').value &&
        horarioSelecionado
      );
    }

    async function carregarHorarios() {
      const data = $('ag-data').value;
      const servicoId = Number($('ag-servico').value);
      const barbeiroId = Number($('ag-barbeiro').value);
      const container = $('ag-horarios');
      const erroEl = $('ag-erro');

      container.innerHTML = '<span class="muted small">Carregando horários...</span>';
      erroEl.hidden = true;
      horarioSelecionado = null;
      atualizarBotaoConfirmar();

      if (!servicos.length || !barbeirosAtivos.length) {
        container.innerHTML = '<span class="muted small">Agendamento indisponível no momento.</span>';
        erroEl.textContent = !servicos.length
          ? 'Não há serviços ativos para agendar no momento.'
          : 'Não há barbeiros disponíveis para agendamento no momento.';
        erroEl.hidden = false;
        return;
      }

      if (!data || !servicoId || !barbeiroId) {
        container.innerHTML = '<span class="muted small">Selecione data, serviço e barbeiro.</span>';
        atualizarBotaoConfirmar();
        return;
      }

      try {
        const { slots } = await api.get(`/api/horarios-livres?barbeiro=${barbeiroId}&data=${data}&servico=${servicoId}`);
        if (!slots.length) {
          container.innerHTML = '<span class="muted small">Nenhum horário livre para esta data.</span>';
          atualizarBotaoConfirmar();
          return;
        }
        container.innerHTML = '';
        for (const slot of slots) {
          const btn = el('button', {
            class: 'slot-btn',
            type: 'button',
            text: slot,
            onclick: () => selecionarHorario(btn, slot)
          });
          container.append(btn);
        }
        atualizarBotaoConfirmar();
      } catch (e) {
        erroEl.textContent = e.message;
        erroEl.hidden = false;
        container.innerHTML = '';
        atualizarBotaoConfirmar();
      }
    }

    function selecionarHorario(btn, hora) {
      document.querySelectorAll('#ag-horarios .slot-btn').forEach(b => b.classList.remove('selecionado'));
      btn.classList.add('selecionado');
      horarioSelecionado = hora;
      $('ag-erro').hidden = true;
      atualizarBotaoConfirmar();
    }

    $('ag-data').addEventListener('change', carregarHorarios);
    $('ag-servico').addEventListener('change', carregarHorarios);
    $('ag-barbeiro').addEventListener('change', carregarHorarios);

    async function criarAgendamento() {
      const data = $('ag-data').value;
      const servicoId = Number($('ag-servico').value);
      const barbeiroId = Number($('ag-barbeiro').value);
      const erroEl = $('ag-erro');

      if (!data || !servicoId || !barbeiroId || !horarioSelecionado) {
        erroEl.textContent = 'Preencha todos os campos e escolha um horário.';
        erroEl.hidden = false;
        return;
      }

      const inicio = `${data}T${horarioSelecionado}:00`;
      try {
        await api.post('/api/agendamentos', { barbeiro_id: barbeiroId, servico_id: servicoId, inicio });
        toast('Agendamento criado com sucesso!');
        horarioSelecionado = null;
        document.querySelectorAll('#ag-horarios .slot-btn').forEach(b => b.classList.remove('selecionado'));
        carregarHorarios();
        carregarMinhaAgenda();
      } catch (e) {
        erroEl.textContent = e.message;
        erroEl.hidden = false;
      }
    }

    $('ag-barbeiro').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && horarioSelecionado) criarAgendamento();
    });

    const containerHorarios = $('ag-horarios');
    btnConfirmar = el('button', { class: 'btn btn-primary btn-full cliente-booking-submit', text: 'Confirmar agendamento', onclick: criarAgendamento });
    btnConfirmar.disabled = true;
    containerHorarios.parentNode.insertBefore(btnConfirmar, containerHorarios.nextSibling);

    // ─── Minha Agenda ───
    async function carregarMinhaAgenda() {
      try {
        const { proximos, historico } = await api.get('/api/minha-agenda');
        renderAgenda($('agenda-proximos'), proximos, true);
        renderAgenda($('agenda-historico'), historico, false);
      } catch (e) {
        toast(e.message, true);
      }
    }

    function renderAgenda(container, agendamentos, podeCancelar) {
      if (!agendamentos.length) {
        container.innerHTML = '';
        container.append(el('p', { class: 'vazio-agenda' },
          el('span', { class: 'icon vazio-icon', innerHTML: '<svg class="icon-svg"><use href="icons/icons.svg#icon-calendar"/></svg>' }),
          el('div', { text: 'Nenhum agendamento' }),
          el('p', { class: 'small', text: podeCancelar ? 'Seus próximos agendamentos aparecerão aqui.' : 'Seu histórico aparecerá aqui.' })
        ));
        return;
      }
      container.innerHTML = '';
      for (const a of agendamentos) {
        const data = new Date(a.inicio);
        const dia = data.getDate().toString().padStart(2, '0');
        const mes = (data.getMonth() + 1).toString().padStart(2, '0');
        const hora = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const statusClass = `status-${a.status}`;
        const statusLabel = { pendente: 'Pendente', confirmado: 'Confirmado', cancelado: 'Cancelado', concluido: 'Concluído' }[a.status];

        const item = el('div', { class: 'item agenda-item' },
          el('div', { class: 'top' },
            el('div', { class: 'hora', text: `${dia}/${mes} às ${hora}` }),
            el('span', { class: `pill ${statusClass}`, text: statusLabel })
          ),
          el('div', { class: 'detalhes' },
            el('span', { text: a.servico?.nome || 'Serviço' }),
            el('span', { text: a.barbeiro?.nome ? `${a.barbeiro.nome}` : '' }),
            el('span', { class: 'price', text: a.servico?.preco_centavos ? `${brl(a.servico.preco_centavos)}` : '' })
          )
        );

        if (podeCancelar && (a.status === 'pendente' || a.status === 'confirmado')) {
          const btn = el('button', {
            class: 'btn btn-small btn-danger',
            text: 'Cancelar',
            onclick: () => cancelarAgendamento(a.id)
          });
          const acoes = el('div', { class: 'acoes' }, btn);
          item.append(acoes);
        }
        container.append(item);
      }
    }

    async function cancelarAgendamento(id) {
      if (!confirm('Tem certeza que deseja cancelar este agendamento?')) return;
      try {
        await api.put(`/api/agendamentos/${id}/cancelar`);
        toast('Agendamento cancelado.');
        carregarMinhaAgenda();
        carregarHorarios();
      } catch (e) {
        toast(e.message, true);
      }
    }

    // ─── Serviços ───
    $('servicos').replaceChildren(
      ...(servicos.length
        ? servicos.map((s) => el('div', { class: 'item' },
            el('div', {},
              el('div', { class: 't', text: s.nome }),
              el('div', { class: 'small muted', text: `${s.duracao_min} min` })),
            el('div', { class: 'price', text: brl(s.preco_centavos) })))
        : [el('p', { class: 'muted', text: 'Nenhum serviço disponível ainda.' })])
    );

    // ─── Barbeiros ───
    $('barbeiros').replaceChildren(
      ...(barbeiros.length
        ? barbeiros.map((b) => el('div', { class: 'item' },
            el('div', { class: 'barber' },
              el('span', { class: 'avatar light', 'aria-hidden': 'true', text: iniciais(b.nome) }),
              el('div', {},
                el('div', { class: 't', text: b.nome }),
                el('div', { class: 'chips' },
                  b.servicos.filter((id) => nomePorId.has(id))
                    .map((id) => el('span', { class: 'chip', text: nomePorId.get(id) })))))))
        : [el('p', { class: 'muted', text: 'Nenhum barbeiro disponível ainda.' })])
    );

    // ─── PLANOS E ASSINATURAS ───
    let planoSelecionado = null;
    let metodoSelecionado = null;

    async function carregarPlanos() {
      try {
        const [{ planos }, { assinatura }, { metodos }] = await Promise.all([
          api.get('/api/planos'),
          api.get('/api/minha-assinatura'),
          api.get('/api/metodos-pagamento'),
        ]);

        renderPlanosDisponiveis(planos);
        renderMinhaAssinatura(assinatura);
        renderMetodosPagamento(metodos);

        // Se já tem assinatura, esconde planos disponíveis
        if (assinatura?.assinatura) {
          $('planos-disponiveis').innerHTML = '';
          $('planos-disponiveis').append(el('p', { class: 'muted small', text: 'Você já possui uma assinatura ativa.' }));
        }
      } catch (e) {
        toast(e.message, true);
      }
    }

    function renderPlanosDisponiveis(planos) {
      const container = $('planos-disponiveis');
      container.innerHTML = '';
      if (!planos.length) {
        container.append(el('p', { class: 'muted', text: 'Nenhum plano disponível no momento.' }));
        return;
      }
      // Grid de planos
      container.className = 'plans-grid';
      for (const p of planos) {
        const beneficios = Array.isArray(p.beneficios) ? p.beneficios : [];
        const isPopular = p.popular === true;
        const intervaloTexto = p.intervalo_dias === 30 ? 'mês' : p.intervalo_dias + ' dias';

        const card = el('div', { class: `plan-card${isPopular ? ' popular' : ''}` },
          isPopular ? el('div', { class: 'plan-badge' }, 'MAIS POPULAR') : '',
          el('div', { class: 'plan-header' },
            el('div', { class: 'plan-name-row' },
              el('h3', { class: 'plan-name' }, p.nome),
              el('div', {},
                el('div', { class: 'plan-price' }, brl(p.preco_centavos)),
                el('span', { class: 'plan-period' }, `/${intervaloTexto}`)
              )
            ),
            el('p', { class: 'plan-description' }, p.descricao || '')
          ),
          el('div', { class: 'plan-features' },
            ...beneficios.map(b => el('div', { class: `plan-feature included` },
              el('svg', { class: 'icon icon-sm', innerHTML: '<use href="icons/icons.svg#icon-check"/>' }),
              formatBeneficio(b)
            ))
          ),
          el('div', { class: 'plan-limit' },
            el('svg', { class: 'icon icon-sm', innerHTML: '<use href="icons/icons.svg#icon-check"/>' }),
            `Assinar por ${brl(p.preco_centavos)}/${intervaloTexto}`
          ),
          el('div', { class: 'acoes' },
            el('button', {
              class: 'btn btn-primary btn-full',
              text: isPopular ? 'Assinar Agora' : 'Assinar',
              onclick: () => abrirCheckout(p)
            })
          )
        );
        container.append(card);
      }
    }

    function formatBeneficio(b) {
      const map = {
        // Planos novos
        '4_cortes_mes': '4 cortes por mês',
        '3_cortes_mes': '3 cortes por mês',
        '4_servicos_mes': '4 serviços por mês',
        '3_servicos_mes': '3 serviços por mês',
        'cabelo_apenas': 'Apenas cabelo',
        'cabelo_barba': 'Cabelo + Barba',
        'degrade': 'Corte Degradê',
        'navalhado': 'Corte Navalhado',
        'social': 'Corte Social',
        'barba_inclusa': 'Barba inclusa',
        'barba_mesclada': 'Barba Mesclada',
        // Legados (compatibilidade)
        cortes_ilimitados: 'Cortes ilimitados',
        acabamentos_ilimitados: 'Acabamentos ilimitados',
        desconto_20_produtos: '20% off produtos',
        desconto_30_produtos: '30% off produtos',
        todos_servicos_ilimitados: 'Todos serviços ilimitados',
        prioridade_agendamento: 'Prioridade no agendamento',
        brinde_mensal: 'Brinde mensal',
      };
      return map[b] || b.replace(/_/g, ' ');
    }

    function renderMinhaAssinatura(assinaturaData) {
      const titulo = $('minha-assinatura-titulo');
      const container = $('minha-assinatura');
      const faturasContainer = $('faturas-assinatura');

      if (!assinaturaData?.assinatura) {
        titulo.hidden = true;
        container.hidden = true;
        faturasContainer.hidden = true;
        return;
      }

      const a = assinaturaData.assinatura;
      titulo.hidden = false;
      container.hidden = false;
      faturasContainer.hidden = false;

      const statusLabels = {
        pendente: 'Pendente',
        ativa: 'Ativa',
        cancelada: 'Cancelada',
        atrasada: 'Atrasada',
        expirada: 'Expirada',
      };
      const statusClass = `status-${a.status}`;

      container.innerHTML = '';
      container.append(el('div', { class: 'item assinatura-card' },
        el('div', { class: 'top' },
          el('strong', { text: a.plano?.nome || 'Plano' }),
          el('span', { class: `pill ${statusClass}`, text: statusLabels[a.status] || a.status })
        ),
        el('div', { class: 'detalhes' },
          el('span', { text: `Próxima cobrança: ${a.proxima_cobranca ? new Date(a.proxima_cobranca).toLocaleDateString('pt-BR') : '—'}` }),
          el('span', { text: `Valor: ${brl(a.plano?.preco_centavos || 0)}/${a.plano?.intervalo_dias === 30 ? 'mês' : a.plano?.intervalo_dias + ' dias'}` }),
          el('span', { class: 'small muted', text: `Iniciada em: ${a.criado_em ? new Date(a.criado_em).toLocaleDateString('pt-BR') : '—'}` })
        ),
        el('div', { class: 'acoes' },
          el('button', {
            class: 'btn btn-small btn-danger',
            text: 'Cancelar assinatura',
            onclick: () => cancelarAssinatura(a.id)
          })
        )
      ));

      // Carrega faturas
      carregarFaturas(a.id);
    }

    async function carregarFaturas(assinaturaId) {
      try {
        // Busca faturas via API (precisa adicionar endpoint ou buscar via minha-assinatura expandido)
        // Por enquanto, busca via endpoint admin se for admin, ou criamos endpoint simples
        // Vamos usar um endpoint temporário ou buscar direto
        const { assinatura } = await api.get('/api/minha-assinatura');
        // As faturas não vêm no endpoint atual, vamos simular ou adicionar depois
        const faturasContainer = $('faturas-assinatura');
        faturasContainer.innerHTML = '';
        faturasContainer.append(el('p', { class: 'small muted', text: 'Histórico de cobranças será exibido aqui.' }));
      } catch (e) {
        // Silencioso
      }
    }

    function renderMetodosPagamento(metodos) {
      // Usado no checkout para selecionar cartão salvo
    }

    function abrirCheckout(plano) {
      planoSelecionado = plano;
      metodoSelecionado = null;

      const container = $('plano-checkout-resumo');
      container.innerHTML = '';
      container.append(el('div', { class: 'checkout-item' },
        el('strong', { text: plano.nome }),
        el('span', { text: `${brl(plano.preco_centavos)}/${plano.intervalo_dias === 30 ? 'mês' : plano.intervalo_dias + ' dias'}` })
      ));

      // Carrega métodos de pagamento
      carregarMetodosParaCheckout();

      $('dlg-plano-checkout').showModal();
    }

    async function carregarMetodosParaCheckout() {
      try {
        const { metodos } = await api.get('/api/metodos-pagamento');
        const select = $('plano-metodo');
        select.innerHTML = '<option value="">Selecione um cartão salvo</option>';

        if (metodos.length === 0) {
          select.innerHTML += '<option value="" disabled>Nenhum cartão salvo</option>';
          $('plano-novo-cartao').hidden = false;
        } else {
          for (const m of metodos) {
            const label = `${m.marca || 'Cartão'} •••• ${m.ultimos4 || '****'} (${m.expiracao || '**/**'})${m.padrao ? ' ⭐' : ''}`;
            select.append(el('option', { value: m.id }, label));
          }
          select.value = metodos.find(m => m.padrao)?.id || metodos[0].id;
          $('plano-novo-cartao').hidden = true;
        }
      } catch (e) {
        console.error(e);
      }
    }

    async function confirmarAssinatura() {
      if (!planoSelecionado) return;
      const metodoId = $('plano-metodo').value;
      if (!metodoId) {
        $('plano-erro').textContent = 'Selecione um método de pagamento.';
        $('plano-erro').hidden = false;
        return;
      }

      $('plano-erro').hidden = true;
      $('plano-confirmar').disabled = true;
      $('plano-confirmar').textContent = 'Processando...';

      try {
        await api.post('/api/assinaturas', {
          plano_id: planoSelecionado.id,
          metodo_pagamento_id: Number(metodoId),
          forma_pagamento: 'cartao',
        });
        toast('Assinatura criada com sucesso!');
        $('dlg-plano-checkout').close();
        planoSelecionado = null;
        carregarPlanos(); // Atualiza UI
      } catch (e) {
        $('plano-erro').textContent = e.message;
        $('plano-erro').hidden = false;
      } finally {
        $('plano-confirmar').disabled = false;
        $('plano-confirmar').textContent = 'Confirmar assinatura';
      }
    }

    async function cancelarAssinatura(id) {
      if (!confirm('Tem certeza que deseja cancelar sua assinatura? O acesso aos benefícios continuará até o fim do período pago.')) return;
      try {
        await api.put(`/api/assinaturas/${id}/cancelar`);
        toast('Assinatura cancelada.');
        carregarPlanos();
      } catch (e) {
        toast(e.message, true);
      }
    }

    // ─── Eventos dos Modais ───
    $('plano-cancelar').addEventListener('click', () => {
      $('dlg-plano-checkout').close();
      planoSelecionado = null;
    });

    $('form-plano-checkout').addEventListener('submit', (e) => {
      e.preventDefault();
      confirmarAssinatura();
    });

    $('plano-cadastrar-cartao').addEventListener('click', () => {
      $('dlg-plano-checkout').close();
      $('dlg-cartao').showModal();
    });

    $('cartao-abrir-mp').addEventListener('click', () => {
      // TODO: Abrir checkout do Mercado Pago para cadastrar cartão
      // window.open('/api/metodos-pagamento/checkout?cliente=...', '_blank');
      toast('Em desenvolvimento: abra o Mercado Pago e cadastre o cartão, depois volte aqui.');
    });

    $('cartao-fechar').addEventListener('click', () => {
      $('dlg-cartao').close();
    });

    // ─── Inicializa ───
    carregarMinhaAgenda();
    carregarHorarios();
    carregarPlanos();

  } catch (erro) {
    const mensagem = window.location.protocol === 'file:'
      ? 'Abra esta tela pelo servidor da aplicação (por exemplo, http://localhost:3000/cliente.html). O acesso direto ao arquivo não consegue carregar os serviços.'
      : erro.message;
    $('ag-servico').disabled = true;
    $('ag-barbeiro').disabled = true;
    $('ag-servico').replaceChildren(el('option', { value: '', text: 'Indisponível' }));
    $('ag-barbeiro').replaceChildren(el('option', { value: '', text: 'Indisponível' }));
    $('ag-erro').textContent = mensagem;
    $('ag-erro').hidden = false;
    if (btnConfirmar) btnConfirmar.disabled = true;
    toast(mensagem, true);
  }
})();