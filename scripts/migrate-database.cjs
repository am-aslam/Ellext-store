const fs = require('node:fs');
const path = require('node:path');
const { loadEnvConfig } = require('@next/env');
const Database = require('better-sqlite3');
const { Client } = require('pg');

// Match Next.js development precedence so `npm run db:migrate` uses
// .env.development.local when setting up the local Supabase stack.
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');

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
    CREATE TABLE IF NOT EXISTS dashboard_shared_state (storage_key TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
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
  const databaseHost = new URL(connectionString).hostname;
  const ssl = ['localhost', '127.0.0.1', '::1'].includes(databaseHost) ? false : { rejectUnauthorized: false };
  const client = new Client({ connectionString, ssl, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('CREATE TABLE IF NOT EXISTS public.schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    await client.query("INSERT INTO public.schema_migrations(version) VALUES ('001_dashboard_schema') ON CONFLICT DO NOTHING");

    // Copy existing SQLite business data without replacing rows already in
    // Supabase. SQLite remains intact as the local fallback/backup store.
    const transfers = [
      ['currency_rows', 'SELECT id,row_date,image,description,category,usd,product_count,active,updated_at FROM currency_rows',
        'INSERT INTO public.currency_rows(id,row_date,image,description,category,usd,product_count,active,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING',
        row => [row.id,row.row_date,row.image,row.description,row.category,row.usd,row.product_count,Boolean(row.active),row.updated_at]],
      ['product_increases', 'SELECT source_id,selling_price_inr,locked,updated_at FROM product_increases',
        'INSERT INTO public.product_increases(source_id,selling_price_inr,locked,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(source_id) DO NOTHING',
        row => [row.source_id,row.selling_price_inr,Boolean(row.locked),row.updated_at]],
      ['selling_entries', 'SELECT source_id,sold_count,unit_expense,updated_at FROM selling_entries',
        'INSERT INTO public.selling_entries(source_id,sold_count,unit_expense_inr,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(source_id) DO NOTHING',
        row => [row.source_id,row.sold_count,row.unit_expense,row.updated_at]],
      ['product_requests', 'SELECT id,name,category,notes,status,created_at FROM product_requests',
        'INSERT INTO public.product_requests(id,name,category,notes,status,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING',
        row => [row.id,row.name,row.category,row.notes,row.status,row.created_at]],
      ['member_invitations', 'SELECT email,name,status,created_at FROM member_invitations',
        'INSERT INTO public.member_invitations(email,name,status,created_at) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING',
        row => [row.email,row.name,row.status,row.created_at]],
      ['product_categories', 'SELECT name,created_at FROM product_categories',
        'INSERT INTO public.product_categories(name,created_at) VALUES($1,$2) ON CONFLICT(name) DO NOTHING',
        row => [row.name,row.created_at]],
      ['company_expenses', 'SELECT id,amount_inr,note,expense_date FROM company_expenses',
        "INSERT INTO public.company_expenses(id,amount_inr,category,note,expense_date) VALUES($1,$2,'Other',$3,$4) ON CONFLICT(id) DO NOTHING",
        row => [row.id,row.amount_inr,row.note,row.expense_date]],
      ['expense_ledger', 'SELECT id,amount_inr,category,note,expense_date,created_by FROM expense_ledger',
        'INSERT INTO public.expense_ledger(id,amount_inr,category,note,expense_date,created_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING',
        row => [row.id,row.amount_inr,row.category,row.note,row.expense_date,row.created_by]],
    ];
    let copiedRows = 0;
    for (const [table, selectSql, insertSql, valuesForRow] of transfers) {
      for (const row of sqlite.prepare(selectSql).all()) {
        const result = await client.query(insertSql, valuesForRow(row));
        copiedRows += result.rowCount || 0;
      }
    }
    const localCurrencyRows = sqlite.prepare('SELECT id,row_date,image,description,category,usd,product_count,active FROM currency_rows ORDER BY row_date DESC').all().map(row => ({ id: row.id, date: row.row_date, image: row.image, description: row.description, usd: Number(row.usd), productCount: Number(row.product_count), active: Boolean(row.active), category: row.category }));
    const localIncreases = sqlite.prepare('SELECT source_id,selling_price_inr,locked,updated_at FROM product_increases').all().map(row => ({ sourceId: row.source_id, increaseInr: Number(row.selling_price_inr), locked: Boolean(row.locked), updatedAt: row.updated_at }));
    const localSales = sqlite.prepare('SELECT source_id,sold_count,unit_expense,updated_at FROM selling_entries').all().map(row => ({ sourceId: row.source_id, soldCount: Number(row.sold_count), unitExpense: Number(row.unit_expense), updatedAt: row.updated_at }));
    const localCategories = Array.from(new Set(localCurrencyRows.map(row => row.category).filter(category => category && !['Ring','Bangle','Chain','Ear ring'].includes(category))));
    const stateSeeds = [
      ['ellextstore:v1:currency-rows', localCurrencyRows],
      ['ellextstore:v1:product-increases', localIncreases],
      ['ellextstore:v1:selling-entries', localSales],
      ['ellextstore:v1:product-categories', localCategories],
    ];
    for (const [key, value] of stateSeeds) {
      if (value.length) {
        const result = await client.query('INSERT INTO public.dashboard_shared_state(storage_key,payload,updated_at) VALUES($1,$2::jsonb,now()) ON CONFLICT(storage_key) DO NOTHING', [key, JSON.stringify(value)]);
        copiedRows += result.rowCount || 0;
      }
    }
    await client.query('COMMIT');
    const tables = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('currency_rows','product_increases','selling_entries','product_requests','member_invitations','product_categories','company_expenses','expense_ledger','dashboard_snapshots','dashboard_shared_state') ORDER BY table_name`);

    const existing = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('currency_rows','product_increases','selling_entries','product_requests','member_invitations','product_categories','company_expenses','expense_ledger','dashboard_snapshots','dashboard_shared_state') ORDER BY name").all();
    console.log(`Supabase schema ready (${tables.rows.length} tables). SQLite mirror ready (${existing.length} tables).`);
    console.log(`Copied ${copiedRows} existing SQLite business rows into Supabase without overwriting existing Supabase rows.`);
    console.log('SQLite auth records remain local; browser localStorage data is not part of this database migration.');
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
