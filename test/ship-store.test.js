import assert from 'node:assert/strict';
import test from 'node:test';
import { createShipStore } from '../src/ship-store.js';

function memoryStorage() {
  const entries = new Map();
  return {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: key => entries.delete(key),
  };
}

const catalog = {
  ships: [{ id: 'corvette', slotGroups: [{ id: 'engine', type: 'engine', tags: ['engine', 'size-m'], count: 1 }] }],
  equipment: [
    { id: 'engine-m', kind: 'engine', mountTags: ['engine', 'size-m'] },
    { id: 'engine-s', kind: 'engine', mountTags: ['engine', 'size-s'] },
  ],
};
const alpha = { id: 'alpha', name: 'Первый', shipId: 'corvette', loadout: { engine: ['engine-m'] }, ammo: {}, prices: {} };

test('named ship builds persist separately, export/import JSON, and return independent copies', () => {
  const storage = memoryStorage();
  const store = createShipStore(storage, catalog);
  store.save(alpha);
  store.save({ ...alpha, id: 'beta', name: 'Второй' });
  const reopened = createShipStore(storage, catalog);
  assert.deepEqual(reopened.list().map(item => item.name).sort(), ['Второй', 'Первый']);
  const draft = reopened.get('alpha');
  draft.loadout.engine[0] = 'engine-s';
  assert.deepEqual(reopened.get('alpha'), alpha);
  const json = reopened.exportJson('alpha');
  assert.deepEqual(JSON.parse(json), alpha);
  reopened.remove('alpha');
  assert.equal(reopened.get('alpha'), undefined);
  reopened.importJson(json);
  assert.deepEqual(reopened.get('alpha'), alpha);
  assert.equal(storage.getItem('x4-station-projects-v1'), null, 'Ship builds use storage separate from stations');
});

test('invalid imported loadout is rejected before it can replace a saved build', () => {
  const store = createShipStore(memoryStorage(), catalog);
  store.save(alpha);
  assert.throws(() => store.importJson(JSON.stringify({ ...alpha, loadout: { engine: ['engine-s'] } })), /compat|совмест|mount/i);
  assert.deepEqual(store.get('alpha'), alpha);
  assert.throws(() => store.importJson(JSON.stringify({ ...alpha, loadout: { engine: ['engine-m', 'engine-m'] } })), /slot|count|мест/i);
  assert.deepEqual(store.get('alpha'), alpha);
  assert.throws(() => store.importJson('{bad json'), /json|syntax/i);
  assert.deepEqual(store.get('alpha'), alpha);
});

test('ship store round-trips indexed empty slot positions without compacting them', () => {
  const multiCatalog = structuredClone(catalog);
  multiCatalog.ships[0].slotGroups[0].count = 4;
  const positioned = { ...alpha, loadout: { engine: ['', 'engine-m', '', 'engine-m'] } };
  const storage = memoryStorage();
  const store = createShipStore(storage, multiCatalog);
  store.save(positioned);
  assert.deepEqual(store.get('alpha').loadout.engine, ['', 'engine-m', '', 'engine-m']);
  const exported = store.exportJson('alpha');
  store.remove('alpha');
  store.importJson(exported);
  assert.deepEqual(createShipStore(storage, multiCatalog).get('alpha'), positioned);
});
