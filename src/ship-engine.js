import { wpWeaponProfile } from './weapon-profile.js';

const items = value => Array.isArray(value) ? value : Object.values(value ?? {});
const known = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const sum = values => values.every(known) ? values.reduce((total, value) => total + value, 0) : null;
const damageSubtotal = values => {
  const available = values.filter(known);
  return { value: available.length || !values.length ? available.reduce((total, value) => total + value, 0) : null,
    unknown: values.length - available.length };
};

function shipFor(id, catalog) {
  const ship = items(catalog?.ships).find(candidate => candidate.id === id);
  if (!ship) throw new Error(`Unknown ship: ${id}`);
  return ship;
}

export function compatibleEquipment({ shipId, groupId, catalog }) {
  const group = shipFor(shipId, catalog).slotGroups?.find(candidate => candidate.id === groupId);
  if (!group) throw new Error(`Unknown slot group: ${groupId}`);
  return items(catalog?.equipment).filter(equipment =>
    group.compatibleEquipmentIds ? group.compatibleEquipmentIds.includes(equipment.id) :
      equipment.kind === group.type && (group.tags ?? []).every(tag => (equipment.mountTags ?? []).includes(tag)));
}

export function validateShipBuild(build, catalog) {
  if (!build || typeof build !== 'object' || typeof build.id !== 'string' || !build.id.trim() ||
    typeof build.name !== 'string' || !build.name.trim() || typeof build.shipId !== 'string' ||
    !build.loadout || typeof build.loadout !== 'object' || Array.isArray(build.loadout) ||
    !build.ammo || typeof build.ammo !== 'object' || Array.isArray(build.ammo) ||
    !build.prices || typeof build.prices !== 'object' || Array.isArray(build.prices)) {
    throw new Error('Invalid ship build');
  }
  const groups = shipFor(build.shipId, catalog).slotGroups ?? [];
  const groupIds = new Set(groups.map(group => group.id));
  for (const id of Object.keys(build.loadout)) {
    if (!groupIds.has(id)) throw new Error(`Unknown slot group: ${id}`);
  }
  for (const group of groups) {
    const selected = build.loadout[group.id] ?? [];
    if (!Array.isArray(selected) || selected.length > group.count || selected.some(id => typeof id !== 'string')) {
      throw new Error(`Invalid slot count: ${group.id}`);
    }
    const allowed = new Set(compatibleEquipment({ shipId: build.shipId, groupId: group.id, catalog }).map(item => item.id));
    if (selected.some(id => id && !allowed.has(id))) throw new Error(`Incompatible mount: ${group.id}`);
  }
  const selectedEquipment = groups.flatMap(group => build.loadout[group.id] ?? []).filter(Boolean)
    .map(id => items(catalog.equipment).find(item => item.id === id));
  const allowedAmmo = new Set(selectedEquipment.flatMap(item => item.kind === 'missile' ? [item.id] :
    item.compatibleAmmoIds ?? []));
  for (const [id, quantity] of Object.entries(build.ammo)) {
    if (!Number.isSafeInteger(quantity) || quantity < 0 || !allowedAmmo.has(id)) {
      throw new Error(`Invalid ammo: ${id}`);
    }
  }
  for (const [id, price] of Object.entries(build.prices)) {
    if (!known(price)) throw new Error(`Invalid price: ${id}`);
  }
  return build;
}

const priceFor = (item, prices) => prices[item.id] ?? item.priceAverage ?? null;
const ratio = (numerator, denominator) => known(numerator) && known(denominator) && denominator > 0
  ? numerator / denominator : null;
function nominalBurst(item, phase) {
  const direct = item.stats?.[`${phase}Burst`];
  if (direct !== undefined) return direct;
  const profile = wpWeaponProfile(item);
  if (profile.reason) return null;
  return profile.damage[phase] * (profile.beam ? profile.lifetime / Math.max(profile.period,
    profile.lifetime) : 1 / profile.period);
}

