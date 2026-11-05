# Navalha — Sistema de Barbearia (Fase 1 + 2 + 3 completa)

Sistema completo de gestão para barbearia: **autenticação por papel**, **serviços**, **barbeiros**, **jornada**, **agendamentos**, **bloqueios**, **produtos/estoque**, **PDV/vendas**, **caixa**, **comissões** e **histórico do cliente**.

Zero dependências externas — apenas APIs nativas do Node (HTTP, SQLite, crypto, test).

---

## Como rodar

**Requisito:** Node 22.13+ (`node -v`)

```bash
# Instala (não há dependências npm, mas garante package-lock)
npm install

# Desenvolvimento
node server.js
# ou com variáveis personalizadas:
ADMIN_EMAIL=voce@email.com ADMIN_SENHA='senha-forte' PORT=3000 node server.js
```

Abra **http://localhost:3000**.

### Primeira execução
Se não houver administrador no banco, o sistema cria um e mostra **e-mail e senha no terminal** (aparece uma única vez). Para definir você mesmo, use as variáveis `ADMIN_EMAIL` e `ADMIN_SENHA` acima.

### Variáveis de ambiente
| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `PORT` | `3000` | Porta do servidor |
| `DB_FILE` | `data/barbearia.db` | Caminho do SQLite (use `:memory:` para testes) |
| `ADMIN_EMAIL` | — | E-mail do admin inicial (opcional) |
| `ADMIN_SENHA` | — | Senha do admin inicial (opcional) |
| `COOKIE_SECURE` | `0` | Use `1` somente em produção com HTTPS |

---

## Funcionalidades

### Fase 1 — Base
| Papel | Permissões |
|-------|------------|
| **Cliente** | Cadastro, login, logout, ver serviços e barbeiros ativos |
| **Barbeiro** | Login, ver própria jornada, serviços e comissão |
| **Administrador** | Tudo acima + CRUD de serviços/barbeiros, definir jornada (múltiplos turnos/dia), comissão, desativar (derruba sessão e bloqueia login) |

- Soft delete: serviços e barbeiros só desativam (`ativo: false`), mantendo integridade histórica
- Preços em **centavos** (inteiros) — sem erro de arredondamento
- Jornada: `dia_semana` 0–6 (dom–sáb), horários `HH:MM`, sem sobreposição no mesmo dia

### Fase 2 — Agendamentos
- **Horários livres**: cálculo automático (jornada − agendamentos − bloqueios) com granularidade de 15 min
- **Cliente**: agenda, vê "Minha Agenda" (próximos/histórico), cancela até 2h antes
- **Barbeiro**: vê agenda do dia, confirma/cancela/conclui seus agendamentos
- **Admin**: visão geral com filtros (data, barbeiro, status), CRUD de bloqueios (por barbeiro ou global/feriado)
- **Regras**: impede conflito de horário, fora da jornada, serviço que barbeiro não atende, bloqueios admin

### Fase 3 — Operação & Financeiro
- **Produtos & Estoque**: CRUD completo (SKU, custo, preço, qtd mínima), entrada de estoque, alerta de estoque baixo
- **Comissão por serviço**: regra específica (percentual ou fixo) que sobrescreve a comissão padrão do barbeiro
- **PDV / Vendas Walk-in**: venda de serviço e/ou produto, múltiplas formas de pagamento (dinheiro, cartão, PIX, misto), desconto, troco automático, **baixa de estoque** e **cálculo de comissão** automático
- **Caixa**: abertura/fechamento diário com valor inicial, sangrias (retiradas), conferência automática (inicial + vendas − sangrias = esperado), diferença reportada no fechamento
- **Comissões**: geração automática na venda, listagem com filtros (barbeiro, status, período), resumo por barbeiro (a receber/pago/total), pagamento individual e em lote
- **Observações do cliente**: barbeiro adiciona anotações privadas por cliente
- **Histórico do cliente**: visão unificada (agendamentos concluídos + vendas walk-in + observações) acessível pelo barbeiro
- **Concluir agendamento**: barbeiro/admin marcam como concluído → gera comissão + aparece no histórico

---

## Testes

```bash
npm test
```

**35 testes** cobrendo:
- Auth: cadastro, login, logout, rate limit (5 tentativas = 429), sessão, permissões
- Serviços: CRUD admin, validações, visão pública só ativos
- Barbeiros: cadastro, jornada, validações (sobreposição, formato, dia inválido), desativação
- Agendamentos: criar, conflito, jornada, serviço inválido, confirmar (barbeiro/admin), cancelar (cliente 2h / barbeiro/admin livre), minha-agenda, agenda-barbeiro, agenda-admin
- Bloqueios: criar/remover (admin), bloqueio por barbeiro, bloqueio global
- **Produtos**: CRUD, entrada de estoque, alerta estoque baixo
- **Comissão por serviço**: definir/remover regra específica
- **PDV**: venda serviço/produto/misto, desconto, formas pagamento, baixa estoque, comissão
- **Caixa**: abrir, sangria, fechar, conferência, histórico
- **Comissões**: listagem, resumo, pagamento individual/lote
- **Observações/Histórico cliente**: adicionar, listar, histórico unificado
- **Concluir agendamento**: barbeiro/admin
- Arquivos estáticos: CSP, proteção path traversal

