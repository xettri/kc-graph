import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createGzip, createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { CodeGraph } from '../core/graph.js';
import { exportToJSON, importFromJSON } from './json.js';
import type { GraphSnapshot } from '../core/types.js';

/**
 * Save graph to a JSON file.
 */
export async function saveToFile(graph: CodeGraph, filePath: string): Promise<void> {
  const snapshot = exportToJSON(graph);
  const json = JSON.stringify(snapshot);
  await writeFile(filePath, json, 'utf-8');
}

/**
 * Load graph from a JSON file.
 */
export async function loadFromFile(filePath: string): Promise<CodeGraph> {
  const json = await readFile(filePath, 'utf-8');
  const snapshot: GraphSnapshot = JSON.parse(json);
  return importFromJSON(snapshot);
}

/**
 * Save graph to a gzip-compressed file (smaller on disk).
 */
export async function saveCompressed(graph: CodeGraph, filePath: string): Promise<void> {
  const snapshot = exportToJSON(graph);
  const json = JSON.stringify(snapshot);
  const source = Readable.from([json]);
  const gzip = createGzip({ level: 6 });
  const destination = createWriteStream(filePath);
  await pipeline(source, gzip, destination);
}

/**
 * Load graph from a gzip-compressed file.
 */
export async function loadCompressed(filePath: string): Promise<CodeGraph> {
  const chunks: Buffer[] = [];
  const source = createReadStream(filePath);
  const gunzip = createGunzip();

  const collectStream = new (await import('node:stream')).Writable({
    write(chunk: Buffer, _encoding: string, callback: () => void) {
      chunks.push(chunk);
      callback();
    },
  });

  await pipeline(source, gunzip, collectStream);

  const json = Buffer.concat(chunks).toString('utf-8');
  const snapshot: GraphSnapshot = JSON.parse(json);
  return importFromJSON(snapshot);
}
