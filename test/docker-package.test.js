import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8');

test('Dockerfile builds the offline bundle and serves every app asset from a static runtime', () => {
  assert.ok(existsSync(new URL('Dockerfile', root)),
    'Dockerfile must package the existing offline calculator for local container serving');
  const dockerfile = read('Dockerfile');
  const html = read('index.html');
  const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(assets.sort(), ['bundle.js', 'data.js', 'ship-data.js', 'station-v2.css', 'styles.css'].sort(),
    'The test tracks the current public app entry assets');
  assert.match(dockerfile, /FROM\s+node:[^\s]+\s+AS\s+build/i, 'Build stage needs Node');
  assert.match(dockerfile, /RUN\s+npm ci\b/i, 'Build must use the lockfile');
  assert.match(dockerfile, /RUN\s+npm run build\b/i, 'Build must regenerate bundle.js from current sources');
  assert.match(dockerfile, /FROM\s+nginx:[^\s]+/i, 'Final stage must serve static assets');
  assert.match(dockerfile, /COPY\s+--from=build\b/i, 'Runtime assets must come from the build stage');
  for (const asset of ['index.html', ...assets])
    assert.ok(dockerfile.includes(asset), `Runtime package must include ${asset}`);
  assert.match(dockerfile, /EXPOSE\s+80\b/i, 'Image must document its static HTTP port');
});
