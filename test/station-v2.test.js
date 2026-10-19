import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { calculateStation, optimizeStation } from '../src/engine.js';
import { createCatalog } from '../src/catalog.js';

const solverSource = readFileSync(new URL('../vendor/solver.global.js', import.meta.url), 'utf8');
const milpSolver = runInNewContext(`${solverSource}\nsolver`);
const recipe = (outputs, inputs, buildCost, extras = {}) => ({
  cycleSeconds: 3600, outputs, inputs, buildCost, workforce: 0, ...extras,
});
const base = (overrides = {}) => ({
  modules: {}, sunlight: 1, availableWorkforce: 0,
  prices: { Ore: 2, Alloy: 10, Widget: 30, Food: 3, Medicine: 4 },
  finalWares: { Widget: 1 }, purchasedIntermediates: [], ...overrides,
});
const optimize = (station, catalog, objective = { mode: 'min-cost', targetProfit: 1 }) =>
  optimizeStation({ station, catalog, objective, milpSolver });

test('allowed races constrain every optimizer module and never fall back to another race', () => {
  const catalog = { rawWares: ['Ore'], workforceConsumption: {}, recipes: {
    ArgonWidget: recipe({ Widget: 1 }, { Ore: 1 }, 10, { race: 'argon', kind: 'production' }),
    ParanidWidget: recipe({ Widget: 1 }, { Ore: 1 }, 1, { race: 'paranid', kind: 'production' }),
  } };
  const filtered = optimize(base({ allowedRaces: ['argon'] }), catalog);
  assert.equal(filtered.feasible, true);
  assert.deepEqual(filtered.modules, { ArgonWidget: 1 });
  assert.equal(optimize(base({ allowedRaces: [] }), catalog).feasible, false);
});

test('automatic workforce fully staffs production and builds allowed housing with worker supplies', () => {
  const catalog = { rawWares: ['Ore'], workforceConsumption: { Food: 0.2, Medicine: 0.1 }, recipes: {
    Widget: recipe({ Widget: 2 }, { Ore: 3 }, 8,
      { race: 'argon', kind: 'production', workforce: 10, workforceBonus: 0.5 }),
    ArgonHabitat: recipe({}, {}, 3,
      { race: 'argon', kind: 'habitat', housingCapacity: 10 }),
    ParanidHabitat: recipe({}, {}, 1,
      { race: 'paranid', kind: 'habitat', housingCapacity: 100 }),
    FoodPlant: recipe({ Food: 2 }, { Ore: 1 }, 4,
      { race: 'argon', kind: 'production' }),
    MedicinePlant: recipe({ Medicine: 1 }, { Ore: 1 }, 5,
      { race: 'argon', kind: 'production' }),
  } };
  const station = base({ allowedRaces: ['argon'], workforceRace: 'argon', autoWorkforce: true });
  const result = optimize(station, catalog, { mode: 'max-output', budget: 20 });
  assert.equal(result.feasible, true);
  assert.equal(result.modules.Widget, 1);
  assert.equal(result.modules.ArgonHabitat, 1);
  assert.equal(result.modules.ParanidHabitat ?? 0, 0);
  assert.ok(result.constructionCost <= 20);
  const calculation = calculateStation({ station: { ...station, modules: result.modules }, catalog });
  assert.equal(calculation.staffedWorkers, 10);
  assert.equal(calculation.production.Widget, 3);
  assert.equal(calculation.consumption.Food, 2);
  assert.equal(calculation.consumption.Medicine, 1);
  assert.ok((calculation.production.Food ?? 0) + (calculation.purchases.Food ?? 0) >= 2);
  assert.ok((calculation.production.Medicine ?? 0) + (calculation.purchases.Medicine ?? 0) >= 1);
});

test('workforce race without allowed housing is infeasible', () => {
  const catalog = { rawWares: ['Ore'], workforceConsumption: { Food: 0.2 }, recipes: {
    Widget: recipe({ Widget: 1 }, { Ore: 1 }, 2,
      { race: 'argon', kind: 'production', workforce: 5 }),
    ParanidHabitat: recipe({}, {}, 1,
      { race: 'paranid', kind: 'habitat', housingCapacity: 10 }),
  } };
  const result = optimize(base({ allowedRaces: ['argon'], workforceRace: 'argon', autoWorkforce: true }), catalog);
  assert.equal(result.feasible, false);
});

