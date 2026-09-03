# Deploying RP2 to rp2.rossprogram.org

Target: a single Ubuntu 24.04 host on EC2 (`t4g.medium`), fronted by Caddy for
TLS, running Fastify on `127.0.0.1:3000` under systemd, with SQLite on EBS and
Litestream replicating to S3. Applicant uploads live in S3 directly.

## Assumed prerequisites (things you set up in AWS)

- **EC2** — `t4g.medium` Ubuntu 24.04, an Elastic IP, security group open to
  22/80/443, hostname `rp2.rossprogram.org` pointed at the EIP via A record.
- **S3 buckets** (both private, in us-east-2):
  - `rp2.rossprogram.org` — prod uploads + Litestream backups
  - `rp2-dev.rossprogram.org` — dev
- **SES** in us-east-1: sending domain (`rossprogram.org`) verified with
  DKIM/SPF/DMARC, moved out of the sandbox, and a `From` identity you're
  happy sending as (`noreply@rossprogram.org`).
- **IAM role** attached to the EC2 instance, containing the policy in
  `ops/iam/rp2-instance-role.json` (SES send in us-east-1, S3 access on both
  buckets).
- **S3 CORS** on the uploads bucket, from `ops/s3/cors.json`:

  ```bash
  aws s3api put-bucket-cors \
    --bucket rp2.rossprogram.org \
    --cors-configuration file://ops/s3/cors.json
  ```

  Without this, browser PUTs to the presigned URL fail the preflight
  (`No 'Access-Control-Allow-Origin' header is present`). Re-run whenever
  `cors.json` changes.

The three services on the box are:

| Unit | What it does |
|---|---|
| `caddy` | TLS + reverse proxy, serves the static SPA under `/`, proxies `/api/*` to Node |
| `rp2` | The Fastify backend (`/opt/rp2/backend/dist/server.js`) |
| `litestream` | Continuous SQLite → S3 replication |

## First-time host setup

Run on a fresh Ubuntu 24.04 host as `ubuntu`, after SSH-ing in.

### 1. System packages

```bash
sudo apt-get update
sudo apt-get install -y build-essential git curl caddy

# Node 20 via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# pnpm via corepack
sudo corepack enable
sudo corepack prepare pnpm@9.15.9 --activate

# Litestream (ARM)
LITESTREAM_VERSION=0.3.13
curl -L "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-linux-arm64.deb" -o /tmp/litestream.deb
sudo dpkg -i /tmp/litestream.deb
```

### 2. Service user and directories

```bash
sudo useradd --system --home /var/lib/rp2 --shell /usr/sbin/nologin rp2
sudo mkdir -p /opt/rp2 /var/lib/rp2
sudo chown rp2:rp2 /var/lib/rp2
```

### 3. Clone and build

```bash
sudo mkdir -p /opt/rp2 && sudo chown ubuntu:ubuntu /opt/rp2
git clone https://github.com/<your-org>/rp2.git /opt/rp2
cd /opt/rp2
pnpm install --frozen-lockfile
pnpm --filter @rp2/backend build          # typechecks only; runtime uses tsx
pnpm --filter @rp2/frontend build         # emits frontend/dist/
```

The backend runs from TypeScript source via `tsx` at runtime — there's no
compiled `dist/` to keep in sync. The build step above is just a typecheck.

### 4. Production environment

```bash
sudo cp /opt/rp2/backend/.env.production.example /opt/rp2/backend/.env
sudo -e /opt/rp2/backend/.env             # set SESSION_SECRET (openssl rand -hex 32)
sudo chown rp2:rp2 /opt/rp2/backend/.env
sudo chmod 600 /opt/rp2/backend/.env
```

### 5. Run migrations

```bash
cd /opt/rp2/backend
sudo -u rp2 env $(grep -v '^#' .env | xargs) ./node_modules/.bin/tsx src/db/migrate.ts
```

### 6. systemd + Caddy + Litestream

```bash
sudo cp /opt/rp2/ops/systemd/rp2.service /etc/systemd/system/
sudo cp /opt/rp2/ops/litestream/litestream.service /etc/systemd/system/
sudo cp /opt/rp2/ops/litestream/litestream.yml /etc/litestream.yml
sudo cp /opt/rp2/ops/caddy/Caddyfile /etc/caddy/Caddyfile

sudo systemctl daemon-reload
sudo systemctl enable --now rp2 litestream caddy
sudo systemctl reload caddy
```

Caddy will provision the Let's Encrypt certificate for `rp2.rossprogram.org`
on first request. `journalctl -u rp2 -f` to watch the backend logs.

## Deploying an update

From your dev machine, push to `main`. On the host:

