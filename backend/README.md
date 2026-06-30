# BRX Backend

Backend target stack: NestJS + Fastify + PostgreSQL + Redis.

The backend owns all sensitive work:

- Auth, sessions, password hashing, email verification, and 2FA.
- User balances and immutable ledger entries.
- P2P offers, trades, escrow locking, release, cancellation, and disputes.
- Manual KYC review workflow.
- BNB Smart Chain BEP20 deposit monitoring through Alchemy.
- Withdrawal request review and signing flow.

## Local Config

Copy `.env.example` to `.env` when the backend is created. Put the full Alchemy BNB endpoint in `ALCHEMY_BNB_RPC_URL` locally or in production secrets.

Do not put Alchemy keys, Resend keys, JWT secrets, or withdrawal private keys in frontend files.

## Run Locally

From the project root:

```bash
docker compose up -d
```

Then from `backend/`:

```bash
npm install
npm run migrate
npm run start:dev
```

Useful endpoints:

- `GET http://localhost:3000/api/health`
- `POST http://localhost:3000/api/wallets/local-user` with `{ "email": "you@example.com" }`
- `POST http://localhost:3000/api/wallets/:userId/deposit-address`
- `POST http://localhost:3000/api/deposits/scan`
- `POST http://localhost:3000/api/kyc/submissions`
- `GET http://localhost:3000/api/kyc/submissions/me`
- `GET http://localhost:3000/api/admin/kyc/submissions`
- `POST http://localhost:3000/api/admin/kyc/submissions/:id/approve`
- `POST http://localhost:3000/api/admin/kyc/submissions/:id/reject`

Useful commands:

- `npm run scan:deposits` scans assigned BEP20 wallets through Alchemy.
- New deposits are credited to `pending_deposit`.
- After `BSC_CONFIRMATIONS_REQUIRED` confirmations, the ledger moves funds from `pending_deposit` to `available_balance`.
- On Alchemy Free, keep `BSC_LOG_BLOCK_RANGE=10`.
- `npm run user:admin -- user@example.com` promotes a local verified user to admin for KYC review testing.

## First Backend Modules

1. `auth` - signup, login, email verification, password reset.
2. `users` - profiles, KYC status, account tiers.
3. `wallets` - BEP20 deposit addresses, deposits, withdrawals.
4. `ledger` - transactional balance movements and audit trail.
5. `market` - buy/sell offers and payment methods.
6. `trades` - escrow lifecycle and disputes.
7. `admin` - KYC, disputes, withdrawals, users, audit logs.
8. `jobs` - Redis queues for email, deposit scanning, and withdrawals.

## Account Limits

- Unverified: 1,000 USDT.
- Verified: 5,000 USDT.
- Merchant: up to 100,000 USDT.
