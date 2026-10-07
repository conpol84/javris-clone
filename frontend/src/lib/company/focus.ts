import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../store';

const KEY = 'firbo.focus';
const EVENT = 'firbo:focus';

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Focus mode: hides side panels and the sidebar so only the essentials stay on screen. Remembered per browser. */
export function useFocusMode(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(read);
  useEffect(() => {
    const sync = () => setOn(read());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.focus = on ? '1' : '0';
    return () => {
      document.documentElement.dataset.focus = '0';
    };
  }, [on]);
  const set = useCallback((next: boolean) => {
    try {
      localStorage.setItem(KEY, next ? '1' : '0');
    } catch {
      /* the choice just is not remembered */
    }
    if (next) useAppStore.setState({ sidebarOpen: false });
    else useAppStore.setState({ sidebarOpen: true });
    window.dispatchEvent(new Event(EVENT));
    setOn(next);
  }, []);
  return [on, set];
}
