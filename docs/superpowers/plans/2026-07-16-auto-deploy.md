# Automatic Deploy on Push to Main Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every push to `main` that passes CI automatically deploys to the production VPS, running the exact same commands `docs/DEPLOY.md` already documents as the manual process.

**Architecture:** Add a `deploy` job to the existing `.github/workflows/ci.yml`, gated on the existing `ci` job succeeding and on the push targeting `main`. The job SSHes into the VPS (via `appleboy/ssh-action`) and runs `git pull && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build app` — no new infrastructure, no registry, no change to how the app builds or runs.

**Tech Stack:** GitHub Actions, `appleboy/ssh-action@v1.2.5`, Docker Compose (existing `docker-compose.prod.yml` on the VPS).

## Global Constraints

- No secrets in the repo — SSH host/user/key live only as GitHub Actions repo secrets (`DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PATH`), referenced by name only.
- The deploy job must run the same commands already documented in `docs/DEPLOY.md` §9 — no drift between the manual fallback and the automated path.
- `deploy` must depend on `ci` (`needs: ci`) so a red CI run never deploys.
- `deploy` must only run `if: github.ref == 'refs/heads/main' && github.event_name == 'push'` — never on pull requests or `feat/**`/`fix/**` branches.
- No new hosting infra, no container registry, no rollback automation, no deploy notifications (all explicitly out of scope per the spec).

## Prerequisite (not a task — you must do this yourself before this plan's job can succeed)

This plan only adds the workflow code. Before the `deploy` job can actually connect to the VPS, add these four repository secrets in GitHub (**Settings → Secrets and variables → Actions → New repository secret**):

- `DEPLOY_SSH_KEY` — the private key you already use for manual VPS SSH access (paste the full contents, including the `-----BEGIN ... PRIVATE KEY-----` / `-----END ... PRIVATE KEY-----` lines)
- `DEPLOY_HOST` — VPS IP or hostname
- `DEPLOY_USER` — SSH user (e.g. `root` or your deploy user)
- `DEPLOY_PATH` — repo path on the VPS (`/opt/navalia` per `docs/DEPLOY.md`, unless you cloned it elsewhere)

Until these exist, the `deploy` job will fail at the SSH step with an authentication error — that's expected and does not affect the `ci` job or anything else in the repo.

---

### Task 1: Add the `deploy` job to CI and update the runbook

**Files:**
- Modify: `.github/workflows/ci.yml` (append a new `deploy` job after the existing `ci` job)
- Modify: `docs/DEPLOY.md:207-213` (the "Update the app" subsection of §9)

**Interfaces:**
- Consumes: nothing from other tasks (this is the only task in this plan).
- Produces: nothing consumed elsewhere — this is a leaf change (a GitHub Actions job + a docs update).

- [ ] **Step 1: Add the `deploy` job to `.github/workflows/ci.yml`**

The current file ends with the `ci` job's `Build` step (last line is `run: npm run build`, at the end of the file). Append a new top-level `deploy` job as a sibling of `ci` under the `jobs:` key. The full file should read exactly as follows after the change:

