import { randomBytes } from 'node:crypto';

/**
 * Types for the chunked storage engine.
 */

// ---------------------------------------------------------------------------
// Meta (version, config, stats)
// ---------------------------------------------------------------------------

export interface StorageMeta {
  version: string;
  config: StorageConfig;
  project: string;
  lastSync: number;
  stats: {
    files: number;
    nodes: number;
    edges: number;
    chunks: number;
  };
}

export interface StorageConfig {
  /** Max chunk size in bytes (default: 262144 = 256KB). */
  chunkSize: number;
  /** Chunk ID length in hex chars (default: 6 = 3 bytes). */
  chunkIdLength: number;
}

export const DEFAULT_CONFIG: StorageConfig = {
  chunkSize: 262144,
  chunkIdLength: 6,
};

// ---------------------------------------------------------------------------
// Map (file → chunks, chunk → metadata)
// ---------------------------------------------------------------------------

export interface StorageMap {
  files: Record<string, FileEntry>;
  chunks: Record<string, ChunkMeta>;
}

export interface FileEntry {
  /** Last modified time (ms since epoch). */
  mtime: number;
  /** File size in bytes. */
  size: number;
  /** Chunk IDs containing this file's nodes. */
  chunks: string[];
}

export interface ChunkMeta {
  /** Serialized JSON size in bytes. */
  size: number;
  /** Number of nodes in this chunk. */
  nodes: number;
  /** Number of edges in this chunk. */
  edges: number;
}

// ---------------------------------------------------------------------------
// Chunk file
// ---------------------------------------------------------------------------

export interface ChunkData {
  id: string;
  nodes: SerializedChunkNode[];
  edges: SerializedChunkEdge[];
}

export interface SerializedChunkNode {
  id: string;
  type: string;
  name: string;
  qualifiedName: string;
  content: string;
  signature: string;
  location: {
    file: string;
    startLine: number;
    endLine: number;
    startColumn: number;
    endColumn: number;
  } | null;
  metadata: Record<string, unknown>;
  /** Base64-encoded Float32Array, or null. */
  embedding: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SerializedChunkEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  weight: number;
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Global registry
// ---------------------------------------------------------------------------

export interface GlobalRegistry {
  projects: Record<string, RegistryEntry>;
}

export interface RegistryEntry {
  /** Absolute path of the project root. */
  path: string;
  /** Project name (directory basename). */
  name: string;
  /** Last sync timestamp. */
  lastSync: number;
  /** Git branch when last indexed. Null/undefined if not a git repo. */
  branch?: string | null;
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

export interface ScopeMeta {
  /** Scope name (matches directory name). */
  name: string;
  /** Creation timestamp (ms since epoch). */
  createdAt: number;
}

export interface UserConfig {
  /** Currently active scope name. */
  activeScope: string;
}

export interface ScopeInfo {
  /** Scope name. */
  name: string;
  /** Number of projects in this scope. */
  projectCount: number;
  /** Most recent lastSync across all projects in scope. */
  lastSync: number;
  /** When this scope was created (ms since epoch). */
  createdAt: number;
  /** Whether this is the currently active scope. */
  active: boolean;
}

// ---------------------------------------------------------------------------
// Sync result
// ---------------------------------------------------------------------------

export interface SyncResult {
  added: number;
  updated: number;
  removed: number;
  chunksWritten: number;
  chunksDeleted: number;
  totalNodes: number;
  totalEdges: number;
  totalFiles: number;
  totalChunks: number;
  duration: number;
  storagePath: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function generateChunkId(length: number = 6): string {
  return randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length);
}
