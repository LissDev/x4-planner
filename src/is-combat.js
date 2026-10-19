import { validateShipBuild } from './ship-engine.js';
import { wpWeaponProfile } from './weapon-profile.js';

const isWindows = [10, 30, 60];
const isEventLimit = 100000;
const isPositive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const isNonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function isGcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a < 0n ? -a : a;
}
function isFraction(n, d = 1n) {
  if (d < 0n) { n = -n; d = -d; }
  const divisor = isGcd(n, d);
  return { n: n / divisor, d: d / divisor };
}
function isDecimal(value) {
  const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e');
  const digits = mantissa.replace('.', '');
  const decimalPlaces = mantissa.includes('.') ? mantissa.length - mantissa.indexOf('.') - 1 : 0;
  const shift = Number(exponent) - decimalPlaces;
  return shift >= 0 ? isFraction(BigInt(digits) * 10n ** BigInt(shift)) :
    isFraction(BigInt(digits), 10n ** BigInt(-shift));
}
const isAdd = (a, b) => isFraction(a.n * b.d + b.n * a.d, a.d * b.d);
const isSubtract = (a, b) => isFraction(a.n * b.d - b.n * a.d, a.d * b.d);
const isMultiply = (a, b) => isFraction(a.n * b.n, a.d * b.d);
const isDivide = (a, b) => isFraction(a.n * b.d, a.d * b.n);
const isCompare = (a, b) => a.n * b.d - b.n * a.d;
const isMax = (a, b) => isCompare(a, b) >= 0 ? a : b;
const isMin = (a, b) => isCompare(a, b) <= 0 ? a : b;
const isNumber = value => Number(value.n) / Number(value.d);
const isZero = isFraction(0n);
const isOne = isFraction(1n);

function isProfile(item) {
  const source = wpWeaponProfile(item);
  if (source.reason) return source;
  if (source.beam && source.charge) return { reason: 'unsupported-projectile' };
  const { projectile, damage } = source;
  const ammunition = projectile.ammunition;
  if (ammunition && (!Number.isSafeInteger(ammunition.value) || ammunition.value <= 0 ||
    !isPositive(ammunition.reload))) return { reason: 'invalid-magazine' };
  const heat = item.stats?.heat;
  if (!heat && item.kind !== 'turret') return { reason: 'missing-heat' };
  if (heat && (!isPositive(heat.overheat) || !isNonnegative(heat.reenable) ||
    heat.reenable >= heat.overheat || !isPositive(heat.coolrate) ||
    !isNonnegative(heat.cooldelay) || !isNonnegative(heat.overheatcooldelay ?? 0) ||
    !isPositive(projectile.heat?.value) ||
    !isNonnegative(projectile.heat?.initial ?? 0))) return { reason: 'incomplete-heat' };
  return { period: isDecimal(source.period), charge: isDecimal(source.charge),
    beam: source.beam, lifetime: source.beam ? isDecimal(source.lifetime) : null,
    magazine: ammunition?.value ?? null,
    reload: ammunition ? isDecimal(ammunition.reload) : null,
    heat: heat ? { threshold: isDecimal(heat.overheat), reenable: isDecimal(heat.reenable),
      coolrate: isDecimal(heat.coolrate), delay: isDecimal(heat.cooldelay),
      overheatDelay: isDecimal(heat.overheatcooldelay ?? 0), shot: isDecimal(projectile.heat.value),
      initial: isDecimal(projectile.heat.initial ?? 0) } : null,
    damage };
}

