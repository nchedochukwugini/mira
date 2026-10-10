import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required to run database migrations.");
const pool = new Pool({ connectionString: url, ssl: url.includes("neon.tech") ? { rejectUnauthorized: false } : undefined });
async function migrate() {
  try {
    const client = await pool.connect();
    try {
      await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
      const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "migrations");
      const migrations = (await readdir(migrationsDir)).filter((name) => /^\d+_[\w-]+\.sql$/.test(name)).sort();
      for (const name of migrations) {
        const result = await client.query("SELECT 1 FROM schema_migrations WHERE name=$1", [name]);
        if (result.rowCount) continue;
        await client.query("BEGIN");
        try { await client.query(await readFile(join(migrationsDir, name), "utf8")); await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]); await client.query("COMMIT"); }
        catch (error) { await client.query("ROLLBACK"); throw error; }
      }
    } finally { client.release(); }
  } finally { await pool.end(); }
}
migrate().catch((error) => {
  console.error(error instanceof Error ? error.message : "Migration failed.");
  process.exitCode = 1;
});
