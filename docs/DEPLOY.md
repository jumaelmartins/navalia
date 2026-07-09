# Navalia — Production Deploy Runbook

This document walks through deploying Navalia to a single Ubuntu VPS from scratch. Follow the steps in order; each section links the relevant commands.

---

## 1. Provision the VPS

Recommended: Ubuntu 22.04 LTS, 2 vCPU / 4 GB RAM minimum (8 GB recommended for Evolution + Postgres under load).

```bash
# On the VPS — install Docker Engine + Compose plugin
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in to pick up the group

# Verify
docker --version          # Docker 25+
docker compose version    # Docker Compose 2.x
```

---

## 2. Point DNS

Create an **A record** for your domain pointing to the VPS public IP:

```
navalia.example.com  A  <VPS_PUBLIC_IP>
```

Wait for propagation (usually < 5 minutes with short TTL). Caddy will provision a Let's Encrypt certificate automatically on first boot — it needs port 80/443 reachable from the internet before `docker compose up`.

---

## 3. Clone the Repository

```bash
cd /opt
git clone https://github.com/YOUR_ORG/navalia.git
cd navalia
```

---

## 4. Configure the Environment

```bash
cp .env.prod.example .env.prod
nano .env.prod   # or vim, code --wait, etc.
```

Fill every value. Critical items:

### BETTER_AUTH_SECRET (MUST rotate before first boot)

```bash
openssl rand -base64 32
# Copy the output into BETTER_AUTH_SECRET in .env.prod
```

### DOMAIN

Set `DOMAIN` to the bare domain, e.g. `navalia.example.com` (no `https://`). Caddy reads this from the environment variable referenced in `Caddyfile`.

### Database password

Choose a strong random password. Set it in both `POSTGRES_PASSWORD` and the `DATABASE_URL`:

```
POSTGRES_PASSWORD=<strong_random>
DATABASE_URL=postgresql://navalia:<strong_random>@postgres:5432/navalia
```

### Stripe keys

Use **live** keys for production:

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...   # fill this after step 7
STRIPE_PRICE_ID=price_...
```

### Evolution API key

```bash
openssl rand -hex 32
# Paste the output as EVOLUTION_API_KEY and EVOLUTION_WEBHOOK_TOKEN
```

### Sample `.env.prod` checklist

- [ ] `DOMAIN` — bare domain, no protocol
- [ ] `NEXT_PUBLIC_APP_URL` — `https://` + domain
- [ ] `BETTER_AUTH_URL` — `https://` + domain
- [ ] `BETTER_AUTH_SECRET` — 32-byte random string (openssl rand -base64 32)
- [ ] `POSTGRES_PASSWORD` — strong random
- [ ] `DATABASE_URL` — uses postgres hostname `postgres` (Docker service name)
- [ ] `REDIS_URL` — `redis://redis:6379/0`
- [ ] `STRIPE_SECRET_KEY` — live key
- [ ] `STRIPE_PRICE_ID` — live price ID
- [ ] `STRIPE_WEBHOOK_SECRET` — `whsec_...` (reveal in Stripe Dashboard after step 7)
- [ ] `PLAN_PRICE_CENTS` — plan price in cents, e.g. `4490` for R$ 44,90
- [ ] `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — from the Google Cloud Console OAuth Client; confirm its Authorized redirect URI includes `https://<DOMAIN>/api/auth/callback/google`
- [ ] `OPENAI_API_KEY` — valid key
- [ ] `OPENAI_MODEL` — e.g. `gpt-4o-mini` (defaults to `gpt-4o-mini` if unset)
- [ ] `EVOLUTION_API_KEY` — strong random
- [ ] `EVOLUTION_WEBHOOK_TOKEN` — same value as `EVOLUTION_API_KEY` (used to verify inbound webhook signature)
- [ ] `EVOLUTION_WEBHOOK_URL` — `http://app:3000` (internal Docker network)

---

## 5. First Boot

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

This will:
1. Build the Next.js app image (multi-stage — ~3–5 minutes on first run)
2. Start Postgres, run the `postgres-init` SQL (creates the `evolution` database)
3. Start Redis
4. Start Evolution API
5. Start the app — the entrypoint runs `prisma migrate deploy` before launching `node server.js`
6. Start Caddy — provisions Let's Encrypt TLS on first request

---

## 6. First-Boot Health Checks

