import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { calculateStation, optimizeStation } from '../src/engine.js';

const solverSource = readFileSync(new URL('../vendor/solver.global.js', import.meta.url), 'utf8');
const milpSolver = runInNewContext(`${solverSource}\nsolver`);
const recipe = (outputs, inputs, buildCost, workforce = 0) => ({
  kind: 'production', race: 'argon', cycleSeconds: 3600, outputs, inputs,
  buildCost, workforce,
});
const catalog = { rawWares: ['Ore'], workforceConsumption: { Food: 1 }, recipes: {
  Smelter: recipe({ Alloy: 2 }, { Ore: 1 }, 4),
  FoodPlant: recipe({ Food: 1 }, { Ore: 1 }, 3),
  Widget: recipe({ Widget: 1 }, { Alloy: 1 }, 6, 1),
} };
const station = (overrides = {}) => ({
  modules: { Smelter: 1, FoodPlant: 1, Widget: 1 }, sunlight: 1,
  availableWorkforce: 2, autoWorkforce: false,
  prices: { Ore: 1, Food: 5, Widget: 10 }, finalWares: { Widget: 1 },
  targetCounts: { Widget: 1 }, purchasedIntermediates: [], ownedSupplyWares: [],
  allowedRaces: ['argon'], ...overrides,
});
const reserve = settings => optimizeStation({ station: settings, catalog,
  objective: { mode: 'use-reserve' }, milpSolver });

test('manual worker food limits reserve growth when no food import is allowed', () => {
  const settings = station();
  assert.equal(calculateStation({ station: settings, catalog }).balance.Food, 0,
    'Existing one-worker station has enough food');
  const result = reserve(settings);
  if (!result.feasible) {
    assert.match(result.reason, /food|пищ|снабж|невозмож/i);
    return;
  }
  assert.equal(result.modules.Widget, 1, 'A second worker would consume unavailable Food');
  assert.equal(result.modules.FoodPlant, 1, 'Reserve cannot add intermediate producers');
  assert.ok(calculateStation({ station: { ...settings, modules: result.modules }, catalog }).balance.Food >= 0);
});

test('explicitly permitted food purchase allows growth against spare Alloy', () => {
  const settings = station({ purchasedIntermediates: ['Food'] });
  const result = reserve(settings);
  assert.equal(result.feasible, true, result.reason);
  assert.equal(result.modules.Widget, 2);
  assert.equal(result.modules.FoodPlant, 1);
  assert.equal(calculateStation({ station: { ...settings, modules: result.modules }, catalog }).purchases.Food, 1);
});

test('manual worker cap permits reserve growth when total module workforce exceeds staffed workers', () => {
  const cappedCatalog = { ...catalog, recipes: {
    ...catalog.recipes,
    FoodPlant: recipe({ Food: 2 }, { Ore: 1 }, 3),
    Widget: recipe({ Widget: 1 }, { Alloy: 1 }, 6, 2),
    Habitat: { ...recipe({}, {}, 2), kind: 'habitat', housingCapacity: 2 },
  } };
  const settings = station({ modules: { Smelter: 1, FoodPlant: 1, Widget: 1, Habitat: 1 } });
  const candidate = { ...settings, modules: { ...settings.modules, Widget: 2 } };
  const candidateCalculation = calculateStation({ station: candidate, catalog: cappedCatalog });
  assert.equal(candidateCalculation.staffedWorkers, 2, 'Manual workers are capped at the available two');
  assert.equal(candidateCalculation.balance.Alloy, 0);
  assert.equal(candidateCalculation.balance.Food, 0,
    'The candidate consumes food for staffed workers, not four module positions');

  const result = optimizeStation({ station: settings, catalog: cappedCatalog,
    objective: { mode: 'use-reserve' }, milpSolver });
  assert.equal(result.feasible, true, result.reason);
  assert.equal(result.modules.Widget, 2);
  assert.equal(result.modules.Smelter, 1);
  assert.equal(result.modules.FoodPlant, 1);
});
