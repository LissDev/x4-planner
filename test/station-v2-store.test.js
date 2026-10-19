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

const saved = {
  id: 'station-v2', name: 'Saved station',
  station: {
    modules: {}, sunlight: 0.8, availableWorkforce: 0, prices: {}, finalWares: {},
    purchasedIntermediates: [], allowedRaces: ['argon'], workforceRace: 'argon',
    ownedSupplyWares: ['water'], autoWorkforce: true, autoStorage: true,
    autoStorageHours: 1, sellIntermediateSurplus: false,
  },
};

test('a valid Station V2 project saves and imports intact', () => {
  const store = createProjectStore(memoryStorage());
  assert.deepEqual(store.save(saved), saved);
  assert.deepEqual(store.importJson(JSON.stringify(saved)), saved);
  assert.deepEqual(store.get(saved.id), saved);
});

for (const [field, value] of [
  ['allowedRaces', 'argon'],
  ['ownedSupplyWares', 'water'],
  ['autoStorageHours', -1],
  ['autoWorkforce', 'true'],
  ['autoStorage', 'true'],
  ['sellIntermediateSurplus', 1],
  ['workforceRace', 7],
]) {
  test(`invalid Station V2 ${field} import cannot replace a saved project`, () => {
    const store = createProjectStore(memoryStorage());
    store.save(saved);
    const invalid = structuredClone(saved);
    invalid.station[field] = value;
    assert.throws(() => store.importJson(JSON.stringify(invalid)), /invalid|race|supply|storage|workforce|surplus/i);
    assert.deepEqual(store.get(saved.id), saved);
  });
}