```yaml
name: CI

on:
  push:
    branches:
      - main
      - "feat/**"
      - "fix/**"
  pull_request:
    branches:
      - main

jobs:
  ci:
    name: Lint · Typecheck · Test · Build
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Typecheck
        run: npm run typecheck

      - name: Test
        # Integration tests use describe.skipIf(!process.env.DATABASE_URL) and
        # are automatically skipped here — only unit tests run in CI.
        run: npm test

      - name: Build
        # NEXT_PUBLIC_* vars are inlined at build time; provide placeholders so
        # the build succeeds without real infrastructure.
        # Non-NEXT_PUBLIC env vars are read at runtime only (not baked in).
        env:
          NEXT_PUBLIC_APP_URL: http://localhost:3000
          DATABASE_URL: postgresql://ci:ci@localhost:5432/ci
          REDIS_URL: redis://127.0.0.1:6379/0
          BETTER_AUTH_SECRET: ci-placeholder-secret-32-chars-pad
          BETTER_AUTH_URL: http://localhost:3000
          STRIPE_SECRET_KEY: sk_test_placeholder
          STRIPE_WEBHOOK_SECRET: whsec_placeholder
          STRIPE_PRICE_ID: price_placeholder
          PLAN_PRICE_CENTS: "4490"
          GOOGLE_CLIENT_ID: build-placeholder.apps.googleusercontent.com
          GOOGLE_CLIENT_SECRET: GOCSPX-ci-placeholder
          OPENAI_API_KEY: sk-placeholder
          OPENAI_MODEL: gpt-4o-mini
          EVOLUTION_URL: http://localhost:8080
          EVOLUTION_API_KEY: placeholder
          EVOLUTION_WEBHOOK_TOKEN: placeholder
          EVOLUTION_WEBHOOK_URL: http://localhost:3000
          NEXT_TELEMETRY_DISABLED: "1"
        run: npm run build

  deploy:
    name: Deploy to VPS
    needs: ci
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'

    steps:
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1.2.5
        with:
          host: ${{ secrets.DEPLOY_HOST }}
          username: ${{ secrets.DEPLOY_USER }}
          key: ${{ secrets.DEPLOY_SSH_KEY }}
          script: |
            cd ${{ secrets.DEPLOY_PATH }}
            git pull
            docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build app
```

Only the `deploy:` job (everything from `  deploy:` to the end) is new — the `ci:` job above it is unchanged, reproduced here only so the full-file replacement is unambiguous.

- [ ] **Step 2: Validate the YAML is syntactically well-formed**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('valid')"`
Expected: prints `valid` with no exception. (This only checks YAML syntax, not GitHub Actions semantics — GitHub validates the workflow schema itself the next time it's pushed, and the job cannot be executed locally since it requires the real `DEPLOY_*` secrets and a live VPS.)

- [ ] **Step 3: Update `docs/DEPLOY.md`'s "Update the app" subsection**

Find this block (`docs/DEPLOY.md:207-213`):

```markdown
### Update the app

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build app
```

Entrypoint runs prisma migrate deploy on startup — no separate migration step needed
```

Replace it with:

```markdown
### Update the app

**This now happens automatically** — every push to `main` that passes CI
triggers the `deploy` job in `.github/workflows/ci.yml`, which runs the
exact commands below over SSH. No manual step needed for a normal update.

The automated job requires four repo secrets to be set once, in GitHub
under **Settings → Secrets and variables → Actions**: `DEPLOY_SSH_KEY`,
`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PATH`.

To update manually (fallback, or for a one-off out-of-band change):

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build app
```

Entrypoint runs prisma migrate deploy on startup — no separate migration step needed
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml docs/DEPLOY.md
git commit -m "ci(deploy): auto-deploy to VPS on push to main"
```

---

## Manual verification (after this task is merged and the four secrets above are set)

This cannot be exercised by the implementer or by any automated test — it requires the real VPS and real secrets, which only exist outside this repo. After merging:

1. Push any small change to `main` (or just merge this plan's commit).
2. Watch the Actions tab on GitHub: the `ci` job should run first, then `deploy` should start automatically once `ci` is green.
3. Once `deploy` finishes successfully, confirm `https://<domain>/api/health` still responds `{"ok":true,"db":true,"redis":true}`.
4. Confirm the production site reflects the latest deployed change (e.g., the pricing page, or whatever the triggering commit changed).

## Out of scope

(Copied from the spec — not covered by this plan.)

- First-time VPS provisioning.
- Automated rollback-on-failure.
- Deploy notifications (Slack/email/etc.).
- Building/pushing a Docker image to a registry (GHCR or otherwise).
- Staging/preview environments.
- Zero-downtime/blue-green deploy strategy.
