import "dotenv/config";
import { Pool } from "pg";

const email = process.argv[2]?.trim().toLowerCase();

if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
  console.error("Usage: npm run user:admin -- user@example.com");
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to promote admins while NODE_ENV=production.");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  const result = await pool.query("UPDATE users SET role = 'admin' WHERE email = $1 RETURNING id, email, role", [email]);
  if (result.rowCount === 0) {
    console.log(`No database user found for ${email}.`);
  } else {
    console.log(`Promoted ${result.rows[0].email} to admin.`);
  }
} finally {
  await pool.end();
}
