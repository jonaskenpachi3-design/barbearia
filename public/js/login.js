'use strict';
(function () {
  const { api, HOME } = window.App;
  const $ = (id) => document.getElementById(id);
  let modoCadastro = false;

  function definirModo(cadastro) {
    modoCadastro = cadastro;
    $('campo-nome').hidden = !cadastro;
    $('campo-telefone').hidden = !cadastro;
    $('enviar').textContent = cadastro ? 'Criar conta' : 'Entrar';
    $('troca-texto').textContent = cadastro ? 'Já tem conta?' : 'Ainda não tem conta?';
    $('troca').textContent = cadastro ? 'Entrar' : 'Criar conta';
    $('senha').autocomplete = cadastro ? 'new-password' : 'current-password';
    $('lead').textContent = cadastro
      ? 'Crie sua conta para agendar seu horário.'
      : 'Escolha o barbeiro, o serviço e o horário. Sem fila, sem ligação.';
    mostrarErro('');
  }

  function mostrarErro(mensagem) {
    $('erro').textContent = mensagem;
    $('erro').hidden = !mensagem;
  }

  $('troca').addEventListener('click', () => definirModo(!modoCadastro));

  $('form').addEventListener('submit', async (evento) => {
    evento.preventDefault();
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
