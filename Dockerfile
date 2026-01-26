FROM node:22-alpine

WORKDIR /app

COPY package.json server.js types.js ./
COPY core/ core/
COPY db/ db/
COPY api/ api/
COPY services/ services/
COPY public/ public/
COPY scripts/ scripts/

RUN mkdir -p /app/data/audit && \
    addgroup -g 1001 -S wedding && \
    adduser -u 1001 -S wedding -G wedding && \
    chown -R wedding:wedding /app

USER wedding
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
