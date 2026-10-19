import { localizedName } from './i18n.js';

export function createCatalog(source, prices = {}, race) {
  const wares = Object.fromEntries(source.wares.map(ware => [ware.id, ware]));
  const allPrices = Object.fromEntries(source.wares.map(ware => [ware.id, prices[ware.id] ?? ware.priceAverage]));
  const recipes = {};
  const moduleByRecipe = {};
  const habitats = new Set();
  const infrastructure = new Set();
  const produced = new Set();
  const consumed = new Set();
  for (const module of source.modules) {
    const buildCost = Object.entries(module.buildMaterials).reduce((total, [ware, quantity]) =>
      total + quantity * (allPrices[ware] ?? 0), 0);
    if (module.kind !== 'production') {
      const id = `${module.id}#structure`;
      infrastructure.add(id);
      if (module.kind === 'habitat') habitats.add(id);
      moduleByRecipe[id] = module;
      recipes[id] = { cycleSeconds: 3600, outputs: {}, inputs: {}, workforce: 0,
        buildCost, housingCapacity: module.kind === 'habitat' ? module.capacity : 0,
        storageCapacity: module.kind === 'storage' ? module.capacity : 0,
        storageType: module.storageType, race: module.race, kind: module.kind, moduleId: module.id };
      continue;
    }
    for (const recipe of module.recipes) {
      moduleByRecipe[recipe.id] = module;
      for (const ware of Object.keys(recipe.outputs)) produced.add(ware);
      for (const ware of Object.keys(recipe.inputs)) consumed.add(ware);
      recipes[recipe.id] = { cycleSeconds: recipe.cycleSeconds, outputs: recipe.outputs, inputs: recipe.inputs,
        workforce: module.workforce, workforceBonus: recipe.workforceBonus ?? 0,
        sunlightScaled: !!recipe.sunlightScaled, buildCost, moduleId: module.id,
        race: module.race, kind: module.kind, method: recipe.method };
    }
  }
  const rawWares = source.rawWares ?? [...consumed].filter(ware => !produced.has(ware));
  const consumptionByRace = source.workforceConsumption ?? {};
  const selectedRace = race && consumptionByRace[race] ? race : Object.keys(consumptionByRace)[0];
  return { recipes, rawWares, workforceConsumption: consumptionByRace[selectedRace] ?? {},
    wares, allPrices, moduleByRecipe, habitats, infrastructure,
    races: Object.keys(consumptionByRace), moduleRaces: [...new Set(source.modules.map(module => module.race))],
    race: selectedRace };
}

export function housingCapacity(modules, catalog) {
  return Object.entries(modules).reduce((capacity, [id, count]) =>
    capacity + count * (catalog.recipes[id]?.housingCapacity ?? 0), 0);
}

export function recipeLabel(id, catalog, locale = 'en') {
  const module = catalog.moduleByRecipe[id];
  if (!module) return id;
  const recipe = module.recipes.find(item => item.id === id);
  if (!recipe) return localizedName(module, locale);
  const outputs = Object.keys(recipe.outputs).map(ware =>
    catalog.wares[ware] ? localizedName(catalog.wares[ware], locale) : ware).join(', ');
  return outputs ? `${localizedName(module, locale)} · ${outputs}` : localizedName(module, locale);
}