```bash
cd /opt/rp2
git pull --ff-only
pnpm install --frozen-lockfile
pnpm --filter @rp2/backend build
pnpm --filter @rp2/frontend build
cd backend && sudo -u rp2 env $(grep -v '^#' .env | xargs) ./node_modules/.bin/tsx src/db/migrate.ts && cd ..
sudo systemctl restart rp2
```

Caddy picks up static-file changes immediately (no restart).

## Turning on Stripe

Payments are gated behind `PAYMENTS_ENABLED`. Everything else — offers,
accept/decline, and full-scholarship enrollment — works with this off, so you
can leave it off until you are ready and nothing else changes.

`env.ts` refuses to boot if `PAYMENTS_ENABLED=true` without both keys, so a
half-finished setup fails loudly at startup rather than at a family's first
payment.

### 1. Test mode first, on your laptop

```bash
stripe login
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

`stripe listen` prints a `whsec_…`. **That is your local webhook secret and it
is not the same value as the dashboard's** — mixing the two up is the classic
hour of confusion here. Put it, plus your *test* secret key, in
`backend/.env`:

```
PAYMENTS_ENABLED=true
STRIPE_SECRET_KEY=sk_test_…
STRIPE_WEBHOOK_SECRET=whsec_…      # from `stripe listen`
```

Restart the backend, publish an offer with a balance, and pay with card
`4242 4242 4242 4242`, any future expiry, any CVC.

Do the run twice, and the second time **close the Checkout tab the instant the
payment goes through**, so the browser never returns to `success_url`. The
student must still end up enrolled. That is the test that proves the webhook is
authoritative rather than the redirect — and the redirect genuinely does go
missing in real life, on mobile banking flows and closed tabs.

Note that `stripe trigger checkout.session.completed` is *not* a substitute for
driving the real UI. The fixture has no matching `payment` row, so it only
exercises the unknown-session guard.

### 2. Register the live webhook endpoint

Dashboard → Developers → Webhooks → **Add endpoint**.

- URL: `https://rp2.rossprogram.org/api/stripe/webhook`
- Events to send:
  - `checkout.session.completed` — the only event that enrolls anyone
  - `checkout.session.expired` — marks an abandoned session, changes no status
  - `charge.refunded` — recorded and surfaced; never un-enrolls automatically

Then copy that endpoint's **Signing secret** (`whsec_…`).

Caddy already proxies all of `/api/*` to the backend, so there is no reverse
proxy change to make.

### 3. Live keys on the server

```bash
sudo -e /opt/rp2/backend/.env
```

```
PAYMENTS_ENABLED=true
STRIPE_SECRET_KEY=sk_live_…
STRIPE_WEBHOOK_SECRET=whsec_…     # the DASHBOARD's, not `stripe listen`'s
```

```bash
sudo systemctl restart rp2
sudo journalctl -u rp2 -n 30      # a bad key shows up here immediately
```

### 4. Confirm it is live

Send a test event from the dashboard endpoint page and watch for a `200`. Then:

```bash
# Should be 400 with no stripe_event row written.
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST https://rp2.rossprogram.org/api/stripe/webhook \
  -H 'Content-Type: application/json' \
  -H 'stripe-signature: garbage' -d '{}'
```

Do one real £/$ transaction against a live card and refund it from the
dashboard. The refund is recorded but deliberately does **not** un-enroll the
student — that stays a human decision.

### Dashboard walkthrough

Stripe reorganizes its dashboard fairly often and renames things (Webhooks
became "Event destinations" in the newer Workbench UI). If a path below does
not match what you see, use the dashboard search box — searching for "API keys"
or "Webhooks" jumps straight there and survives their redesigns.

**Watch the test/live toggle.** It is near the top of the dashboard, and keys
and webhook endpoints are *separate per mode*. A test-mode key with a live-mode
webhook secret is the most common way to get this wrong.

#### a. Secret key

*Developers → API keys*

Copy the **Secret key** (`sk_live_…`; you have to click to reveal it). That is
`STRIPE_SECRET_KEY`. Restricted keys (`rk_live_…`) are accepted there too, and
are the better choice — see below.

Optionally, prefer a **restricted key** — *Create restricted key*, grant only
**Checkout Sessions: write**, and leave everything else at None. That is all
this app does with the API; the webhook verifies signatures locally and needs
no permission at all. A leaked restricted key cannot issue refunds or read your
customer list.

The publishable key is not used. Checkout is a redirect to a Stripe-hosted
page, so there is no Stripe.js on our pages.

#### b. Webhook endpoint

*Developers → Webhooks → Add endpoint*

