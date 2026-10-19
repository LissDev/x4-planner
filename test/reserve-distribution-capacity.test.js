import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { calculateStation, optimizeStation } from '../src/engine.js';

const solverSource = readFileSync(new URL('../vendor/solver.global.js', import.meta.url), 'utf8');
const milpSolver = runInNewContext(`${solverSource}\nsolver`);
const recipe = (outputs, inputs, buildCost = 1) => ({
  kind: 'production', race: 'argon', cycleSeconds: 3600, outputs, inputs,
  workforce: 0, buildCost,
});

test('balanced reserve uses all fixed intermediate capacity above 66 final modules per ware', () => {
  const catalog = { rawWares: ['Ore'], workforceConsumption: {}, recipes: {
    Smelter: recipe({ Alloy: 250 }, { Ore: 1 }, 3),
    Widget: recipe({ Widget: 1 }, { Alloy: 1 }),
    Badge: recipe({ Badge: 1 }, { Alloy: 1 }),
  } };
  const station = {
    modules: { Smelter: 1, Widget: 1, Badge: 1 }, sunlight: 1,
    availableWorkforce: 0, autoWorkforce: false, prices: {},
    finalWares: { Widget: 1, Badge: 1 }, targetCounts: { Widget: 1, Badge: 1 },
    purchasedIntermediates: [], ownedSupplyWares: [], allowedRaces: ['argon'],
  };

  const result = optimizeStation({ station, catalog, objective: { mode: 'use-reserve' }, milpSolver });
  assert.equal(result.feasible, true, result.reason);
  assert.deepEqual(result.modules, { Smelter: 1, Widget: 125, Badge: 125 });
  assert.equal(calculateStation({ station: { ...station, modules: result.modules }, catalog }).balance.Alloy, 0);
});
