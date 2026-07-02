# BRX

BRX is a launch-bound ETB/USDT P2P exchange web app for `brxp2p.com`. The product uses custodial USDT wallets, database escrow, manual KYC, email verification, and a BNB Smart Chain BEP20 wallet rail.

This repository currently contains the BRX web interface, PostgreSQL schema, backend planning notes, and legal placeholders. Public customer access must wait until the NestJS backend, PostgreSQL ledger, Redis queues, Resend email delivery, Alchemy BSC monitoring, wallet security, and admin operations are connected.

## Run Locally

Open `index.html` directly in a browser for the current static frontend.

For the backend:

```bash
docker compose up -d
cd backend
npm install
npm run migrate
npm run start:dev
```

Then open `index.html`, create/verify an account, and visit the Wallet page. If the backend is running, BRX will request a local BEP20 deposit address from `http://localhost:3000/api`.

Target local backend stack:

- NestJS API on Fastify
- PostgreSQL database
- Redis queues
- Alchemy BNB Smart Chain RPC
- Resend email verification

## Product Scope

- ETB/USDT P2P marketplace.
- Custodial USDT wallet model.
- First blockchain network: USDT BEP20 on BNB Smart Chain.
- BSC monitoring through Alchemy RPC.
- Email verification with the existing Resend plan.
- Manual KYC review by admin.
- Internal database ledger for balances, escrow, deposits, withdrawals, and audit logs.
- No blockchain transaction during P2P trades.

## Current Web Flow

- Landing page opens first.
- `Get started` opens signup at `#/register`.
- Signup validates email, password, confirmation, and terms agreement.
- Email verification sends Resend-backed codes through the NestJS backend.
- Login is verified by the backend and returns a signed access token for session requests.
- Google sign-in/sign-up is supported through the backend OAuth flow once `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are configured.
- Signed-in pages hydrate profile, wallet address, and USDT balance from `/api/auth/me`.
- Verified users enter the exchange app.
- Identity banner opens a manual KYC upload form backed by the NestJS API.
- Admin KYC review endpoints can approve or reject submissions and update user limits/status.
- Wallet page shows BNB Smart Chain BEP20 as the first deposit network and uses the backend-assigned deposit address.
- The backend deposit scanner detects BEP20 USDT transfers, credits `pending_deposit`, then moves funds to `available_balance` after 15 confirmations.

## Frontend Structure

- `app.js` starts the browser app.
- `scripts/config.js` stores frontend constants and route/network settings.
- `scripts/state.js` owns browser session and local account cache.
- `scripts/api.js` owns backend HTTP requests.
- `scripts/ui.js` owns shared DOM references, toast messages, and form errors.
- `scripts/wallet-service.js` owns wallet-address sync and copy behavior.
- `scripts/profile-service.js` owns backend session/profile hydration.
- `scripts/header.js` owns top navigation and account menu rendering.
- `scripts/pages/` contains route-level UI screens.
- `scripts/router.js` maps hash routes to page renderers.

## Limits

- Unverified: 1,000 USDT.
- Verified: 5,000 USDT.
- Merchant: up to 100,000 USDT.

## Signed-In Pages

- Dashboard
- Market
- My Ads
- Trades
- Wallet

## Launch Requirements

Before real users or funds are allowed, BRX needs:

- NestJS/Fastify backend API with server-side auth, sessions, password hashing, rate limiting, and email verification.
- PostgreSQL ledger with atomic balance updates.
- Redis queues for email, deposit scanning, and withdrawal processing.
- Resend domain, sender email, API key, and email templates.
- Alchemy BNB Smart Chain RPC configured in backend secrets.
- BEP20 USDT deposit address generation and monitoring.
- Secure key management for withdrawal signing.
- Admin panel for KYC, users, disputes, deposits, withdrawals, and audit logs.
- Placeholder legal documents replaced with reviewed Terms, Privacy Policy, escrow rules, risk disclosure, and KYC policy.
- Production domain `brxp2p.com`, support email, admin emails, and monitoring/alerting.

## Sensitive Configuration

Do not put secrets in frontend code. Use backend environment variables:

- `ALCHEMY_BNB_RPC_URL`
- `BSC_LOG_BLOCK_RANGE`
- `BSC_SCAN_LOOKBACK_BLOCKS`
- `RESEND_API_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_CALLBACK_URL`
- `DATABASE_URL`
- `REDIS_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `ENCRYPTION_KEY`

See `backend/.env.example`.

For local testing only, `backend/.env` can contain your Alchemy BNB endpoint. That file is ignored by git.

## Backend Planning Files

- `schema.sql` contains PostgreSQL table design.
- `ARCHITECTURE.md` contains wallet, escrow, deposit listener, withdrawal, admin, and security flow notes.
- `backend/README.md` describes the NestJS module plan.
- `LEGAL_PLACEHOLDERS.md` contains legal-document placeholders.
