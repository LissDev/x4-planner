import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateShip, compareShipBuilds } from '../src/ship-engine.js';

const catalog = {
  ships: [{ id: 'test-ship', name: 'Test ship', hull: 100, priceAverage: 1000,
    slotGroups: [
      { id: 'gun-a', type: 'weapon', count: 1, tags: ['weapon', 'size-m'] },
      { id: 'gun-b', type: 'weapon', count: 1, tags: ['weapon', 'size-m'] },
      { id: 'launcher', type: 'missile', count: 1, tags: ['missile', 'size-m'] },
    ] }],
  equipment: [
    { id: 'pulse', kind: 'weapon', mountTags: ['weapon', 'size-m'], priceAverage: 10,
      stats: { shieldBurst: 40, hullBurst: 30, shieldSustained: 20, hullSustained: 15 } },
    { id: 'beam', kind: 'weapon', mountTags: ['weapon', 'size-m'], priceAverage: 10,
      stats: { shieldBurst: null, hullBurst: null, shieldSustained: null, hullSustained: null } },
    { id: 'rocket', kind: 'missile', mountTags: ['missile', 'size-m'], priceAverage: 5,
      stats: { shieldDamage: 90, hullDamage: 60 } },
  ],
};
const build = { id: 'mixed', name: 'Mixed', shipId: 'test-ship',
  loadout: { 'gun-a': ['pulse'], 'gun-b': ['beam'], launcher: ['rocket'] },
  ammo: { rocket: 2 }, prices: {} };

test('mixed known pulse and unknown beam report partial damage without a complete kill estimate', () => {
  const result = calculateShip({ build, catalog, hitEfficiency: 1 });
  assert.equal(result.damage.shield.burst, 40);
  assert.equal(result.damage.hull.burst, 30);
  assert.equal(result.damageUnknown.shield.burst, 1);
  assert.equal(result.damageUnknown.hull.burst, 1);
  const comparison = compareShipBuilds({ left: build, right: build,
    target: { shield: 100, hull: 100 }, catalog,
    combatAssumptions: { hitEfficiency: 1, oosMultiplierRange: [0.5, 1.5] } });
  assert.equal(comparison.left.timeToKill, null,
    'A known subtotal must not imply a complete kill estimate while beam damage is unknown');
  assert.equal(comparison.left.damage.shield.burst, 40);
  assert.match(comparison.oosLabel, /сценарная оценка.*формула OOS неизвестна/i);
});

test('finite compatible missile stock remains separate from gun rates in a partial loadout', () => {
  const result = calculateShip({ build, catalog, hitEfficiency: 1 });
  assert.deepEqual(result.missileSalvo, { shield: 180, hull: 120 });
  assert.equal(result.damage.shield.burst, 40);
  assert.equal(result.damage.hull.burst, 30);
});

test('known missile stock remains a labelled partial subtotal beside unknown compatible ammo', () => {
  const mixedAmmoCatalog = structuredClone(catalog);
  mixedAmmoCatalog.ships[0].slotGroups.push({ id: 'turret', type: 'turret', count: 1,
    tags: ['turret', 'size-m'] });
  mixedAmmoCatalog.equipment.push(
    { id: 'launcher-m', kind: 'turret', mountTags: ['turret', 'size-m'], priceAverage: 20,
      compatibleAmmoIds: ['known-ammo', 'unknown-ammo'], stats: {} },
    { id: 'known-ammo', kind: 'ammo', priceAverage: 2,
      stats: { shieldDamage: 90, hullDamage: 60 } },
    { id: 'unknown-ammo', kind: 'ammo', priceAverage: 2,
      stats: { shieldDamage: null, hullDamage: null } },
  );
  const mixedAmmoBuild = { ...build,
    loadout: { ...build.loadout, turret: ['launcher-m'] },
    ammo: { 'known-ammo': 2, 'unknown-ammo': 3 } };
  const result = calculateShip({ build: mixedAmmoBuild, catalog: mixedAmmoCatalog });
  assert.deepEqual(result.missileSalvo, { shield: 180, hull: 120 },
    'Unknown ammo must not hide finite known stock potential');
  assert.deepEqual(result.missileSalvoUnknown, { shield: 1, hull: 1 },
    'The subtotal must state that another ammo type has unknown damage');
  const knownAmmo = result.missileDamage.find(entry => entry.id === 'known-ammo');
  assert.deepEqual(knownAmmo.perHit, { shield: 90, hull: 60 });
  assert.deepEqual(knownAmmo.launcherSalvo, { shield: 90, hull: 60 });
  assert.deepEqual(knownAmmo.stockPotential, { shield: 180, hull: 120 });
  const unknownAmmo = result.missileDamage.find(entry => entry.id === 'unknown-ammo');
  assert.deepEqual(unknownAmmo.perHit, { shield: null, hull: null });
  assert.deepEqual(unknownAmmo.stockPotential, { shield: null, hull: null });
});