test('automatic storage covers each ware flow by class for the selected duration', () => {
  const catalog = { rawWares: ['Ore'], workforceConsumption: {}, wares: {
    Ore: { storage: 'solid', volume: 2 }, Widget: { storage: 'container', volume: 5 },
  }, recipes: {
    Widget: recipe({ Widget: 2 }, { Ore: 3 }, 4,
      { race: 'argon', kind: 'production' }),
    SolidStore: recipe({}, {}, 2,
      { race: 'argon', kind: 'storage', storageType: 'solid', storageCapacity: 5 }),
    ContainerStore: recipe({}, {}, 3,
      { race: 'argon', kind: 'storage', storageType: 'container', storageCapacity: 6 }),
    CheapParanidStore: recipe({}, {}, 1,
      { race: 'paranid', kind: 'storage', storageType: 'container', storageCapacity: 100 }),
  } };
  const result = optimize(base({ allowedRaces: ['argon'], autoStorage: true }),
    catalog, { mode: 'max-output', budget: 14 });
  assert.equal(result.feasible, true);
  assert.equal(result.modules.Widget, 1);
  assert.equal(result.modules.SolidStore, 2);
  assert.equal(result.modules.ContainerStore, 2);
  assert.equal(result.modules.CheapParanidStore ?? 0, 0);
  assert.equal(result.constructionCost, 14);
});

test('owned external supplies keep demand visible with zero purchase cost', () => {
  const catalog = { rawWares: [], workforceConsumption: {}, recipes: {
    Widget: recipe({ Widget: 1 }, { Alloy: 1 }, 6),
  } };
  const station = base({ modules: { Widget: 1 }, ownedSupplyWares: ['Alloy'] });
  const calculated = calculateStation({ station, catalog });
  assert.equal(calculated.balance.Alloy, -1);
  assert.equal(calculated.externalRequirements?.Alloy, 1);
  assert.equal(calculated.purchases.Alloy ?? 0, 0);
  assert.equal(calculated.hourlyOperatingCost, 0);
  assert.equal(optimize(base({ ownedSupplyWares: ['Alloy'] }), catalog).feasible, true);
});

test('selling intermediate surplus counts only production left after internal consumption', () => {
  const catalog = { rawWares: ['Ore'], workforceConsumption: {}, recipes: {
    Smelter: recipe({ Alloy: 3 }, { Ore: 1 }, 4),
    Widget: recipe({ Widget: 1 }, { Alloy: 1 }, 6),
  } };
  const station = base({ modules: { Smelter: 1, Widget: 1 }, sellIntermediateSurplus: true });
  const calculated = calculateStation({ station, catalog });
  assert.equal(calculated.balance.Alloy, 2);
  assert.equal(calculated.hourlyRevenue, 50);
  assert.equal(calculated.hourlyProfit, 48);
  const importOnly = base({ purchasedIntermediates: ['Alloy'], sellIntermediateSurplus: true });
  const result = optimize(importOnly, catalog, { mode: 'min-cost', targetProfit: 40 });
  assert.equal(result.feasible, true);
  assert.equal(result.modules.Smelter, 1, 'purchased Alloy cannot be resold to reach the profit target');
});

test('real Argon and universal Space Fuel plan fits a 100 million budget with full workforce and one-hour storage', () => {
  const source = runInNewContext(`${readFileSync(new URL('../data.js', import.meta.url), 'utf8')}\nX4_DATA`);
  const catalog = createCatalog(source, {}, 'argon');
  const station = base({ sunlight: 0.75, prices: catalog.allPrices, finalWares: { spacefuel: 1 },
    allowedRaces: ['argon', 'universal'], workforceRace: 'argon', autoWorkforce: true,
    autoStorage: true, autoStorageHours: 1, ownedSupplyWares: ['water'] });
  const result = optimize(station, catalog, { mode: 'max-output', budget: 100_000_000 });
  assert.equal(result.feasible, true, result.reason);
  assert.ok((result.modules['module_arg_prod_spacefuel_01#argon#spacefuel'] ?? 0) > 0);
  assert.ok(result.constructionCost <= 100_000_000);
});

