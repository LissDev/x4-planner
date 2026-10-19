import assert from 'node:assert/strict';
import test from 'node:test';
import '../ship-data.js';
import { calculateShip, compareShipBuilds } from '../src/ship-engine.js';
import { estimateIsCombat } from '../src/is-combat.js';

const official = globalThis.X4_SHIP_DATA;
const armed = (shipId, groupId, id) => ({ id: 'coverage', name: 'Coverage', shipId,
  loadout: { [groupId]: [id] }, ammo: {}, prices: {} });
const synthetic = (item, kind = 'weapon') => ({ ships: [{ id: 'fixture', slotGroups: [
  { id: 'guns', type: kind, count: 1, compatibleEquipmentIds: [item.id] },
] }], equipment: [item] });
const fixtureBuild = id => armed('fixture', 'guns', id);
const projectile = (overrides = {}) => ({ bullet: { attach: 0, amount: 1, barrelamount: 1 },
  reload: { rate: 1 }, damage: { value: 10 }, ...overrides });
const weapon = (id, properties, heat = null, kind = 'weapon') => ({ id, kind, stats: {
  ...(heat ? { heat } : {}), projectile: properties,
} });
const coldHeat = { overheat: 10, reenable: 2, coolrate: 2, cooldelay: 1,
  overheatcooldelay: 2 };
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9,
  `${actual} should equal ${expected}`);

test('nominal and OOS count all barrels and pellets in one source firing event', () => {
  const item = weapon('paired', projectile({ bullet: { attach: 0, amount: 3, barrelamount: 2 },
    reload: { time: 2 }, damage: { value: 10, shield: 4 } }), null, 'turret');
  const catalog = synthetic(item, 'turret');
  const build = fixtureBuild(item.id);
  const nominal = calculateShip({ build, catalog });
  assert.deepEqual(nominal.damage, { shield: { burst: 12 }, hull: { burst: 30 } });
  assert.deepEqual(nominal.damageUnknown, { shield: { burst: 0 }, hull: { burst: 0 } });
  const oos = compareShipBuilds({ left: build, right: build, catalog,
    combatAssumptions: { targetSize: 'm' } }).left;
  close(oos.oosWindows.shield[1].value, 12 * .9 * .7 * .8 * .8);
  close(oos.oosWindows.hull[1].value, 30 * .9 * .7 * .8 * .8);
});

test('omitted projectile count means one; invalid or overflowing counts remain unknown', () => {
  const omitted = weapon('omitted', projectile({ bullet: { attach: 0, barrelamount: 1 },
    reload: { rate: 2 } }), null, 'turret');
  assert.equal(calculateShip({ build: fixtureBuild('omitted'), catalog: synthetic(omitted, 'turret') })
    .damage.hull.burst, 20);
  for (const [amount, barrelamount] of [[0, 1], [1.5, 1], [-1, 1],
    [1, 0], [1, 1.5], [Number.MAX_SAFE_INTEGER, 2]]) {
    const invalid = weapon('invalid', projectile({ bullet: { attach: 0, amount, barrelamount } }),
      null, 'turret');
    const catalog = synthetic(invalid, 'turret');
    const build = fixtureBuild('invalid');
    const nominal = calculateShip({ build, catalog });
    assert.equal(nominal.damage.hull.burst, null);
    assert.equal(nominal.damageUnknown.hull.burst, 1);
    const is = estimateIsCombat(build, catalog);
    assert.equal(is.mounts[0].status, 'unknown');
    assert.equal(is.mounts[0].reason, 'invalid-count');
    assert.equal(is.hull.damage[10], null);
    assert.equal(is.hull.unknown, 1);
  }
});

test('direct and full area damage both land on one target', () => {
  const item = weapon('mixed', projectile({ damage: { value: 10, shield: 4 },
    areadamage: { value: 30, shield: 12 }, reload: { rate: 2 } }), null, 'turret');
  const nominal = calculateShip({ build: fixtureBuild(item.id), catalog: synthetic(item, 'turret') });
  assert.deepEqual(nominal.damage, { shield: { burst: 32 }, hull: { burst: 80 } });
});

test('IS groups pellets and barrels into one trigger heat event', () => {
  const item = weapon('grouped', projectile({ bullet: { attach: 0, amount: 3, barrelamount: 2 },
    heat: { value: 4 } }), coldHeat);
  const estimate = estimateIsCombat(fixtureBuild(item.id), synthetic(item));
  assert.equal(estimate.mounts[0].status, 'known');
  assert.equal(estimate.mounts[0].firstOverheat, 2);
  assert.equal(estimate.mounts[0].coolingPause, 7);
  assert.deepEqual(estimate.hull.damage, { 10: 240, 30: 540, 60: 1020 });
  close(estimate.hull.steadyDps, 15);
});

test('IS grouped trigger consumes one magazine position', () => {
  const item = weapon('grouped-magazine', projectile({ bullet: { attach: 0, amount: 3,
    barrelamount: 2 }, ammunition: { value: 3, reload: 2 } }), null, 'turret');
  const estimate = estimateIsCombat(fixtureBuild(item.id), synthetic(item, 'turret'));
  assert.equal(estimate.mounts[0].status, 'known');
  assert.deepEqual(estimate.hull.damage, { 10: 480, 30: 1380, 60: 2700 });
  close(estimate.hull.steadyDps, 45);
});

test('charge time delays first launch and separates later launches by charge plus reload', () => {
  const item = weapon('charged', projectile({ bullet: { attach: 0, amount: 1, barrelamount: 1,
    chargetime: 2 }, reload: { rate: 1 } }), null, 'turret');
  const estimate = estimateIsCombat(fixtureBuild(item.id), synthetic(item, 'turret'));
  assert.equal(estimate.mounts[0].status, 'known');
  assert.deepEqual(estimate.hull.damage, { 10: 30, 30: 100, 60: 200 });
  close(estimate.hull.steadyDps, 10 / 3);
});

