import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'kc-graph',
  description: 'AI-optimized code intelligence graph for token-efficient context retrieval',
  base: '/kc-graph/',

  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/kc-graph/logo.svg' }]],

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API', link: '/guide/api-reference' },
      { text: 'Examples', link: '/examples/basic-usage' },
      { text: 'Graph Viewer', link: '/graph.html', target: '_blank' },
      {
        text: 'GitHub',
        link: 'https://github.com/xettri/kc-graph',
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Core Concepts', link: '/guide/core-concepts' },
          ],
        },
        {
          text: 'Features',
          items: [
            { text: 'Parsing & Indexing', link: '/guide/parsing' },
            { text: 'Querying & Traversal', link: '/guide/querying' },
            { text: 'AI Context Builder', link: '/guide/ai-context' },
            { text: 'Claude Code Integration', link: '/guide/claude-code' },
          ],
        },
        {
          text: 'Reference',
          items: [{ text: 'API Reference', link: '/guide/api-reference' }],
        },
      ],
      '/examples/': [
        {
          text: 'Examples',
          items: [
            { text: 'Basic Usage', link: '/examples/basic-usage' },
            { text: 'Code Review', link: '/examples/code-review' },
            { text: 'MCP Integration', link: '/examples/mcp-integration' },
          ],
        },
      ],
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/xettri/kc-graph' }],

    search: {
      provider: 'local',
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright 2026 kc-graph contributors',
    },
  },
});
