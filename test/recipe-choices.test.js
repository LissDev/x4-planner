import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { optimizeStation } from '../src/engine.js';
import { createProjectStore } from '../src/project-store.js';
import { createCatalog } from '../src/catalog.js';

const solver = runInNewContext(`${readFileSync(new URL('../vendor/solver.global.js', import.meta.url), 'utf8')}\nsolver`);
const recipe = (outputs, inputs, cost) => ({ kind: 'production', race: 'universal',
  cycleSeconds: 3600, outputs, inputs, buildCost: cost, workforce: 0 });
const station = (final, recipeChoices = {}) => ({ modules: {}, sunlight: 1, availableWorkforce: 0,
  prices: {}, finalWares: { [final]: 1 }, targetCounts: { [final]: 1 },
  purchasedIntermediates: [], recipeChoices, allowedRaces: ['universal'] });
const plan = (draft, catalog) => optimizeStation({ station: draft, catalog,
  objective: { mode: 'build-chain', targetCounts: draft.targetCounts }, milpSolver: solver });

test('explicit final recipe builds the requested process even when automatic chooses cheaper scrap', () => {
  const catalog = { rawWares: ['Scrap', 'Ore'], workforceConsumption: {}, recipes: {
    'recycler#recycling#Widget': recipe({ Widget: 1 }, { Scrap: 1 }, 1),
    'factory#default#Widget': recipe({ Widget: 1 }, { Ore: 1 }, 9),
  } };
  const automatic = plan(station('Widget'), catalog);
  assert.equal(automatic.feasible, true);
  assert.equal(automatic.modules['recycler#recycling#Widget'], 1);
  const preferred = plan(station('Widget', { Widget: 'factory#default#Widget' }), catalog);
  assert.equal(preferred.feasible, true, preferred.reason);
  assert.equal(preferred.modules['factory#default#Widget'], 1);
  assert.equal(preferred.modules['recycler#recycling#Widget'] ?? 0, 0);
});

test('explicit intermediate recipe shapes the whole chain before optimization', () => {
  const catalog = { rawWares: ['Scrap', 'Ore'], workforceConsumption: {}, recipes: {
    'widget#default#Widget': recipe({ Widget: 1 }, { Alloy: 1 }, 1),
    'recycler#recycling#Alloy': recipe({ Alloy: 1 }, { Scrap: 1 }, 1),
    'smelter#default#Alloy': recipe({ Alloy: 1 }, { Ore: 1 }, 9),
  } };
  const preferred = plan(station('Widget', { Alloy: 'smelter#default#Alloy' }), catalog);
  assert.equal(preferred.feasible, true, preferred.reason);
  assert.equal(preferred.modules['smelter#default#Alloy'], 1);
  assert.equal(preferred.modules['recycler#recycling#Alloy'] ?? 0, 0);
});

test('reserve retains an existing final module but grows with the preferred final recipe', () => {
  const catalog = { rawWares: ['Ore'], workforceConsumption: {}, recipes: {
    'smelter#default#Alloy': recipe({ Alloy: 3 }, { Ore: 1 }, 3),
    'old#default#Widget': recipe({ Widget: 1 }, { Alloy: 1 }, 1),
    'preferred#default#Widget': recipe({ Widget: 1 }, { Alloy: 1 }, 2),
  } };
  const draft = station('Widget', { Widget: 'preferred#default#Widget' });
  draft.modules = { 'smelter#default#Alloy': 1, 'old#default#Widget': 1 };
  const outcome = optimizeStation({ station: draft, catalog,
    objective: { mode: 'use-reserve' }, milpSolver: solver });
  assert.equal(outcome.feasible, true, outcome.reason);
  assert.equal(outcome.modules['smelter#default#Alloy'], 1);
  assert.equal(outcome.modules['old#default#Widget'], 1);
  assert.equal(outcome.modules['preferred#default#Widget'], 2);
});

test('explicit recipe blocked by allowed races reports the conflict instead of falling back', () => {
  const catalog = { rawWares: ['Ore'], workforceConsumption: {}, recipes: {
    'argon#default#Widget': { ...recipe({ Widget: 1 }, { Ore: 1 }, 1), race: 'argon' },
    'universal#default#Widget': recipe({ Widget: 1 }, { Ore: 1 }, 5),
  } };
  let conflict;
  try {
    const outcome = plan(station('Widget', { Widget: 'argon#default#Widget' }), catalog);
    conflict = outcome.feasible ? '' : outcome.reason;
  } catch (error) { conflict = error.message; }
  assert.match(conflict, /Widget.*argon#default#Widget|argon#default#Widget.*Widget/i);
});

test('an inactive intermediate choice does not require production across a purchase boundary', () => {
  const catalog = { rawWares: ['Ore'], workforceConsumption: {}, recipes: {
    'widget#default#Widget': recipe({ Widget: 1 }, { Alloy: 1 }, 2),
    'argon#default#Alloy': { ...recipe({ Alloy: 1 }, { Ore: 1 }, 4), race: 'argon' },
  } };
  const draft = station('Widget', { Alloy: 'argon#default#Alloy' });
  draft.purchasedIntermediates = ['Alloy'];
  const outcome = plan(draft, catalog);
  assert.equal(outcome.feasible, true, outcome.reason);
  assert.equal(outcome.modules['widget#default#Widget'], 1);
  assert.equal(outcome.modules['argon#default#Alloy'] ?? 0, 0);
});

test('real claytronics offers separate recycler and conventional recipe IDs', () => {
  const source = runInNewContext(`${readFileSync(new URL('../data.js', import.meta.url), 'utf8')}\nX4_DATA`);
  const catalog = createCatalog(source);
  const ids = Object.entries(catalog.recipes).filter(([, item]) => item.outputs.claytronics > 0)
    .map(([id]) => id);
  assert.deepEqual(ids.sort(), [
    'module_gen_prod_claytronics_01#default#claytronics',
    'module_gen_prod_scrap_recycler#recycling#claytronics',
  ]);
});

function memoryStorage() {
  const entries = new Map();
  return { getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)) };
}

test('recipe preference survives save, export and import, while old projects need no field', () => {
  const saved = { id: 'station', name: 'Claytronics', station: {
    modules: {}, sunlight: 1, availableWorkforce: 0, prices: {},
    finalWares: { claytronics: 1 }, targetCounts: { claytronics: 1 },
    purchasedIntermediates: [], recipeChoices: {
      claytronics: 'module_gen_prod_claytronics_01#default#claytronics',
    },
  } };
  const first = createProjectStore(memoryStorage());
  first.save(saved);
  const second = createProjectStore(memoryStorage());
  assert.deepEqual(second.importJson(first.exportJson(saved.id)), saved);
  const legacy = structuredClone(saved);
  delete legacy.station.recipeChoices;
  assert.deepEqual(second.save(legacy), legacy);
});

for (const [label, choices] of [
  ['array', []], ['null', null], ['non-string', { claytronics: 2 }],
  ['empty ID', { claytronics: '' }],
]) {
  test(`invalid recipe preferences (${label}) are rejected`, () => {
    const project = { id: 'station', name: 'Claytronics', station: {
      modules: {}, sunlight: 1, availableWorkforce: 0, prices: {},
      finalWares: { claytronics: 1 }, purchasedIntermediates: [], recipeChoices: choices,
    } };
    assert.throws(() => createProjectStore(memoryStorage()).save(project), /recipe|choice|invalid/i);
  });
}
