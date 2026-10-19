import assert from 'node:assert/strict';
import test from 'node:test';
import { compatibleEquipment, calculateShip, compareShipBuilds } from '../src/ship-engine.js';

const catalog = {
  ships: [{
    id: 'frigate', name: 'Фрегат', hull: 600, mass: 1000, drag: { forward: 2 },
    priceAverage: 1000,
    slotGroups: [
      { id: 'drive', type: 'engine', tags: ['engine', 'size-m'], count: 1 },
      { id: 'barrier', type: 'shield', tags: ['shield', 'size-m'], count: 2 },
      { id: 'nose', type: 'weapon', tags: ['weapon', 'size-m', 'forward'], count: 2 },
      { id: 'turret', type: 'turret', tags: ['turret', 'size-s'], count: 1 },
      { id: 'launcher', type: 'missile', tags: ['missile', 'size-m'], count: 1 },
    ],
  }],
  equipment: [
    { id: 'drive-m', kind: 'engine', mountTags: ['engine', 'size-m'], priceAverage: 100, stats: { thrust: 2000 } },
    { id: 'drive-s', kind: 'engine', mountTags: ['engine', 'size-s'], priceAverage: 50, stats: { thrust: 3000 } },
    { id: 'shield-m', kind: 'shield', mountTags: ['shield', 'size-m'], priceAverage: 50, stats: { capacity: 100 } },
    { id: 'gun-forward', kind: 'weapon', mountTags: ['weapon', 'size-m', 'forward'], priceAverage: 25,
      stats: { shieldBurst: 40, hullBurst: 30, shieldSustained: 20, hullSustained: 15 } },
    { id: 'gun-turret-only', kind: 'weapon', mountTags: ['weapon', 'size-m', 'turret'], priceAverage: 20, stats: {} },
    { id: 'turret-s', kind: 'turret', mountTags: ['turret', 'size-s'], priceAverage: 30,
      stats: { shieldBurst: 20, hullBurst: 10, shieldSustained: 10, hullSustained: 5 } },
    { id: 'missile-m', kind: 'missile', mountTags: ['missile', 'size-m'], priceAverage: 10,
      stats: { shieldDamage: 90, hullDamage: 60 } },
  ],
  wares: [],
};

function build(overrides = {}) {
  return {
    id: 'alpha', name: 'Первый', shipId: 'frigate',
    loadout: { drive: ['drive-m'], barrier: ['shield-m', 'shield-m'], nose: ['gun-forward', 'gun-forward'],
      turret: ['turret-s'], launcher: ['missile-m'] },
    ammo: { 'missile-m': 2 }, prices: {}, ...overrides,
  };
}

test('equipment choices respect the selected group class, size, and mount variant', () => {
  assert.deepEqual(compatibleEquipment({ shipId: 'frigate', groupId: 'drive', catalog }).map(item => item.id), ['drive-m']);
  assert.deepEqual(compatibleEquipment({ shipId: 'frigate', groupId: 'nose', catalog }).map(item => item.id), ['gun-forward']);
  assert.deepEqual(compatibleEquipment({ shipId: 'frigate', groupId: 'turret', catalog }).map(item => item.id), ['turret-s']);
});

test('selected ship and equipment produce physical stats, editable cost, and separate nominal damage', () => {
  const result = calculateShip({ build: build({ prices: { 'drive-m': 120 } }), catalog, hitEfficiency: 0.5 });
  assert.equal(result.hull, 600);
  assert.equal(result.shieldCapacity, 200);
  assert.equal(result.totalPrice, 1320);
  assert.equal(result.performance.acceleration, 2);
  assert.equal(result.performance.topSpeed, 1000);
  assert.deepEqual(result.damage.shield, { burst: 100 });
  assert.deepEqual(result.damage.hull, { burst: 70 });
  assert.deepEqual(result.missileSalvo, { shield: 180, hull: 120 });
});

test('time-to-kill uses separate shield and hull phases, and zero efficiency is unreachable', () => {
  const target = { shield: 100, hull: 140 };
  const left = build();
  const right = build({ id: 'beta', name: 'Второй', loadout: { ...build().loadout, nose: [] } });
  const comparison = compareShipBuilds({ left, right, target, catalog,
    combatAssumptions: { hitEfficiency: 0.5, oosMultiplierRange: [0.5, 1.5] } });
  assert.equal(comparison.left.timeToKill, 6);
  assert.equal(comparison.right.timeToKill, 38);
  assert.equal(comparison.left.damage.shield.burst, 100, 'Finite missiles cannot inflate nominal DPS');
  assert.match(comparison.oosLabel, /сценарная оценка.*формула OOS неизвестна/i);
  assert.equal(comparison.left.oosEstimate.min, 4);
  assert.equal(comparison.left.oosEstimate.max, 12);
  const narrower = compareShipBuilds({ left, right, target, catalog,
    combatAssumptions: { hitEfficiency: 0.5, oosMultiplierRange: [1, 2] } });
  assert.equal(narrower.left.timeToKill, 6, 'OOS multipliers do not change the IS estimate');
  assert.equal(narrower.left.oosEstimate.min, 3);
  assert.equal(narrower.left.oosEstimate.max, 6);
  const miss = compareShipBuilds({ left, right, target, catalog,
    combatAssumptions: { hitEfficiency: 0, oosMultiplierRange: [0.5, 1.5] } });
  assert.equal(miss.left.timeToKill, Infinity);
});

