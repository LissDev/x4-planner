import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { calculateStation, optimizeStation } from '../src/engine.js';

const solverSource = readFileSync(new URL('../vendor/solver.global.js', import.meta.url), 'utf8');
const milpSolver = runInNewContext(`${solverSource}\nsolver`);
const recipe = (outputs, inputs, buildCost) => ({ kind: 'production', race: 'argon',
  cycleSeconds: 3600, outputs, inputs, buildCost, workforce: 0 });
const station = (overrides = {}) => ({ modules: {}, sunlight: 1, availableWorkforce: 0,
  prices: { Widget: 10, Gizmo: 10, Alloy: 2, Ore: 1 }, finalWares: { Widget: 1 },
  purchasedIntermediates: [], ownedSupplyWares: [], allowedRaces: ['argon'], ...overrides });

function exhaustiveMinimum(catalog, settings, targetProfit, costLimit = 15) {
  const choices = Object.entries(catalog.recipes).filter(([, item]) =>
    settings.allowedRaces.includes(item.race));
  const external = new Set([...(catalog.rawWares ?? []), ...settings.purchasedIntermediates,
    ...settings.ownedSupplyWares]);
  let minimum = Infinity;
  function visit(index, modules, cost) {
    if (index < choices.length) {
      const [id, item] = choices[index];
      for (let count = 0; cost + count * item.buildCost <= Math.min(costLimit, minimum); count++) {
        if (count) modules[id] = count;
        else delete modules[id];
        visit(index + 1, modules, cost + count * item.buildCost);
      }
      delete modules[id];
      return;
    }
    const calculation = calculateStation({ station: { ...settings, modules }, catalog });
    if (Object.entries(calculation.balance).some(([ware, amount]) => amount < -1e-8 && !external.has(ware))) return;
    if (Object.values(calculation.finalOutput).some(amount => amount <= 1e-8)) return;
    if (calculation.hourlyProfit + 1e-8 >= targetProfit) minimum = Math.min(minimum, cost);
  }
  visit(0, {}, 0);
  return minimum;
}

function expectExactMinimum(catalog, settings, targetProfit) {
  const minimum = exhaustiveMinimum(catalog, settings, targetProfit);
  const actual = optimizeStation({ station: settings, catalog,
    objective: { mode: 'min-cost', targetProfit }, milpSolver });
  assert.equal(actual.feasible, Number.isFinite(minimum), actual.reason);
  if (actual.feasible) {
    assert.equal(actual.constructionCost, minimum);
    assert.ok(actual.hourlyProfit + 1e-8 >= targetProfit);
  }
  return actual;
}

test('alternate final recipes do not make either optional input mandatory', () => {
  const catalog = { rawWares: ['Ore'], workforceConsumption: {}, recipes: {
    AlloyWidget: recipe({ Widget: 1 }, { Alloy: 1 }, 2),
    OreWidget: recipe({ Widget: 1 }, { Ore: 1 }, 3),
    Smelter: recipe({ Alloy: 1 }, { Ore: 1 }, 4),
  } };
  const plan = expectExactMinimum(catalog, station(), 8);
  assert.equal(plan.modules.OreWidget, 1);
  assert.equal(plan.modules.Smelter ?? 0, 0);
});

test('one multi-output module satisfies both required final wares', () => {
  const catalog = { rawWares: [], workforceConsumption: {}, recipes: {
    Joint: recipe({ Widget: 1, Gizmo: 1 }, {}, 3),
    WidgetOnly: recipe({ Widget: 1 }, {}, 4),
    GizmoOnly: recipe({ Gizmo: 1 }, {}, 4),
  } };
  const plan = expectExactMinimum(catalog, station({ finalWares: { Widget: 1, Gizmo: 1 } }), 10);
  assert.equal(plan.modules.Joint, 1);
});

test('purchased and owned inputs need no internal producer', () => {
  const catalog = { rawWares: ['Ore'], workforceConsumption: {}, recipes: {
    WidgetMaker: recipe({ Widget: 1 }, { Alloy: 1 }, 3),
    Smelter: recipe({ Alloy: 1 }, { Ore: 1 }, 4),
  } };
  const purchased = expectExactMinimum(catalog, station({ purchasedIntermediates: ['Alloy'] }), 8);
  const owned = expectExactMinimum(catalog, station({ ownedSupplyWares: ['Alloy'] }), 9);
  assert.equal(purchased.modules.WidgetMaker, 1);
  assert.equal(owned.modules.WidgetMaker, 1);
  assert.equal(purchased.modules.Smelter ?? 0, 0);
  assert.equal(owned.modules.Smelter ?? 0, 0);
});

test('a cyclic producer does not force production through an optional zero-input route', () => {
  const catalog = { rawWares: [], workforceConsumption: {}, recipes: {
    WidgetMaker: recipe({ Widget: 1 }, { Alloy: 1 }, 3),
    Cycle: recipe({ Alloy: 1 }, { Widget: 1 }, 1),
    AlloySource: recipe({ Alloy: 1 }, {}, 2),
  } };
  const plan = expectExactMinimum(catalog, station(), 10);
  assert.equal(plan.modules.AlloySource, 1);
  assert.equal(plan.modules.Cycle ?? 0, 0);
});
