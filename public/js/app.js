'use strict';
// Utilitários compartilhados pelas páginas. Todo texto vai por textContent (sem innerHTML).
(function () {
  const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0]; // semana começando na segunda

  async function req(metodo, url, corpo) {
    const resp = await fetch(url, {
      method: metodo,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await resp.text();
    let dados = null;
    if (texto) {
      try { dados = JSON.parse(texto); } catch { /* resposta sem JSON */ }
    }
    if (!resp.ok) {
      const erro = new Error((dados && dados.erro) || 'Algo deu errado. Tente novamente.');
      erro.status = resp.status;
      throw erro;
    }
    return dados;
  }

  const api = {
    get: (url) => req('GET', url),
    post: (url, corpo = {}) => req('POST', url, corpo),
    put: (url, corpo = {}) => req('PUT', url, corpo),
    delete: (url) => req('DELETE', url),
  };

  // el('div', { class: 'x', text: 'oi', onclick: fn }, filho1, 'texto', ...)
  function el(tag, props = {}, ...filhos) {
    const no = document.createElement(tag);
    for (const [chave, valor] of Object.entries(props)) {
      if (valor === undefined || valor === null || valor === false) continue;
      if (chave === 'class') no.className = valor;
      else if (chave === 'text') no.textContent = valor;
      else if (chave.startsWith('on')) no.addEventListener(chave.slice(2), valor);
      else if (valor === true) no.setAttribute(chave, '');
      else no.setAttribute(chave, valor);
    }
    for (const filho of filhos.flat()) {
      if (filho === undefined || filho === null || filho === false) continue;
      no.append(filho instanceof Node ? filho : document.createTextNode(String(filho)));
    }
    return no;
  }

  const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const brl = (centavos) => moeda.format(centavos / 100);

  function iniciais(nome) {
    const partes = String(nome).trim().split(/\s+/);
    const a = partes[0] ? partes[0][0] : '';
    const b = partes.length > 1 ? partes[partes.length - 1][0] : (partes[0] || '')[1] || '';
    return (a + b).toUpperCase();
  }

  let temporizador;
  function toast(mensagem, erro = false) {
    let no = document.getElementById('toast');
    if (!no) {
      no = el('div', { id: 'toast', class: 'toast', role: 'status' });
      document.body.append(no);
    }
    no.className = 'toast' + (erro ? ' erro-toast' : '');
    no.textContent = mensagem;
    no.hidden = false;
    clearTimeout(temporizador);
    temporizador = setTimeout(() => { no.hidden = true; }, 3500);
  }

  const HOME = { cliente: 'cliente.html', barbeiro: 'barbeiro.html', admin: 'admin.html' };

  // Garante login e papel; redireciona quem não deve estar na página.
  async function exigir(...papeis) {
    try {
      const { usuario } = await api.get('/api/auth/me');
      if (!papeis.includes(usuario.papel)) {
        location.replace(HOME[usuario.papel]);
        return new Promise(() => {});
      }
      return usuario;
    } catch (erro) {
      if (erro.status === 401) {
        location.replace('index.html');
        return new Promise(() => {});
      }
      throw erro;
    }
  }

  async function sair() {
    try { await api.post('/api/auth/logout'); } finally { location.replace('index.html'); }
  }

  // Agrupa horários por dia para exibição.
  function turnosPorDia(horarios) {
    const mapa = new Map(ORDEM_DIAS.map((d) => [d, []]));
    for (const h of horarios) mapa.get(h.dia_semana).push(h);
    return mapa;
  }

  window.App = { api, el, brl, iniciais, toast, exigir, sair, DIAS, ORDEM_DIAS, HOME, turnosPorDia };
})();
