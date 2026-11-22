'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { BrandLogo } from '@/components/brand-logo';
import { ArrowLeft, ArrowRight, ShieldCheck } from 'lucide-react';

export default function FirstAdminSetupPage() {
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null);
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { fetch('/api/auth/status').then((response) => response.json()).then((data: { setupComplete: boolean }) => setSetupComplete(data.setupComplete)).catch(() => setSetupComplete(true)); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    if (password !== confirm) { setError('The passwords do not match.'); return; }
    if (password.length < 10) { setError('Use at least 10 characters for your password.'); return; }
    setBusy(true);
    try {
      const response = await fetch('/api/auth/bootstrap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, email, password }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Unable to create the Super Admin account.');
      window.location.assign('/');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to complete setup.'); setBusy(false); }
  }
  if (setupComplete === null) return <main className="auth-page"><div className="auth-card auth-loading">Checking first-time setup…</div></main>;
  if (setupComplete) return <main className="auth-page"><section className="auth-card"><Link href="/sign-in" className="auth-brand"><BrandLogo /></Link><span className="auth-kicker">SETUP COMPLETE</span><h1>Super Admin already exists</h1><p className="auth-intro">Public account creation is disabled. Sign in with the Super Admin account.</p><Link href="/sign-in" className="auth-submit auth-link-submit">Back to sign in <ArrowRight size={16} /></Link></section></main>;
  return <main className="auth-page"><div className="auth-accent auth-accent-one" /><div className="auth-accent auth-accent-two" />
    <section className="auth-card" aria-labelledby="setup-title"><Link href="/sign-in" className="auth-back"><ArrowLeft size={15} /> Back to sign in</Link>
      <Link href="/sign-in" className="auth-brand"><BrandLogo /></Link><span className="auth-kicker">FIRST-TIME SETUP</span><h1 id="setup-title">Create Super Admin</h1><p className="auth-intro">This first account controls the dashboard and can create Admin access.</p>
      <div className="auth-role-note"><ShieldCheck size={17} /><span>Super Admin has full access to every dashboard area and account controls.</span></div>
      <form onSubmit={submit} className="auth-form"><label>Full name<input autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" /></label>
        <label>Email address<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" /></label>
        <label>Password<input type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 10 characters" /></label>
        <label>Confirm password<input type="password" autoComplete="new-password" required value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="Enter the password again" /></label>
        {error && <p className="auth-error" role="alert">{error}</p>}<button className="auth-submit" disabled={busy}>{busy ? 'Creating account…' : 'Create Super Admin account'} <ArrowRight size={16} /></button>
      </form><div className="auth-footer"><ShieldCheck size={15} /> One-time protected setup</div>
    </section>
  </main>;
}