test('beam damage is active DPS with partial windows and overlapping reload', () => {
  const item = weapon('beam', projectile({ bullet: { attach: 1, amount: 1, barrelamount: 1,
    lifetime: 2 }, reload: { time: 3 }, damage: { value: 20, shield: 5 } }), null, 'turret');
  const catalog = synthetic(item, 'turret');
  const build = fixtureBuild(item.id);
  const nominal = calculateShip({ build, catalog });
  close(nominal.damage.hull.burst, 40 / 3);
  const estimate = estimateIsCombat(build, catalog);
  assert.equal(estimate.mounts[0].status, 'known');
  assert.deepEqual(estimate.hull.damage, { 10: 140, 30: 400, 60: 800 });
  close(estimate.hull.steadyDps, 40 / 3);
  close(estimate.shield.damage[10], 35);
});

test('beam overheat stops emission during activation and initial heat applies once', () => {
  const item = weapon('hot-beam', projectile({ bullet: { attach: 1, amount: 1,
    barrelamount: 1, lifetime: 4 }, reload: { time: 10 },
    damage: { value: 10 }, heat: { initial: 4, value: 2 } }),
  { overheat: 10, reenable: 2, coolrate: 2, cooldelay: 1, overheatcooldelay: 1 });
  const estimate = estimateIsCombat(fixtureBuild(item.id), synthetic(item));
  assert.equal(estimate.mounts[0].status, 'known');
  assert.equal(estimate.mounts[0].firstOverheat, 3);
  assert.deepEqual(estimate.hull.damage, { 10: 30, 30: 90, 60: 180 });
  close(estimate.hull.steadyDps, 3);
});

test('beam steady rate uses the recurring four-second active interval after a longer cold start', () => {
  const item = weapon('beam-thermal-cycle', projectile({ bullet: { attach: 1, amount: 1,
    barrelamount: 1, lifetime: 5 }, reload: { rate: 1 },
    heat: { value: 2 }, damage: { value: 10 } }),
  { overheat: 10, reenable: 2, coolrate: 2, cooldelay: 0, overheatcooldelay: 0 });
  const estimate = estimateIsCombat(fixtureBuild(item.id), synthetic(item));
  assert.equal(estimate.mounts[0].status, 'known');
  assert.deepEqual(estimate.hull.damage, { 10: 60, 30: 170, 60: 320 });
  close(estimate.hull.steadyDps, 5);
});

test('beam magazine reload overlaps emission after activation consumes its round', () => {
  const item = weapon('beam-magazine', projectile({ bullet: { attach: 1, amount: 1,
    barrelamount: 1, lifetime: 5 }, reload: { rate: 1 },
    ammunition: { value: 1, reload: 2 }, damage: { value: 10 } }), null, 'turret');
  const estimate = estimateIsCombat(fixtureBuild(item.id), synthetic(item, 'turret'));
  assert.equal(estimate.mounts[0].status, 'known');
  assert.deepEqual(estimate.hull.damage, { 10: 100, 30: 300, 60: 600 });
  close(estimate.hull.steadyDps, 10);
});

test('real extracted Behemoth, Muon, Boron arc and Xenon mixed plasma nominal rates', () => {
  const cases = [
    ['weapon_arg_l_destroyer_01_mk1', 2470, 2470],
    ['weapon_tel_m_charge_01_mk1', 246 / 1.4, 524 / 1.4],
    ['weapon_bor_s_arc_01_mk1', 160.74, 160.74],
    ['turret_xen_l_plasma_01_mk1', 604.8, 811.2],
  ];
  for (const [id, shield, hull] of cases) {
    const item = official.equipment.find(entry => entry.id === id);
    assert.ok(item?.stats?.projectile, `${id} exists with raw projectile properties`);
    const catalog = synthetic(item, item.kind);
    const nominal = calculateShip({ build: fixtureBuild(id), catalog });
    close(nominal.damage.shield.burst, shield);
    close(nominal.damage.hull.burst, hull);
    assert.equal(nominal.damageUnknown.hull.burst, 0);
  }
});

test('real beam and Tau shotgun with event heat gain IS coverage in a mixed build', () => {
  const ids = ['weapon_gen_m_laser_01_mk1', 'weapon_gen_m_beam_01_mk1',
    'weapon_spl_m_shotgun_01_mk1'];
  const build = armed('ship_par_m_corvette_01_a', 'weapon:con_primaryweapon_04', ids[0]);
  build.loadout['weapon:con_primaryweapon_02'] = [ids[1]];
  build.loadout['weapon:con_primaryweapon_03'] = [ids[2]];
  const estimate = estimateIsCombat(build, official);
  assert.deepEqual(estimate.mounts.map(mount => mount.status), ['known', 'known', 'known']);
  assert.equal(estimate.hull.unknown, 0);
  assert.ok(estimate.hull.damage[10] > 0);
});

test('essential missing heat and malformed timing remain explicit unknown', () => {
  const noHeat = weapon('no-heat', projectile());
  const badTiming = weapon('bad-time', projectile({ reload: { time: 0 } }), null, 'turret');
  for (const [item, kind] of [[noHeat, 'weapon'], [badTiming, 'turret']]) {
    const catalog = synthetic(item, kind);
    const estimate = estimateIsCombat(fixtureBuild(item.id), catalog);
    assert.equal(estimate.mounts[0].status, 'unknown');
    assert.equal(estimate.hull.unknown, 1);
    assert.equal(estimate.hull.damage[10], null);
    assert.equal(estimate.hull.steadyDps, null);
  }
});
