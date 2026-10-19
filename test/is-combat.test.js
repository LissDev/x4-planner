import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const moduleUrl = new URL('../src/is-combat.js', import.meta.url);
const thermal = { id: 'thermal', kind: 'weapon', stats: {
  heat: { overheat: 10, reenable: 2, coolrate: 2, cooldelay: 1, overheatcooldelay: 2 },
  projectile: { bullet: { amount: 1, barrelamount: 1, attach: 0 },
    heat: { value: 4 }, reload: { rate: 1 }, damage: { value: 10 } },
} };
const magazineTurret = { id: 'magazine-turret', kind: 'turret', stats: {
  projectile: { bullet: { amount: 1, barrelamount: 1, attach: 0 },
    ammunition: { value: 3, reload: 2 }, reload: { rate: 1 }, damage: { value: 10 } },
} };
const beam = { id: 'unmeasured-beam', kind: 'weapon', stats: {
  heat: thermal.stats.heat,
  projectile: { bullet: { amount: 1, barrelamount: 1, attach: 1 },
    heat: { value: 1 }, reload: { time: 1 }, damage: { value: 10 } },
} };
const fixture = { ships: [{ id: 'ship', slotGroups: [
  { id: 'guns', type: 'weapon', count: 3, compatibleEquipmentIds: ['thermal', 'unmeasured-beam'] },
  { id: 'turrets', type: 'turret', count: 1, compatibleEquipmentIds: ['magazine-turret'] },
] }], equipment: [thermal, magazineTurret, beam] };
const build = (loadout, ammo = {}) => ({ id: 'build', name: 'Build', shipId: 'ship',
  loadout, ammo, prices: {} });

test('IS estimate operation is available for a current ship build', () => {
  assert.ok(existsSync(moduleUrl), 'Continuous-fire IS estimate operation is missing');
});

test('cold thermal cycle reports first overheat, cooling pause, windows and true repeating mean', async () => {
  assert.ok(existsSync(moduleUrl), 'Continuous-fire IS estimate operation is missing');
  const { estimateIsCombat } = await import(moduleUrl.href);
  assert.equal(typeof estimateIsCombat, 'function');
  const estimate = estimateIsCombat(build({ guns: ['thermal'] }), fixture);
  const mount = estimate.mounts.find(item => item.id === 'thermal');
  assert.equal(mount.status, 'known');
  assert.equal(mount.firstOverheat, 2);
  assert.equal(mount.coolingPause, 7);
  for (const phase of ['shield', 'hull']) {
    assert.deepEqual(estimate[phase].damage, { 10: 40, 30: 90, 60: 170 });
    assert.equal(estimate[phase].steadyDps, 2.5,
      'Recurring 8-second cycle contains two 10-damage shots');
    assert.equal(estimate[phase].unknown, 0);
  }
});

test('turret magazine repeats without invented heat and keeps half-open window boundaries', async () => {
  assert.ok(existsSync(moduleUrl), 'Continuous-fire IS estimate operation is missing');
  const { estimateIsCombat } = await import(moduleUrl.href);
  const estimate = estimateIsCombat(build({ turrets: ['magazine-turret'] }), fixture);
  const mount = estimate.mounts.find(item => item.id === 'magazine-turret');
  assert.equal(mount.status, 'known');
  assert.equal(mount.firstOverheat, null);
  assert.equal(mount.coolingPause, null);
  assert.deepEqual(estimate.shield.damage, { 10: 80, 30: 230, 60: 450 });
  assert.equal(estimate.shield.steadyDps, 7.5,
    'Three shots recur every four seconds, including the magazine reload');
});

test('multiple mounts add known damage while an unsupported beam remains partial', async () => {
  assert.ok(existsSync(moduleUrl), 'Continuous-fire IS estimate operation is missing');
  const { estimateIsCombat } = await import(moduleUrl.href);
  const estimate = estimateIsCombat(build({ guns: ['thermal', 'thermal', 'unmeasured-beam'],
    turrets: ['magazine-turret'] }), fixture);
  assert.equal(estimate.mounts.length, 4);
  assert.equal(estimate.mounts.filter(item => item.id === 'unmeasured-beam')[0].status, 'unknown');
  assert.deepEqual(estimate.shield.damage, { 10: 160, 30: 410, 60: 790 });
  assert.equal(estimate.shield.steadyDps, 12.5);
  assert.equal(estimate.shield.unknown, 1);
  const noKnown = estimateIsCombat(build({ guns: ['unmeasured-beam'] }), fixture);
  assert.equal(noKnown.shield.damage[10], null);
  assert.equal(noKnown.shield.unknown, 1);
});

test('real M Pulse weapon has a supported conditional cycle from extracted game properties', async () => {
  assert.ok(existsSync(moduleUrl), 'Continuous-fire IS estimate operation is missing');
  const { estimateIsCombat } = await import(moduleUrl.href);
  const catalog = runInNewContext(`${readFileSync(new URL('../ship-data.js', import.meta.url), 'utf8')}\nX4_SHIP_DATA`);
  const real = { id: 'pulse', name: 'Pulse', shipId: 'ship_par_m_corvette_01_a',
    loadout: { 'weapon:con_primaryweapon_04': ['weapon_gen_m_laser_01_mk1'] },
    ammo: {}, prices: {} };
  const estimate = estimateIsCombat(real, catalog);
  assert.equal(estimate.mounts[0].status, 'known');
  assert.ok(estimate.mounts[0].firstOverheat > 0);
  assert.ok(estimate.shield.damage[10] > 0);
  assert.ok(estimate.shield.steadyDps > 0);
});