export function calculateShip({ build, catalog, hitEfficiency = 1 }) {
  if (!known(hitEfficiency) || hitEfficiency > 1) throw new Error('Invalid hit efficiency');
  validateShipBuild(build, catalog);
  const ship = shipFor(build.shipId, catalog);
  const equipment = items(catalog.equipment);
  const selected = (ship.slotGroups ?? []).flatMap(group => (build.loadout[group.id] ?? []).filter(Boolean).map(id =>
    ({ group, item: equipment.find(candidate => candidate.id === id) })));
  const installed = selected.filter(({ item }) => item.kind !== 'missile' && item.kind !== 'ammo');
  const shields = installed.filter(({ group }) => group.type === 'shield').map(({ item }) => item);
  const engines = installed.filter(({ group }) => group.type === 'engine').map(({ item }) => item);
  const weapons = installed.filter(({ group }) => ['weapon', 'turret'].includes(group.type)).map(({ item }) => item);
  const missiles = Object.entries(build.ammo).map(([id, quantity]) =>
    ({ item: equipment.find(candidate => candidate.id === id), quantity }));
  const damageValues = {
    shield: weapons.map(item => nominalBurst(item, 'shield')),
    hull: weapons.map(item => nominalBurst(item, 'hull')),
  };
  const damageSummary = Object.fromEntries(Object.entries(damageValues).map(([phase, values]) =>
    [phase, damageSubtotal(values)]));
  const missileDamage = missiles.map(({ item, quantity }) => {
    const launchers = selected.filter(({ item: mounted }) => mounted.id === item.id ||
      mounted.compatibleAmmoIds?.includes(item.id)).length;
    const perHit = {
      shield: item.stats?.shieldDamage ?? item.stats?.explosiondamage?.value ?? null,
      hull: item.stats?.hullDamage ?? item.stats?.explosiondamage?.value ?? null,
    };
    const scaled = count => Object.fromEntries(Object.entries(perHit).map(([phase, value]) =>
      [phase, known(value) ? value * count : null]));
    return { id: item.id, quantity, launchers, perHit,
      launcherSalvo: scaled(Math.min(launchers, quantity)), stockPotential: scaled(quantity) };
  });
  const thrust = sum(engines.map(item => item.stats?.thrust?.forward ?? item.stats?.thrust));
  const travelThrust = sum(engines.map(item => {
    const forward = item.stats?.thrust?.forward ?? item.stats?.thrust;
    const multiplier = item.stats?.travel?.thrust;
    return known(forward) && known(multiplier) ? forward * multiplier : null;
  }));
  const priceValues = [priceFor(ship, build.prices), ...installed.map(({ item }) => priceFor(item, build.prices)),
    ...missiles.map(({ item, quantity }) => {
      const price = priceFor(item, build.prices);
      return price === null ? null : price * quantity;
    })];
  return {
    hull: ship.hull ?? null,
    shieldCapacity: sum(shields.map(item => item.stats?.recharge?.max ?? item.stats?.capacity)),
    totalPrice: sum(priceValues),
    performance: {
      topSpeed: ratio(thrust, ship.drag?.forward),
      travelSpeed: ratio(travelThrust, ship.drag?.forward),
      acceleration: ratio(thrust, ship.mass),
      handling: ship.handling ?? null,
    },
    damage: Object.fromEntries(Object.entries(damageSummary).map(([phase, summary]) =>
      [phase, { burst: summary.value }])),
    damageUnknown: Object.fromEntries(Object.entries(damageSummary).map(([phase, summary]) =>
      [phase, { burst: summary.unknown }])),
    damageAssumptionLabel: weapons.some(item => item.stats?.projectile?.areadamage &&
      nominalBurst(item, 'hull') !== null) ? 'Один снаряд — одно попадание по площади' : null,
    missileDamage,
    missileSalvo: Object.fromEntries(['shield', 'hull'].map(phase =>
      [phase, damageSubtotal(missileDamage.map(entry => entry.stockPotential[phase])).value])),
    missileSalvoUnknown: Object.fromEntries(['shield', 'hull'].map(phase =>
      [phase, damageSubtotal(missileDamage.map(entry => entry.stockPotential[phase])).unknown])),
    hitEfficiency,
  };
}

function phaseTime(health, regeneration, damage, efficiency) {
  if (!known(health) || !known(regeneration) || !known(damage)) return null;
  if (health === 0) return 0;
  const netDamage = efficiency * damage - regeneration;
  return netDamage > 0 ? health / netDamage : Infinity;
}

