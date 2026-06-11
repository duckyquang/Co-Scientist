#!/usr/bin/env bash
# Pull latest code and redeploy on the Oracle VM.
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-$HOME/Co-Scientist}"
cd "$INSTALL_DIR"

git fetch origin
git pull --ff-only origin "${BRANCH:-main}"

docker compose \
  --env-file deploy/oracle/.env \
  -f docker-compose.yml \
  -f deploy/oracle/docker-compose.prod.yml \
  up -d --build

echo "Redeployed. Health: https://$(grep ^API_DOMAIN= deploy/oracle/.env | cut -d= -f2)/healthz"
