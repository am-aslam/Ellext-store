const fs = require('node:fs');
const path = require('node:path');
const { loadEnvConfig } = require('@next/env');
const Database = require('better-sqlite3');
const { Client } = require('pg');

loadEnvConfig(process.cwd());

async function main() {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) throw new Error('SUPABASE_DB_URL is missing from the environment.');

  const directory = process.env.ELLEXTSTORE_DB_DIR?.trim() || path.join(process.cwd(), 'data');
  fs.mkdirSync(directory, { recursive: true });
  const sqlite = new Database(path.join(directory, 'ellextstore.sqlite'));
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS currency_rows (id TEXT PRIMARY KEY, row_date TEXT NOT NULL, image TEXT NOT NULL DEFAULT '', description TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'Ring', usd REAL NOT NULL CHECK(usd >= 0), product_count INTEGER NOT NULL CHECK(product_count >= 0), active INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS product_increases (source_id TEXT PRIMARY KEY REFERENCES currency_rows(id) ON DELETE CASCADE, selling_price_inr REAL NOT NULL CHECK(selling_price_inr >= 0), locked INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS selling_entries (source_id TEXT PRIMARY KEY REFERENCES currency_rows(id) ON DELETE CASCADE, sold_count INTEGER NOT NULL DEFAULT 0 CHECK(sold_count >= 0), unit_expense REAL NOT NULL DEFAULT 0 CHECK(unit_expense >= 0), updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS product_requests (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Submitted' CHECK(status IN ('Submitted','Under review','Fulfilled')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS member_invitations (email TEXT PRIMARY KEY COLLATE NOCASE, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Accepted','Expired')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS product_categories (name TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS company_expenses (id TEXT PRIMARY KEY, amount_inr REAL NOT NULL CHECK(amount_inr > 0), note TEXT NOT NULL, expense_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS expense_ledger (id TEXT PRIMARY KEY, amount_inr REAL NOT NULL CHECK(amount_inr > 0), category TEXT NOT NULL DEFAULT 'Other', note TEXT NOT NULL, expense_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, created_by TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS dashboard_snapshots (user_id TEXT NOT NULL, storage_key TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id,storage_key));
    CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  `);
  if (!sqlite.prepare('PRAGMA table_info(currency_rows)').all().some((column) => column.name === 'category')) {
    sqlite.exec("ALTER TABLE currency_rows ADD COLUMN category TEXT NOT NULL DEFAULT 'Ring'");
  }
  if (!sqlite.prepare('PRAGMA table_info(selling_entries)').all().some((column) => column.name === 'unit_expense')) {
    sqlite.exec('ALTER TABLE selling_entries ADD COLUMN unit_expense REAL NOT NULL DEFAULT 0');
  }
  if (!sqlite.prepare('PRAGMA table_info(expense_ledger)').all().some((column) => column.name === 'created_by')) {
    sqlite.exec("ALTER TABLE expense_ledger ADD COLUMN created_by TEXT NOT NULL DEFAULT ''");
  }
  sqlite.prepare("INSERT OR IGNORE INTO schema_migrations(version) VALUES ('001_dashboard_schema')").run();
  console.log('SQLite fallback schema is ready.');

  const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/001_dashboard_schema.sql'), 'utf8');
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('CREATE TABLE IF NOT EXISTS public.schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    await client.query("INSERT INTO public.schema_migrations(version) VALUES ('001_dashboard_schema') ON CONFLICT DO NOTHING");
    await client.query('COMMIT');
    const tables = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('currency_rows','product_increases','selling_entries','product_requests','member_invitations','product_categories','company_expenses','expense_ledger','dashboard_snapshots') ORDER BY table_name`);

    const existing = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('currency_rows','product_increases','selling_entries','product_requests','member_invitations','product_categories','company_expenses') ORDER BY name").all();
    console.log(`Supabase schema ready (${tables.rows.length} tables). SQLite mirror ready (${existing.length} tables).`);
    console.log('Existing SQLite auth records were preserved; dashboard records were stored in browser localStorage, not in SQLite.');
    sqlite.close();
  } finally {
    if (sqlite.open) sqlite.close();
    await client.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`Database migration failed: ${error.message}`);
  process.exitCode = 1;
});
