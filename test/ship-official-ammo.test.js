import assert from 'node:assert/strict';
import test from 'node:test';
import '../ship-data.js';
import { calculateShip } from '../src/ship-engine.js';
import { createShipStore } from '../src/ship-store.js';

const catalog = globalThis.X4_SHIP_DATA;
const launcher = 'turret_arg_m_dumbfire_02_mk1';
const allowedAmmo = 'missile_gen_m_dumbfire_01_mk1';
const unrelatedAmmo = 'missile_gen_s_guided_01_mk1';
const build = {
  id: 'missile-miner', name: 'Ракетный шахтёр', shipId: 'ship_tel_l_miner_liquid_02_a',
  loadout: { 'turret:group_rear_right_down': [launcher] }, ammo: { [allowedAmmo]: 2 }, prices: {},
};

function memoryStorage() {
  const entries = new Map();
  return {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: key => entries.delete(key),
  };
}

test('mounted official launcher accepts compatible finite ammo and keeps its salvo separate from DPS', () => {
  const result = calculateShip({ build, catalog, hitEfficiency: 1 });
  assert.deepEqual(result.missileSalvo, { shield: 1560, hull: 1560 },
    'Two selected missiles with 780 explosion damage each have finite nominal salvo damage');
  assert.equal(result.damage.shield.burst, null, 'Unknown launcher cadence cannot become recurring nominal DPS');
  assert.equal(result.damage.hull.burst, null);
  assert.equal(result.damageUnknown.shield.burst, 1);
});

test('an unrelated missile is rejected atomically on import for the mounted launcher', () => {
  const store = createShipStore(memoryStorage(), catalog);
  store.save(build);
  const invalid = { ...build, ammo: { [unrelatedAmmo]: 1 } };
  assert.throws(() => store.importJson(JSON.stringify(invalid)), /ammo|missile|рак|боеприпас|совмест/i);
  assert.deepEqual(store.get(build.id), build);
});
