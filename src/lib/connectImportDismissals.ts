export interface DismissedConnectImport {
  token: number;
  connectionId?: string;
  platform: string;
  platformLabel: string;
  startedAt: number;
}

let nextToken = 1;
let snapshot: readonly DismissedConnectImport[] = [];
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

/** One pending completion notice per platform, so repeat dismissals never stack. */
export function trackDismissedConnectImport(
  importRun: Omit<DismissedConnectImport, 'token'>,
): number {
  const token = nextToken++;
  snapshot = [
    ...snapshot.filter((entry) => entry.platform !== importRun.platform),
    { ...importRun, token },
  ];
  emit();
  return token;
}

export function forgetDismissedConnectImport(token: number): void {
  const next = snapshot.filter((entry) => entry.token !== token);
  if (next.length === snapshot.length) return;
  snapshot = next;
  emit();
}

export function subscribeDismissedConnectImports(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDismissedConnectImports(): readonly DismissedConnectImport[] {
  return snapshot;
}
