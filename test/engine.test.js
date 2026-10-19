import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateStation, optimizeStation } from '../src/engine.js';

const catalog = {
  rawWares: ['Ore', 'Water'],
  workforceConsumption: { Food: 0.2, Medicine: 0.1 },
  recipes: {
    Solar: { cycleSeconds: 60, outputs: { Energy: 10 }, inputs: {}, workforce: 0, buildCost: 12, sunlightScaled: true },
    Farm: { cycleSeconds: 60, outputs: { Food: 2 }, inputs: { Water: 1, Energy: 2 }, workforce: 0, buildCost: 6 },
    Smelter: { cycleSeconds: 3600, outputs: { Alloy: 1 }, inputs: { Ore: 1 }, workforce: 0, buildCost: 4 },
    Widget: { cycleSeconds: 3600, outputs: { Widget: 1 }, inputs: { Alloy: 1 }, workforce: 0, buildCost: 6 },
    Badge: { cycleSeconds: 3600, outputs: { Badge: 1 }, inputs: { Alloy: 1 }, workforce: 0, buildCost: 5 },
    WorkerWidget: { cycleSeconds: 3600, outputs: { Widget: 2 }, inputs: { Ore: 3 }, workforce: 10, workforceBonus: 0.5, buildCost: 8 },
    EnergyWidget: { cycleSeconds: 3600, outputs: { Widget: 1 }, inputs: { Energy: 1 }, workforce: 0, buildCost: 5 },
  },
};
const chainCatalog = { ...catalog, recipes: {
  Smelter: catalog.recipes.Smelter,
  Widget: catalog.recipes.Widget,
  Badge: catalog.recipes.Badge,
} };

function station(overrides = {}) {
  return {
    modules: {}, sunlight: 1, availableWorkforce: 0,
    prices: { Ore: 2, Water: 1, Energy: 1, Food: 3, Medicine: 4, Alloy: 9, Widget: 30, Badge: 20 },
    finalWares: { Widget: 1 }, purchasedIntermediates: [],
    ...overrides,
  };
}

test('cycle quantities become hourly flows and sunlight scales solar output', () => {
  const result = calculateStation({ station: station({ modules: { Solar: 1, Farm: 1 }, sunlight: 0.5 }), catalog });
  assert.equal(result.production.Energy, 300);
  assert.equal(result.production.Food, 120);
  assert.equal(result.consumption.Energy, 120);
  assert.equal(result.consumption.Water, 60);
  assert.equal(result.balance.Energy, 180);
});

test('workforce bonus increases output while recipe inputs stay fixed', () => {
  const result = calculateStation({ station: station({ modules: { WorkerWidget: 1 }, availableWorkforce: 10 }), catalog });
  assert.equal(result.production.Widget, 3);
  assert.equal(result.consumption.Ore, 3);
  assert.equal(result.consumption.Food, 2);
  assert.equal(result.consumption.Medicine, 1);
});

test('deficits are purchased and profit uses only final ware revenue', () => {
  const result = calculateStation({ station: station({ modules: { Widget: 1 }, purchasedIntermediates: ['Alloy'] }), catalog });
  assert.equal(result.balance.Alloy, -1);
  assert.equal(result.purchases.Alloy, 1);
  assert.equal(result.hourlyRevenue, 30);
  assert.equal(result.hourlyOperatingCost, 9);
  assert.equal(result.hourlyProfit, 21);
  assert.equal(result.constructionCost, 6);
});

test('budget optimizer preserves final ratios with integer modules and builds intermediates', () => {
  const result = optimizeStation({
    station: station({ finalWares: { Widget: 1, Badge: 1 } }), catalog: chainCatalog,
    objective: { mode: 'max-output', budget: 37 },
  });
  assert.equal(result.feasible, true);
  assert.deepEqual(result.modules, { Smelter: 2, Widget: 1, Badge: 1 });
  assert.deepEqual(result.finalOutput, { Widget: 1, Badge: 1 });
  assert.equal(result.constructionCost, 19);
});

test('fallback optimizer preserves unequal 2:1 final output ratios', () => {
  const result = optimizeStation({
    station: station({ finalWares: { Widget: 2, Badge: 1 } }), catalog: chainCatalog,
    objective: { mode: 'max-output', budget: 40 },
  });
  assert.equal(result.feasible, true);
  assert.deepEqual(result.modules, { Smelter: 3, Widget: 2, Badge: 1 });
  assert.deepEqual(result.finalOutput, { Widget: 2, Badge: 1 });
  assert.equal(result.constructionCost, 29);
});

test('minimum cost optimizer reaches net profit with full chain by default', () => {
  const result = optimizeStation({
    station: station(), catalog: chainCatalog, objective: { mode: 'min-cost', targetProfit: 40 },
  });
  assert.equal(result.feasible, true);
  assert.deepEqual(result.modules, { Smelter: 2, Widget: 2 });
  assert.equal(result.constructionCost, 20);
  assert.equal(result.hourlyProfit, 56);
});

test('purchased intermediate toggle changes the least-cost feasible design', () => {
  const result = optimizeStation({
    station: station({ purchasedIntermediates: ['Alloy'] }), catalog: chainCatalog,
    objective: { mode: 'min-cost', targetProfit: 40 },
  });
  assert.equal(result.feasible, true);
  assert.deepEqual(result.modules, { Widget: 2 });
  assert.equal(result.constructionCost, 12);
  assert.equal(result.hourlyProfit, 42);
});

test('zero sunlight makes energy-dependent output infeasible without external energy', () => {
  const energyOnly = { ...catalog, recipes: { Solar: catalog.recipes.Solar, EnergyWidget: catalog.recipes.EnergyWidget } };
  const sunnyResult = optimizeStation({
    station: station({ sunlight: 1 }), catalog: energyOnly,
    objective: { mode: 'min-cost', targetProfit: 1 },
  });
  const energyResult = optimizeStation({
    station: station({ sunlight: 0 }), catalog: energyOnly,
    objective: { mode: 'min-cost', targetProfit: 1 },
  });
  assert.equal(sunnyResult.feasible, true);
  assert.equal(energyResult.feasible, false);
});

test('invalid counts, sunlight, prices, and optimization limits are rejected', () => {
  assert.throws(() => calculateStation({ station: station({ modules: { Widget: 1.5 } }), catalog }), /count|integer/i);
  assert.throws(() => calculateStation({ station: station({ sunlight: -0.1 }), catalog }), /sunlight/i);
  assert.throws(() => calculateStation({ station: station({ prices: { Widget: Number.NaN } }), catalog }), /price/i);
  assert.throws(() => optimizeStation({ station: station(), catalog, objective: { mode: 'max-output', budget: -1 } }), /budget/i);
});