function isCycle(profile) {
  if (profile.beam) return isBeamCycle(profile);
  const counts = { 10: 0, 30: 0, 60: 0 };
  const seen = new Map();
  let time = profile.charge;
  let heat = isZero;
  let magazinePosition = 0;
  let firstOverheat = null;
  let coolingPause = null;
  let steadyShotsPerSecond = null;
  for (let shotIndex = 0; shotIndex < isEventLimit; shotIndex++) {
    if (shotIndex) {
      let next = isAdd(time, isAdd(profile.period, profile.charge));
      if (profile.magazine && magazinePosition === 0) next = isMax(next, isAdd(time, profile.reload));
      if (profile.heat) {
        const thermal = profile.heat;
        const overheated = isCompare(heat, thermal.threshold) >= 0;
        const coolStart = isAdd(time, isAdd(thermal.delay,
          overheated ? thermal.overheatDelay : isZero));
        if (overheated) next = isMax(next, isAdd(coolStart,
          isDivide(isSubtract(heat, thermal.reenable), thermal.coolrate)));
        const cooling = isMax(isZero, isSubtract(next, coolStart));
        heat = isMax(isZero, isSubtract(heat, isMultiply(thermal.coolrate, cooling)));
      }
      time = next;
      if (firstOverheat !== null && coolingPause === null)
        coolingPause = isNumber(isSubtract(time, firstOverheat));
    }
    for (const seconds of isWindows) if (isCompare(time, isDecimal(seconds)) < 0) counts[seconds]++;
    if (profile.heat) {
      heat = isMin(profile.heat.threshold, isAdd(heat,
        isAdd(profile.heat.initial, profile.heat.shot)));
      if (firstOverheat === null && isCompare(heat, profile.heat.threshold) >= 0)
        firstOverheat = time;
    }
    if (profile.magazine) magazinePosition = (magazinePosition + 1) % profile.magazine;
    const key = `${heat.n}/${heat.d}:${magazinePosition}`;
    const previous = seen.get(key);
    if (previous && steadyShotsPerSecond === null) {
      const cycleTime = isSubtract(time, previous.time);
      if (isCompare(cycleTime, isZero) > 0)
        steadyShotsPerSecond = isNumber(isDivide(isDecimal(shotIndex - previous.index), cycleTime));
    } else if (!previous) seen.set(key, { time, index: shotIndex });
    if (steadyShotsPerSecond !== null && isCompare(time, isDecimal(60)) >= 0) break;
  }
  if (steadyShotsPerSecond === null || isCompare(time, isDecimal(60)) < 0)
    return { reason: 'cycle-unproven' };
  return { counts, steadyShotsPerSecond, firstOverheat: firstOverheat === null ? null : isNumber(firstOverheat),
    coolingPause };
}

