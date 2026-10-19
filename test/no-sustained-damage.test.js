import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateShip, compareShipBuilds } from '../src/ship-engine.js';

const catalog = {
  ships: [{ id: 'attacker', hull: 100, slotGroups: [
    { id: 'gun', type: 'weapon', count: 1, compatibleEquipmentIds: ['known'] },
    { id: 'beam', type: 'weapon', count: 1, compatibleEquipmentIds: ['unmeasured'] },
  ] }],
  equipment: [
    { id: 'known', kind: 'weapon', stats: { shieldSustained: 900, hullSustained: 800,
      projectile: { bullet: { amount: 1, barrelamount: 1, attach: 0 },
        reload: { rate: 1 }, damage: { value: 100 } } } },
    { id: 'unmeasured', kind: 'weapon', stats: { projectile: {
      bullet: { amount: 1, barrelamount: 1, attach: 1 },
      reload: { time: 1 }, damage: { value: 100 },
    } } },
  ],
};
const build = (id, withBeam = false) => ({ id, name: id, shipId: 'attacker',
  loadout: { gun: ['known'], ...(withBeam ? { beam: ['unmeasured'] } : {}) },
  ammo: {}, prices: {} });

test('ship damage exposes only nominal rates, even when obsolete sustained data is present', () => {
  const damage = calculateShip({ build: build('single'), catalog });
  assert.deepEqual(damage.damage.shield, { burst: 100 });
  assert.deepEqual(damage.damage.hull, { burst: 100 });
  assert.deepEqual(damage.damageUnknown.shield, { burst: 0 });
  assert.deepEqual(damage.damageUnknown.hull, { burst: 0 });
});

test('OOS defaults to nominal damage and ignores obsolete sustained mode', () => {
  const left = build('known');
  const right = build('partial', true);
  const compare = damageMode => compareShipBuilds({ left, right, catalog,
    combatAssumptions: { targetSize: 'm', ...(damageMode ? { damageMode } : {}) } });
  const ordinary = compare();
  const oldSharedLink = compare('sustained');
  assert.ok(Math.abs(ordinary.left.oosWindows.shield[1].value - 50.4) < 1e-10);
  assert.ok(Math.abs(ordinary.left.oosWindows.hull[30].value - 1512) < 1e-10);
  assert.equal(ordinary.right.oosWindows.shield[10].unknown, 1,
    'Unknown nominal beam remains explicit beside the known subtotal');
  assert.ok(Math.abs(ordinary.right.oosWindows.shield[10].value - 504) < 1e-10);
  assert.equal(oldSharedLink.left.oosWindows.shield[1].value,
    ordinary.left.oosWindows.shield[1].value,
    'An old sustained-mode link cannot restore a hidden sustained estimate');
  assert.doesNotMatch(oldSharedLink.damageModeLabel ?? '', /sustain|длительн/i);
});
