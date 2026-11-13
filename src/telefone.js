'use strict';
/**
 * Utilitários para normalização e validação de telefones brasileiros
 * Formato E.164: +5511999999999
 * Formato exibição: (11) 99999-9999
 */

const DDD_VALIDOS = new Set([
  '11','12','13','14','15','16','17','18','19',
  '21','22','24',
  '27','28',
  '31','32','33','34','35','37','38',
  '41','42','43','44','45','46',
  '47','48','49',
  '51','53','54','55',
  '61',
  '62','64',
  '63',
  '65','66',
  '67',
  '68',
  '69',
  '71','73','74','75','77','79',
  '81','82','83','84','85','86','87','88','89',
  '91','93','94',
  '92','97',
  '95',
  '96',
  '98','99'
]);

/**
 * Remove todos os caracteres não numéricos
 */
function apenasDigitos(str) {
  return String(str || '').replace(/\D/g, '');
}

/**
 * Normaliza telefone para formato E.164 (+5511999999999)
 * Aceita: (11) 99999-9999, 11999999999, +55 11 99999-9999, 5511999999999, etc.
 * @returns string no formato E.164 ou null se inválido
 */
function normalizarTelefone(telefone) {
  const digitos = apenasDigitos(telefone);

  if (!digitos) return null;

  let numero = digitos;

  // Remove código do país se presente (55)
  if (numero.startsWith('55') && numero.length >= 12) {
    numero = numero.slice(2);
  }

  // Deve ter 10 ou 11 dígitos (DDD + 8 ou 9 dígitos)
  if (numero.length !== 10 && numero.length !== 11) {
    return null;
  }

  const ddd = numero.slice(0, 2);
  if (!DDD_VALIDOS.has(ddd)) {
    return null;
  }

  const numeroLocal = numero.slice(2);

  // Validação básica: celular deve ter 9 dígitos e começar com 9
  // Fixo deve ter 8 dígitos
  if (numero.length === 11) {
    if (numeroLocal[0] !== '9') return null; // Celular deve começar com 9
  }

  return `+55${numero}`;
}

/**
 * Formata telefone para exibição no padrão brasileiro
 * @param telefone - pode ser E.164 (+5511999999999) ou apenas dígitos
 * @returns string formatada: (11) 99999-9999 ou (11) 9999-9999
 */
function formatarTelefoneBR(telefone) {
  const normalizado = normalizarTelefone(telefone);
  if (!normalizado) return telefone; // Retorna original se não conseguir normalizar

  // Remove +55
  const numero = normalizado.slice(3); // pula +55
  const ddd = numero.slice(0, 2);
  const local = numero.slice(2);

  if (local.length === 9) {
    // Celular: (11) 99999-9999
    return `(${ddd}) ${local.slice(0,5)}-${local.slice(5)}`;
  } else {
    // Fixo: (11) 9999-9999
    return `(${ddd}) ${local.slice(0,4)}-${local.slice(4)}`;
  }
}

/**
 * Valida se é um telefone brasileiro válido
 * @returns boolean
 */
function validarTelefoneBR(telefone) {
  return normalizarTelefone(telefone) !== null;
}

/**
 * Extrai DDD do telefone
 * @returns string com 2 dígitos ou null
 */
function extrairDDD(telefone) {
  const normalizado = normalizarTelefone(telefone);
  if (!normalizado) return null;
  return normalizado.slice(3, 5); // pula +55
}

/**
 * Verifica se é celular (9 dígitos após DDD)
 * @returns boolean
 */
function ehCelular(telefone) {
  const normalizado = normalizarTelefone(telefone);
  if (!normalizado) return false;
  const numero = normalizado.slice(3); // pula +55
  return numero.length === 11; // DDD(2) + 9 dígitos
}

module.exports = {
  normalizarTelefone,
  formatarTelefoneBR,
  validarTelefoneBR,
  extrairDDD,
  ehCelular,
  apenasDigitos,
};