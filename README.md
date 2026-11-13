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
| `NODE_ENV` | `development` | `production` ativa logs JSON e CSP estrita |
| `MP_ACCESS_TOKEN` | — | Token Mercado Pago (produção) |
| `MP_PUBLIC_KEY` | — | Public key Mercado Pago |
| `MP_WEBHOOK_SECRET` | — | Secret para validação de webhook |

---

## Favicon e PWA

O sistema inclui identidade visual completa:

- **favicon.svg** — Vetor principal (64×64, escudo dourado/preto com tesoura)
- **favicon-16.png**, **favicon-32.png** — Fallbacks PNG (gerados via `public/favicon-generator.html`)
- **apple-touch-icon.png** — 180×180 para iOS
- **site.webmanifest** — Manifesto PWA (theme-color `#D4A843`, name "Barbearia Andrade")

### Gerar PNGs do favicon
1. Abra `public/favicon-generator.html` no navegador
2. Clique em **Gerar PNGs**
3. Baixe o ZIP e extraia `favicon-16.png`, `favicon-32.png`, `apple-touch-icon.png` em `public/`

Todas as páginas HTML já referenciam esses arquivos.

---

## Deploy com Docker

### Build da imagem
```bash
docker build -t navalha-barbearia .
```

### docker-compose (recomendado)
```yaml
# docker-compose.yml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - COOKIE_SECURE=1
      - ADMIN_EMAIL=admin@seubarber.com
      - ADMIN_SENHA=senha-super-forte
      - MP_ACCESS_TOKEN=${MP_ACCESS_TOKEN}
      - MP_PUBLIC_KEY=${MP_PUBLIC_KEY}
      - MP_WEBHOOK_SECRET=${MP_WEBHOOK_SECRET}
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

```bash
docker-compose up -d
```

### HTTPS em produção (Cloudflare Tunnel)
```bash
# Instala cloudflared
# Configura tunnel.yml apontando para localhost:3000
cloudflared tunnel run --config tunnel.yml navalha
```
Isso expõe HTTPS válido para webhooks do Mercado Pago sem configurar certificados no servidor.

---

## Backup do SQLite

### Backup automático (cron)
```bash
# Backup diário às 03:00 (mantém 7 dias)
0 3 * * * sqlite3 /app/data/barbearia.db ".backup /backups/barbearia-$(date +\%F).db" && find /backups -name 'barbearia-*.db' -mtime +7 -delete
```

### Backup manual
```bash
# Com app rodando (WAL mode permite backup online)
sqlite3 data/barbearia.db ".backup backup-$(date +%F).db"

