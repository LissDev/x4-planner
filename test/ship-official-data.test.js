import assert from 'node:assert/strict';
import test from 'node:test';
import '../ship-data.js';
import { calculateShip, compatibleEquipment, compareShipBuilds } from '../src/ship-engine.js';

const catalog = globalThis.X4_SHIP_DATA;
const shipId = 'ship_par_m_corvette_01_a';
const engineGroup = 'engine:con_engine_01';
const shieldGroup = 'shield:con_shield_front_R';
const weaponGroup = 'weapon:con_primaryweapon_04';
const turretGroup = 'turret:con_turret_L01';

function build(loadout) {
  return { id: 'official-nemesis', name: 'Немезида', shipId, loadout, ammo: {}, prices: {} };
}

test('official Nemesis engine and shield source properties yield flight and shield figures', () => {
  assert.ok(compatibleEquipment({ shipId, groupId: engineGroup, catalog })
    .some(item => item.id === 'engine_par_m_combat_01_mk1'));
  const result = calculateShip({ build: build({
    [engineGroup]: ['engine_par_m_combat_01_mk1'],
    [shieldGroup]: ['shield_par_m_standard_01_mk1'],
  }), catalog, hitEfficiency: 1 });
  assert.equal(result.hull, 13000);
  assert.equal(result.shieldCapacity, 4000);
  assert.ok(Math.abs(result.performance.topSpeed - 1201.75 / 3.547) < 1e-8);
  assert.ok(Math.abs(result.performance.acceleration - 1201.75 / 22) < 1e-8);
});

test('official pulse shows a source-derived nominal rate without inventing heat behavior', () => {
  const equipmentId = 'weapon_gen_m_laser_01_mk1';
  assert.ok(compatibleEquipment({ shipId, groupId: weaponGroup, catalog }).some(item => item.id === equipmentId));
  const result = calculateShip({ build: build({ [weaponGroup]: [equipmentId] }), catalog, hitEfficiency: 1 });
  assert.deepEqual(result.damage, {
    shield: { burst: 440 },
    hull: { burst: 440 },
  }, '55 raw projectile damage × 8 shots/s × one projectile/barrel gives nominal rate');
});

test('official Tau multi-projectile weapons contribute nominal and size-based OOS damage', () => {
  const variants = [
    ['weapon_spl_m_shotgun_01_mk1', 90, 2],
    ['weapon_spl_m_shotgun_01_mk2', 130, 2],
    ['weapon_spl_s_shotgun_01_mk1', 56, 2.5],
    ['weapon_spl_s_shotgun_01_mk2', 80, 3],
  ];
  for (const [equipmentId, damagePerProjectile, shotsPerSecond] of variants) {
    const small = equipmentId.includes('_s_');
    const mountedShipId = small ? 'ship_spl_s_fighter_01_a' : shipId;
    const mountedGroup = small ? 'weapon:con_weapon_01' : weaponGroup;
    assert.ok(compatibleEquipment({ shipId: mountedShipId, groupId: mountedGroup, catalog })
      .some(item => item.id === equipmentId), `${equipmentId} fits the real weapon mount`);
    const tau = catalog.equipment.find(item => item.id === equipmentId);
    assert.equal(tau.stats.projectile.bullet.amount, 4);
    assert.equal(tau.stats.projectile.bullet.barrelamount, 1);
    const armed = { ...build({ [mountedGroup]: [equipmentId] }), shipId: mountedShipId };
    const nominal = 4 * damagePerProjectile * shotsPerSecond;
    const result = compareShipBuilds({ left: armed, right: armed, catalog,
      combatAssumptions: { targetSize: 'm' } }).left;
    for (const phase of ['shield', 'hull']) {
      assert.equal(result.damage[phase].burst, nominal, `${equipmentId} nominal ${phase} rate`);
      assert.equal(result.damageUnknown[phase].burst, 0);
      assert.ok(Math.abs(result.oosWindows[phase][1].value - nominal * 0.9 * 0.7 * 0.8) < 1e-9,
        `${equipmentId} one-second M-target ${phase} estimate`);
      assert.equal(result.oosWindows[phase][1].unknown, 0);
    }
  }
});

test('official non-Tau shotgun also uses its six projectiles for nominal damage', () => {
  const equipmentId = 'weapon_gen_m_shotgun_01_mk1';
  assert.ok(compatibleEquipment({ shipId, groupId: weaponGroup, catalog })
    .some(item => item.id === equipmentId));
  const projectile = catalog.equipment.find(item => item.id === equipmentId).stats.projectile;
  assert.equal(projectile.bullet.amount, 6);
  assert.equal(projectile.bullet.barrelamount, 1);
  assert.equal(projectile.damage.value, 85);
  assert.equal(projectile.reload.rate, 0.8);
  const result = calculateShip({ build: build({ [weaponGroup]: [equipmentId] }), catalog });
  assert.deepEqual(result.damage, { shield: { burst: 408 }, hull: { burst: 408 } });
  assert.deepEqual(result.damageUnknown, { shield: { burst: 0 }, hull: { burst: 0 } });
});

test('official beam uses source damage as active DPS over its lifetime', () => {
  const equipmentId = 'weapon_gen_m_beam_01_mk1';
  assert.ok(compatibleEquipment({ shipId, groupId: weaponGroup, catalog }).some(item => item.id === equipmentId));
  const result = calculateShip({ build: build({ [weaponGroup]: [equipmentId] }), catalog, hitEfficiency: 1 });
  assert.deepEqual(result.damage, {
    shield: { burst: 45 },
    hull: { burst: 135 },
  }, 'One-second beam lifetime and one-second activation spacing preserve active DPS');
  assert.deepEqual(result.damageUnknown, { shield: { burst: 0 }, hull: { burst: 0 } });
});

test('official flak reports nominal one-area-hit rate', () => {
  const equipmentId = 'turret_arg_m_flak_01_mk1';
  assert.ok(compatibleEquipment({ shipId, groupId: turretGroup, catalog }).some(item => item.id === equipmentId));
  const result = calculateShip({ build: build({ [turretGroup]: [equipmentId] }), catalog, hitEfficiency: 1 });
  assert.deepEqual(result.damage, {
    shield: { burst: 504 },
    hull: { burst: 504 },
  }, '210 raw area damage × 2.4 shots/s × one area hit gives nominal rate');
  assert.match(result.damageAssumptionLabel, /один.*попадан|area.hit/i);
});

test('manual target estimate uses nominal damage and clearly excludes heat', () => {
  const pulse = build({ [weaponGroup]: ['weapon_gen_m_laser_01_mk1'] });
  const target = { shield: 110, hull: 220 };
  const nominal = compareShipBuilds({ left: pulse, right: pulse, target, catalog,
    combatAssumptions: { hitEfficiency: 0.5 } });
  assert.equal(nominal.left.timeToKill, 1.5, '110/(0.5×440) shield + 220/(0.5×440) hull');
  assert.match(nominal.damageBasisLabel, /без учёта перегрева/i);
});
