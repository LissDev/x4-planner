import { calculateStation } from './engine.js';
import { createProjectStore, validateProject } from './project-store.js';
import { createCatalog, housingCapacity, recipeLabel } from './catalog.js';
import { createShipUi } from './ship-ui.js';
import { localizedName, formatNumber } from './i18n.js';
import { stationT } from './station-i18n.js';

const source = globalThis.X4_DATA;
const root = document.getElementById('app');
const store = createProjectStore(localStorage);
const languageKey = 'x4-language-v1';
let currentLocale;
try { currentLocale = localStorage.getItem(languageKey) === 'ru' ? 'ru' : 'en'; }
catch { currentLocale = 'en'; }
document.documentElement.lang = currentLocale;
const drafts = new Map();
const raceNames = {
  en: { argon: 'Argon', paranid: 'Paranid', teladi: 'Teladi', split: 'Split', terran: 'Terran', boron: 'Boron', universal: 'Universal' },
  ru: { argon: 'Аргон', paranid: 'Паранид', teladi: 'Телади', split: 'Сплит', terran: 'Земляне', boron: 'Бороны', universal: 'Универсальные' },
};
let draft;
let currentId;
let preview;
let busy = false;
let notice = '';
let noticePlacement = 'toast';
let routeToken = 0;
let draftRevision = 0;
let optimizationToken = 0;
let flowSort = { column: 'ware', direction: 'ascending' };
let modulePicker = { query: '', selectedId: '', open: false, activeIndex: -1 };
let moduleChoices = [];
let undoModules = null;

const escapeHtml = value => String(value).replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const tr = text => stationT(text, currentLocale);
function updateLanguageMetadata() {
  document.title = tr('X4 / Планировщик станций и кораблей');
  document.querySelector('meta[name="description"]')?.setAttribute('content',
    tr('Локальный планировщик станций и кораблей X4: производство, сборки и сравнение.'));
}
updateLanguageMetadata();
const num = (value, options = { maximumFractionDigits: 2 }) => formatNumber(value ?? 0, currentLocale, options);
const credits = value => `${num(value)} ${tr('кр.')}`;
const shipUi = createShipUi({ root, navigate, globalHeader, escapeHtml, format: num,
  locale: () => currentLocale });

