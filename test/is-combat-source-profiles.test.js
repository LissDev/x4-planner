import assert from 'node:assert/strict';
import test from 'node:test';
import '../ship-data.js';
import { estimateIsCombat } from '../src/is-combat.js';

test('official beam, Tau shotgun and flak contribute beside a supported pulse', () => {
  const build = { id: 'profiles', name: 'Profiles', shipId: 'ship_par_m_corvette_01_a',
    loadout: {
      'weapon:con_primaryweapon_04': ['weapon_gen_m_laser_01_mk1'],
      'weapon:con_primaryweapon_02': ['weapon_gen_m_beam_01_mk1'],
      'weapon:con_primaryweapon_03': ['weapon_spl_m_shotgun_01_mk1'],
      'turret:con_turret_L01': ['turret_arg_m_flak_01_mk1'],
    }, ammo: {}, prices: {} };
  const estimate = estimateIsCombat(build, globalThis.X4_SHIP_DATA);
  assert.deepEqual(estimate.mounts.map(mount => [mount.id, mount.status, mount.reason]), [
    ['turret_arg_m_flak_01_mk1', 'known', null],
    ['weapon_gen_m_laser_01_mk1', 'known', null],
    ['weapon_gen_m_beam_01_mk1', 'known', null],
    ['weapon_spl_m_shotgun_01_mk1', 'known', null],
  ]);
  assert.equal(estimate.shield.unknown, 0);
  assert.ok(estimate.shield.damage[10] > 0);
  assert.ok(estimate.shield.steadyDps > 0);
});

test('weapon with essential heat data missing stays explicitly unknown', () => {
  const source = globalThis.X4_SHIP_DATA.equipment.find(item => item.id === 'weapon_gen_m_laser_01_mk1');
  const incomplete = { ...source, id: 'pulse-missing-heat', stats: { ...source.stats, heat: undefined } };
  const catalog = { ships: [{ id: 'fixture', slotGroups: [{ id: 'weapon', type: 'weapon', count: 1,
    compatibleEquipmentIds: [incomplete.id] }] }], equipment: [incomplete] };
  const build = { id: 'incomplete', name: 'Incomplete', shipId: 'fixture',
    loadout: { weapon: [incomplete.id] }, ammo: {}, prices: {} };
  const estimate = estimateIsCombat(build, catalog);
  assert.deepEqual(estimate.mounts.map(mount => [mount.status, mount.reason]),
    [['unknown', 'missing-heat']]);
  assert.equal(estimate.shield.unknown, 1);
  assert.equal(estimate.shield.damage[10], null);
  assert.equal(estimate.shield.steadyDps, null);
});
