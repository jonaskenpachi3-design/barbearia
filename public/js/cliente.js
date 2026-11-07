'use strict';
(async function () {
  const { api, el, brl, iniciais, exigir, sair, toast, DIAS, turnosPorDia } = window.App;
  const $ = (id) => document.getElementById(id);

  $('sair').addEventListener('click', sair);

  try {
    const usuario = await exigir('cliente');
    $('avatar').textContent = iniciais(usuario.nome);
    const primeiroNome = usuario.nome.split(' ')[0];

    // Tabs
    const tabs = ['agendar', 'minha-agenda', 'servicos', 'barbeiros'];
    const tabBtns = tabs.map(t => $(`tab-${t}`));
    const tabPanels = tabs.map(t => $(`panel-${t}`));
    function mostrarTab(idx) {
      tabBtns.forEach((b, i) => {
        b.setAttribute('aria-selected', i === idx ? 'true' : 'false');
      });
      tabPanels.forEach((p, i) => p.hidden = i !== idx);
    }
    tabBtns.forEach((b, i) => b.addEventListener('click', () => mostrarTab(i)));
    mostrarTab(0);

    // Carrega serviços e barbeiros
    const [{ servicos }, { barbeiros }] = await Promise.all([
      api.get('/api/servicos'),
      api.get('/api/barbeiros'),
    ]);
    const servicoPorId = new Map(servicos.map(s => [s.id, s]));
    const barbeiroPorId = new Map(barbeiros.map(b => [b.id, b]));
    const nomePorId = new Map(servicos.map(s => [s.id, s.nome]));

    // Preenche selects
    function preencheSelect(elSelect, itens, labelCampo, placeholder) {
      elSelect.innerHTML = `<option value="">${placeholder}</option>`;
      for (const item of itens) {
        elSelect.append(el('option', { value: item.id }, item[labelCampo]));
      }
    }
    preencheSelect($('ag-servico'), servicos, 'nome', 'Selecione o serviço');
    preencheSelect($('ag-barbeiro'), barbeiros.filter(b => b.ativo), 'nome', 'Selecione o barbeiro');

    // Define data mínima = hoje
    $('ag-data').min = new Date().toISOString().split('T')[0];
    $('ag-data').value = $('ag-data').min;

    // Estado do agendamento
    let horarioSelecionado = null;

    // Carrega horários livres quando muda data/serviço/barbeiro
    async function carregarHorarios() {
      const data = $('ag-data').value;
      const servicoId = Number($('ag-servico').value);
      const barbeiroId = Number($('ag-barbeiro').value);
      const container = $('ag-horarios');
      const erroEl = $('ag-erro');

      container.innerHTML = '<span class="muted small">Carregando horários...</span>';
      erroEl.hidden = true;
      horarioSelecionado = null;

      if (!data || !servicoId || !barbeiroId) {
        container.innerHTML = '<span class="muted small">Selecione data, serviço e barbeiro.</span>';
        return;
      }

      try {
        const { slots, servico } = await api.get(`/api/horarios-livres?barbeiro=${barbeiroId}&data=${data}&servico=${servicoId}`);
        if (!slots.length) {
          container.innerHTML = '<span class="muted small">Nenhum horário livre para esta data.</span>';
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
      } catch (e) {
        erroEl.textContent = e.message;
        erroEl.hidden = false;
        container.innerHTML = '';
      }
    }

    function selecionarHorario(btn, hora) {
      document.querySelectorAll('#ag-horarios .slot-btn').forEach(b => b.classList.remove('selecionado'));
      btn.classList.add('selecionado');
      horarioSelecionado = hora;
      $('ag-erro').hidden = true;
    }

    $('ag-data').addEventListener('change', carregarHorarios);
    $('ag-servico').addEventListener('change', carregarHorarios);
    $('ag-barbeiro').addEventListener('change', carregarHorarios);

    // Cria agendamento
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
        // Limpa seleção e recarrega
        horarioSelecionado = null;
        document.querySelectorAll('#ag-horarios .slot-btn').forEach(b => b.classList.remove('selecionado'));
        carregarHorarios();
        carregarMinhaAgenda();
      } catch (e) {
        erroEl.textContent = e.message;
        erroEl.hidden = false;
      }
    }

    // Confirma criação no Enter no último campo ou botão
    $('ag-barbeiro').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && horarioSelecionado) criarAgendamento();
    });

    // Botão implícito: clicar no horário já agenda (ou podemos adicionar botão)
    // Vamos adicionar um botão de confirmação visível
    const containerHorarios = $('ag-horarios');
    const btnConfirmar = el('button', { class: 'btn btn-primary', style: 'margin-top: 12px; width: 100%;', text: 'Confirmar agendamento', onclick: criarAgendamento });
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
        carregarHorarios(); // libera o slot
      } catch (e) {
        toast(e.message, true);
      }
    }

    // ─── Serviços (lista simples) ───
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

    // Carrega agenda inicial
    carregarMinhaAgenda();
    carregarHorarios();

  } catch (erro) {
    toast(erro.message, true);
  }
})();