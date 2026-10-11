/** Release gate: UI and Supabase Edge must be enabled TOGETHER after verified
 * migration, scheduler, rollout and rollback. The default remains OFF.
 */
export const JARVIS_SERVER_MODE = import.meta.env.VITE_FIRBO_JARVIS_SERVER_AUTOPILOT==='on';
