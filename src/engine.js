const EPSILON = 1e-8;

function nonNegative(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number`);
  }
}

function validateStation(station, catalog) {
  if (!station || !catalog?.recipes) throw new Error('Station and catalog are required');
  nonNegative(station.sunlight, 'Sunlight');
  nonNegative(station.availableWorkforce, 'Available workforce');
  for (const [id, count] of Object.entries(station.modules ?? {})) {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error(`Module count for ${id} must be a non-negative integer`);
    if (!catalog.recipes[id]) throw new Error(`Unknown module: ${id}`);
  }
  for (const [id, price] of Object.entries(station.prices ?? {})) nonNegative(price, `Price for ${id}`);
  for (const [id, ratio] of Object.entries(station.finalWares ?? {})) {
    if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio <= 0) {
      throw new Error(`Final ware ratio for ${id} must be positive`);
    }
  }
  if (!Array.isArray(station.purchasedIntermediates ?? [])) throw new Error('Purchased intermediates must be a list');
  if (!Array.isArray(station.ownedSupplyWares ?? [])) throw new Error('Owned supplies must be a list');
  if (station.allowedRaces !== undefined && !Array.isArray(station.allowedRaces)) throw new Error('Allowed races must be a list');
  if (station.autoStorage) nonNegative(station.autoStorageHours ?? 1, 'Storage hours');
  if (station.recipeChoices !== undefined) {
    if (!station.recipeChoices || typeof station.recipeChoices !== 'object' ||
      Array.isArray(station.recipeChoices)) throw new Error('Invalid recipe choices');
    for (const [ware, id] of Object.entries(station.recipeChoices)) {
      if (!ware || typeof id !== 'string' || !id || !(catalog.recipes[id]?.outputs?.[ware] > 0)) {
        throw new Error(`Invalid recipe choice for ${ware}: ${id}`);
      }
    }
  }
}

function add(flow, ware, quantity) { flow[ware] = (flow[ware] ?? 0) + quantity; }
function price(station, ware) { return station.prices?.[ware] ?? 0; }
function finalScale(balance, ratios) {
  const wares = Object.entries(ratios ?? {});
  return wares.length ? Math.max(0, Math.min(...wares.map(([ware, ratio]) => (balance[ware] ?? 0) / ratio))) : 0;
}

export function calculateStation({ station, catalog }) {
  validateStation(station, catalog);
  const production = {};
  const consumption = {};
  let constructionCost = 0;
  const staffed = Object.entries(station.modules ?? {}).reduce((sum, [id, count]) =>
    sum + count * ((catalog.recipes[id].kind ?? 'production') === 'production' ? (catalog.recipes[id].workforce ?? 0) : 0), 0);
  const staffedFraction = staffed ? (station.autoWorkforce ? 1 : Math.min(1, station.availableWorkforce / staffed)) : 0;
  for (const [id, count] of Object.entries(station.modules ?? {})) {
    if (!count) continue;
    const recipe = catalog.recipes[id];
    const cycles = 3600 / recipe.cycleSeconds * count;
    constructionCost += count * recipe.buildCost;
    const outputMultiplier = (recipe.sunlightScaled ? station.sunlight : 1) *
      (1 + (recipe.workforceBonus ?? 0) * staffedFraction);
    for (const [ware, quantity] of Object.entries(recipe.outputs)) add(production, ware, cycles * quantity * outputMultiplier);
    for (const [ware, quantity] of Object.entries(recipe.inputs)) add(consumption, ware, cycles * quantity);
  }
  const activeWorkers = station.autoWorkforce ? staffed : Math.min(staffed, station.availableWorkforce);
  for (const [ware, perWorker] of Object.entries(catalog.workforceConsumption ?? {})) {
    add(consumption, ware, activeWorkers * perWorker);
  }
  const balance = {};
  const purchases = {};
  const externalRequirements = {};
  const owned = new Set(station.ownedSupplyWares ?? []);
  for (const ware of new Set([...Object.keys(production), ...Object.keys(consumption)])) {
    const net = (production[ware] ?? 0) - (consumption[ware] ?? 0);
    balance[ware] = Math.abs(net) < EPSILON ? 0 : net;
    if (net < -EPSILON) {
      if (owned.has(ware)) externalRequirements[ware] = -net;
      else purchases[ware] = -net;
    }
  }
  const scale = finalScale(balance, station.finalWares);
  const finalWares = station.finalWares ?? {};
  const finalOutput = Object.fromEntries(Object.entries(finalWares).map(([ware, ratio]) =>
    [ware, station.targetCounts ? Math.max(0, balance[ware] ?? 0) : scale * ratio]));
  const intermediateWares = new Set(Object.values(catalog.recipes).flatMap(recipe => Object.keys(recipe.inputs)));
  const surplusSales = station.sellIntermediateSurplus ? Object.fromEntries(Object.entries(balance).filter(([ware, amount]) =>
    amount > EPSILON && intermediateWares.has(ware) && !(ware in finalWares))) : {};
  const hourlyRevenue = Object.entries(finalOutput).reduce((sum, [ware, amount]) =>
    sum + amount * price(station, ware), 0) + Object.entries(surplusSales).reduce((sum, [ware, amount]) =>
      sum + amount * price(station, ware), 0);
  const hourlyOperatingCost = Object.entries(purchases).reduce((sum, [ware, quantity]) =>
    sum + quantity * price(station, ware), 0);
  return {
    production, consumption, balance, purchases, externalRequirements, surplusSales, constructionCost,
    hourlyRevenue, hourlyOperatingCost, hourlyProfit: hourlyRevenue - hourlyOperatingCost,
    finalOutput,
    staffedWorkers: activeWorkers,
  };
}

function relevantRecipes(catalog, station, balanceAction = false) {
  const raw = new Set(catalog.rawWares ?? []);
  const needed = new Set(Object.keys(station.finalWares ?? {}));
  if (station.autoWorkforce) for (const ware of Object.keys(catalog.workforceConsumption ?? {})) needed.add(ware);
  const allowedRaces = station.allowedRaces === undefined ? null : new Set(station.allowedRaces);
  const external = balanceAction ? new Set([...(station.purchasedIntermediates ?? []),
    ...(station.ownedSupplyWares ?? [])]) : new Set();
  const choices = balanceAction ? station.recipeChoices ?? {} : {};
  const candidates = Object.entries(catalog.recipes).filter(([id, recipe]) =>
    (!allowedRaces || allowedRaces.has(recipe.race)) &&
    !Object.keys(recipe.outputs).some(ware => choices[ware] && choices[ware] !== id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const ware of needed) if (!external.has(ware) && !raw.has(ware) && choices[ware] &&
      !candidates.some(([id]) => id === choices[ware])) {
      throw new Error(`Recipe choice for ${ware} conflicts with allowed races: ${choices[ware]}`);
    }
    for (const [, recipe] of candidates) {
      if (!Object.keys(recipe.outputs).some(ware => needed.has(ware))) continue;
      for (const ware of Object.keys(recipe.inputs)) {
        if (!raw.has(ware) && !external.has(ware) && !needed.has(ware)) {
          needed.add(ware);
          changed = true;
        }
      }
    }
  }
  const flowWares = new Set([...needed]);
  for (const [, recipe] of candidates) if (Object.keys(recipe.outputs).some(ware => needed.has(ware))) {
    for (const ware of Object.keys(recipe.inputs)) flowWares.add(ware);
  }
  const storageTypes = new Set([...flowWares].map(ware => catalog.wares?.[ware]?.storage).filter(Boolean));
  return candidates.filter(([, recipe]) => Object.keys(recipe.outputs).some(ware => needed.has(ware)) ||
    (station.autoWorkforce && recipe.kind === 'habitat' && recipe.race === (station.workforceRace ?? station.race ?? catalog.race)) ||
    (station.autoStorage && recipe.kind === 'storage' && storageTypes.has(recipe.storageType)));
}

function optimizerRecipes(catalog, station, balanceAction = false) {
  const available = relevantRecipes(catalog, station, balanceAction).filter(([, recipe]) => recipe.buildCost > 0);
  return available.filter(([, recipe], index) => recipe.kind !== 'storage' ||
    !available.some(([, other], otherIndex) => otherIndex !== index && other.kind === 'storage' &&
      other.storageType === recipe.storageType && other.storageCapacity >= recipe.storageCapacity &&
      other.buildCost <= recipe.buildCost && (other.storageCapacity > recipe.storageCapacity ||
        other.buildCost < recipe.buildCost || otherIndex < index)));
}

function isFeasible(station, catalog, calculation, enforceWorkerSupplies = false, requireFinalOutput = true) {
  const allowed = new Set([...(catalog.rawWares ?? []), ...(station.purchasedIntermediates ?? []),
    ...(station.ownedSupplyWares ?? [])]);
  if (station.autoWorkforce) {
    const produced = new Set(Object.values(catalog.recipes).flatMap(recipe => Object.keys(recipe.outputs)));
    for (const ware of Object.keys(catalog.workforceConsumption ?? {})) if (!produced.has(ware)) allowed.add(ware);
    const workers = calculation.staffedWorkers;
    const race = station.workforceRace ?? station.race ?? catalog.race;
    const capacity = Object.entries(calculation.modules ?? station.modules ?? {}).reduce((sum, [id, count]) => {
      const recipe = catalog.recipes[id];
      return sum + (recipe?.race === race ? (recipe.housingCapacity ?? 0) * count : 0);
    }, 0);
    if (capacity + EPSILON < workers) return false;
  } else if (!enforceWorkerSupplies) for (const ware of Object.keys(catalog.workforceConsumption ?? {})) allowed.add(ware);
  for (const [ware, quantity] of Object.entries(calculation.balance)) {
    if (quantity < -EPSILON && !allowed.has(ware)) return false;
  }
  if (station.autoStorage) {
    const required = storageRequirements(calculation, catalog, station.autoStorageHours ?? 1);
    for (const [type, amount] of Object.entries(required)) {
      const capacity = Object.entries(station.modules ?? {}).reduce((sum, [id, count]) => {
        const recipe = catalog.recipes[id];
        return sum + (recipe?.storageType === type ? (recipe.storageCapacity ?? 0) * count : 0);
      }, 0);
      if (capacity + EPSILON < amount) return false;
    }
  }
  return !requireFinalOutput || Object.keys(station.finalWares ?? {}).every(ware =>
    (calculation.finalOutput[ware] ?? 0) > EPSILON);
}

function storageRequirements(calculation, catalog, hours) {
  const required = {};
  for (const ware of new Set([...Object.keys(calculation.production), ...Object.keys(calculation.consumption)])) {
    const { storage, volume } = catalog.wares?.[ware] ?? {};
    if (!storage || !volume) continue;
    add(required, storage, Math.max(calculation.production[ware] ?? 0,
      calculation.consumption[ware] ?? 0) * volume * hours);
  }
  return required;
}

class MinHeap {
  items = [];
  push(item) {
    const items = this.items;
    items.push(item);
    for (let i = items.length - 1; i > 0;) {
      const parent = (i - 1) >> 1;
      if (items[parent].cost <= item.cost) break;
      items[i] = items[parent];
      i = parent;
      items[i] = item;
    }
  }
  pop() {
    const items = this.items;
    const first = items[0];
    const last = items.pop();
    if (items.length) {
      let i = 0;
      while (2 * i + 1 < items.length) {
        let child = 2 * i + 1;
        if (child + 1 < items.length && items[child + 1].cost < items[child].cost) child++;
        if (last.cost <= items[child].cost) break;
        items[i] = items[child];
        i = child;
      }
      items[i] = last;
    }
    return first;
  }
  get size() { return this.items.length; }
}

function solveMilp(station, catalog, objective, recipes, milpSolver) {
  const finalWares = Object.entries(station.finalWares);
  const purchasable = new Set([...(catalog.rawWares ?? []), ...(station.purchasedIntermediates ?? []),
    ...(station.ownedSupplyWares ?? [])]);
  const allProduced = new Set(Object.values(catalog.recipes).flatMap(recipe => Object.keys(recipe.outputs)));
  if (station.autoWorkforce) for (const ware of Object.keys(catalog.workforceConsumption ?? {})) {
    if (!allProduced.has(ware)) purchasable.add(ware);
  } else for (const ware of Object.keys(catalog.workforceConsumption ?? {})) purchasable.add(ware);
  const wares = new Set(finalWares.map(([ware]) => ware));
  for (const [, recipe] of recipes) {
    for (const ware of Object.keys(recipe.inputs)) wares.add(ware);
    for (const ware of Object.keys(recipe.outputs)) wares.add(ware);
  }
  if (station.autoWorkforce || station.availableWorkforce > 0) {
    for (const ware of Object.keys(catalog.workforceConsumption ?? {})) wares.add(ware);
  }
  const model = { optimize: 'goal', opType: objective.mode === 'max-output' ? 'max' : 'min',
    constraints: {}, variables: {}, ints: {} };
  for (const ware of wares) {
    model.constraints[`balance:${ware}`] = { min: 0 };
  }
  if (objective.mode === 'max-output') model.constraints.budget = { max: objective.budget };
  else model.constraints.profit = { min: objective.targetProfit };
  if (station.autoWorkforce) model.constraints.housing = { min: 0 };
  const hours = station.autoStorageHours ?? 1;
  const storageWares = station.autoStorage ? [...wares].filter(ware =>
    catalog.wares?.[ware]?.storage && catalog.wares[ware].volume > 0) : [];
  for (const ware of storageWares) {
    model.constraints[`storage-input:${ware}`] = { min: 0 };
    model.constraints[`storage-output:${ware}`] = { min: 0 };
    model.constraints[`storage:${catalog.wares[ware].storage}`] = { min: 0 };
    model.variables[`flow:${ware}`] = {
      [`storage-input:${ware}`]: 1, [`storage-output:${ware}`]: 1,
      [`storage:${catalog.wares[ware].storage}`]: -catalog.wares[ware].volume * hours,
    };
  }
  for (let i = 0; i < recipes.length; i++) {
    const recipe = recipes[i][1];
    const variable = { goal: objective.mode === 'min-cost' ? recipe.buildCost : 0 };
    if (objective.mode === 'max-output') variable.budget = recipe.buildCost;
    const cycles = 3600 / recipe.cycleSeconds;
    const production = (recipe.kind ?? 'production') === 'production';
    const workers = station.autoWorkforce && production ? (recipe.workforce ?? 0) : 0;
    if (station.autoWorkforce) variable.housing = (recipe.race === (station.workforceRace ?? station.race ?? catalog.race) ?
      (recipe.housingCapacity ?? 0) : 0) - workers;
    for (const [ware, quantity] of Object.entries(recipe.outputs)) {
      const output = cycles * quantity * (recipe.sunlightScaled ? station.sunlight : 1) *
        (station.autoWorkforce ? 1 + (recipe.workforceBonus ?? 0) : 1);
      variable[`balance:${ware}`] = (variable[`balance:${ware}`] ?? 0) + output;
      if (storageWares.includes(ware)) variable[`storage-output:${ware}`] =
        (variable[`storage-output:${ware}`] ?? 0) - output;
    }
    for (const [ware, quantity] of Object.entries(recipe.inputs)) {
      const input = cycles * quantity;
      variable[`balance:${ware}`] = (variable[`balance:${ware}`] ?? 0) - input;
      if (storageWares.includes(ware)) variable[`storage-input:${ware}`] =
        (variable[`storage-input:${ware}`] ?? 0) - input;
    }
    if (workers) for (const [ware, perWorker] of Object.entries(catalog.workforceConsumption ?? {})) {
      const demand = workers * perWorker;
      variable[`balance:${ware}`] = (variable[`balance:${ware}`] ?? 0) - demand;
      if (storageWares.includes(ware)) variable[`storage-input:${ware}`] =
        (variable[`storage-input:${ware}`] ?? 0) - demand;
    }
    if (station.autoStorage && recipe.kind === 'storage' && recipe.storageType) {
      variable[`storage:${recipe.storageType}`] = (recipe.storageCapacity ?? 0);
    }
    model.variables[`module:${i}`] = variable;
    model.ints[`module:${i}`] = 1;
  }
  if (objective.mode === 'min-cost') {
    const requiredProduction = Object.keys(station.finalWares);
    const requiredSet = new Set(requiredProduction);
    for (let i = 0; i < requiredProduction.length; i++) {
      const ware = requiredProduction[i];
      const producers = recipes.flatMap(([, recipe], index) => recipe.outputs[ware] > 0 ? [index] : []);
      if (!producers.length) continue;
      model.constraints[`required:${ware}`] = { min: 1 };
      for (const index of producers) model.variables[`module:${index}`][`required:${ware}`] = 1;
      const commonInputs = Object.keys(recipes[producers[0]][1].inputs).filter(input =>
        recipes[producers[0]][1].inputs[input] > 0 &&
        producers.every(index => recipes[index][1].inputs[input] > 0));
      for (const input of commonInputs) if (!purchasable.has(input) && !requiredSet.has(input)) {
        requiredSet.add(input);
        requiredProduction.push(input);
      }
    }
  }
  const sale = { goal: objective.mode === 'max-output' ? 1 : 0 };
  if (objective.mode === 'min-cost') model.constraints.minimumSale = { min: 1e-4 };
  if (objective.mode === 'min-cost') sale.minimumSale = 1;
  for (const [ware, ratio] of finalWares) sale[`balance:${ware}`] = -ratio;
  if (objective.mode === 'min-cost') {
    sale.profit = finalWares.reduce((sum, [ware, ratio]) => sum + ratio * price(station, ware), 0);
  }
  model.variables.sale = sale;
  if (station.sellIntermediateSurplus) {
    const intermediates = new Set(Object.values(catalog.recipes).flatMap(recipe => Object.keys(recipe.inputs)));
    for (const ware of wares) {
      if (!intermediates.has(ware) || !allProduced.has(ware) || ware in station.finalWares) continue;
      model.constraints[`surplus:${ware}`] = { min: 0 };
      for (const variable of Object.values(model.variables)) {
        if ('goal' in variable && variable !== sale) variable[`surplus:${ware}`] = variable[`balance:${ware}`] ?? 0;
      }
      model.variables[`surplus-sale:${ware}`] = {
        [`balance:${ware}`]: -1, [`surplus:${ware}`]: -1,
        ...(objective.mode === 'min-cost' ? { profit: price(station, ware) } : {}),
      };
    }
  }
  for (const ware of wares) {
    if (!purchasable.has(ware) || station.finalWares[ware]) continue;
    model.variables[`purchase:${ware}`] = { [`balance:${ware}`]: 1,
      ...(objective.mode === 'min-cost' ? { profit: station.ownedSupplyWares?.includes(ware) ? 0 : -price(station, ware) } : {}) };
  }
  let solved = milpSolver.Solve(model);
  if (!solved.feasible) return { feasible: false, reason: 'При заданных условиях решение невозможно' };
  if (!solved.bounded) return { feasible: false, reason: 'У задачи нет ограниченного оптимума' };
  if (objective.mode === 'max-output' && (solved.sale ?? 0) > EPSILON) {
    model.constraints.minimumSale = { min: solved.sale - 1e-6 };
    model.variables.sale.minimumSale = 1;
    model.variables.sale.goal = 0;
    model.opType = 'min';
    for (let i = 0; i < recipes.length; i++) model.variables[`module:${i}`].goal = recipes[i][1].buildCost;
    const cheapest = milpSolver.Solve(model);
    if (cheapest.feasible && cheapest.bounded) solved = cheapest;
  }
  const modules = {};
  for (let i = 0; i < recipes.length; i++) {
    const count = solved[`module:${i}`] ?? 0;
    if (Math.abs(count - Math.round(count)) > 1e-5 || count < -EPSILON) {
      return { feasible: false, reason: 'Решатель не подтвердил целочисленное решение' };
    }
    if (Math.round(count)) modules[recipes[i][0]] = Math.round(count);
  }
  const plannedStation = { ...station, modules };
  const calculation = calculateStation({ station: plannedStation, catalog });
  if (!isFeasible(plannedStation, catalog, calculation) ||
    (objective.mode === 'min-cost' && calculation.hourlyProfit + 1e-5 < objective.targetProfit)) {
    return { feasible: false, reason: 'Решатель не подтвердил допустимый план' };
  }
  return { feasible: true, modules, constructionCost: calculation.constructionCost,
    hourlyProfit: calculation.hourlyProfit, finalOutput: calculation.finalOutput, optimal: true };
}

function solveBalanceMilp(station, catalog, objective, recipes, milpSolver,
  manualRegime = null, manualBonusAt = null, staffingMax = null, bonusAllowance = null) {
  if (!milpSolver) throw new Error('Balance actions require the integer solver');
  const reserve = objective.mode === 'use-reserve';
  const finalWares = Object.keys(station.finalWares);
  const finalSet = new Set(finalWares);
  const fixed = {};
  if (reserve) Object.assign(fixed, station.modules ?? {});
  else for (const [id, count] of Object.entries(station.modules ?? {})) {
    if ((catalog.recipes[id].kind ?? 'production') !== 'production') fixed[id] = count;
  }
  const selectedProducer = recipe => (recipe.kind ?? 'production') === 'production' &&
    Object.keys(recipe.outputs).some(ware => finalSet.has(ware));
  const dynamic = recipes.filter(([, recipe]) => !reserve || selectedProducer(recipe) ||
    (station.autoWorkforce && recipe.kind === 'habitat') ||
    (station.autoStorage && recipe.kind === 'storage'));
  const dynamicIds = new Set(dynamic.map(([id]) => id));
  const allRecipes = new Map([...Object.entries(fixed).map(([id]) => [id, catalog.recipes[id]]), ...dynamic]);
  const wares = new Set(finalWares);
  for (const recipe of allRecipes.values()) {
    for (const ware of Object.keys(recipe.inputs)) wares.add(ware);
    for (const ware of Object.keys(recipe.outputs)) wares.add(ware);
  }
  if (station.autoWorkforce) for (const ware of Object.keys(catalog.workforceConsumption ?? {})) wares.add(ware);
  const produced = new Set(Object.values(catalog.recipes).flatMap(recipe => Object.keys(recipe.outputs)));
  const external = new Set([...(catalog.rawWares ?? []), ...(station.purchasedIntermediates ?? []),
    ...(station.ownedSupplyWares ?? [])]);
  if (station.autoWorkforce) for (const ware of Object.keys(catalog.workforceConsumption ?? {})) {
    if (!produced.has(ware)) external.add(ware);
  }
  const model = { optimize: 'goal', opType: reserve ? 'max' : 'min', constraints: {}, variables: {}, ints: {} };
  for (const ware of wares) model.constraints[`balance:${ware}`] =
    { min: -(bonusAllowance?.[ware] ?? 0) };
  if (station.autoWorkforce) model.constraints.housing = { min: 0 };
  if (manualRegime) model.constraints.staffing = manualRegime === 'below-cap' ?
    { max: station.availableWorkforce } : { min: Math.max(station.availableWorkforce, manualBonusAt ?? 0),
      ...(staffingMax === null ? {} : { max: staffingMax }) };
  const storageWares = station.autoStorage ? [...wares].filter(ware =>
    catalog.wares?.[ware]?.storage && catalog.wares[ware].volume > 0) : [];
  for (const ware of storageWares) {
    model.constraints[`storage-input:${ware}`] = { min: 0 };
    model.constraints[`storage-output:${ware}`] = { min: 0 };
    model.constraints[`storage:${catalog.wares[ware].storage}`] = { min: 0 };
    model.variables[`flow:${ware}`] = {
      [`storage-input:${ware}`]: 1, [`storage-output:${ware}`]: 1,
      [`storage:${catalog.wares[ware].storage}`]: -catalog.wares[ware].volume * (station.autoStorageHours ?? 1),
    };
  }
  if (manualRegime === 'at-cap') {
    model.constraints.manualConsumption = { equal: 1 };
    const consumption = { manualConsumption: 1 };
    for (const [ware, perWorker] of Object.entries(catalog.workforceConsumption ?? {})) {
      const amount = station.availableWorkforce * perWorker;
      consumption[`balance:${ware}`] = -amount;
      if (storageWares.includes(ware)) consumption[`storage-input:${ware}`] = -amount;
    }
    model.variables.manualConsumption = consumption;
  }
  if (!reserve) for (const ware of finalWares) model.constraints[`target:${ware}`] =
    { equal: objective.targetCounts[ware] };
  const variableIds = [];
  for (const [id, recipe] of allRecipes) {
    const isDynamic = dynamicIds.has(id);
    const isFinal = selectedProducer(recipe);
    const variable = { goal: reserve ? (isDynamic && isFinal ? 1 : 0) : recipe.buildCost };
    const cycles = 3600 / recipe.cycleSeconds;
    const production = (recipe.kind ?? 'production') === 'production';
    const workers = (station.autoWorkforce || manualRegime === 'below-cap') && production ?
      (recipe.workforce ?? 0) : 0;
    if (manualRegime && production) variable.staffing = recipe.workforce ?? 0;
    if (station.autoWorkforce) variable.housing =
      (recipe.race === (station.workforceRace ?? station.race ?? catalog.race) ?
        (recipe.housingCapacity ?? 0) : 0) - workers;
    for (const [ware, quantity] of Object.entries(recipe.outputs)) {
      const bonusFraction = station.autoWorkforce || manualRegime === 'below-cap' ? 1 :
        manualBonusAt === null ? 0 : station.availableWorkforce / manualBonusAt;
      const amount = cycles * quantity * (recipe.sunlightScaled ? station.sunlight : 1) *
        (1 + (recipe.workforceBonus ?? 0) * bonusFraction);
      variable[`balance:${ware}`] = (variable[`balance:${ware}`] ?? 0) + amount;
      if (storageWares.includes(ware)) {
        const storageBonus = manualRegime === 'at-cap' && (recipe.workforceBonus ?? 0) > 0 ?
          staffingMax === null ? 0 : station.availableWorkforce / staffingMax : bonusFraction;
        variable[`storage-output:${ware}`] = (variable[`storage-output:${ware}`] ?? 0) -
          cycles * quantity * (recipe.sunlightScaled ? station.sunlight : 1) *
          (1 + (recipe.workforceBonus ?? 0) * storageBonus);
      }
      if (!reserve && isFinal && finalSet.has(ware)) variable[`target:${ware}`] = 1;
    }
    for (const [ware, quantity] of Object.entries(recipe.inputs)) {
      const amount = cycles * quantity;
      variable[`balance:${ware}`] = (variable[`balance:${ware}`] ?? 0) - amount;
      if (storageWares.includes(ware)) variable[`storage-input:${ware}`] =
        (variable[`storage-input:${ware}`] ?? 0) - amount;
    }
    for (const [ware, perWorker] of Object.entries(catalog.workforceConsumption ?? {})) if (workers) {
      const amount = workers * perWorker;
      variable[`balance:${ware}`] = (variable[`balance:${ware}`] ?? 0) - amount;
      if (storageWares.includes(ware)) variable[`storage-input:${ware}`] =
        (variable[`storage-input:${ware}`] ?? 0) - amount;
    }
    if (station.autoStorage && recipe.kind === 'storage' && recipe.storageType) {
      variable[`storage:${recipe.storageType}`] = recipe.storageCapacity ?? 0;
    }
    const key = `module:${variableIds.length}`;
    variableIds.push(id);
    model.variables[key] = variable;
    model.ints[key] = 1;
    if (!isDynamic || (reserve && !isFinal && recipe.kind !== 'habitat' && recipe.kind !== 'storage')) {
      model.constraints[`fixed:${key}`] = { equal: fixed[id] ?? 0 };
      variable[`fixed:${key}`] = 1;
    } else if ((fixed[id] ?? 0) > 0) {
      model.constraints[`minimum:${key}`] = { min: fixed[id] };
      variable[`minimum:${key}`] = 1;
    }
  }
  for (const ware of wares) if (external.has(ware) && !finalSet.has(ware)) {
    model.variables[`purchase:${ware}`] = { [`balance:${ware}`]: 1 };
  }
  if (!reserve) {
    const required = [...finalWares];
    const seen = new Set(required);
    for (let i = 0; i < required.length; i++) {
      const ware = required[i];
      const producers = variableIds.flatMap((id, index) => allRecipes.get(id).outputs[ware] > 0 ? [index] : []);
      if (!producers.length) continue;
      model.constraints[`required:${ware}`] = { min: 1 };
      for (const index of producers) model.variables[`module:${index}`][`required:${ware}`] = 1;
      const commonInputs = Object.keys(allRecipes.get(variableIds[producers[0]]).inputs).filter(input =>
        producers.every(index => allRecipes.get(variableIds[index]).inputs[input] > 0));
      for (const input of commonInputs) if (!external.has(input) && !seen.has(input)) {
        seen.add(input);
        required.push(input);
      }
    }
  }
  let solved = milpSolver.Solve(model);
  if (!solved.feasible) return { feasible: false, reason: 'При заданных условиях решение невозможно' };
  if (!solved.bounded) return { feasible: false, unbounded: true, reason: 'У задачи нет ограниченного оптимума' };
  let maximum = null;
  let distributionBound = null;
  if (reserve) {
    maximum = variableIds.reduce((sum, id, index) =>
      sum + (selectedProducer(allRecipes.get(id)) && dynamicIds.has(id) ? (solved[`module:${index}`] ?? 0) : 0), 0);
    if (bonusAllowance) return { feasible: false, bound: maximum };
    if (finalWares.length > 1) {
      const startingCounts = finalWares.map(ware => Object.entries(station.modules ?? {}).reduce(
        (sum, [id, count]) => sum + (catalog.recipes[id].outputs[ware] > 0 ? count : 0), 0));
      const denominators = startingCounts.map(count => Math.max(1, count));
      distributionBound = [];
      const countKeys = finalWares.map((ware, wareIndex) => {
        const key = `reserveCount:${wareIndex}`;
        model.constraints[key] = { min: startingCounts[wareIndex] };
        for (let i = 0; i < variableIds.length; i++) if (allRecipes.get(variableIds[i]).outputs[ware] > 0) {
          model.variables[`module:${i}`][key] = 1;
        }
        return key;
      });
      const upperCounts = startingCounts.map(count => count + Math.round(maximum));
      const events = [];
      for (let i = 0; i < finalWares.length; i++) {
        for (let count = startingCounts[i]; count <= upperCounts[i]; count++) {
          events.push({ count, denominator: denominators[i] });
        }
      }
      const compareRatio = (a, b) => {
        const difference = BigInt(a.count) * BigInt(b.denominator) -
          BigInt(b.count) * BigInt(a.denominator);
        return difference < 0n ? -1 : difference > 0n ? 1 : 0;
      };
      events.sort(compareRatio);
      const ratios = events.filter((event, index) => index === 0 || compareRatio(event, events[index - 1]) !== 0);
      const requiredCounts = ratio => denominators.map(denominator =>
        Number((BigInt(ratio.count) * BigInt(denominator) + BigInt(ratio.denominator) - 1n) /
          BigInt(ratio.denominator)));
      const solveCounts = (counts, objectiveWare = null) => {
        for (let i = 0; i < countKeys.length; i++) model.constraints[countKeys[i]].min = counts[i];
        model.opType = objectiveWare === null ? 'min' : 'max';
        for (let i = 0; i < variableIds.length; i++) model.variables[`module:${i}`].goal =
          objectiveWare === null ? allRecipes.get(variableIds[i]).buildCost + i * 1e-9 :
            allRecipes.get(variableIds[i]).outputs[objectiveWare] > 0 ? 1 : 0;
        return milpSolver.Solve(model);
      };
      let low = 0;
      let high = ratios.length - 1;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        const counts = requiredCounts(ratios[middle]).map((count, i) => Math.max(count, startingCounts[i]));
        const candidate = solveCounts(counts);
        if (candidate.feasible && candidate.bounded) low = middle;
        else high = middle - 1;
      }
      let states = [{ counts: requiredCounts(ratios[low]).map((count, i) => Math.max(count, startingCounts[i])),
        eligible: finalWares.map((_, i) => i) }];
      let finalStates = null;
      const subsets = (items, size, offset = 0, chosen = []) => {
        if (chosen.length === size) return [chosen];
        const combinations = [];
        for (let i = offset; i <= items.length - (size - chosen.length); i++) {
          combinations.push(...subsets(items, size, i + 1, [...chosen, items[i]]));
        }
        return combinations;
      };
      for (let ratioIndex = low + 1; ratioIndex < ratios.length; ratioIndex++) {
        const requirement = requiredCounts(ratios[ratioIndex]);
        let nextStates = [];
        for (let size = finalWares.length; size >= 1 && !nextStates.length; size--) {
          const seen = new Set();
          for (const state of states) {
            const available = state.eligible.filter(index => upperCounts[index] >= requirement[index]);
            if (available.length < size) continue;
            for (const chosen of subsets(available, size)) {
              const counts = state.counts.map((count, i) => chosen.includes(i) ? Math.max(count, requirement[i]) : count);
              const signature = `${counts.join(',')}|${chosen.join(',')}`;
              if (seen.has(signature)) continue;
              seen.add(signature);
              const candidate = solveCounts(counts);
              if (candidate.feasible && candidate.bounded) nextStates.push({ counts, eligible: chosen });
            }
          }
        }
        if (!nextStates.length) {
          finalStates = states;
          break;
        }
        states = nextStates;
        if (nextStates[0].eligible.length === 1) {
          let best = null;
          finalStates = [];
          for (const state of states) {
            const index = state.eligible[0];
            const candidate = solveCounts(state.counts, finalWares[index]);
            if (!candidate.feasible || !candidate.bounded) continue;
            const count = Math.round(candidate.result);
            const ratio = { count, denominator: denominators[index] };
            const comparison = best === null ? 1 : compareRatio(ratio, best);
            if (comparison > 0) { best = ratio; finalStates = []; }
            if (comparison >= 0) finalStates.push({ ...state, counts: state.counts.map((value, i) =>
              i === index ? Math.max(value, count) : value) });
          }
          break;
        }
      }
      finalStates ??= states;
      let cheapest = null;
      for (const state of finalStates) {
        const candidate = solveCounts(state.counts);
        if (candidate.feasible && candidate.bounded && (!cheapest || candidate.result < cheapest.result)) cheapest = candidate;
      }
      if (cheapest) solved = cheapest;
      distributionBound = finalWares.map((ware, index) => variableIds.reduce((sum, id, moduleIndex) =>
        sum + (allRecipes.get(id).outputs[ware] > 0 ? (solved[`module:${moduleIndex}`] ?? 0) : 0), 0) /
        denominators[index]).sort((a, b) => a - b);
    } else {
      const existingFinals = Object.entries(station.modules ?? {}).reduce((sum, [id, count]) =>
        sum + (catalog.recipes[id].outputs[finalWares[0]] > 0 ? count : 0), 0);
      const fixedFinals = Object.entries(station.modules ?? {}).reduce((sum, [id, count]) =>
        sum + (!dynamicIds.has(id) && catalog.recipes[id].outputs[finalWares[0]] > 0 ? count : 0), 0);
      distributionBound = [(maximum + fixedFinals) / Math.max(1, existingFinals)];
      model.constraints.maximumFinals = { min: maximum - 1e-6 };
      for (let i = 0; i < variableIds.length; i++) if (selectedProducer(allRecipes.get(variableIds[i])) && dynamicIds.has(variableIds[i])) {
        model.variables[`module:${i}`].maximumFinals = 1;
      }
    }
    if (finalWares.length === 1) {
      model.opType = 'min';
      for (let i = 0; i < variableIds.length; i++) {
        model.variables[`module:${i}`].goal = allRecipes.get(variableIds[i]).buildCost + i * 1e-9;
      }
      const cheapest = milpSolver.Solve(model);
      if (cheapest.feasible && cheapest.bounded) solved = cheapest;
    }
  }
  const modules = {};
  for (let i = 0; i < variableIds.length; i++) {
    const count = solved[`module:${i}`] ?? 0;
    if (Math.abs(count - Math.round(count)) > 1e-5 || count < -EPSILON) {
      return { feasible: false, reason: 'Решатель не подтвердил целочисленное решение' };
    }
    if (Math.round(count)) modules[variableIds[i]] = Math.round(count);
  }
  const calculation = calculateStation({ station: { ...station, modules }, catalog });
  const hasFinalModules = finalWares.every(ware => Object.entries(modules).some(([id, count]) =>
    count > 0 && catalog.recipes[id].outputs[ware] > 0));
  if (!hasFinalModules || !isFeasible({ ...station, modules }, catalog, calculation, true, false)) {
    return { feasible: false, reason: 'Решатель не подтвердил допустимый план',
      bound: reserve ? maximum : null, distributionBound,
      costBound: reserve ? null : solved.result, modules };
  }
  return { feasible: true, modules, constructionCost: calculation.constructionCost,
    hourlyProfit: calculation.hourlyProfit, finalOutput: calculation.finalOutput, optimal: true,
    bound: reserve ? maximum : null, distributionBound };
}

export function optimizeStation({ station, catalog, objective, milpSolver }) {
  validateStation(station, catalog);
  if (objective?.mode === 'build-chain' || objective?.mode === 'use-reserve') {
    if (objective.mode === 'build-chain' &&
      (objective.targetCounts !== undefined &&
        (!objective.targetCounts || typeof objective.targetCounts !== 'object' ||
          Array.isArray(objective.targetCounts) ||
          Object.entries(objective.targetCounts).some(([ware, count]) =>
            !(ware in station.finalWares) || !Number.isSafeInteger(count) || count <= 0)))) {
      throw new Error('Invalid final module targets');
    }
    if (!Object.keys(station.finalWares ?? {}).length) return { feasible: false, reason: 'Выберите конечный товар' };
    const normalizedObjective = objective.mode === 'build-chain' ? { ...objective,
      targetCounts: Object.fromEntries(Object.keys(station.finalWares).map(ware =>
        [ware, objective.targetCounts?.[ware] ?? 1])) } : objective;
    const recipes = optimizerRecipes(catalog, station, true);
    if (!station.autoWorkforce && station.availableWorkforce > 0) {
      const selected = new Set(Object.keys(station.finalWares));
      const startingCounts = [...selected].map(ware => Object.entries(station.modules ?? {}).reduce(
        (sum, [id, count]) => sum + (catalog.recipes[id].outputs[ware] > 0 ? count : 0), 0));
      const distribution = plan => [...selected].map((ware, index) => Object.entries(plan.modules).reduce(
        (sum, [id, count]) => sum + (catalog.recipes[id].outputs[ware] > 0 ? count : 0), 0) /
        Math.max(1, startingCounts[index])).sort((a, b) => a - b);
      const compareDistribution = (a, b) => {
        for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > EPSILON) return b[i] - a[i];
        return 0;
      };
      const comparePlans = (a, b) => {
        if (objective.mode === 'use-reserve') {
          const difference = compareDistribution(distribution(a), distribution(b));
          if (difference) return difference;
        }
        return a.constructionCost - b.constructionCost ||
          JSON.stringify(a.modules).localeCompare(JSON.stringify(b.modules));
      };
      const below = solveBalanceMilp(station, catalog, normalizedObjective, recipes, milpSolver, 'below-cap');
      if (below.unbounded) return below;
      let best = below.feasible ? below : null;
      const hasManualBonus = recipes.some(([, recipe]) =>
        (recipe.workforceBonus ?? 0) > 0);
      if (hasManualBonus) {
        if (objective.mode === 'build-chain') {
          const conservative = solveBalanceMilp(station, catalog, normalizedObjective, recipes,
            milpSolver, 'at-cap');
          if (conservative.feasible && (!best || comparePlans(conservative, best) < 0)) best = conservative;
          if (!best) return conservative;
          const maximumWorkers = Math.floor(best.constructionCost * Math.max(0,
            ...recipes.map(([, recipe]) => (recipe.workforce ?? 0) / recipe.buildCost)));
          const intervals = [[Math.ceil(station.availableWorkforce), maximumWorkers]];
          while (intervals.length) {
            const [minimum, maximum] = intervals.pop();
            if (minimum > maximum) continue;
            const plan = solveBalanceMilp(station, catalog, normalizedObjective, recipes,
              milpSolver, 'at-cap', minimum, maximum);
            if (plan.unbounded || (plan.costBound !== undefined &&
              plan.costBound > best.constructionCost + EPSILON)) continue;
            if (plan.feasible) {
              if (comparePlans(plan, best) < 0) best = plan;
            } else if (minimum < maximum) {
              const middle = Math.floor((minimum + maximum) / 2);
              intervals.push([middle + 1, maximum], [minimum, middle]);
            }
          }
          return best;
        }
        const dynamicFinals = recipes.filter(([, recipe]) =>
          (recipe.kind ?? 'production') === 'production' &&
          Object.keys(recipe.outputs).some(ware => selected.has(ware)));
        const dynamicIds = new Set(dynamicFinals.map(([id]) => id));
        const fixedWorkers = Object.entries(station.modules ?? {}).reduce((sum, [id, count]) =>
          sum + (dynamicIds.has(id) ? 0 : count * (catalog.recipes[id].workforce ?? 0)), 0);
        const optimistic = solveBalanceMilp(station, catalog, normalizedObjective, recipes,
          milpSolver, 'at-cap', station.availableWorkforce);
        if (optimistic.feasible) return best ? [best, optimistic].sort(comparePlans)[0] : optimistic;
        let finalBound = optimistic.bound;
        if (optimistic.unbounded) {
          const allowance = {};
          for (const [id, count] of Object.entries(station.modules ?? {})) {
            if (dynamicIds.has(id)) continue;
            const recipe = catalog.recipes[id];
            for (const [ware, quantity] of Object.entries(recipe.outputs)) {
              const bonus = recipe.workforceBonus ?? 0;
              const rate = 3600 / recipe.cycleSeconds * quantity *
                (recipe.sunlightScaled ? station.sunlight : 1) * bonus;
              allowance[ware] = (allowance[ware] ?? 0) + count * Math.max(0, rate);
            }
          }
          const dynamicAllowance = {};
          for (const [, recipe] of dynamicFinals) {
            const workers = recipe.workforce ?? 0;
            if (!workers) continue;
            for (const [ware, quantity] of Object.entries(recipe.outputs)) {
              const rate = 3600 / recipe.cycleSeconds * quantity *
                (recipe.sunlightScaled ? station.sunlight : 1) * (recipe.workforceBonus ?? 0);
              dynamicAllowance[ware] = Math.max(dynamicAllowance[ware] ?? 0,
                station.availableWorkforce * Math.max(0, rate) / workers);
            }
          }
          for (const [ware, amount] of Object.entries(dynamicAllowance)) {
            allowance[ware] = (allowance[ware] ?? 0) + amount;
          }
          const bounded = solveBalanceMilp(station, catalog, normalizedObjective, recipes,
            milpSolver, 'at-cap', null, null, allowance);
          if (bounded.unbounded) return optimistic;
          finalBound = bounded.bound;
        }
        if (finalBound !== null && finalBound !== undefined) {
          const maximumWorkers = Math.floor(fixedWorkers + finalBound *
            Math.max(0, ...dynamicFinals.map(([, recipe]) => recipe.workforce ?? 0)));
          const intervals = [[Math.ceil(station.availableWorkforce), maximumWorkers]];
          while (intervals.length) {
            const [minimum, maximum] = intervals.pop();
            if (minimum > maximum) continue;
            const plan = solveBalanceMilp(station, catalog, normalizedObjective, recipes,
              milpSolver, 'at-cap', minimum, maximum);
            if (plan.unbounded) return plan;
            if (plan.bound === null || plan.bound === undefined ||
              (best && plan.distributionBound &&
                compareDistribution(plan.distributionBound, distribution(best)) > 0)) continue;
            if (plan.feasible) {
              if (!best || comparePlans(plan, best) < 0) best = plan;
            } else if (minimum < maximum) {
              const middle = Math.floor((minimum + maximum) / 2);
              intervals.push([middle + 1, maximum], [minimum, middle]);
            }
          }
          return best ?? optimistic;
        }
      }
      const above = solveBalanceMilp(station, catalog, normalizedObjective, recipes, milpSolver, 'at-cap');
      if (above.unbounded) return above;
      if (above.feasible && (!best || comparePlans(above, best) < 0)) best = above;
      return best ?? below;
    }
    return solveBalanceMilp(station, catalog, normalizedObjective, recipes, milpSolver);
  }
  if (objective?.mode === 'max-output') nonNegative(objective.budget, 'Budget');
  else if (objective?.mode === 'min-cost') nonNegative(objective.targetProfit, 'Target profit');
  else throw new Error('Unknown optimization mode');
  if (!Object.keys(station.finalWares ?? {}).length) return { feasible: false, reason: 'Выберите конечный товар' };
  const recipes = optimizerRecipes(catalog, station);
  if (!recipes.length) return { feasible: false, reason: 'Нет производственных модулей для конечных товаров' };
  if (milpSolver && (station.availableWorkforce === 0 || station.autoWorkforce)) {
    return solveMilp(station, catalog, objective, recipes, milpSolver);
  }
  const heap = new MinHeap();
  const initial = { counts: Array(recipes.length).fill(0), cost: 0 };
  heap.push(initial);
  const visited = new Set([initial.counts.join(',')]);
  const maxStates = 250000;
  let best = null;
  let states = 0;
  while (heap.size && states < maxStates) {
    const node = heap.pop();
    states++;
    if (objective.mode === 'max-output' && node.cost > objective.budget + EPSILON) break;
    if (objective.mode === 'min-cost' && best && node.cost > best.constructionCost + EPSILON) break;
    const modules = Object.fromEntries(recipes.flatMap(([id], i) => node.counts[i] ? [[id, node.counts[i]]] : []));
    const calculation = calculateStation({ station: { ...station, modules }, catalog });
    if (isFeasible({ ...station, modules }, catalog, calculation)) {
      const output = finalScale(calculation.balance, station.finalWares);
      const valid = objective.mode === 'max-output' || calculation.hourlyProfit + EPSILON >= objective.targetProfit;
      if (valid && (!best || (objective.mode === 'max-output' ? output > best.output + EPSILON :
        node.cost < best.constructionCost - EPSILON))) {
        best = { feasible: true, modules, constructionCost: calculation.constructionCost,
          hourlyProfit: calculation.hourlyProfit, finalOutput: calculation.finalOutput, output };
      }
    }
    for (let i = 0; i < recipes.length; i++) {
      const cost = node.cost + recipes[i][1].buildCost;
      if (objective.mode === 'max-output' && cost > objective.budget + EPSILON) continue;
      if (objective.mode === 'min-cost' && best && cost > best.constructionCost + EPSILON) continue;
      const counts = node.counts.slice();
      counts[i]++;
      const key = counts.join(',');
      if (visited.has(key)) continue;
      visited.add(key);
      heap.push({ counts, cost });
    }
  }
  if (states === maxStates) return { feasible: false, reason: 'Достигнут предел точного поиска. Уточните задачу или уменьшите предел.' };
  if (!best) return { feasible: false, reason: 'При заданных условиях решение не найдено' };
  delete best.output;
  return best;
}
