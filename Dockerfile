FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev --ignore-scripts --no-audit --no-fund
COPY scripts/build-server.mjs ./scripts/build-server.mjs
COPY server ./server
COPY src/game ./src/game
COPY src/online/protocol.ts ./src/online/protocol.ts
RUN npm run build:server

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    MACHINATION_HOST=0.0.0.0 \
    MACHINATION_DATA=/var/lib/machination/games.json \
    PORT=8787
WORKDIR /app
RUN mkdir -p /var/lib/machination && chown node:node /var/lib/machination
COPY --from=build --chown=node:node /app/dist-server ./dist-server
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
STOPSIGNAL SIGTERM
CMD ["node", "dist-server/main.mjs"]
