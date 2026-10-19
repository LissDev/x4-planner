import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { createCatalog } from '../src/catalog.js';
import { calculateStation, optimizeStation } from '../src/engine.js';

const solverSource = readFileSync(new URL('../vendor/solver.global.js', import.meta.url), 'utf8');
const milpSolver = runInNewContext(`${solverSource}\nsolver`);
const production = (inputs = {}) => ({ kind: 'production', race: 'argon', cycleSeconds: 3600,
  outputs: { Widget: 1 }, inputs, workforce: 0, buildCost: 5 });
const storage = (storageType, storageCapacity, buildCost, race = 'argon') => ({
  kind: 'storage', race, cycleSeconds: 3600, outputs: {}, inputs: {}, workforce: 0,
  storageType, storageCapacity, buildCost,
});
const station = (allowedRaces = ['argon']) => ({ modules: {}, sunlight: 1, availableWorkforce: 0,
  prices: {}, finalWares: { Widget: 1 }, purchasedIntermediates: [],
  allowedRaces, autoStorage: true, autoStorageHours: 1 });

function exhaustiveBest(catalog, settings, budget) {
  const choices = Object.entries(catalog.recipes).filter(([, recipe]) =>
    settings.allowedRaces.includes(recipe.race));
  let best = { output: 0, cost: 0 };
  function visit(index, modules, cost) {
    if (index < choices.length) {
      const [id, recipe] = choices[index];
      for (let count = 0; cost + count * recipe.buildCost <= budget; count++) {
        if (count) modules[id] = count;
        else delete modules[id];
        visit(index + 1, modules, cost + count * recipe.buildCost);
      }
      delete modules[id];
      return;
    }
    const calculation = calculateStation({ station: { ...settings, modules }, catalog });
    const allowedInputs = new Set(catalog.rawWares ?? []);
    if (Object.entries(calculation.balance).some(([ware, amount]) => amount < -1e-8 && !allowedInputs.has(ware))) return;
    const required = {};
    for (const ware of new Set([...Object.keys(calculation.production), ...Object.keys(calculation.consumption)])) {
      const metadata = catalog.wares?.[ware];
      if (!metadata?.storage || !metadata.volume) continue;
      required[metadata.storage] = (required[metadata.storage] ?? 0) +
        Math.max(calculation.production[ware] ?? 0, calculation.consumption[ware] ?? 0) * metadata.volume;
    }
    for (const [type, volume] of Object.entries(required)) {
      const capacity = Object.entries(modules).reduce((total, [id, count]) =>
        total + (catalog.recipes[id].storageType === type ? catalog.recipes[id].storageCapacity * count : 0), 0);
      if (capacity < volume) return;
    }
    const output = calculation.finalOutput.Widget;
    if (output > best.output || (output === best.output && cost < best.cost)) best = { output, cost };
  }
  visit(0, {}, 0);
  return best;
}

function expectExactStorageChoice(catalog, settings, budget) {
  const expected = exhaustiveBest(catalog, settings, budget);
  const actual = optimizeStation({ station: settings, catalog,
    objective: { mode: 'max-output', budget }, milpSolver });
  assert.equal(actual.feasible, expected.output > 0, actual.reason);
  if (actual.feasible) {
    assert.equal(actual.finalOutput.Widget, expected.output);
    assert.equal(actual.constructionCost, expected.cost);
  }
  return actual;
}

test('a larger storage choice survives a capacity-cost tradeoff', () => {
  const catalog = { rawWares: [], workforceConsumption: {}, wares: {
    Widget: { storage: 'container', volume: 1 },
  }, recipes: { Maker: production(), Small: storage('container', 1, 1),
    Large: storage('container', 4, 2) } };
  const plan = expectExactStorageChoice(catalog, station(), 18);
  assert.equal(plan.finalOutput.Widget, 3);
  assert.equal(plan.modules.Large, 1);
});

test('cheap solid storage cannot replace required container storage', () => {
  const catalog = { rawWares: ['Ore'], workforceConsumption: {}, wares: {
    Ore: { storage: 'solid', volume: 1 }, Widget: { storage: 'container', volume: 1 },
  }, recipes: { Maker: production({ Ore: 1 }), Solid: storage('solid', 4, 1),
    Container: storage('container', 2, 2) } };
  const plan = expectExactStorageChoice(catalog, station(), 8);
  assert.equal(plan.modules.Solid, 1);
  assert.equal(plan.modules.Container, 1);
});

test('storage of a disallowed race cannot displace an allowed module', () => {
  const catalog = { rawWares: [], workforceConsumption: {}, wares: {
    Widget: { storage: 'container', volume: 1 },
  }, recipes: { Maker: production(), ArgonStore: storage('container', 1, 2),
    ParanidStore: storage('container', 5, 1, 'paranid') } };
  const plan = expectExactStorageChoice(catalog, station(), 7);
  assert.equal(plan.modules.ArgonStore, 1);
  assert.equal(plan.modules.ParanidStore ?? 0, 0);
});

test('edited construction material prices change the optimal storage module', () => {
  const source = { rawWares: [], workforceConsumption: { argon: {} }, wares: [
    { id: 'Widget', priceAverage: 1, storage: 'container', volume: 1 },
    { id: 'core', priceAverage: 1 }, { id: 'matA', priceAverage: 1 },
    { id: 'matB', priceAverage: 10 },
  ], modules: [
    { id: 'Maker', race: 'argon', kind: 'production', workforce: 0,
      buildMaterials: { core: 5 }, recipes: [{ id: 'WidgetMaker', cycleSeconds: 3600,
        outputs: { Widget: 1 }, inputs: {} }] },
    { id: 'StoreA', race: 'argon', kind: 'storage', capacity: 1,
      storageType: 'container', buildMaterials: { matA: 1 }, recipes: [] },
    { id: 'StoreB', race: 'argon', kind: 'storage', capacity: 1,
      storageType: 'container', buildMaterials: { matB: 1 }, recipes: [] },
  ] };
  const original = createCatalog(source, {}, 'argon');
  const edited = createCatalog(source, { matA: 10, matB: 1 }, 'argon');
  assert.equal(expectExactStorageChoice(original, station(), 6).modules['StoreA#structure'], 1);
  assert.equal(expectExactStorageChoice(edited, station(), 6).modules['StoreB#structure'], 1);
});

test('equal-capacity equal-cost alternatives retain a feasible storage choice', () => {
  const catalog = { rawWares: [], workforceConsumption: {}, wares: {
    Widget: { storage: 'container', volume: 1 },
  }, recipes: { Maker: production(), First: storage('container', 1, 1),
    Second: storage('container', 1, 1) } };
  const plan = expectExactStorageChoice(catalog, station(), 6);
  assert.equal((plan.modules.First ?? 0) + (plan.modules.Second ?? 0), 1);
});
