# BRX AWS Deployment

This is the low-cost first deployment path for testing BRX on AWS. It runs frontend, API, PostgreSQL, Redis, and uploads on one Ubuntu server with Docker Compose.

## Recommended AWS Choice

Use one Ubuntu 24.04 server first. Lightsail is the simplest if available in your AWS console. EC2 also works.

Suggested minimum for testing:

- 1 vCPU / 1-2 GB RAM for light testing
- 20+ GB disk
- Open inbound ports: 22, 80, and later 443
- Keep database ports 5432 and Redis 6379 closed to the public internet

For real public money/funds, move PostgreSQL to RDS, add HTTPS, backups, monitoring, WAF/rate limits, and proper secret management before launch.

## 1. Create The Server

In AWS Console:

1. Search `Lightsail` or `EC2`.
2. Create an Ubuntu 24.04 instance.
3. Allow HTTP port `80` and SSH port `22`.
4. Attach a static IP if using Lightsail, or use the EC2 public IPv4 address for testing.

## 2. Install Docker On The Server

SSH into the server, then run:

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
newgrp docker
```

## 3. Upload Or Clone BRX

If the repo is on GitHub:

```bash
git clone YOUR_REPO_URL BRX
cd BRX
```

If not, upload the project folder to the server first, then `cd BRX`.

## 4. Create Production Environment

```bash
cp backend/.env.production.example backend/.env.production
nano backend/.env.production
```

Change at least:

- `APP_URL`
- `FRONTEND_URL`
- `GOOGLE_CALLBACK_URL` if Google login is used
- `POSTGRES_PASSWORD`
- `DATABASE_URL` password must match `POSTGRES_PASSWORD`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `ENCRYPTION_KEY`
- `ALCHEMY_BNB_RPC_URL`
- `RESEND_API_KEY`

Generate secrets with:

```bash
openssl rand -hex 32
```

## 5. Start BRX

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Run the database schema once:

```bash
docker compose -f docker-compose.prod.yml exec api node scripts/run-schema.mjs
```

Open:

```text
http://YOUR_SERVER_IP
```

## 6. Deploy Updates To An Existing Lightsail Server

The production server runs the whole app with Docker Compose from `~/BRX`. Do not run host-level `npm install`, `npm run build`, or `systemctl restart brx-backend` for this deployment. The API is rebuilt inside the `api` Docker container, and the frontend is served by the `web` Nginx container.

### Local Computer

Commit and push the update first:

```bash
cd C:\projects\BRX
git status
git add .
git commit -m "Describe the update"
git push origin main
```

### Lightsail Server

SSH into Lightsail, then pull the new commit:

```bash
cd ~/BRX
git status --short
git pull origin main
git rev-parse --short HEAD
```

If `git pull` aborts because server config files would be overwritten, preserve those server-only edits first:

```bash
cd ~/BRX
git stash push -m "server deploy config before update" -- deploy/nginx.conf deploy/nginx.conf.backup docker-compose.prod.yml docker-compose.prod.yml.backup
git pull origin main
git rev-parse --short HEAD
```

Only use `git stash pop` later if you intentionally need to restore the server-local config changes.

### Restart Or Rebuild

For frontend-only updates such as `index.html`, `scripts/`, `styles/`, `assets/`, `manifest.webmanifest`, or `sw.js`:

```bash
docker compose -f docker-compose.prod.yml restart web
docker compose -f docker-compose.prod.yml exec web nginx -s reload
```

For backend, Dockerfile, dependency, environment, or compose changes:

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

If a database schema changed, run migrations after the rebuild:

```bash
docker compose -f docker-compose.prod.yml exec api node scripts/run-schema.mjs
```

### Verify The Live Files

Check that the server is on the expected commit and that the public site is serving updated assets:

```bash
git rev-parse --short HEAD
curl -I https://YOUR_DOMAIN_OR_IP/manifest.webmanifest
curl -I https://YOUR_DOMAIN_OR_IP/sw.js
curl -s https://YOUR_DOMAIN_OR_IP/index.html | grep "mobile.css"
```

If the server has the new files but the browser still shows old UI, hard refresh the browser. For PWA/service-worker cache issues, open the site with a cache-busting query once, for example:

```text
https://YOUR_DOMAIN_OR_IP/?fresh=1
```

## 7. Useful Commands

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml restart api
docker compose -f docker-compose.prod.yml down
```

## 8. Before Real Users

Do not process real user funds until these are done:

- HTTPS certificate and domain configured
- Automated database backups
- Admin accounts protected with strong passwords and 2FA policy
- Withdrawal hot-wallet key stored securely, not in git
- Legal terms, privacy, KYC, escrow, and risk pages reviewed
- Monitoring and alerts for API, DB, deposit scanner, and balances