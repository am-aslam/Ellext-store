'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Copy, Database, LogOut, Plus, ShieldCheck, X } from 'lucide-react';

type AdminAccount = { id: string; name: string; email: string; role: 'admin' };
type AuthStatus = { mode: 'supabase' | 'sqlite'; supabaseConfigured: boolean };
type CreatedCredential = { email: string; password: string };

export default function SuperAdminClient({ userName }: { userName: string }) {
  const [status, setStatus] = useState<AuthStatus | null>(null); const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [credential, setCredential] = useState<CreatedCredential | null>(null); const [copied, setCopied] = useState(false);
  async function refresh() {
    const [statusResponse, adminsResponse] = await Promise.all([fetch('/api/auth/status'), fetch('/api/auth/admins/list')]);
    if (statusResponse.ok) setStatus(await statusResponse.json()); if (adminsResponse.ok) setAdmins((await adminsResponse.json()).admins);
  }
  useEffect(() => { void refresh(); }, []);
  async function createAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const response = await fetch('/api/auth/admins', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, email }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Unable to create Admin account.');
      setCredential({ email: result.user.email, password: result.password }); setName(''); setEmail(''); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to create Admin account.'); }
    finally { setBusy(false); }
  }
  async function copyCredentials() {
    if (!credential) return;
    await navigator.clipboard.writeText(`Email: ${credential.email}\nTemporary password: ${credential.password}`);
    setCopied(true); window.setTimeout(() => setCopied(false), 1800);
  }
  async function signOut() { await fetch('/api/auth/sign-out', { method: 'POST' }); window.location.assign('/sign-in'); }
  const usingLocal = status?.mode === 'sqlite';

  return <main className="admin-page"><header className="admin-topbar"><Link href="/" className="auth-brand">Ellext<span>Store</span><i /></Link><div><span className="admin-user"><ShieldCheck size={16} /> {userName} · Super Admin</span><button className="admin-signout" onClick={signOut}><LogOut size={15} /> Sign out</button></div></header>
    <div className="admin-content"><Link href="/" className="admin-back"><ArrowLeft size={15} /> Dashboard</Link>
      <span className="auth-kicker">ELLEXTSTORE · ACCESS CONTROL</span><h1>Super Admin</h1><p className="admin-subtitle">Manage dashboard access and check the active data store.</p>
      <section className={`store-status ${usingLocal ? 'store-status-local' : 'store-status-online'}`} role="status"><span className="store-status-icon"><Database size={19} /></span><div><strong>{usingLocal ? (status?.supabaseConfigured ? 'Supabase is unavailable' : 'Supabase is not configured') : 'Supabase is connected'}</strong><p>{usingLocal ? 'The app is using the local SQLite database. Local account changes are saved on this device.' : 'Supabase is active. A local SQLite copy is maintained for sign-in fallback.'}</p></div><span className="store-status-pill">{usingLocal ? 'LOCAL DATABASE' : 'SUPABASE'}</span></section>
      <div className="admin-columns"><section className="admin-panel"><div className="admin-panel-heading"><div className="admin-icon"><Plus size={17} /></div><div><h2>Create Admin account</h2><p>Generate a temporary password to share securely.</p></div></div>
        <form className="auth-form admin-form" onSubmit={createAdmin}><label>Admin name<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Team member name" /></label><label>Admin email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@company.com" /></label>
          {error && <p className="auth-error" role="alert">{error}</p>}<button className="auth-submit" disabled={busy}>{busy ? 'Creating account…' : 'Create Admin credentials'} <Plus size={16} /></button>
        </form>
        {credential && <div className="credential-card" role="status"><div className="credential-head"><strong>Share these credentials</strong><button aria-label="Dismiss credentials" onClick={() => setCredential(null)}><X size={15} /></button></div><p>Copy this temporary password now. It will only be shown once.</p><div><small>Email</small><code>{credential.email}</code></div><div><small>Temporary password</small><code>{credential.password}</code></div><button className="copy-credentials" onClick={copyCredentials}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy credentials'}</button></div>}
      </section>
      <section className="admin-panel admin-list-panel"><div className="admin-panel-heading"><div className="admin-icon"><ShieldCheck size={17} /></div><div><h2>Admin accounts <span>{admins.length}</span></h2><p>Admin accounts have access to all dashboard features.</p></div></div>
        {admins.length ? <ul className="admin-list">{admins.map((admin) => <li key={admin.id}><span className="admin-avatar">{admin.name.slice(0, 1).toUpperCase()}</span><span><strong>{admin.name}</strong><small>{admin.email}</small></span><em>Admin</em></li>)}</ul> : <div className="admin-list-empty"><ShieldCheck size={20} /><strong>No Admin accounts yet</strong><span>Create the first Admin account to provide dashboard access.</span></div>}
      </section></div>
    </div>
  </main>;
}
