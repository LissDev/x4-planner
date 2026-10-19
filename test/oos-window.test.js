import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateShip, compareShipBuilds } from '../src/ship-engine.js';

const catalog = {
  ships: [{ id: 'attacker', name: 'Attacker', hull: 1000, priceAverage: 10, slotGroups: [
    { id: 'gun', type: 'weapon', count: 1, tags: ['weapon'] },
    { id: 'launcher', type: 'missile', count: 1, tags: ['missile'] },
  ] }],
  equipment: [
    { id: 'known-gun', kind: 'weapon', mountTags: ['weapon'], priceAverage: 1,
      stats: { shieldBurst: 100, hullBurst: 60, shieldSustained: 100, hullSustained: 60 } },
    { id: 'unknown-gun', kind: 'weapon', mountTags: ['weapon'], priceAverage: 1,
      stats: { shieldBurst: null, hullBurst: null, shieldSustained: null, hullSustained: null } },
    { id: 'finite-missile', kind: 'missile', mountTags: ['missile'], priceAverage: 1,
      stats: { shieldDamage: 1000, hullDamage: 1000 } },
  ],
};
const build = (gun = 'known-gun') => ({ id: gun, name: gun, shipId: 'attacker',
  loadout: { gun: [gun], launcher: ['finite-missile'] }, ammo: { 'finite-missile': 2 }, prices: {} });
const compare = (left, right = left, size = 'm') => compareShipBuilds({
  left, right, target: { shield: 400, hull: 800, size }, catalog,
  combatAssumptions: { hitEfficiency: 0.5, oosMultiplierRange: [0.6, 1] },
});

test('known rates produce 1/10/30-second conditional shield and hull ranges without repeating missiles', () => {
  const attacker = build();
  const base = calculateShip({ build: attacker, catalog });
  assert.equal(base.damage.shield.burst, 100, 'Fixture has known nominal shield DPS');
  assert.equal(base.damage.hull.burst, 60, 'Fixture has known nominal hull DPS');
  assert.equal(base.missileSalvo.shield, 2000, 'Fixture carries finite missiles separately');
  const windows = compare(attacker).left.oosWindows;
  assert.deepEqual(windows?.shield?.[1], { min: 30, max: 50, unknown: 0 });
  assert.deepEqual(windows?.shield?.[10], { min: 300, max: 500, unknown: 0 });
  assert.deepEqual(windows?.shield?.[30], { min: 900, max: 1500, unknown: 0 });
  assert.deepEqual(windows?.hull?.[1], { min: 18, max: 30, unknown: 0 });
  assert.deepEqual(windows?.hull?.[10], { min: 180, max: 300, unknown: 0 });
  assert.deepEqual(windows?.hull?.[30], { min: 540, max: 900, unknown: 0 });
  assert.deepEqual(compare(attacker, attacker, 'xl').left.oosWindows, windows,
    'Target size does not imply an invented hit-chance multiplier');
});

test('unknown weapon rate remains visibly unknown instead of becoming zero damage', () => {
  const unknown = build('unknown-gun');
  assert.equal(calculateShip({ build: unknown, catalog }).damageUnknown.shield.burst, 1);
  const windows = compare(unknown).left.oosWindows;
  assert.deepEqual(windows?.shield?.[10], { min: null, max: null, unknown: 1 });
  assert.deepEqual(windows?.hull?.[10], { min: null, max: null, unknown: 1 });
});
