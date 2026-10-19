import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectStore } from '../src/project-store.js';

function memoryStorage() {
  const entries = new Map();
  return {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
  };
}

const legacy = {
  id: 'station', name: 'Existing station', station: {
    modules: { Widget: 1 }, sunlight: 1, availableWorkforce: 0, prices: {},
    finalWares: { Widget: 1.5 }, purchasedIntermediates: [],
  },
};

test('positive integer final-module targets survive save, export, and import beside legacy ratios', () => {
  const store = createProjectStore(memoryStorage());
  const project = structuredClone(legacy);
  project.station.targetCounts = { Widget: 3 };
  assert.deepEqual(store.save(project), project);
  const exported = store.exportJson(project.id);
  assert.deepEqual(JSON.parse(exported), project);
  const imported = createProjectStore(memoryStorage());
  assert.deepEqual(imported.importJson(exported), project);
  assert.deepEqual(imported.get(project.id), project);
});

test('legacy projects without target counts remain valid and do not reinterpret sales ratios', () => {
  const store = createProjectStore(memoryStorage());
  assert.deepEqual(store.save(legacy), legacy);
  assert.deepEqual(store.importJson(store.exportJson(legacy.id)), legacy);
  assert.equal(store.get(legacy.id).station.targetCounts, undefined);
  assert.equal(store.get(legacy.id).station.finalWares.Widget, 1.5);
});

for (const [name, targetCounts] of [
  ['array', [1]], ['null', null], ['zero', { Widget: 0 }],
  ['negative', { Widget: -2 }], ['fractional', { Widget: 1.5 }],
  ['string', { Widget: '2' }], ['unknown final ware', { Other: 2 }],
]) {
  test(`invalid target counts (${name}) cannot replace a saved project`, () => {
    const store = createProjectStore(memoryStorage());
    store.save(legacy);
    const invalid = structuredClone(legacy);
    invalid.station.targetCounts = targetCounts;
    assert.throws(() => store.importJson(JSON.stringify(invalid)), /target|count|ware|invalid/i);
    assert.deepEqual(store.get(legacy.id), legacy);
  });
}

test('nonfinite target counts are rejected before save', () => {
  const store = createProjectStore(memoryStorage());
  const invalid = structuredClone(legacy);
  invalid.station.targetCounts = { Widget: Infinity };
  assert.throws(() => store.save(invalid), /target|count|ware|invalid/i);
  assert.equal(store.get(legacy.id), undefined);
});