| Field | Value |
|---|---|
| Endpoint URL | `https://rp2.rossprogram.org/api/stripe/webhook` |
| API version | `2026-08-26.dahlia` — must match `STRIPE_API_VERSION` in code |
| Events | `checkout.session.completed`, `checkout.session.expired`, `charge.refunded` |

The endpoint's API version defaults to your *account* default, which is a
separate setting from the one the code pins for outgoing requests. Set it
explicitly so requests and events speak one version, and so nobody clicking
"upgrade" in the dashboard changes event shapes under a running server.

If you bump the `stripe` npm package, update `STRIPE_API_VERSION` and this
endpoint together. `test/stripe-version.test.ts` fails if the pin drifts from
the installed SDK, but it cannot see the dashboard — that half is on you.

Add it, then open the endpoint and reveal its **Signing secret** (`whsec_…`).
That is `STRIPE_WEBHOOK_SECRET`.

Send a test event from that page; you want a `200`. Unhandled event types also
return `200` on purpose — Stripe retries anything else for days.

#### c. Branding — families see this

*Settings → Business → Branding*

Set the public business name, icon, and accent colour. This is the header of
the Checkout page a parent lands on, so it should read **Ross Mathematics
Foundation**, not a legal entity name they will not recognize.

#### d. Statement descriptor — this prevents chargebacks

*Settings → Payments → (statement descriptor)*

Set something a parent will recognize on a card statement, e.g.
`ROSS MATH RP2`. An unrecognized descriptor on a $750 charge is a common cause
of disputes, and disputes cost money and time to contest.

#### e. Receipt emails

*Settings → Payments → Customer emails → Successful payments*

Turn this on. The session passes `customer_email`, so Stripe will email a
payment receipt automatically. That is separate from — and useful alongside —
our own "you are enrolled" email, which is not a financial record.

#### What you do NOT need to set up

- **Products or Prices.** The session builds its line item inline from the
  offer's `amount_due`, so the catalog stays empty.
- **Payment methods.** The code pins `payment_method_types: ['card']`, so
  toggling Link, Klarna, or bank debits in the dashboard has no effect. Apple
  Pay and Google Pay ride along with cards automatically.
- **Stripe Tax.** Tuition here is not being taxed; leave it off.
- **Customer portal / subscriptions.** One-time payments only.

### Things worth knowing

- The API version is pinned as `STRIPE_API_VERSION` in
  `backend/src/integrations/stripe/index.ts` and asserted against the SDK by
  `test/stripe-version.test.ts`. Changing the account's default in the
  dashboard does not affect us.
- Amounts are always read from the `offer` row server-side. The browser never
  sends a price, and the webhook refuses to enroll if `amount_total` does not
  match what we quoted.
- Card only, deliberately: no ACH, which keeps the whole
  `async_payment_succeeded/failed` branch of the state machine out of existence.
- Rotating either secret is just an `.env` edit and `systemctl restart rp2`.

## Restoring from Litestream

Test this before you open applications.

```bash
sudo systemctl stop rp2
sudo mv /var/lib/rp2/db.sqlite /var/lib/rp2/db.sqlite.old
sudo -u rp2 litestream restore -config /etc/litestream.yml /var/lib/rp2/db.sqlite
sudo systemctl start rp2
```

If that works cleanly, you're good. If it doesn't — do not open applications
until it does.

## What lives where

| Path | Contents |
|---|---|
| `/opt/rp2/` | Source checkout, built artefacts (`backend/dist`, `frontend/dist`) |
| `/opt/rp2/backend/.env` | Production env (owned root:rp2, mode 600) |
| `/var/lib/rp2/db.sqlite` | Live SQLite database + WAL |
| `s3://rp2.rossprogram.org/litestream/` | SQLite replicas |
| `s3://rp2.rossprogram.org/uploads/` | Applicant transcripts and aid docs |
| `/etc/caddy/Caddyfile` | Caddy config |
| `/etc/litestream.yml` | Litestream config |
| `/etc/systemd/system/rp2.service` | Backend unit |
| `/etc/systemd/system/litestream.service` | Backup unit |

## Health checks

```bash
curl -sf https://rp2.rossprogram.org/api/health          # → {"ok":true}
sudo systemctl status rp2 litestream caddy
sudo journalctl -u rp2 --since '10 minutes ago'
aws s3 ls s3://rp2.rossprogram.org/litestream/           # from any machine with the profile
```

## Sending your first SES message

Before opening applications, take one applicant test-user through the flow
(request magic link → sign in → submit) with your own email as the applicant
address, so SES actually sends the link and you confirm deliverability. If it
lands in your inbox you're good. If it bounces or spams, double-check DKIM
alignment and the DMARC record.
