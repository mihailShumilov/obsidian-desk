import type { NextConfig } from 'next';
import { resolve } from 'node:path';

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  // We're inside a pnpm workspace — point Next's file tracer at the
  // workspace root so symlinked deps (`@obsidian-desk/sdk`, etc.) are
  // copied into `.next/standalone/` instead of left as dangling links.
  outputFileTracingRoot: resolve(__dirname, '..'),
  // The Ika + Encrypt gRPC clients pull `@grpc/grpc-js`, which uses
  // node-only modules (`dns`, `fs`, `net`). Even though `sdk/src/ika.ts`
  // dynamic-imports the gRPC client only inside real-mode entry points,
  // Turbopack still walks the import graph at build time and tries to
  // bundle it for the client. Mark these as server-external so Next
  // leaves them as runtime require()s on the server and excludes them
  // from the client bundle entirely.
  serverExternalPackages: [
    '@grpc/grpc-js',
    '@encrypt.xyz/pre-alpha-solana-client',
    '@mysten/bcs',
    '@protobuf-ts/runtime',
    '@protobuf-ts/runtime-rpc',
    '@bufbuild/protobuf',
  ],
  // tiny-secp256k1@2.x loads its WASM blob at module-eval via
  // `fs.readFileSync(__dirname + '/secp256k1.wasm')`. Next's tracer doesn't
  // pick up referenced asset files, so the standalone bundle ships without
  // the .wasm and any server action that pulls bitcoinjs-lib (deposit,
  // trade, positions) crashes with ENOENT. Pattern is resolved from the
  // project root (`app/`); the file lives in the pnpm store at the
  // workspace root, hence the `..` prefix.
  outputFileTracingIncludes: {
    '/*': [
      '../node_modules/.pnpm/tiny-secp256k1@*/node_modules/tiny-secp256k1/lib/*.wasm',
    ],
  },
};

export default nextConfig;
