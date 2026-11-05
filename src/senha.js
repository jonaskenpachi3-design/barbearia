'use strict';
// Hash de senha com scrypt (nativo do Node, sem dependências).
const { scrypt, randomBytes, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');

const scryptAsync = promisify(scrypt);
const TAMANHO = 64;

async function hashSenha(senha) {
  const sal = randomBytes(16);
  const hash = await scryptAsync(senha, sal, TAMANHO);
  return `scrypt$${sal.toString('hex')}$${hash.toString('hex')}`;
}

async function conferirSenha(senha, armazenado) {
  const [alg, salHex, hashHex] = String(armazenado).split('$');
  if (alg !== 'scrypt' || !salHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, 'hex');
  const calculado = await scryptAsync(senha, Buffer.from(salHex, 'hex'), esperado.length);
  return timingSafeEqual(calculado, esperado);
}

module.exports = { hashSenha, conferirSenha };
