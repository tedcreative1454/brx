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
  const migrations = (await readdir(migrationsDir).catch(() => []))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const migration of migrations) {
    const migrationSql = await readFile(resolve(migrationsDir, migration), "utf8");
    await client.query(migrationSql.replace(/^\uFEFF/, ""));
    console.log(`Applied migration ${migration}.`);
  }

  console.log("BRX schema is up to date.");
} finally {
  await client.end();
}

