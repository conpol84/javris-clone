import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CommandDialog } from './CommandDialog';

interface CommandApi {
  open: () => void;
}
const Ctx = createContext<CommandApi>({ open: () => {} });
export const useCommand = (): CommandApi => useContext(Ctx);

/** One command dialog for the whole workspace: sidebar button, Talk button and ⌘K / Ctrl+K all open it. */
export function CommandProvider({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(false);
  const open = useCallback(() => setOn(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOn((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const api = useMemo(() => ({ open }), [open]);
  return (
    <Ctx.Provider value={api}>
      {children}
      {on && <CommandDialog onClose={() => setOn(false)} />}
    </Ctx.Provider>
  );
}
