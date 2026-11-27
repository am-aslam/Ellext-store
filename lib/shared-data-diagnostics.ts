export type SharedDataDiagnostic = {
  dataset: string;
  recordIndex: number | null;
  field: string;
  rule: string;
  status: 'excluded_from_view_and_calculations' | 'excluded_from_financial_calculations' | 'financial_calculation_incomplete';
};

const diagnosticsBySource = new Map<string, SharedDataDiagnostic[]>();
const listeners = new Set<() => void>();
const emptySnapshot: SharedDataDiagnostic[] = [];
let cachedSnapshot: SharedDataDiagnostic[] = [];

function publish() {
  cachedSnapshot = Array.from(diagnosticsBySource.values()).flat();
  listeners.forEach(listener => listener());
}

export function setSharedDataDiagnostics(source: string, diagnostics: SharedDataDiagnostic[]) {
  diagnosticsBySource.set(source, diagnostics);
  publish();
}

export function getSharedDataDiagnostics(): SharedDataDiagnostic[] {
  return cachedSnapshot;
}

export function getServerSharedDataDiagnostics(): SharedDataDiagnostic[] {
  return emptySnapshot;
}

export function subscribeSharedDataDiagnostics(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
