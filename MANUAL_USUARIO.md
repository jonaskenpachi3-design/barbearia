# Manual do Usuário — Navalha Barbearia

**Versão:** 1.0 (Fases 1–3)  
**Sistema:** Navalha — Sistema de Gestão para Barbearia  
**Público:** Administradores, Barbeiros e Clientes

---

## Sumário

1. [Introdução](#1-introdução)
2. [Acesso ao Sistema](#2-acesso-ao-sistema)
3. [Painel do Administrador](#3-painel-do-administrador)
4. [Painel do Barbeiro](#4-painel-do-barbeiro)
5. [Área do Cliente](#5-área-do-cliente)
6. [Agendamento Público (sem login)](#6-agendamento-público-sem-login)
7. [Fluxos de Trabalho Comuns](#7-fluxos-de-trabalho-comuns)
8. [Dúvidas Frequentes](#8-dúvidas-frequentes)

---

## 1. Introdução

O **Navalha** é um sistema completo de gestão para barbearias, desenvolvido em Node.js nativo com SQLite. Ele cobre todo o ciclo operacional:

- **Gestão de pessoas**: Clientes, barbeiros, administradores
- **Agendamentos**: Horários livres calculados automaticamente, confirmação, cancelamento, conclusão
- **Produtos & Estoque**: Cadastro, entrada, alerta de estoque baixo
- **PDV (Ponto de Venda)**: Vendas walk-in de serviços e produtos, múltiplas formas de pagamento
- **Caixa**: Abertura/fechamento diário, sangrias, conferência automática
- **Comissões**: Por serviço ou padrão do barbeiro, pagamento individual ou em lote
- **Histórico do cliente**: Agendamentos concluídos + vendas + observações privadas do barbeiro

### Papéis e Permissões

| Papel | Acesso |
|-------|--------|
| **Administrador** | Sistema completo: cadastros, agenda geral, caixa, comissões, relatórios |
| **Barbeiro** | Própria agenda, jornada, serviços, comissões, clientes (histórico/observações) |
| **Cliente** | Agendar, minha agenda, planos, ver serviços/barbeiros |

---

## 2. Acesso ao Sistema

### 2.1 Primeira Execução

Na primeira vez que o sistema roda sem administradores cadastrados, ele cria um admin automaticamente e exibe **e-mail e senha no terminal** (aparece **uma única vez**):

```
=== ADMIN CRIADO AUTOMATICAMENTE ===
E-mail: admin@navalha.local
Senha:  k7#mP9@vL2
====================================
```

> **Importante:** Anote essas credenciais imediatamente. Para definir suas próprias, inicie com:
> ```bash
> ADMIN_EMAIL=seu@email.com ADMIN_SENHA='sua-senha-forte' node server.js
> ```

### 2.2 Login

1. Acesse `http://localhost:3000` (ou seu domínio em produção)
2. Na tela de **Entrar**, informe e-mail e senha
3. Clique em **Entrar**
4. O sistema redireciona automaticamente para o painel do seu papel

### 2.3 Cadastro de Cliente

Clientes podem se cadastrar sozinhos:
1. Na tela de login, clique em **Criar conta**
2. Preencha: nome, e-mail, telefone (WhatsApp), senha
3. Clique em **Cadastrar** — já entra logado como cliente

### 2.4 Logout

No menu lateral (☰), clique em **Sair**. A sessão é encerrada e o cookie removido.

### 2.5 Sessão e Segurança

- **Duração:** 7 dias (renovada a cada 30 min de atividade)
- **Cookie:** `HttpOnly` + `SameSite=Lax` (proteção contra CSRF/XSS)
- **Rate limit:** 5 tentativas de login por IP+e-mail a cada 15 min (bloqueio automático)

---

## 3. Painel do Administrador

Acesse em `/admin.html` após login como admin. O painel tem **8 abas**:

### 3.1 Aba: Serviços

**O que faz:** Cadastra e gerencia serviços oferecidos (corte, barba, hidratação, etc.).

**Campos:**
- **Nome** — Ex: "Corte Social", "Barba Completa"
- **Preço (centavos)** — Valor inteiro: `2500` = R$ 25,00
- **Duração (min)** — Tempo do agendamento (ex: 30, 45, 60)
- **Comissão padrão (%)** — Percentual base para barbeiros (centésimos: `5000` = 50%)
- **Ativo** — Desmarcar para desativar (soft delete, mantém histórico)

**Ações:**
- **Novo Serviço** → preenche formulário → **Salvar**
- **Editar** → clica no ícone ✏️ na linha → altera → **Salvar**
- **Desativar** → edita e desmarca "Ativo" → **Salvar**

> **Dica:** Serviços inativos não aparecem para clientes agendarem, mas continuam no histórico.

### 3.2 Aba: Barbeiros

**O que faz:** Cadastra barbeiros, define login, comissão e quais serviços atendem.

**Campos:**
- **Nome completo**
- **E-mail** (login)
- **Senha inicial** (o barbeiro pode trocar depois)
- **Comissão padrão (%)** — Sobrescrita por regra de serviço se houver
- **Serviços que atende** — Marque os serviços (múltipla escolha)
- **Ativo** — Desmarcar desativa login e remove da agenda pública

**Jornada de Trabalho (por barbeiro):**
Após criar/editar, clique em **Jornada** (ícone 🕐) para definir horários:
- **Dia da semana:** 0=Domingo ... 6=Sábado
- **Início / Fim:** Formato `HH:MM` (ex: 09:00 / 18:00)
- **Múltiplos turnos/dia:** Adicione várias linhas pro mesmo dia (ex: 09:00–12:00 e 13:00–18:00)
- **Validação:** Não permite sobreposição no mesmo dia

**Ações:**
- **Novo Barbeiro** → preenche → **Salvar** → define jornada
- **Editar** → ✏️ → altera dados e/ou jornada → **Salvar**
- **Desativar** → edita e desmarca "Ativo" → **Salvar** (derruba sessão ativa)

### 3.3 Aba: Agenda

**Visão geral de todos os agendamentos** com filtros:

**Filtros:**
- **Data** — Dia específico (padrão: hoje)
- **Barbeiro** — Todos ou um específico
- **Status** — Pendente, Confirmado, Cancelado, Concluído

**Ações por agendamento (ícones na linha):**
- ✅ **Confirmar** — Muda pendente → confirmado (barbeiro/admin)
- ❌ **Cancelar** — Cancela com motivo (respeita regra: cliente até 2h antes)
- ✔️ **Concluir** — Marca como finalizado → **gera comissão** + entra no histórico do cliente
- 👁️ **Ver detalhes** — Modal com info completa

> **Regra de 2h:** Cliente só cancela se faltar > 2h pro horário. Barbeiro/admin cancelam livremente.

### 3.4 Aba: Bloqueios

**Bloqueia horários** na agenda (feriados, folga, manutenção).

**Tipos:**
- **Por barbeiro** — Seleciona barbeiro + data + período (início/fim)
- **Global (feriado)** — Deixa barbeiro vazio = bloqueia **todos** barbeiros naquele horário

**Ações:**
- **Novo Bloqueio** → preenche → **Salvar**
- **Remover** → 🗑️ na linha → libera horários instantaneamente

### 3.5 Aba: Produtos

**Gestão de estoque e venda de produtos** (pomadas, shampoos, óleos, etc.).

**Campos do Produto:**
- **Nome**
- **SKU** — Código único (ex: `POM-001`, `SHA-002`)
- **Custo (centavos)** — Valor de compra
- **Preço (centavos)** — Valor de venda
- **Estoque atual** — Quantidade em mãos
- **Estoque mínimo** — Alerta quando abaixo disso
- **Comissão (%)** — Percentual pro barbeiro na venda (centésimos: `3000` = 30%)
- **Ativo**

**Ações:**
- **Novo Produto** → preenche → **Salvar**
- **Editar** → ✏️ → altera → **Salvar**
- **Entrada de Estoque** → 📦 na linha → informa quantidade → **Confirmar** (soma ao estoque)
- **Alerta Estoque Baixo** — Botão **⚠️ Baixo Estoque** lista produtos abaixo do mínimo

> **Importante:** Venda no PDV baixa estoque automaticamente. Reponha via "Entrada de Estoque".

### 3.6 Aba: Caixa

**Controle financeiro diário** — abertura, sangrias, fechamento e conferência.

#### Abrir Caixa
1. Clique **Abrir Caixa**
2. Informe **Valor Inicial (centavos)** — dinheiro no caixa no início do dia
3. **Observação** (opcional) — ex: "Troco inicial"
4. **Confirmar** — Só pode haver **um caixa aberto por dia**

#### Sangria (Retirada)
Durante o dia, retire dinheiro do caixa:
1. No caixa aberto, clique **Sangria**
2. **Valor (centavos)** + **Motivo** (ex: "Pagamento fornecedor", "Retirada sócio")
3. **Confirmar** — Registra saída, não afeta conferência de vendas

#### Fechar Caixa
Ao final do dia:
1. Clique **Fechar Caixa**
2. **Valor Final (centavos)** — dinheiro físico contado no caixa
3. **Observação** (opcional)
4. **Confirmar** — Sistema calcula:
   - `Esperado = Inicial + Total Vendas - Total Sangrias`
   - `Diferença = Valor Final - Esperado`
   - **Diferença ≠ 0** → atenção: sobra ou falta

#### Histórico de Caixas
Botão **Histórico** lista todos os caixas (abertos/fechados) com filtro por data.

### 3.7 Aba: Comissões

**Gestão completa de comissões** geradas automaticamente em vendas e agendamentos concluídos.

#### Listagem (filtros)
- **Barbeiro** — Todos ou específico
- **Status** — A receber / Pago
- **Período** — Data início / Data fim

#### Resumo por Barbeiro
Botão **Resumo** mostra cards:
- **A receber** — Soma das comissões pendentes
- **Pago** — Soma já paga
- **Total** — Soma geral do período

#### Pagar Comissão
- **Individual:** 💰 na linha → observação (opcional) → **Pagar**
- **Em Lote:** Marca checkboxes → botão **Pagar Selecionadas** → observação única → **Confirmar**

#### Comissão por Serviço (Regra Específica)
Na aba **Serviços**, ao editar um serviço, há link **Comissão** que permite definir regra **específica para aquele serviço** (sobrescreve a comissão do barbeiro):
- **Tipo:** `percentual` (centésimos: `5000` = 50%) ou `fixo` (centavos: `1500` = R$ 15,00)
- **Remover regra** → volta a usar comissão padrão do barbeiro

### 3.8 Aba: Clientes

**Visão unificada de clientes** — busca por nome/telefone/e-mail. Mostra:
- Dados cadastrais
- **Histórico**: agendamentos concluídos + vendas walk-in + observações dos barbeiros
- Última visita

> **Privacidade:** Observações são **por barbeiro** — cada barbeiro vê só as suas.

---

## 4. Painel do Barbeiro

Acesse em `/barbeiro.html` após login como barbeiro. **5 abas**:

### 4.1 Aba: Agenda de Hoje

**Sua agenda do dia** (data padrão = hoje, alterável no campo Data).

**Filtro Status:** Todos / Pendentes / Confirmados / Cancelados / Concluídos

**Ações por agendamento:**
- ✅ **Confirmar** — Pendente → Confirmado
- ❌ **Cancelar** — Cancela (livre, sem regra de 2h)
- ✔️ **Concluir** — **Gera comissão** + move para histórico do cliente
- 👁️ **Detalhes** — Vê serviço, cliente, horário, observações

> **Dica:** Use "Concluir" ao terminar o atendimento. Isso fecha o ciclo financeiro.

### 4.2 Aba: Minha Jornada

**Visualização da sua jornada semanal** (somente leitura — admin que cadastra).

Mostra grade: Dia | Início | Fim | (múltiplos turnos por dia)

### 4.3 Aba: Meus Serviços

**Lista dos serviços que você atende** (definidos pelo admin).

Mostra: Nome | Preço | Duração | **Sua comissão** (padrão ou específica do serviço)

### 4.4 Aba: Comissões

**Suas comissões** — mesmos filtros da visão admin, mas só suas.

**Cards de Resumo:**
- **A receber** — Pendentes
- **Pagas** — Já quitadas
- **Total** — Soma do período filtrado

### 4.5 Aba: Clientes

**Busca de clientes** que você atendeu (agendamentos concluídos + vendas).

**Ao clicar num cliente:**
- **Histórico Unificado** — Linha do tempo:
  - ✂️ Agendamentos concluídos (data, serviço, valor, comissão)
  - 🛒 Vendas walk-in (data, itens, valor, comissão)
  - 📝 **Suas observações** — anotações privadas que você fez
- **Nova Observação** — Botão **➕ Anotação** → digita texto → **Salvar**
  - Fica salvo **só para você** (outros barbeiros não veem)
  - Útil: preferências de corte, alergias, conversas, etc.

---

## 5. Área do Cliente

Acesse em `/cliente.html` após login como cliente. **5 abas**:

### 5.1 Aba: Agendar

**Agendamento logado** (diferente do público: já sabe quem é você).

**Passos:**
1. **Data** — Escolhe o dia
2. **Serviço** — Seleciona (só ativos)
3. **Barbeiro** — Seleciona (só os que atendem aquele serviço e têm jornada no dia)
4. **Horário** — Chips de 15 em 15 min (calculado: jornada - agendamentos - bloqueios)
5. **Confirmar** → Cria agendamento **Pendente**

> **Dica:** Barbeiro recebe notificação (visual na agenda dele) e confirma.

### 5.2 Aba: Minha Agenda

**Dois painéis:**

**Próximos Agendamentos:**
- Cards com: serviço, barbeiro, data/hora, status
- **Cancelar** — Botão vermelho (só se > 2h antes do horário)
- Código de cancelamento mostrado (guarde se precisar cancelar por telefone)

**Histórico:**
- Agendamentos passados (confirmados, concluídos, cancelados)
- Mostra valor, comissão do barbeiro, observações (se houver)

### 5.3 Aba: Planos

**Assinaturas/Planos recorrentes** (se configurados pelo admin).

**Disponíveis:** Lista planos ativos → **Assinar** → escolhe forma de pagamento → confirma
**Minha Assinatura:** Plano ativo atual, próxima cobrança, status
**Faturas:** Histórico de cobranças do plano

> **Nota:** Integração com Mercado Pago para cartão/PIX/boleto.

### 5.4 Aba: Serviços

**Catálogo público** — todos os serviços ativos com nome, preço, duração.

### 5.5 Aba: Barbeiros

**Equipe** — barbeiros ativos com foto (se houver), serviços que atendem, jornada resumida.

---

## 6. Agendamento Público (sem login)

Acesse em `/agendar.html` — **não precisa de conta**.

**Fluxo em 5 passos:**

1. **Dados do Cliente** — Nome + Telefone (WhatsApp)
2. **Serviço** — Cards com foto/nome/preço/duração
3. **Barbeiro** — Cards com nome/serviços/avaliação
4. **Data e Horário** — Calendário + chips de horários livres
5. **Confirmação** — Resumo completo + **Código de Cancelamento**

**Código de Cancelamento:**
- Gerado ao final (ex: `NH-7K9M2P`)
- **Guarde!** Permite cancelar pelo telefone/WhatsApp informando o código
- Válido até 2h antes do horário

> **Ideal para:** Clientes novos, indicações, quem não quer criar conta.

---

## 7. Fluxos de Trabalho Comuns

### 7.1 Dia Típico do Admin

| Horário | Ação |
|---------|------|
| **Início do dia** | Abrir Caixa (valor inicial + observação) |
| **Durante o dia** | Fazer sangrias se necessário (pagamentos, retiradas) |
| **Agendamentos** | Monitorar aba Agenda → confirmar pendentes |
| **Walk-ins** | Barbeiros usam PDV (venda direta) |
| **Fim do dia** | Fechar Caixa (conferir diferença) |
| **Semanal** | Pagar comissões (lote ou individual) |
| **Estoque** | Ver alerta "Baixo Estoque" → fazer entradas |

### 7.2 Dia Típico do Barbeiro

| Horário | Ação |
|---------|------|
| **Início** | Abrir agenda → ver dia (filtro "Pendentes") |
| **Cliente chega** | Confirmar agendamento → atender |
| **Fim do atendimento** | **Concluir** agendamento (gera comissão) |
| **Walk-in** | Se cliente aparece sem agendar → avisa admin ou usa PDV (se tiver permissão) |
| **Durante/Após** | Adicionar observação no cliente (preferências, etc.) |
| **Fim do dia** | Ver comissões (aba Comissões) |

### 7.3 Venda Walk-in (PDV) — Passo a Passo

**Quem faz:** Barbeiro (ou admin)  
**Pré-requisito:** Caixa **aberto** no dia

1. Barbeiro acessa **PDV** (no admin.html aba Caixa → botão **Nova Venda** OU barbeiro.html se habilitado)
2. **Itens:** Adiciona serviços e/ou produtos (quantidade)
3. **Forma de Pagamento:**
   - `dinheiro` — Pede "Dinheiro Recebido" → calcula troco
   - `cartao` / `pix` / `misto` — Só registra
4. **Desconto (opcional)** — Valor em centavos
5. **Confirmar Venda**
   - Baixa estoque dos produtos
   - Gera comissão pro barbeiro (serviço: regra específica ou padrão; produto: comissão do produto)
   - Entra no caixa do dia
   - Aparece no histórico do cliente

### 7.4 Comissão por Serviço vs. Comissão do Barbeiro

| Cenário | Comissão Aplicada |
|---------|-------------------|
| Serviço **sem** regra específica | Comissão padrão do barbeiro |
| Serviço **com** regra `percentual` | `% do preço do serviço` (ex: 50% de R$ 50 = R$ 25) |
| Serviço **com** regra `fixo` | Valor fixo (ex: R$ 15,00 por corte) |
| Produto | Comissão definida no cadastro do produto |

> **Admin define:** Em Serviços → Editar → link **Comissão** → cria/remove regra específica.

### 7.5 Cancelamento de Agendamento

| Quem | Regra |
|------|-------|
| **Cliente** | Só se > 2h antes do horário (via Minha Agenda ou código público) |
| **Barbeiro** | Livre (qualquer momento) |
| **Admin** | Livre (qualquer momento) |
| **Sistema** | Auto-cancela se barbeiro desativado / serviço desativado |

---

## 8. Dúvidas Frequentes (FAQ)

### Geral

**P: Esqueci a senha do admin. E agora?**
R: Pare o servidor, apague `data/barbearia.db` (ou renomeie), rode novamente. Novo admin será criado com credenciais no terminal. **Ou** use variáveis `ADMIN_EMAIL`/`ADMIN_SENHA` no start.

**P: Posso rodar em produção sem HTTPS?**
R: **Não recomendado.** Cookies `Secure` exigem HTTPS. Use Cloudflare Tunnel (grátis) ou nginx/Caddy com Let's Encrypt.

**P: O banco de dados corrompeu. Como recupero?**
R: Use backup mais recente (`.backup` do SQLite). Se não tem backup: `sqlite3 data/barbearia.db ".recover" | sqlite3 recover.db` — tenta recuperar.

### Agendamentos

**P: Cliente não consegue cancelar — diz "fora do prazo".**
R: Regra é **2 horas antes**. Verifique fuso horário do servidor (`date` no terminal). Cliente pode cancelar via código público se ainda no prazo.

**P: Horários não aparecem pro cliente.**
R: Verifique: (1) Barbeiro tem jornada naquele dia? (2) Serviço está ativo? (3) Barbeiro atende aquele serviço? (4) Não há bloqueio admin? (5) Não há agendamento conflitante?

**P: Dois clientes agendaram mesmo horário.**
R: Impossível — banco tem `UNIQUE(barbeiro_id, data_hora)` + validação na API. Verifique se não são barbeiros diferentes.

### Financeiro / Caixa

**P: Fechamento de caixa dá diferença não-zero.**
R: Causas comuns: (1) Sangria não registrada, (2) Venda não passou pelo PDV (dinheiro direto no bolso), (3) Troco errado em venda `dinheiro`, (4) Valor inicial digitado errado. Confira item a item no detalhe do caixa.

**P: Comissão não apareceu pro barbeiro.**
R: Verifique: (1) Agendamento foi **Concluído** (não só Confirmado)? (2) Venda foi no PDV com caixa aberto? (3) Barbeiro está ativo? (4) Serviço/produto tem comissão configurada?

**P: Como faço estorno de venda?**
R: Não há estorno automático. Fluxo manual: (1) Admin cancela venda no banco (DELETE em venda_itens + vendas), (2) Devolve estoque manual (Entrada de Estoque), (3) Marca comissão como paga/cancelada, (4) Anota no caixa (sangria negativa ou observação no fechamento).

### Estoque / Produtos

**P: Produto sumiu da lista de vendas.**
R: Verifique se `ativo = true` e `estoque_atual > 0`. Produtos inativos ou sem estoque não aparecem no PDV.

**P: Alerta de estoque baixo não aparece.**
R: Botão **⚠️ Baixo Estoque** na aba Produtos lista só onde `estoque_atual <= estoque_minimo` E `ativo = true`.

### Barbeiros

**P: Barbeiro não consegue logar.**
R: Verifique: (1) `ativo = true` na tabela? (2) Senha correta? (3) Rate limit não travou (5 tentativas/15min)? Espere 15min ou limpe `rate_limit_login` no banco.

**P: Jornada não salva — "sobreposição".**
R: Não pode ter dois turnos no mesmo dia que se sobreponham (ex: 09:00–12:00 e 11:00–14:00). Ajuste horários.

---

## Apêndice: Códigos de Status

### Agendamentos
| Status | Significado |
|--------|-------------|
| `pendente` | Criado pelo cliente, aguardando confirmação |
| `confirmado` | Barbeiro/admin confirmou |
| `cancelado` | Cancelado (cliente/barbeiro/admin) |
| `concluido` | Atendimento finalizado → gerou comissão + histórico |

### Caixa
| Status | Significado |
|--------|-------------|
| `aberto` | Caixa do dia em andamento |
| `fechado` | Conferido e encerrado |

### Comissões
| Status | Significado |
|--------|-------------|
| `a_receber` | Gerada, aguardando pagamento |
| `pago` | Quitada pelo admin |

### Formas de Pagamento (PDV)
| Código | Descrição |
|--------|-----------|
| `dinheiro` | Espécie (pede valor recebido, calcula troco) |
| `cartao` | Débito/crédito (maquininha) |
| `pix` | PIX (chave/copia-e-cola) |
| `misto` | Combinação (ex: metade dinheiro, metade cartão) |

---

## Suporte e Contato

- **Documentação técnica:** `README.md` (API, deploy, estrutura)
- **Issues/Bugs:** Abra issue no repositório do projeto
- **Desenvolvimento:** Node.js 22.13+, zero dependências npm (exceto `pino` para logs)

---

**Fim do Manual** — Navalha Barbearia v1.0 (Fases 1–3)