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

module.exports = {
  texto, email, senha, telefone, inteiro, booleano, idDaUrl, listaDeIds, jornada,
  dataISO, dataHoraISO, statusAgendamento, bloqueioDados, paraMinutos,
};