---

## Estrutura

```
server.js            # Servidor HTTP, estáticos, headers de segurança
src/db.js            # SQLite, tabelas (incl. Fase 3: produtos, vendas, caixa, comissões, observações), admin inicial
src/senha.js         # Hash scrypt
src/auth.js          # Sessões, cookie HttpOnly, rate limit, RBAC
src/http.js          # Mini-router nativo
src/validar.js       # Validação de entrada (email, data ISO, inteiros, Fase 3: produto, venda, caixa, comissão, observação)
src/routes.js        # Rotas da API (auth, serviços, barbeiros, agendamentos, bloqueios, Fase 3: produtos, comissão/serviço, vendas, caixa, comissões, observações/histórico)
public/              # Telas (HTML/CSS/JS puro, sem innerHTML)
  admin.html         # Admin: abas Serviços, Barbeiros, Agenda, Bloqueios, Produtos, Caixa, Comissões, Clientes
  barbeiro.html      # Barbeiro: abas Agenda, Jornada, Serviços, Comissões, Clientes
  js/admin.js        # Lógica UI admin (Fase 3: produtos, caixa, pdv, comissões)
  js/barbeiro.js     # Lógica UI barbeiro (Fase 3: comissões, histórico clientes)
test/api.test.js     # Testes de integração da API (35 testes)
```

---

## API — Resumo

### Autenticação
| Método | Rota | Quem | Descrição |
|--------|------|------|-----------|
| POST | `/api/auth/cadastro` | público | Cria cliente + login |
| POST | `/api/auth/login` | público | Login (rate limit 5/IP+email) |
| POST | `/api/auth/logout` | logado | Encerra sessão |
| GET | `/api/auth/me` | logado | Usuário atual |

### Serviços
| Método | Rota | Quem | Descrição |
|--------|------|------|-----------|
| GET | `/api/servicos` | público | Lista ativos (admin vê todos) |
| POST | `/api/servicos` | admin | Cria |
| PUT | `/api/servicos/:id` | admin | Atualiza (inclui `ativo: false`) |

### Barbeiros
| Método | Rota | Quem | Descrição |
|--------|------|------|-----------|
| GET | `/api/barbeiros` | público | Ativos com serviços/horários (sem dados sensíveis) |
| POST | `/api/barbeiros` | admin | Cadastra (login, comissão, serviços) |
| PUT | `/api/barbeiros/:id` | admin | Edita + desativa |
| PUT | `/api/barbeiros/:id/horarios` | admin | Substitui jornada completa |
| GET | `/api/meu-barbeiro` | barbeiro | Próprio cadastro + jornada |

### Agendamentos (Fase 2)
| Método | Rota | Quem | Descrição |
|--------|------|------|-----------|
| GET | `/api/horarios-livres` | público | Slots livres `?barbeiro=&data=&servico=` |
| POST | `/api/agendamentos` | cliente | Cria pendente |
| PUT | `/api/agendamentos/:id/confirmar` | barbeiro/admin | Confirma |
| PUT | `/api/agendamentos/:id/cancelar` | cliente/barbeiro/admin | Cancela (regras de tempo/papel) |
| GET | `/api/minha-agenda` | cliente | Próximos + histórico |
| GET | `/api/agenda-barbeiro` | barbeiro | Agenda do dia com filtro `?data=&status=` |
| GET | `/api/agenda-admin` | admin | Visão geral `?data=&barbeiro=&status=` |

### Bloqueios (Fase 2)
| Método | Rota | Quem | Descrição |
|--------|------|------|-----------|
| GET | `/api/bloqueios` | admin | Lista (filtros `?barbeiro=&data=`) |
| POST | `/api/bloqueios` | admin | Cria (sem `barbeiro_id` = global) |
| DELETE | `/api/bloqueios/:id` | admin | Remove (libera horários) |

---

## Segurança já implementada

- **Senhas**: scrypt + salt; só hash do token de sessão no banco
- **Sessão**: cookie `HttpOnly` + `SameSite=La`; expiração configurável
- **Escrita na API**: exige `Content-Type: application/json` (anti-CSRF)
- **SQL**: consultas 100% parametrizadas
- **Frontend**: DOM via `textContent` (sem `innerHTML` = sem XSS)
- **CSP**: restritiva (`default-src 'self'`, scripts/styles inline permitidos só via nonce/hash)
- **Path traversal**: bloqueado no servidor de estáticos
- **RBAC**: verificado no servidor em **toda** rota (UI apenas reflete)

---

## Próximos passos sugeridos (Fase 3+)

- Notificações (e-mail/WhatsApp) para confirmação/lembrete
- Relatório financeiro (comissão por barbeiro, faturamento por serviço/período)
- Recorrência de agendamentos (semanal/quinzenal)
- Multi-unidade (filiais)
- PWA (offline-first para barbeiros)
- Dashboard admin com métricas (ocupação, no-show, ticket médio)
EOF