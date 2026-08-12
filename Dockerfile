FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    PINT_DATA=/data

WORKDIR /app

# Nothing to install — pint has no dependencies. package.json is here for
# metadata and `npm start`.
COPY package.json ./
COPY server.js pinterest.js store.js ./
COPY public ./public

# Shelves live here. Owned by node so a fresh named volume inherits that.
RUN mkdir -p /data && chown node:node /data
VOLUME /data

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO /dev/null "http://127.0.0.1:${PORT}/" || exit 1

CMD ["node", "server.js"]
