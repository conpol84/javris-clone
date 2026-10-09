/** FIRBO SG-MEM-01: fail-closed user scope for inference memory.
 * A NULL owner, an arbitrary visibility claim or an agent match never
 * authenticates sharing. Trusted organization sharing requires a separate
 * server-attested ACL and a DB migration before enabling it.
 */
export function ownerVisibleMemory<T extends { user_id: string | null }>(
  records: readonly T[], authenticatedUserId: string,
): T[] {
  if (!authenticatedUserId) return [];
  return records.filter(record => record.user_id === authenticatedUserId);
}
