'use strict';
(function () {
  const { api, HOME } = window.App;
  const $ = (id) => document.getElementById(id);
  let modoCadastro = false;

  function atualizarTabs(cadastro) {
    const tabLogin = $('tab-login');
    const tabCadastro = $('tab-cadastro');
    if (tabLogin && tabCadastro) {
      tabLogin.classList.toggle('active', !cadastro);
      tabCadastro.classList.toggle('active', cadastro);
      tabLogin.setAttribute('aria-selected', !cadastro);
      tabCadastro.setAttribute('aria-selected', cadastro);
    }
    document.body.dataset.mode = cadastro ? 'cadastro' : 'login';
  }

  function definirModo(cadastro) {
    modoCadastro = cadastro;
    $('campo-nome').hidden = !cadastro;
    $('campo-telefone').hidden = !cadastro;
    $('nome').required = cadastro;
    $('telefone').required = cadastro;
    $('enviar').textContent = cadastro ? 'Criar conta' : 'Entrar';
    $('troca-texto').textContent = cadastro ? 'Já tem conta?' : 'Ainda não tem conta?';
    $('troca').textContent = cadastro ? 'Entrar' : 'Criar conta';
    $('senha').autocomplete = cadastro ? 'new-password' : 'current-password';
    $('lead').textContent = cadastro
      ? 'Crie sua conta para agendar seu horário.'
      : 'Excelência em corte e barba. Tradição e estilo desde 2019.';
    atualizarTabs(cadastro);
    mostrarErro('');
  }

  function mostrarErro(mensagem) {
    $('erro').textContent = mensagem;
    $('erro').hidden = !mensagem;
  }

  // Tab buttons for mode switching
  const tabLogin = $('tab-login');
  const tabCadastro = $('tab-cadastro');
  if (tabLogin && tabCadastro) {
    tabLogin.addEventListener('click', () => definirModo(false));
    tabCadastro.addEventListener('click', () => definirModo(true));
  }

  // Footer toggle button (kept for backward compatibility)
  $('troca').addEventListener('click', () => definirModo(!modoCadastro));

  $('form').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    if (!$('form').reportValidity()) return;
    mostrarErro('');
    const botao = $('enviar');
    botao.disabled = true;
    try {
      const corpo = { email: $('email').value, senha: $('senha').value };
      if (modoCadastro) {
        corpo.nome = $('nome').value;
        corpo.telefone = $('telefone').value;
      }
      const { usuario } = await api.post(modoCadastro ? '/api/auth/cadastro' : '/api/auth/login', corpo);
      location.replace(HOME[usuario.papel]);
    } catch (erro) {
      mostrarErro(erro.message);
      botao.disabled = false;
    }
  });

  // Quem já está logado vai direto para a própria página.
  api.get('/api/auth/me')
    .then(({ usuario }) => location.replace(HOME[usuario.papel]))
    .catch(() => { /* não logado: fica na tela de login */ });
})();