# ROADMAP — Evolução do Sistema Navalha (Barbearia)

> Documento vivo: marque `[x]` conforme for entregando. Cada fase depende da anterior.

---

## ✅ Fase 1 — Base (CONCLUÍDA)

**Objetivo:** Fundação multi-papel + cadastros mestres.

| Item | Status | Detalhes |
|------|--------|----------|
| Login por papel (cliente, barbeiro, admin) | `[x]` | JWT em cookie HttpOnly, bloqueio 5 tentativas/15min |
| Cadastro de serviços | `[x]` | Nome, descrição, duração (min), preço (centavos), ativo/inativo |
| Cadastro de barbeiros | `[x]` | Login, comissão, serviços que atende, jornada semanal |
| Jornada de trabalho | `[x]` | Dia 0–6, múltiplos turnos/dia, sem sobreposição |
| Admin bootstrap (env vars) | `[x]` | `ADMIN_EMAIL`, `ADMIN_SENHA` na 1ª execução |
| Segurança base | `[x]` | scrypt, CSP, SQL parametrizado, SameSite=Lax |
| Testes automatizados | `[x]` | 9 testes passando (`npm test`) |
| Frontend (HTML/CSS/JS puro) | `[x]` | 4 telas: login, cliente, barbeiro, admin |

**Como rodar:**
```bash
node server.js          # porta 3000, cria admin na 1ª vez
npm test                # valida tudo
```

---

## ✅ Fase 2 — Agendamentos (CONCLUÍDA)

**Objetivo:** Cliente agenda, barbeiro/admin veem agenda, cancelamento.

| Item | Status | Detalhes / Regras |
|------|--------|-------------------|
| Cálculo de horários livres | `[x]` | Jornada − agendamentos confirmados − bloqueios manuais |
| `GET /api/horarios-livres?barbeiro=&data=&servico=` | `[x]` | Retorna slots de 15/30 min conforme duração do serviço |
| `POST /api/agendamentos` (cliente) | `[x]` | Cria em `pendente`, valida horário livre, conflitos |
| `PUT /api/agendamentos/:id/confirmar` (barbeiro/admin) | `[x]` | Muda para `confirmado` |
| `PUT /api/agendamentos/:id/cancelar` | `[x]` | Cliente (até 2h antes), barbeiro/admin (qualquer hora) |
| `GET /api/minha-agenda` (cliente) | `[x]` | Próximos + histórico |
| `GET /api/agenda-barbeiro?data=` (barbeiro) | `[x]` | Dia/semana/mês, filtro status |
| `GET /api/agenda-admin?data=&barbeiro=` (admin) | `[x]` | Visão geral, drag-and-drop futuro |
| Bloqueios manuais (admin) | `[x]` | "Feriado", "manutenção", "almoço estendido" |
| Notificação simples (log/console) | `[x]` | Base para Fase 4 (WhatsApp/e-mail) |

**Entregável de validação:**
 Cliente agenda → barbeiro vê na agenda → admin vê tudo → cancelamento libera horário.

---

## 🔄 Fase 3 — Operação Diária & Financeiro (EM ANDAMENTO)

**Objetivo:** Dinheiro na mão, barbeiro pago, estoque controlado.

| Módulo | Itens | Status |
|--------|-------|--------|
| **PDV (Ponto de Venda)** | `[ ]` Atendimento *walk-in* (sem agendamento) | `[ ]` |
| | `[ ]` Venda de produtos (shampoo, pomada, etc.) | `[ ]` |
| | `[ ]` Formas de pagamento: dinheiro, cartão, PIX | `[ ]` |
| | `[ ]` Fechamento de caixa (resumo + sangrias) | `[ ]` |
| **Comissão** | `[ ]` Regra por serviço (% ou fixo) | `[ ]` |
| | `[ ]` Regra por produto (% ou fixo) | `[ ]` |
| | `[ ]` Relatório "a receber" por barbeiro/período | `[ ]` |
| | `[ ]` Pagamento de comissão (marcar como pago) | `[ ]` |
| **Estoque** | `[ ]` Cadastro de produtos (SKU, custo, preço, qtd mínima) | `[ ]` |
| | `[ ]` Baixa automática no PDV | `[ ]` |
| | `[ ]` Alerta de reposição (aba "Estoque baixo") | `[ ]` |
| | `[ ]` Entrada manual / nota fiscal de compra | `[ ]` |
| **Caixa** | `[ ]` Abertura/fechamento diário com valores iniciais | `[ ]` |
| | `[ ]` Relatório: total dinheiro, cartão, PIX, comissões, diff | `[ ]` |
| **Histórico do Cliente** | `[ ]` Cortes anteriores (serviço, barbeiro, data, valor) | `[ ]` |
| | `[ ]` Produtos comprados | `[ ]` |
| | `[ ]` Anotações livres do barbeiro ("gosta topo baixo") | `[ ]` |

