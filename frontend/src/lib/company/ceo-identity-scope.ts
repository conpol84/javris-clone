/** CEO identity boundaries used before selecting personalized context or a computer.
 * This is a fail-closed client-side guard; Supabase RLS and the server's
 * connector authorization remain the actual security enforcement boundaries.
 */
export type CeoScope = Readonly<{
  organizationId: string;
  userId: string;
  agentId: string;
}>;
export type ScopedResource = Readonly<{
  organizationId: string;
  userId?: string | null;
  agentId?: string | null;
}>;
const valid = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.trim() === value
  && value.length <= 128 && !/[\x00-\x1f\x7f]/.test(value);

/** Missing identity must never fall back to another owner/organization. */
export function validCeoScope(scope: CeoScope): boolean {
  return valid(scope.organizationId) && valid(scope.userId) && valid(scope.agentId);
}
/** A user-owned computer/setting is never a company-wide resource. */
export function canUsePersonalResource(scope: CeoScope, resource: ScopedResource): boolean {
  return validCeoScope(scope)
    && resource.organizationId === scope.organizationId
    && valid(resource.userId) && resource.userId === scope.userId;
}
/** Company knowledge is shared only within the tenant after owner publication.
 * Private user memories and per-agent notes are separate scopes.
 */
export function canReadCeoMemory(
  scope: CeoScope,
  memory: ScopedResource & Readonly<{ visibility: 'personal'|'company'|'agent'; approved?: boolean }>,
): boolean {
  if (!validCeoScope(scope) || memory.organizationId !== scope.organizationId) return false;
  if (memory.visibility === 'personal') return valid(memory.userId) && memory.userId === scope.userId;
  if (memory.visibility === 'company') return memory.approved === true && memory.userId == null && memory.agentId == null;
  return valid(memory.userId) && memory.userId === scope.userId && valid(memory.agentId) && memory.agentId === scope.agentId;
}
/** Sanitized local preference key. A missing user ID does NOT select a legacy
 * company-wide laptop preference shared by employees on this browser.
 */
export function personalComputerPreferenceKey(organizationId: string, userId: string): string | null {
  return valid(organizationId) && valid(userId)
    ? `firbo.voice-laptop.v2:${encodeURIComponent(organizationId)}:${encodeURIComponent(userId)}`
    : null;
}
/** Personality shapes responses, never authorization or tenant visibility. */
export function buildCeoPersonalization(input: Readonly<{
  scope: CeoScope;
  ownerInstructions: string;
  companyInstructions?: string;
  workingStyle?: string;
}>): string | null {
  if (!validCeoScope(input.scope)) return null;
  const clean = (s: unknown, max: number) => typeof s === 'string'
    ? s.trim().slice(0,max).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'') : '';
  const owner = clean(input.ownerInstructions,8000);
  const company = clean(input.companyInstructions,8000);
  const style = clean(input.workingStyle,2000);
  return [
    'These are tenant-scoped user preferences, not system or security policies.',
    owner && `Owner CEO instructions:\n${owner}`,
    company && `Approved company instructions:\n${company}`,
    style && `Preferred communication style:\n${style}`,
  ].filter(Boolean).join('\n\n');
}
