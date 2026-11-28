'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { getServerSharedDataDiagnostics, getSharedDataDiagnostics, subscribeSharedDataDiagnostics } from '@/lib/shared-data-diagnostics';

const DISMISSAL_KEY = 'ellextstore:ui:v1:shared-validation-banner-dismissed';

export function SharedDataValidationBanner() {
  const diagnostics = useSyncExternalStore(subscribeSharedDataDiagnostics, getSharedDataDiagnostics, getServerSharedDataDiagnostics);
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISSAL_KEY) === '1');
    } catch {
      setDismissed(false);
    }
  }, []);

  if (!diagnostics.length || dismissed !== false) return null;
  const excluded = diagnostics.filter(item => item.status !== 'financial_calculation_incomplete').length;
  const incomplete = diagnostics.length - excluded;
  const samples = diagnostics.slice(0, 4);
  const dismiss = () => {
    setDismissed(true);
    try { window.localStorage.setItem(DISMISSAL_KEY, '1'); } catch { /* Keep it dismissed for this page session. */ }
  };

  return <aside className="shared-validation-banner" role="status" aria-live="polite">
    <button className="shared-validation-dismiss" type="button" onClick={dismiss} aria-label="Dismiss saved data validation message" title="Dismiss message">
      <X size={16} aria-hidden="true" />
    </button>
    <strong>Some saved data needs review</strong>
    <span>{excluded ? `${excluded} record${excluded === 1 ? '' : 's'} excluded from views and calculations. ` : ''}{incomplete ? `${incomplete} financial calculation${incomplete === 1 ? ' is' : 's are'} incomplete. ` : ''}Original shared records were preserved.</span>
    <ul>{samples.map((item, index) => <li key={`${item.dataset}:${item.recordIndex}:${item.field}:${index}`}>
      {item.dataset}{item.recordIndex === null ? '' : ` · row ${item.recordIndex + 1}`} · {item.field} · {item.rule} · {item.status.replaceAll('_', ' ')}
    </li>)}</ul>
    {diagnostics.length > samples.length && <small>Showing {samples.length} of {diagnostics.length} validation details.</small>}
  </aside>;
}
