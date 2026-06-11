#!/usr/bin/env bash
# Bootstrap Co-Scientist on a fresh Oracle Cloud Always Free Ubuntu VM.
#
# Run on the VM as the default ubuntu user (has passwordless sudo):
#   curl -fsSL https://raw.githubusercontent.com/duckyquang/Co-Scientist/main/deploy/oracle/setup.sh | bash
#
# Or after cloning:
#   bash deploy/oracle/setup.sh
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/duckyquang/Co-Scientist.git}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/Co-Scientist}"
BRANCH="${BRANCH:-main}"

echo "==> Co-Scientist Oracle bootstrap"
echo "    install dir: $INSTALL_DIR"

# ---- Docker ----
if ! command -v docker &>/dev/null; then
  echo "==> Installing Docker..."
  sudo apt-get update -qq
  sudo apt-get install -y ca-certificates curl git
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "${VERSION_CODENAME:-$VERSION}") stable" |
    sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  sudo usermod -aG docker "$USER"
  echo "==> Docker installed. You may need to log out/in for group membership."
fi

# ---- Oracle iptables (Ubuntu images often block 80/443 by default) ----
echo "==> Opening ports 80 and 443 in local iptables (Oracle images)..."
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
if command -v netfilter-persistent &>/dev/null; then
  sudo netfilter-persistent save 2>/dev/null || true
fi

# ---- Repo ----
if [[ -d "$INSTALL_DIR/.git" ]]; then
  echo "==> Updating existing clone..."
  git -C "$INSTALL_DIR" fetch origin
  git -C "$INSTALL_DIR" checkout "$BRANCH"
  git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH" || true
else
  echo "==> Cloning repository..."
  git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

# ---- Env ----
if [[ ! -f deploy/oracle/.env ]]; then
  cp deploy/oracle/.env.example deploy/oracle/.env
  echo ""
  echo "!! Edit deploy/oracle/.env and set API_DOMAIN to your hostname."
  echo "!! Point an A record at this VM's public IP before starting Caddy."
  echo ""
fi

# shellcheck disable=SC1091
set -a && source deploy/oracle/.env && set +a

if [[ "${API_DOMAIN:-}" == "api.yourdomain.com" || -z "${API_DOMAIN:-}" ]]; then
  echo "ERROR: Set API_DOMAIN in deploy/oracle/.env before continuing."
  echo "       Example: API_DOMAIN=api.example.com"
  exit 1
fi

mkdir -p data
touch .env  # root env optional for Option 2 (users bring API keys in the browser)

echo "==> Building and starting (this may take several minutes on first run)..."
docker compose \
  --env-file deploy/oracle/.env \
  -f docker-compose.yml \
  -f deploy/oracle/docker-compose.prod.yml \
  up -d --build

echo ""
echo "==> Done."
echo "    API (after DNS propagates): https://${API_DOMAIN}"
echo "    Health check:               https://${API_DOMAIN}/healthz"
echo ""
echo "Next: set GitHub repository variable VITE_API_URL=https://${API_DOMAIN}"
echo "      (Settings → Secrets and variables → Actions → Variables)"
echo "      then re-run the 'Deploy to GitHub Pages' workflow."