---

## 📦 Fase 3 — Operação Diária & Financeiro

**Objetivo:** Dinheiro na mão, barbeiro pago, estoque controlado.

| Módulo | Itens | Status |
|--------|-------|--------|
| **PDV (Ponto de Venda)** | `[ ]` Atendimento *walk-in* (sem agendamento) | `[ ]` |
| | `[ ]` Venda de produtos (shampoo, pomada, etc.) | `[ ]` |
| | `[ ]` Formas de pagamento: dinheiro, cartão, PIX | `[ ]` |
| | `[ ]` Fechamento de caixa (resumo + sangrias) | `[ ]` |
| **Comissão** | `[ ]` Regra por serviço (% ou fixo) | `[ ]` |
| | `[ ]` Regra por produto (% ou fixo) | `[ ]` |
| | `[ ]` Relatório "a receber" por barbeiro/período | `[ ]` |
| | `[ ]` Pagamento de comissão (marcar como pago) | `[ ]` |
| **Estoque** | `[ ]` Cadastro de produtos (SKU, custo, preço, qtd mínima) | `[ ]` |
| | `[ ]` Baixa automática no PDV | `[ ]` |
| | `[ ]` Alerta de reposição (aba "Estoque baixo") | `[ ]` |
| | `[ ]` Entrada manual / nota fiscal de compra | `[ ]` |
| **Caixa** | `[ ]` Abertura/fechamento diário com valores iniciais | `[ ]` |
| | `[ ]` Relatório: total dinheiro, cartão, PIX, comissões, diff | `[ ]` |
| **Histórico do Cliente** | `[ ]` Cortes anteriores (serviço, barbeiro, data, valor) | `[ ]` |
| | `[ ]` Produtos comprados | `[ ]` |
| | `[ ]` Anotações livres do barbeiro ("gosta topo baixo") | `[ ]` |

---

## 🔔 Fase 4 — Experiência do Cliente

**Objetivo:** Retenção, menos no-show, fidelização.

| Módulo | Itens | Status |
|--------|-------|--------|
| **Notificações** | `[ ]` Integração WhatsApp Business API (ou Twilio/Zenvia) | `[ ]` |
| | `[ ]` E-mail transacional (nodemailer + provedor) | `[ ]` |
| | `[ ]` Lembrete 24h antes (configurável) | `[ ]` |
| | `[ ]` Confirmação imediata + link cancelar | `[ ]` |
| | `[ ]` Aviso "estamos atrasados X min" | `[ ]` |
| **Fila de Espera** | `[ ]` Cliente entra na fila virtual (WhatsApp/site) | `[ ]` |
| | `[ ]` Notifica quando vaga abre (no-show/cancelamento) | `[ ]` |
| | `[ ]` Prioridade: ordem de chegada + preferência de barbeiro | `[ ]` |
| **Fidelidade / Pacotes** | `[ ]` Cartão "10 cortes = 1 grátis" (digital) | `[ ]` |
| | `[ ]` Pacotes pré-pagos (ex: 5 barbas) | `[ ]` |
| | `[ ]` Assinatura mensal (recorrência) | `[ ]` |
| **Avaliações** | `[ ]` Pós-corte: nota 1–5 + comentário opcional | `[ ]` |
| | `[ ]` Visível pro barbeiro (privado) e admin (público) | `[ ]` |
| | `[ ]` Média por barbeiro/serviço no painel admin | `[ ]` |

---

## 📊 Fase 5 — Gestão & Escala

**Objetivo:** Múltiplas unidades, visão de dono, integrações.

