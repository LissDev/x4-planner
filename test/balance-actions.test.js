import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { calculateStation, optimizeStation } from '../src/engine.js';

const solverSource = readFileSync(new URL('../vendor/solver.global.js', import.meta.url), 'utf8');
const milpSolver = runInNewContext(`${solverSource}\nsolver`);
const recipe = (outputs, inputs, buildCost, extras = {}) => ({
  kind: 'production', race: 'argon', cycleSeconds: 3600, outputs, inputs,
  workforce: 0, buildCost, ...extras,
});
const station = (overrides = {}) => ({
  modules: {}, sunlight: 1, availableWorkforce: 0,
  prices: { Ore: 2, Alloy: 10, Widget: 0, Badge: 0, Food: 1, Medicine: 1 },
  finalWares: { Widget: 1 }, purchasedIntermediates: [], ownedSupplyWares: [],
  allowedRaces: ['argon'], workforceRace: 'argon', autoWorkforce: true, ...overrides,
});
const plan = (settings, catalog, objective) =>
  optimizeStation({ station: settings, catalog, objective, milpSolver });

test('build chain meets fixed final module counts at minimum intermediate cost without a profit goal', () => {
  const catalog = { rawWares: ['Ore'], workforceConsumption: {}, recipes: {
    Smelter: recipe({ Alloy: 2 }, { Ore: 1 }, 4),
    Widget: recipe({ Widget: 1 }, { Alloy: 1 }, 6),
    Badge: recipe({ Badge: 1 }, { Alloy: 1 }, 5),
    ParanidSmelter: recipe({ Alloy: 10 }, { Ore: 1 }, 1, { race: 'paranid' }),
  } };
  const settings = station({ finalWares: { Widget: 1, Badge: 1 } });
  const result = plan(settings, catalog,
    { mode: 'build-chain', targetCounts: { Widget: 2, Badge: 1 } });
  assert.equal(result.feasible, true, result.reason);
  assert.deepEqual(result.modules, { Smelter: 2, Widget: 2, Badge: 1 });
  assert.equal(result.constructionCost, 25);
  assert.equal(calculateStation({ station: { ...settings, modules: result.modules }, catalog }).balance.Alloy, 1);
});

test('reserve adds independently selected finals against fixed intermediate capacity', () => {
  const catalog = { rawWares: ['Ore'], workforceConsumption: {}, recipes: {
    Smelter: recipe({ Alloy: 5 }, { Ore: 1 }, 4),
    Widget: recipe({ Widget: 1 }, { Alloy: 2 }, 6),
    Badge: recipe({ Badge: 1 }, { Alloy: 1 }, 5),
  } };
  const settings = station({ modules: { Smelter: 1, Widget: 1 },
    finalWares: { Widget: 2, Badge: 1 } });
  const result = plan(settings, catalog, { mode: 'use-reserve' });
  assert.equal(result.feasible, true, result.reason);
  assert.deepEqual(result.modules, { Smelter: 1, Widget: 1, Badge: 3 });
  assert.equal(calculateStation({ station: { ...settings, modules: result.modules }, catalog }).balance.Alloy, 0);
});

test('reserve includes new workers in food and medicine capacity without growing supply producers', () => {
  const catalog = { rawWares: ['Ore'], workforceConsumption: { Food: 1, Medicine: 1 }, recipes: {
    AlloyPlant: recipe({ Alloy: 3 }, { Ore: 1 }, 4),
    FoodPlant: recipe({ Food: 2 }, { Ore: 1 }, 4),
    MedicinePlant: recipe({ Medicine: 2 }, { Ore: 1 }, 4),
    Widget: recipe({ Widget: 1 }, { Alloy: 1 }, 6, { workforce: 1 }),
    Habitat: recipe({}, {}, 2, { kind: 'habitat', housingCapacity: 2 }),
  } };
  const settings = station({ modules: { AlloyPlant: 1, FoodPlant: 1, MedicinePlant: 1,
    Widget: 1, Habitat: 1 } });
  const result = plan(settings, catalog, { mode: 'use-reserve' });
  assert.equal(result.feasible, true, result.reason);
  assert.equal(result.modules.Widget, 2);
  assert.equal(result.modules.AlloyPlant, 1);
  assert.equal(result.modules.FoodPlant, 1);
  assert.equal(result.modules.MedicinePlant, 1);
  const calculated = calculateStation({ station: { ...settings, modules: result.modules }, catalog });
  assert.equal(calculated.staffedWorkers, 2);
  assert.equal(calculated.balance.Food, 0);
  assert.equal(calculated.balance.Medicine, 0);
});

test('reserve reports an unbounded plan when owned external supplies remove every growth limit', () => {
  const catalog = { rawWares: [], workforceConsumption: {}, recipes: {
    Widget: recipe({ Widget: 1 }, { Alloy: 1 }, 6),
  } };
  const result = plan(station({ ownedSupplyWares: ['Alloy'] }), catalog,
    { mode: 'use-reserve' });
  assert.equal(result.feasible, false);
  assert.match(result.reason, /огранич|бескон|unbound|finite/i);
});

test('reserve with no spare intermediate capacity keeps the existing station unchanged', () => {
  const catalog = { rawWares: ['Ore'], workforceConsumption: {}, recipes: {
    Smelter: recipe({ Alloy: 1 }, { Ore: 1 }, 4),
    Widget: recipe({ Widget: 1 }, { Alloy: 1 }, 6),
  } };
  const settings = station({ modules: { Smelter: 1, Widget: 1 } });
  const result = plan(settings, catalog, { mode: 'use-reserve' });
  assert.equal(result.feasible, true, result.reason);
  assert.deepEqual(result.modules, settings.modules);
});
