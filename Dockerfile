# One image, two processes: `docker build --target api .` or `--target worker .`
FROM oven/bun:1.4 AS base
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
RUN bun install --frozen-lockfile --production --filter '@pullpanda/api' --filter '@pullpanda/worker' --filter '@pullpanda/core' --filter '@pullpanda/db'
COPY tsconfig.base.json ./
COPY packages packages
ENV NODE_ENV=production

FROM base AS api
COPY apps/api apps/api
EXPOSE 3001
# migrations run once on boot; drizzle's migrator is idempotent
CMD ["sh", "-c", "bun packages/db/src/migrate.ts && bun apps/api/src/index.ts"]

FROM base AS worker
COPY apps/worker apps/worker
CMD ["bun", "apps/worker/src/index.ts"]
