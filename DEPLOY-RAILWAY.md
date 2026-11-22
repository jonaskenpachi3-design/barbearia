# Deploy no Railway - Guia para Cliente Não-Técnico

Este guia explica passo a passo como colocar o sistema da barbearia no ar usando o Railway. Não precisa saber programação - apenas seguir os passos abaixo.

---

## ✅ Pré-requisitos

1. **Conta no GitHub** (gratuita) - [github.com](https://github.com)
2. **Conta no Railway** (gratuita para começar) - [railway.app](https://railway.app)
3. **Conta no Mercado Pago** (para pagamentos) - [mercadopago.com.br](https://mercadopago.com.br)

---

## 📋 Passo a Passo

### 1. Subir o código para o GitHub

**Opção A: Pelo site do GitHub (mais fácil)**
1. Acesse [github.com/new](https://github.com/new)
2. Nome do repositório: `barbearia` (ou outro nome que preferir)
3. Deixe como **Public** (ou Private se preferir)
4. **NÃO** marque "Add a README file" (já existe)
5. Clique em **Create repository**
6. Na página que abrir, clique em **"uploading an existing file"**
7. Arraste **todos os arquivos da pasta do projeto** (exceto a pasta `node_modules` e arquivo `.env`)
8. Clique em **Commit changes**

**Opção B: Pelo terminal (se souber usar)**
```bash
cd pasta-do-projeto
git init
git add .
git commit -m "Primeiro commit"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/barbearia.git
git push -u origin main
```

---

### 2. Criar projeto no Railway

1. Acesse [railway.app](https://railway.app) e faça login com GitHub
2. Clique em **"New Project"**
3. Selecione **"Deploy from GitHub repo"**
4. Escolha o repositório `barbearia` que você criou
5. Clique em **Deploy Now**

O Railway vai detectar o `Dockerfile` e começar a build automaticamente.

---

### 3. Configurar variáveis de ambiente (MUITO IMPORTANTE)

No painel do Railway, clique no seu projeto → aba **Variables** → **New Variable**. Adicione **todas** abaixo:

| Variável | Valor | Onde conseguir |
|----------|-------|----------------|
| `SESSION_SECRET` | Uma string aleatória longa (ex: `openssl rand -hex 32` no terminal) | Gere uma chave segura |
| `NODE_ENV` | `production` | Fixe este valor |
| `PORT` | `3000` | Fixe este valor |
| `DB_FILE` | `/data/barbearia.db` | Fixe este valor |
| `ADMIN_EMAIL` | Email do admin (ex: `admin@barbearia.com`) | Defina você |
| `ADMIN_SENHA` | Senha forte do admin | Defina você |
| `MP_CLIENT_ID` | Seu Client ID do Mercado Pago | Painel Mercado Pago > Credenciais |
| `MP_CLIENT_SECRET` | Seu Client Secret do Mercado Pago | Painel Mercado Pago > Credenciais |
| `MP_ACCESS_TOKEN` | Access Token de produção | Painel Mercado Pago > Credenciais |
| `MP_WEBHOOK_SECRET` | Secret do webhook (gere um aleatório) | Defina você, anote para o passo 5 |

**Como gerar SESSION_SECRET e MP_WEBHOOK_SECRET:**
- No terminal: `openssl rand -hex 32`
- Ou use um gerador online de UUID/hex

⚠️ **NUNCA** compartilhe essas variáveis. Elas dão acesso total ao sistema.

---

### 4. Adicionar volume persistente (para o banco de dados)

1. No painel do Railway, clique no seu serviço
2. Aba **Volumes** → **New Volume**
3. Name: `data`
4. Mount Path: `/data`
5. Clique em **Create**

Isso garante que o banco de dados não apague quando o container reiniciar.

---

### 5. Configurar webhook do Mercado Pago

1. No painel do Railway, vá em **Settings** → **Domains**
2. Copie a URL pública (ex: `https://barbearia-production.up.railway.app`)
3. No painel do **Mercado Pago** > **Configurações** > **Webhooks**
4. Adicione novo webhook:
   - URL: `https://SUA-URL.up.railway.app/api/webhook/mercadopago`
   - Eventos: `payment`, `subscription_preapproval`, `subscription_preapproval_plan`
   - Secret: **o mesmo valor de `MP_WEBHOOK_SECRET` que você definiu no passo 3**

---

### 6. (Opcional) Domínio personalizado

1. No Railway: **Settings** → **Domains** → **Custom Domain**
2. Digite seu domínio (ex: `barbearia.seudominio.com`)
3. Configure o DNS no seu provedor (Cloudflare, Registro.br, etc):
   - Tipo: `CNAME`
   - Nome: `@` ou `www`
   - Valor: `SUA-URL.up.railway.app` (sem https://)

---

## ✅ Verificação final

Acesse: `https://SUA-URL.up.railway.app/health`

Deve retornar: `{"status":"ok","timestamp":"..."}`

Depois acesse a URL principal e faça login com o `ADMIN_EMAIL` e `ADMIN_SENHA` que você definiu.

---

## 🆘 Problemas comuns

| Problema | Solução |
|----------|---------|
| Build falha | Verifique se todos os arquivos subiram no GitHub (exceto node_modules) |
| Erro 500 no login | Confira se `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_SENHA` estão certos |
| Pagamento não funciona | Confira credenciais Mercado Pago e webhook URL |
| Banco apaga ao reiniciar | Verifique se o Volume foi criado no passo 4 |

---

## 📞 Suporte

Se travar em algum passo, me avise qual erro aparece que eu ajudo a resolver.

---

**Arquivos importantes no projeto:**
- `railway.json` - Configuração do Railway (healthcheck, restart policy)
- `Dockerfile` - Imagem Docker otimizada
- `.dockerignore` - Exclui node_modules, .env, banco local do build
- `.env.example` - Modelo de variáveis necessárias