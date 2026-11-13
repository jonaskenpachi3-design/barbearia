'use strict';
/**
 * Validação de CPF e CNPJ (algoritmo oficial)
 * Sem dependências externas
 */

/**
 * Remove formatação (pontos, traços, barras)
 */
function apenasDigitos(str) {
  return String(str || '').replace(/\D/g, '');
}

/**
 * Calcula dígito verificador (módulo 11)
 * @param base - string de dígitos base
 * @param pesoInicial - peso inicial (10 para CPF primeiro dígito, 11 para segundo, etc.)
 * @returns dígito verificador (0-9)
 */
function calcularDV(base, pesoInicial) {
  let soma = 0;
  let peso = pesoInicial;

  for (let i = 0; i < base.length; i++) {
    soma += parseInt(base[i], 10) * peso;
    peso--;
    if (peso < 2) peso = 9; // Para CNPJ, peso reinicia em 9 após chegar a 2
  }

  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/**
 * Valida CPF (11 dígitos)
 * @param cpf - string com ou sem formatação
 * @returns true se válido
 */
function validarCPF(cpf) {
  const digitos = apenasDigitos(cpf);

  // Deve ter 11 dígitos
  if (digitos.length !== 11) return false;

  // Rejeita sequências iguais (111.111.111-11, etc.)
  if (/^(\d)\1{10}$/.test(digitos)) return false;

  // Calcula primeiro dígito verificador (peso 10 a 2)
  const dv1 = calcularDV(digitos.slice(0, 9), 10);
  if (dv1 !== parseInt(digitos[9], 10)) return false;

  // Calcula segundo dígito verificador (peso 11 a 2)
  const dv2 = calcularDV(digitos.slice(0, 10), 11);
  if (dv2 !== parseInt(digitos[10], 10)) return false;

  return true;
}

/**
 * Valida CNPJ (14 dígitos)
 * @param cnpj - string com ou sem formatação
 * @returns true se válido
 */
function validarCNPJ(cnpj) {
  const digitos = apenasDigitos(cnpj);

  // Deve ter 14 dígitos
  if (digitos.length !== 14) return false;

  // Rejeita sequências iguais
  if (/^(\d)\1{13}$/.test(digitos)) return false;

  // Primeiro dígito verificador (pesos: 5,4,3,2,9,8,7,6,5,4,3,2)
  const base1 = digitos.slice(0, 12);
  const pesos1 = [5,4,3,2,9,8,7,6,5,4,3,2];
  let soma1 = 0;
  for (let i = 0; i < 12; i++) {
    soma1 += parseInt(base1[i], 10) * pesos1[i];
  }
  const dv1 = soma1 % 11 < 2 ? 0 : 11 - (soma1 % 11);
  if (dv1 !== parseInt(digitos[12], 10)) return false;

  // Segundo dígito verificador (pesos: 6,5,4,3,2,9,8,7,6,5,4,3,2)
  const base2 = digitos.slice(0, 13);
  const pesos2 = [6,5,4,3,2,9,8,7,6,5,4,3,2];
  let soma2 = 0;
  for (let i = 0; i < 13; i++) {
    soma2 += parseInt(base2[i], 10) * pesos2[i];
  }
  const dv2 = soma2 % 11 < 2 ? 0 : 11 - (soma2 % 11);
  if (dv2 !== parseInt(digitos[13], 10)) return false;

  return true;
}

/**
 * Formata CPF: 123.456.789-09
 */
function formatarCPF(cpf) {
  const digitos = apenasDigitos(cpf);
  if (digitos.length !== 11) return cpf;
  return `${digitos.slice(0,3)}.${digitos.slice(3,6)}.${digitos.slice(6,9)}-${digitos.slice(9)}`;
}

/**
 * Formata CNPJ: 12.345.678/0001-99
 */
function formatarCNPJ(cnpj) {
  const digitos = apenasDigitos(cnpj);
  if (digitos.length !== 14) return cnpj;
  return `${digitos.slice(0,2)}.${digitos.slice(2,5)}.${digitos.slice(5,8)}/${digitos.slice(8,12)}-${digitos.slice(12)}`;
}

/**
 * Detecta se é CPF ou CNPJ e valida
 * @returns { tipo: 'cpf'|'cnpj'|null, valido: boolean, formatado: string }
 */
function validarDocumento(doc) {
  const digitos = apenasDigitos(doc);

  if (digitos.length === 11) {
    const valido = validarCPF(digitos);
    return { tipo: 'cpf', valido, formatado: valido ? formatarCPF(digitos) : doc };
  }

  if (digitos.length === 14) {
    const valido = validarCNPJ(digitos);
    return { tipo: 'cnpj', valido, formatado: valido ? formatarCNPJ(digitos) : doc };
  }

  return { tipo: null, valido: false, formatado: doc };
}

/**
 * Gera CPF válido aleatório (para testes)
 */
function gerarCPF() {
  let base = '';
  for (let i = 0; i < 9; i++) {
    base += Math.floor(Math.random() * 10);
  }
  const dv1 = calcularDV(base, 10);
  base += dv1;
  const dv2 = calcularDV(base, 11);
  base += dv2;
  return formatarCPF(base);
}

/**
 * Gera CNPJ válido aleatório (para testes)
 */
function gerarCNPJ() {
  let base = '';
  for (let i = 0; i < 12; i++) {
    base += Math.floor(Math.random() * 10);
  }
  // Garante que não é sequência repetida
  if (/^(\d)\1{11}$/.test(base)) {
    base = (parseInt(base) + 1).toString().padStart(12, '0');
  }

  const pesos1 = [5,4,3,2,9,8,7,6,5,4,3,2];
  let soma1 = 0;
  for (let i = 0; i < 12; i++) {
    soma1 += parseInt(base[i], 10) * pesos1[i];
  }
  const dv1 = soma1 % 11 < 2 ? 0 : 11 - (soma1 % 11);
  base += dv1;

  const pesos2 = [6,5,4,3,2,9,8,7,6,5,4,3,2];
  let soma2 = 0;
  for (let i = 0; i < 13; i++) {
    soma2 += parseInt(base[i], 10) * pesos2[i];
  }
  const dv2 = soma2 % 11 < 2 ? 0 : 11 - (soma2 % 11);
  base += dv2;

  return formatarCNPJ(base);
}

module.exports = {
  validarCPF,
  validarCNPJ,
  formatarCPF,
  formatarCNPJ,
  validarDocumento,
  gerarCPF,
  gerarCNPJ,
  apenasDigitos,
};