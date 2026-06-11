# Deploy Co-Scientist API on Oracle Cloud (Always Free)

Host the **Option 2** backend on Oracle's permanently free ARM VM. Users bring their own LLM API keys in the browser — you pay **$0** for compute.

```
GitHub Pages (frontend)  ──HTTPS──►  Oracle VM (API + engine)
         │                                    │
         └── user API key in browser ─────────┘
```

## What you need

| Item | Notes |
|---|---|
| **Oracle Cloud account** | [cloud.oracle.com](https://cloud.oracle.com) — Always Free tier |
| **Domain name** | e.g. `api.yourdomain.com` — required for HTTPS (browsers block HTTP APIs from GitHub Pages) |
| **~30 minutes** | One-time VM + DNS setup |

> **No LLM API keys on the server** for Option 2. Leave `.env` keys empty; users paste keys in the web UI Settings.

---

## Step 1 — Create the VM (Oracle Console)

1. **Compute → Instances → Create instance**
2. **Name:** `co-scientist`
3. **Image:** Ubuntu 24.04 (aarch64)
4. **Shape:** `VM.Standard.A1.Flex` (Always Free eligible)
   - Recommended: **2 OCPU**, **12 GB RAM** (fits agent workloads comfortably)
   - Minimum: **1 OCPU**, **6 GB RAM**
5. **Networking:** assign a **public IPv4**
6. **SSH key:** upload your public key
7. Create the instance and note the **public IP**

### Open firewall ports

**A) Security List** (Networking → Virtual cloud networks → your VCN → Security Lists → Ingress):

| Source | Protocol | Port |
|---|---|---|
| `0.0.0.0/0` | TCP | 22 |
| `0.0.0.0/0` | TCP | 80 |
| `0.0.0.0/0` | TCP | 443 |

**B) Instance subnet** — ensure the subnet allows public ingress on 80/443.

The bootstrap script also opens local `iptables` rules (Oracle Ubuntu images often block 80/443 by default).

---

## Step 2 — Point DNS at the VM

Create an **A record**:

```
api.yourdomain.com  →  <Oracle public IP>
```

Wait for DNS to propagate (often 5–30 minutes). Caddy needs this before it can issue a Let's Encrypt certificate.

---

## Step 3 — Bootstrap the server

SSH in:

```bash
ssh ubuntu@<PUBLIC_IP>
```

Run the setup script:

```bash
curl -fsSL https://raw.githubusercontent.com/duckyquang/Co-Scientist/main/deploy/oracle/setup.sh | bash
```

Before it starts, edit the env file if the script created it:

```bash
nano ~/Co-Scientist/deploy/oracle/.env
```

Set:

```env
API_DOMAIN=api.yourdomain.com
CORS_ORIGINS=https://duckyquang.github.io,http://localhost:5173
```

Re-run deploy if you edited after the first attempt:

```bash
cd ~/Co-Scientist
docker compose --env-file deploy/oracle/.env \
  -f docker-compose.yml -f deploy/oracle/docker-compose.prod.yml \
  up -d --build
```

### Verify

```bash
curl -s https://api.yourdomain.com/healthz
# {"ok":true}
```

---

## Step 4 — Connect GitHub Pages (Option 2)

1. GitHub repo → **Settings → Secrets and variables → Actions → Variables**
2. Add **`VITE_API_URL`** = `https://api.yourdomain.com` (no trailing slash)
3. **Actions → Deploy to GitHub Pages → Re-run workflow**

After deploy, users on [duckyquang.github.io/Co-Scientist](https://duckyquang.github.io/Co-Scientist/) can:

1. Pick **Option 2** in onboarding
2. Open **Settings** → paste their API key
3. Start real research sessions

---

## Updates

On the VM:

```bash
bash ~/Co-Scientist/deploy/oracle/update.sh
```

---

## Troubleshooting

### Caddy won't get a certificate
- Confirm DNS: `dig +short api.yourdomain.com` returns your Oracle IP
- Ports 80 and 443 open in **both** Oracle Security List and `iptables`
- `API_DOMAIN` in `deploy/oracle/.env` matches the DNS name exactly

### `502` from Caddy
- Check app logs: `docker compose -f docker-compose.yml -f deploy/oracle/docker-compose.prod.yml logs co-scientist`
- First build can take 5–10 minutes on a small ARM instance

### CORS errors from GitHub Pages
- Ensure `CORS_ORIGINS` includes `https://duckyquang.github.io`
- Rebuild/restart after changing env

### Out of memory
- Use a larger Always Free shape (up to 4 OCPU / 24 GB on A1.Flex)
- Or add swap:
  ```bash
  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  ```

### No domain yet?
HTTPS is required for Option 2 from GitHub Pages. Options:
- Use a cheap domain (~$1–12/year)
- Free DNS on [Cloudflare](https://cloudflare.com) + any registrar
- Temporary testing: open the API URL directly at `https://api.yourdomain.com` (full UI is also served by the backend)

---

## Cost summary

| Component | Cost |
|---|---|
| Oracle Always Free VM | **$0/month** |
| Domain (optional registrar) | ~$1–12/year |
| LLM usage | **Paid by each user** (their own API key) |
| GitHub Pages frontend | **$0** |
