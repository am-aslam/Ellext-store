'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { BrandLogo } from '@/components/brand-logo';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { fetchWithDataLoading } from '@/lib/data-fetch';

type AuthStatus = { setupComplete: boolean; mode: 'supabase' | 'sqlite'; supabaseConfigured: boolean };
export default function SignInPage() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetchWithDataLoading('/api/auth/status').then((response) => response.json()).then(setStatus).catch(() => setStatus({ setupComplete: true, mode: 'sqlite', supabaseConfigured: false })); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const response = await fetchWithDataLoading('/api/auth/sign-in', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to sign in.');
      const requestedPath = new URL(window.location.href).searchParams.get('next');
      const safePath = requestedPath?.startsWith('/') && !requestedPath.startsWith('//') ? requestedPath : '/';
      window.location.assign(safePath);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to sign in.'); setBusy(false); }
  }

  return <main className="auth-page"><div className="auth-accent auth-accent-one" /><div className="auth-accent auth-accent-two" />
    <section className="auth-card" aria-labelledby="signin-title">
      <Link href="/sign-in" className="auth-brand"><BrandLogo /></Link>
      <span className="auth-kicker">SECURE DASHBOARD ACCESS</span><h1 id="signin-title">Welcome back</h1><p className="auth-intro">Sign in to manage products, exchange values, and sales.</p>
      {status?.mode === 'sqlite' && status.supabaseConfigured && <div className="auth-fallback" role="status"><span /> Supabase is unavailable. Using local database.</div>}
      {!status?.setupComplete && <div className="auth-first-run"><ShieldCheck size={18} /><span>Set up your first Super Admin account to get started.</span><Link href="/sign-up">Set up <ArrowRight size={14} /></Link></div>}
      <form onSubmit={submit} className="auth-form"><label>Email address<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" /></label>
        <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" /></label>
        {error && <p className="auth-error" role="alert">{error}</p>}<button className="auth-submit" disabled={busy || !status?.setupComplete}>{busy ? 'Signing in…' : 'Sign in'} <ArrowRight size={16} /></button>
      </form>
      <div className="auth-footer"><ShieldCheck size={15} /> Role protected access · EllextStore</div>
    </section>
  </main>;
}
