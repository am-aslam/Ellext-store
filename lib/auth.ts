import 'server-only';

import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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

const globalForDb = globalThis as typeof globalThis & { ellextDb?: Database.Database };
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
    CREATE TABLE IF NOT EXISTS currency_rows (id TEXT PRIMARY KEY, row_date TEXT NOT NULL, image TEXT NOT NULL DEFAULT '', description TEXT NOT NULL, usd REAL NOT NULL CHECK(usd >= 0), product_count INTEGER NOT NULL CHECK(product_count >= 0), active INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS product_increases (source_id TEXT PRIMARY KEY REFERENCES currency_rows(id) ON DELETE CASCADE, selling_price_inr REAL NOT NULL CHECK(selling_price_inr >= 0), locked INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS selling_entries (source_id TEXT PRIMARY KEY REFERENCES currency_rows(id) ON DELETE CASCADE, sold_count INTEGER NOT NULL DEFAULT 0 CHECK(sold_count >= 0), updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS product_requests (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Submitted' CHECK(status IN ('Submitted','Under review','Fulfilled')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS member_invitations (email TEXT PRIMARY KEY COLLATE NOCASE, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Accepted','Expired')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS dashboard_snapshots (user_id TEXT NOT NULL, storage_key TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id,storage_key));
  `);
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
