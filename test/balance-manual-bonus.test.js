import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { calculateStation, optimizeStation } from '../src/engine.js';

const solverSource = readFileSync(new URL('../vendor/solver.global.js', import.meta.url), 'utf8');
const milpSolver = runInNewContext(`${solverSource}\nsolver`);
const recipe = (outputs, inputs, workforce, workforceBonus = 0) => ({
  kind: 'production', race: 'argon', cycleSeconds: 3600, outputs, inputs,
  buildCost: 1, workforce, workforceBonus,
});

test('reserve uses the actual manual workforce bonus after adding final modules', () => {
  const catalog = { rawWares: ['Ore'], workforceConsumption: {}, recipes: {
    Smelter: recipe({ Alloy: 1 }, { Ore: 1 }, 1, 2),
    Widget: recipe({ Widget: 1 }, { Alloy: 1 }, 1),
  } };
  const station = {
    modules: { Smelter: 1, Widget: 1 }, sunlight: 1,
    availableWorkforce: 2, autoWorkforce: false,
    prices: {}, finalWares: { Widget: 1 }, targetCounts: { Widget: 1 },
    purchasedIntermediates: [], ownedSupplyWares: [], allowedRaces: ['argon'],
  };
  const candidate = { ...station, modules: { Smelter: 1, Widget: 2 } };
  assert.ok(calculateStation({ station: candidate, catalog }).balance.Alloy > 0);
  assert.ok(calculateStation({ station: { ...candidate, modules: { ...candidate.modules, Widget: 3 } }, catalog }).balance.Alloy < 0);

  const result = optimizeStation({ station, catalog, objective: { mode: 'use-reserve' }, milpSolver });
  assert.equal(result.feasible, true, result.reason);
  assert.equal(result.modules.Smelter, 1);
  assert.equal(result.modules.Widget, 2);
});

test('existing out-of-race final modules remain fixed without hiding eligible reserve growth', () => {
  const catalog = { rawWares: ['Ore'], workforceConsumption: {}, recipes: {
    Smelter: recipe({ Alloy: 2 }, { Ore: 1 }, 1, 2),
    Widget: recipe({ Widget: 1 }, { Alloy: 1 }, 1),
    OldWidget: { ...recipe({ Widget: 1 }, { Alloy: 1 }, 0), race: 'paranid' },
  } };
  const station = {
    modules: { Smelter: 1, Widget: 1, OldWidget: 2 }, sunlight: 1,
    availableWorkforce: 2, autoWorkforce: false,
    prices: {}, finalWares: { Widget: 1 }, targetCounts: { Widget: 1 },
    purchasedIntermediates: [], ownedSupplyWares: [], allowedRaces: ['argon'],
  };
  const candidate = { ...station, modules: { ...station.modules, Widget: 2 } };
  assert.ok(calculateStation({ station: candidate, catalog }).balance.Alloy > 0);
  assert.ok(calculateStation({ station: { ...candidate, modules: { ...candidate.modules, Widget: 3 } }, catalog }).balance.Alloy < 0);

  const result = optimizeStation({ station, catalog, objective: { mode: 'use-reserve' }, milpSolver });
  assert.equal(result.feasible, true, result.reason);
  assert.equal(result.modules.OldWidget, 2);
  assert.equal(result.modules.Widget, 2);
});
