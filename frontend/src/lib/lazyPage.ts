import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { reloadOnStaleBuild } from '../components/ErrorBoundary';

/**
 * Route-level code splitting: a page is downloaded the first time it is opened.
 * If a tab outlived a deploy and the chunk is gone, load the new build once instead of showing an error.
 */
export function lazyPage<M extends Record<string, unknown>, K extends keyof M>(
  load: () => Promise<M>,
  name: K,
): LazyExoticComponent<ComponentType<Record<string, never>>> {
  return lazy(() =>
    load()
      .then((m) => ({ default: m[name] as ComponentType<Record<string, never>> }))
      .catch((error) => {
        if (reloadOnStaleBuild(error)) return new Promise<never>(() => {});
        throw error;
      }),
  );
}
