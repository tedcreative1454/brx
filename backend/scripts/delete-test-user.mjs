import "dotenv/config";
import { Pool } from "pg";

const email = process.argv[2]?.trim().toLowerCase();

if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
  console.error("Usage: npm run user:delete -- user@example.com");
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to delete users while NODE_ENV=production.");
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is missing.");
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });
const client = await pool.connect();

try {
  await client.query("BEGIN");

  const user = await client.query("SELECT id, email FROM users WHERE email = $1 LIMIT 1", [email]);
  if (user.rowCount === 0) {
    await client.query("ROLLBACK");
    console.log(`No database user found for ${email}.`);
    process.exit(0);
  }

  const userId = user.rows[0].id;
  const tables = [
    "email_verification_codes",
    "wallet_accounts",
    "balances",
    "ledger_entries",
    "deposits",
    "withdrawals",
    "kyc_submissions",
    "offers",
  ];

  for (const table of tables) {
    await client.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId]);
  }

  await client.query("DELETE FROM users WHERE id = $1", [userId]);
  await client.query("COMMIT");
  console.log(`Deleted local test user ${email}.`);
} catch (error) {
  await client.query("ROLLBACK");
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
