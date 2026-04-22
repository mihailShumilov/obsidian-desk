// Forces ts-node CJS transpilation before mocha loads any spec, so we don't
// fall through to Node 24's native ESM .ts handler (which can't import named
// exports from CJS modules like @coral-xyz/anchor / chai 4).
const path = require('node:path');

process.env.TS_NODE_PROJECT =
  process.env.TS_NODE_PROJECT || path.join(__dirname, 'tests/tsconfig.json');

module.exports = {
  require: 'ts-node/register/transpile-only',
  extensions: ['ts'],
  spec: 'tests/**/*.ts',
  timeout: 1000000,
};
