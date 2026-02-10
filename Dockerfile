FROM oven/bun:1 AS base
WORKDIR /app

# Install all dependencies (needed for the build step)
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Install production-only dependencies (needed at runtime because Nitro
# dependency tracing is disabled for faster builds)
FROM base AS prod-deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Build the application
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN --mount=type=cache,target=/app/node_modules/.cache bun run build

# Production runner
FROM base AS runner
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/.output ./.output
COPY --from=prod-deps /app/node_modules ./node_modules

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

CMD ["bun", ".output/server/index.mjs"]
