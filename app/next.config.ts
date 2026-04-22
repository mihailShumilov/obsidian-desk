import type { NextConfig } from 'next';
import { resolve } from 'node:path';

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  // We're inside a pnpm workspace — point Next's file tracer at the
  // workspace root so symlinked deps (`@obsidian-desk/sdk`, etc.) are
  // copied into `.next/standalone/` instead of left as dangling links.
  outputFileTracingRoot: resolve(__dirname, '..'),
};

export default nextConfig;
