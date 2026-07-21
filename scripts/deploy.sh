#!/usr/bin/env bash
#
# Deploy the current pushed HEAD of main to rp2.rossprogram.org.
#
# Runs locally: sanity-checks that everything is committed and pushed, then
# SSHes to the host, pulls, installs, typechecks, builds, migrates,
# restarts, and hits /api/health as a smoke test.
#
# Usage:
#   ./scripts/deploy.sh
#
# Override the target host:
#   RP2_HOST=ubuntu@some-other-host ./scripts/deploy.sh
#
set -euo pipefail

HOST="${RP2_HOST:-ubuntu@rp2.rossprogram.org}"
BRANCH="${RP2_BRANCH:-main}"

# Run from repo root regardless of where the script is invoked from
cd "$(dirname "$0")/.."

echo "==> Preflight"

# Uncommitted local changes?
if ! git diff --quiet HEAD -- ; then
  echo "   ✗ You have uncommitted changes. Commit or stash before deploying." >&2
  exit 1
fi

# On the right branch?
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" != "$BRANCH" ]]; then
  echo "   ✗ Local branch is '$CURRENT_BRANCH', expected '$BRANCH'." >&2
  echo "     git switch $BRANCH  (or set RP2_BRANCH=$CURRENT_BRANCH)" >&2
  exit 1
fi

# Upstream in sync?
if ! git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
  echo "   ✗ '$BRANCH' has no upstream. Push and set upstream first." >&2
  exit 1
fi
git fetch --quiet
AHEAD=$(git rev-list --count '@{u}..HEAD')
if [[ "$AHEAD" != "0" ]]; then
  echo "   ✗ You have $AHEAD unpushed commit(s) — push first." >&2
  exit 1
fi

DEPLOY_SHA=$(git rev-parse HEAD)
echo "   Deploying: $(git log -1 --oneline)"
echo "   Target:    $HOST"
echo "   Branch:    $BRANCH"
echo

ssh -T "$HOST" DEPLOY_SHA="$DEPLOY_SHA" BRANCH="$BRANCH" bash <<'REMOTE'
set -euo pipefail

# Non-interactive SSH doesn't source ~/.bashrc; make sure the standard
# paths that corepack put pnpm in are on PATH.
export PATH=/usr/local/bin:/usr/bin:/bin:$PATH

command -v pnpm >/dev/null || { echo "   ✗ pnpm not on PATH" >&2; exit 1; }
command -v node >/dev/null || { echo "   ✗ node not on PATH" >&2; exit 1; }

echo "==> Pull latest"
cd /opt/rp2
git fetch --quiet origin "$BRANCH"
git checkout -q "$BRANCH"
git reset --hard "origin/$BRANCH"

REMOTE_SHA=$(git rev-parse HEAD)
if [[ "$REMOTE_SHA" != "$DEPLOY_SHA" ]]; then
  echo "   ✗ Remote HEAD is $REMOTE_SHA, expected $DEPLOY_SHA." >&2
  exit 1
fi

echo "==> Install dependencies"
pnpm install --frozen-lockfile

echo "==> Typecheck"
pnpm --filter @rp2/backend build
pnpm --filter @rp2/frontend build

echo "==> Migrate"
cd backend
# migrate.ts imports env.ts, which does `import 'dotenv/config'`, so the
# tsx process reads .env from its cwd on its own. No need to marshal env
# vars through the shell (which fails silently anyway, since .env is
# rp2-owned and the outer grep runs as ubuntu).
sudo -u rp2 ./node_modules/.bin/tsx src/db/migrate.ts
cd ..

echo "==> Restart"
sudo systemctl restart rp2
sleep 2
if ! sudo systemctl is-active --quiet rp2; then
  echo "   ✗ rp2 failed to start" >&2
  sudo journalctl -u rp2 --since '1 minute ago' -o cat >&2
  exit 1
fi

echo "==> Health check"
if curl -sfm 5 https://rp2.rossprogram.org/api/health >/dev/null; then
  echo "   OK"
else
  echo "   ✗ /api/health did not respond 200" >&2
  exit 1
fi
REMOTE

echo
echo "==> Deployed $DEPLOY_SHA"
