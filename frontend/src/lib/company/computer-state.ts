/** Pure presentation rules. A recent heartbeat is not proof of execution permission. */
export interface HeartbeatDevice { paired: boolean; revoked_at: string | null; last_seen_at: string | null }
export type DevicePresence = 'revoked' | 'unpaired' | 'online' | 'offline';
export function devicePresence(device: HeartbeatDevice, now = Date.now()): DevicePresence {
  if (device.revoked_at) return 'revoked';
  if (!device.paired) return 'unpaired';
  const seen = device.last_seen_at ? Date.parse(device.last_seen_at) : NaN;
  const age = now - seen;
  return Number.isFinite(now) && Number.isFinite(seen) && age >= 0 && age < 60_000 ? 'online' : 'offline';
}
/** A durable delivery receipt is not proof the requested user task finished.
 * Explicit false for an advanced UI job means the worker delivered a truthful
 * incomplete result (e.g. locked screen). Do NOT rewrite the DB's `done` status:
 * that marks the terminal report and is used for idempotent ACK accounting.
 */
export function computerJobNeedsContinuation(job: {
  kind: string;
  status: string;
  result: Record<string, unknown> | null;
}): boolean {
  return (job.kind === 'desktop_task' || job.kind === 'browser_task')
    && job.status === 'done'
    && job.result?.completed === false;
}

export function formatComputerResult(job: { kind: string; result: Record<string, unknown> | null }): string {
  const r = job.result;
  if (!r) return '';
  if (job.kind === 'list') {
    if (!Array.isArray(r.entries)) return JSON.stringify(r, null, 2);
    return r.entries.filter(e => e && typeof e === 'object').map(e =>
      `${e.type === 'dir' ? '📁' : '📄'} ${String(e.name ?? '')}${typeof e.size === 'number' ? `  (${e.size} B)` : ''}`).join('\n');
  }
  if (job.kind === 'read') return String(r.content ?? '');
  if (job.kind === 'write') return `${String(r.path ?? '')} (${String(r.written ?? '')} chars)`;
  if (job.kind === 'browser_open' || job.kind === 'browser_task') return JSON.stringify(r, null, 2);
  if (job.kind === 'desktop_task') return typeof r.summary === 'string' ? r.summary : JSON.stringify(r, null, 2);
  return `exit ${String(r.code ?? '')}\n${String(r.stdout ?? '')}${r.stderr ? `\n${String(r.stderr)}` : ''}`;
}
/** Each refresh owns a ticket. Old requests and responses after disposal cannot publish. */
export class RequestGeneration {
  private generation = 0;
  begin(): number { return ++this.generation; }
  isCurrent(ticket: number): boolean { return ticket === this.generation; }
  invalidate(): void { ++this.generation; }
}
