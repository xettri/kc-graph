/**
 * Load the TypeScript compiler API.
 * Works in both ESM and CJS by using module.createRequire.
 */

import { createRequire } from 'node:module';

let _ts: typeof import('typescript') | null = null;

export function loadTypeScript(): typeof import('typescript') {
  if (_ts) return _ts;

  try {
    // createRequire works in both ESM and CJS.
    // In ESM, __filename is not defined, so we use process.argv[1] or cwd as anchor.
    const anchor =
      typeof __filename !== 'undefined'
        ? __filename
        : process.cwd() + '/__kc_graph_resolve__.js';
    const localRequire = createRequire(anchor);
    _ts = localRequire('typescript') as typeof import('typescript');
    return _ts;
  } catch {
    throw new Error(
      'TypeScript is required for parsing. Install it: npm install typescript',
    );
  }
}
