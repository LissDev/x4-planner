import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = file => runInNewContext(`${readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')}\n${file === 'data.js' ? 'X4_DATA' : 'X4_SHIP_DATA'}`);
const english = (record, description) => {
  assert.ok(record, `${description} exists by stable game ID`);
  assert.match(record.nameEn ?? '', /[A-Za-z]/, `${description} has an English game name`);
  assert.notEqual(record.nameEn, record.name, `${description} English name differs from Russian`);
  assert.doesNotMatch(record.nameEn, /\{\d+,\d+\}/, `${description} name resolves game text references`);
};

test('station wares and modules expose official English names alongside Russian names', () => {
  const catalog = source('data.js');
  english(catalog.wares.find(ware => ware.id === 'energycells'), 'Energy Cells ware');
  english(catalog.modules.find(module => module.id === 'module_gen_prod_energycells_01'), 'Energy Cells production module');
});

test('ship models and equipment expose English names under unchanged IDs', () => {
  const catalog = source('ship-data.js');
  english(catalog.ships.find(ship => ship.id === 'ship_par_m_corvette_01_a'), 'Nemesis model');
  english(catalog.equipment.find(item => item.id === 'weapon_gen_m_laser_01_mk1'), 'laser weapon');
});
