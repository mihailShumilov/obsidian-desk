'use client';

/**
 * Returns `true` while the tab is in the foreground, `false` while hidden.
 *
 * Components that drive a `setInterval` purely for visual flair (cipher
 * scramble, cube canvas repaints) should pause when this returns false —
 * a backgrounded tab still pays the React re-render cost otherwise.
 *
 * SSR-safe: starts as `true` so hydrated markup matches server output;
 * the real value lands on the first effect tick.
 */

import { useEffect, useState } from 'react';

export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = (): void => setVisible(document.visibilityState === 'visible');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}
