import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { calculateStation, optimizeStation } from '../src/engine.js';

const solverSource = readFileSync(new URL('../vendor/solver.global.js', import.meta.url), 'utf8');
const milpSolver = runInNewContext(`${solverSource}\nsolver`);
const catalog = {
  rawWares: ['Ore'], workforceConsumption: {},
  recipes: {
    Smelter: { cycleSeconds: 3600, outputs: { Alloy: 1 }, inputs: { Ore: 1 }, workforce: 0, buildCost: 4 },
    Widget: { cycleSeconds: 3600, outputs: { Widget: 1 }, inputs: { Alloy: 1 }, workforce: 0, buildCost: 6 },
    Badge: { cycleSeconds: 3600, outputs: { Badge: 1 }, inputs: { Alloy: 1 }, workforce: 0, buildCost: 5 },
    Solar: { cycleSeconds: 3600, outputs: { Energy: 1 }, inputs: {}, workforce: 0, buildCost: 2, sunlightScaled: true },
    EnergyWidget: { cycleSeconds: 3600, outputs: { Widget: 1 }, inputs: { Energy: 1 }, workforce: 0, buildCost: 8 },
  },
};
const chainCatalog = { ...catalog, recipes: {
  Smelter: catalog.recipes.Smelter, Widget: catalog.recipes.Widget, Badge: catalog.recipes.Badge,
} };
const station = (overrides = {}) => ({
  modules: {}, sunlight: 1, availableWorkforce: 0,
  prices: { Ore: 2, Alloy: 9, Widget: 30, Badge: 20, Energy: 1 },
  finalWares: { Widget: 1 }, purchasedIntermediates: [], ...overrides,
});
const solve = (input, data, objective) => optimizeStation({ station: input, catalog: data, objective, milpSolver });

test('vendored MILP respects budget, 1:1 ratios, integer modules, and full chain', () => {
  const result = solve(station({ finalWares: { Widget: 1, Badge: 1 } }), chainCatalog,
    { mode: 'max-output', budget: 37 });
  assert.equal(result.feasible, true);
  assert.deepEqual(result.modules, { Smelter: 2, Widget: 1, Badge: 1 });
  assert.deepEqual(result.finalOutput, { Widget: 1, Badge: 1 });
  assert.equal(result.constructionCost, 19);
  assert.ok(Object.values(result.modules).every(Number.isSafeInteger));
});

test('vendored MILP preserves unequal 2:1 final output ratios', () => {
  const result = solve(station({ finalWares: { Widget: 2, Badge: 1 } }), chainCatalog,
    { mode: 'max-output', budget: 40 });
  assert.equal(result.feasible, true);
  assert.deepEqual(result.modules, { Smelter: 3, Widget: 2, Badge: 1 });
  assert.deepEqual(result.finalOutput, { Widget: 2, Badge: 1 });
  assert.equal(result.constructionCost, 29);
});

test('vendored MILP minimizes construction cost at target net profit with internal inputs', () => {
  const result = solve(station(), chainCatalog, { mode: 'min-cost', targetProfit: 40 });
  assert.equal(result.feasible, true);
  assert.deepEqual(result.modules, { Smelter: 2, Widget: 2 });
  assert.equal(result.constructionCost, 20);
  assert.equal(result.hourlyProfit, 56);
  assert.deepEqual(calculateStation({ station: station({ modules: result.modules }), catalog: chainCatalog }).purchases, { Ore: 2 });
});

test('vendored MILP can import an explicitly purchased intermediate', () => {
  const result = solve(station({ purchasedIntermediates: ['Alloy'] }), chainCatalog,
    { mode: 'min-cost', targetProfit: 40 });
  assert.equal(result.feasible, true);
  assert.deepEqual(result.modules, { Widget: 2 });
  assert.equal(result.constructionCost, 12);
  assert.equal(result.hourlyProfit, 42);
});

test('vendored MILP treats zero sunlight as infeasible for an energy-only chain', () => {
  const energyCatalog = { ...catalog, recipes: { Solar: catalog.recipes.Solar, EnergyWidget: catalog.recipes.EnergyWidget } };
  assert.equal(solve(station({ sunlight: 1 }), energyCatalog,
    { mode: 'min-cost', targetProfit: 1 }).feasible, true);
  assert.equal(solve(station({ sunlight: 0 }), energyCatalog,
    { mode: 'min-cost', targetProfit: 1 }).feasible, false);
});
