import { requireClient } from './client';

export type Cadence = 'hourly' | 'daily' | 'weekdays' | 'weekly';

export interface ShiftRow {
  id: string;
  agent_id: string;
  title: string;
  instruction: string;
  cadence: Cadence;
  hour: number;
  weekday: number | null;
  tz: string;
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
}

const COLS = 'id, agent_id, title, instruction, cadence, hour, weekday, tz, enabled, next_run_at, last_run_at';

export async function listShifts(orgId: string): Promise<ShiftRow[]> {
  const { data, error } = await requireClient().from('shifts').select(COLS).eq('organization_id', orgId).order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ShiftRow[];
}

export async function createShift(input: {
  orgId: string;
  userId: string;
  agentId: string;
  title: string;
  instruction: string;
  cadence: Cadence;
  hour: number;
  weekday: number | null;
}): Promise<ShiftRow> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const { data, error } = await requireClient()
    .from('shifts')
    .insert({
      organization_id: input.orgId,
      created_by: input.userId,
      agent_id: input.agentId,
      title: input.title.trim().slice(0, 120),
      instruction: input.instruction.trim().slice(0, 1500),
      cadence: input.cadence,
      hour: input.hour,
      weekday: input.cadence === 'weekly' ? input.weekday ?? 1 : null,
      tz,
    })
    .select(COLS)
    .single();
  if (error) throw new Error(error.message);
  return data as unknown as ShiftRow;
}

export async function setShiftEnabled(id: string, enabled: boolean): Promise<void> {
  const { error } = await requireClient().from('shifts').update({ enabled }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteShift(id: string): Promise<void> {
  const { error } = await requireClient().from('shifts').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
