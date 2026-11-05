# Navalha — Sistema de Barbearia

**Entregável: Fase 1 — Base (Concluída)**  
**Data:** Novembro de 2026  
**Versão:** 0.1.0

---

## 1. Resumo Executivo

O **Navalha** é um sistema completo de gestão para barbearias, desenvolvido em fases. Esta entrega corresponde à **Fase 1**, que estabelece toda a fundação técnica e os cadastros mestres necessários para o funcionamento do negócio.

**O que está pronto e funcionando:**

- ✅ Login por papel (Cliente, Barbeiro, Administrador)
- ✅ Cadastro e gestão de Serviços
- ✅ Cadastro e gestão de Barbeiros (com comissão e serviços que atendem)
- ✅ Jornada de trabalho semanal por barbeiro (múltiplos turnos por dia)
- ✅ Interface web responsiva (4 telas dedicadas por papel)
- ✅ Testes automatizados (9 testes passando)
- ✅ Segurança de nível produção (hash scrypt, CSP, cookies HttpOnly, SQL parametrizado)

---

## 2. Funcionalidades por Papel

### 👤 Cliente
| Ação | Descrição |
|------|-----------|
| Criar conta | Nome, e-mail, telefone, senha |
| Entrar / Sair | Login seguro com bloqueio após 5 tentativas |
| Ver serviços | Lista de serviços ativos com duração e preço |
| Ver barbeiros | Lista de barbeiros ativos, quais serviços fazem e horários de trabalho |

### ✂️ Barbeiro
| Ação | Descrição |
|------|-----------|
| Entrar / Sair | Credenciais criadas pelo administrador |
| Ver própria jornada | Dias da semana, turnos (início/fim), serviços que atende |
| Ver comissão | Percentual configurado pelo admin |
| **Não acessa** | Painel admin, cadastro de serviços, outros barbeiros |

### 🛠️ Administrador
| Ação | Descrição |
|------|-----------|
| **Serviços** | Criar, editar, ativar/desativar (nome, descrição, duração, preço) |
| **Barbeiros** | Cadastrar (login, comissão %, serviços que atende), editar, desativar |
| **Jornada** | Definir horários semanais por barbeiro (múltiplos turnos/dia, sem sobreposição) |
| **Visão total** | Vê todos os serviços (ativos/inativos), todos os barbeiros com dados completos |

> **Regra de negócio:** Serviços e barbeiros **nunca são apagados**, apenas desativados. Isso garante integridade dos agendamentos futuros (Fase 2).

---

## 3. Tecnologia e Arquitetura

### Stack Zero-Dependência
| Camada | Tecnologia |
|--------|------------|
| Runtime | Node.js 22.13+ (LTS) |
| Servidor HTTP | `node:http` nativo (sem Express/Fastify) |
| Banco de Dados | SQLite embutido (`node:sqlite`) — arquivo único, WAL mode |
| Criptografia | `node:crypto` — scrypt com salt para senhas |
| Frontend | HTML5, CSS3 (Grid/Flexbox, variáveis CSS), JS ES Modules puro |
| Testes | `node:test` nativo (9 testes, cobertura de regras de negócio) |

### Por que essa escolha?
- **Zero dependências externas** = zero vulnerabilidades de supply chain, zero `npm install` quebrado, deploy trivial (copia a pasta e roda)
- **SQLite** = ideal para barbearia única (baixa concorrência, backup = copiar arquivo, performance excelente)
- **Scrypt** = padrão moderno para hash de senha, resistente a GPU/ASIC
- **CSP restritiva** = mitiga XSS mesmo se houver falha no código

---

## 4. Segurança Implementada

