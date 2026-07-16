# Automatic Deploy on Push to Main (Design Spec)

**Status:** approved design — feeds the implementation plan.
**Date:** 2026-07-16

## Overview

Today, deploying to production is a fully manual step: someone SSHes into
the VPS and runs the "Update the app" commands documented in
`docs/DEPLOY.md` (§9). This was discovered to be a real gap when a merged
change (pricing fix + Google login) was pushed to GitHub but never reached
production, because pushing to GitHub does nothing on its own — there is no
CI/CD pipeline wired to the VPS, only a test-only GitHub Actions workflow
(`.github/workflows/ci.yml`).

This spec adds a `deploy` job to that same workflow so that every push to
`main` that passes CI automatically deploys to the VPS, running the exact
same commands the manual runbook already documents — no new deploy
infrastructure, no change to how the app is built or run on the VPS.

**Precondition:** the VPS already has a working manual deployment (per
`docs/DEPLOY.md`) — `docker-compose.prod.yml` and `.env.prod` are already
configured and the app is already running there. This spec only automates
the "pull latest + rebuild" step; it does not cover first-time VPS
provisioning (already covered by `docs/DEPLOY.md` §1-§7).

## Global Constraints

- **Stack:** GitHub Actions, Docker Compose on a single Ubuntu VPS (per
  `docs/DEPLOY.md`). No new hosting infra, no container registry.
- **No secrets in the repo:** SSH credentials live only as GitHub Actions
  repo secrets, referenced by name. The workflow file itself must not
  contain any host, user, or key material.
- **Consistency with the existing manual process:** the automated deploy
  must run the *same* commands `docs/DEPLOY.md` §9 already documents as the
  manual "Update the app" procedure — so the manual fallback and the
  automated path never drift apart.

## Architecture

### 1. Trigger and gating

Add a new `deploy` job to the existing `.github/workflows/ci.yml` (not a
separate workflow file). It:

- Declares `needs: ci` — only runs after the existing `ci` job (lint,
  typecheck, test, build) succeeds. A red CI run never deploys.
- Is gated with `if: github.ref == 'refs/heads/main' && github.event_name == 'push'`
  — so it never fires for pull requests or `feat/**`/`fix/**` branch pushes,
  only for an actual push (including a merge) to `main`.

### 2. The deploy step

Uses the `appleboy/ssh-action` GitHub Action (the standard SSH-command
action, avoids hand-rolling `ssh`/key-file plumbing in the workflow) to
connect to the VPS and run:

```bash
cd $DEPLOY_PATH
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build app
```

This is byte-for-byte the same command sequence already documented in
`docs/DEPLOY.md` §9 "Update the app" — the entrypoint already runs
`prisma migrate deploy` on container start, so no separate migration step
is needed here either.

### 3. Secrets

Four new GitHub Actions repository secrets (added manually via GitHub's
Settings UI by the repo owner — never generated or handled by this
workflow):

- `DEPLOY_SSH_KEY` — the private key already used for manual VPS access
- `DEPLOY_HOST` — VPS IP or hostname
- `DEPLOY_USER` — SSH user
- `DEPLOY_PATH` — repo path on the VPS (`/opt/navalia` per the runbook)

The workflow references these by name (`${{ secrets.DEPLOY_SSH_KEY }}`,
etc.) — it never logs or echoes their values.

### 4. Failure handling and rollback

If the SSH step fails (connection error, build failure on the VPS,
`docker compose` non-zero exit), the job fails and the run shows red in the
Actions tab and as a commit status check — identical to any other CI
failure today. No additional notification channel (Slack/email) is added
in this slice — YAGNI; can be layered on later if needed.

Rollback is manual and unchanged from today's practice: `git revert` the
offending commit and push it — that triggers a fresh automatic deploy of
the reverted state. No automated rollback-on-failure is implemented; the
deploy step is a straightforward idempotent re-apply per commit, and the
added complexity of auto-rollback isn't justified for a single-VPS
deployment at this stage.

### 5. Documentation

Update `docs/DEPLOY.md` §9 "Update the app" to note that this now happens
automatically on every push to `main`, while keeping the manual commands
documented verbatim as both the fallback procedure and the literal source
of truth the automated job runs.

## Testing

No automated test exists for the workflow YAML itself (not meaningfully
unit-testable in isolation). Verification is manual and functional: after
implementation, merge to `main`, watch the `deploy` job run in the Actions
tab, then confirm `https://<domain>/api/health` responds and the
production pricing page reflects the latest deployed change.

## Out of scope

- First-time VPS provisioning (already covered by `docs/DEPLOY.md` §1-§7).
- Automated rollback-on-failure.
- Deploy notifications (Slack/email/etc.).
- Building/pushing a Docker image to a registry (GHCR or otherwise) —
  the VPS continues to build the image itself via `docker compose ... --build`,
  matching current practice.
- Staging/preview environments — single production VPS only.
- Zero-downtime/blue-green deploy strategy — `docker compose up -d --build`
  already has a brief restart window today; this spec doesn't change that
  behavior, only automates triggering it.
