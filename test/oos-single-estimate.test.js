import assert from 'node:assert/strict';
import test from 'node:test';
import { compareShipBuilds } from '../src/ship-engine.js';

const catalog = {
  ships: [{ id: 'ship', hull: 100, slotGroups: [{ id: 'gun', type: 'weapon', count: 1,
    compatibleEquipmentIds: ['known'] }] }],
  equipment: [{ id: 'known', kind: 'weapon', stats: { projectile: {
    bullet: { amount: 1, barrelamount: 1, attach: 0 }, damage: { value: 100 }, reload: { rate: 1 },
  } } }],
};
const build = { id: 'ship-build', name: 'Ship', shipId: 'ship', loadout: { gun: ['known'] }, ammo: {}, prices: {} };
const measure = extra => compareShipBuilds({ left: build, right: build, catalog,
  combatAssumptions: { targetSize: 'm', damageMode: 'nominal-burst', ...extra } });

test('size-based OOS output is one numeric estimate for each time window', () => {
  const result = measure();
  const shield = result.left.oosWindows.shield;
  const hull = result.left.oosWindows.hull;
  for (const [seconds, expected] of [[1, 50.4], [10, 504], [30, 1512]]) {
    assert.ok(Math.abs(shield[seconds].value - expected) < 1e-9,
      `${seconds}s shield estimate is .9 source hit × .7 bullet × .8 M-size heuristic × 100 DPS × time`);
    assert.ok(Math.abs(hull[seconds].value - expected) < 1e-9);
    assert.equal(shield[seconds].unknown, 0);
  }
});

test('obsolete OOS multiplier values cannot change or invalidate an automatic estimate', () => {
  const clean = measure().left.oosWindows;
  const oldRange = measure({ oosMultiplierRange: [0.2, 4] }).left.oosWindows;
  assert.deepEqual(oldRange, clean, 'Size model ignores former arbitrary lower and upper bounds');
  const inverted = measure({ oosMultiplierRange: [4, 0.2] }).left.oosWindows;
  assert.deepEqual(inverted, clean, 'An obsolete inverted share range is ignored for size estimates');
});

test('size-only estimate never leaks a legacy target-health TTK', () => {
  const target = { shield: 50, hull: 50 };
  const auto = compareShipBuilds({ left: build, right: build, target, catalog,
    combatAssumptions: { targetSize: 'm', damageMode: 'nominal-burst', hitEfficiency: 0.01,
      oosMultiplierRange: [1, 1] } });
  assert.equal(auto.left.timeToKill, null, 'S/M/L/XL target size carries no target health for TTK');
  assert.deepEqual(auto.left.oosEstimate, { min: null, max: null },
    'No hidden OOS time-to-kill range survives from a stale target object');
  const clean = measure().left.oosWindows.shield[1].value;
  assert.equal(auto.left.oosWindows.shield[1].value, clean,
    'Legacy target health and manual hit efficiency cannot affect automatic damage');
  const inverted = compareShipBuilds({ left: build, right: build, target, catalog,
    combatAssumptions: { targetSize: 'm', damageMode: 'nominal-burst', hitEfficiency: 0.01,
      oosMultiplierRange: [4, 0.2] } });
  assert.equal(inverted.left.timeToKill, null);
  assert.equal(inverted.left.oosWindows.shield[1].value, clean,
    'An obsolete inverted range also cannot affect the size-only estimate');
  const legacy = compareShipBuilds({ left: build, right: build, target, catalog,
    combatAssumptions: { damageMode: 'nominal-burst', oosMultiplierRange: [1, 1] } });
  assert.equal(legacy.left.timeToKill, 1, 'Legacy non-size comparison retains its independent TTK behavior');
});
