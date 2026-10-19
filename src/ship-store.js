import { validateShipBuild } from './ship-engine.js';

const STORAGE_KEY = 'x4-ship-builds-v1';

export function createShipStore(storage = globalThis.localStorage, catalog = globalThis.X4_SHIP_DATA) {
  function read() {
    const saved = storage.getItem(STORAGE_KEY);
    if (!saved) return [];
    const builds = JSON.parse(saved);
    if (!Array.isArray(builds)) throw new Error('Invalid saved ship builds');
    return builds;
  }
  function write(builds) { storage.setItem(STORAGE_KEY, JSON.stringify(builds)); }
  function save(build) {
    validateShipBuild(build, catalog);
    const builds = read();
    const index = builds.findIndex(item => item.id === build.id);
    const copy = structuredClone(build);
    if (index < 0) builds.push(copy);
    else builds[index] = copy;
    write(builds);
    return structuredClone(copy);
  }
  return {
    list: () => structuredClone(read()),
    get: id => { const build = read().find(item => item.id === id); return build && structuredClone(build); },
    save,
    remove: id => write(read().filter(item => item.id !== id)),
    exportJson: id => {
      const build = read().find(item => item.id === id);
      if (!build) throw new Error('Ship build not found');
      return JSON.stringify(build, null, 2);
    },
    importJson: json => save(JSON.parse(json)),
  };
}
