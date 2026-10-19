import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectStore } from '../src/project-store.js';

function memoryStorage() {
  const entries = new Map();
  return {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: key => entries.delete(key),
  };
}

const alpha = {
  id: 'alpha', name: 'Первая станция',
  station: {
    modules: { Solar: 2 }, sunlight: 0.75, availableWorkforce: 20,
    prices: { Energy: 10 }, finalWares: { Energy: 1 }, purchasedIntermediates: [],
  },
};
const beta = { ...alpha, id: 'beta', name: 'Вторая станция' };

test('multiple named projects survive a new store instance and export/import JSON', () => {
  const storage = memoryStorage();
  const store = createProjectStore(storage);
  store.save(alpha);
  store.save(beta);
  const reopened = createProjectStore(storage);
  assert.deepEqual(reopened.list().map(project => project.name).sort(), ['Вторая станция', 'Первая станция']);
  assert.deepEqual(reopened.get('alpha'), alpha);
  const json = reopened.exportJson('alpha');
  assert.deepEqual(JSON.parse(json), alpha);
  reopened.remove('alpha');
  assert.equal(reopened.get('alpha'), undefined);
  reopened.importJson(json);
  assert.deepEqual(reopened.get('alpha'), alpha);
});

test('invalid import is rejected atomically before it can replace a project', () => {
  const store = createProjectStore(memoryStorage());
  store.save(alpha);
  const invalid = JSON.stringify({ ...alpha, station: { ...alpha.station, modules: { Solar: -3 } } });
  assert.throws(() => store.importJson(invalid), /count|module|invalid/i);
  assert.deepEqual(store.get('alpha'), alpha);
  assert.throws(() => store.importJson('{bad json'), /json|syntax/i);
  assert.deepEqual(store.get('alpha'), alpha);
});
