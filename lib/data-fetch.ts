type LoadingListener = (pendingCount: number) => void;

let pendingRequests = 0;
const listeners = new Set<LoadingListener>();

function publishPendingCount() {
  listeners.forEach(listener => listener(pendingRequests));
}

function isAppApiRequest(input: RequestInfo | URL): boolean {
  if (typeof window === 'undefined') return false;
  const rawUrl = input instanceof Request ? input.url : String(input);
  try {
    return new URL(rawUrl, window.location.href).pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

export function subscribeToDataLoading(listener: LoadingListener): () => void {
  listeners.add(listener);
  listener(pendingRequests);
  return () => listeners.delete(listener);
}

export async function fetchWithDataLoading(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!isAppApiRequest(input)) return fetch(input, init);

  pendingRequests += 1;
  publishPendingCount();
  try {
    return await fetch(input, init);
  } finally {
    pendingRequests = Math.max(0, pendingRequests - 1);
    publishPendingCount();
  }
}
