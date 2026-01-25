import type { CodeGraph } from '../core/graph.js';

/**
 * Parse a markdown documentation file and add it to the graph.
 * Links doc nodes to code nodes when symbol names are mentioned.
 */
export function indexDocFile(
  graph: CodeGraph,
  filePath: string,
  content: string,
): number {
  // Create a doc node for the file
  const docNode = graph.addNode({
    type: 'doc',
    name: getFileName(filePath),
    qualifiedName: filePath,
    content,
    location: {
      file: filePath,
      startLine: 1,
      endLine: content.split('\n').length,
      startColumn: 0,
      endColumn: 0,
    },
    metadata: { format: 'markdown' },
  });

  // Parse sections (headings)
  const sections = parseMarkdownSections(content);
  let nodesAdded = 1;

  for (const section of sections) {
    const sectionNode = graph.addNode({
      type: 'doc',
      name: section.title,
      qualifiedName: `${filePath}#${section.title}`,
      content: section.content,
      location: {
        file: filePath,
        startLine: section.startLine,
        endLine: section.endLine,
        startColumn: 0,
        endColumn: 0,
      },
      metadata: { level: section.level },
    });
    nodesAdded++;

    // Link section to file doc
    graph.addEdge({
      source: docNode.id,
      target: sectionNode.id,
      type: 'contains',
    });

    // Try to link doc sections to code nodes by symbol name matching
    linkDocToCode(graph, sectionNode.id, section.content);
  }

  return nodesAdded;
}

interface MarkdownSection {
  title: string;
  content: string;
  level: number;
  startLine: number;
  endLine: number;
}

function parseMarkdownSections(content: string): MarkdownSection[] {
  const lines = content.split('\n');
  const sections: MarkdownSection[] = [];
  let currentSection: MarkdownSection | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);

    if (headingMatch) {
      if (currentSection) {
        currentSection.endLine = i;
        currentSection.content = currentSection.content.trim();
        if (currentSection.content) {
          sections.push(currentSection);
        }
      }

      currentSection = {
        title: headingMatch[2]!.trim(),
        content: '',
        level: headingMatch[1]!.length,
        startLine: i + 1,
        endLine: lines.length,
      };
    } else if (currentSection) {
      currentSection.content += line + '\n';
    }
  }

  if (currentSection) {
    currentSection.content = currentSection.content.trim();
    if (currentSection.content) {
      sections.push(currentSection);
    }
  }

  return sections;
}

/**
 * Link a doc node to code nodes by finding symbol name mentions.
 * Uses backtick-wrapped code references (e.g., `functionName`).
 */
function linkDocToCode(graph: CodeGraph, docNodeId: string, content: string): void {
  // Extract backtick-wrapped references
  const codeRefs = content.match(/`([a-zA-Z_$][\w$.]*)`/g);
  if (!codeRefs) return;

  const linked = new Set<string>();

  for (const ref of codeRefs) {
    const symbolName = ref.slice(1, -1); // remove backticks
    const codeNodes = graph.findByName(symbolName);

    for (const codeNode of codeNodes) {
      if (codeNode.type === 'doc') continue; // don't link doc to doc
      if (linked.has(codeNode.id)) continue;
      linked.add(codeNode.id);

      graph.addEdge({
        source: docNodeId,
        target: codeNode.id,
        type: 'documents',
      });
    }
  }
}

function getFileName(filePath: string): string {
  const parts = filePath.split('/');
  return parts[parts.length - 1] ?? filePath;
}
