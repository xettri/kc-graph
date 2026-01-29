/**
 * Load the TypeScript compiler API.
 *
 * Prefers the project's own TypeScript (resolved from cwd) so files are parsed
 * with the same version the project uses. Falls back to the copy bundled with
 * kc-graph (a direct dependency) so parsing always works.
 */

import { createRequire } from 'node:module';

let _ts: typeof import('typescript') | null = null;

export function loadTypeScript(): typeof import('typescript') {
  if (_ts) return _ts;

  // 1. Try the project being indexed (cwd) — prefer its TS version.
  // 2. Fall back to kc-graph's own bundled TypeScript.
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
    'Failed to load TypeScript. This should not happen — please report this issue.',
  );
}
