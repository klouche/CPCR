FROM node:22-alpine

WORKDIR /app

# Install deps first (better layer caching)
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Prisma client generation (your project uses ./generated/prisma)
RUN npx prisma generate

EXPOSE 3000

CMD ["node", "server.js"]