import { createRequire } from 'node:module';

let _ts: typeof import('typescript') | null = null;

export function loadTypeScript(): typeof import('typescript') {
  if (_ts) return _ts;

  // Prefer the project's own TypeScript, fall back to bundled version
  const anchors: string[] = [process.cwd() + '/__kc_graph_resolve__.js'];
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

  throw new Error('Failed to load TypeScript. This should not happen — please report this issue.');
}
