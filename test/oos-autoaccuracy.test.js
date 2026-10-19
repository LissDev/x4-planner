import assert from 'node:assert/strict';
import test from 'node:test';
import { compareShipBuilds } from '../src/ship-engine.js';

const catalog = {
  ships: [{ id: 'attacker', hull: 100, slotGroups: [
    { id: 'gun', type: 'weapon', count: 1, compatibleEquipmentIds: ['ordinary'] },
    { id: 'beam', type: 'weapon', count: 1, compatibleEquipmentIds: ['attached'] },
    { id: 'turret', type: 'turret', count: 1, compatibleEquipmentIds: ['area'] },
  ] }],
  equipment: [
    { id: 'ordinary', kind: 'weapon', stats: { projectile: {
      bullet: { amount: 1, barrelamount: 1, attach: 0 }, damage: { value: 100 }, reload: { rate: 1 },
    } } },
    { id: 'attached', kind: 'weapon', stats: { projectile: {
      bullet: { amount: 1, barrelamount: 1, attach: 1, lifetime: 1 }, damage: { value: 100 }, reload: { rate: 1 },
    } } },
    { id: 'area', kind: 'turret', stats: { projectile: {
      bullet: { amount: 1, barrelamount: 1, attach: 0 }, areadamage: { value: 100 },
      damage: { repair: 0 }, reload: { rate: 1 },
    } } },
  ],
};
const build = (id, loadout) => ({ id, name: id, shipId: 'attacker', loadout, ammo: {}, prices: {} });
const all = build('all', { gun: ['ordinary'], beam: ['attached'], turret: ['area'] });
const beamOnly = build('beam-only', { beam: ['attached'] });
const estimate = (targetSize, left = all) => compareShipBuilds({
  left, right: beamOnly, catalog,
  combatAssumptions: { targetSize },
});

test('conditional OOS windows use installed weapon families and selected target size', () => {
  const small = estimate('s');
  const medium = estimate('m');
  const large = estimate('l');
  const extraLarge = estimate('xl');
  const oneSecond = result => result.left.oosWindows.shield[1].value;
  assert.ok(oneSecond(small) < oneSecond(medium) && oneSecond(medium) < oneSecond(large) &&
    oneSecond(large) < oneSecond(extraLarge), 'App heuristic makes small targets harder to hit');
  // Three 100-DPS channels: ordinary bullet, attached beam, area-damage turret.
  assert.ok(Math.abs(oneSecond(small) - 168.93) < 1e-8);
  assert.ok(Math.abs(oneSecond(extraLarge) - 208.8) < 1e-8);
  assert.ok(Math.abs(small.right.oosWindows.shield[1].value - 72.9) < 1e-8,
    'Changing the current installed weapon mix changes the automatic estimate');
  assert.ok(Math.abs(small.left.oosWindows.hull[10].value - 1689.3) < 1e-8);
  assert.ok(Math.abs(small.left.oosWindows.shield[30].value - 5067.9) < 1e-8);
});

test('unknown nominal rate remains unknown beside known mounted weapons', () => {
  const unmeasuredCatalog = structuredClone(catalog);
  delete unmeasuredCatalog.equipment.find(item => item.id === 'attached').stats.projectile.bullet.lifetime;
  const result = compareShipBuilds({ left: all, right: beamOnly, catalog: unmeasuredCatalog,
    combatAssumptions: { targetSize: 'm' } });
  assert.equal(result.left.oosWindows.shield[1].unknown, 1);
  assert.equal(result.right.oosWindows.shield[1].value, null);
  assert.equal(result.right.oosWindows.shield[1].unknown, 1);
});

test('multi-slot nominal estimate doubles known mounts while keeping one unknown contribution', () => {
  const multiCatalog = {
    ships: [{ id: 'attacker', hull: 100, slotGroups: [{ id: 'multi', type: 'weapon', count: 3,
      compatibleEquipmentIds: ['ordinary', 'unmeasured'] }] }],
    equipment: [
      catalog.equipment[0],
      { id: 'unmeasured', kind: 'weapon', stats: { projectile: {
        bullet: { amount: 1, barrelamount: 1, attach: 0 }, damage: { value: 100 }, reload: { time: 0 },
      } } },
    ],
  };
  const once = build('once', { multi: ['ordinary', 'unmeasured'] });
  const twice = build('twice', { multi: ['ordinary', 'ordinary', 'unmeasured'] });
  const result = compareShipBuilds({ left: twice, right: once, catalog: multiCatalog,
    combatAssumptions: { targetSize: 's' } });
  assert.equal(result.left.damage.shield.burst, 200, 'Two mounted known weapons contribute raw nominal DPS');
  assert.equal(result.left.damageUnknown.shield.burst, 1, 'Third mounted weapon stays unknown');
  assert.equal(result.left.oosWindows.shield[1].unknown, 1);
  assert.equal(result.right.oosWindows.shield[1].unknown, 1);
  assert.ok(Math.abs(result.left.oosEffective.shield.fraction - 0.4095) < 1e-10);
  assert.ok(Math.abs(result.right.oosEffective.shield.fraction - 0.4095) < 1e-10);
  assert.ok(Math.abs(result.left.oosWindows.shield[1].value - 81.9) < 1e-10);
  assert.ok(Math.abs(result.right.oosWindows.shield[1].value - 40.95) < 1e-10);
  assert.ok(Math.abs(result.left.oosWindows.hull[10].value - 819) < 1e-10);
  assert.ok(Math.abs(result.left.oosWindows.shield[30].value - 2457) < 1e-10);
});
