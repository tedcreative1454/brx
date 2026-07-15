import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Load backend/.env before running migrations.");
}

const schemaPath = resolve(process.cwd(), "..", "schema.sql");
const sql = (await readFile(schemaPath, "utf8")).replace(/^\uFEFF/, "");
const client = new pg.Client({ connectionString: databaseUrl });

await client.connect();
try {
  const existingSchema = await client.query("SELECT to_regclass('public.users') AS users_table");
  const hasUsersTable = Boolean(existingSchema.rows[0]?.users_table);

  if (!hasUsersTable) {
    await client.query(sql);
    console.log("BRX base schema applied.");
  }

  const migrationsDir = resolve(process.cwd(), "scripts", "migrations");
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
  );
  const appliedResult = await client.query("SELECT name FROM schema_migrations");
  const applied = new Set(appliedResult.rows.map((row) => row.name));
  const migrations = (await readdir(migrationsDir).catch(() => []))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  // BRX deployments created before the ledger already ran migrations 001-018
  // through the previous idempotent runner. Baseline those names so an existing
  // production database never replays older, temporarily narrower constraints.
  if (hasUsersTable && applied.size === 0) {
    const baseline = migrations.filter((file) => {
      const sequence = Number(file.match(/^(\d+)/)?.[1] || 0);
      return sequence > 0 && sequence <= 18;
    });
    for (const migration of baseline) {
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING", [migration]);
      applied.add(migration);
    }
    console.log(`Baselined ${baseline.length} historical migrations for the existing BRX schema.`);
  }

  for (const migration of migrations) {
    if (applied.has(migration)) continue;
    const migrationSql = await readFile(resolve(migrationsDir, migration), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(migrationSql.replace(/^\uFEFF/, ""));
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [migration]);
      await client.query("COMMIT");
      console.log(`Applied migration ${migration}.`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  console.log("BRX schema is up to date.");
} finally {
  await client.end();
}

