export interface FirboSession {
  contract: 'firbo-control/v1';
  platform_admin: boolean;
  companies: { id: string; name: string; role: string }[];
  has_more: boolean;
}
export interface FirboCombo {
  name: string; strategy: string; models: string[]; revision: string; managed: boolean; editable: boolean;
}
export interface FirboControl {
  contract: 'firbo-control/v1'; reachable: boolean; available: boolean; writes_enabled: boolean;
  providers: { id: string; provider: string; name: string; active: boolean; status: string }[];
  models: { id: string; provider: string }[];
  combos: FirboCombo[];
  errors: Record<string, string>;
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const string = (v: unknown): v is string => typeof v === 'string';
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(string);
const invalid = (): never => { throw new Error('firbo_control_contract_mismatch'); };

export function parseSession(v: unknown): FirboSession {
  if (!record(v) || v.contract !== 'firbo-control/v1' || typeof v.platform_admin !== 'boolean' || typeof v.has_more !== 'boolean' ||
      !Array.isArray(v.companies) || !v.companies.every(c => record(c) && string(c.id) && string(c.name) && string(c.role))) return invalid();
  return v as unknown as FirboSession;
}

export function parseControl(v: unknown): FirboControl {
  if (!record(v) || v.contract !== 'firbo-control/v1' || typeof v.reachable !== 'boolean' || typeof v.available !== 'boolean' || typeof v.writes_enabled !== 'boolean' ||
      !record(v.errors) || !Object.values(v.errors).every(string) ||
      !Array.isArray(v.providers) || !v.providers.every(p => record(p) && string(p.id) && string(p.provider) && string(p.name) && typeof p.active === 'boolean' && string(p.status)) ||
      !Array.isArray(v.models) || !v.models.every(m => record(m) && string(m.id) && string(m.provider)) ||
      !Array.isArray(v.combos) || !v.combos.every(c => record(c) && string(c.name) && string(c.strategy) && strings(c.models) && string(c.revision) && /^[a-f0-9]{64}$/.test(c.revision) && typeof c.managed === 'boolean' && typeof c.editable === 'boolean')) return invalid();
  if (v.writes_enabled && (!v.available || Object.keys(v.errors).length > 0)) return invalid();
  return v as unknown as FirboControl;
}

export function parseModelLines(text: string): string[] {
  const ids = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (ids.length < 1 || ids.length > 12 || new Set(ids).size !== ids.length || ids.some(id => id.length > 300 || /[\u0000-\u001f]/.test(id))) return invalid();
  return ids;
}
