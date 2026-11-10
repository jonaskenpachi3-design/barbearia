'use strict';

const $ = (id) => document.getElementById(id);

const apiBase = '/api';

// Estado do agendamento
const estado = {
  cliente: { nome: '', telefone: '' },
  servico: null,
  barbeiro: null,
  data: '',
  horario: null,
  servicos: [],
  barbeiros: [],
};

// Utilidades
function mostrarErro(id, msg) {
  const el = $(id);
  el.textContent = msg || '';
  el.hidden = !msg;
}

function limparErros() {
  ['erro-dados', 'erro-servico', 'erro-barbeiro', 'erro-horario'].forEach(id => {
    const el = $(id);
    el.textContent = '';
    el.hidden = true;
  });
}

function toast(msg, erro = false) {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast' + (erro ? ' erro-toast' : '');
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 3500);
}

function formatarTelefone(tel) {
  const nums = tel.replace(/\D/g, '');
  if (nums.length === 11) return `(${nums.slice(0,2)}) ${nums.slice(2,7)}-${nums.slice(7)}`;
  if (nums.length === 10) return `(${nums.slice(0,2)}) ${nums.slice(2,6)}-${nums.slice(6)}`;
  return tel;
}

function formatarDataBR(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// Navegação entre passos
const passos = ['passo-dados', 'passo-servico', 'passo-barbeiro', 'passo-horario', 'passo-confirmacao'];
let passoAtual = 0;

function irParaPasso(novoPasso) {
  passos.forEach((id, i) => {
    $(id).hidden = i !== novoPasso;
  });
  passoAtual = novoPasso;
  window.scrollTo(0, 0);
}

function proximoPasso() {
  if (passoAtual < passos.length - 1) irParaPasso(passoAtual + 1);
}

function voltarPasso() {
  if (passoAtual > 0) irParaPasso(passoAtual - 1);
}

// Carrega serviços e barbeiros
async function carregarIniciais() {
  try {
    const [servicosRes, barbeirosRes] = await Promise.all([
      fetch(`${apiBase}/servicos`).then(r => r.json()),
      fetch(`${apiBase}/barbeiros`).then(r => r.json())
    ]);
    estado.servicos = servicosRes.servicos || [];
    estado.barbeiros = barbeirosRes.barbeiros || [];
    renderizarServicos();
    renderizarBarbeiros();
    // Define data mínima = hoje
    const hoje = new Date().toISOString().split('T')[0];
    $('ag-data').min = hoje;
    $('ag-data').value = hoje;
  } catch (e) {
    toast('Erro ao carregar serviços/barbeiros', true);
  }
}

// Renderização
function renderizarServicos() {
  const container = $('servicos-grid');
  container.innerHTML = '';

  // Agrupa por categoria (a API já ordena por categoria, preco_centavos DESC)
  const porCategoria = {};
  estado.servicos.forEach(s => {
    const cat = s.categoria || 'individual';
    if (!porCategoria[cat]) porCategoria[cat] = [];
    porCategoria[cat].push(s);
  });

  const ordemCategorias = ['individual', 'combo', 'plano'];
  const labels = { individual: 'Serviços Individuais', combo: 'Conjuntos / Combos', plano: 'Planos' };

  ordemCategorias.forEach(cat => {
    const servicos = porCategoria[cat];
    if (!servicos || !servicos.length) return;

    // Cabeçalho da categoria
    const header = document.createElement('div');
    header.className = 'servico-categoria-header';
    header.textContent = labels[cat] || cat;
    container.appendChild(header);

    // Serviços da categoria (já ordenados por preço desc pela API)
    servicos.forEach(s => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'servico-card';
      btn.setAttribute('role', 'listitem');
      btn.innerHTML = `
        <strong>${s.nome}</strong>
        <span class="servico-meta">${s.duracao_min} min · R$ ${(s.preco_centavos / 100).toFixed(2).replace('.', ',')}</span>
      `;
      btn.addEventListener('click', () => selecionarServico(s));
      container.appendChild(btn);
    });
  });
}

function renderizarBarbeiros() {
  const container = $('barbeiros-grid');
  container.innerHTML = '';
  estado.barbeiros.filter(b => b.ativo).forEach(b => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'barbeiro-card';
    btn.setAttribute('role', 'listitem');
    btn.innerHTML = `
      <div class="barbeiro-avatar">${iniciais(b.nome)}</div>
      <strong>${b.nome}</strong>
      <span class="barbeiro-servicos">${b.servicos?.length || 0} serviço${b.servicos?.length !== 1 ? 's' : ''}</span>
    `;
    btn.addEventListener('click', () => selecionarBarbeiro(b));
    container.appendChild(btn);
  });
}

function iniciais(nome) {
  const partes = String(nome).trim().split(/\s+/);
  const a = partes[0] ? partes[0][0] : '';
  const b = partes.length > 1 ? partes[partes.length - 1][0] : '';
  return (a + b).toUpperCase();
}

