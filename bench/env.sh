# Environment for the benchmark API and worker: a separate database and Redis db, never the dev data.
export NODE_ENV=production
export SESSION_SECRET=bench-only-session-secret-0123456789abcdef
export PORT=3101
export DATABASE_URL=postgres://pullpanda:pullpanda@localhost:5432/pullpanda_bench
export REDIS_URL=redis://localhost:6379/2
export GITHUB_WEBHOOK_SECRET=bench-secret
export LOG_LEVEL=warn
export DB_POOL_SIZE=${DB_POOL_SIZE:-10}
