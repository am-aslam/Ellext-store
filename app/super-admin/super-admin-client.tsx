'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { BrandLogo } from '@/components/brand-logo';
import { ArrowLeft, Check, Copy, Database, FileSpreadsheet, FileText, LogOut, Plus, ReceiptText, ShieldCheck, X } from 'lucide-react';
import { isStoredCurrencyRate, isStoredCurrencyRows, isStoredProductIncreases, isStoredSellingEntries, storageKeys, type CurrencyRateSnapshot, type CurrencyRow, type ProductIncrease, type SellingEntry } from '@/lib/storage';
import { loadSharedDashboardValue } from '@/lib/shared-dashboard';

type AdminAccount = { id: string; name: string; email: string; role: 'admin' };
type AuthStatus = { mode: 'supabase' | 'sqlite'; supabaseConfigured: boolean; deployment?: 'vercel' | 'local'; sharedDataReady?: boolean; sharedDataError?: string };
type CreatedCredential = { email: string; password: string };
type BackupRow = {
  date: string;
  description: string;
  status: 'Active' | 'Archived';
  usdBuy: number;
  inrBuy: number | null;
  increase: number | null;
  sellingPrice: number | null;
  productCount: number;
  soldCount: number;
  collected: number | null;
  updatedAt: string;
};
type SalesBackup = { rows: BackupRow[]; rate: CurrencyRateSnapshot | null; totalSold: number; totalCollected: number | null; generatedAt: string };
type ExportFormat = 'excel' | 'pdf';