| Módulo | Itens | Status |
|--------|-------|--------|
| **Multi-unidade** | `[ ]` Cadastro de filiais (nome, endereço, telefone) | `[ ]` |
| | `[ ]` Barbeiros/serviços/agendas por unidade (ou compartilhados) | `[ ]` |
| | `[ ]` Admin global vê tudo; gerente de unidade vê só a sua | `[ ]` |
| **Relatórios Gerenciais** | `[ ]` Faturamento por serviço / barbeiro / unidade / período | `[ ]` |
| | `[ ]` Ocupação de cadeira (horas agendadas / horas disponíveis) | `[ ]` |
| | `[ ]` Ticket médio, LTV, frequência de retorno | `[ ]` |
| | `[ ]` Comissão total a pagar / já paga | `[ ]` |
| | `[ ]` Export CSV/PDF para contabilidade | `[ ]` |
| **Integrações** | `[ ]` NFe/NFSe (município) | `[ ]` |
| | `[ ]` Google Calendar (sync agenda barbeiro) | `[ ]` |
| | `[ ]` WhatsApp Business API (templates aprovados) | `[ ]` |
| | `[ ]` Pagamentos: Stripe, Mercado Pago, Asaas (PIX/cobrança) | `[ ]` |
| **Permissões Granulares** | `[ ]` Papéis: admin global, gerente unidade, recepcionista, só-leitura | `[ ]` |
| | `[ ]` Matriz de permissão por rota/ação | `[ ]` |

---

## 🛠️ Fase 6 — Engenharia & Qualidade

**Objetivo:** Sustentabilidade técnica, conformidade, observabilidade.

| Área | Itens | Status |
|------|-------|--------|
| **Testes** | `[ ]` E2E com Playwright (fluxos: cadastro→agenda→PDV→caixa) | `[ ]` |
| | `[ ]` Testes de carga (k6: 100 agendamentos simultâneos) | `[ ]` |
| | `[ ]` Coverage ≥ 80% nas regras de negócio | `[ ]` |
| **CI/CD** | `[ ]` GitHub Actions: lint + test + build em PR | `[ ]` |
| | `[ ]` Deploy automático (VPS/Docker/Coolify/Railway) | `[ ]` |
| | `[ ]` Migrações de BD versionadas (sql-migrate ou similar) | `[ ]` |
| **Observabilidade** | `[ ]` Logs estruturados (pino/winston → Loki/ELK) | `[ ]` |
| | `[ ]` Métricas: latência p95, erros 5xx, queue depth | `[ ]` |
| | `[ ]` Alertas: disco cheio, BD travado, taxa erro > 1% | `[ ]` |
| **Backup/Restore** | `[ ]` Backup diário automático (SQLite .dump → S3/R2) | `[ ]` |
| | `[ ]` Script de restore testado mensalmente | `[ ]` |
| | `[ ]` PITR (point-in-time recovery) se migrar para PostgreSQL | `[ ]` |
| **LGPD / Privacidade** | `[ ]` Exportar todos os dados do cliente (JSON) | `[ ]` |
| | `[ ]` Excluir conta + anonimizar agendamentos antigos | `[ ]` |
| | `[ ]` Termo de consentimento no cadastro | `[ ]` |
| | `[ ]` Política de retenção (ex: 5 anos fiscal, 2 anos marketing) | `[ ]` |

---

## 📌 Como usar este roadmap

1. **Antes de começar uma fase:** leia a seção completa, entenda dependências.
2. **Durante:** marque `[x]` nos itens conforme entrega.
3. **Pull Request:** referencie o item (ex: `closes #F2-horarios-livres`).
4. **Revisão semanal:** o que travou? o que adiantou? ajuste prioridades.

---

## 🎯 Próximo passo imediato

> **Iniciar Fase 2** — implementar `GET /api/horarios-livres` + `POST /api/agendamentos`.

Sugestão de ordem dentro da Fase 2:
1. Modelo de dados (`agendamentos`, `bloqueios`)
2. Cálculo de slots livres (função pura, testável)
3. Rotas da API + validações
4. Frontend: tela "Agendar" (cliente) + "Minha Agenda"
5. Frontend: agenda do barbeiro + admin
6. Cancelamento + testes

---

*Última atualização: 2026-11-04 — Fase 1 concluída, pronto para Fase 2.*