function catalog() { return createCatalog(source, draft?.station.prices ?? {}, draft?.station.workforceRace ?? draft?.station.race); }
function routeId() {
  const match = /^#calculator\/([^/]+)$/.exec(location.hash);
  return match ? decodeURIComponent(match[1]) : null;
}
function setNotice(message, placement = 'toast') {
  notice = message;
  noticePlacement = placement;
  const region = document.getElementById('notice');
  if (region) { region.textContent = tr(message); region.hidden = !message; region.dataset.placement = placement; }
}
function numberInput(value, label, { integer = false, positive = false } = {}) {
  const parsed = Number(value);
  if (value === '' || !Number.isFinite(parsed) || parsed < 0 || (positive && parsed === 0) ||
    (integer && !Number.isSafeInteger(parsed))) throw new Error(`Проверьте поле «${label}»`);
  return parsed;
}
function defaults() {
  return { modules: {}, sunlight: 1, availableWorkforce: 0, race: createCatalog(source).race,
    workforceRace: createCatalog(source).race, allowedRaces: createCatalog(source).moduleRaces,
    autoWorkforce: false, autoStorage: false, autoStorageHours: 1,
    sellIntermediateSurplus: false, ownedSupplyWares: [],
    prices: {}, finalWares: {}, targetCounts: {}, purchasedIntermediates: [], recipeChoices: {} };
}
function effectiveStation(currentCatalog) {
  const capacity = housingCapacity(draft.station.modules, currentCatalog);
  return { ...draft.station, prices: currentCatalog.allPrices,
    availableWorkforce: Math.min(draft.station.availableWorkforce, capacity) };
}
function outputWares(currentCatalog) {
  return [...new Set(Object.values(currentCatalog.recipes).flatMap(recipe => Object.keys(recipe.outputs)))];
}
function intermediateWares(currentCatalog) {
  const outputs = new Set(outputWares(currentCatalog));
  const inputs = new Set(Object.values(currentCatalog.recipes).flatMap(recipe => Object.keys(recipe.inputs)));
  const raw = new Set(currentCatalog.rawWares);
  return [...inputs].filter(ware => outputs.has(ware) && !raw.has(ware) && !(ware in draft.station.finalWares));
}
function wareName(id, currentCatalog) {
  const ware = currentCatalog.wares[id];
  return ware ? localizedName(ware, currentLocale) || ware.name : id;
}
function moduleName(id, currentCatalog) { return recipeLabel(id, currentCatalog, currentLocale); }
function focusRouteHeading() {
  root.querySelector('h1')?.focus();
}
function renderRoute() {
  routeToken++;
  optimizationToken++;
  busy = false;
  notice = '';
  noticePlacement = 'toast';
  modulePicker = { query: '', selectedId: '', open: false, activeIndex: -1 };
  undoModules = null;
  if (shipUi.handles(location.hash)) {
    shipUi.renderRoute();
    history.replaceState({ ...history.state, x4Route: true }, '', location.href);
    return;
  }
  if (!source?.wares?.length || !source?.modules?.length) {
    root.innerHTML = `<main class="fatal"><h1>${tr('Данные X4 недоступны')}</h1><p>${tr('Поместите data.js рядом с index.html и перезагрузите страницу.')}</p></main>`;
    return;
  }
  const id = routeId();
  if (!id) {
    currentId = null;
    preview = null;
    renderProjects();
    history.replaceState({ ...history.state, x4Route: true }, '', location.href);
    focusRouteHeading();
    return;
  }
  const saved = store.get(id);
  if (!saved) { history.replaceState(null, '', '#projects'); renderRoute(); return; }
  if (currentId !== id) {
    currentId = id;
    flowSort = { column: 'ware', direction: 'ascending' };
    draft = drafts.get(id) ?? saved;
    draft.station.targetCounts ??= Object.fromEntries(
      Object.keys(draft.station.finalWares).map(ware => [ware, 1]));
    preview = null;
  }
  renderCalculator();
  history.replaceState({ ...history.state, x4Route: true }, '', location.href);
  focusRouteHeading();
}
function changeLanguage(locale) {
  currentLocale = locale === 'ru' ? 'ru' : 'en';
  document.documentElement.lang = currentLocale;
  updateLanguageMetadata();
  try { localStorage.setItem(languageKey, currentLocale); } catch { /* The preference is optional. */ }
  if (shipUi.handles(location.hash)) { shipUi.renderRoute(); return; }
  if (routeId() && draft) {
    if (modulePicker.selectedId) modulePicker.query = moduleName(modulePicker.selectedId, catalog());
    renderCalculatorPreservingFocus();
    return;
  }
  const dialog = document.getElementById('create-dialog');
  const open = dialog?.open;
  const name = document.getElementById('project-name')?.value;
  renderProjects();
  if (open) {
    document.getElementById('project-name').value = name;
    document.getElementById('create-dialog').showModal();
  }
  document.getElementById('language-select')?.focus();
}
function navigate(hash) {
  history.pushState({ x4Route: true }, '', hash);
  renderRoute();
}
function projectCard(project) {
  const count = Object.values(project.station.modules).reduce((sum, value) => sum + value, 0);
  return `<article class="project-card">
    <div class="project-icon" aria-hidden="true">✦</div>
    <div class="project-content"><h3>${escapeHtml(project.name)}</h3>
      <p>${num(count)} ${tr('модулей')} · ${num(Object.keys(project.station.finalWares).length)} ${tr('конечных товаров')}</p></div>
    <div class="project-actions">
      <button class="button button-primary" data-action="open" data-id="${escapeHtml(project.id)}">${tr('Открыть')} <span aria-hidden="true">↗</span></button>
      <button class="icon-button" data-action="export" data-id="${escapeHtml(project.id)}" aria-label="${tr('Экспортировать')} ${escapeHtml(project.name)}" title="${tr('Экспорт JSON')}">⇩</button>
      <button class="icon-button danger" data-action="delete" data-id="${escapeHtml(project.id)}" aria-label="${tr('Удалить')} ${escapeHtml(project.name)}" title="${tr('Удалить')}">×</button>
    </div></article>`;
}
function globalHeader() {
  return `<header class="global-header"><div class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div>
    <div class="brand-text"><strong>X4 / ${tr('ПЛАНИРОВЩИК')}</strong><small>${tr('СТАНЦИИ И КОРАБЛИ')}</small></div>
    <nav class="global-nav" aria-label="${tr('Основная навигация')}"><a href="#projects" ${shipUi.handles(location.hash) ? '' : 'aria-current="page"'}>${tr('Станции')}</a>
      <a href="#ships" ${shipUi.handles(location.hash) ? 'aria-current="page"' : ''}>${tr('Корабли')}</a></nav>
    <label class="language-control" for="language-select">${tr('Язык')}<select id="language-select" aria-label="${tr('Язык')}"><option value="en" ${currentLocale === 'en' ? 'selected' : ''}>English</option><option value="ru" ${currentLocale === 'ru' ? 'selected' : ''}>Русский</option></select></label>
    <span class="source-tag">${tr('ДАННЫЕ X4')} ${escapeHtml(source.version ?? '9.0')}</span></header>`;
}
function renderProjects() {
  const projects = store.list().sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  root.innerHTML = `<div class="shell">${globalHeader()}
    <main class="projects-page"><div class="eyebrow">${tr('ЛОКАЛЬНЫЙ ЦЕНТР ПРОЕКТОВ')} <span class="eyebrow-line"></span> 01 / 02</div>
      <div class="page-heading"><div><h1 tabindex="-1">${tr('Ваши станции')}<span class="accent">.</span></h1>
        <p>${tr('Соберите производственную цепочку, сравните затраты и найдите план под свою цель.')}</p></div>
        <button class="button button-primary large" data-action="create">＋ ${tr('Новый проект')}</button></div>
      <div class="section-heading"><h2>${tr('Проекты')} <span class="count-pill">${projects.length}</span></h2>
        <button class="button button-quiet" data-action="import">⇧ ${tr('Импорт JSON')}</button></div>
      <div class="project-list">${projects.length ? projects.map(projectCard).join('') :
        `<div class="empty-state"><div class="empty-symbol">✦</div><h3>${tr('Здесь появятся ваши станции')}</h3><p>${tr('Создайте проект, чтобы выбрать модули и рассчитать экономику производства.')}</p><button class="button button-primary" data-action="create">${tr('Создать станцию')}</button></div>`}</div>
      <footer class="page-footer">${tr('Работает без сети · Данные сохраняются в этом браузере · Экспортируйте JSON для резервной копии')}</footer>
    </main><div id="notice" class="toast" role="status" ${notice ? '' : 'hidden'}>${escapeHtml(tr(notice))}</div>
    <input id="import-file" type="file" accept=".json,application/json" hidden>
    <dialog id="create-dialog" class="modal"><form method="dialog" id="create-form">
      <div class="modal-kicker">${tr('НОВЫЙ ПРОЕКТ')}</div><h2>${tr('Название станции')}</h2>
      <label for="project-name">${tr('Название проекта')}</label><input id="project-name" name="name" maxlength="80" required placeholder="${tr('Например, Комплекс в Хатикве')}">
      <div class="modal-actions"><button class="button button-quiet" type="button" data-action="close-create">${tr('Отмена')}</button><button class="button button-primary" type="submit">${tr('Создать')}</button></div>
    </form></dialog></div>`;
}
function availableModules(currentCatalog) {
  const kinds = ['production', 'habitat', 'storage', 'dock', 'pier', 'shipyard'];
  const allowed = new Set(draft.station.allowedRaces ?? currentCatalog.moduleRaces);
  return kinds.flatMap(kind => {
    const ids = Object.keys(currentCatalog.recipes).filter(id => currentCatalog.moduleByRecipe[id]?.kind === kind &&
      allowed.has(currentCatalog.recipes[id].race))
      .sort((a, b) => moduleName(a, currentCatalog).localeCompare(moduleName(b, currentCatalog), currentLocale));
    return ids.map(id => ({ id, label: moduleName(id, currentCatalog),
      searchText: `${recipeLabel(id, currentCatalog, 'ru')} ${recipeLabel(id, currentCatalog, 'en')}`.toLowerCase() }));
  });
}
function matchingModules() {
  if (modulePicker.selectedId && moduleChoices.find(choice => choice.id === modulePicker.selectedId)?.label === modulePicker.query)
    return moduleChoices;
  const query = modulePicker.query.trim().toLocaleLowerCase(currentLocale);
  return moduleChoices.filter(choice => choice.searchText.includes(query));
}
function renderModuleSuggestions() {
  const input = document.getElementById('module-picker');
  const list = document.getElementById('module-suggestions');
  if (!input || !list) return;
  const matches = matchingModules();
  list.hidden = !modulePicker.open;
  list.innerHTML = modulePicker.open ? (matches.length ? matches.map((choice, index) =>
    `<div role="option" id="module-option-${index}" data-module-choice="${escapeHtml(choice.id)}" aria-selected="${index === modulePicker.activeIndex}">${escapeHtml(choice.label)}</div>`).join('') :
    `<p class="muted compact">${tr('Модуль не найден.')}</p>`) : '';
  input.setAttribute('aria-expanded', String(modulePicker.open));
  if (modulePicker.open && modulePicker.activeIndex >= 0 && matches[modulePicker.activeIndex])
    input.setAttribute('aria-activedescendant', `module-option-${modulePicker.activeIndex}`);
  else input.removeAttribute('aria-activedescendant');
  document.getElementById('add-module').disabled = !modulePicker.selectedId;
}
function chooseModule(id) {
  const choice = moduleChoices.find(candidate => candidate.id === id);
  if (!choice) return;
  const input = document.getElementById('module-picker');
  input.focus();
  modulePicker = { query: choice.label, selectedId: id, open: false, activeIndex: -1 };
  input.value = choice.label;
  renderModuleSuggestions();
}
function closeModuleSuggestions() {
  if (!modulePicker.open) return;
  modulePicker.open = false;
  modulePicker.activeIndex = -1;
  renderModuleSuggestions();
}
function moduleTableBodies(currentCatalog) {
  const entries = Object.entries(draft.station.modules).filter(([, count]) => count > 0);
  if (!entries.length) return `<tbody><tr><td colspan="4" class="table-empty">${tr('Добавьте модуль, чтобы увидеть стоимость и потоки станции.')}</td></tr></tbody>`;
  const populationWares = new Set(Object.values(source.workforceConsumption ?? {}).flatMap(wares => Object.keys(wares)));
  populationWares.add('water');
  populationWares.add('spices');
  populationWares.delete('energycells');
  const groups = [
    { id: 'population', name: tr('Население') }, { id: 'production', name: tr('Производство') },
    { id: 'storage', name: tr('Хранение') }, { id: 'other', name: tr('Прочее') },
  ];
  const groupFor = id => {
    const kind = currentCatalog.moduleByRecipe[id]?.kind;
    if (kind === 'habitat') return 'population';
    if (kind === 'storage') return 'storage';
    if (kind !== 'production') return 'other';
    return Object.keys(currentCatalog.recipes[id].outputs).some(ware => populationWares.has(ware)) ? 'population' : 'production';
  };
  const producers = new Map();
  for (const [id] of entries) for (const ware of Object.keys(currentCatalog.recipes[id].outputs)) {
    if (!producers.has(ware)) producers.set(ware, []);
    producers.get(ware).push(id);
  }
  const tiers = new Map();
  const visiting = new Set();
  const tierFor = id => {
    if (tiers.has(id)) return tiers.get(id);
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const dependencies = Object.keys(currentCatalog.recipes[id].inputs).flatMap(ware => producers.get(ware) ?? [])
      .filter(supplier => supplier !== id);
    const tier = dependencies.length ? 1 + Math.max(...dependencies.map(tierFor)) : 0;
    visiting.delete(id);
    tiers.set(id, tier);
    return tier;
  };
  const row = ([id, count]) => {
    const recipe = currentCatalog.recipes[id];
    const label = moduleName(id, currentCatalog);
    const kind = tr(({ habitat: 'Жильё', storage: 'Хранилище', dock: 'Док', pier: 'Пирс', shipyard: 'Верфь', production: 'Производство' })[currentCatalog.moduleByRecipe[id]?.kind] ?? 'Инфраструктура');
    const disallowed = draft.station.allowedRaces && !draft.station.allowedRaces.includes(recipe.race);
    const crossGroup = Object.keys(recipe.inputs).filter(ware => (producers.get(ware) ?? [])
      .some(supplier => groupFor(supplier) !== groupFor(id)));
    const hint = crossGroup.length ? `<div class="table-secondary">${tr('Из другой группы:')} ${crossGroup.map(ware => escapeHtml(wareName(ware, currentCatalog))).join(' · ')}</div>` : '';
    return `<tr><th scope="row"><div class="table-primary">${escapeHtml(label)}</div><div class="table-secondary">${kind}${disallowed ? ` · ${tr('Вне выбранных рас; учитывается в расчёте')}` : ''}</div>${hint}</th>
      <td><input class="count-input" type="number" min="0" step="1" value="${count}" data-count="${escapeHtml(id)}" aria-label="${tr('Количество:')} ${escapeHtml(label)}"></td>
      <td class="number-cell">${credits(recipe.buildCost * count)}</td>
      <td class="action-cell"><button class="icon-button danger" data-action="remove-module" data-id="${escapeHtml(id)}" aria-label="${tr('Удалить')} ${escapeHtml(label)}">×</button></td></tr>`;
  };
  return groups.map(group => {
    const members = entries.filter(([id]) => groupFor(id) === group.id)
      .sort(([a], [b]) => tierFor(a) - tierFor(b) ||
        moduleName(a, currentCatalog).localeCompare(moduleName(b, currentCatalog), currentLocale) || a.localeCompare(b));
    return members.length ? `<tbody><tr class="module-group-row"><th scope="rowgroup" colspan="4">${group.name}</th></tr>${members.map(row).join('')}</tbody>` : '';
  }).join('');
}
function flowRows(calculation, currentCatalog) {
  const wares = [...new Set([...Object.keys(calculation.production), ...Object.keys(calculation.consumption)])];
  const flowValue = (ware, column) => ({
    production: calculation.production[ware] ?? 0,
    consumption: calculation.consumption[ware] ?? 0,
    balance: calculation.balance[ware] ?? 0,
    purchases: calculation.purchases[ware] ?? 0,
    sales: (calculation.finalOutput[ware] ?? 0) + (calculation.surplusSales[ware] ?? 0),
  })[column];
  const direction = flowSort.direction === 'ascending' ? 1 : -1;
  wares.sort((a, b) => direction * (flowSort.column === 'ware' ?
    wareName(a, currentCatalog).localeCompare(wareName(b, currentCatalog), currentLocale) :
    flowValue(a, flowSort.column) - flowValue(b, flowSort.column)) ||
    wareName(a, currentCatalog).localeCompare(wareName(b, currentCatalog), currentLocale));
  if (!wares.length) return `<tr><td colspan="6" class="table-empty">${tr('Потоки появятся после выбора модулей.')}</td></tr>`;
  return wares.map(ware => {
    const balance = calculation.balance[ware] ?? 0;
    const final = ware in draft.station.finalWares;
    const owned = (calculation.externalRequirements[ware] ?? 0) > 0;
    const surplus = (calculation.surplusSales[ware] ?? 0) > 0;
    return `<tr><th scope="row"><div class="table-primary">${escapeHtml(wareName(ware, currentCatalog))}${final ? ` <span class="mini-badge">${tr('ПРОДАЖА')}</span>` : ''}${surplus ? ` <span class="mini-badge">${tr('ИЗЛИШЕК')}</span>` : ''}${owned ? ` <span class="mini-badge">${tr('СВОЁ СНАБЖЕНИЕ')}</span>` : ''}</div></th>
      <td class="number-cell">${num(calculation.production[ware] ?? 0)}</td><td class="number-cell">${num(calculation.consumption[ware] ?? 0)}</td>
      <td class="number-cell ${balance < 0 ? 'negative' : 'positive'}">${balance > 0 ? '+' : ''}${num(balance)}</td>
      <td class="number-cell">${num(calculation.purchases[ware] ?? 0)}</td>
      <td class="number-cell">${num((calculation.finalOutput[ware] ?? 0) + (calculation.surplusSales[ware] ?? 0))}</td></tr>`;
  }).join('');
}
function flowHeader(column, name, numeric = false) {
  return `<th class="${numeric ? 'number-cell' : ''}" aria-sort="${flowSort.column === column ? flowSort.direction : 'none'}"><button type="button" id="flow-sort-${column}" data-flow-sort="${column}">${name}</button></th>`;
}
function producerIds(ware, currentCatalog) {
  return Object.entries(currentCatalog.recipes).filter(([, recipe]) =>
    (recipe.kind ?? 'production') === 'production' && recipe.outputs[ware] > 0).map(([id]) => id);
}
function recipeChoiceControl(ware, currentCatalog) {
  const chosen = draft.station.recipeChoices?.[ware] ?? '';
  const allowed = new Set(draft.station.allowedRaces ?? currentCatalog.moduleRaces);
  const ids = producerIds(ware, currentCatalog).filter(id => allowed.has(currentCatalog.recipes[id].race) || id === chosen);
  return `<label class="recipe-choice-label">${tr('Метод производства')}
    <select data-recipe-choice="${escapeHtml(ware)}" aria-label="${tr('Метод производства')} ${escapeHtml(wareName(ware, currentCatalog))}">
      <option value="">${tr('Автоматически')}</option>${ids.map(id => `<option value="${escapeHtml(id)}" ${id === chosen ? 'selected' : ''}>${escapeHtml(moduleName(id, currentCatalog))}${allowed.has(currentCatalog.recipes[id].race) ? '' : ` · ${tr('Вне выбранных рас')}`}</option>`).join('')}
    </select>${chosen && !allowed.has(currentCatalog.recipes[chosen].race) ? `<small>${tr('Вне выбранных рас')} — ${tr('Выберите другой метод или автоматический выбор.')}</small>` : ''}</label>`;
}
function intermediateChoiceRows(currentCatalog) {
  const external = new Set([...(draft.station.purchasedIntermediates ?? []), ...(draft.station.ownedSupplyWares ?? [])]);
  const raw = new Set(currentCatalog.rawWares);
  const selected = new Set(Object.keys(draft.station.finalWares));
  const relevant = new Set(selected);
  const allowed = new Set(draft.station.allowedRaces ?? currentCatalog.moduleRaces);
  for (const ware of relevant) {
    if (!selected.has(ware) && external.has(ware)) continue;
    const chosen = draft.station.recipeChoices?.[ware];
    for (const id of producerIds(ware, currentCatalog)) {
      if (!allowed.has(currentCatalog.recipes[id].race) && id !== chosen) continue;
      for (const input of Object.keys(currentCatalog.recipes[id].inputs))
        if (!raw.has(input) && !external.has(input)) relevant.add(input);
    }
  }
  const choices = draft.station.recipeChoices ?? {};
  const wares = new Set([...relevant, ...Object.keys(choices)]);
  return [...wares].filter(ware => !selected.has(ware) &&
    (producerIds(ware, currentCatalog).filter(id => allowed.has(currentCatalog.recipes[id].race)).length > 1 || choices[ware]))
    .sort((a, b) => wareName(a, currentCatalog).localeCompare(wareName(b, currentCatalog), currentLocale))
    .map(ware => `<div class="recipe-choice-row"><span>${escapeHtml(wareName(ware, currentCatalog))}${relevant.has(ware) ? '' : ` <small>${tr('Сейчас не требуется')}</small>`}</span>${recipeChoiceControl(ware, currentCatalog)}</div>`).join('');
}
function finalRows(currentCatalog) {
  const entries = Object.entries(draft.station.finalWares);
  return entries.length ? entries.map(([ware]) => `<div class="selected-item">
    <span>${escapeHtml(wareName(ware, currentCatalog))}</span>
    ${producerIds(ware, currentCatalog).length > 1 || draft.station.recipeChoices?.[ware] ? recipeChoiceControl(ware, currentCatalog) : ''}
    <label class="target-count-label">${tr('Модули')} <input type="number" min="1" step="1" value="${draft.station.targetCounts?.[ware] ?? 1}" data-target-count="${escapeHtml(ware)}" aria-label="${tr('Модули для')} ${escapeHtml(wareName(ware, currentCatalog))}"></label>
    <button class="icon-button danger" data-action="remove-final" data-id="${escapeHtml(ware)}" aria-label="${tr('Убрать')} ${escapeHtml(wareName(ware, currentCatalog))}">×</button></div>`).join('') :
    `<p class="muted compact">${tr('Выберите товар, который станция будет продавать.')}</p>`;
}
function intermediateRows(currentCatalog) {
  return intermediateWares(currentCatalog).sort((a, b) => wareName(a, currentCatalog).localeCompare(wareName(b, currentCatalog), currentLocale))
    .map(ware => `<label class="check-row"><span>${escapeHtml(wareName(ware, currentCatalog))}<small>${credits(currentCatalog.allPrices[ware])}/${tr('ед.')}</small></span>
      <input type="checkbox" data-intermediate="${escapeHtml(ware)}" ${draft.station.purchasedIntermediates.includes(ware) ? 'checked' : ''}></label>`).join('');
}
function ownedSupplyRows(currentCatalog) {
  const wares = new Set([...currentCatalog.rawWares,
    ...Object.values(currentCatalog.recipes).flatMap(recipe => Object.keys(recipe.inputs)),
    ...Object.keys(currentCatalog.workforceConsumption)]);
  return [...wares].sort((a, b) => wareName(a, currentCatalog).localeCompare(wareName(b, currentCatalog), currentLocale))
    .map(ware => `<label class="check-row"><span>${escapeHtml(wareName(ware, currentCatalog))}<small>${tr('внешнее снабжение')}</small></span>
      <input type="checkbox" data-owned-supply="${escapeHtml(ware)}" ${(draft.station.ownedSupplyWares ?? []).includes(ware) ? 'checked' : ''}></label>`).join('');
}
function priceRows(currentCatalog) {
  return Object.values(currentCatalog.wares).sort((a, b) =>
    localizedName(a, currentLocale).localeCompare(localizedName(b, currentLocale), currentLocale))
    .map(ware => `<tr data-ware-row data-search="${escapeHtml(`${ware.name} ${ware.nameEn ?? ''}`.toLowerCase())}"><th scope="row">${escapeHtml(localizedName(ware, currentLocale))}</th>
      <td class="number-cell muted">${credits(ware.priceAverage)}</td><td><input type="number" min="0" step="any" value="${currentCatalog.allPrices[ware.id]}" data-price="${escapeHtml(ware.id)}" aria-label="${tr('Цена')} ${escapeHtml(localizedName(ware, currentLocale))}"></td></tr>`).join('');
}
function previewMarkup(currentCatalog) {
  if (!preview) return '';
  const before = draft.station.modules;
  const after = preview.modules;
  const ids = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(id => (before[id] ?? 0) !== (after[id] ?? 0));
  return `<section class="panel preview-panel" id="preview" aria-label="${tr('Предпросмотр оптимизации')}">
    <div class="panel-head"><div><div class="panel-kicker">${tr('ПРЕДПРОСМОТР · ЧЕРНОВИК НЕ ИЗМЕНЁН')}</div><h2>${tr('Предлагаемый план')}</h2></div><button class="icon-button" data-action="cancel-preview" aria-label="${tr('Закрыть предпросмотр')}">×</button></div>
    <div class="preview-metrics"><div><small>${tr('Строительство')}</small><strong>${credits(preview.constructionCost)}</strong></div>
      <div><small>${tr('Прибыль / ч')}</small><strong>${credits(preview.hourlyProfit)}</strong></div></div>
    <p class="preview-output">${tr('Продажа / ч:')} ${Object.entries(preview.finalOutput).map(([ware, amount]) => `${escapeHtml(wareName(ware, currentCatalog))} ${num(amount)}`).join(' · ')}</p>
    <div class="preview-diff">${ids.length ? ids.map(id => `<div><span>${escapeHtml(moduleName(id, currentCatalog))}</span><b>${num(before[id] ?? 0)} → ${num(after[id] ?? 0)}</b></div>`).join('') : `<p>${tr('Количество модулей не изменится.')}</p>`}</div>
    <div class="preview-actions"><button class="button button-quiet" data-action="cancel-preview">${tr('Отмена')}</button>
      <button class="button button-primary" data-action="apply-preview">${tr('Применить к черновику')}</button></div>
    <p class="muted compact">${tr('План обновит производство')}${draft.station.autoWorkforce ? tr(', жильё') : ''}${draft.station.autoStorage ? tr(', хранилища') : ''}. ${tr('Сохранение проекта — отдельное действие.')}</p>
  </section>`;
}
function renderCalculator() {
  const currentCatalog = catalog();
  moduleChoices = availableModules(currentCatalog);
  if (modulePicker.selectedId && !moduleChoices.some(choice => choice.id === modulePicker.selectedId))
    modulePicker.selectedId = '';
  const station = effectiveStation(currentCatalog);
  const calculation = calculateStation({ station, catalog: currentCatalog });
  const capacity = housingCapacity(draft.station.modules, currentCatalog);
  const outputOptions = outputWares(currentCatalog).filter(ware => !(ware in draft.station.finalWares))
    .sort((a, b) => wareName(a, currentCatalog).localeCompare(wareName(b, currentCatalog), currentLocale))
    .map(ware => `<option value="${escapeHtml(ware)}">${escapeHtml(wareName(ware, currentCatalog))}</option>`).join('');
  const intermediateChoices = intermediateChoiceRows(currentCatalog);
  root.innerHTML = `<div class="shell">${globalHeader()}
    <main class="calculator-page"><nav class="breadcrumb" aria-label="${tr('Навигация')}"><a href="#projects">← ${tr('Проекты')}</a><span>/</span><span>${escapeHtml(draft.name)}</span></nav>
      <div class="calc-heading"><div><div class="eyebrow">${tr('Производственный комплекс').toLocaleUpperCase(currentLocale)} <span class="eyebrow-line"></span> 02 / 02</div>
        <h1 tabindex="-1">${escapeHtml(draft.name)}<span class="accent">.</span></h1><p>${tr('Модули, потоки и экономика одной станции.')}</p></div>
        <div class="heading-actions"><button class="button button-quiet" data-action="export" data-id="${escapeHtml(draft.id)}">⇩ ${tr('Экспорт')}</button>
        <button class="button button-primary" data-action="save">${tr('Сохранить проект')}</button></div></div>
      <div class="metrics"><div class="metric"><span>${tr('СТРОИТЕЛЬСТВО')}</span><strong>${credits(calculation.constructionCost)}</strong><small>${tr('По заданным ценам товаров')}</small></div>
        <div class="metric"><span>${tr('ВЫРУЧКА / Ч')}</span><strong>${credits(calculation.hourlyRevenue)}</strong><small>${tr('Конечные товары')}${draft.station.sellIntermediateSurplus ? ` ${tr('и излишки полуфабрикатов')}` : ''}</small></div>
        <div class="metric"><span>${tr('ЗАКУПКИ / Ч')}</span><strong>${credits(calculation.hourlyOperatingCost)}</strong><small>${tr('Сырьё, дефицит, снабжение')}</small></div>
        <div class="metric metric-highlight"><span>${tr('ПРИБЫЛЬ / Ч')}</span><strong>${credits(calculation.hourlyProfit)}</strong><small>${tr('После закупок')}</small></div></div>
      <div class="station-profit-detail">${tr('Продажа конечных товаров:')} ${credits(calculation.hourlyRevenue - Object.entries(calculation.surplusSales).reduce((sum, [ware, amount]) => sum + amount * (station.prices[ware] ?? 0), 0))}${draft.station.sellIntermediateSurplus ? ` · ${tr('Продажа излишков:')} ${credits(Object.entries(calculation.surplusSales).reduce((sum, [ware, amount]) => sum + amount * (station.prices[ware] ?? 0), 0))}` : ''} · ${tr('Внешние поставки за свой счёт:')} ${num(Object.values(calculation.externalRequirements).reduce((sum, amount) => sum + amount, 0))} ${tr('ед./ч')}</div>
      <div class="workspace-grid"><div class="controls-column">
        <section class="panel"><div class="panel-head"><div><div class="panel-kicker">01 / ${tr('ПАРАМЕТРЫ')}</div><h2>${tr('Условия станции')}</h2></div></div>
          <div class="field-grid"><label>${tr('Название проекта')}<input type="text" maxlength="80" value="${escapeHtml(draft.name)}" data-field="name"></label>
            <label>${tr('Солнечный свет, %')}<input type="number" min="0" step="any" value="${draft.station.sunlight * 100}" data-field="sunlight"></label>
            <label>${tr('Рабочие на станции')}<input type="number" min="0" step="1" value="${draft.station.availableWorkforce}" data-field="availableWorkforce" ${draft.station.autoWorkforce ? 'disabled' : ''}></label>
            <label>${tr('Раса работников')}<select data-field="workforceRace">${currentCatalog.races.map(race => `<option value="${escapeHtml(race)}" ${race === (draft.station.workforceRace ?? draft.station.race ?? currentCatalog.race) ? 'selected' : ''}>${escapeHtml(raceNames[currentLocale][race] ?? race)}</option>`).join('')}</select></label></div>
          <fieldset class="station-races"><legend>${tr('Расы модулей')}</legend><div class="station-race-list">${currentCatalog.moduleRaces.map(race => `<label><input type="checkbox" data-allowed-race="${escapeHtml(race)}" ${(draft.station.allowedRaces ?? currentCatalog.moduleRaces).includes(race) ? 'checked' : ''}>${escapeHtml(raceNames[currentLocale][race] ?? race)}</label>`).join('')}</div></fieldset>
          <div class="station-toggle-list"><label><input type="checkbox" data-toggle="autoWorkforce" ${draft.station.autoWorkforce ? 'checked' : ''}> ${tr('Автоматически обеспечить работников и жильё')}</label>
            <label><input type="checkbox" data-toggle="autoStorage" ${draft.station.autoStorage ? 'checked' : ''}> ${tr('Автоматически добавить хранилища')}</label>
            <label>${tr('Запас хранения, ч')}<input type="number" min="0" step="any" value="${draft.station.autoStorageHours ?? 1}" data-field="autoStorageHours" ${draft.station.autoStorage ? '' : 'disabled'}></label></div>
          <p class="field-note">${tr('Жилых мест:')} <strong>${num(capacity)}</strong> · ${tr('Работающих:')} <strong>${num(calculation.staffedWorkers)}</strong>. ${tr('Автоматический план полностью укомплектует производство; пища и медикаменты учитываются в потоках.')}</p></section>
        <section class="panel"><div class="panel-head"><div><div class="panel-kicker">02 / ${tr('СБЫТ И СНАБЖЕНИЕ')}</div><h2>${tr('Конечные товары')}</h2></div></div>
          <div class="selected-list">${finalRows(currentCatalog)}</div><div class="inline-add"><select id="final-select" aria-label="${tr('Добавить конечный товар')}">${outputOptions}</select><button class="button button-secondary" data-action="add-final" ${outputOptions ? '' : 'disabled'}>${tr('Добавить')}</button></div>
           <p class="field-note">${tr('Для цепочки укажите число производственных модулей каждого конечного товара.')}</p>
          ${intermediateChoices ? `<details class="subsection"><summary>${tr('Методы промежуточных товаров')}</summary><div class="recipe-choice-list">${intermediateChoices}</div></details>` : ''}
          <details class="subsection"><summary>${tr('Покупные ресурсы')} <span>${draft.station.purchasedIntermediates.length}</span></summary>
            <p class="field-note">${tr('Разрешает покупать дефицит вместо полного внутреннего производства.')}</p>
            <div class="check-list">${intermediateRows(currentCatalog) || `<p class="muted compact">${tr('Доступных полуфабрикатов нет.')}</p>`}</div></details>
          <details class="subsection"><summary>${tr('Собственное внешнее снабжение')} <span>${(draft.station.ownedSupplyWares ?? []).length}</span></summary>
            <p class="field-note">${tr('Эти товары поступают извне бесплатно; потребность остаётся в потоках.')}</p>
            <label class="check-row"><span>${tr('Выбрать всё')}</span><input type="checkbox" data-owned-supply-all></label>
            <div class="check-list">${ownedSupplyRows(currentCatalog)}</div></details>
          <label class="station-inline-toggle"><span>${tr('Продавать излишки ресурсов')}</span><input type="checkbox" data-toggle="sellIntermediateSurplus" ${draft.station.sellIntermediateSurplus ? 'checked' : ''}></label></section>
        <section class="panel optimizer-panel"><div class="panel-head"><div><div class="panel-kicker">03 / ${tr('ПЛАНИРОВАНИЕ')}</div><h2>${tr('Производственный баланс')}</h2></div></div>
           <div class="balance-actions"><button class="button button-primary" data-action="build-chain" ${busy ? 'disabled' : ''}>${tr('Построить цепочку')}</button>
           <button class="button button-secondary" data-action="use-reserve" ${busy ? 'disabled' : ''}>${tr('Использовать резерв')}</button></div>
           <p class="field-note">${tr('Цепочка собирается под число конечных модулей. Резерв добавляет конечные модули к текущей станции без расширения производства полуфабрикатов.')}</p>
           <div id="notice" class="toast" data-placement="${noticePlacement}" role="status" ${notice ? '' : 'hidden'}>${escapeHtml(tr(notice))}</div></section>
        ${previewMarkup(currentCatalog)}
      </div><div class="results-column">
        <section class="panel"><div class="panel-head"><div><div class="panel-kicker">${tr('КОНСТРУКЦИЯ')}</div><h2>${tr('Модули станции')} <span class="count-pill">${Object.values(draft.station.modules).reduce((sum, count) => sum + count, 0)}</span></h2></div>
          <button class="button button-quiet" id="clear-modules" data-action="clear-modules" ${Object.keys(draft.station.modules).length ? '' : 'disabled'}>${tr('Очистить модули')}</button></div>
          <div class="module-add"><div class="module-picker"><input id="module-picker" type="text" role="combobox" aria-label="${tr('Выберите модуль')}" aria-autocomplete="list" aria-expanded="${modulePicker.open}" aria-controls="module-suggestions" autocomplete="off" placeholder="${tr('Название или товар…')}" value="${escapeHtml(modulePicker.query)}"><div id="module-suggestions" role="listbox" ${modulePicker.open ? '' : 'hidden'}></div></div><button class="button button-secondary" id="add-module" data-action="add-module" ${modulePicker.selectedId ? '' : 'disabled'}>＋ ${tr('Добавить модуль')}</button></div>
          ${undoModules ? `<div class="module-undo"><span>${tr('Модули удалены из черновика.')}</span><button class="button button-quiet" data-action="undo-modules">${tr('Вернуть модули')}</button></div>` : ''}
          <div class="table-wrap"><table><thead><tr><th>${tr('Модуль / метод')}</th><th>${tr('Шт.')}</th><th class="number-cell">${tr('Строительство')}</th><th></th></tr></thead>${moduleTableBodies(currentCatalog)}</table></div></section>
        <section class="panel"><div class="panel-head"><div><div class="panel-kicker">${tr('ЭКОНОМИКА / ЕДИНИЦ В ЧАС')}</div><h2>${tr('Потоки товаров')}</h2></div></div>
          <div class="table-wrap"><table class="flows-table"><thead><tr>${flowHeader('ware', tr('Товар'))}${flowHeader('production', tr('Выпуск'), true)}${flowHeader('consumption', tr('Расход'), true)}${flowHeader('balance', tr('Баланс'), true)}${flowHeader('purchases', tr('Закупка'), true)}${flowHeader('sales', tr('Продажа'), true)}</tr></thead><tbody>${flowRows(calculation, currentCatalog)}</tbody></table></div>
          <p class="table-footnote">${tr('Отрицательный баланс показывает внешнюю потребность. Выбранные собственные поставки не входят в стоимость закупок.')}</p></section>
        <section class="panel"><div class="panel-head"><div><div class="panel-kicker">${tr('РЫНОК И СТРОИТЕЛЬСТВО')}</div><h2>${tr('Цены товаров')}</h2></div></div>
          <p class="muted compact">${tr('Изменения влияют на продажи, закупки и стоимость материалов модулей.')}</p>
          <label class="search-label">${tr('Поиск товара')}<input id="ware-search" type="search" placeholder="${tr('Название товара…')}"></label>
          <div class="table-wrap price-table-wrap"><table><thead><tr><th>${tr('Товар')}</th><th class="number-cell">${tr('Средняя')}</th><th>${tr('Цена в расчёте')}</th></tr></thead><tbody>${priceRows(currentCatalog)}</tbody></table></div></section>
      </div></div><footer class="page-footer">${tr('Изменения сохраняются только после нажатия «Сохранить проект». Экспорт JSON создаёт резервную копию.')}</footer>
    </main></div>`;
  const bulk = root.querySelector('[data-owned-supply-all]');
  const supplies = [...root.querySelectorAll('[data-owned-supply]')];
  const selected = supplies.filter(input => input.checked).length;
  bulk.checked = supplies.length > 0 && selected === supplies.length;
  bulk.indeterminate = selected > 0 && selected < supplies.length;
  bulk.setAttribute('aria-checked', bulk.indeterminate ? 'mixed' : String(bulk.checked));
  renderModuleSuggestions();
}

