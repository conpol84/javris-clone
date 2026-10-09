import { useEffect, useRef } from 'react';

/** Fence an in-flight task acknowledgement when its company/user changes or the UI closes. */
export function useRunScope(key: string): () => () => boolean {
  const scope = useRef({ key, live: true });
  if (scope.current.key !== key) scope.current = { key, live: true };
  useEffect(() => {
    const current = scope.current;
    current.live = true;
    return () => { current.live = false; };
  }, [key]);
  return () => {
    const current = scope.current;
    return () => current.live && scope.current === current;
  };
}
