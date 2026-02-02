import { resolve, basename } from 'node:path';
import { existsSync, statSync, readdirSync } from 'node:fs';
import { resolveStore } from '../storage/resolver.js';
import { discoverFiles } from './discover.js';

export interface StatusInfo {
  project: string;
  storagePath: string;
  lastSync: number;
  staleness: {
    changed: number;
    new: number;
    deleted: number;
    fresh: boolean;
  };
  stats: {
    files: number;
    nodes: number;
    edges: number;
    chunks: number;
    storageSizeBytes: number;
  };
  graph: {
    avgEdgesPerNode: number;
    topConnected: Array<{ name: string; type: string; file: string | null; edges: number }>;
    isolatedNodes: number;
  };
}

/**
 * Get comprehensive status for a project's graph.
 */
export function getProjectStatus(root: string, global: boolean = false): StatusInfo {
  const absRoot = resolve(root);
  const store = resolveStore(absRoot, { global });

  if (!store.exists()) {
    throw new Error(`No graph found for ${absRoot}. Run "kc-graph init" first.`);
  }

  const meta = store.readMeta();
  const map = store.readMap();

  // Calculate storage size
  let storageSizeBytes = 0;
  const chunksDir = resolve(store.storagePath, 'chunks');
  if (existsSync(chunksDir)) {
    for (const file of readdirSync(chunksDir)) {
      try {
        storageSizeBytes += statSync(resolve(chunksDir, file)).size;
      } catch {
        // skip
      }
    }
  }

  // Check staleness by comparing discovered files with indexed state
  const discoveredFiles = discoverFiles({ root: absRoot });
  const discoveredPaths = new Set(discoveredFiles.map((f) => f.relativePath));
  let changed = 0;
  let newCount = 0;
  let deleted = 0;

  for (const file of discoveredFiles) {
    const existing = map.files[file.relativePath];
    if (!existing) {
      newCount++;
    } else {
      try {
        const stat = statSync(file.absolutePath);
        if (Math.floor(stat.mtimeMs) !== existing.mtime) {
          changed++;
        }
      } catch {
        changed++;
      }
    }
  }

  for (const filePath of Object.keys(map.files)) {
    if (!discoveredPaths.has(filePath)) {
      deleted++;
    }
  }

  // Load graph for connectivity analysis
  const graph = store.loadGraph();

  // Calculate average edges per node
  const avgEdgesPerNode = graph.nodeCount > 0 ? graph.edgeCount / graph.nodeCount : 0;

  // Find top connected nodes (by total edges: in + out)
  const connectivity: Array<{
    name: string;
    type: string;
    file: string | null;
    edges: number;
  }> = [];

  for (const node of graph.allNodes()) {
    if (node.type === 'file') continue; // skip file nodes
    const outCount = graph.getOutEdges(node.id).length;
    const inCount = graph.getInEdges(node.id).length;
    connectivity.push({
      name: node.name,
      type: node.type,
      file: node.location?.file ?? null,
      edges: outCount + inCount,
    });
  }

  connectivity.sort((a, b) => b.edges - a.edges);
  const topConnected = connectivity.slice(0, 5);

  // Count isolated nodes (no edges at all)
  let isolatedNodes = 0;
  for (const node of graph.allNodes()) {
    if (node.type === 'file') continue;
    const out = graph.getOutEdges(node.id);
    const inE = graph.getInEdges(node.id);
    if (out.length === 0 && inE.length === 0) {
      isolatedNodes++;
    }
  }

  return {
    project: basename(absRoot),
    storagePath: store.storagePath,
    lastSync: meta.lastSync,
    staleness: {
      changed,
      new: newCount,
      deleted,
      fresh: changed === 0 && newCount === 0 && deleted === 0,
    },
    stats: {
      files: meta.stats.files,
      nodes: meta.stats.nodes,
      edges: meta.stats.edges,
      chunks: meta.stats.chunks,
      storageSizeBytes,
    },
    graph: {
      avgEdgesPerNode: Math.round(avgEdgesPerNode * 100) / 100,
      topConnected,
      isolatedNodes,
    },
  };
}

/**
 * CLI entry point for `kc-graph status`.
 */
export function runStatus(args: { path: string; global: boolean }): void {
  const root = resolve(args.path);

  if (!existsSync(root)) {
    console.error(`Error: directory not found: ${root}`);
    process.exit(1);
  }

  let status: StatusInfo;
  try {
    status = getProjectStatus(root, args.global);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  const syncAgo = status.lastSync > 0 ? timeSince(status.lastSync) : 'never';

  console.log(`Project: ${status.project}`);
  console.log(`Storage: ${status.storagePath}`);
  console.log(`Last sync: ${syncAgo}`);
  console.log('');

  // Staleness
  if (status.staleness.fresh) {
    console.log('Status: up to date');
  } else {
    const parts: string[] = [];
    if (status.staleness.changed > 0) parts.push(`${status.staleness.changed} changed`);
    if (status.staleness.new > 0) parts.push(`${status.staleness.new} new`);
    if (status.staleness.deleted > 0) parts.push(`${status.staleness.deleted} deleted`);
    console.log(`Status: stale (${parts.join(', ')} — run "kc-graph sync")`);
  }

  console.log('');
  console.log('Graph:');
  console.log(
    `  ${status.stats.files} files, ${status.stats.nodes} nodes, ${status.stats.edges} edges`,
  );
  console.log(`  ${status.stats.chunks} chunks (${formatBytes(status.stats.storageSizeBytes)})`);
  console.log(
    `  ${status.graph.avgEdgesPerNode} avg edges/node, ${status.graph.isolatedNodes} isolated`,
  );

  if (status.graph.topConnected.length > 0) {
    console.log('');
    console.log('Most connected:');
    for (const node of status.graph.topConnected) {
      const loc = node.file ? ` (${node.file})` : '';
      console.log(`  ${node.name} [${node.type}] — ${node.edges} edges${loc}`);
    }
  }
}

function timeSince(epochMs: number): string {
  const seconds = Math.floor((Date.now() - epochMs) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
