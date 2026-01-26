import { readFileSync, statSync, lstatSync, readdirSync, existsSync, openSync, readSync, closeSync, realpathSync } from 'node:fs';
import { join, relative, resolve, extname } from 'node:path';

/** File extensions we know how to parse. */
const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs',
]);

const DOC_EXTENSIONS = new Set(['.md', '.mdx']);

/** Extensions that are always binary — skip without reading. */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp',
  '.mp3', '.mp4', '.wav', '.ogg', '.webm', '.avi', '.mov',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar', '.zst',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.dat',
  '.wasm', '.node',
  '.lock', '.pyc', '.class', '.o', '.obj',
  '.sqlite', '.db', '.sqlite3',
  '.map',
]);

/** Directories always skipped regardless of gitignore. */
const ALWAYS_SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn',
  'dist', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.output', '.cache',
  '__pycache__', '.tox', '.venv', 'venv',
  '.kc-graph',
]);

export interface DiscoveredFile {
  /** Absolute path. */
  absolutePath: string;
  /** Path relative to the project root. */
  relativePath: string;
  /** 'source' for TS/JS, 'doc' for markdown, 'unknown' otherwise. */
  kind: 'source' | 'doc' | 'unknown';
}

export interface DiscoverOptions {
  /** Project root (default: cwd). */
  root?: string;
  /** Extra extensions to treat as source (e.g. ['.vue', '.svelte']). */
  extraSourceExtensions?: string[];
  /** Extra patterns to ignore (in addition to .gitignore). */
  extraIgnore?: string[];
  /** Include unknown file types (default: false). */
  includeUnknown?: boolean;
}

/**
 * Discover all indexable files in a project.
 * Respects .gitignore, skips binaries and common non-source directories.
 */
export function discoverFiles(options: DiscoverOptions = {}): DiscoveredFile[] {
  const root = resolve(options.root ?? process.cwd());
  const sourceExts = new Set([...SOURCE_EXTENSIONS, ...(options.extraSourceExtensions ?? [])]);
  const ignoreRules = loadGitignore(root, options.extraIgnore ?? []);
  const results: DiscoveredFile[] = [];

  walk(root, root, sourceExts, ignoreRules, results, options.includeUnknown ?? false);
  return results;
}

function walk(
  dir: string,
  root: string,
  sourceExts: Set<string>,
  ignoreRules: IgnoreRule[],
  results: DiscoveredFile[],
  includeUnknown: boolean,
  visitedDirs?: Set<string>,
): void {
  // Track visited real paths to detect symlink cycles
  const visited = visitedDirs ?? new Set<string>();
  let realDir: string;
  try {
    realDir = realpathSync(dir);
  } catch {
    return;
  }
  if (visited.has(realDir)) return;
  visited.add(realDir);

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // permission denied, etc.
  }

  for (const entry of entries) {
    const absPath = join(dir, entry);
    const relPath = relative(root, absPath);

    let stat;
    try {
      stat = statSync(absPath);
    } catch {
      continue;
    }

    // Skip symlinks pointing to directories (avoid cycles)
    try {
      const lstat = lstatSync(absPath);
      if (lstat.isSymbolicLink() && stat.isDirectory()) {
        const realTarget = realpathSync(absPath);
        if (visited.has(realTarget)) continue;
      }
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      if (ALWAYS_SKIP_DIRS.has(entry)) continue;
      if (isIgnored(relPath + '/', ignoreRules)) continue;
      walk(absPath, root, sourceExts, ignoreRules, results, includeUnknown, visited);
      continue;
    }

    if (!stat.isFile()) continue;
    if (isIgnored(relPath, ignoreRules)) continue;

    const ext = extname(entry).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) continue;

    // Skip very large files (> 1MB)
    if (stat.size > 1_048_576) continue;

    // Skip files with no extension that might be binary
    if (!ext && stat.size > 8192) {
      if (isBinaryFile(absPath)) continue;
    }

    let kind: DiscoveredFile['kind'];
    if (sourceExts.has(ext)) {
      kind = 'source';
    } else if (DOC_EXTENSIONS.has(ext)) {
      kind = 'doc';
    } else {
      kind = 'unknown';
      if (!includeUnknown) continue;
    }

    results.push({ absolutePath: absPath, relativePath: relPath, kind });
  }
}

// ---------------------------------------------------------------------------
// Gitignore
// ---------------------------------------------------------------------------

interface IgnoreRule {
  pattern: RegExp;
  negated: boolean;
}

function loadGitignore(root: string, extraPatterns: string[]): IgnoreRule[] {
  const rules: IgnoreRule[] = [];

  const gitignorePath = join(root, '.gitignore');
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, 'utf-8');
    for (const line of content.split('\n')) {
      const rule = parseGitignoreLine(line);
      if (rule) rules.push(rule);
    }
  }

  for (const pattern of extraPatterns) {
    const rule = parseGitignoreLine(pattern);
    if (rule) rules.push(rule);
  }

  return rules;
}

function parseGitignoreLine(line: string): IgnoreRule | null {
  let trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  let negated = false;
  if (trimmed.startsWith('!')) {
    negated = true;
    trimmed = trimmed.slice(1);
  }

  // Remove trailing spaces (unless escaped)
  trimmed = trimmed.replace(/(?<!\\)\s+$/, '');
  if (!trimmed) return null;

  const pattern = gitignorePatternToRegex(trimmed);
  return { pattern, negated };
}

function gitignorePatternToRegex(pattern: string): RegExp {
  let regex = '';
  let anchored = false;

  // If pattern contains a slash (not trailing), it's anchored to root
  if (pattern.includes('/') && !pattern.endsWith('/')) {
    anchored = true;
  }

  // Remove trailing slash (it means "directory only" but we handle dirs with /)
  let p = pattern.replace(/\/$/, '');

  // Escape regex special chars except * and ?
  p = p.replace(/[.+^${}()|[\]\\]/g, '\\$&');

  // Convert glob patterns
  p = p.replace(/\*\*/g, '{{GLOBSTAR}}');
  p = p.replace(/\*/g, '[^/]*');
  p = p.replace(/\?/g, '[^/]');
  p = p.replace(/\{\{GLOBSTAR\}\}/g, '.*');

  if (anchored) {
    regex = '^' + p;
  } else {
    regex = '(?:^|/)' + p;
  }

  // Match the pattern anywhere in path or as a complete segment
  regex += '(?:/|$)';

  try {
    return new RegExp(regex);
  } catch {
    return /(?!)/; // never matches
  }
}

function isIgnored(relPath: string, rules: IgnoreRule[]): boolean {
  let ignored = false;

  for (const rule of rules) {
    if (rule.pattern.test(relPath)) {
      ignored = !rule.negated;
    }
  }

  return ignored;
}

// ---------------------------------------------------------------------------
// Binary detection
// ---------------------------------------------------------------------------

/**
 * Check if a file is likely binary by reading its first 512 bytes.
 * If it contains null bytes, it's binary.
 */
function isBinaryFile(filePath: string): boolean {
  try {
    const fd = openSync(filePath, 'r');
    const buf = Buffer.alloc(512);
    const bytesRead = readSync(fd, buf, 0, 512, 0);
    closeSync(fd);

    for (let i = 0; i < bytesRead; i++) {
      if (buf[i] === 0) return true;
    }
    return false;
  } catch {
    return true; // if we can't read it, skip it
  }
}
