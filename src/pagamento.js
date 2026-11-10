'use strict';
/**
 * Serviço de Pagamento - Abstração para gateways
 * Suporta: Mercado Pago (padrão), Asaas, Stripe
 * Configuração via .env
 */

const { randomBytes } = require('node:crypto');

class PagamentoGateway {
  constructor() {
    this.gateway = process.env.PAGAMENTO_GATEWAY || 'mercadopago';
    this.config = this._carregarConfig();
  }

  _carregarConfig() {
    switch (this.gateway) {
      case 'mercadopago':
        return {
          accessToken: process.env.MP_ACCESS_TOKEN,
          publicKey: process.env.MP_PUBLIC_KEY,
          webhookSecret: process.env.MP_WEBHOOK_SECRET,
          sandbox: process.env.MP_SANDBOX === 'true',
        };
      case 'asaas':
        return {
          apiKey: process.env.ASAAS_API_KEY,
          webhookSecret: process.env.ASAAS_WEBHOOK_SECRET,
          sandbox: process.env.ASAAS_SANDBOX === 'true',
        };
      case 'stripe':
        return {
          secretKey: process.env.STRIPE_SECRET_KEY,
          webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
        };
      default:
        return {};
    }
  }

  /**
   * Cria cliente no gateway
   */
  async criarCliente({ nome, email, telefone, cpf }) {
    if (!this.config.accessToken && !this.config.apiKey && !this.config.secretKey) {
      // Modo desenvolvimento - retorna ID simulado
      return { id: `dev_${randomBytes(8).toString('hex')}`, modo: 'desenvolvimento' };
    }

    // TODO: Implementar chamadas reais para cada gateway
    // Mercado Pago: POST /v1/customers
    // Asaas: POST /v3/customers
    // Stripe: POST /v1/customers
    throw new Error(`Gateway ${this.gateway} não implementado - configure credenciais no .env`);
  }

  /**
   * Salva método de pagamento (cartão) no gateway
   */
  async salvarMetodoPagamento({ clienteGatewayId, token, tipo = 'cartao' }) {
    if (!this.config.accessToken && !this.config.apiKey && !this.config.secretKey) {
      return {
        id: `card_dev_${randomBytes(8).toString('hex')}`,
        marca: 'visa',
        ultimos4: '4242',
        expiracao: '12/28',
      };
    }
    throw new Error(`Gateway ${this.gateway} não implementado`);
  }

  /**
   * Cria assinatura recorrente no gateway
   */
  async criarAssinatura({ clienteGatewayId, planoNome, precoCentavos, intervaloDias, cartaoId, formaPagamento = 'cartao' }) {
    if (!this.config.accessToken && !this.config.apiKey && !this.config.secretKey) {
      return {
        id: `sub_dev_${randomBytes(8).toString('hex')}`,
        status: 'ativa',
        proxima_cobranca: new Date(Date.now() + intervaloDias * 24 * 60 * 60 * 1000).toISOString(),
      };
    }
    throw new Error(`Gateway ${this.gateway} não implementado`);
  }

  /**
   * Cancela assinatura no gateway
   */
  async cancelarAssinatura(gatewayAssinaturaId) {
    if (!this.config.accessToken && !this.config.apiKey && !this.config.secretKey) {
      return { status: 'cancelada' };
    }
    throw new Error(`Gateway ${this.gateway} não implementado`);
  }

  /**
   * Processa webhook do gateway
   * Retorna: { tipo: 'assinatura_criada'|'pagamento_aprovado'|'pagamento_recusado'|'assinatura_cancelada', dados: {...} }
   */
  async processarWebhook(payload, signature) {
    // Verifica assinatura se configurado
    if (this.config.webhookSecret && signature) {
      const crypto = require('node:crypto');
      const expected = crypto.createHmac('sha256', this.config.webhookSecret).update(JSON.stringify(payload)).digest('hex');
      if (signature !== expected) {
        throw new Error('Assinatura webhook inválida');
      }
    }

    // Modo desenvolvimento - simula eventos
    if (!this.config.accessToken && !this.config.apiKey && !this.config.secretKey) {
      return this._simularWebhook(payload);
    }

    // TODO: Parsear payload real de cada gateway
    throw new Error(`Gateway ${this.gateway} não implementado`);
  }

  _simularWebhook(payload) {
    // Para testes locais - simula pagamento aprovado
    const eventType = payload.type || payload.event || 'payment_approved';

    const map = {
      'payment_approved': { tipo: 'pagamento_aprovado', dados: { fatura_id: payload.data?.id, status: 'paga' } },
      'payment_rejected': { tipo: 'pagamento_recusado', dados: { fatura_id: payload.data?.id, status: 'falhou' } },
      'subscription_created': { tipo: 'assinatura_criada', dados: { assinatura_id: payload.data?.id } },
      'subscription_cancelled': { tipo: 'assinatura_cancelada', dados: { assinatura_id: payload.data?.id } },
    };
    return map[eventType] || { tipo: 'desconhecido', dados: payload };
  }

  /**
   * Gera URL de checkout para cartão (Mercado Pago: card token)
   */
  async gerarCheckoutCartao({ clienteId, planoId, sucessoUrl, cancelUrl }) {
    if (!this.config.accessToken && !this.config.apiKey && !this.config.secretKey) {
      return `http://localhost:3000/cliente.html?mock=checkout&cliente=${clienteId}&plano=${planoId}`;
    }
    throw new Error(`Gateway ${this.gateway} não implementado`);
  }
}

// Singleton
let instancia = null;
function getPagamentoGateway() {
  if (!instancia) instancia = new PagamentoGateway();
  return instancia;
}

module.exports = { PagamentoGateway, getPagamentoGateway };