test('invalid slot counts, incompatible equipment, and invalid efficiency are rejected', () => {
  assert.throws(() => calculateShip({ build: build({ loadout: { ...build().loadout, drive: ['drive-m', 'drive-m'] } }), catalog,
    hitEfficiency: 1 }), /slot|count|мест/i);
  assert.throws(() => calculateShip({ build: build({ loadout: { ...build().loadout, drive: ['drive-s'] } }), catalog,
    hitEfficiency: 1 }), /compat|совмест|mount/i);
  assert.throws(() => calculateShip({ build: build(), catalog, hitEfficiency: 1.2 }), /efficien|точност|попадан/i);
});

test('missing source flight stats remain unknown instead of appearing as zero', () => {
  const unknownCatalog = structuredClone(catalog);
  unknownCatalog.ships[0].drag.forward = null;
  unknownCatalog.equipment[0].stats.thrust = null;
  const result = calculateShip({ build: build(), catalog: unknownCatalog, hitEfficiency: 1 });
  assert.equal(result.performance.acceleration, null);
  assert.equal(result.performance.topSpeed, null);
});

test('travel-mode maximum speed uses each installed engine travel multiplier and reports missing source data', () => {
  const travelCatalog = structuredClone(catalog);
  const drive = travelCatalog.equipment.find(item => item.id === 'drive-m');
  drive.stats.travel = { thrust: 8 };
  travelCatalog.ships[0].slotGroups.find(group => group.id === 'drive').count = 2;
  travelCatalog.equipment.push({ id: 'drive-travel', kind: 'engine',
    mountTags: ['engine', 'size-m'], priceAverage: 100,
    stats: { thrust: { forward: 1000 }, travel: { thrust: 12 } } });
  const equipped = build({ loadout: { ...build().loadout, drive: ['drive-m', 'drive-travel'] } });
  const result = calculateShip({ build: equipped, catalog: travelCatalog });
  assert.equal(result.performance.topSpeed, 1500);
  assert.equal(result.performance.travelSpeed, 14000,
    'Travel thrust from unlike engines is summed before dividing by forward drag');

  drive.stats.travel = {};
  assert.equal(calculateShip({ build: equipped, catalog: travelCatalog }).performance.travelSpeed, null,
    'One installed engine with unknown travel thrust makes the maximum unknown');
});

test('empty positions in a multi-engine group do not shift mounts or count as equipment', () => {
  const multiCatalog = structuredClone(catalog);
  multiCatalog.ships[0].slotGroups.find(group => group.id === 'drive').count = 4;
  const positioned = build({ loadout: { ...build().loadout,
    drive: ['', 'drive-m', '', 'drive-m'] } });
  const result = calculateShip({ build: positioned, catalog: multiCatalog, hitEfficiency: 1 });
  assert.equal(result.performance.acceleration, 4, 'Only two installed engines contribute thrust');
  assert.equal(result.performance.topSpeed, 2000);
  assert.equal(result.totalPrice, 1400, 'Empty positions add no equipment cost');
  assert.deepEqual(positioned.loadout.drive, ['', 'drive-m', '', 'drive-m'],
    'Calculation must not compact or mutate indexed slots');
  assert.throws(() => calculateShip({ build: build({ loadout: { ...build().loadout,
    drive: ['', 'drive-m', '', 'drive-m', 'drive-m'] } }), catalog: multiCatalog, hitEfficiency: 1 }),
  /slot|count|мест/i, 'An array longer than the slot count must remain invalid');
});

test('projectile and barrel counts scale nominal damage only when positive integers', () => {
  const gunCatalog = {
    ships: [{ id: 'attacker', slotGroups: [{ id: 'gun', type: 'weapon', count: 1,
      compatibleEquipmentIds: ['pellet-gun'] }] }],
    equipment: [{ id: 'pellet-gun', kind: 'weapon', stats: { projectile: {
      bullet: { amount: 3, barrelamount: 1, attach: 0 },
      damage: { shield: 15, hull: 10 }, reload: { rate: 2 },
    } } }],
  };
  const gunBuild = { id: 'armed', name: 'Armed', shipId: 'attacker',
    loadout: { gun: ['pellet-gun'] }, ammo: {}, prices: {} };
  const calculate = () => calculateShip({ build: gunBuild, catalog: gunCatalog });
  assert.deepEqual(calculate().damage, { shield: { burst: 90 }, hull: { burst: 60 } },
    'Three projectiles with distinct shield and hull damage fire twice per second');
  for (const invalid of [0, 1.5]) {
    gunCatalog.equipment[0].stats.projectile.bullet.amount = invalid;
    const result = calculate();
    assert.deepEqual(result.damage, { shield: { burst: null }, hull: { burst: null } });
    assert.deepEqual(result.damageUnknown, { shield: { burst: 1 }, hull: { burst: 1 } });
  }
  gunCatalog.equipment[0].stats.projectile.bullet.amount = 3;
  gunCatalog.equipment[0].stats.projectile.bullet.barrelamount = 2;
  const multiBarrel = calculate();
  assert.deepEqual(multiBarrel.damage, { shield: { burst: 180 }, hull: { burst: 120 } },
    'Three projectiles from each of two barrels fire twice per second');
  assert.deepEqual(multiBarrel.damageUnknown, { shield: { burst: 0 }, hull: { burst: 0 } });
});