function timeToKill(calculation, target, efficiency) {
  if (calculation.damageUnknown.shield.burst || calculation.damageUnknown.hull.burst) return null;
  const shield = phaseTime(target.shield, target.shieldRegeneration ?? 0,
    calculation.damage.shield.burst, efficiency);
  const hull = phaseTime(target.hull, target.hullRegeneration ?? 0,
    calculation.damage.hull.burst, efficiency);
  return shield === null || hull === null ? null : shield + hull;
}

const sizeFactors = {
  s: { bullet: 0.65, beam: 0.90, area: 0.85 },
  m: { bullet: 0.80, beam: 0.95, area: 0.90 },
  l: { bullet: 0.95, beam: 1, area: 1 },
  xl: { bullet: 1, beam: 1, area: 1 },
};
const familyFactors = { bullet: 0.7, beam: 0.9, area: 0.9 };

function automaticOos(build, catalog, targetSize) {
  const equipment = items(catalog.equipment);
  const mounts = (shipFor(build.shipId, catalog).slotGroups ?? []).flatMap(group =>
    (build.loadout[group.id] ?? []).filter(Boolean).map(id =>
      ({ group, item: equipment.find(candidate => candidate.id === id) })))
    .filter(({ group, item }) => ['weapon', 'turret'].includes(group.type) &&
      !['missile', 'ammo', 'missilelauncher'].includes(item.kind));
  return Object.fromEntries(['shield', 'hull'].map(phase => {
    const rates = mounts.map(({ item }) => nominalBurst(item, phase));
    const adjusted = rates.map((rate, index) => {
      if (!known(rate)) return null;
      const { group, item } = mounts[index];
      const projectile = item.stats?.projectile;
      const family = projectile?.areadamage ? 'area' : projectile?.bullet?.attach === 1 ? 'beam' : 'bullet';
      return rate * 0.9 * familyFactors[family] * sizeFactors[targetSize][family] *
        (group.type === 'turret' ? 0.8 : 1);
    });
    const subtotal = damageSubtotal(adjusted);
    const rawKnown = rates.filter(known).reduce((total, rate) => total + rate, 0);
    return [phase, { rate: subtotal.value, unknown: subtotal.unknown,
      fraction: rawKnown > 0 ? subtotal.value / rawKnown : null }];
  }));
}

export function compareShipBuilds({ left, right, target, catalog, combatAssumptions = {} }) {
  const targetSize = combatAssumptions.targetSize;
  if (targetSize !== undefined && !sizeFactors[targetSize]) throw new Error('Invalid target size');
  const efficiency = targetSize === undefined ? combatAssumptions.hitEfficiency ?? 1 : 1;
  const range = targetSize === undefined ? combatAssumptions.oosMultiplierRange ?? [0.5, 1.5] : null;
  if (range && (!Array.isArray(range) || range.length !== 2 || !range.every(value =>
    typeof value === 'number' && Number.isFinite(value) && value > 0) || range[0] > range[1])) {
    throw new Error('Invalid OOS multiplier range');
  }
  function measure(build) {
    const calculation = calculateShip({ build, catalog, hitEfficiency: efficiency });
    const time = target && targetSize === undefined ? timeToKill(calculation, target, efficiency) : null;
    const oosEffective = targetSize === undefined ? null : automaticOos(build, catalog, targetSize);
    const oosWindows = Object.fromEntries(['shield', 'hull'].map(phase => [phase,
      Object.fromEntries([1, 10, 30].map(seconds => {
        const damage = oosEffective ? oosEffective[phase].rate : calculation.damage[phase].burst;
        const unknown = oosEffective ? oosEffective[phase].unknown : calculation.damageUnknown[phase].burst;
        return [seconds, oosEffective ? { value: known(damage) ? damage * seconds : null, unknown } :
          { min: known(damage) ? damage * seconds * efficiency * range[0] : null,
            max: known(damage) ? damage * seconds * efficiency * range[1] : null, unknown }];
      }))]));
    return { ...calculation, timeToKill: time, oosWindows, oosEffective, oosEstimate: {
      min: target && range ? timeToKill(calculation, target, efficiency * range[1]) : null,
      max: target && range ? timeToKill(calculation, target, efficiency * range[0]) : null,
    } };
  }
  return { left: measure(left), right: measure(right),
    damageBasisLabel: 'оценка по номинальному урону, без учёта перегрева',
    oosLabel: 'сценарная оценка, формула OOS неизвестна' };
}
