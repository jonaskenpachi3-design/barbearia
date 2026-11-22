# Dockerfile
FROM node:22-alpine
WORKDIR /app

# Copia package.json e instala dependências de produção
COPY package*.json ./
RUN npm ci --omit=dev

# Copia todo o projeto
COPY . .

# Cria pastas necessárias
RUN mkdir -p data public/icons

EXPOSE 3000

# Variáveis de ambiente (sobrescreva no docker-compose)
ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "server.js"]