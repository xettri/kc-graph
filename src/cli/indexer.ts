// Re-export from the core storage library.
// The CLI is a thin wrapper — indexing is a library feature.
export { initProject, syncProject } from '../storage/indexer.js';
export type { IndexOptions } from '../storage/indexer.js';