| Medida | Implementação |
|--------|---------------|
| **Senhas** | scrypt (N=16384, r=8, p=1), salt único por usuário |
| **Sessão** | Token aleatório (256 bits), hash no banco, cookie `HttpOnly` + `SameSite=Lax` + `Secure` (opcional) |
| **Brute-force** | Bloqueio 15 min após 5 tentativas erradas (por IP + e-mail) |
| **SQL Injection** | 100% queries parametrizadas (`db.prepare().run(?)`) |
| **XSS** | Templates com `textContent` (nunca `innerHTML`), CSP restritiva |
| **Path Traversal** | Validação de caminho absoluto vs pasta pública |
| **Permissões** | Checagem no **servidor** em toda rota (não apenas UI) |

---

## 5. API REST (Resumo)

| Método | Rota | Papel | Descrição |
|--------|------|-------|-----------|
| `POST` | `/api/auth/cadastro` | Público | Cria cliente + login automático |
| `POST` | `/api/auth/login` | Público | Login (bloqueio 5 tentativas) |
| `POST` | `/api/auth/logout` | Logado | Encerra sessão |
| `GET` | `/api/auth/me` | Logado | Dados do usuário atual |
| `GET` | `/api/servicos` | Público | Serviços ativos (admin vê todos) |
| `POST/PUT` | `/api/servicos` | Admin | Criar/editar serviço |
| `GET` | `/api/barbeiros` | Público | Barbeiros ativos + serviços + horários (sem dados sensíveis) |
| `POST/PUT` | `/api/barbeiros` | Admin | Criar/editar barbeiro |
| `PUT` | `/api/barbeiros/:id/horarios` | Admin | Substituir jornada completa |
| `GET` | `/api/meu-barbeiro` | Barbeiro | Próprio cadastro e jornada |

> **Preços** armazenados em **centavos (inteiro)** — evita erros de ponto flutuante.

---

## 6. Como Rodar (Produção)

```bash
# 1. Requisito: Node 22.13+
node -v

# 2. Variáveis de ambiente (opcionais, mas recomendadas)
export ADMIN_EMAIL="admin@suabarbearia.com"
export ADMIN_SENHA="SenhaForte123!"
export PORT=3000
export DB_FILE="./data/barbearia.db"
export COOKIE_SECURE=1    # obrigatório se usar HTTPS

# 3. Iniciar
node server.js
```

**Primeira execução sem `ADMIN_SENHA`:** o sistema gera uma senha aleatória segura e mostra **uma única vez** no console. Anote-a.

**Acesso:** `http://localhost:3000` (ou seu domínio com proxy reverso nginx/Caddy + HTTPS)

---

## 7. Estrutura do Projeto

```
barbearia/
├── server.js              # Servidor HTTP, arquivos estáticos, headers de segurança
├── package.json           # Metadados, scripts (start, test)
├── README.md              # Documentação técnica
├── ROADMAP.md             # Planejamento completo (6 fases)
├── data/
│   └── barbearia.db       # Banco SQLite (criado automaticamente)
├── src/
│   ├── db.js              # Schema, conexão, bootstrap admin
│   ├── senha.js           # Hash/verificação scrypt
│   ├── auth.js            # Sessões, cookies, rate-limit, permissões
│   ├── http.js            # Mini-router, utilitários JSON/cookies
│   ├── validar.js         # Validação de entrada (e-mail, horários, etc.)
│   └── routes.js          # Rotas da API + regras de negócio
├── public/
│   ├── index.html         # Login / seleção de papel
│   ├── cliente.html       # Tela do cliente
│   ├── barbeiro.html      # Tela do barbeiro
│   ├── admin.html         # Painel administrativo
│   ├── css/app.css        # Estilos compartilhados (design system leve)
│   └── js/                # Um arquivo JS por tela (ES Modules)
└── test/
    └── api.test.js        # 9 testes automatizados
```

---

## 8. Testes Automatizados

```bash
npm test
```

**Cobertura (9 testes):**
- Cadastro de cliente (e-mail normalizado, validações)
- Login/logout, bloqueio por força bruta (429 após 5 tentativas)
- Exigência de `Content-Type: application/json` em escritas
- Serviços: permissões (público/admin), validações, ativo/inativo
- Barbeiros: cadastro, jornada (turnos, sobreposição, formato), visão pública sem vazamento, desativação derruba sessão
- Rotas inexistentes e métodos errados (404/405)
- Arquivos estáticos + proteção contra path traversal