```bash
# Watch logs during startup
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f app

# Confirm migrations ran
docker compose -f docker-compose.prod.yml --env-file .env.prod logs app | grep "migration"
# Should show "All migrations have been successfully applied."

# Check Caddy got TLS
docker compose -f docker-compose.prod.yml --env-file .env.prod logs caddy | grep "certificate"

# Test the health endpoint
curl https://navalia.example.com/api/health
# Expected: {"ok":true,"db":true,"redis":true}

# If health returns ok:false, inspect
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
docker compose -f docker-compose.prod.yml --env-file .env.prod logs postgres
docker compose -f docker-compose.prod.yml --env-file .env.prod logs redis
```

---

## 7. Stripe Webhook Registration

1. Go to [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/webhooks).
2. Click **Add endpoint**.
3. Endpoint URL: `https://navalia.example.com/api/webhooks/stripe`
4. Events to listen to:
   - `checkout.session.completed`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. After creating the endpoint, reveal the **Signing secret** (`whsec_...`).
6. Add it to `.env.prod`:
   ```
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```
7. Restart the app:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.prod restart app
   ```

---

## 8. Evolution API (WhatsApp)

Evolution API and the app share the internal Docker network. The app calls `http://evolution:8080` (configured in `EVOLUTION_URL`), and Evolution calls back `http://app:3000/api/webhooks/evolution` (configured in the compose file via `WEBHOOK_GLOBAL_URL`).

**No public exposure needed for Evolution** — both services are on the `internal` network.

Each barbershop owner connects their number from **Dashboard → WhatsApp → Criar instância**:
1. The app calls Evolution to create instance `nav_{barbershopId}`
2. The QR code renders in the dashboard
3. Owner scans with WhatsApp → Linked Devices

If a number disconnects (phone offline, re-install), the owner re-scans from the dashboard.

**Key rotation**: If you rotate `EVOLUTION_API_KEY`, update both `.env.prod` and the Evolution `AUTHENTICATION_API_KEY` environment variable in `docker-compose.prod.yml`, then restart:
```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod restart evolution app
```

---

## 9. Routine Operations

### View logs

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f app
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f evolution
```

### Update the app

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build app
# Entrypoint runs prisma migrate deploy on startup — no separate migration step needed
```

### Restart a service

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod restart app
```

### Database backup (suggested cron)

```bash
# /etc/cron.d/navalia-backup
0 3 * * * root docker exec navalia-postgres-1 \
  pg_dump -U navalia navalia | gzip > /backups/navalia-$(date +\%Y\%m\%d).sql.gz
```

Keep at least 7 daily backups. Store offsite (S3, Backblaze B2, etc.).

---

## 10. Known Limitations

| Limitation | Details |
|------------|---------|
| Unofficial WhatsApp protocol | Evolution API uses Baileys (reverse-engineered). Numbers used for spam can be banned by Meta. Document this risk to shop owners. The adapter is isolated: migration to WhatsApp Cloud API only touches `src/modules/whatsapp/evolution-client.ts`. |
| PROCESSING orphan on copilot crash | If the server crashes after an `AiActionLog` row is set to `PROCESSING` but before it resolves, the row stays in `PROCESSING` permanently. Manual DB update required: `UPDATE "AiActionLog" SET status = 'ERROR' WHERE status = 'PROCESSING'`. |
| Single-node debounce / rate-limit | The 4-second WhatsApp message debounce and the booking rate limiter use in-process Redis keys. They work correctly on a single instance but are not horizontally scalable without a shared-state revision. |
| TLS requires port 80/443 open | Caddy's ACME challenge needs ports 80 and 443 reachable from Let's Encrypt servers. Ensure your VPS firewall allows inbound TCP on both ports. |
| Human-takeover is one-way by default | When the AI detects `[HUMANO]` (WhatsApp only), the conversation enters `TRANSFERRED_TO_HUMAN` state and the bot goes silent. There is no automatic re-activation after a human responds. Operators must manually reactivate the bot from **Dashboard → WhatsApp → Conversas com atendimento humano → Reativar bot** once the manual session ends. |
| Availability sheet multi-window collapse | If the same barbershop owner has the professional availability settings open in two browser tabs simultaneously, saving in one tab will overwrite the other's unsaved changes without warning. The last write wins. Workaround: always edit availability in a single tab at a time. |
