FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# Nothing to install — pint has no dependencies. package.json is here for
# metadata and `npm start`.
COPY package.json ./
COPY server.js pinterest.js ./
COPY public ./public

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO /dev/null "http://127.0.0.1:${PORT}/" || exit 1

CMD ["node", "server.js"]
