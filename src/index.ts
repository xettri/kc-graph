// Core
export { CodeGraph } from './core/graph.js';
export { createNode, estimateNodeTokens } from './core/node.js';
export { createEdge } from './core/edge.js';
export type {
  CodeNode,
  CodeEdge,
  CreateNodeInput,
  CreateEdgeInput,
  NodeType,
  EdgeType,
  SourceLocation,
  NodeFilter,
  TraversalOptions,
  ImpactResult,
  ImpactedNode,
  ContextOptions,
  ContextResult,
  SimilarityResult,
  GraphSnapshot,
  SerializedNode,
} from './core/types.js';
export { NODE_TYPES, EDGE_TYPES } from './core/types.js';

// Operations
export { bfs, dfs, kHopNeighborhood } from './operations/traversal.js';
export { query, GraphQuery } from './operations/query.js';
export { analyzeImpact, formatImpactSummary } from './operations/impact.js';
export type { ImpactOptions } from './operations/impact.js';
export { extractSubgraph, getFileStructure } from './operations/subgraph.js';
export type { SubgraphOptions } from './operations/subgraph.js';

// AI
export { buildContext, getContextForSymbol, getContextForFile } from './ai/context-builder.js';
export { cosineSimilarity, findSimilar, setEmbedding, setEmbeddings } from './ai/embeddings.js';
export { scoreRelevance, rankByRelevance } from './ai/relevance.js';
export type { RelevanceWeights } from './ai/relevance.js';

// Parser
export { parseTypeScriptSource, indexSourceFile } from './parser/typescript-parser.js';
export { indexDocFile } from './parser/doc-parser.js';
export type { ParseResult, ParsedNodeInfo, ParsedEdgeInfo, ParserOptions } from './parser/types.js';

// Serialization
export {
  exportToJSON,
  importFromJSON,
  toJSONString,
  fromJSONString,
} from './serialization/json.js';
export {
  saveToFile,
  loadFromFile,
  saveCompressed,
  loadCompressed,
} from './serialization/snapshot.js';

// Storage (chunked persistence)
export { ChunkStore } from './storage/chunk-store.js';
export {
  resolveStore,
  createStore,
  listGlobalProjects,
  loadAllGlobalProjects,
  getGlobalStoragePath,
} from './storage/resolver.js';
export { initProject, syncProject } from './storage/indexer.js';
export type { IndexOptions } from './storage/indexer.js';
export type {
  StorageMeta,
  StorageConfig,
  StorageMap,
  FileEntry,
  ChunkMeta,
  ChunkData,
  SyncResult,
  GlobalRegistry,
  RegistryEntry,
} from './storage/types.js';
export { DEFAULT_CONFIG, generateChunkId } from './storage/types.js';

// File Discovery
export { discoverFiles } from './cli/discover.js';
export type { DiscoverOptions, DiscoveredFile } from './cli/discover.js';

// MCP
export { toolDefinitions, createToolHandlers, singleProject } from './mcp/tools.js';
export { startMcpServer } from './mcp/server.js';
export type { ToolResult, ProjectMap, ProjectEntry } from './mcp/tools.js';

// Viewer
export { startViewer, exportViewerHTML } from './cli/viewer.js';
export type { ViewerOptions } from './cli/viewer.js';
