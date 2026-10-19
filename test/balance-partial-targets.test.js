import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { optimizeStation } from '../src/engine.js';

const solver = runInNewContext(`${readFileSync(new URL('../vendor/solver.global.js', import.meta.url), 'utf8')}\nsolver`);

test('a missing target for a selected final ware uses the visible default of one module', () => {
  const catalog = { rawWares: ['Ore'], workforceConsumption: {}, recipes: {
    Widget: { kind: 'production', race: 'argon', cycleSeconds: 3600, outputs: { Widget: 1 },
      inputs: { Ore: 1 }, workforce: 0, buildCost: 5 },
    Badge: { kind: 'production', race: 'argon', cycleSeconds: 3600, outputs: { Badge: 1 },
      inputs: { Ore: 1 }, workforce: 0, buildCost: 4 },
  } };
  const station = { modules: {}, sunlight: 1, availableWorkforce: 0,
    prices: {}, finalWares: { Widget: 0.5, Badge: 1.5 }, purchasedIntermediates: [],
    allowedRaces: ['argon'], autoWorkforce: true };
  const result = optimizeStation({ station, catalog,
    objective: { mode: 'build-chain', targetCounts: { Widget: 2 } }, milpSolver: solver });
  assert.equal(result.feasible, true, result.reason);
  assert.deepEqual(result.modules, { Widget: 2, Badge: 1 });
});
