# Dockerfile
FROM node:22-alpine
WORKDIR /app

# Copia só package.json se existisse (zero deps = não precisa npm install)
# COPY package*.json ./
# RUN npm ci --only=production

# Copia todo o projeto
COPY . .

# Cria pastas necessárias
RUN mkdir -p data public/icons

EXPOSE 3000

# Variáveis de ambiente (sobrescreva no docker-compose)
ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "server.js"]