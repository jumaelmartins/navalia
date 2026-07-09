# ─── Stage 1: install all dependencies ───────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
# --ignore-scripts: skip the `postinstall: prisma generate` here — the schema
# isn't in this stage yet. The builder stage runs `npx prisma generate`
# explicitly after copying the source.
RUN npm ci --ignore-scripts

# ─── Stage 2: build ───────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* vars are inlined at build time — override via --build-arg / compose build args in prod
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

# Dummy values so Next.js can import modules that read env at module-init time.
# None of these touch real resources; they are build-time stubs only.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV BETTER_AUTH_SECRET=build-placeholder-secret-32-chars!!
ENV BETTER_AUTH_URL=http://localhost:3000
ENV STRIPE_SECRET_KEY=sk_test_build_placeholder
ENV STRIPE_WEBHOOK_SECRET=whsec_build_placeholder
ENV STRIPE_PRICE_ID=price_build_placeholder
ENV PLAN_PRICE_CENTS=4490
ENV OPENAI_API_KEY=sk-build-placeholder
ENV OPENAI_MODEL=gpt-4o-mini
ENV EVOLUTION_URL=http://localhost:8080
ENV EVOLUTION_API_KEY=build-placeholder
ENV EVOLUTION_WEBHOOK_TOKEN=build-placeholder
ENV EVOLUTION_WEBHOOK_URL=http://localhost:3000
ENV NEXT_TELEMETRY_DISABLED=1

RUN npx prisma generate
RUN npm run build

# ─── Stage 3: production runner ───────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root user
RUN addgroup -S nodejs -g 1001 \
 && adduser  -S nextjs -u 1001 -G nodejs

# ── Standalone server (Next.js standalone output) ──────────────────────────
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static     ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public           ./public

# ── Prisma: schema + migrations (for migrate deploy at startup) ────────────
COPY --from=builder --chown=nextjs:nodejs /app/prisma           ./prisma
# Prisma 7 reads the datasource URL for `migrate deploy` from prisma.config.ts
# (process.env.DATABASE_URL), not the schema's env() — the config must be
# present in the runner or migrate deploy fails with "datasource.url required".
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts

# ── Full dependency set (Prisma CLI for `migrate deploy` at startup) ───────
# The Next.js standalone trace bundles only imported runtime deps, so the
# Prisma 7 CLI and its transitive deps (e.g. @prisma/config → `effect`,
# `empathic`) are missing — `prisma migrate deploy` then fails with
# "Cannot find module 'effect'". Copy the complete node_modules over the
# traced one (superset; disk is cheap on a single VPS).
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

# ── Startup script ─────────────────────────────────────────────────────────
COPY --chown=nextjs:nodejs docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

USER nextjs

EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]