# Verificar integridade
sqlite3 backup-2026-01-15.db "PRAGMA integrity_check;"
```

### Restore
```bash
# App parado
cp backup-2026-01-15.db data/barbearia.db
# Remove -shm/-wal se existirem
rm -f data/barbearia.db-shm data/barbearia.db-wal
```

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

**46 testes** cobrendo:
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
src/logger.js        # Pino com pretty dev / JSON prod, redaction, request logging, slow query detection
src/pagamento.js     # Gateway abstração (Mercado Pago/Asaas/Stripe), dev mode stubs
public/              # Telas (HTML/CSS/JS puro, sem innerHTML)
  index.html         # Login / cadastro
  agendar.html       # Agendamento público (sem login)
  cliente.html       # Área do cliente (5 abas)
  barbeiro.html      # Área do barbeiro (5 abas)
  admin.html         # Admin: abas Serviços, Barbeiros, Agenda, Bloqueios, Produtos, Caixa, Comissões, Clientes
  js/app.js          # Auth, navegação, utilitários, Network Status Indicator, Offline-Aware API Client
  js/cliente.js      # Lógica UI cliente (agendar, minha agenda, planos, serviços, barbeiros)
  js/barbeiro.js     # Lógica UI barbeiro (agenda, jornada, serviços, comissões, clientes)
  js/admin.js        # Lógica UI admin (Fase 3: produtos, caixa, pdv, comissões)
  js/agendar.js      # Agendamento público passo-a-passo
  js/idb.js          # IndexedDB wrapper (fila mutações offline, background sync)
  js/install-prompt.js  # Prompt instalação PWA (banner, botão, iOS/Android)
  js/date-picker.js  # Seletor de data acessível
  css/app.css        # Design system (cores, tipografia, componentes)
  favicon.svg        # Favicon vetorial principal
  favicon-generator.html  # Gerador PNG via canvas + JSZip
  splash-generator.html # Gerador splash screens iOS/Android + ícones PWA
  site.webmanifest   # PWA manifest (shortcuts, share_target, file_handlers, protocol_handlers)
  sw.js              # Service Worker (Cache First, Network First, SWR, Background Sync, Push)
  offline.html       # Página fallback offline com contador mutações pendentes
  icons/icons.svg    # Sprite de ícones (tesoura, calendário, usuário, etc.)
test/api.test.js     # Testes de integração da API (46 testes)
data/                # SQLite database (gitignored)
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

### Produtos (Fase 3)
| Método | Rota | Quem | Descrição |
|--------|------|------|-----------|
| GET | `/api/produtos` | admin | Lista (filtro `?baixo=true` para estoque baixo) |
| GET | `/api/produtos/baixo-estoque` | admin | Produtos abaixo do mínimo |
| POST | `/api/produtos` | admin | Cria (SKU único, custo/preço em centavos, qtd mínima, comissão) |
| PUT | `/api/produtos/:id` | admin | Atualiza |
| POST | `/api/produtos/:id/entrada` | admin | Adiciona quantidade ao estoque |

### Comissão por Serviço (Fase 3)
| Método | Rota | Quem | Descrição |
|--------|------|------|-----------|
| GET | `/api/servicos/:id/comissao` | admin | Consulta regra específica |
| PUT | `/api/servicos/:id/comissao` | admin | Define (`tipo: percentual|fixo`, `valor` em centésimos de % ou centavos) |
| DELETE | `/api/servicos/:id/comissao` | admin | Remove (volta para comissão do barbeiro) |

### PDV / Vendas (Fase 3)
| Método | Rota | Quem | Descrição |
|--------|------|------|-----------|
| GET | `/api/vendas` | admin | Lista (filtros `?data=&barbeiro=&status=&caixa=`) |
| GET | `/api/vendas/:id` | admin/barbeiro | Detalhe com itens |
| POST | `/api/vendas` | barbeiro | Cria venda (requer caixa aberto) — itens: `tipo` (servico/produto), `referencia_id`, `quantidade`; `forma_pagamento`, `desconto_centavos`, `dinheiro_recebido` (p/ dinheiro); baixa estoque + gera comissão |

### Caixa (Fase 3)
| Método | Rota | Quem | Descrição |
|--------|------|------|-----------|
| GET | `/api/caixa/aberto` | admin | Caixa aberto do dia (ou null) |
| POST | `/api/caixa/abrir` | admin | Abre caixa (`valor_inicial_centavos`, `observacao`) |
| GET | `/api/caixa/:id` | admin | Detalhe com sangrias e vendas |
| POST | `/api/caixa/:id/sangria` | admin | Retirada (`valor_centavos`, `motivo`) |
| PUT | `/api/caixa/:id/fechar` | admin | Fecha (`valor_final_centavos`, `observacao`) — valida `inicial + vendas - sangrias = final` |
| GET | `/api/caixa/historico` | admin | Histórico de caixas (filtro `?data=`) |

### Comissões (Fase 3)
| Método | Rota | Quem | Descrição |
|--------|------|------|-----------|
| GET | `/api/comissoes` | admin | Lista (filtros `?barbeiro=&status=&data_inicio=&data_fim=`) |
| GET | `/api/comissoes/resumo` | admin | Resumo por barbeiro (a receber, pago, total) |
| PUT | `/api/comissoes/:id/pagar` | admin | Paga uma (`observacao`) |
| PUT | `/api/comissoes/lote/pagar` | admin | Paga várias (`ids[]`, `observacao`) |

### Observações & Histórico do Cliente (Fase 3)
| Método | Rota | Quem | Descrição |
|--------|------|------|-----------|
| GET | `/api/clientes/:id/observacoes` | barbeiro/admin | Lista anotações do barbeiro logado |
| POST | `/api/clientes/:id/observacoes` | barbeiro | Adiciona anotação |
| GET | `/api/clientes/:id/historico` | barbeiro | Unificado: agendamentos concluídos + vendas walk-in + observações |

### Agendamentos — Concluir (Fase 3)
| Método | Rota | Quem | Descrição |
|--------|------|------|-----------|
| PUT | `/api/agendamentos/:id/concluir` | barbeiro/admin | Marca concluído → gera comissão + entra no histórico |

---

## Segurança já implementada

- **Senhas**: scrypt + salt; só hash do token de sessão no banco
- **Sessão**: cookie `HttpOnly` + `SameSite=Lax`; expiração configurável
- **Escrita na API**: exige `Content-Type: application/json` (anti-CSRF)
- **SQL**: consultas 100% parametrizadas
- **Frontend**: DOM via `textContent` (sem `innerHTML` = sem XSS)
- **CSP**: restritiva (`default-src 'self'`), permite `connect-src` para Google Fonts e Mercado Pago, `font-src` `fonts.gstatic.com`, `img-src` `data:` e fontes
- **Path traversal**: bloqueado no servidor de estáticos
- **RBAC**: verificado no servidor em **toda** rota (UI apenas reflete)

---

## Checklist de produção

| Item | Status | Observação |
|------|--------|------------|
| HTTPS / TLS | ⚠️ Pendente | Use Cloudflare Tunnel ou reverse proxy (nginx/Caddy) |
| `COOKIE_SECURE=1` | ⚠️ Pendente | Obrigatório com HTTPS |
| Variáveis de produção | ⚠️ Pendente | `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, etc. |
| Backup automático | ⚠️ Pendente | Configure cron/jobs no host |
| Health check `/health` | ⚠️ Pendente | Implementar endpoint leve |
| Logs estruturados (JSON) | ✅ Pronto | `NODE_ENV=production` ativa |
| Rate limit login | ✅ Pronto | 5 tentativas / 15 min por IP+email |
| CSP + headers segurança | ✅ Pronto | `X-Frame-Options`, `X-Content-Type-Options`, etc. |
| Testes passando | ✅ Pronto | `npm test` — 46 testes |
| Dockerfile multi-stage | ✅ Pronto | Imagem ~60MB |

