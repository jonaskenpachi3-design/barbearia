'use strict';
const { ErroHttp } = require('./http');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

function texto(valor, campo, { min = 1, max = 100, opcional = false } = {}) {
  if (valor === undefined || valor === null || valor === '') {
    if (opcional) return null;
    throw new ErroHttp(400, `Informe ${campo}.`);
  }
  if (typeof valor !== 'string') throw new ErroHttp(400, `${campo} inválido.`);
  const limpo = valor.trim();
  if (limpo.length < min) throw new ErroHttp(400, `${campo} deve ter pelo menos ${min} caracteres.`);
  if (limpo.length > max) throw new ErroHttp(400, `${campo} deve ter no máximo ${max} caracteres.`);
  return limpo;
}

function email(valor) {
  const e = texto(valor, 'o e-mail', { max: 120 }).toLowerCase();
  if (!EMAIL.test(e)) throw new ErroHttp(400, 'E-mail inválido.');
  return e;
}

function senha(valor) {
  if (typeof valor !== 'string' || valor.length < 8) {
    throw new ErroHttp(400, 'A senha deve ter pelo menos 8 caracteres.');
  }
  if (valor.length > 72) throw new ErroHttp(400, 'A senha deve ter no máximo 72 caracteres.');
  return valor;
}

function telefone(valor) {
  const t = texto(valor, 'o telefone', { opcional: true, max: 20 });
  if (t === null) return null;
  if (!/^[0-9()+\-\s]{8,20}$/.test(t)) throw new ErroHttp(400, 'Telefone inválido.');
  return t;
}

function inteiro(valor, campo, { min = 0, max = 1_000_000 } = {}) {
  if (typeof valor === 'string') {
    const n = Number(valor);
    if (!Number.isInteger(n)) throw new ErroHttp(400, `${campo} deve ser um número inteiro.`);
    valor = n;
  }
  if (!Number.isInteger(valor) || valor < min || valor > max) {
    throw new ErroHttp(400, `${campo} deve ser um número inteiro entre ${min} e ${max}.`);
  }
  return valor;
}

function booleano(valor, campo, padrao) {
  if (valor === undefined) return padrao;
  if (typeof valor !== 'boolean') throw new ErroHttp(400, `${campo} inválido.`);
  return valor;
}

function idDaUrl(valor) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) throw new ErroHttp(400, 'Identificador inválido.');
  return n;
}

function listaDeIds(valor, campo) {
  if (valor === undefined) return [];
  if (!Array.isArray(valor) || valor.length > 100) throw new ErroHttp(400, `${campo} inválido.`);
  const ids = valor.map((v) => inteiro(v, campo, { min: 1 }));
  return [...new Set(ids)];
}

