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
const station = (modules, targetCounts = { Widget: 1, Badge: 1 }) => ({
  modules, sunlight: 1, availableWorkforce: 0, autoWorkforce: false,
  prices: {}, finalWares: { Widget: 1, Badge: 1 }, targetCounts,
  purchasedIntermediates: [], ownedSupplyWares: [], allowedRaces: ['argon'],
});
const reserve = (settings, catalog) => optimizeStation({ station: settings, catalog,
  objective: { mode: 'use-reserve' }, milpSolver });

test('shared Alloy grows both equal starting finals before spending leftovers on one', () => {
  const catalog = { rawWares: ['Ore'], workforceConsumption: {}, recipes: {
    Smelter: recipe({ Alloy: 7 }, { Ore: 1 }, 3),
    Widget: recipe({ Widget: 1 }, { Alloy: 1 }, 1),
    Badge: recipe({ Badge: 1 }, { Alloy: 2 }, 1),
  } };
  const settings = station({ Smelter: 1, Widget: 1, Badge: 1 });
  const result = reserve(settings, catalog);
  assert.equal(result.feasible, true, result.reason);
  assert.deepEqual(result.modules, { Smelter: 1, Widget: 3, Badge: 2 });
  assert.equal(calculateStation({ station: { ...settings, modules: result.modules }, catalog }).balance.Alloy, 0);
});

test('relative growth uses actual unequal final counts even when stored targets are stale', () => {
  const catalog = { rawWares: ['Ore'], workforceConsumption: {}, recipes: {
    Smelter: recipe({ Alloy: 9 }, { Ore: 1 }, 3),
    Widget: recipe({ Widget: 1 }, { Alloy: 1 }, 1),
    Badge: recipe({ Badge: 1 }, { Alloy: 2 }, 1),
  } };
  const settings = station({ Smelter: 1, Widget: 2, Badge: 1 },
    { Widget: 1, Badge: 9 });
  const result = reserve(settings, catalog);
  assert.equal(result.feasible, true, result.reason);
  assert.deepEqual(result.modules, { Smelter: 1, Widget: 5, Badge: 2 });
  assert.equal(calculateStation({ station: { ...settings, modules: result.modules }, catalog }).balance.Alloy, 0);
});

test('a final ware blocked by its own input does not strand another ware’s reserve', () => {
  const catalog = { rawWares: ['Ore'], workforceConsumption: {}, recipes: {
    Smelter: recipe({ Alloy: 3 }, { Ore: 1 }, 3),
    RarePlant: recipe({ Rare: 1 }, { Ore: 1 }, 3),
    Widget: recipe({ Widget: 1 }, { Alloy: 1 }, 1),
    Badge: recipe({ Badge: 1 }, { Rare: 1 }, 1),
  } };
  const settings = station({ Smelter: 1, RarePlant: 1, Widget: 1, Badge: 1 });
  const result = reserve(settings, catalog);
  assert.equal(result.feasible, true, result.reason);
  assert.deepEqual(result.modules, { Smelter: 1, RarePlant: 1, Widget: 3, Badge: 1 });
});