---

## Próximos passos sugeridos (Fase 4+)

- Notificações (e-mail/WhatsApp) para confirmação/lembrete
- Relatório financeiro avançado (faturamento por serviço/período, ticket médio)
- Recorrência de agendamentos (semanal/quinzenal)
- Multi-unidade (filiais)
- Dashboard admin com métricas (ocupação, no-show, ticket médio)
- Endpoint `/health` para orquestração (K8s, Docker Swarm)
- CI/CD (GitHub Actions: test + build + deploy)

---

## PWA (Implementado ✅)

O sistema é um **PWA completo instalável sem Play Store**:

| Funcionalidade | Arquivo | Descrição |
|----------------|---------|-----------|
| **Service Worker** | `public/sw.js` | Cache First (estáticos), Network First (HTML), Stale-While-Revalidate (APIs barbeiro), Background Sync (mutações), Push skeleton |
| **Suporte Offline** | `public/offline.html`, `public/js/idb.js` | Fallback offline, fila mutações IndexedDB, sync automático ao voltar online |
| **Prompt Instalação** | `public/js/install-prompt.js` | Banner customizado, botão flutuante, instruções iOS/Android, detecção `beforeinstallprompt` |
| **Splash Screens** | `public/splash-generator.html` | Gera splash screens iOS (10 tamanhos), Android (8 tamanhos), ícones PWA (72-512px maskable) |
| **Manifest** | `public/site.webmanifest` | `display_override`, shortcuts (4), `share_target`, `file_handlers`, `protocol_handlers`, categories |
| **Indicador Rede** | `public/js/app.js` | Badge fixo inferior dir. (verde/vermelho), contador mutações pendentes |
| **API Offline-Aware** | `public/js/app.js` | GET usa rede (SW cacheia), POST/PUT/DELETE enfileiram offline, toast "enfileirado" |

### Gerar ícones PWA (necessário para instalação)

1. Abra `public/splash-generator.html` no navegador
2. Abas **PWA Icons** → clique **Gerar ícones PWA** → baixe ZIP → extraia `icon-*.png` em `public/`
3. Aba **iOS Splash** → gere splash screens para iPhone/iPad
4. Aba **Android Splash** → gere splash screens Android

Após gerar, o app passa no **Lighthouse PWA audit** e pode ser instalado via "Adicionar à tela inicial" (Android/Chrome) ou "Compartilhar → Adicionar à Tela de Início" (iOS/Safari).

---

## Licença

MIT — uso livre, inclusive comercial.