/**
 * Load the TypeScript compiler API.
 * Works in both ESM and CJS by using module.createRequire.
 */

import { createRequire } from 'node:module';

let _ts: typeof import('typescript') | null = null;

export function loadTypeScript(): typeof import('typescript') {
  if (_ts) return _ts;

  // Try multiple resolution anchors — the project being indexed (cwd) may have
  // TypeScript installed locally even when kc-graph is installed globally.
  const anchors: string[] = [
    process.cwd() + '/__kc_graph_resolve__.js',
  ];
  if (typeof __filename !== 'undefined') {
    anchors.push(__filename);
  }

  for (const anchor of anchors) {
    try {
      const localRequire = createRequire(anchor);
      _ts = localRequire('typescript') as typeof import('typescript');
      return _ts;
    } catch {
      // try next anchor
    }
  }

  throw new Error(
    'TypeScript is required for parsing. Install it: npm install typescript',
  );
}
