# BRX Architecture Notes

## Launch Position

BRX is a real custodial P2P exchange build for `brxp2p.com`. The frontend must never hard-code customer deposit addresses, private keys, balances, or escrow outcomes. All financial state must come from the NestJS backend, PostgreSQL ledger, Redis jobs, and wallet services.

## Core Model

BRX uses a custodial wallet and an internal ledger. The blockchain is used only for USDT BEP20 deposits and withdrawals on BNB Smart Chain. P2P trades do not create blockchain transactions.

## Backend Stack

- API: NestJS on Fastify.
- Database: PostgreSQL.
- Queues/cache: Redis.
- Blockchain RPC: Alchemy BNB Smart Chain endpoint.
- Email: Resend.

## BSC / BEP20 Configuration

- Network: BNB Smart Chain Mainnet.
- Token: USDT BEP20.
- RPC: `ALCHEMY_BNB_RPC_URL` in backend environment only.
- USDT contract: `0x55d398326f99059fF775485246999027B3197955`.
- Required confirmations: 15 blocks.
- Minimum deposit: 1 USDT.
- Alchemy Free limits `eth_getLogs` ranges; local config uses `BSC_LOG_BLOCK_RANGE=10`.

The Alchemy key must not be committed to frontend code or public docs. Rotate the key before launch if it was shared in screenshots or chat.

## Balances

Each user has four USDT balance buckets:

- `available_balance`
- `locked_balance`
- `pending_deposit`
- `pending_withdrawal`

Every balance movement must create immutable ledger entries inside the same database transaction that changes the balance row.

## Account Limits

- Unverified: 1,000 USDT.
- Verified: 5,000 USDT.
- Merchant: up to 100,000 USDT.

## Escrow Flow

1. Seller deposits USDT on BNB Smart Chain BEP20.
2. Deposit listener detects and confirms the deposit through Alchemy RPC.
3. Ledger credits the seller after required confirmations.
4. Seller posts a sell offer.
5. Buyer opens a trade.
6. Escrow locks seller USDT from available to locked.
7. Buyer pays KES outside BRX by M-Pesa or bank.
8. Buyer marks payment sent.
9. Seller confirms payment.
10. Escrow releases locked USDT to buyer available balance.
11. Admin resolves disputes when needed.

## Required Services

- Auth service: server-side signup, login, password hashing, sessions, email verification, password reset, 2FA.
- Email service: Resend verification and security alerts.
- Wallet service: BEP20 deposit address assignment, BSC monitoring, withdrawal request creation, withdrawal queue.
- Ledger service: transactional balance changes, idempotency keys, immutable audit entries.
- Escrow service: lock, release, cancel, dispute settlement, timeout handling.
- Market service: offers, limits, payment methods, trader statistics.
- Admin service: KYC review, disputes, users, deposits, withdrawals, risk flags, audit logs.
- Risk service: rate limits, velocity checks, suspicious account/device/IP flags.

## Deposit Listener

- Watch assigned BEP20 deposit addresses only.
- Scan USDT Transfer logs for the configured BEP20 USDT contract.
- Store detected transactions idempotently by transaction hash and log index.
- Move funds into `pending_deposit` while confirming.
- Credit `available_balance` only after the required confirmations.
- Never credit unsupported assets or unsupported networks automatically.

## Withdrawal Flow

1. User requests withdrawal.
2. Backend validates KYC tier, limits, 2FA, destination address, balance, and risk checks.
3. Ledger moves amount plus fee from available to pending withdrawal.
4. Admin or automated policy approves.
5. Withdrawal worker signs and broadcasts BEP20 USDT transaction.
6. Ledger finalizes or reverses based on broadcast result.

## Security Rules

- No private keys in the browser.
- No Alchemy, Resend, database, JWT, or encryption secrets in the browser.
- No balance math in the browser.
- All balance mutations require database transactions and idempotency keys.
- All admin actions require audit logs.
- Withdrawal signing must use isolated secrets, HSM/KMS, or an external custody provider before significant volume.
- KYC document storage must use private object storage, signed URLs, and strict admin access.
- Production must enforce HTTPS, secure cookies, CSRF protection where needed, rate limits, and monitoring.

## Launch Gates

BRX should not accept deposits until these are complete:

- NestJS backend auth connected.
- Resend email verified and tested.
- PostgreSQL migrations and ledger transaction tests complete.
- Redis queues connected.
- Alchemy BSC endpoint stored in backend secrets.
- BEP20 deposit address generation connected.
- Deposit listener tested with idempotency.
- Ledger reconciliation scripts built.
- Admin KYC/dispute/withdrawal screens built.
- Legal placeholders replaced with reviewed documents.
- Incident response and support process defined.