function downloadProject(id) {
  const project = store.get(id);
  if (!project) throw new Error('Проект не найден');
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${project.name.replace(/[\\/:*?"<>|]/g, '_')}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function renderCalculatorPreservingFocus() {
  const active = document.activeElement;
  const openDetails = [...root.querySelectorAll('details.subsection')].map(details => details.open);
  const choices = ['final-select', 'ware-search']
    .map(id => [id, document.getElementById(id)?.value]);
  const key = ['field', 'count', 'price', 'targetCount', 'recipeChoice', 'intermediate', 'ownedSupply', 'ownedSupplyAll', 'allowedRace', 'toggle'].find(name =>
    active?.dataset?.[name] !== undefined);
  const value = key ? active.dataset[key] : null;
  const id = !key && root.contains(active) ? active.id : '';
  let selection;
  try { selection = [active.selectionStart, active.selectionEnd]; } catch { /* Numeric inputs have no text selection. */ }
  renderCalculator();
  [...root.querySelectorAll('details.subsection')].forEach((details, index) => { details.open = openDetails[index] ?? false; });
  for (const [controlId, savedValue] of choices) {
    if (!savedValue || !controlId.endsWith('-search')) continue;
    const control = document.getElementById(controlId);
    control.value = savedValue;
    control.dispatchEvent(new Event('input', { bubbles: true }));
  }
  for (const [controlId, savedValue] of choices) {
    if (!savedValue || !controlId.endsWith('-select')) continue;
    const control = document.getElementById(controlId);
    if ([...control.options].some(option => option.value === savedValue && !option.disabled)) control.value = savedValue;
  }
  const replacement = key ? [...root.querySelectorAll(`[data-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}]`)]
    .find(item => item.dataset[key] === value) :
    (id ? document.getElementById(id) : null);
  if (replacement) {
    replacement.focus({ preventScroll: true });
    if (selection?.every(Number.isInteger)) {
      try { replacement.setSelectionRange(...selection); } catch { /* Numeric inputs have no text selection. */ }
    }
  }
}
function storeDraft(deferRender = false) {
  drafts.set(draft.id, structuredClone(draft));
  draftRevision++;
  preview = null;
  if (!deferRender) { renderCalculatorPreservingFocus(); return; }
  const id = draft.id;
  const route = routeToken;
  setTimeout(() => {
    if (routeId() === id && routeToken === route) renderCalculatorPreservingFocus();
  }, 0);
}
function handleError(error) {
  const message = error.message || 'Не удалось выполнить действие';
  setNotice(message === 'Invalid module count' ? 'Некорректное количество модулей в JSON' : message);
}

function optimizeInWorker(station, currentCatalog, objective) {
  return new Promise((resolve, reject) => {
    if (!globalThis.Worker || !globalThis.OPTIMIZER_WORKER_SOURCE) {
      reject(new Error('Ваш браузер не поддерживает локальный расчёт в фоновом потоке'));
      return;
    }
    const url = URL.createObjectURL(new Blob([globalThis.OPTIMIZER_WORKER_SOURCE], { type: 'text/javascript' }));
    const worker = new Worker(url);
    const timeout = setTimeout(() => finish(new Error('Расчёт не завершился за 15 секунд. Уменьшите число вариантов.')), 15000);
    function finish(error, result) {
      clearTimeout(timeout);
      worker.terminate();
      URL.revokeObjectURL(url);
      if (error) reject(error); else resolve(result);
    }
    worker.onmessage = event => event.data?.error ? finish(new Error(event.data.error)) : finish(null, event.data.result);
    worker.onerror = event => finish(new Error(event.message || 'Ошибка вычисления'));
    worker.postMessage({ station, catalog: currentCatalog, objective });
  });
}

async function runOptimizer(mode) {
  if (busy) return;
  const projectId = draft.id;
  const revision = draftRevision;
  const route = routeToken;
  const job = ++optimizationToken;
  const outdated = () => job !== optimizationToken || route !== routeToken ||
    projectId !== currentId || projectId !== routeId() || revision !== draftRevision;
  const currentCatalog = catalog();
  const objective = mode === 'build-chain' ?
    { mode, targetCounts: structuredClone(draft.station.targetCounts) } : { mode };
  const station = structuredClone(effectiveStation(currentCatalog));
  busy = true;
  preview = null;
  renderCalculator();
  try {
    const result = await optimizeInWorker(station, currentCatalog, objective);
    if (outdated()) return;
    if (!result.feasible) throw new Error(result.reason);
    const modules = result.modules;
    const calculation = calculateStation({ station: { ...station, modules }, catalog: currentCatalog });
    preview = { ...result, modules, constructionCost: calculation.constructionCost,
      hourlyProfit: calculation.hourlyProfit, finalOutput: calculation.finalOutput };
  } catch (error) {
    if (!outdated()) throw error;
  } finally {
    if (job === optimizationToken) {
      busy = false;
      if (routeId() === projectId) renderCalculatorPreservingFocus();
    }
  }
}

root.addEventListener('click', async event => {
  if (shipUi.handleClick(event)) return;
  const moduleChoice = event.target.closest('[data-module-choice]');
  if (moduleChoice) { chooseModule(moduleChoice.dataset.moduleChoice); return; }
  const sortButton = event.target.closest('[data-flow-sort]');
  if (sortButton) {
    const column = sortButton.dataset.flowSort;
    flowSort = { column, direction: flowSort.column === column && flowSort.direction === 'ascending' ? 'descending' : 'ascending' };
    renderCalculatorPreservingFocus();
    return;
  }
  if (event.target.closest('a[href="#projects"]')) {
    event.preventDefault();
    navigate('#projects');
    return;
  }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  const id = button.dataset.id;
  try {
    if (action === 'create') {
      document.getElementById('create-dialog').showModal();
      document.getElementById('project-name').focus();
    } else if (action === 'close-create') document.getElementById('create-dialog').close();
    else if (action === 'open') navigate(`#calculator/${encodeURIComponent(id)}`);
    else if (action === 'delete') {
      const project = store.get(id);
      if (project && confirm(`${tr('Удалить проект')} «${project.name}»?`)) {
        store.remove(id); drafts.delete(id); renderProjects(); setNotice('Проект удалён');
      }
    } else if (action === 'export') downloadProject(id);
    else if (action === 'import') document.getElementById('import-file').click();
    else if (action === 'save') {
      draft.updatedAt = new Date().toISOString(); store.save(draft); drafts.set(draft.id, structuredClone(draft));
      setNotice('Проект сохранён в этом браузере');
    } else if (action === 'add-module') {
      const recipe = modulePicker.selectedId;
      if (moduleChoices.some(choice => choice.id === recipe)) {
        undoModules = null;
        draft.station.modules[recipe] = (draft.station.modules[recipe] ?? 0) + 1;
        storeDraft();
      }
    } else if (action === 'remove-module') { undoModules = null; delete draft.station.modules[id]; storeDraft(); }
    else if (action === 'clear-modules' && Object.keys(draft.station.modules).length) {
      undoModules = structuredClone(draft.station.modules);
      draft.station.modules = {};
      storeDraft();
      root.querySelector('[data-action="undo-modules"]')?.focus();
    } else if (action === 'undo-modules' && undoModules) {
      draft.station.modules = undoModules;
      undoModules = null;
      storeDraft();
      document.getElementById('clear-modules')?.focus();
    }
    else if (action === 'add-final') {
      const ware = document.getElementById('final-select').value;
      if (ware) { draft.station.finalWares[ware] = 1; draft.station.targetCounts[ware] = 1; storeDraft(); }
    } else if (action === 'remove-final') { delete draft.station.finalWares[id]; delete draft.station.targetCounts[id]; storeDraft(); }
    else if (action === 'build-chain' || action === 'use-reserve') await runOptimizer(action);
    else if (action === 'cancel-preview') { preview = null; renderCalculator(); }
    else if (action === 'apply-preview' && preview) {
      undoModules = null;
      draft.station.modules = structuredClone(preview.modules);
      const recipes = catalog().recipes;
      for (const ware of Object.keys(draft.station.finalWares)) {
        const count = Object.entries(preview.modules).reduce((sum, [recipeId, modules]) =>
          sum + (recipes[recipeId].outputs[ware] > 0 ? modules : 0), 0);
        if (count) draft.station.targetCounts[ware] = count;
      }
      storeDraft();
      setNotice('План применён к черновику. Сохраните проект, когда будете готовы.', 'inline');
    }
  } catch (error) { handleError(error); }
});

root.addEventListener('change', async event => {
  const element = event.target;
  if (element.id === 'language-select') { changeLanguage(element.value); return; }
  if (await shipUi.handleChange(event)) return;
  try {
    if (element.id === 'import-file') {
      const file = element.files?.[0];
      if (!file) return;
      const json = await file.text();
      const imported = validateProject(JSON.parse(json));
      const currentCatalog = createCatalog(source);
      if (Object.keys(imported.station.modules).some(id => !currentCatalog.recipes[id]) ||
        Object.keys(imported.station.prices).some(id => !currentCatalog.wares[id]) ||
        Object.keys(imported.station.finalWares).some(id => !currentCatalog.wares[id]) ||
        Object.entries(imported.station.recipeChoices ?? {}).some(([ware, id]) =>
          !currentCatalog.wares[ware] || !(currentCatalog.recipes[id]?.outputs?.[ware] > 0)) ||
        imported.station.purchasedIntermediates.some(id => !currentCatalog.wares[id]) ||
        (imported.station.ownedSupplyWares ?? []).some(id => !currentCatalog.wares[id]) ||
        (imported.station.allowedRaces ?? []).some(race => !currentCatalog.moduleRaces.includes(race)) ||
        (imported.station.workforceRace !== undefined && !currentCatalog.races.includes(imported.station.workforceRace))) {
        throw new Error('JSON содержит неизвестные модули, товары или расы');
      }
      if (store.get(imported.id) && !confirm(`${tr('Заменить сохранённый проект')} «${store.get(imported.id).name}»?`)) return;
      store.importJson(json); drafts.delete(imported.id); renderProjects(); setNotice('Проект импортирован');
      return;
    }
    if (!draft) return;
    const currentCatalog = catalog();
    if (element.dataset.field === 'sunlight') draft.station.sunlight = numberInput(element.value, 'Солнечный свет') / 100;
    else if (element.dataset.field === 'availableWorkforce') draft.station.availableWorkforce = numberInput(element.value, 'Рабочие', { integer: true });
    else if (element.dataset.field === 'workforceRace') {
      draft.station.workforceRace = element.value;
      draft.station.race = element.value;
    } else if (element.dataset.field === 'autoStorageHours') draft.station.autoStorageHours = numberInput(element.value, 'Запас хранения');
    else if (element.dataset.field === 'name') {
      if (!element.value.trim()) throw new Error('Введите название станции');
      draft.name = element.value.trim();
    } else if (element.dataset.count) {
      const count = numberInput(element.value, 'Количество модулей', { integer: true });
      undoModules = null;
      if (count) draft.station.modules[element.dataset.count] = count;
      else delete draft.station.modules[element.dataset.count];
    } else if (element.dataset.targetCount) draft.station.targetCounts[element.dataset.targetCount] =
      numberInput(element.value, 'Модули конечного товара', { integer: true, positive: true });
    else if (element.dataset.recipeChoice) {
      const ware = element.dataset.recipeChoice;
      draft.station.recipeChoices ??= {};
      if (element.value) draft.station.recipeChoices[ware] = element.value;
      else delete draft.station.recipeChoices[ware];
    }
    else if (element.dataset.intermediate) {
      const ware = element.dataset.intermediate;
      const chosen = new Set(draft.station.purchasedIntermediates);
      if (element.checked) chosen.add(ware); else chosen.delete(ware);
      draft.station.purchasedIntermediates = [...chosen];
    } else if (element.dataset.ownedSupply) {
      const chosen = new Set(draft.station.ownedSupplyWares ?? []);
      if (element.checked) chosen.add(element.dataset.ownedSupply); else chosen.delete(element.dataset.ownedSupply);
      draft.station.ownedSupplyWares = [...chosen];
    } else if (element.dataset.ownedSupplyAll !== undefined) {
      const chosen = new Set(draft.station.ownedSupplyWares ?? []);
      for (const input of root.querySelectorAll('[data-owned-supply]')) {
        if (element.checked) chosen.add(input.dataset.ownedSupply);
        else chosen.delete(input.dataset.ownedSupply);
      }
      draft.station.ownedSupplyWares = [...chosen];
    } else if (element.dataset.allowedRace) {
      const chosen = new Set(draft.station.allowedRaces ?? currentCatalog.moduleRaces);
      if (element.checked) chosen.add(element.dataset.allowedRace); else chosen.delete(element.dataset.allowedRace);
      draft.station.allowedRaces = [...chosen];
    } else if (element.dataset.toggle) {
      draft.station[element.dataset.toggle] = element.checked;
    } else if (element.dataset.price) draft.station.prices[element.dataset.price] = numberInput(element.value, 'Цена');
    else return;
    storeDraft(element.type !== 'checkbox' && element.tagName !== 'SELECT');
  } catch (error) { handleError(error); if (routeId() && draft) renderCalculator(); }
});

root.addEventListener('input', event => {
  if (event.target.id === 'module-picker') {
    modulePicker = { query: event.target.value, selectedId: '', open: true, activeIndex: -1 };
    renderModuleSuggestions();
  }
  if (event.target.id === 'ware-search') {
    const query = event.target.value.trim().toLowerCase();
    for (const row of root.querySelectorAll('[data-ware-row]')) row.hidden = !row.dataset.search.includes(query);
  }
});

root.addEventListener('focusin', event => {
  if (event.target.id === 'module-picker') {
    modulePicker.open = true;
    renderModuleSuggestions();
  }
});
root.addEventListener('keydown', event => {
  if (event.target.id !== 'module-picker') return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeModuleSuggestions();
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    modulePicker.open = true;
    const count = matchingModules().length;
    if (count) modulePicker.activeIndex = event.key === 'ArrowDown' ?
      (modulePicker.activeIndex + 1) % count : (modulePicker.activeIndex + count - 1) % count;
    renderModuleSuggestions();
  } else if (event.key === 'Enter' && modulePicker.open && modulePicker.activeIndex >= 0) {
    event.preventDefault();
    const choice = matchingModules()[modulePicker.activeIndex];
    if (choice) chooseModule(choice.id);
  }
});
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('.module-picker')) closeModuleSuggestions();
});

root.addEventListener('submit', event => {
  if (shipUi.handleSubmit(event)) return;
  if (event.target.id !== 'create-form') return;
  event.preventDefault();
  const name = document.getElementById('project-name').value.trim();
  if (!name) return;
  const id = globalThis.crypto?.randomUUID?.() ?? `station-${Date.now()}`;
  const project = { id, name, station: defaults(), updatedAt: new Date().toISOString() };
  store.save(project);
  document.getElementById('create-dialog').close();
  navigate(`#calculator/${encodeURIComponent(id)}`);
});

window.addEventListener('hashchange', renderRoute);
if (!location.hash) history.replaceState({ x4Route: true }, '', '#projects');
else if (routeId() && store.get(routeId()) && !history.state?.x4Route) {
  const calculatorHash = location.hash;
  history.replaceState({ x4Route: true }, '', '#projects');
  history.pushState({ x4Route: true }, '', calculatorHash);
}
else if (/^#ship\/[^/?]+$/.test(location.hash) && !history.state?.x4Route) {
  const shipHash = location.hash;
  history.replaceState({ x4Route: true }, '', '#ships');
  history.pushState({ x4Route: true }, '', shipHash);
}
renderRoute();
