import type {
  CodeNode,
  CodeEdge,
  CreateNodeInput,
  CreateEdgeInput,
  NodeType,
  EdgeType,
  NodeFilter,
} from './types.js';
import { createNode } from './node.js';
import { createEdge } from './edge.js';

/**
 * CodeGraph — the core knowledge graph data structure.
 *
 * V8-optimized design:
 * - Map<string, T> for all lookups (O(1) amortized, faster than Object for dynamic keys)
 * - Multiple indexes for fast queries by type, file, and name
 * - Adjacency stored as Map<nodeId, Set<edgeId>> for O(1) edge removal
 * - All public methods resolve human-readable identifiers (file + symbol) internally
 */
export class CodeGraph {
  // Primary storage
  private nodes: Map<string, CodeNode> = new Map();
  private edges: Map<string, CodeEdge> = new Map();

  // Adjacency indexes — Set gives O(1) removal vs Array's O(n) indexOf
  private outEdges: Map<string, Set<string>> = new Map();
  private inEdges: Map<string, Set<string>> = new Map();

  // Secondary indexes for fast queries
  private nodesByType: Map<NodeType, Set<string>> = new Map();
  private nodesByFile: Map<string, Set<string>> = new Map();
  private nodesByName: Map<string, Set<string>> = new Map();

  // ---------------------------------------------------------------------------
  // Node CRUD
  // ---------------------------------------------------------------------------

  addNode(input: CreateNodeInput): CodeNode {
    const node = createNode(input);

    if (this.nodes.has(node.id)) {
      return this.nodes.get(node.id)!;
    }

    this.nodes.set(node.id, node);
    this.outEdges.set(node.id, new Set());
    this.inEdges.set(node.id, new Set());

    // Index by type
    let typeSet = this.nodesByType.get(node.type);
    if (!typeSet) {
      typeSet = new Set();
      this.nodesByType.set(node.type, typeSet);
    }
    typeSet.add(node.id);

    // Index by file
    if (node.location) {
      let fileSet = this.nodesByFile.get(node.location.file);
      if (!fileSet) {
        fileSet = new Set();
        this.nodesByFile.set(node.location.file, fileSet);
      }
      fileSet.add(node.id);
    }

    // Index by name (lowercased for case-insensitive lookup)
    const nameLower = node.name.toLowerCase();
    let nameSet = this.nodesByName.get(nameLower);
    if (!nameSet) {
      nameSet = new Set();
      this.nodesByName.set(nameLower, nameSet);
    }
    nameSet.add(node.id);

    return node;
  }

  getNode(id: string): CodeNode | undefined {
    return this.nodes.get(id);
  }

  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  removeNode(id: string): boolean {
    const node = this.nodes.get(id);
    if (!node) return false;

    // Remove all connected edges — snapshot to array since removal mutates the Set
    const outIds = this.outEdges.get(id);
    const inIds = this.inEdges.get(id);

    if (outIds) {
      for (const edgeId of [...outIds]) {
        this.removeEdgeInternal(edgeId);
      }
    }
    if (inIds) {
      for (const edgeId of [...inIds]) {
        this.removeEdgeInternal(edgeId);
      }
    }

    // Remove from indexes
    this.nodesByType.get(node.type)?.delete(id);
    if (node.location) {
      this.nodesByFile.get(node.location.file)?.delete(id);
    }
    this.nodesByName.get(node.name.toLowerCase())?.delete(id);

    // Remove adjacency
    this.outEdges.delete(id);
    this.inEdges.delete(id);

    // Remove node
    this.nodes.delete(id);
    return true;
  }

  updateNode(id: string, updates: Partial<Omit<CodeNode, 'id' | 'type' | 'createdAt'>>): CodeNode {
    const node = this.nodes.get(id);
    if (!node) {
      throw new Error(`Node not found: ${id}`);
    }

    // Handle name index update
    if (updates.name && updates.name !== node.name) {
      this.nodesByName.get(node.name.toLowerCase())?.delete(id);
      const nameLower = updates.name.toLowerCase();
      let nameSet = this.nodesByName.get(nameLower);
      if (!nameSet) {
        nameSet = new Set();
        this.nodesByName.set(nameLower, nameSet);
      }
      nameSet.add(id);
    }

    // Handle file index update
    if (updates.location !== undefined) {
      if (node.location) {
        this.nodesByFile.get(node.location.file)?.delete(id);
      }
      if (updates.location) {
        let fileSet = this.nodesByFile.get(updates.location.file);
        if (!fileSet) {
          fileSet = new Set();
          this.nodesByFile.set(updates.location.file, fileSet);
        }
        fileSet.add(id);
      }
    }

    // Apply updates maintaining property order (V8 hidden class stable)
    if (updates.name !== undefined) node.name = updates.name;
    if (updates.qualifiedName !== undefined) node.qualifiedName = updates.qualifiedName;
    if (updates.content !== undefined) node.content = updates.content;
    if (updates.signature !== undefined) node.signature = updates.signature;
    if (updates.location !== undefined) node.location = updates.location;
    if (updates.metadata !== undefined) node.metadata = updates.metadata;
    if (updates.embedding !== undefined) node.embedding = updates.embedding;
    node.updatedAt = Date.now();

    return node;
  }