function makeSalesBackup(products: CurrencyRow[], rate: CurrencyRateSnapshot | null, increases: ProductIncrease[], sales: SellingEntry[]): SalesBackup {
  const productsById = new Map(products.map((product: CurrencyRow) => [product.id, product]));
  const increasesById = new Map(increases.map((increase: ProductIncrease) => [increase.sourceId, increase.increaseInr]));
  const latestSalesById = new Map<string, SellingEntry>();
  for (const sale of sales) latestSalesById.set(sale.sourceId, sale);
  const rows: BackupRow[] = Array.from(latestSalesById.values()).flatMap((sale) => {
    const product = productsById.get(sale.sourceId);
    if (!product) return [];
    const inrBuy = rate ? product.usd * rate.usdToInr : null;
    const companyAmount = increasesById.get(product.id);
    const increase = inrBuy === null || companyAmount === undefined ? null : companyAmount - inrBuy;
    const sellingPrice = companyAmount ?? null;
    return [{
      date: product.date,
      description: product.description,
      status: product.active ? 'Active' as const : 'Archived' as const,
      usdBuy: product.usd,
      inrBuy,
      increase,
      sellingPrice,
      productCount: product.productCount,
      soldCount: sale.soldCount,
      collected: sellingPrice === null ? null : sale.soldCount * sellingPrice,
      updatedAt: sale.updatedAt,
    }];
  }).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  return {
    rows,
    rate,
    totalSold: rows.reduce((sum, row) => sum + row.soldCount, 0),
    totalCollected: rows.some(row => row.collected !== null) ? rows.reduce((sum, row) => sum + (row.collected ?? 0), 0) : null,
    generatedAt: new Date().toISOString(),
  };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function backupFilename(extension: 'xlsx' | 'pdf') {
  return `ellextstore-sales-backup-${new Date().toISOString().slice(0, 10)}.${extension}`;
}

export default function SuperAdminClient({ userName }: { userName: string }) {
  const [status, setStatus] = useState<AuthStatus | null>(null); const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [credential, setCredential] = useState<CreatedCredential | null>(null); const [copied, setCopied] = useState(false);
  const [backup, setBackup] = useState<SalesBackup | null>(null);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [backupError, setBackupError] = useState('');
  const [backupNotice, setBackupNotice] = useState('');
  async function refresh() {
    const [statusResponse, adminsResponse] = await Promise.all([fetch('/api/auth/status'), fetch('/api/auth/admins/list')]);
    if (statusResponse.ok) setStatus(await statusResponse.json()); if (adminsResponse.ok) setAdmins((await adminsResponse.json()).admins);
  }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    let active = true;
    const updateBackup = async () => {
      try {
        const [products, rate, increases, sales] = await Promise.all([
          loadSharedDashboardValue(storageKeys.currencyRows, isStoredCurrencyRows),
          loadSharedDashboardValue(storageKeys.currencyRate, isStoredCurrencyRate),
          loadSharedDashboardValue(storageKeys.productIncreases, isStoredProductIncreases),
          loadSharedDashboardValue(storageKeys.sellingEntries, isStoredSellingEntries),
        ]);
        if (active) setBackup(makeSalesBackup(products ?? [], rate, increases ?? [], sales ?? []));
      } catch (cause) {
        if (active) setBackupError(cause instanceof Error ? `Shared sales data could not be loaded: ${cause.message}` : 'Shared sales data could not be loaded.');
      }
    };
    void updateBackup();
    window.addEventListener('storage', updateBackup);
    window.addEventListener('focus', updateBackup);
    const interval = window.setInterval(updateBackup, 15000);
    return () => { active = false; window.removeEventListener('storage', updateBackup); window.removeEventListener('focus', updateBackup); window.clearInterval(interval); };
  }, []);
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
  async function exportExcel() {
    if (!backup?.rows.length) return;
    setExporting('excel'); setBackupError(''); setBackupNotice('');
    try {
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'EllextStore';
      workbook.created = new Date(backup.generatedAt);
      const sheet = workbook.addWorksheet('Sales Data', { views: [{ state: 'frozen', ySplit: 8 }] });
      sheet.columns = [
        { header: 'Date', key: 'date', width: 15 }, { header: 'Product', key: 'description', width: 38 },
        { header: 'Status', key: 'status', width: 12 }, { header: 'USD buy / unit', key: 'usdBuy', width: 16 },
        { header: 'INR buy / unit', key: 'inrBuy', width: 16 }, { header: 'Company increase / unit', key: 'increase', width: 23 },
        { header: 'Selling price / unit', key: 'sellingPrice', width: 20 }, { header: 'Product count', key: 'productCount', width: 16 },
        { header: 'Sold items', key: 'soldCount', width: 14 }, { header: 'Collected amount (INR)', key: 'collected', width: 23 },
        { header: 'Last updated', key: 'updatedAt', width: 24 },
      ];
      sheet.mergeCells('A1:K1');
      sheet.getCell('A1').value = 'EllextStore · Sales Backup';
      sheet.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF202020' } };
      sheet.getCell('A1').alignment = { vertical: 'middle' };
      sheet.getRow(1).height = 28;
      sheet.addRow(['Generated', new Date(backup.generatedAt).toLocaleString('en-IN')]);
      sheet.addRow(['USD → INR rate', backup.rate?.usdToInr ?? 'Unavailable']);
      sheet.addRow(['Saved sales rows', backup.rows.length]);
      sheet.addRow(['Total items sold', backup.totalSold]);
      sheet.addRow(['Total collected (INR)', backup.totalCollected]);
      sheet.addRow([]);
      const headerRow = sheet.addRow(sheet.columns.map((column) => column.header));
      headerRow.height = 24;
      headerRow.eachCell((cell) => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2864F5' } }; cell.alignment = { vertical: 'middle', wrapText: true }; });
      for (const row of backup.rows) {
        const excelRow = sheet.addRow({
          date: new Date(row.date).toLocaleDateString('en-IN'), description: row.description, status: row.status,
          usdBuy: row.usdBuy, inrBuy: row.inrBuy, increase: row.increase, sellingPrice: row.sellingPrice,
          productCount: row.productCount, soldCount: row.soldCount, collected: row.collected,
          updatedAt: new Date(row.updatedAt).toLocaleString('en-IN'),
        });
        excelRow.getCell(4).numFmt = '$#,##0.00';
        for (const cellIndex of [5, 6, 7, 10]) excelRow.getCell(cellIndex).numFmt = '₹#,##0.00';
        if (excelRow.number % 2 === 1) excelRow.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F9F7' } }; });
      }
      sheet.autoFilter = { from: 'A8', to: 'K8' };
      const buffer = await workbook.xlsx.writeBuffer();
      downloadBlob(new Blob([buffer as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), backupFilename('xlsx'));
      setBackupNotice('Excel sales backup downloaded.');
    } catch (cause) { setBackupError(cause instanceof Error ? cause.message : 'Could not create the Excel backup.'); }
    finally { setExporting(null); }
  }
  async function exportPdf() {
    if (!backup?.rows.length) return;
    setExporting('pdf'); setBackupError(''); setBackupNotice('');
    try {
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
      const document = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      document.setFontSize(17); document.setTextColor(32, 32, 32); document.text('EllextStore · Sales Backup', 38, 40);
      document.setFontSize(9); document.setTextColor(120, 120, 120);
      document.text(`Generated ${new Date(backup.generatedAt).toLocaleString('en-IN')}  ·  ${backup.rows.length} saved sales rows  ·  ${backup.totalSold.toLocaleString('en-IN')} items sold`, 38, 58);
      document.text(`USD → INR: ${backup.rate ? backup.rate.usdToInr.toFixed(4) : 'Unavailable'}  ·  Total collected: ${backup.totalCollected === null ? 'Unavailable' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(backup.totalCollected)}`, 38, 73);
      autoTable(document, {
        startY: 90,
        head: [['Date', 'Product', 'Status', 'USD buy / unit', 'INR buy / unit', 'Increase / unit', 'Product count', 'Sold items', 'Collected (INR)']],
        body: backup.rows.map((row) => [
          new Date(row.date).toLocaleDateString('en-IN'), row.description, row.status,
          `$${row.usdBuy.toFixed(2)}`, row.inrBuy === null ? '—' : row.inrBuy.toFixed(2), row.increase === null ? '—' : row.increase.toFixed(2),
          String(row.productCount), String(row.soldCount), row.collected === null ? '—' : row.collected.toFixed(2),
        ]),
        margin: { left: 38, right: 38 },
        styles: { fontSize: 7, cellPadding: 5, overflow: 'linebreak' },
        headStyles: { fillColor: [40, 100, 245], textColor: [255, 255, 255] },
        alternateRowStyles: { fillColor: [247, 249, 247] },
        columnStyles: { 1: { cellWidth: 150 }, 2: { cellWidth: 48 }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' } },
        didDrawPage: () => { document.setFontSize(8); document.setTextColor(140, 140, 140); document.text(`EllextStore sales backup  ·  Page ${document.getNumberOfPages()}`, 38, document.internal.pageSize.getHeight() - 18); },
      });
      document.save(backupFilename('pdf'));
      setBackupNotice('PDF sales backup downloaded.');
    } catch (cause) { setBackupError(cause instanceof Error ? cause.message : 'Could not create the PDF backup.'); }
    finally { setExporting(null); }
  }
  const usingLocal = status?.mode === 'sqlite';
  const sharedTableMissing = status?.mode === 'supabase' && status.sharedDataReady === false;

  return <main className="admin-page"><header className="admin-topbar"><Link href="/" className="auth-brand"><BrandLogo /></Link><div><span className="admin-user"><ShieldCheck size={16} /> {userName} · Super Admin</span><Link href="/expense-ledger" className="admin-signout"><ReceiptText size={15} /> Expense Ledger</Link><button className="admin-signout" onClick={signOut}><LogOut size={15} /> Sign out</button></div></header>
    <div className="admin-content"><Link href="/" className="admin-back"><ArrowLeft size={15} /> Dashboard</Link>
      <span className="auth-kicker">ELLEXTSTORE · ACCESS CONTROL</span><h1>Super Admin</h1><p className="admin-subtitle">Manage dashboard access and check the active data store.</p>
      <section className={`store-status ${usingLocal || sharedTableMissing ? 'store-status-local' : 'store-status-online'}`} role="status"><span className="store-status-icon"><Database size={19} /></span><div><strong>{usingLocal ? (status?.supabaseConfigured ? 'Supabase is unavailable' : 'Supabase is not configured') : sharedTableMissing ? 'Supabase connected; shared table is missing' : 'Supabase is connected'}</strong><p>{usingLocal ? status?.deployment === 'vercel' ? 'Vercel SQLite is temporary and does not sync between accounts or function instances. Admin changes will not appear for Super Admin until Supabase reconnects.' : 'The app is using the local SQLite database. Changes are shared only through this local app instance.' : sharedTableMissing ? `${status.sharedDataError || 'The public.dashboard_shared_state table is unavailable.'} Apply supabase/migrations/001_dashboard_schema.sql in the Supabase SQL Editor.` : 'Supabase is active and the shared company data table is available.'}</p></div><span className="store-status-pill">{usingLocal ? 'LOCAL DATABASE' : sharedTableMissing ? 'TABLE MISSING' : 'SUPABASE'}</span></section>
      <div className="admin-columns"><section className="admin-panel"><div className="admin-panel-heading"><div className="admin-icon"><Plus size={17} /></div><div><h2>Create Admin account</h2><p>Generate a temporary password to share securely.</p></div></div>
        <form className="auth-form admin-form" onSubmit={createAdmin}><label>Admin name<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Team member name" /></label><label>Admin email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@company.com" /></label>
          {error && <p className="auth-error" role="alert">{error}</p>}<button className="auth-submit" disabled={busy}>{busy ? 'Creating account…' : 'Create Admin credentials'} <Plus size={16} /></button>
        </form>
        {credential && <div className="credential-card" role="status"><div className="credential-head"><strong>Share these credentials</strong><button aria-label="Dismiss credentials" onClick={() => setCredential(null)}><X size={15} /></button></div><p>Copy this temporary password now. It will only be shown once.</p><div><small>Email</small><code>{credential.email}</code></div><div><small>Temporary password</small><code>{credential.password}</code></div><button className="copy-credentials" onClick={copyCredentials}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy credentials'}</button></div>}
      </section>
      <section className="admin-panel admin-list-panel"><div className="admin-panel-heading"><div className="admin-icon"><ShieldCheck size={17} /></div><div><h2>Admin accounts <span>{admins.length}</span></h2><p>Admin accounts have access to all dashboard features.</p></div></div>
        {admins.length ? <ul className="admin-list">{admins.map((admin) => <li key={admin.id}><span className="admin-avatar">{admin.name.slice(0, 1).toUpperCase()}</span><span><strong>{admin.name}</strong><small>{admin.email}</small></span><em>Admin</em></li>)}</ul> : <div className="admin-list-empty"><ShieldCheck size={20} /><strong>No Admin accounts yet</strong><span>Create the first Admin account to provide dashboard access.</span></div>}
      </section></div>
      <section className="admin-panel backup-panel" aria-labelledby="backup-title"><div className="admin-panel-heading"><div className="admin-icon backup-icon"><Database size={17} /></div><div><h2 id="backup-title">Sales data backup</h2><p>Export saved Selling Details records from this browser. Files download to your device.</p></div></div>
        <div className="backup-summary"><span><small>Saved rows</small><b>{backup?.rows.length ?? '—'}</b></span><span><small>Items sold</small><b>{backup?.totalSold.toLocaleString('en-IN') ?? '—'}</b></span><span><small>Total collected</small><b>{backup?.totalCollected === null || backup?.totalCollected === undefined ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(backup.totalCollected)}</b></span></div>
        <div className="backup-actions"><button className="backup-export-button" onClick={() => void exportExcel()} disabled={!backup?.rows.length || exporting !== null}><FileSpreadsheet size={17} />{exporting === 'excel' ? 'Preparing Excel…' : 'Export Excel (.xlsx)'}</button><button className="backup-export-button backup-pdf-button" onClick={() => void exportPdf()} disabled={!backup?.rows.length || exporting !== null}><FileText size={17} />{exporting === 'pdf' ? 'Preparing PDF…' : 'Export PDF'}</button></div>
        {!backup?.rows.length && <p className="backup-empty">No saved sales rows yet. Enter and save sold item counts in Selling Details to enable exports.</p>}
        {backupError && <p className="auth-error backup-message" role="alert">{backupError}</p>}{backupNotice && <p className="backup-success" role="status"><Check size={14} />{backupNotice}</p>}
      </section>
    </div>
  </main>;
}
