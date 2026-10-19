import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { createCatalog } from '../src/catalog.js';
import { calculateStation } from '../src/engine.js';

const source = JSON.parse(JSON.stringify(runInNewContext(
  `${readFileSync(new URL('../data.js', import.meta.url), 'utf8')}\nX4_DATA`)));
const sizes = ['dockarea_m', 'l', 'xl'];
const expectedIds = ['gen', 'ter', 'bor'].flatMap(race => ['build', 'equip'].flatMap(purpose =>
  sizes.map(size => `module_${race}_${purpose}_${size}_01`)));

test('official player-eligible ship fabrication and maintenance bays are in the station catalog', () => {
  const bays = source.modules.filter(module => module.kind === 'shipyard');
  assert.deepEqual(bays.map(module => module.id).sort(), expectedIds.sort(),
    'The game has six eligible S/M, L, and XL bays each for generic, Terran, and Boron');
  for (const module of bays) {
    assert.match(module.name, /[А-Яа-яЁё]/, `${module.id} needs its official Russian name`);
    assert.match(module.nameEn, /[A-Za-z]/, `${module.id} needs its official English name`);
    assert.ok(Object.keys(module.buildMaterials).length > 0, `${module.id} needs real construction materials`);
    assert.deepEqual(module.recipes, [], 'Bays do not have a fabricated hourly ware recipe');
  }
  assert.equal(bays.find(module => module.id === 'module_gen_build_dockarea_m_01')?.nameEn,
    'S/M Ship Fabrication Bay');
  assert.equal(bays.find(module => module.id === 'module_gen_equip_dockarea_m_01')?.nameEn,
    'S/M Ship Maintenance Bay');
  assert.deepEqual(bays.find(module => module.id === 'module_gen_build_dockarea_m_01')?.buildMaterials,
    { claytronics: 3312, energycells: 6620, hullparts: 12112 });
  assert.deepEqual(bays.find(module => module.id === 'module_ter_equip_l_01')?.buildMaterials,
    { computronicsubstrate: 252, energycells: 1866, siliconcarbide: 519 });
  assert.deepEqual(bays.find(module => module.id === 'module_bor_build_l_01')?.buildMaterials,
    { claytronics: 1714, energycells: 18213, hullparts: 5577, water: 16495 });
  for (const id of ['module_gen_build_m_01', 'module_gen_build_s_01',
    'module_xen_build_m_01', 'module_xen_build_s_01', 'module_xen_build_xl_01'])
    assert.equal(source.modules.some(module => module.id === id), false, `${id} has no player blueprint`);
});

test('ship bays add real construction cost without fabricated hourly output or workers', () => {
  const id = 'module_gen_build_dockarea_m_01#structure';
  const catalog = createCatalog(source, {}, 'argon');
  assert.ok(catalog.recipes[id], 'Player-eligible bay must be selectable as station infrastructure');
  const station = { modules: { [id]: 1 }, sunlight: 1, availableWorkforce: 0,
    prices: catalog.allPrices, finalWares: {}, purchasedIntermediates: [] };
  const result = calculateStation({ station, catalog });
  const empty = calculateStation({ station: { ...station, modules: {} }, catalog });
  const expectedCost = 3312 * catalog.allPrices.claytronics +
    6620 * catalog.allPrices.energycells + 12112 * catalog.allPrices.hullparts;
  assert.equal(result.constructionCost, expectedCost);
  assert.deepEqual(result.production, empty.production);
  assert.deepEqual(result.consumption, empty.consumption,
    'A ship bay adds no hourly demand beyond the empty station baseline');
  assert.equal(result.staffedWorkers, 0);
  assert.equal(result.hourlyRevenue, 0);
});
