'use client';

import { useSyncExternalStore } from 'react';
import { getServerSharedDataDiagnostics, getSharedDataDiagnostics, subscribeSharedDataDiagnostics } from '@/lib/shared-data-diagnostics';

export function SharedDataValidationBanner() {
  const diagnostics = useSyncExternalStore(subscribeSharedDataDiagnostics, getSharedDataDiagnostics, getServerSharedDataDiagnostics);
  if (!diagnostics.length) return null;
  const excluded = diagnostics.filter(item => item.status !== 'financial_calculation_incomplete').length;
  const incomplete = diagnostics.length - excluded;
  const samples = diagnostics.slice(0, 4);
  return <aside className="shared-validation-banner" role="status" aria-live="polite">
    <strong>Some saved data needs review</strong>
    <span>{excluded ? `${excluded} record${excluded === 1 ? '' : 's'} excluded from views and calculations. ` : ''}{incomplete ? `${incomplete} financial calculation${incomplete === 1 ? ' is' : 's are'} incomplete. ` : ''}Original shared records were preserved.</span>
    <ul>{samples.map((item, index) => <li key={`${item.dataset}:${item.recordIndex}:${item.field}:${index}`}>
      {item.dataset}{item.recordIndex === null ? '' : ` · row ${item.recordIndex + 1}`} · {item.field} · {item.rule} · {item.status.replaceAll('_', ' ')}
    </li>)}</ul>
    {diagnostics.length > samples.length && <small>Showing {samples.length} of {diagnostics.length} validation details.</small>}
  </aside>;
}
