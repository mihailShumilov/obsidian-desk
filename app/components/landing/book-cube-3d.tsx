'use client';

/**
 * BookCube — the encrypted hero cube on the landing page (UI_DESIGN.md §5.1).
 *
 * 6 faces × 8 lines of mono ciphertext each, drawn into per-face HTMLCanvas
 * textures (cipher-cyan glyphs over obsidian-800 backdrop, with a faint
 * inner glow). Glyphs re-randomize every 800ms by mutating the canvas in
 * place and bumping `texture.needsUpdate`. The cube auto-rotates slowly;
 * no OrbitControls because we don't want the user grabbing it.
 *
 * This file is loaded via dynamic import (ssr:false) — Three.js needs a
 * browser GL context — see ./book-cube.tsx for the Suspense wrapper.
 */

import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  CanvasTexture,
  type Mesh,
  type Texture,
  Color,
  AdditiveBlending,
  BackSide,
} from 'three';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
const FACE_PIXELS = 256;
const LINES_PER_FACE = 8;
const CHARS_PER_LINE = 16;
const CADENCE_MS = 800;

function randString(len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

function paintCipherFace(ctx: CanvasRenderingContext2D): void {
  // Backdrop — obsidian-800 with a soft cipher-cyan vignette
  ctx.fillStyle = '#0B0B14';
  ctx.fillRect(0, 0, FACE_PIXELS, FACE_PIXELS);
  const grd = ctx.createRadialGradient(
    FACE_PIXELS / 2,
    FACE_PIXELS / 2,
    20,
    FACE_PIXELS / 2,
    FACE_PIXELS / 2,
    FACE_PIXELS,
  );
  grd.addColorStop(0, 'rgba(0,245,212,0.06)');
  grd.addColorStop(1, 'rgba(0,245,212,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, FACE_PIXELS, FACE_PIXELS);

  // Mono cipher lines
  ctx.fillStyle = '#00F5D4';
  ctx.font = '600 16px "JetBrains Mono", ui-monospace, monospace';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,245,212,0.5)';
  ctx.shadowBlur = 4;
  const padding = 24;
  const lineHeight = (FACE_PIXELS - padding * 2) / LINES_PER_FACE;
  for (let i = 0; i < LINES_PER_FACE; i++) {
    const y = padding + lineHeight * i + lineHeight / 2;
    ctx.fillText(randString(CHARS_PER_LINE), padding, y);
  }
}

function makeFaceTexture(): {
  canvas: HTMLCanvasElement;
  texture: CanvasTexture;
} {
  const canvas = document.createElement('canvas');
  canvas.width = FACE_PIXELS;
  canvas.height = FACE_PIXELS;
  const ctx = canvas.getContext('2d')!;
  paintCipherFace(ctx);
  const texture = new CanvasTexture(canvas);
  return { canvas, texture };
}

function CubeMesh(): JSX.Element {
  const meshRef = useRef<Mesh>(null);
  const cadenceRef = useRef<number>(0);

  // 6 face textures — generated once, mutated in place on each cadence tick.
  // Reduced-motion is handled at the dynamic-import boundary (the parent
  // renders the static fallback instead, so this component never mounts).
  const faces = useMemo(() => {
    if (typeof document === 'undefined') return null;
    return Array.from({ length: 6 }, () => makeFaceTexture());
  }, []);

  useEffect(() => {
    if (!faces) return;
    const id = setInterval(() => {
      for (const f of faces) {
        const ctx = f.canvas.getContext('2d')!;
        paintCipherFace(ctx);
        f.texture.needsUpdate = true;
      }
    }, CADENCE_MS);
    return () => clearInterval(id);
  }, [faces]);

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    cadenceRef.current += delta;
    meshRef.current.rotation.y += delta * 0.25;
    meshRef.current.rotation.x += delta * 0.1;
  });

  if (!faces) return <></>;
  return (
    <mesh ref={meshRef}>
      <boxGeometry args={[2, 2, 2]} />
      {faces.map((f, i) => (
        <meshStandardMaterial
          key={i}
          attach={`material-${i}`}
          map={f.texture as Texture}
          emissive={new Color('#00F5D4')}
          emissiveIntensity={0.18}
          roughness={0.6}
          metalness={0.15}
        />
      ))}
    </mesh>
  );
}

function GlowHalo(): JSX.Element {
  // Rear hemisphere rendered with BackSide + additive blending — a cheap
  // cipher-cyan haze without a real bloom postprocess pass.
  return (
    <mesh>
      <sphereGeometry args={[3.4, 24, 24]} />
      <meshBasicMaterial
        color={new Color('#00F5D4')}
        transparent
        opacity={0.06}
        side={BackSide}
        blending={AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  );
}

export default function BookCube3D(): JSX.Element {
  return (
    <Canvas
      camera={{ position: [3.2, 2.2, 4.2], fov: 38 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      style={{ background: 'transparent' }}
    >
      <ambientLight intensity={0.45} />
      <pointLight position={[5, 5, 5]} intensity={1.2} color="#00F5D4" />
      <pointLight position={[-4, -3, -2]} intensity={0.5} color="#A855F7" />
      <CubeMesh />
      <GlowHalo />
    </Canvas>
  );
}