function selecionarServico(s) {
  estado.servico = s;
  document.querySelectorAll('.servico-card').forEach(el => el.classList.remove('selecionado'));
  event.currentTarget.classList.add('selecionado');
  mostrarErro('erro-servico', '');
  proximoPasso();
}

function selecionarBarbeiro(b) {
  estado.barbeiro = b;
  document.querySelectorAll('.barbeiro-card').forEach(el => el.classList.remove('selecionado'));
  event.currentTarget.classList.add('selecionado');
  mostrarErro('erro-barbeiro', '');
  proximoPasso();
  carregarHorarios();
}

// Carrega horários livres para a data selecionada
async function carregarHorarios() {
  const container = $('slots-container');
  const data = $('ag-data').value;
  if (!data || !estado.servico || !estado.barbeiro) {
    container.innerHTML = '<p class="vazio">Selecione a data</p>';
    return;
  }

  container.innerHTML = '<p class="vazio">Carregando horários...</p>';
  estado.data = data;

  try {
    const params = new URLSearchParams({
      barbeiro: estado.barbeiro.id,
      data,
      servico: estado.servico.id
    });
    const res = await fetch(`${apiBase}/horarios-livres?${params}`);
    const dados = await res.json();

    if (!res.ok) throw new Error(dados.erro || 'Erro ao buscar horários');

    estado.slots = dados.slots || [];
    renderizarSlots();
  } catch (e) {
    container.innerHTML = `<p class="vazio">${e.message}</p>`;
  }
}

function renderizarSlots() {
  const container = $('slots-container');
  if (!estado.slots.length) {
    container.innerHTML = '<p class="vazio">Nenhum horário livre nesta data</p>';
    return;
  }

  container.innerHTML = '';
  estado.slots.forEach(slot => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'slot-btn';
    btn.setAttribute('role', 'listitem');
    btn.textContent = slot.inicio.slice(11, 16); // HH:MM
    btn.addEventListener('click', () => selecionarHorario(slot));
    container.appendChild(btn);
  });
}

function selecionarHorario(slot) {
  estado.horario = slot;
  document.querySelectorAll('.slot-btn').forEach(el => el.classList.remove('selecionado'));
  event.currentTarget.classList.add('selecionado');
  mostrarErro('erro-horario', '');
  proximoPasso();
}

// Envio do agendamento
async function enviarAgendamento() {
  if (!estado.cliente.nome || !estado.cliente.telefone || !estado.servico || !estado.barbeiro || !estado.data || !estado.horario) {
    toast('Complete todos os passos', true);
    return;
  }

  const btn = $('btn-continuar');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Agendando...';

  try {
    const res = await fetch(`${apiBase}/agendamentos-publico`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: estado.cliente.nome,
        telefone: estado.cliente.telefone,
        barbeiro_id: estado.barbeiro.id,
        servico_id: estado.servico.id,
        inicio: `${estado.data}T${estado.horario.inicio.slice(11,16)}:00`
      })
    });

    const dados = await res.json();
    if (!res.ok) throw new Error(dados.erro || 'Erro ao agendar');

    // Sucesso - mostra confirmação
    mostrarConfirmacao(dados);
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

function mostrarConfirmacao(dados) {
  const ag = dados.agendamento;
  $('conf-servico').textContent = ag.servico?.nome || ag.servico_nome;
  $('conf-barbeiro').textContent = ag.barbeiro_nome;
  $('conf-data').textContent = formatarDataBR(ag.inicio.split('T')[0]);
  $('conf-horario').textContent = ag.inicio.slice(11, 16);
  $('conf-cliente').textContent = `${estado.cliente.nome} · ${formatarTelefone(estado.cliente.telefone)}`;
  $('conf-codigo').textContent = dados.codigo_cancelamento;

  irParaPasso(4); // passo-confirmacao
}

function reiniciar() {
  estado.cliente = { nome: '', telefone: '' };
  estado.servico = null;
  estado.barbeiro = null;
  estado.data = '';
  estado.horario = null;
  document.querySelectorAll('.selecionado').forEach(el => el.classList.remove('selecionado'));
  $('form-dados').reset();
  irParaPasso(0);
}

// Event Listeners
$('form-dados').addEventListener('submit', (e) => {
  e.preventDefault();
  const nome = $('cli-nome').value.trim();
  const telefone = $('cli-telefone').value.trim();
  if (nome.length < 2) return mostrarErro('erro-dados', 'Informe seu nome');
  if (!telefone || telefone.replace(/\D/g, '').length < 10) {
    return mostrarErro('erro-dados', 'Telefone inválido (mínimo 10 dígitos)');
  }
  estado.cliente = { nome, telefone };
  mostrarErro('erro-dados', '');
  proximoPasso();
});

$('voltar-servico').addEventListener('click', voltarPasso);
$('voltar-barbeiro').addEventListener('click', voltarPasso);
$('voltar-horario').addEventListener('click', voltarPasso);

$('ag-data').addEventListener('change', () => {
  if ($('ag-data').value) carregarHorarios();
});

$('btn-continuar').addEventListener('click', enviarAgendamento);
$('btn-novo-agendamento').addEventListener('click', reiniciar);

// Inicialização
carregarIniciais();