function paraMinutos(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Valida a jornada: dias 0–6, HH:MM, fim > início, sem sobreposição no mesmo dia.
function jornada(valor) {
  if (!Array.isArray(valor) || valor.length > 40) throw new ErroHttp(400, 'Horários inválidos.');
  const itens = valor.map((h) => {
    if (h === null || typeof h !== 'object') throw new ErroHttp(400, 'Horário inválido.');
    const dia = inteiro(h.dia_semana, 'O dia da semana', { min: 0, max: 6 });
    if (typeof h.inicio !== 'string' || !HORA.test(h.inicio) ||
        typeof h.fim !== 'string' || !HORA.test(h.fim)) {
      throw new ErroHttp(400, 'Use o formato HH:MM nos horários.');
    }
    if (paraMinutos(h.fim) <= paraMinutos(h.inicio)) {
      throw new ErroHttp(400, 'O horário final deve ser depois do inicial.');
    }
    return { dia_semana: dia, inicio: h.inicio, fim: h.fim };
  });
  itens.sort((a, b) => a.dia_semana - b.dia_semana || paraMinutos(a.inicio) - paraMinutos(b.inicio));
  for (let i = 1; i < itens.length; i++) {
    const ant = itens[i - 1];
    const atual = itens[i];
    if (ant.dia_semana === atual.dia_semana && paraMinutos(atual.inicio) < paraMinutos(ant.fim)) {
      throw new ErroHttp(400, 'Há horários sobrepostos no mesmo dia.');
    }
  }
  return itens;
}

// Fase 2: validações de data/hora ISO 8601
const ISO_DATA = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

function dataISO(valor, campo = 'A data') {
  const d = texto(valor, campo, { max: 10, opcional: true });
  if (d === null) return null;
  if (!ISO_DATA.test(d)) throw new ErroHttp(400, `${campo} deve estar no formato YYYY-MM-DD.`);
  const data = new Date(d + 'T00:00:00');
  if (isNaN(data.getTime())) throw new ErroHttp(400, `${campo} inválida.`);
  return d;
}

function dataHoraISO(valor, campo = 'A data/hora') {
  const d = texto(valor, campo, { max: 19, opcional: false });
  if (!ISO_DATETIME.test(d)) throw new ErroHttp(400, `${campo} deve estar no formato YYYY-MM-DDTHH:MM:SS.`);
  const dt = new Date(d);
  if (isNaN(dt.getTime())) throw new ErroHttp(400, `${campo} inválida.`);
  return d;
}

function statusAgendamento(valor) {
  const permitidos = ['pendente', 'confirmado', 'cancelado', 'concluido'];
  if (!permitidos.includes(valor)) throw new ErroHttp(400, 'Status inválido.');
  return valor;
}

function bloqueioDados(valor) {
  if (!valor || typeof valor !== 'object') throw new ErroHttp(400, 'Dados do bloqueio inválidos.');
  const inicio = dataHoraISO(valor.inicio, 'Início do bloqueio');
  const fim = dataHoraISO(valor.fim, 'Fim do bloqueio');
  if (new Date(fim) <= new Date(inicio)) throw new ErroHttp(400, 'O fim deve ser depois do início.');
  const motivo = texto(valor.motivo, 'O motivo', { max: 100, opcional: true });
  return { inicio, fim, motivo };
}

// Fase 3: Validações PDV, Produtos, Caixa, Comissão

function formaPagamento(valor) {
  const permitidas = ['dinheiro', 'cartao', 'pix', 'misto'];
  const v = texto(valor, 'A forma de pagamento');
  if (!permitidas.includes(v)) throw new ErroHttp(400, 'Forma de pagamento inválida.');
  return v;
}

function produtoDados(valor) {
  if (!valor || typeof valor !== 'object') throw new ErroHttp(400, 'Dados do produto inválidos.');
  const sku = texto(valor.sku, 'O SKU', { max: 30 }).toUpperCase();
  if (!/^[A-Z0-9\-]{3,30}$/.test(sku)) throw new ErroHttp(400, 'SKU deve ter 3-30 caracteres (A-Z, 0-9, hífen).');
  const nome = texto(valor.nome, 'O nome', { max: 80 });
  const descricao = texto(valor.descricao, 'A descrição', { max: 200, opcional: true });
  const custo = inteiro(valor.custo_centavos, 'O custo', { min: 0, max: 1_000_000 });
  const preco = inteiro(valor.preco_centavos, 'O preço', { min: 0, max: 1_000_000 });
  const quantidade = inteiro(valor.quantidade ?? 0, 'A quantidade', { min: 0, max: 10000 });
  const qtd_minima = inteiro(valor.qtd_minima ?? 0, 'A quantidade mínima', { min: 0, max: 1000 });
  const comissao_pct = inteiro(valor.comissao_pct ?? 0, 'A comissão %', { min: 0, max: 100 });
  const comissao_fixo = inteiro(valor.comissao_fixo ?? 0, 'A comissão fixa (centavos)', { min: 0, max: 100000 });
  const ativo = booleano(valor.ativo, 'ativo', true);
  return { sku, nome, descricao, custo_centavos: custo, preco_centavos: preco, quantidade, qtd_minima, comissao_pct, comissao_fixo, ativo };
}

function servicoComissaoDados(valor) {
  if (!valor || typeof valor !== 'object') throw new ErroHttp(400, 'Dados de comissão do serviço inválidos.');
  const tipo = texto(valor.tipo, 'O tipo');
  if (!['percentual', 'fixo'].includes(tipo)) throw new ErroHttp(400, 'Tipo deve ser "percentual" ou "fixo".');
  const valorNum = inteiro(valor.valor, 'O valor', { min: 0 });
  if (tipo === 'percentual' && valorNum > 10000) throw new ErroHttp(400, 'Percentual máximo é 100% (10000).');
  return { tipo, valor: valorNum };
}

function vendaDados(valor) {
  if (!valor || typeof valor !== 'object') throw new ErroHttp(400, 'Dados da venda inválidos.');
  const cliente_id = valor.cliente_id ? inteiro(valor.cliente_id, 'O cliente', { min: 1 }) : null;
  const barbeiro_id = inteiro(valor.barbeiro_id, 'O barbeiro', { min: 1 });
  const itens = valor.itens;
  if (!Array.isArray(itens) || itens.length === 0) throw new ErroHttp(400, 'A venda deve ter pelo menos um item.');
  const forma_pagamento = formaPagamento(valor.forma_pagamento);
  const dinheiro_recebido = inteiro(valor.dinheiro_recebido ?? 0, 'O dinheiro recebido', { min: 0 });
  const desconto_centavos = inteiro(valor.desconto_centavos ?? 0, 'O desconto', { min: 0 });
  const observacao = texto(valor.observacao, 'A observação', { max: 200, opcional: true });
  return { cliente_id, barbeiro_id, itens, forma_pagamento, dinheiro_recebido, desconto_centavos, observacao };
}

function vendaItemDados(valor) {
  if (!valor || typeof valor !== 'object') throw new ErroHttp(400, 'Item da venda inválido.');
  const tipo = texto(valor.tipo, 'O tipo do item');
  if (!['servico', 'produto'].includes(tipo)) throw new ErroHttp(400, 'Tipo deve ser "servico" ou "produto".');
  const referencia_id = inteiro(valor.referencia_id, 'O ID de referência', { min: 1 });
  const quantidade = inteiro(valor.quantidade ?? 1, 'A quantidade', { min: 1, max: 100 });
  return { tipo, referencia_id, quantidade };
}

function caixaAberturaDados(valor) {
  if (!valor || typeof valor !== 'object') throw new ErroHttp(400, 'Dados de abertura inválidos.');
  const valor_inicial = inteiro(valor.valor_inicial_centavos ?? 0, 'O valor inicial', { min: 0, max: 10_000_000 });
  const observacao = texto(valor.observacao, 'A observação', { max: 200, opcional: true });
  return { valor_inicial_centavos: valor_inicial, observacao };
}

function caixaFechamentoDados(valor) {
  if (!valor || typeof valor !== 'object') throw new ErroHttp(400, 'Dados de fechamento inválidos.');
  const valor_final = inteiro(valor.valor_final_centavos, 'O valor final', { min: 0, max: 10_000_000 });
  const observacao = texto(valor.observacao, 'A observação', { max: 200, opcional: true });
  return { valor_final_centavos: valor_final, observacao };
}

function sangriaDados(valor) {
  if (!valor || typeof valor !== 'object') throw new ErroHttp(400, 'Dados da sangria inválidos.');
  const valor_centavos = inteiro(valor.valor_centavos, 'O valor', { min: 1, max: 1_000_000 });
  const motivo = texto(valor.motivo, 'O motivo', { max: 100, opcional: true });
  return { valor_centavos, motivo };
}

function comissaoPagamentoDados(valor) {
  if (!valor || typeof valor !== 'object') throw new ErroHttp(400, 'Dados de pagamento inválidos.');
  const observacao = texto(valor.observacao, 'A observação', { max: 200, opcional: true });
  return { observacao };
}

function observacaoDados(valor) {
  if (!valor || typeof valor !== 'object') throw new ErroHttp(400, 'Dados da observação inválidos.');
  const conteudo = texto(valor.conteudo, 'O conteúdo', { min: 1, max: 500 });
  return { conteudo };
}

module.exports = {
  texto, email, senha, telefone, inteiro, booleano, idDaUrl, listaDeIds, jornada,
  dataISO, dataHoraISO, statusAgendamento, bloqueioDados, paraMinutos,
  // Fase 3
  formaPagamento, produtoDados, servicoComissaoDados, vendaDados, vendaItemDados,
  caixaAberturaDados, caixaFechamentoDados, sangriaDados, comissaoPagamentoDados, observacaoDados,
};