test('real minimum-cost Space Fuel plan includes full staffing, supplies, housing and storage costs', () => {
  const source = runInNewContext(`${readFileSync(new URL('../data.js', import.meta.url), 'utf8')}\nX4_DATA`);
  const catalog = createCatalog(source, {}, 'argon');
  const station = base({ sunlight: 0.75, prices: catalog.allPrices, finalWares: { spacefuel: 1 },
    allowedRaces: ['argon', 'universal'], workforceRace: 'argon', autoWorkforce: true,
    autoStorage: true, autoStorageHours: 1, ownedSupplyWares: [] });
  const result = optimize(station, catalog, { mode: 'min-cost', targetProfit: 100_000 });
  assert.equal(result.feasible, true, result.reason);
  assert.equal(result.constructionCost, 8_004_075);
  const rawModule = id => source.modules.find(module => id === `${module.id}#structure` ||
    module.recipes.some(recipe => recipe.id === id));
  const averagePrice = Object.fromEntries(source.wares.map(ware => [ware.id, ware.priceAverage]));
  let materialCost = 0;
  let workers = 0;
  let housing = 0;
  const storageCapacity = {};
  for (const [id, count] of Object.entries(result.modules)) {
    const module = rawModule(id);
    assert.ok(module, `Planned module ${id} must exist in the source data`);
    assert.ok(['argon', 'universal'].includes(module.race));
    materialCost += count * Object.entries(module.buildMaterials).reduce((sum, [ware, amount]) =>
      sum + amount * averagePrice[ware], 0);
    if (module.kind === 'production') workers += count * module.workforce;
    if (module.kind === 'habitat' && module.race === 'argon') housing += count * module.capacity;
    if (module.kind === 'storage') storageCapacity[module.storageType] =
      (storageCapacity[module.storageType] ?? 0) + count * module.capacity;
  }
  assert.equal(materialCost, result.constructionCost, 'Construction cost includes every planned module');
  assert.ok(workers > 0 && housing >= workers);
  const calculated = calculateStation({ station: { ...station, modules: result.modules }, catalog });
  assert.equal(calculated.staffedWorkers, workers);
  assert.ok(calculated.hourlyProfit >= 100_000);
  assert.equal(calculated.hourlyProfit, result.hourlyProfit);
  assert.ok((calculated.production.water ?? 0) > 0, 'No owned water supply was selected');
  for (const ware of Object.keys(source.workforceConsumption.argon))
    assert.ok((calculated.production[ware] ?? 0) >= (calculated.consumption[ware] ?? 0),
      `Worker supply ${ware} must be produced by the station`);
  const required = {};
  const wareById = new Map(source.wares.map(ware => [ware.id, ware]));
  for (const ware of new Set([...Object.keys(calculated.production), ...Object.keys(calculated.consumption)])) {
    const metadata = wareById.get(ware);
    if (!metadata?.storage) continue;
    required[metadata.storage] = (required[metadata.storage] ?? 0) +
      Math.max(calculated.production[ware] ?? 0, calculated.consumption[ware] ?? 0) * metadata.volume;
  }
  for (const [kind, volume] of Object.entries(required))
    assert.ok((storageCapacity[kind] ?? 0) >= volume, `${kind} storage must cover one hour of flow`);
});

test('three storage hours cannot reuse a one-hour warehouse plan for the same production', () => {
  const catalog = { rawWares: ['Ore'], workforceConsumption: {}, wares: {
    Ore: { storage: 'solid', volume: 2 }, Widget: { storage: 'container', volume: 5 },
  }, recipes: {
    Widget: recipe({ Widget: 2 }, { Ore: 3 }, 4,
      { race: 'argon', kind: 'production' }),
    SolidStore: recipe({}, {}, 2,
      { race: 'argon', kind: 'storage', storageType: 'solid', storageCapacity: 5 }),
    ContainerStore: recipe({}, {}, 3,
      { race: 'argon', kind: 'storage', storageType: 'container', storageCapacity: 6 }),
  } };
  const station = base({ allowedRaces: ['argon'], autoStorage: true });
  const oneHour = optimize(station, catalog);
  const threeHours = optimize({ ...station, autoStorageHours: 3 }, catalog);
  assert.equal(oneHour.feasible, true);
  assert.equal(threeHours.feasible, true);
  assert.equal(oneHour.modules.Widget, 1);
  assert.equal(threeHours.modules.Widget, 1);
  assert.equal(oneHour.modules.SolidStore, 2);
  assert.equal(oneHour.modules.ContainerStore, 2);
  assert.equal(threeHours.modules.SolidStore, 4);
  assert.equal(threeHours.modules.ContainerStore, 5);
  assert.equal(oneHour.constructionCost, 14);
  assert.equal(threeHours.constructionCost, 27);
});
