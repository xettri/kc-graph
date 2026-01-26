import { describe, it, expect } from 'vitest';
import { CodeGraph } from '../../src/core/graph.js';
import { indexDocFile } from '../../src/parser/doc-parser.js';
import { indexSourceFile } from '../../src/parser/typescript-parser.js';

describe('Doc Parser', () => {
  it('should create a doc node for the file', () => {
    const graph = new CodeGraph();
    const md = '# Title\n\nSome content.';
    indexDocFile(graph, 'docs/readme.md', md);

    const fileNode = graph.resolve('docs/readme.md');
    expect(fileNode).toBeDefined();
    expect(fileNode!.type).toBe('doc');
    expect(fileNode!.name).toBe('readme.md');
  });

  it('should parse markdown sections from headings', () => {
    const graph = new CodeGraph();
    const md = `# Getting Started\n\nIntro text.\n\n## Installation\n\nRun npm install.\n\n## Usage\n\nImport the library.`;
    indexDocFile(graph, 'docs/guide.md', md);

    const nodes = [...graph.allNodes()];
    const docNodes = nodes.filter((n) => n.type === 'doc');
    // File node + 3 sections
    expect(docNodes.length).toBe(4);
  });

  it('should create contains edges from file to sections', () => {
    const graph = new CodeGraph();
    const md = `# Title\n\nIntro.\n\n## Section One\n\nContent.`;
    indexDocFile(graph, 'docs/test.md', md);

    const fileNode = graph.resolve('docs/test.md');
    const children = graph.getSuccessors(fileNode!.id, ['contains']);
    expect(children.length).toBeGreaterThan(0);
    expect(children.some((c) => c.name === 'Section One')).toBe(true);
  });

  it('should link doc sections to code nodes via backtick references', () => {
    const graph = new CodeGraph();

    // First add code
    const code = `export function login() { return true; }`;
    indexSourceFile(graph, 'src/auth.ts', code);

    // Then add docs referencing the code
    const md = `# Auth\n\nThe \`login\` function handles authentication.`;
    indexDocFile(graph, 'docs/auth.md', md);

    const edges = [...graph.allEdges()].filter((e) => e.type === 'documents');
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.some((e) => e.target === 'src/auth.ts#login')).toBe(true);
  });

  it('should not link doc nodes to other doc nodes', () => {
    const graph = new CodeGraph();
    const md1 = `# First\n\nAbout \`Second\`.`;
    const md2 = `# Second\n\nSome content.`;
    indexDocFile(graph, 'docs/first.md', md1);
    indexDocFile(graph, 'docs/second.md', md2);

    const edges = [...graph.allEdges()].filter((e) => e.type === 'documents');
    // Should not create documents edge between two docs
    expect(edges.length).toBe(0);
  });

  it('should handle empty markdown', () => {
    const graph = new CodeGraph();
    const count = indexDocFile(graph, 'docs/empty.md', '');
    expect(count).toBe(1); // just the file node
  });

  it('should handle markdown with no sections', () => {
    const graph = new CodeGraph();
    const count = indexDocFile(graph, 'docs/flat.md', 'Just plain text, no headings.');
    expect(count).toBe(1); // just the file node
  });

  it('should store section heading level in metadata', () => {
    const graph = new CodeGraph();
    const md = `# H1\n\nContent.\n\n## H2\n\nMore.\n\n### H3\n\nDeep.`;
    indexDocFile(graph, 'docs/levels.md', md);

    const h2 = graph.resolve('docs/levels.md#H2');
    expect(h2).toBeDefined();
    expect(h2!.metadata['level']).toBe(2);
  });
});
