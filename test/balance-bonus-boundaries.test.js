import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { calculateStation, optimizeStation } from '../src/engine.js';

const solverSource = readFileSync(new URL('../vendor/solver.global.js', import.meta.url), 'utf8');
const milpSolver = runInNewContext(`${solverSource}\nsolver`);
const recipe = (outputs, inputs, buildCost, extras = {}) => ({
  kind: 'production', race: 'argon', cycleSeconds: 3600, outputs, inputs,
  workforce: 1, buildCost, ...extras,
});
const station = (overrides = {}) => ({
  modules: {}, sunlight: 1, availableWorkforce: 1, autoWorkforce: false,
  prices: {}, finalWares: { Widget: 1 }, targetCounts: { Widget: 1 },
  purchasedIntermediates: [], ownedSupplyWares: [], allowedRaces: ['argon'],
  ...overrides,
});
const plan = (settings, catalog, objective) =>
  optimizeStation({ station: settings, catalog, objective, milpSolver });

test('reserve finds a finite maximum when manual staffing dilutes a self-feeding production bonus', () => {
  const catalog = { rawWares: [], workforceConsumption: {}, recipes: {
    Widget: recipe({ Widget: 0.5 }, { Widget: 1 }, 1, { workforceBonus: 1 }),
  } };
  const settings = station({ modules: { Widget: 1 }, availableWorkforce: 2 });
  const two = calculateStation({ station: { ...settings, modules: { Widget: 2 } }, catalog });
  const three = calculateStation({ station: { ...settings, modules: { Widget: 3 } }, catalog });
  assert.equal(two.balance.Widget, 0, 'Two modules can sustain their own input');
  assert.equal(three.balance.Widget, -0.5, 'A third dilutes the worker bonus and creates a deficit');

  const result = plan(settings, catalog, { mode: 'use-reserve' });
  assert.equal(result.feasible, true, result.reason);
  assert.equal(result.modules.Widget, 2);
});

test('build chain uses the cheapest feasible manual-worker bonus plan', () => {
  const catalog = { rawWares: ['Ore'], workforceConsumption: {}, recipes: {
    Smelter: recipe({ Alloy: 0.75 }, { Ore: 1 }, 2, { workforceBonus: 1 }),
    Widget: recipe({ Widget: 1 }, { Alloy: 1 }, 3),
  } };
  const settings = station();
  const candidate = calculateStation({ station: { ...settings,
    modules: { Smelter: 1, Widget: 1 } }, catalog });
  assert.equal(candidate.balance.Alloy, 0.125,
    'One Smelter plus one Widget staffs half the positions and covers Alloy');
  assert.equal(candidate.constructionCost, 5);

  const result = plan(settings, catalog,
    { mode: 'build-chain', targetCounts: { Widget: 1 } });
  assert.equal(result.feasible, true, result.reason);
  assert.deepEqual(result.modules, { Smelter: 1, Widget: 1 });
  assert.equal(result.constructionCost, 5);
});
