import { toast } from 'sonner';
import { planLimitKey } from './billing';

/** When the server refused something because of the plan, say so and offer the upgrade. Returns true if it handled the error. */
export function notifyPlanLimit(err: unknown, t: (key: never, vars?: Record<string, string | number>) => string): boolean {
  const key = planLimitKey(err);
  if (!key) return false;
  const tt = t as unknown as (k: string, v?: Record<string, string | number>) => string;
  if (key === 'premium_agent') {
    toast.error(tt('bill.premium'), { action: { label: tt('bill.seePlans'), onClick: () => window.location.assign('/billing') } });
    return true;
  }
  toast.error(tt('bill.hit', { what: tt(`bill.limit.${key}`).toLowerCase() }), {
    action: { label: tt('bill.seePlans'), onClick: () => window.location.assign('/billing') },
  });
  return true;
}
