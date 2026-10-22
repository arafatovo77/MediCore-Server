FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public
COPY database ./database

EXPOSE 3000

CMD ["sh", "-c", "node server/initdb.js && node server/index.js"]
