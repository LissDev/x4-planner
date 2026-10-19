const wpPositive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const wpNonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function wpCount(value) {
  return value === undefined ? 1 : Number.isSafeInteger(value) && value > 0 ? value : null;
}

function wpPhaseDamage(source, phase) {
  if (!source) return 0;
  const value = source[phase] ?? source.value;
  return value === undefined ? 0 : wpNonnegative(value) ? value : null;
}

export function wpWeaponProfile(item) {
  const projectile = item.stats?.projectile;
  if (!projectile) return { reason: 'missing-damage' };
  const bullet = projectile.bullet;
  if (!bullet || ![0, 1].includes(bullet.attach)) return { reason: 'unsupported-projectile' };
  const amount = wpCount(bullet.amount);
  const barrels = wpCount(bullet.barrelamount);
  if (amount === null || barrels === null || !Number.isSafeInteger(amount * barrels))
    return { reason: 'invalid-count' };
  const period = wpPositive(projectile.reload?.rate) ? 1 / projectile.reload.rate :
    wpPositive(projectile.reload?.time) ? projectile.reload.time : null;
  if (!wpPositive(period)) return { reason: 'missing-rate' };
  const beam = bullet.attach === 1;
  if (beam && !wpPositive(bullet.lifetime)) return { reason: 'missing-lifetime' };
  const charge = bullet.chargetime === undefined ? 0 : bullet.chargetime;
  if (!wpNonnegative(charge)) return { reason: 'invalid-charge' };
  if (![projectile.damage, projectile.areadamage].some(source => source &&
    ['value', 'shield', 'hull'].some(phase => wpNonnegative(source[phase]))))
    return { reason: 'missing-damage' };
  const damage = Object.fromEntries(['shield', 'hull'].map(phase => {
    const direct = wpPhaseDamage(projectile.damage, phase);
    const area = wpPhaseDamage(projectile.areadamage, phase);
    return [phase, direct === null || area === null ? null : (direct + area) * amount * barrels];
  }));
  if (Object.values(damage).some(value => value === null)) return { reason: 'missing-damage' };
  return { projectile, beam, period, charge, damage,
    lifetime: beam ? bullet.lifetime : null };
}
