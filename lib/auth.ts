import 'server-only';

import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
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
  const directory = path.join(process.cwd(), 'data');
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
export function hasAnyUsers() { return Boolean(db().prepare('SELECT 1 FROM users LIMIT 1').get()); }
export function hasSuperAdmin() { return Boolean(db().prepare("SELECT 1 FROM users WHERE role='super_admin' LIMIT 1").get()); }
export function listAdmins(): AppUser[] {
  return db().prepare("SELECT id,email,name,role FROM users WHERE role='admin' ORDER BY created_at DESC").all() as AppUser[];
}

async function createRemoteUser(email: string, password: string, name: string, role: UserRole): Promise<string | null> {
  const client = getSupabaseAdmin();
  if (!client) return null;
  const { data, error } = await client.auth.admin.createUser({
    email, password, email_confirm: true,
    app_metadata: { role }, user_metadata: { name },
  });
  if (error) throw new Error(error.message);
  return data.user.id;
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
  if (hasSuperAdmin()) throw new Error('Super Admin setup is already complete. Sign in instead.');
  let supabaseUserId: string | null = null;
  try { supabaseUserId = await createRemoteUser(email, password, name, 'super_admin'); } catch { /* Local SQLite is the failover store. */ }
  try { return insertUser(email, name, 'super_admin', password, supabaseUserId); }
  catch (error) {
    if (supabaseUserId) await getSupabaseAdmin()?.auth.admin.deleteUser(supabaseUserId);
    throw error;
  }
}

export async function createAdmin(email: string, name: string, password: string) {
  let supabaseUserId: string | null = null;
  try { supabaseUserId = await createRemoteUser(email, password, name, 'admin'); } catch { /* Create a local fallback account if Supabase is unavailable. */ }
  try { return insertUser(email, name, 'admin', password, supabaseUserId); }
  catch (error) {
    if (supabaseUserId) await getSupabaseAdmin()?.auth.admin.deleteUser(supabaseUserId);
    throw error;
  }
}

export function generateTemporaryPassword() { return `${randomBytes(12).toString('base64url')}A9!`; }

export async function signIn(email: string, password: string): Promise<{ user: AppUser; mode: StorageMode }> {
  const normalizedEmail = email.trim().toLowerCase();
  let mode: StorageMode = 'sqlite';
  const remote = getSupabase();
  if (remote) {
    try {
      const { error } = await remote.auth.signInWithPassword({ email: normalizedEmail, password });
      if (!error) mode = 'supabase';
    } catch { mode = 'sqlite'; }
  }
  const row = db().prepare('SELECT * FROM users WHERE email=?').get(normalizedEmail) as UserRow | undefined;
  if (!row || !bcrypt.compareSync(password, row.password_hash)) throw new Error('Email or password is incorrect.');
  const rawToken = randomBytes(32).toString('base64url');
  db().prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  db().prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)')
    .run(hashToken(rawToken), row.id, Date.now() + SESSION_MAX_AGE * 1000, new Date().toISOString());
  const cookieStore = cookies();
  cookieStore.set(SESSION_COOKIE, rawToken, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: SESSION_MAX_AGE,
  });
  return { user: { id: row.id, email: row.email, name: row.name, role: row.role }, mode };
}

function hashToken(value: string) { return createHash('sha256').update(value).digest('hex'); }
export async function getCurrentUser(): Promise<AppUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = db().prepare(`SELECT u.id,u.email,u.name,u.role,s.expires_at FROM sessions s
    JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`).get(hashToken(token)) as SessionRow | undefined;
  if (!row || row.expires_at <= Date.now()) {
    if (row) db().prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));
    return null;
  }
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}
export function clearSession(token: string | undefined) {
  if (token) db().prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));
  cookies().delete(SESSION_COOKIE);
}
export function getAuthDataStore() { return db(); }
