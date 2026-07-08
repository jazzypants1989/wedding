# Pinned by digest for reproducible rebuilds (multi-arch index for node:22-alpine,
# resolved 2026-07-02). Bump the tag+digest together to update.
FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2

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
