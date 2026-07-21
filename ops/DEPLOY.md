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
