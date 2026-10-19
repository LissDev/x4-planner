const STORAGE_KEY = 'x4-station-projects-v1';

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function number(value, label, positive = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (positive && value === 0)) {
    throw new Error(`Invalid ${label}`);
  }
}

export function validateProject(project) {
  if (!object(project) || typeof project.id !== 'string' || !project.id.trim() ||
    typeof project.name !== 'string' || !project.name.trim() || !object(project.station)) {
    throw new Error('Invalid project');
  }
  const station = project.station;
  if (!object(station.modules) || !object(station.prices) || !object(station.finalWares) ||
    !Array.isArray(station.purchasedIntermediates)) throw new Error('Invalid station');
  number(station.sunlight, 'sunlight');
  number(station.availableWorkforce, 'workforce');
  for (const [id, count] of Object.entries(station.modules)) {
    if (!id || !Number.isSafeInteger(count) || count < 0) throw new Error('Invalid module count');
  }
  for (const value of Object.values(station.prices)) number(value, 'price');
  for (const value of Object.values(station.finalWares)) number(value, 'final ware ratio', true);
  if (station.targetCounts !== undefined) {
    if (!object(station.targetCounts) || Object.entries(station.targetCounts).some(([ware, count]) =>
      !(ware in station.finalWares) || !Number.isSafeInteger(count) || count <= 0)) {
      throw new Error('Invalid final module target count');
    }
  }
  if (station.recipeChoices !== undefined && (!object(station.recipeChoices) ||
    Object.entries(station.recipeChoices).some(([ware, id]) =>
      !ware || typeof id !== 'string' || !id))) {
    throw new Error('Invalid recipe choices');
  }
  if (!station.purchasedIntermediates.every(ware => typeof ware === 'string' && ware.length)) {
    throw new Error('Invalid purchased intermediates');
  }
  for (const field of ['allowedRaces', 'ownedSupplyWares']) {
    if (station[field] !== undefined && (!Array.isArray(station[field]) ||
      !station[field].every(value => typeof value === 'string' && value.length))) {
      throw new Error(`Invalid ${field}`);
    }
  }
  if (station.workforceRace !== undefined &&
    (typeof station.workforceRace !== 'string' || !station.workforceRace.length)) {
    throw new Error('Invalid workforce race');
  }
  if (station.autoStorageHours !== undefined) number(station.autoStorageHours, 'storage hours');
  for (const field of ['autoWorkforce', 'autoStorage', 'sellIntermediateSurplus']) {
    if (station[field] !== undefined && typeof station[field] !== 'boolean') {
      throw new Error(`Invalid ${field}`);
    }
  }
  return project;
}

export function createProjectStore(storage = globalThis.localStorage) {
  function read() {
    const value = storage.getItem(STORAGE_KEY);
    if (!value) return {};
    const projects = JSON.parse(value);
    if (!object(projects)) throw new Error('Invalid saved projects');
    return projects;
  }
  function write(projects) { storage.setItem(STORAGE_KEY, JSON.stringify(projects)); }
  return {
    list: () => Object.values(read()).map(project => structuredClone(project)),
    get: id => { const project = read()[id]; return project ? structuredClone(project) : undefined; },
    save: project => {
      validateProject(project);
      const projects = read();
      projects[project.id] = structuredClone(project);
      write(projects);
      return structuredClone(project);
    },
    remove: id => {
      const projects = read();
      delete projects[id];
      write(projects);
    },
    exportJson: id => {
      const project = read()[id];
      if (!project) throw new Error('Project not found');
      return JSON.stringify(project, null, 2);
    },
    importJson: json => {
      const project = JSON.parse(json);
      validateProject(project);
      const projects = read();
      projects[project.id] = structuredClone(project);
      write(projects);
      return structuredClone(project);
    },
  };
}
