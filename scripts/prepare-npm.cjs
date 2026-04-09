#!/usr/bin/env node

const { readFileSync, writeFileSync, copyFileSync, existsSync } = require('fs');
const { join } = require('path');

const root = join(__dirname, '..');
const dist = join(root, 'dist');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));

const distPkg = {
  name: pkg.name,
  version: pkg.version,
  description: pkg.description,
  repository: pkg.repository,
  bugs: pkg.bugs,
  homepage: pkg.homepage,
  type: 'module',
  main: './cjs/index.js',
  module: './esm/index.js',
  types: './esm/index.d.ts',
  exports: {
    '.': {
      import: {
        types: './esm/index.d.ts',
        default: './esm/index.js',
      },
      require: {
        types: './cjs/index.d.ts',
        default: './cjs/index.js',
      },
    },
  },
  bin: {
    'kc-graph': './cjs/cli/cli.js',
  },
  keywords: pkg.keywords,
  author: pkg.author,
  license: pkg.license,
  engines: pkg.engines,
  dependencies: pkg.dependencies,
};

writeFileSync(join(dist, 'package.json'), JSON.stringify(distPkg, null, 2));

// Copy LICENSE and README
for (const file of ['LICENSE', 'README.md']) {
  if (existsSync(join(root, file))) {
    copyFileSync(join(root, file), join(dist, file));
  }
}

console.log(`Prepared dist/package.json (${distPkg.name}@${distPkg.version})`);
