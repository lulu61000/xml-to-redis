FROM node:20-alpine

WORKDIR /app

# Install dependencies first so this layer is cached between code changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

ENTRYPOINT ["node", "src/cli.js"]
