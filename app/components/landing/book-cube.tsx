'use client';

/**
 * BookCube wrapper: dynamically imports the Three.js implementation client-side
 * (Three needs a browser GL context — no SSR), and renders a static 2D
 * isometric fallback during loading and for users who prefer reduced motion.
 *
 * The fallback is also what shows in the SSR HTML, so first-paint never has
 * a blank hero — UI_DESIGN.md §5.1 + §7.
 */

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { Cipher } from '@/components/obsidian/cipher';

const BookCube3D = dynamic(() => import('./book-cube-3d'), {
  ssr: false,
  loading: () => <CubeFallback />,
});

export function BookCube(): JSX.Element {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduceMotion(mq.matches);
    const handler = (e: MediaQueryListEvent): void => setReduceMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  if (reduceMotion) return <CubeFallback />;
  return (
    <div className="aspect-square w-full">
      <BookCube3D />
    </div>
  );
}

function CubeFallback(): JSX.Element {
  // Isometric 2D cube, three visible faces. Lightweight, no JS work after
  // first paint — and it carries the same vibe.
  return (
    <div className="relative flex aspect-square w-full items-center justify-center">
      <div
        className="relative size-72 rounded-2xl border border-cipher-cyan/30 bg-obsidian-900/80 p-5 shadow-cipher backdrop-blur"
        style={{
          transform: 'perspective(800px) rotateX(18deg) rotateY(-22deg)',
        }}
      >
        <div className="space-y-1 leading-snug">
          {Array.from({ length: 8 }).map((_, i) => (
            <Cipher
              key={i}
              length={16}
              cadenceMs={800 + i * 80}
              className="block text-sm"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
