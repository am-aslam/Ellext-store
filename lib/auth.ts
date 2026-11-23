import 'server-only';

import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cookies } from 'next/headers';

export type UserRole = 'super_admin' | 'admin';
export type AppUser = { id: string; email: string; name: string; role: UserRole };
export type StorageMode = 'supabase' | 'sqlite';
export const SESSION_COOKIE = 'ellextstore_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

type UserRow = AppUser & { password_hash: string; supabase_user_id: string | null; created_at: string };
type SessionRow = { id: string; email: string; name: string; role: UserRole; expires_at: number };

const globalForDb = globalThis as typeof globalThis & { ellextDb?: Database.Database; ellextExpensePool?: Pool; ellextExpenseSchema?: Promise<boolean>; ellextSharedDashboardSchema?: Promise<boolean> };
function db(): Database.Database {
  if (globalForDb.ellextDb) return globalForDb.ellextDb;
  // Vercel's deployed function bundle is read-only. Keep the SQLite fallback
  // in its writable temp area; local development continues to use ./data.
  const directory = process.env.ELLEXTSTORE_DB_DIR?.trim()
    || (process.env.VERCEL ? path.join(tmpdir(), 'ellextstore') : path.join(process.cwd(), 'data'));
  mkdirSync(directory, { recursive: true });
  const database = new Database(path.join(directory, 'ellextstore.sqlite'));
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('super_admin','admin')),
      password_hash TEXT NOT NULL, supabase_user_id TEXT UNIQUE, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS currency_rows (id TEXT PRIMARY KEY, row_date TEXT NOT NULL, image TEXT NOT NULL DEFAULT '', description TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'Ring', usd REAL NOT NULL CHECK(usd >= 0), product_count INTEGER NOT NULL CHECK(product_count >= 0), active INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS product_increases (source_id TEXT PRIMARY KEY REFERENCES currency_rows(id) ON DELETE CASCADE, selling_price_inr REAL NOT NULL CHECK(selling_price_inr >= 0), locked INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS selling_entries (source_id TEXT PRIMARY KEY REFERENCES currency_rows(id) ON DELETE CASCADE, sold_count INTEGER NOT NULL DEFAULT 0 CHECK(sold_count >= 0), unit_expense REAL NOT NULL DEFAULT 0 CHECK(unit_expense >= 0), updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS company_expenses (id TEXT PRIMARY KEY, amount_inr REAL NOT NULL CHECK(amount_inr > 0), category TEXT NOT NULL DEFAULT 'Other', note TEXT NOT NULL, expense_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS product_requests (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Submitted' CHECK(status IN ('Submitted','Under review','Fulfilled')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS member_invitations (email TEXT PRIMARY KEY COLLATE NOCASE, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Accepted','Expired')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS product_categories (name TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS company_expenses (id TEXT PRIMARY KEY, amount_inr REAL NOT NULL CHECK(amount_inr > 0), note TEXT NOT NULL, expense_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS expense_ledger (id TEXT PRIMARY KEY, amount_inr REAL NOT NULL CHECK(amount_inr > 0), category TEXT NOT NULL DEFAULT 'Other', note TEXT NOT NULL, expense_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, created_by TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS dashboard_snapshots (user_id TEXT NOT NULL, storage_key TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id,storage_key));
    CREATE TABLE IF NOT EXISTS dashboard_shared_state (storage_key TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  `);
  if (!database.prepare('PRAGMA table_info(currency_rows)').all().some(column => (column as { name?: string }).name === 'category')) {
    database.exec("ALTER TABLE currency_rows ADD COLUMN category TEXT NOT NULL DEFAULT 'Ring'");
  }
  if (!database.prepare('PRAGMA table_info(selling_entries)').all().some(column => (column as { name?: string }).name === 'unit_expense')) {
    database.exec('ALTER TABLE selling_entries ADD COLUMN unit_expense REAL NOT NULL DEFAULT 0');
  }
  if (!database.prepare('PRAGMA table_info(expense_ledger)').all().some(column => (column as { name?: string }).name === 'created_by')) {
    database.exec("ALTER TABLE expense_ledger ADD COLUMN created_by TEXT NOT NULL DEFAULT ''");
  }
  globalForDb.ellextDb = database;
  return database;
}

function supabaseUrl() { return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || ''; }
function anonKey() { return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || ''; }
function adminKey() { return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || ''; }
function getSupabase(): SupabaseClient | null {
  if (!supabaseUrl() || !anonKey()) return null;
  return createClient(supabaseUrl(), anonKey(), { auth: { autoRefreshToken: false, persistSession: false } });
}
function getSupabaseAdmin(): SupabaseClient | null {
  if (!supabaseUrl() || !adminKey()) return null;
  return createClient(supabaseUrl(), adminKey(), { auth: { autoRefreshToken: false, persistSession: false } });
}

export function isSupabaseConfigured() { return Boolean(supabaseUrl() && anonKey() && adminKey()); }
export async function getStorageMode(): Promise<StorageMode> {
  if (!isSupabaseConfigured()) return 'sqlite';
  try {
    const response = await fetch(`${supabaseUrl().replace(/\/$/, '')}/auth/v1/health`, {
      headers: { apikey: anonKey() }, cache: 'no-store', signal: AbortSignal.timeout(1800),
    });
    return response.ok ? 'supabase' : 'sqlite';
  } catch { return 'sqlite'; }
}
async function getCompanyDataStorageMode(): Promise<StorageMode> {
  // Shared company data depends on the Data API, not Auth health. An Auth
  // outage must not silently divert locally running users from healthy shared
  // storage into a separate SQLite database.
  if (isSupabaseConfigured()) {
    try {
      const response = await fetch(`${supabaseUrl().replace(/\/$/, '')}/rest/v1/`, {
        headers: { apikey: adminKey(), Authorization: `Bearer ${adminKey()}` },
        cache: 'no-store', signal: AbortSignal.timeout(1800),
      });
      if (response.ok) return 'supabase';
    } catch { /* The local SQLite fallback is allowed only outside Vercel. */ }
  }
  if (process.env.VERCEL) {
    throw new Error('Shared Supabase storage is unavailable. This Vercel deployment cannot use SQLite as shared storage; check the Supabase URL, service role key, and Data API connectivity.');
  }
  return 'sqlite';
}
async function listSupabaseUsers(): Promise<AppUser[]> {
  const client = getSupabaseAdmin();
  if (!client) return [];
  const users: AppUser[] = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    users.push(...data.users.flatMap((user) => {
      const role = user.app_metadata?.role;
      if (role !== 'admin' && role !== 'super_admin') return [];
      return [{ id: user.id, email: user.email || '', name: user.user_metadata?.name || user.email || 'User', role }];
    }));
    if (data.users.length < 1000) return users;
  }
}
export async function hasSuperAdmin() {
  if (getSupabaseAdmin()) return (await listSupabaseUsers()).some((user) => user.role === 'super_admin');
  return Boolean(db().prepare("SELECT 1 FROM users WHERE role='super_admin' LIMIT 1").get());
}
export async function listAdmins(): Promise<AppUser[]> {
  if (getSupabaseAdmin()) return (await listSupabaseUsers()).filter((user) => user.role === 'admin');
  return db().prepare("SELECT id,email,name,role FROM users WHERE role='admin' ORDER BY created_at DESC").all() as AppUser[];
}

async function createRemoteUser(email: string, password: string, name: string, role: UserRole): Promise<AppUser | null> {
  const client = getSupabaseAdmin();
  if (!client) return null;
  const { data, error } = await client.auth.admin.createUser({
    email, password, email_confirm: true,
    app_metadata: { role }, user_metadata: { name },
  });
  if (error) throw new Error(error.message);
  return { id: data.user.id, email: data.user.email || email, name, role };
}

function insertUser(email: string, name: string, role: UserRole, password: string, supabaseUserId: string | null): AppUser {
  const user: AppUser = { id: randomUUID(), email: email.trim().toLowerCase(), name: name.trim(), role };
  db().prepare(`INSERT INTO users(id,email,name,role,password_hash,supabase_user_id,created_at)
    VALUES(@id,@email,@name,@role,@passwordHash,@supabaseUserId,@createdAt)`).run({
    ...user, passwordHash: bcrypt.hashSync(password, 12), supabaseUserId, createdAt: new Date().toISOString(),
  });
  return user;
}

export async function createFirstSuperAdmin(email: string, name: string, password: string) {
  if (await hasSuperAdmin()) throw new Error('Super Admin setup is already complete. Sign in instead.');
  const remoteUser = await createRemoteUser(email, password, name, 'super_admin');
  if (remoteUser) return remoteUser;
  if (process.env.VERCEL) throw new Error('Configure Supabase before creating dashboard accounts on Vercel.');
  return insertUser(email, name, 'super_admin', password, null);
}

export async function createAdmin(email: string, name: string, password: string) {
  const remoteUser = await createRemoteUser(email, password, name, 'admin');
  if (remoteUser) return remoteUser;
  if (process.env.VERCEL) throw new Error('Configure Supabase before creating dashboard accounts on Vercel.');
  return insertUser(email, name, 'admin', password, null);
}

export function generateTemporaryPassword() { return `${randomBytes(12).toString('base64url')}A9!`; }

export async function signIn(email: string, password: string): Promise<{ user: AppUser; mode: StorageMode }> {
  const normalizedEmail = email.trim().toLowerCase();
  const remote = getSupabase();
  if (remote) {
    try {
      const { data, error } = await remote.auth.signInWithPassword({ email: normalizedEmail, password });
      if (!error && data.user && data.session) {
        const role = data.user.app_metadata?.role;
        if (role !== 'admin' && role !== 'super_admin') throw new Error('This account does not have dashboard access. Ask the Super Admin to create an Admin account.');
        const user: AppUser = { id: data.user.id, email: data.user.email || normalizedEmail, name: data.user.user_metadata?.name || data.user.email || normalizedEmail, role };
        setSignedSession(user);
        return { user, mode: 'supabase' };
      }
      if (process.env.VERCEL) throw new Error(error?.message || 'Unable to sign in.');
    } catch (error) {
      if (process.env.VERCEL) throw error;
    }
  }
  const row = db().prepare('SELECT * FROM users WHERE email=?').get(normalizedEmail) as UserRow | undefined;
  if (!row || !bcrypt.compareSync(password, row.password_hash)) throw new Error('Email or password is incorrect.');
  const rawToken = randomBytes(32).toString('base64url');
  db().prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  db().prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)')
    .run(hashToken(rawToken), row.id, Date.now() + SESSION_MAX_AGE * 1000, new Date().toISOString());
  cookies().set(SESSION_COOKIE, rawToken, sessionCookieOptions());
  return { user: { id: row.id, email: row.email, name: row.name, role: row.role }, mode: 'sqlite' };
}

function hashToken(value: string) { return createHash('sha256').update(value).digest('hex'); }
function sessionCookieOptions() { return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge: SESSION_MAX_AGE }; }
function sessionSigningKey() { return process.env.ELLEXTSTORE_SESSION_SECRET || adminKey(); }
function signedSession(payload: string) { return createHmac('sha256', sessionSigningKey()).update(payload).digest('base64url'); }
function setSignedSession(user: AppUser) {
  const payload = Buffer.from(JSON.stringify({ ...user, exp: Date.now() + SESSION_MAX_AGE * 1000 })).toString('base64url');
  cookies().set(SESSION_COOKIE, `v1.${payload}.${signedSession(payload)}`, sessionCookieOptions());
}
export async function getCurrentUser(): Promise<AppUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  if (token.startsWith('v1.')) {
    const [, payload, signature] = token.split('.');
    if (!payload || !signature || !sessionSigningKey()) return null;
    const expected = Buffer.from(signedSession(payload));
    const provided = Buffer.from(signature);
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
    try {
      const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AppUser & { exp?: number };
      if (session.exp && session.exp > Date.now() && (session.role === 'admin' || session.role === 'super_admin')) {
        return { id: session.id, email: session.email, name: session.name, role: session.role };
      }
    } catch { return null; }
    return null;
  }
  const row = db().prepare(`SELECT u.id,u.email,u.name,u.role,s.expires_at FROM sessions s
    JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`).get(hashToken(token)) as SessionRow | undefined;
  if (!row || row.expires_at <= Date.now()) {
    if (row) db().prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));
    return null;
  }
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}
export function clearSession(token: string | undefined) {
  if (token && !token.startsWith('v1.')) db().prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));
  cookies().delete(SESSION_COOKIE);
}
export function getAuthDataStore() { return db(); }

async function ensureSharedDashboardTable(pool: Pool): Promise<boolean> {
  if (!globalForDb.ellextSharedDashboardSchema) {
    globalForDb.ellextSharedDashboardSchema = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS public.dashboard_shared_state (
        storage_key text PRIMARY KEY CHECK (storage_key IN (
          'ellextstore:v1:currency-rows', 'ellextstore:v1:currency-rate',
          'ellextstore:v1:product-increases', 'ellextstore:v1:selling-entries',
          'ellextstore:v1:product-categories'
        )),
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
      await pool.query('ALTER TABLE public.dashboard_shared_state ENABLE ROW LEVEL SECURITY');
      await pool.query('REVOKE ALL ON public.dashboard_shared_state FROM anon, authenticated');
      await pool.query('GRANT ALL ON public.dashboard_shared_state TO service_role');
      await pool.query("NOTIFY pgrst, 'reload schema'");
      return true;
    })().catch(() => false);
  }
  const ready = await globalForDb.ellextSharedDashboardSchema;
  if (!ready) globalForDb.ellextSharedDashboardSchema = undefined;
  return ready;
}

function readLocalSharedDashboardValue(storageKey: string): unknown | null {
  const record = db().prepare('SELECT payload FROM dashboard_shared_state WHERE storage_key=?').get(storageKey) as { payload: string } | undefined;
  if (!record) return null;
  try { return JSON.parse(record.payload) as unknown; }
  catch { db().prepare('DELETE FROM dashboard_shared_state WHERE storage_key=?').run(storageKey); return null; }
}

function sharedDashboardApiError(action: string, error: { message: string; code?: string }): Error {
  if (error.code === 'PGRST205' || /could not find the table.*dashboard_shared_state|dashboard_shared_state.*schema cache/i.test(error.message)) {
    return new Error(`Supabase is missing public.dashboard_shared_state. Automatic table creation needs a working SUPABASE_DB_URL; otherwise apply supabase/migrations/001_dashboard_schema.sql in the Supabase SQL Editor and refresh the API schema cache.`);
  }
  return new Error(`Unable to ${action} shared dashboard data: ${error.message}`);
}

export type SupabaseDiagnostics = {
  auth: 'connected' | 'failed' | 'not_configured';
  restApi: 'connected' | 'failed' | 'not_configured';
  database: 'connected' | 'failed' | 'not_configured';
  schema: 'ready' | 'missing' | 'unavailable' | 'not_configured';
  sharedTable: 'available' | 'missing' | 'unavailable' | 'not_configured';
  permissions: 'valid' | 'failed' | 'unknown' | 'not_configured';
  error?: string;
};

function safeConnectionError(error: unknown): string {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const candidate = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string' && /^[A-Z0-9_]+$/.test(candidate.code)) return candidate.code;
    current = candidate.cause;
  }
  return 'Connection failed';
}

export async function getSupabaseDiagnostics(): Promise<SupabaseDiagnostics> {
  if (!isSupabaseConfigured()) return {
    auth: 'not_configured', restApi: 'not_configured', database: 'not_configured',
    schema: 'not_configured', sharedTable: 'not_configured', permissions: 'not_configured',
    error: 'Supabase URL, public key, or server service role key is not configured.',
  };

  const root = supabaseUrl().replace(/\/$/, '');
  const result: SupabaseDiagnostics = {
    auth: 'failed', restApi: 'failed', database: 'not_configured',
    schema: 'unavailable', sharedTable: 'unavailable', permissions: 'unknown',
  };
  const authRequest = fetch(`${root}/auth/v1/health`, {
    headers: { apikey: anonKey() }, cache: 'no-store', signal: AbortSignal.timeout(2500),
  }).then(response => { result.auth = response.ok ? 'connected' : 'failed'; })
    .catch(error => { result.auth = 'failed'; result.error ||= `Auth: ${safeConnectionError(error)}`; });
  const restRequest = fetch(`${root}/rest/v1/`, {
    headers: { apikey: adminKey(), Authorization: `Bearer ${adminKey()}` },
    cache: 'no-store', signal: AbortSignal.timeout(2500),
  }).then(response => { result.restApi = response.ok ? 'connected' : 'failed'; })
    .catch(error => { result.restApi = 'failed'; result.error ||= `REST API: ${safeConnectionError(error)}`; });
  const databaseRequest = (async () => {
    try {
      const pool = expensePool();
      if (!pool) return;
      const connection = await pool.query('SELECT 1 AS connected');
      if (connection.rows[0]?.connected === 1) result.database = 'connected';
      const inspection = await pool.query(`SELECT to_regclass('public.dashboard_shared_state') AS table_name`);
      if (!inspection.rows[0]?.table_name) {
        result.schema = 'missing'; result.sharedTable = 'missing'; result.permissions = 'unknown';
      } else {
        result.schema = 'ready';
        const access = await pool.query(`SELECT
          has_table_privilege('service_role', 'public.dashboard_shared_state', 'SELECT')
          AND has_table_privilege('service_role', 'public.dashboard_shared_state', 'INSERT')
          AND has_table_privilege('service_role', 'public.dashboard_shared_state', 'UPDATE')
          AND has_table_privilege('service_role', 'public.dashboard_shared_state', 'DELETE') AS allowed`);
        result.permissions = access.rows[0]?.allowed ? 'valid' : 'failed';
        if (result.permissions === 'valid') result.sharedTable = 'available';
      }
    } catch (error) {
      result.database = 'failed'; result.error ||= `PostgreSQL: ${safeConnectionError(error)}`;
    }
  })();
  await Promise.all([authRequest, restRequest, databaseRequest]);

  // Check PostgREST independently: the service-role grant is what the server
  // routes use, while anonymous/authenticated browser roles remain revoked.
  const client = getSupabaseAdmin();
  if (!client) result.permissions = 'unknown';
  else {
    const { error } = await client.from('dashboard_shared_state').select('storage_key').limit(0);
    if (!error) {
      if (result.schema === 'unavailable') result.schema = 'ready';
      result.sharedTable = 'available';
      if (result.permissions === 'unknown') result.permissions = 'valid';
    } else if (error.code === 'PGRST205' || /could not find the table.*dashboard_shared_state|dashboard_shared_state.*schema cache/i.test(error.message)) {
      result.schema = 'missing'; result.sharedTable = 'missing';
      result.error ||= 'Supabase does not expose public.dashboard_shared_state to PostgREST. Apply the dashboard schema migration and reload the API schema cache.';
    } else if (error.code === '42501' || /permission denied|not allowed/i.test(error.message)) {
      result.schema = 'ready'; result.sharedTable = 'unavailable'; result.permissions = 'failed';
      result.error ||= 'The service role cannot read public.dashboard_shared_state. Check the migration grants.';
    } else if (result.error === undefined) {
      result.error = `PostgREST table check: ${error.code || 'request failed'}`;
    }
  }
  return result;
}

export async function checkSharedDashboardTable(): Promise<{ ready: boolean; error?: string }> {
  const diagnostics = await getSupabaseDiagnostics();
  if (diagnostics.sharedTable === 'available' && diagnostics.permissions === 'valid') return { ready: true };
  if (diagnostics.error) return { ready: false, error: diagnostics.error };
  return { ready: false, error: 'Supabase shared dashboard table is unavailable or its permissions could not be verified.' };
}

export async function readSharedDashboardValue(storageKey: string): Promise<unknown | null> {
  if (await getCompanyDataStorageMode() === 'supabase') {
    const pool = expensePool();
    if (pool && await ensureSharedDashboardTable(pool)) {
      try {
        const { rows } = await pool.query('SELECT payload FROM public.dashboard_shared_state WHERE storage_key=$1 LIMIT 1', [storageKey]);
        if (rows[0]) return rows[0].payload as unknown;
        if (process.env.VERCEL) return null;
        return readLocalSharedDashboardValue(storageKey);
      } catch { /* Try the Supabase Data API below. */ }
    }
    const client = getSupabaseAdmin();
    if (!client) throw new Error('Supabase service key is not configured.');
    const { data, error } = await client.from('dashboard_shared_state').select('payload').eq('storage_key', storageKey).maybeSingle();
    if (error) throw sharedDashboardApiError('load', error);
    if (data) return data.payload;
    // Supabase is the source of truth in production. Ignore per-instance
    // SQLite snapshots there, since they may belong to a different function.
    if (process.env.VERCEL) return null;
  }
  return readLocalSharedDashboardValue(storageKey);
}

export async function writeSharedDashboardValue(storageKey: string, payload: unknown): Promise<void> {
  const serialized = JSON.stringify(payload);
  if (await getCompanyDataStorageMode() === 'supabase') {
    const pool = expensePool();
    if (pool && await ensureSharedDashboardTable(pool)) {
      try {
        await pool.query(`INSERT INTO public.dashboard_shared_state(storage_key,payload,updated_at) VALUES($1,$2::jsonb,now())
          ON CONFLICT(storage_key) DO UPDATE SET payload=EXCLUDED.payload,updated_at=EXCLUDED.updated_at`, [storageKey, serialized]);
        if (process.env.VERCEL) return;
        db().prepare(`INSERT INTO dashboard_shared_state(storage_key,payload,updated_at) VALUES(?,?,?)
          ON CONFLICT(storage_key) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at`).run(storageKey, serialized, new Date().toISOString());
        return;
      } catch { /* Try the Supabase Data API below. */ }
    }
    const client = getSupabaseAdmin();
    if (!client) throw new Error('Supabase service key is not configured.');
    const { error } = await client.from('dashboard_shared_state').upsert({ storage_key: storageKey, payload, updated_at: new Date().toISOString() }, { onConflict: 'storage_key' });
    if (error) throw sharedDashboardApiError('save', error);
    if (process.env.VERCEL) return;
  }
  db().prepare(`INSERT INTO dashboard_shared_state(storage_key,payload,updated_at) VALUES(?,?,?)
    ON CONFLICT(storage_key) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at`).run(storageKey, serialized, new Date().toISOString());
}


export type LedgerRecord = { id: string; amount: number; category: string; note: string; date: string; createdBy: string };
function expensePool(): Pool | null {
  const connectionString = process.env.SUPABASE_DB_URL?.trim();
  if (!connectionString) return null;
  if (!globalForDb.ellextExpensePool) {
    const databaseHost = new URL(connectionString).hostname;
    const ssl = ['localhost', '127.0.0.1', '::1'].includes(databaseHost) ? false : { rejectUnauthorized: false };
    globalForDb.ellextExpensePool = new Pool({ connectionString, ssl, max: 2, connectionTimeoutMillis: 2500, query_timeout: 4000 });
  }
  return globalForDb.ellextExpensePool;
}
async function ensureExpenseTable(pool: Pool): Promise<boolean> {
  if (!globalForDb.ellextExpenseSchema) {
    globalForDb.ellextExpenseSchema = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS public.expense_ledger (
        id text PRIMARY KEY,
        amount_inr numeric(14,2) NOT NULL CHECK (amount_inr > 0),
        category text NOT NULL DEFAULT 'Other',
        note text NOT NULL,
        expense_date timestamptz NOT NULL DEFAULT now(),
        created_by text NOT NULL DEFAULT ''
      )`);
      await pool.query("ALTER TABLE public.expense_ledger ADD COLUMN IF NOT EXISTS created_by text NOT NULL DEFAULT ''");
      await pool.query('ALTER TABLE public.expense_ledger ENABLE ROW LEVEL SECURITY');
      await pool.query('REVOKE ALL ON public.expense_ledger FROM anon, authenticated');
      await pool.query('GRANT ALL ON public.expense_ledger TO service_role');
      await pool.query("NOTIFY pgrst, 'reload schema'");
      return true;
    })().catch(() => false);
  }
  const ready = await globalForDb.ellextExpenseSchema;
  if (!ready) globalForDb.ellextExpenseSchema = undefined;
  return ready;
}
export async function readExpenseLedger(): Promise<LedgerRecord[]> {
  const storageMode = await getCompanyDataStorageMode();
  const pool = expensePool();
  if (storageMode === 'supabase' && pool && await ensureExpenseTable(pool)) {
    try {
      const { rows } = await pool.query('SELECT id,amount_inr,category,note,expense_date,created_by FROM public.expense_ledger ORDER BY expense_date DESC');
      return rows.map(row => ({ id: row.id, amount: Number(row.amount_inr), category: row.category, note: row.note, date: new Date(row.expense_date).toISOString(), createdBy: row.created_by ?? '' }));
    } catch { /* Fall through to the Supabase REST and SQLite stores. */ }
  }
  if (storageMode === 'supabase') {
    const client = getSupabaseAdmin();
    if (!client) throw new Error('Supabase service key is not configured.');
    const { data, error } = await client.from('expense_ledger').select('id,amount_inr,category,note,expense_date,created_by').order('expense_date', { ascending: false });
    if (error) throw new Error(`Unable to load Expense Ledger: ${error.message}`);
    const entries = (data ?? []).map(row => ({ id: row.id, amount: Number(row.amount_inr), category: row.category, note: row.note, date: row.expense_date, createdBy: row.created_by ?? '' }));
    if (!process.env.VERCEL) {
      const write = db().prepare(`INSERT INTO expense_ledger(id,amount_inr,category,note,expense_date,created_by) VALUES(?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET amount_inr=excluded.amount_inr,category=excluded.category,note=excluded.note,expense_date=excluded.expense_date,created_by=excluded.created_by`);
      const sync = db().transaction((rows: LedgerRecord[]) => rows.forEach(row => write.run(row.id,row.amount,row.category,row.note,row.date,row.createdBy)));
      sync(entries);
    }
    return entries;
  }
  return db().prepare('SELECT id,amount_inr as amount,category,note,expense_date as date,created_by as createdBy FROM expense_ledger ORDER BY expense_date DESC').all() as LedgerRecord[];
}
export async function addExpenseLedgerRecord(record: LedgerRecord) {
  const storageMode = await getCompanyDataStorageMode();
  const pool = expensePool();
  if (storageMode === 'supabase' && pool && await ensureExpenseTable(pool)) {
    try {
      await pool.query(`INSERT INTO public.expense_ledger(id,amount_inr,category,note,expense_date,created_by) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(id) DO UPDATE SET amount_inr=EXCLUDED.amount_inr,category=EXCLUDED.category,note=EXCLUDED.note,expense_date=EXCLUDED.expense_date,created_by=EXCLUDED.created_by`, [record.id, record.amount, record.category, record.note, record.date, record.createdBy]);
      return;
    } catch { /* Fall through to the Supabase REST and SQLite stores. */ }
  }
  if (storageMode === 'supabase') {
    const client = getSupabaseAdmin();
    if (!client) throw new Error('Supabase service key is not configured.');
    const { error } = await client.from('expense_ledger').upsert({ id: record.id, amount_inr: record.amount, category: record.category, note: record.note, expense_date: record.date, created_by: record.createdBy }, { onConflict: 'id' });
    if (error) throw new Error(`Unable to save Expense Ledger entry: ${error.message}`);
  }
  if (process.env.VERCEL && storageMode === 'supabase') return;
  db().prepare(`INSERT INTO expense_ledger(id,amount_inr,category,note,expense_date,created_by) VALUES(?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET amount_inr=excluded.amount_inr,category=excluded.category,note=excluded.note,expense_date=excluded.expense_date,created_by=excluded.created_by`).run(record.id, record.amount, record.category, record.note, record.date, record.createdBy);
}
export async function deleteExpenseLedgerRecord(id: string) {
  const storageMode = await getCompanyDataStorageMode();
  const pool = expensePool();
  if (storageMode === 'supabase' && pool && await ensureExpenseTable(pool)) {
    try { await pool.query('DELETE FROM public.expense_ledger WHERE id=$1', [id]); return; }
    catch { /* Fall through to the Supabase REST and SQLite stores. */ }
  }
  if (storageMode === 'supabase') {
    const client = getSupabaseAdmin();
    if (!client) throw new Error('Supabase service key is not configured.');
    const { error } = await client.from('expense_ledger').delete().eq('id', id);
    if (error) throw new Error(`Unable to remove Expense Ledger entry: ${error.message}`);
  }
  if (process.env.VERCEL && storageMode === 'supabase') return;
  db().prepare('DELETE FROM expense_ledger WHERE id=?').run(id);
}