  // ---------------------------------------------------------------------------
  // Edge CRUD
  // ---------------------------------------------------------------------------

  addEdge(input: CreateEdgeInput): CodeEdge {
    if (!this.nodes.has(input.source)) {
      throw new Error(`Source node not found: ${input.source}`);
    }
    if (!this.nodes.has(input.target)) {
      throw new Error(`Target node not found: ${input.target}`);
    }

    const edge = createEdge(input);

    if (this.edges.has(edge.id)) {
      throw new Error(`Edge already exists: ${edge.id}`);
    }

    this.edges.set(edge.id, edge);

    // Update adjacency — Set.add is O(1)
    const outSet = this.outEdges.get(edge.source);
    if (outSet) outSet.add(edge.id);

    const inSet = this.inEdges.get(edge.target);
    if (inSet) inSet.add(edge.id);

    return edge;
  }

  getEdge(id: string): CodeEdge | undefined {
    return this.edges.get(id);
  }

  hasEdge(id: string): boolean {
    return this.edges.has(id);
  }

  removeEdge(id: string): boolean {
    return this.removeEdgeInternal(id);
  }

  private removeEdgeInternal(id: string): boolean {
    const edge = this.edges.get(id);
    if (!edge) return false;

    // Remove from adjacency sets — O(1) vs O(n) indexOf on arrays
    this.outEdges.get(edge.source)?.delete(id);
    this.inEdges.get(edge.target)?.delete(id);

    this.edges.delete(id);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Query: Neighbors & Connections
  // ---------------------------------------------------------------------------

  /** Get outbound edges from a node, optionally filtered by edge type. */
  getOutEdges(nodeId: string, edgeTypes?: EdgeType[]): CodeEdge[] {
    const edgeIds = this.outEdges.get(nodeId);
    if (!edgeIds || edgeIds.size === 0) return [];

    // Use Set for edge type filtering when > 2 types (avoids O(n) includes per edge)
    const typeFilter = edgeTypes && edgeTypes.length > 2 ? new Set(edgeTypes) : edgeTypes;

    const result: CodeEdge[] = [];
    for (const eid of edgeIds) {
      const edge = this.edges.get(eid);
      if (edge) {
        if (
          !typeFilter ||
          (typeFilter instanceof Set ? typeFilter.has(edge.type) : typeFilter.includes(edge.type))
        ) {
          result.push(edge);
        }
      }
    }
    return result;
  }

  /** Get inbound edges to a node, optionally filtered by edge type. */
  getInEdges(nodeId: string, edgeTypes?: EdgeType[]): CodeEdge[] {
    const edgeIds = this.inEdges.get(nodeId);
    if (!edgeIds || edgeIds.size === 0) return [];

    const typeFilter = edgeTypes && edgeTypes.length > 2 ? new Set(edgeTypes) : edgeTypes;

    const result: CodeEdge[] = [];
    for (const eid of edgeIds) {
      const edge = this.edges.get(eid);
      if (edge) {
        if (
          !typeFilter ||
          (typeFilter instanceof Set ? typeFilter.has(edge.type) : typeFilter.includes(edge.type))
        ) {
          result.push(edge);
        }
      }
    }
    return result;
  }

  /**
   * Get outbound neighbor IDs without allocating intermediate CodeEdge[] arrays.
   * Used by traversal hot paths (BFS/DFS) where only target IDs are needed.
   */
  getOutNeighborIds(nodeId: string, edgeTypes?: EdgeType[]): string[] {
    const edgeIds = this.outEdges.get(nodeId);
    if (!edgeIds || edgeIds.size === 0) return [];

    const typeFilter = edgeTypes && edgeTypes.length > 2 ? new Set(edgeTypes) : edgeTypes;
    const result: string[] = [];
    for (const eid of edgeIds) {
      const edge = this.edges.get(eid);
      if (edge) {
        if (
          !typeFilter ||
          (typeFilter instanceof Set ? typeFilter.has(edge.type) : typeFilter.includes(edge.type))
        ) {
          result.push(edge.target);
        }
      }
    }
    return result;
  }

  /**
   * Get inbound neighbor IDs without allocating intermediate CodeEdge[] arrays.
   */
  getInNeighborIds(nodeId: string, edgeTypes?: EdgeType[]): string[] {
    const edgeIds = this.inEdges.get(nodeId);
    if (!edgeIds || edgeIds.size === 0) return [];

    const typeFilter = edgeTypes && edgeTypes.length > 2 ? new Set(edgeTypes) : edgeTypes;
    const result: string[] = [];
    for (const eid of edgeIds) {
      const edge = this.edges.get(eid);
      if (edge) {
        if (
          !typeFilter ||
          (typeFilter instanceof Set ? typeFilter.has(edge.type) : typeFilter.includes(edge.type))
        ) {
          result.push(edge.source);
        }
      }
    }
    return result;
  }

  /** Get outbound neighbor nodes. */
  getSuccessors(nodeId: string, edgeTypes?: EdgeType[]): CodeNode[] {
    const edges = this.getOutEdges(nodeId, edgeTypes);
    const result: CodeNode[] = [];
    for (const edge of edges) {
      const node = this.nodes.get(edge.target);
      if (node) result.push(node);
    }
    return result;
  }

  /** Get inbound neighbor nodes. */
  getPredecessors(nodeId: string, edgeTypes?: EdgeType[]): CodeNode[] {
    const edges = this.getInEdges(nodeId, edgeTypes);
    const result: CodeNode[] = [];
    for (const edge of edges) {
      const node = this.nodes.get(edge.source);
      if (node) result.push(node);
    }
    return result;
  }

  /** Get all neighbor nodes (both directions). */
  getNeighbors(nodeId: string, edgeTypes?: EdgeType[]): CodeNode[] {
    const seen = new Set<string>();
    const result: CodeNode[] = [];

    for (const node of this.getSuccessors(nodeId, edgeTypes)) {
      if (!seen.has(node.id)) {
        seen.add(node.id);
        result.push(node);
      }
    }
    for (const node of this.getPredecessors(nodeId, edgeTypes)) {
      if (!seen.has(node.id)) {
        seen.add(node.id);
        result.push(node);
      }
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Query: Search & Filter
  // ---------------------------------------------------------------------------

  /** Find nodes matching a filter. */
  findNodes(filter: NodeFilter): CodeNode[] {
    // Fast path: type-only filter
    if (filter.type && !filter.name && !filter.file && filter.hasEmbedding === undefined) {
      const types = Array.isArray(filter.type) ? filter.type : [filter.type];
      const result: CodeNode[] = [];
      for (const t of types) {
        const ids = this.nodesByType.get(t);
        if (ids) {
          for (const id of ids) {
            const node = this.nodes.get(id);
            if (node) result.push(node);
          }
        }
      }
      return result;
    }

    // Fast path: exact name filter — use O(1) index
    if (filter.name && typeof filter.name === 'string' && !filter.file) {
      const candidates = this.findByName(filter.name);
      if (!filter.type && filter.hasEmbedding === undefined) return candidates;
      const types = filter.type
        ? new Set(Array.isArray(filter.type) ? filter.type : [filter.type])
        : null;
      const result: CodeNode[] = [];
      for (const node of candidates) {
        if (types && !types.has(node.type)) continue;
        if (filter.hasEmbedding !== undefined) {
          if (filter.hasEmbedding !== (node.embedding !== null)) continue;
        }
        result.push(node);
      }
      return result;
    }

    // Fast path: file-only filter
    if (filter.file && typeof filter.file === 'string' && !filter.type && !filter.name) {
      const ids = this.nodesByFile.get(filter.file);
      if (!ids) return [];
      const result: CodeNode[] = [];
      for (const id of ids) {
        const node = this.nodes.get(id);
        if (node) {
          if (filter.hasEmbedding !== undefined) {
            if (filter.hasEmbedding !== (node.embedding !== null)) continue;
          }
          result.push(node);
        }
      }
      return result;
    }

    // General filter: scan all nodes
    // Pre-compute filter values outside the loop to avoid per-node work
    const filterNameLower =
      filter.name && typeof filter.name === 'string' ? filter.name.toLowerCase() : null;
    const filterTypes = filter.type
      ? new Set(Array.isArray(filter.type) ? filter.type : [filter.type])
      : null;
    const filterNameRegex = filter.name instanceof RegExp ? filter.name : null;
    const filterFileStr = filter.file && typeof filter.file === 'string' ? filter.file : null;
    const filterFileRegex = filter.file instanceof RegExp ? filter.file : null;

    const result: CodeNode[] = [];
    for (const node of this.nodes.values()) {
      if (filterTypes && !filterTypes.has(node.type)) continue;
      if (filterNameLower !== null) {
        if (node.name.toLowerCase() !== filterNameLower) continue;
      } else if (filterNameRegex) {
        if (!filterNameRegex.test(node.name)) continue;
      }
      if (filterFileStr !== null) {
        if (!node.location || node.location.file !== filterFileStr) continue;
      } else if (filterFileRegex) {
        if (!node.location || !filterFileRegex.test(node.location.file)) continue;
      }
      if (filter.hasEmbedding !== undefined) {
        if (filter.hasEmbedding !== (node.embedding !== null)) continue;
      }
      result.push(node);
    }

    return result;
  }

  /** Find nodes by exact name (case-insensitive, O(1) via index). */
  findByName(name: string): CodeNode[] {
    const ids = this.nodesByName.get(name.toLowerCase());
    if (!ids) return [];
    const result: CodeNode[] = [];
    for (const id of ids) {
      const node = this.nodes.get(id);
      if (node) result.push(node);
    }
    return result;
  }

  /** Find all nodes in a file. */
  findByFile(filePath: string): CodeNode[] {
    const ids = this.nodesByFile.get(filePath);
    if (!ids) return [];
    const result: CodeNode[] = [];
    for (const id of ids) {
      const node = this.nodes.get(id);
      if (node) result.push(node);
    }
    return result;
  }

  /** Find all nodes of a specific type. */
  findByType(type: NodeType): CodeNode[] {
    const ids = this.nodesByType.get(type);
    if (!ids) return [];
    const result: CodeNode[] = [];
    for (const id of ids) {
      const node = this.nodes.get(id);
      if (node) result.push(node);
    }
    return result;
  }

  /**
   * Resolve a human-readable identifier to a node.
   * Accepts: node ID, qualified name, or symbol name.
   * This is the main entry point for MCP/external consumers.
   */
  resolve(identifier: string, file?: string): CodeNode | undefined {
    // Try direct ID lookup first (O(1))
    const direct = this.nodes.get(identifier);
    if (direct) return direct;

    // Try by name with optional file constraint
    const byName = this.findByName(identifier);
    if (byName.length === 0) return undefined;
    if (byName.length === 1) return byName[0];

    // Multiple matches — narrow by file if provided
    if (file) {
      const filtered = byName.filter((n) => n.location?.file === file);
      if (filtered.length > 0) return filtered[0];
    }

    // Return first match as fallback
    return byName[0];
  }

  // ---------------------------------------------------------------------------
  // Bulk operations
  // ---------------------------------------------------------------------------

  /** Remove all nodes and edges associated with a file path (for incremental re-indexing). */
  removeFile(filePath: string): number {
    const ids = this.nodesByFile.get(filePath);
    if (!ids) return 0;

    const nodeIds = [...ids]; // snapshot — removeNode modifies the set
    let count = 0;
    for (const id of nodeIds) {
      if (this.removeNode(id)) count++;
    }
    this.nodesByFile.delete(filePath);
    return count;
  }

  /** Clear the entire graph. */
  clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.outEdges.clear();
    this.inEdges.clear();
    this.nodesByType.clear();
    this.nodesByFile.clear();
    this.nodesByName.clear();
  }

  // ---------------------------------------------------------------------------
  // Statistics
  // ---------------------------------------------------------------------------

  get nodeCount(): number {
    return this.nodes.size;
  }

  get edgeCount(): number {
    return this.edges.size;
  }

  get fileCount(): number {
    return this.nodesByFile.size;
  }

  /** Get all node IDs. */
  getNodeIds(): string[] {
    return [...this.nodes.keys()];
  }

  /** Get all edge IDs. */
  getEdgeIds(): string[] {
    return [...this.edges.keys()];
  }

  /** Iterate over all nodes. */
  *allNodes(): IterableIterator<CodeNode> {
    yield* this.nodes.values();
  }

  /** Iterate over all edges. */
  *allEdges(): IterableIterator<CodeEdge> {
    yield* this.edges.values();
  }

  /** Get all indexed file paths. */
  getFiles(): string[] {
    return [...this.nodesByFile.keys()];
  }
}