---

## 9. Roadmap — Próximas Fases

| Fase | Tema | Status | Entregável Principal |
|------|------|--------|---------------------|
| **1** | Base | ✅ **Concluída** | Login, serviços, barbeiros, jornadas |
| **2** | **Agendamentos** | 🔄 Próxima | Horários livres, agendar, cancelar, agendas |
| **3** | Operação & Financeiro | 📦 Planejada | PDV, comissão, estoque, caixa, histórico |
| **4** | Experiência do Cliente | 🔔 Planejada | WhatsApp/e-mail, fila espera, fidelidade, avaliações |
| **5** | Gestão & Escala | 📊 Planejada | Multi-unidade, relatórios gerenciais, integrações |
| **6** | Engenharia & Qualidade | 🛠️ Planejada | E2E, CI/CD, observabilidade, backup, LGPD |

### Fase 2 — Agendamentos (Início Imediato)
1. Modelo de dados: `agendamentos`, `bloqueios`
2. Cálculo de slots livres (jornada − agendamentos − bloqueios)
3. `GET /api/horarios-livres?barbeiro=&data=&servico=`
4. `POST /api/agendamentos` (cliente), `PUT /confirmar` (barbeiro/admin), `PUT /cancelar`
5. Telas: "Agendar" (cliente), "Minha Agenda" (cliente/barbeiro/admin)
6. Testes + validação ponta-a-ponta

---

## 10. Investimento e Entrega

### O que você recebe agora (Fase 1)
- ✅ Código-fonte completo (propriedade do cliente)
- ✅ Documentação técnica (`README.md`, `ROADMAP.md`)
- ✅ Banco de dados SQLite portável (arquivo único)
- ✅ Suite de testes automatizados
- ✅ Instruções de deploy produção

### Estimativa Fase 2 (Agendamentos)
| Item | Esforço Estimado |
|------|------------------|
| Backend (modelo, cálculo slots, rotas) | ~16h |
| Frontend (3 telas + integração) | ~12h |
| Testes + ajustes | ~4h |
| **Total** | **~32h** |

> **Nota:** A base da Fase 1 (jornada, duração dos serviços, permissões) já está pronta para suportar a Fase 2 sem retrabalho.

---

## 11. Suporte e Manutenção

| Item | Detalhes |
|------|----------|
| **Código** | 100% seu — sem licenças, assinaturas ou vendor lock-in |
| **Banco** | SQLite — backup = copiar `data/barbearia.db` |
| **Deploy** | VPS Linux barato ($5-10/mês), Docker opcional, systemd/service nativo |
| **Atualizações** | Pull do repositório + `node server.js` (migrações automáticas no `db.js`) |
| **Monitoramento** | Logs no console (pode integrar Loki/Prometheus depois) |

---

## 12. Próximos Passos Sugeridos

1. **Validar em homologação** — rode `node server.js`, teste os 3 papéis
2. **Definir dados iniciais** — serviços reais, barbeiros reais, comissões acordadas
3. **Agendar kickoff Fase 2** — alinhar regras de agendamento (antecedência mínima, cancelamento, bloqueios)
4. **Escolher hospedagem** — VPS, Railway, Coolify, ou servidor próprio
5. **Configurar HTTPS** — Caddy ou nginx + Let's Encrypt (ativa `COOKIE_SECURE=1`)

---

## 13. Contato

**Desenvolvedor:** Jonas Sousa  
**Projeto:** Navalha — Sistema de Barbearia  
**Repositório:** [caminho local ou Git]  
**Data da entrega:** Novembro 2026

---

> **Este documento acompanha o código-fonte.** Para dúvidas técnicas, consulte `README.md` (técnico) e `ROADMAP.md` (planejamento estratégico).