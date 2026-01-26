import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { CodeGraph } from '../core/graph.js';
import type { CodeNode, CodeEdge, NodeType, EdgeType } from '../core/types.js';
import type {
  StorageMeta,
  StorageMap,
  StorageConfig,
  ChunkData,
  SerializedChunkNode,
  SerializedChunkEdge,
} from './types.js';
import { DEFAULT_CONFIG, generateChunkId } from './types.js';

const STORAGE_VERSION = '2.0';
const META_FILE = 'meta.json';
const MAP_FILE = 'map.json';
const CHUNKS_DIR = 'chunks';

// ---------------------------------------------------------------------------
// ChunkStore — read/write graph data as chunked files
// ---------------------------------------------------------------------------

export class ChunkStore {
  readonly storagePath: string;
  private config: StorageConfig;

  constructor(storagePath: string, config?: Partial<StorageConfig>) {
    this.storagePath = storagePath;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // -------------------------------------------------------------------------
  // Init / Exists
  // -------------------------------------------------------------------------

  /** Check if this storage has been initialized. */
  exists(): boolean {
    return existsSync(join(this.storagePath, META_FILE));
  }

  /** Initialize empty storage directory. */
  init(projectPath: string): void {
    mkdirSync(this.storagePath, { recursive: true });
    mkdirSync(join(this.storagePath, CHUNKS_DIR), { recursive: true });

    const meta: StorageMeta = {
      version: STORAGE_VERSION,
      config: this.config,
      project: projectPath,
      lastSync: 0,
      stats: { files: 0, nodes: 0, edges: 0, chunks: 0 },
    };

    const map: StorageMap = { files: {}, chunks: {} };

    writeFileSync(join(this.storagePath, META_FILE), JSON.stringify(meta, null, 2));
    writeFileSync(join(this.storagePath, MAP_FILE), JSON.stringify(map));
  }

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  readMeta(): StorageMeta {
    return JSON.parse(readFileSync(join(this.storagePath, META_FILE), 'utf-8'));
  }

  readMap(): StorageMap {
    return JSON.parse(readFileSync(join(this.storagePath, MAP_FILE), 'utf-8'));
  }

  readChunk(chunkId: string): ChunkData {
    const path = join(this.storagePath, CHUNKS_DIR, `${chunkId}.json`);
    return JSON.parse(readFileSync(path, 'utf-8'));
  }

  /** Load the full graph from all chunks into a CodeGraph. */
  loadGraph(): CodeGraph {
    const map = this.readMap();
    const graph = new CodeGraph();

    // Phase 1: load all nodes from all chunks
    const allEdges: SerializedChunkEdge[] = [];

    for (const chunkId of Object.keys(map.chunks)) {
      const chunk = this.readChunk(chunkId);

      for (const sn of chunk.nodes) {
        graph.addNode({
          id: sn.id,
          type: sn.type as NodeType,
          name: sn.name,
          qualifiedName: sn.qualifiedName,
          content: sn.content,
          signature: sn.signature,
          location: sn.location,
          metadata: sn.metadata,
          embedding: sn.embedding ? base64ToFloat32(sn.embedding) : null,
        });
      }

      allEdges.push(...chunk.edges);
    }

    // Phase 2: add all edges (nodes must exist first)
    for (const se of allEdges) {
      if (graph.hasNode(se.source) && graph.hasNode(se.target)) {
        try {
          graph.addEdge({
            id: se.id,
            source: se.source,
            target: se.target,
            type: se.type as EdgeType,
            weight: se.weight,
            metadata: se.metadata,
          });
        } catch {
          // skip duplicate edges
        }
      }
    }

    return graph;
  }

  // -------------------------------------------------------------------------
  // Write
  // -------------------------------------------------------------------------

  /** Write a chunk to disk. Returns the serialized size. */
  writeChunk(chunk: ChunkData): number {
    const json = JSON.stringify(chunk);
    const path = join(this.storagePath, CHUNKS_DIR, `${chunk.id}.json`);
    writeFileSync(path, json);
    return Buffer.byteLength(json, 'utf-8');
  }

  /** Delete a chunk file. */
  deleteChunk(chunkId: string): void {
    const path = join(this.storagePath, CHUNKS_DIR, `${chunkId}.json`);
    if (existsSync(path)) unlinkSync(path);
  }

  /** Write the map file. */
  writeMap(map: StorageMap): void {
    writeFileSync(join(this.storagePath, MAP_FILE), JSON.stringify(map));
  }

  /** Write the meta file. */
  writeMeta(meta: StorageMeta): void {
    writeFileSync(join(this.storagePath, META_FILE), JSON.stringify(meta, null, 2));
  }

  // -------------------------------------------------------------------------
  // Save graph (full write with chunking)
  // -------------------------------------------------------------------------

  /**
   * Save a full graph to chunked storage.
   * Groups nodes by file directory, splits large chunks by size.
   */
  saveGraph(graph: CodeGraph, projectPath: string): void {
    const map: StorageMap = { files: {}, chunks: {} };

    // Group nodes by source file
    const nodesByFile = new Map<string, CodeNode[]>();
    for (const node of graph.allNodes()) {
      const file = node.location?.file ?? '__virtual__';
      let list = nodesByFile.get(file);
      if (!list) {
        list = [];
        nodesByFile.set(file, list);
      }
      list.push(node);
    }

    // Group files by parent directory
    const dirGroups = new Map<string, string[]>();
    for (const filePath of nodesByFile.keys()) {
      const dir = getParentDir(filePath);
      let files = dirGroups.get(dir);
      if (!files) {
        files = [];
        dirGroups.set(dir, files);
      }
      files.push(filePath);
    }

    // Build edges index: source node → edges
    const edgesBySource = new Map<string, CodeEdge[]>();
    for (const edge of graph.allEdges()) {
      let list = edgesBySource.get(edge.source);
      if (!list) {
        list = [];
        edgesBySource.set(edge.source, list);
      }
      list.push(edge);
    }

    // Create chunks from directory groups, split by size
    for (const [_dir, files] of dirGroups) {
      const groupNodes: CodeNode[] = [];
      const groupEdges: CodeEdge[] = [];

      for (const file of files) {
        const nodes = nodesByFile.get(file) ?? [];
        groupNodes.push(...nodes);
        for (const node of nodes) {
          const edges = edgesBySource.get(node.id);
          if (edges) groupEdges.push(...edges);
        }
      }

      // Estimate serialized size
      const estimatedSize = estimateSize(groupNodes, groupEdges);

      if (estimatedSize <= this.config.chunkSize) {
        // Fits in one chunk
        const chunkId = generateChunkId(this.config.chunkIdLength);
        const chunk = buildChunkData(chunkId, groupNodes, groupEdges);
        const size = this.writeChunk(chunk);

        map.chunks[chunkId] = { size, nodes: chunk.nodes.length, edges: chunk.edges.length };
        for (const file of files) {
          const fileStat = this.safeFileStat(projectPath, file);
          map.files[file] = {
            mtime: fileStat.mtime,
            size: fileStat.size,
            chunks: [chunkId],
          };
        }
      } else {
        // Too big — split per file, then by symbol if needed
        for (const file of files) {
          const fileNodes = nodesByFile.get(file) ?? [];
          const fileEdges: CodeEdge[] = [];
          for (const node of fileNodes) {
            const edges = edgesBySource.get(node.id);
            if (edges) fileEdges.push(...edges);
          }

          const fileChunkIds = this.writeNodesSplit(fileNodes, fileEdges, map);
          const fileStat = this.safeFileStat(projectPath, file);
          map.files[file] = {
            mtime: fileStat.mtime,
            size: fileStat.size,
            chunks: fileChunkIds,
          };
        }
      }
    }

    // Write map and meta
    this.writeMap(map);

    const meta: StorageMeta = {
      version: STORAGE_VERSION,
      config: this.config,
      project: projectPath,
      lastSync: Date.now(),
      stats: {
        files: Object.keys(map.files).length,
        nodes: graph.nodeCount,
        edges: graph.edgeCount,
        chunks: Object.keys(map.chunks).length,
      },
    };
    this.writeMeta(meta);
  }

  /**
   * Split nodes into chunks respecting size threshold.
   * Returns array of chunk IDs written.
   */
  private writeNodesSplit(
    nodes: CodeNode[],
    edges: CodeEdge[],
    map: StorageMap,
  ): string[] {
    const chunkIds: string[] = [];

    // Build edge index: source node → edges
    const edgesByNode = new Map<string, CodeEdge[]>();
    for (const edge of edges) {
      let list = edgesByNode.get(edge.source);
      if (!list) {
        list = [];
        edgesByNode.set(edge.source, list);
      }
      list.push(edge);
    }

    // Group by top-level parent (class/namespace) for logical splitting
    const groups = groupByTopLevel(nodes);
    let currentNodes: CodeNode[] = [];
    let currentEdges: CodeEdge[] = [];
    let currentSize = 0;

    const flush = (): void => {
      if (currentNodes.length === 0) return;
      const chunkId = generateChunkId(this.config.chunkIdLength);
      const chunk = buildChunkData(chunkId, currentNodes, currentEdges);
      const size = this.writeChunk(chunk);
      map.chunks[chunkId] = { size, nodes: chunk.nodes.length, edges: chunk.edges.length };
      chunkIds.push(chunkId);
      currentNodes = [];
      currentEdges = [];
      currentSize = 0;
    };

    for (const group of groups) {
      const groupEdges: CodeEdge[] = [];
      for (const node of group.nodes) {
        const nodeEdges = edgesByNode.get(node.id);
        if (nodeEdges) groupEdges.push(...nodeEdges);
      }
      const groupSize = estimateSize(group.nodes, groupEdges);

      // If adding this group exceeds threshold, flush current batch first
      if (currentSize + groupSize > this.config.chunkSize && currentNodes.length > 0) {
        flush();
      }

      currentNodes.push(...group.nodes);
      currentEdges.push(...groupEdges);
      currentSize += groupSize;
    }

    flush();
    return chunkIds;
  }

  // -------------------------------------------------------------------------
  // Incremental sync
  // -------------------------------------------------------------------------

  /**
   * Sync specific files into the store.
   * Only rewrites chunks for the given files.
   */
  syncFiles(
    graph: CodeGraph,
    changedFiles: string[],
    deletedFiles: string[],
    projectPath: string,
  ): { chunksWritten: number; chunksDeleted: number } {
    const map = this.readMap();
    const orphanChunks = new Set<string>();
    let chunksWritten = 0;
    let chunksDeleted = 0;

    // Remove deleted files
    for (const file of deletedFiles) {
      const entry = map.files[file];
      if (entry) {
        for (const chunkId of entry.chunks) {
          orphanChunks.add(chunkId);
        }
        delete map.files[file];
      }
    }

    // Build edges index
    const edgesBySource = new Map<string, CodeEdge[]>();
    for (const edge of graph.allEdges()) {
      let list = edgesBySource.get(edge.source);
      if (!list) {
        list = [];
        edgesBySource.set(edge.source, list);
      }
      list.push(edge);
    }

    // Rewrite chunks for changed files
    for (const file of changedFiles) {
      // Mark old chunks as potentially orphaned
      const oldEntry = map.files[file];
      if (oldEntry) {
        for (const chunkId of oldEntry.chunks) {
          orphanChunks.add(chunkId);
        }
      }

      // Get nodes for this file from the graph
      const fileNodes = graph.findByFile(file);
      if (fileNodes.length === 0) {
        delete map.files[file];
        continue;
      }

      const fileEdges: CodeEdge[] = [];
      for (const node of fileNodes) {
        const edges = edgesBySource.get(node.id);
        if (edges) fileEdges.push(...edges);
      }

      const chunkIds = this.writeNodesSplit(fileNodes, fileEdges, map);
      chunksWritten += chunkIds.length;

      // Remove these new chunks from orphan set
      for (const id of chunkIds) {
        orphanChunks.delete(id);
      }

      const fileStat = this.safeFileStat(projectPath, file);
      map.files[file] = {
        mtime: fileStat.mtime,
        size: fileStat.size,
        chunks: chunkIds,
      };
    }

    // Check if orphan chunks are still referenced by other files
    const referencedChunks = new Set<string>();
    for (const entry of Object.values(map.files)) {
      for (const chunkId of entry.chunks) {
        referencedChunks.add(chunkId);
      }
    }

    for (const chunkId of orphanChunks) {
      if (!referencedChunks.has(chunkId)) {
        this.deleteChunk(chunkId);
        delete map.chunks[chunkId];
        chunksDeleted++;
      }
    }

    this.writeMap(map);
    return { chunksWritten, chunksDeleted };
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  /** Remove orphan chunk files not referenced by map.json. */
  cleanup(): number {
    const map = this.readMap();
    const referenced = new Set(Object.keys(map.chunks));
    const chunksDir = join(this.storagePath, CHUNKS_DIR);
    let deleted = 0;

    if (!existsSync(chunksDir)) return 0;

    for (const file of readdirSync(chunksDir)) {
      const id = file.replace(/\.json$/, '');
      if (!referenced.has(id)) {
        unlinkSync(join(chunksDir, file));
        deleted++;
      }
    }

    return deleted;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private safeFileStat(projectPath: string, relPath: string): { mtime: number; size: number } {
    try {
      const abs = join(projectPath, relPath);
      const stat = statSync(abs);
      return { mtime: Math.floor(stat.mtimeMs), size: stat.size };
    } catch {
      return { mtime: 0, size: 0 };
    }
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function getParentDir(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx === -1 ? '.' : filePath.slice(0, idx);
}

function estimateSize(nodes: CodeNode[], edges: CodeEdge[]): number {
  let size = 0;
  for (const n of nodes) {
    size += n.content.length + n.signature.length + n.name.length + n.qualifiedName.length + 200;
    if (n.embedding) size += n.embedding.length * 6; // base64 overhead
  }
  for (const e of edges) {
    size += e.source.length + e.target.length + e.type.length + 100;
  }
  return size;
}

interface SymbolGroup {
  name: string;
  nodes: CodeNode[];
}

function groupByTopLevel(nodes: CodeNode[]): SymbolGroup[] {
  // Group: file nodes alone, classes with their methods, standalone functions/vars/types
  const groups: SymbolGroup[] = [];
  const classNodes = new Map<string, CodeNode[]>();

  for (const node of nodes) {
    if (node.type === 'file') {
      groups.push({ name: node.name, nodes: [node] });
    } else if (node.type === 'class') {
      classNodes.set(node.id, [node]);
    } else if (node.qualifiedName.includes('.') && node.type === 'function') {
      // Method — find parent class
      const dotIdx = node.qualifiedName.lastIndexOf('.');
      const parentQN = node.qualifiedName.slice(0, dotIdx);
      const parentList = classNodes.get(parentQN);
      if (parentList) {
        parentList.push(node);
      } else {
        groups.push({ name: node.name, nodes: [node] });
      }
    } else {
      groups.push({ name: node.name, nodes: [node] });
    }
  }

  // Add class groups
  for (const [_id, classGroup] of classNodes) {
    groups.push({ name: classGroup[0]!.name, nodes: classGroup });
  }

  return groups;
}

function buildChunkData(
  id: string,
  nodes: CodeNode[],
  edges: CodeEdge[],
): ChunkData {
  return {
    id,
    nodes: nodes.map(serializeNode),
    edges: edges.map(serializeEdge),
  };
}

function serializeNode(node: CodeNode): SerializedChunkNode {
  return {
    id: node.id,
    type: node.type,
    name: node.name,
    qualifiedName: node.qualifiedName,
    content: node.content,
    signature: node.signature,
    location: node.location,
    metadata: node.metadata,
    embedding: node.embedding ? float32ToBase64(node.embedding) : null,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  };
}

function serializeEdge(edge: CodeEdge): SerializedChunkEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: edge.type,
    weight: edge.weight,
    metadata: edge.metadata,
  };
}

function float32ToBase64(arr: Float32Array): string {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString('base64');
}

function base64ToFloat32(b64: string): Float32Array {
  const buf = Buffer.from(b64, 'base64');
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}