function isBeamCycle(profile) {
  const activeWindows = { 10: isZero, 30: isZero, 60: isZero };
  const seen = new Map();
  let time = isZero;
  let end = isZero;
  let heat = isZero;
  let activeTotal = isZero;
  let magazinePosition = 0;
  let firstOverheat = null;
  let coolingPause = null;
  let steadyActivePerSecond = null;
  const activationPeriod = isMax(profile.period, profile.lifetime);
  for (let activation = 0; activation < isEventLimit; activation++) {
    if (activation) {
      let next = isAdd(time, activationPeriod);
      if (profile.magazine && magazinePosition === 0)
        next = isMax(next, isAdd(time, profile.reload));
      if (profile.heat) {
        const thermal = profile.heat;
        const overheated = isCompare(heat, thermal.threshold) >= 0;
        const coolStart = isAdd(end, isAdd(thermal.delay,
          overheated ? thermal.overheatDelay : isZero));
        if (overheated) next = isMax(next, isAdd(coolStart,
          isDivide(isSubtract(heat, thermal.reenable), thermal.coolrate)));
        heat = isMax(isZero, isSubtract(heat, isMultiply(thermal.coolrate,
          isMax(isZero, isSubtract(next, coolStart)))));
      }
      time = next;
      if (firstOverheat !== null && coolingPause === null)
        coolingPause = isNumber(isSubtract(time, firstOverheat));
    }
    let duration = profile.lifetime;
    if (profile.heat) {
      const thermal = profile.heat;
      heat = isMin(thermal.threshold, isAdd(heat, thermal.initial));
      if (isCompare(heat, thermal.threshold) >= 0) duration = isZero;
      else {
        const untilOverheat = isDivide(isSubtract(thermal.threshold, heat), thermal.shot);
        duration = isMin(duration, untilOverheat);
        heat = isMin(thermal.threshold, isAdd(heat, isMultiply(thermal.shot, duration)));
      }
      if (firstOverheat === null && isCompare(heat, thermal.threshold) >= 0)
        firstOverheat = isAdd(time, duration);
    }
    end = isAdd(time, duration);
    activeTotal = isAdd(activeTotal, duration);
    for (const seconds of isWindows) {
      const overlap = isMax(isZero, isSubtract(isMin(end, isDecimal(seconds)), time));
      activeWindows[seconds] = isAdd(activeWindows[seconds], overlap);
    }
    if (profile.magazine) magazinePosition = (magazinePosition + 1) % profile.magazine;
    const key = `${heat.n}/${heat.d}:${magazinePosition}:${duration.n}/${duration.d}`;
    const previous = seen.get(key);
    if (previous && steadyActivePerSecond === null) {
      const cycleTime = isSubtract(time, previous.time);
      if (isCompare(cycleTime, isZero) > 0)
        steadyActivePerSecond = isNumber(isDivide(
          isSubtract(activeTotal, previous.activeTotal), cycleTime));
    } else if (!previous) seen.set(key, { time, activeTotal });
    if (steadyActivePerSecond !== null && isCompare(time, isDecimal(60)) >= 0) break;
  }
  if (steadyActivePerSecond === null || isCompare(time, isDecimal(60)) < 0)
    return { reason: 'cycle-unproven' };
  return { activeWindows: Object.fromEntries(isWindows.map(seconds =>
    [seconds, isNumber(activeWindows[seconds])])), steadyActivePerSecond,
  firstOverheat: firstOverheat === null ? null : isNumber(firstOverheat), coolingPause };
}

export function estimateIsCombat(build, catalog) {
  validateShipBuild(build, catalog);
  const ship = (Array.isArray(catalog.ships) ? catalog.ships : Object.values(catalog.ships))
    .find(candidate => candidate.id === build.shipId);
  const equipment = Array.isArray(catalog.equipment) ? catalog.equipment : Object.values(catalog.equipment);
  const byId = new Map(equipment.map(item => [item.id, item]));
  const mounts = [];
  const knownMounts = [];
  for (const group of ship.slotGroups ?? []) {
    if (!['weapon', 'turret'].includes(group.type)) continue;
    for (const [slotIndex, id] of (build.loadout[group.id] ?? []).entries()) {
      if (!id) continue;
      const item = byId.get(id);
      if (['missile', 'ammo', 'missilelauncher'].includes(item.kind) || item.compatibleAmmoIds?.length) continue;
      const profile = isProfile(item);
      const cycle = profile.reason ? profile : isCycle(profile);
      const mount = { id, groupId: group.id, slotIndex,
        status: cycle.reason ? 'unknown' : 'known', reason: cycle.reason ?? null,
        firstOverheat: cycle.firstOverheat ?? null, coolingPause: cycle.coolingPause ?? null };
      mounts.push(mount);
      if (!cycle.reason) knownMounts.push({ cycle, damage: profile.damage });
    }
  }
  const unknown = mounts.length - knownMounts.length;
  const phases = Object.fromEntries(['shield', 'hull'].map(phase => {
    const damage = Object.fromEntries(isWindows.map(seconds => [seconds,
      knownMounts.length || !unknown ? knownMounts.reduce((total, mount) =>
        total + (mount.cycle.counts?.[seconds] ?? mount.cycle.activeWindows[seconds]) *
          mount.damage[phase], 0) : null]));
    const steadyDps = knownMounts.length || !unknown ? knownMounts.reduce((total, mount) =>
      total + (mount.cycle.steadyShotsPerSecond ?? mount.cycle.steadyActivePerSecond) *
        mount.damage[phase], 0) : null;
    return [phase, { steadyDps, unknown, damage }];
  }));
  return { mounts, ...phases };
}
