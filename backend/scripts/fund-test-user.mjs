import "dotenv/config";
import crypto from "node:crypto";
import { Pool } from "pg";

const email = process.argv[2]?.trim().toLowerCase();
const amount = process.argv[3]?.trim();

if (!email || !/^\S+@\S+\.\S+$/.test(email) || !amount || Number(amount) <= 0) {
  console.error("Usage: npm run user:fund -- user@example.com 100");
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to fund test users while NODE_ENV=production.");
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required in backend/.env.");
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });
const client = await pool.connect();

try {
  await client.query("BEGIN");

  const userResult = await client.query(
    "SELECT id, email FROM users WHERE email = $1 LIMIT 1",
    [email],
  );

  if (userResult.rowCount === 0) {
    await client.query("ROLLBACK");
    console.log(`No database user found for ${email}.`);
    process.exit(0);
  }

  const user = userResult.rows[0];
  const referenceId = crypto.randomUUID();
  const idempotencyKey = `local-test-fund:${user.id}:${referenceId}`;

  await client.query(
    `INSERT INTO balances (user_id, asset)
     VALUES ($1, 'USDT')
     ON CONFLICT (user_id, asset) DO NOTHING`,
    [user.id],
  );

  await client.query(
    `INSERT INTO ledger_entries
      (user_id, asset, balance_type, amount, direction, reason, reference_type, reference_id, idempotency_key)
     VALUES
      ($1, 'USDT', 'available', $2, 'credit', 'local_test_funding', 'manual_test_fund', $3, $4)`,
    [
      user.id,
      amount,
      referenceId,
      idempotencyKey,
    ],
  );

  const balanceResult = await client.query(
    `UPDATE balances
     SET available_balance = available_balance + $1::numeric,
         updated_at = now()
     WHERE user_id = $2 AND asset = 'USDT'
     RETURNING available_balance, locked_balance, pending_deposit, pending_withdrawal`,
    [amount, user.id],
  );

  await client.query("COMMIT");

  const balance = balanceResult.rows[0];
  console.log(`Credited ${amount} fake USDT to ${user.email} for local testing.`);
  console.log(`Available: ${balance.available_balance} USDT`);
  console.log(`Locked: ${balance.locked_balance} USDT`);
} catch (error) {
  await client.query("ROLLBACK");
  console.error(error);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
