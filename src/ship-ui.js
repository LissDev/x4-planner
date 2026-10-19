import { compatibleEquipment, calculateShip, compareShipBuilds } from './ship-engine.js';
import { createShipStore } from './ship-store.js';
import { localizedName } from './i18n.js';
import { shipText, shipDiagnostic } from './ship-i18n.js';
import { estimateIsCombat } from './is-combat.js';

export function createShipUi({ root, navigate, globalHeader, escapeHtml, format, locale = () => 'en' }) {
  const catalog = globalThis.X4_SHIP_DATA;
  const store = catalog ? createShipStore(localStorage, catalog) : null;
  const drafts = new Map();
  const editorViews = new Map();
  const equipmentTabs = [
    { id: 'engines', name: 'Двигатели и управление' }, { id: 'shields', name: 'Щиты' },
    { id: 'guns', name: 'Орудия' }, { id: 'turrets', name: 'Турели' },
    { id: 'missiles', name: 'Ракеты' },
  ];
  const raceNames = { argon: 'Аргон', boron: 'Борон', paranid: 'Параниды',
    split: 'Сплиты', teladi: 'Телади', terran: 'Земляне', universal: 'Универсальное',
    xenon: 'Ксеноны' };
  const estimateDefaults = () => ({ targetSize: 'm' });
  const comparisonDefaults = () => ({ leftId: '', rightId: '', ...estimateDefaults() });
  let comparison = comparisonDefaults();
  let notice = '';
  let lastRenderedRoute = '';
  const esc = escapeHtml;
  const models = () => catalog?.ships ?? [];
  const equipment = () => catalog?.equipment ?? [];
  const model = id => models().find(ship => ship.id === id);
  const equipmentItem = id => equipment().find(item => item.id === id);
  const t = text => shipText(text, locale());
  const name = record => record ? (localizedName(record, locale()) ?? record.name ?? record.id) : '';
  const label = value => value == null ? t('Нет данных') : format(value);
  const credits = value => value == null ? t('Нет данных') : `${format(value)} ${t('кр.')}`;
  const routeId = () => /^#ship\/([^/?]+)$/.exec(location.hash)?.[1];
  const currentId = () => routeId() && decodeURIComponent(routeId());

  function message(value) {
    notice = value;
    const region = root.querySelector('#ship-notice');
    if (region) { region.textContent = value; region.hidden = !value; }
  }
  function frame(content) {
    root.innerHTML = `<div class="shell">${globalHeader()}${content}
      <div id="ship-notice" class="toast" role="status" ${notice ? '' : 'hidden'}>${esc(notice)}</div></div>`;
    root.querySelector('h1')?.focus();
  }
  function availableModels() {
    return [...models()].sort((a, b) => {
      const count = ship => (ship.slotGroups ?? []).filter(group => group.type === 'engine')
        .reduce((max, group) => Math.max(max, compatibleEquipment({ shipId: ship.id, groupId: group.id, catalog }).length), 0);
      return (count(b) >= 2) - (count(a) >= 2) || name(a).localeCompare(name(b), locale());
    });
  }
  function buildCard(build) {
    const ship = model(build.shipId);
    return `<article class="project-card"><div class="project-icon" aria-hidden="true">✧</div>
      <div class="project-content"><h3>${esc(build.name)}</h3><p>${esc(ship ? name(ship) : build.shipId)}</p></div>
      <div class="project-actions"><a class="button button-primary" href="#ship/${encodeURIComponent(build.id)}">${t('Открыть')}</a>
      <button class="icon-button" type="button" data-ship-action="export" data-id="${esc(build.id)}" aria-label="${t('Экспортировать')} ${esc(build.name)}">⇩</button>
      <button class="icon-button danger" type="button" data-ship-action="delete" data-id="${esc(build.id)}" aria-label="${t('Удалить')} ${esc(build.name)}">×</button></div></article>`;
  }
  function renderList() {
    const builds = store?.list() ?? [];
    frame(`<main class="projects-page"><div class="eyebrow">${t('ЛОКАЛЬНЫЙ ЦЕНТР СБОРОК')} <span class="eyebrow-line"></span></div>
      <div class="page-heading"><div><h1 tabindex="-1">${t('Корабли')}<span class="accent">.</span></h1>
        <p>${t('Соберите корабль вручную, сохраните вариант и сравните его с другим.')}</p></div>
        <button class="button button-primary large" data-ship-action="create">＋ ${t('Создать сборку')}</button></div>
      <div class="section-heading"><h2>${t('Сохранённые сборки')} <span class="count-pill">${builds.length}</span></h2>
        <div class="heading-actions"><a class="button button-secondary" href="#ship-compare">${t('Сравнить сборки')}</a>
        <button class="button button-quiet" data-ship-action="import">${t('Импорт JSON')}</button></div></div>
      <div class="project-list">${builds.length ? builds.map(buildCard).join('') :
        `<div class="empty-state"><div class="empty-symbol">✧</div><h3>${t('Сборок пока нет')}</h3><p>${t('Выберите модель и установите оборудование по слотам.')}</p></div>`}</div>
      <footer class="page-footer">${t('Сборки сохраняются в этом браузере. JSON можно экспортировать для резервной копии.')}</footer>
      <input id="ship-import-file" type="file" accept=".json,application/json" hidden>
      <dialog id="ship-create-dialog" class="modal"><form method="dialog" id="ship-create-form">
        <div class="modal-kicker">${t('НОВАЯ СБОРКА')}</div><h2>${t('Выберите корабль')}</h2>
        <label for="ship-name">${t('Название сборки')}</label><input id="ship-name" required maxlength="80">
        <label for="ship-model">${t('Модель корабля')}</label><select id="ship-model" required>
          <option value="">${t('Выберите модель')}</option>${availableModels().map(ship =>
            `<option value="${esc(ship.id)}">${esc(name(ship))}</option>`).join('')}</select>
        <div class="modal-actions"><button class="button button-quiet" type="button" data-ship-action="cancel-create">${t('Отмена')}</button>
          <button class="button button-primary" type="submit">${t('Создать')}</button></div></form></dialog></main>`);
  }
  function groupName(group) {
    return t(({ engine: 'Двигатель', shield: 'Щит', weapon: 'Орудие', turret: 'Турель',
      missile: 'Ракеты', thruster: 'Боковой двигатель' })[group.type] ?? group.type);
  }
  function groupTab(group) {
    return ({ engine: 'engines', thruster: 'engines', shield: 'shields', weapon: 'guns',
      turret: 'turrets', missile: 'missiles' })[group.type];
  }
  function groupControls(build, ship, tab, race) {
    return (ship.slotGroups ?? []).filter(group => groupTab(group) === tab).map(group => {
      const compatible = compatibleEquipment({ shipId: ship.id, groupId: group.id, catalog });
      const choices = (race ? compatible.filter(item => item.race === race) : compatible)
        .sort((a, b) => name(a).localeCompare(name(b), locale()));
      return Array.from({ length: group.count }, (_, index) => {
        const selected = build.loadout[group.id]?.[index] ?? '';
        const title = group.count > 1 ? `${groupName(group)} ${index + 1}` : groupName(group);
        const mounted = selected && !choices.some(item => item.id === selected) ?
          compatible.find(item => item.id === selected) : null;
        return `<label>${esc(title)}<select data-ship-group="${esc(group.id)}" data-slot-index="${index}" aria-label="${esc(title)}">
          <option value="">${t('Не установлено')}</option>${choices.map(item =>
            `<option value="${esc(item.id)}" ${item.id === selected ? 'selected' : ''}>${esc(name(item))}</option>`).join('')}
          ${mounted ? `<option value="${esc(mounted.id)}" selected>${esc(name(mounted))} — ${t('установлено (вне фильтра)')}</option>` : ''}</select>
          ${compatible.length ? '' : `<small>${t('Нет доступного игроку оборудования для этого слота')}</small>`}</label>`;
      }).join('');
    }).join('');
  }
  function equipmentPanel(build, ship, view) {
    const tab = equipmentTabs.find(item => item.id === view.tab);
    const races = new Set((ship.slotGroups ?? []).filter(group => groupTab(group) === view.tab)
      .flatMap(group => compatibleEquipment({ shipId: ship.id, groupId: group.id, catalog }))
      .map(item => item.race).filter(Boolean));
    const race = view.races[view.tab] ?? '';
    return `<div class="ship-tablist" role="tablist" aria-label="${t('Оборудование')}">${equipmentTabs.map(item =>
      `<button type="button" role="tab" id="ship-tab-${item.id}" data-ship-tab="${item.id}"
        aria-controls="ship-equipment-panel" aria-selected="${item.id === view.tab}" tabindex="${item.id === view.tab ? '0' : '-1'}">${t(item.name)}</button>`).join('')}</div>
      <div id="ship-equipment-panel" role="tabpanel" aria-labelledby="ship-tab-${tab.id}" class="ship-tabpanel">
        <label>${t('Раса оборудования')}: ${t(tab.name)}<select data-ship-race="${tab.id}" aria-label="${t('Раса оборудования')}: ${t(tab.name)}">
          <option value="">${t('Все расы')}</option>${[...races].sort((a, b) => t(raceNames[a] ?? a).localeCompare(t(raceNames[b] ?? b), locale())).map(id =>
            `<option value="${esc(id)}" ${id === race ? 'selected' : ''}>${esc(t(raceNames[id] ?? id))}</option>`).join('')}</select></label>
        <div class="ship-fields">${groupControls(build, ship, tab.id, race)}
          ${tab.id === 'missiles' ? ammoControls(build) : ''}</div></div>`;
  }
  function ammoControls(build) {
    return equipment().filter(item => allowedAmmoIds(build).has(item.id))
      .sort((a, b) => name(a).localeCompare(name(b), locale()))
      .map(item => `<label>${t('Боезапас')}: ${esc(name(item))}<input type="number" min="0" step="1"
        value="${build.ammo[item.id] ?? 0}" data-ship-ammo="${esc(item.id)}"></label>`).join('');
  }
  function allowedAmmoIds(build) {
    const selectedIds = new Set(Object.values(build.loadout).flat());
    return new Set(equipment().filter(item => selectedIds.has(item.id))
      .flatMap(item => item.kind === 'missile' ? [item.id] : item.compatibleAmmoIds ?? []));
  }
  function priceControls(build, ship) {
    const selectedIds = new Set(Object.values(build.loadout).flat());
    const priced = [ship, ...equipment().filter(item => selectedIds.has(item.id) || build.ammo[item.id] > 0)];
    return priced.map(item => `<label>${t('Цена')}: ${esc(name(item))}<input type="number" min="0" step="any"
      value="${build.prices[item.id] ?? item.priceAverage ?? ''}" placeholder="${t('Нет данных')}" data-ship-price="${esc(item.id)}"></label>`).join('');
  }
  function metric(title, value, note = '') {
    return `<div class="metric"><span>${title}</span><strong>${label(value)}</strong><small>${note}</small></div>`;
  }
  function partialLabel(value, unknown) {
    return `${label(value)}${unknown ? ` · ${t(value === null ? 'неизвестно' : 'частично')}, ${t('неизвестных вкладов')}: ${format(unknown)}` : ''}`;
  }
  function damageLabel(stats, phase, mode) {
    return partialLabel(stats.damage[phase][mode], stats.damageUnknown[phase][mode]);
  }
  const oosCoefficients = [
    ['hitchance', 'Исходный коэффициент попадания', 0.9],
    ['turretfactor', 'Коэффициент турелей', 0.8],
    ['bullethitfactor', 'Коэффициент попаданий снарядов', 0.7],
    ['beamhitfactor', 'Коэффициент попаданий лучей', 0.9],
    ['flakhitfactor', 'Коэффициент попаданий зенитных орудий', 0.9],
    ['missileweaponfactor', 'Коэффициент ракетного вооружения', 0.9],
    ['laserweaponfactor', 'Коэффициент лазерного вооружения', 1],
    ['missmultiplier', 'Множитель промаха', 1],
  ];
  function oosFacts() {
    return `<div class="ship-values">${oosCoefficients.map(([id, caption, value]) =>
      `<div><span>${t(caption)} <small><code>${id}</code></small></span><strong>${format(value, { minimumFractionDigits: 1 })}</strong></div>`).join('')}</div>
      <p class="ship-oos-note">${t('Коэффициенты из X4 9.0')} <code>libraries/parameters.xml</code> ${t('— входные параметры боя вне сектора, не итоговая вероятность попадания и не готовая формула урона. Скрипты вызывают нативные')} <code>get_attackstrength</code> ${t('и')} <code>apply_attackstrength</code>${t('; их точное разрешение урона не представлено в доступных игровых данных. Сила атаки выражена за секунду, но частота попыток зависит от боевого скрипта, поэтому точный урон за тик и точное время уничтожения по этим значениям не вычисляются.')} ${t('hitchance=0.9 — исходный коэффициент, а не 90% итоговой вероятности попадания. Скорость и размер цели влияют на нативный расчёт, но проверенная формула их применения недоступна.')}</p>`;
  }
  function missileRows(stats) {
    return stats.missileDamage.map(entry => {
      const item = equipmentItem(entry.id);
      return `<div class="ship-missile-name">${esc(item ? name(item) : entry.id)} · ${format(entry.quantity)} ${t('шт.')} · ${t('пусковых')}: ${format(entry.launchers)}</div>
        <div>${t('Одно попадание · щит / корпус')} <strong>${label(entry.perHit.shield)} / ${label(entry.perHit.hull)}</strong></div>
        <div>${t('Одновременный залп · щит / корпус')} <strong>${label(entry.launcherSalvo.shield)} / ${label(entry.launcherSalvo.hull)}</strong></div>
        <div>${t('Весь боезапас · щит / корпус')} <strong>${label(entry.stockPotential.shield)} / ${label(entry.stockPotential.hull)}</strong></div>`;
    }).join('');
  }
  function handlingRows(build, ship) {
    const thrusterId = build.loadout['thruster:virtual']?.[0];
    const thrust = equipmentItem(thrusterId)?.stats?.thrust;
    return `<div>${t('Боковая тяга')} <strong>${label(thrust?.strafe)}</strong></div>
      <div>${t('Тяга тангажа')} <strong>${label(thrust?.pitch)}</strong></div>
      <div>${t('Тяга рыскания')} <strong>${label(thrust?.yaw)}</strong></div>
      <div>${t('Тяга крена')} <strong>${label(thrust?.roll)}</strong></div>
      <div>${t('Сопротивление рысканию')} <strong>${label(ship.drag?.yaw)}</strong></div>
      <div>${t('Инерция рыскания')} <strong>${label(ship.inertia?.yaw)}</strong></div>`;
  }
  const estimateAssumptions = state => ({ targetSize: state.targetSize });
  const sizeOptions = selected => ['s', 'm', 'l', 'xl'].map(size =>
    `<option value="${size}" ${size === selected ? 'selected' : ''}>${size.toUpperCase()}</option>`).join('');
  function effectiveLabel(summary) {
    const value = summary.rate === null ? t('Нет данных') : `${label(summary.rate)} ${t('ед./с')}`;
    const fraction = summary.fraction === null ? t('доля неизвестна') :
      `${format(summary.fraction * 100)}% ${t('от известного исходного DPS')}`;
    return `${value} · ${fraction}${summary.unknown ? ` · ${t('частично')}, ${t('неизвестных вкладов')}: ${format(summary.unknown)}` : ''}`;
  }
  function oosModelNotes() {
    const classes = [
      ['S', '0.65', '0.90', '0.85'], ['M', '0.80', '0.95', '0.90'],
      ['L', '0.95', '1.00', '1.00'], ['XL', '1.00', '1.00', '1.00'],
    ];
    return `<p class="table-footnote">${t('Модель приложения: 0.9 × коэффициент семейства (обычный снаряд 0.7, прикреплённый луч 0.9, урон по площади 0.9) × 0.8 для турели × коэффициент размера цели. Семейство определяется по свойствам установленного снаряда: урон по площади, иначе attach=1, иначе обычный снаряд. Отнесение урона по площади к зенитному типу — допущение приложения, не подтверждённая нативная формула. Коэффициенты размера ниже заданы приложением, а не извлечены из игры.')}</p>
      <div class="table-wrap"><table><thead><tr><th>${t('Размер цели')}</th><th>${t('Обычный снаряд')}</th><th>${t('Прикреплённый луч')}</th><th>${t('Урон по площади')}</th></tr></thead><tbody>
      ${classes.map(([size, bullet, beam, area]) => `<tr><th scope="row">${size}</th><td>${bullet}</td><td>${beam}</td><td>${area}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function windowLabel(window) {
    return `${label(window.value)}${window.unknown ? ` · ${t(window.value === null ? 'неизвестно' : 'частично')}, ${t('неизвестных вкладов')}: ${format(window.unknown)}` : ''}`;
  }
  function windowTable(entries) {
    return `<div class="table-wrap"><table class="ship-oos-windows"><thead><tr><th>${t('Окно')}</th>${entries.map(entry =>
      `<th>${esc(entry.name)} · ${t('Щит')}</th><th>${esc(entry.name)} · ${t('Корпус')}</th>`).join('')}</tr></thead><tbody>${[1, 10, 30].map(seconds =>
      `<tr><th scope="row">${seconds} ${t('с')}</th>${entries.map(entry =>
        `<td>${windowLabel(entry.windows.shield[seconds])}</td><td>${windowLabel(entry.windows.hull[seconds])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  const isReasons = {
    'missing-rate': 'Нет проверенной частоты выстрелов',
    'missing-lifetime': 'Нет длительности луча',
    'invalid-count': 'Некорректное число снарядов или стволов',
    'invalid-charge': 'Некорректное время зарядки',
    'unsupported-projectile': 'Неподдерживаемый цикл снаряда',
    'missing-damage': 'Нет однозначного урона снаряда',
    'invalid-magazine': 'Нет однозначных данных магазина',
    'missing-heat': 'Нет необходимых данных нагрева',
    'incomplete-heat': 'Неполные данные теплового цикла',
    'cycle-unproven': 'Повторяющийся цикл не установлен',
  };
  function isCombatSection(entries, id = '') {
    const windowRows = [10, 30, 60].map(seconds =>
      `<tr><th scope="row">${seconds} ${t('с')}</th>${entries.map(entry =>
        `<td>${partialLabel(entry.estimate.shield.damage[seconds], entry.estimate.shield.unknown)}</td>
         <td>${partialLabel(entry.estimate.hull.damage[seconds], entry.estimate.hull.unknown)}</td>`).join('')}</tr>`).join('');
    return `<section ${id ? `id="${id}"` : ''} class="panel ship-is-combat">
      <div class="panel-head"><h2>${t('Бой в секторе · непрерывный огонь')}</h2></div>
      <p class="table-footnote">${t('Условная модель приложения: обычный выстрел происходит в момент 0, заряд задерживает первый выстрел, а луч действует непрерывно в течение указанной длительности. Все снаряды и полный урон по площади попадают в одну цель; тепловые циклы орудий независимы. Для турелей без данных нагрева учитываются только частота и перезарядка магазина. Группировка стволов, единицы урона луча и перекрытие его перезарядки не проверены по нативной формуле. Взаимное влияние нагрева и coolingpenalty не моделируются.')}</p>
      <div class="ship-values">${entries.map(entry =>
        `<div>${esc(entry.name)} · ${t('Щит · средний урон/с')} <strong>${partialLabel(entry.estimate.shield.steadyDps, entry.estimate.shield.unknown)}</strong></div>
         <div>${esc(entry.name)} · ${t('Корпус · средний урон/с')} <strong>${partialLabel(entry.estimate.hull.steadyDps, entry.estimate.hull.unknown)}</strong></div>`).join('')}</div>
      <div class="table-wrap"><table class="ship-is-windows"><thead><tr><th>${t('Окно')}</th>${entries.map(entry =>
        `<th>${esc(entry.name)} · ${t('Щит')}</th><th>${esc(entry.name)} · ${t('Корпус')}</th>`).join('')}</tr></thead>
        <tbody>${windowRows}</tbody></table></div>
      ${entries.map(entry => `<h3 class="ship-oos-heading">${esc(entry.name)} · ${t('Установленные орудия')}</h3>
        <div class="table-wrap"><table class="ship-is-mounts"><thead><tr><th>${t('Орудие')}</th><th>${t('Статус')}</th>
          <th>${t('Первый перегрев')}</th><th>${t('Пауза охлаждения')}</th></tr></thead><tbody>
          ${entry.estimate.mounts.length ? entry.estimate.mounts.map(mount =>
            `<tr><th scope="row">${esc(name(equipmentItem(mount.id)))} · ${esc(mount.groupId)} #${mount.slotIndex + 1}</th>
              <td>${mount.status === 'known' ? t('Рассчитано') : `${t('Неизвестно')}: ${t(isReasons[mount.reason])}`}</td>
              <td>${mount.firstOverheat === null ? '—' : `${label(mount.firstOverheat)} ${t('с')}`}</td>
              <td>${mount.coolingPause === null ? '—' : `${label(mount.coolingPause)} ${t('с')}`}</td></tr>`).join('') :
            `<tr><td colspan="4">${t('Нет установленных орудий непрерывного огня')}</td></tr>`}</tbody></table></div>`).join('')}
      <p class="table-footnote">${t('Окна считают попадания и активное время луча в [0,T); средний урон получен из повторяющегося цикла, а не из окна 60 секунд. Неизвестные орудия не приравниваются к нулю. Ракеты и конечный боезапас показаны отдельно и не становятся постоянным уроном.')}</p>
    </section>`;
  }
  function renderEditor(id) {
    const saved = store?.get(id);
    if (!saved) { history.replaceState({ x4Route: true }, '', '#ships'); renderList(); return; }
    const build = drafts.get(id) ?? saved;
    drafts.set(id, build);
    const view = editorViews.get(id) ?? { tab: 'engines', races: {}, oos: estimateDefaults() };
    editorViews.set(id, view);
    const ship = model(build.shipId);
    const stats = calculateShip({ build, catalog, hitEfficiency: 1 });
    const estimate = compareShipBuilds({ left: build, right: build,
      catalog, combatAssumptions: estimateAssumptions(view.oos) }).left;
    const isEstimate = estimateIsCombat(build, catalog);
    frame(`<main class="calculator-page ship-page"><nav class="breadcrumb" aria-label="${t('Корабли')}"><a href="#ships">← ${t('Корабли')}</a>
      <span>/</span><span>${esc(build.name)}</span></nav>
      <div class="calc-heading"><div><div class="eyebrow">${t('КОНСТРУКТОР КОРАБЛЯ')}</div>
        <h1 tabindex="-1">${esc(build.name)}</h1><p>${esc(name(ship))} · ${t('оборудование выбирается вручную')}</p></div>
        <div class="heading-actions"><a class="button button-secondary" href="#ship-compare">${t('Сравнить сборки')}</a>
          <button class="button button-primary" data-ship-action="save">${t('Сохранить сборку')}</button></div></div>
      <div class="metrics">${metric(t('КОРПУС'), stats.hull)}${metric(t('ЩИТ'), stats.shieldCapacity)}
        <div class="metric"><span>${t('СТОИМОСТЬ')}</span><strong>${credits(stats.totalPrice)}</strong><small>${t('Средние или заданные цены')}</small></div>
        ${metric(t('СКОРОСТЬ'), stats.performance.topSpeed, t('Расчёт из тяги и сопротивления'))}</div>
      <div class="workspace-grid"><div class="controls-column">
        <section class="panel"><div class="panel-head"><h2>${t('Оборудование')}</h2></div>
          <div class="ship-fields"><label>${t('Название сборки')}<input type="text" maxlength="80" value="${esc(build.name)}" data-ship-name></label></div>
          ${equipmentPanel(build, ship, view)}</section>
        <section class="panel"><div class="panel-head"><h2>${t('Цены')}</h2></div>
          <div class="ship-fields">${priceControls(build, ship)}</div></section></div>
      <div class="results-column"><section class="panel"><div class="panel-head"><h2>${t('Параметры полёта')}</h2></div>
        <div class="ship-values"><div>${t('Ускорение')} <strong>${label(stats.performance.acceleration)}</strong></div>
          <div><span>${t('Крейсерская скорость')}</span> <strong>${label(stats.performance.travelSpeed)}</strong></div>
          ${handlingRows(build, ship)}</div><p class="table-footnote">${t('Тяга, сопротивление и инерция — исходные параметры управляемости. Точная скорость поворота не рассчитывается.')}</p></section>
        <section class="panel"><div class="panel-head"><h2>${t('Урон установленного вооружения')}</h2></div>
          <div class="ship-values"><div>${t('Щит · номинальный пик')} <strong>${damageLabel(stats, 'shield', 'burst')}</strong></div>
          <div>${t('Корпус · номинальный пик')} <strong>${damageLabel(stats, 'hull', 'burst')}</strong></div>
          ${missileRows(stats)}
          <div>${t('Ракеты · весь боезапас по щиту')} <strong>${partialLabel(stats.missileSalvo.shield, stats.missileSalvoUnknown.shield)}</strong></div>
          <div>${t('Ракеты · весь боезапас по корпусу')} <strong>${partialLabel(stats.missileSalvo.hull, stats.missileSalvoUnknown.hull)}</strong></div></div>
          <p class="table-footnote">${stats.damageAssumptionLabel ? `${esc(t(stats.damageAssumptionLabel))}. ` : ''}${t('Номинальная оценка использует полный исходный урон по одной цели, число снарядов и стволов (при пропуске — один), без расстояния, перегрева, магазина и задержек между снарядами. Группировка стволов не проверена по нативной формуле. Урон луча принят за урон в секунду во время его действия; это допущение приложения. Ракетный запас конечен и показан отдельно. При нехватке данных вклад остаётся неизвестным.')}</p></section>
        <section class="panel"><div class="panel-head"><h2>${t('Бой вне сектора · OOS')}</h2></div>
          <div class="ship-compare-fields">
            <label>${t('Размер цели')}<select data-editor-oos="targetSize">${sizeOptions(view.oos.targetSize)}</select></label></div>
          <div class="ship-values"><div>${t('Эффективный урон по щиту · известная часть')} <strong>${effectiveLabel(estimate.oosEffective.shield)}</strong></div>
            <div>${t('Эффективный урон по корпусу · известная часть')} <strong>${effectiveLabel(estimate.oosEffective.hull)}</strong></div></div>
          <h3 class="ship-oos-heading">${t('Условный урон за 1, 10 и 30 секунд')}</h3>${windowTable([{ name: t('Сборка'), windows: estimate.oosWindows }])}
          <p class="table-footnote">${t('Окна показывают одно условное значение потенциального урона по щиту и корпусу отдельно, без ограничения здоровьем цели. Оценка точности автоматически зависит от установленных орудий и класса цели. Ракеты и конечный боезапас не превращаются в повторяющийся урон. Номинальная оценка не учитывает перегрев.')}</p>
          ${oosModelNotes()}
          ${oosFacts()}</section>
          ${isCombatSection([{ name: t('Сборка'), estimate: isEstimate }], 'is-combat')}</div></div>
      <footer class="page-footer">${t('Черновик хранится до закрытия вкладки. Сохраните сборку для восстановления после перезагрузки.')}</footer></main>`);
  }
  function compareOptions(selected) {
    return `<option value="">${t('Выберите сборку')}</option>${store.list().map(build =>
      `<option value="${esc(build.id)}" ${build.id === selected ? 'selected' : ''}>${esc(build.name)}</option>`).join('')}`;
  }
  function restoreComparison() {
    const query = location.hash.split('?')[1];
    if (!query) return;
    const params = new URLSearchParams(query);
    for (const field of ['leftId', 'rightId']) {
      const id = params.get(field);
      comparison[field] = id && store.get(id) ? id : '';
    }
    const size = params.get('targetSize');
    if (['s', 'm', 'l', 'xl'].includes(size)) comparison.targetSize = size;
    saveComparisonUrl();
  }
  function saveComparisonUrl() {
    const params = new URLSearchParams({
      leftId: comparison.leftId, rightId: comparison.rightId,
      targetSize: comparison.targetSize,
    });
    history.replaceState({ ...history.state, x4Route: true }, '', `#ship-compare?${params}`);
  }
  function compareRow(name, left, right) {
    return `<tr><th scope="row">${name}</th><td>${label(left)}</td><td>${label(right)}</td></tr>`;
  }
  function compareResults() {
    const left = drafts.get(comparison.leftId) ?? store.get(comparison.leftId);
    const right = drafts.get(comparison.rightId) ?? store.get(comparison.rightId);
    if (!left || !right) return `<p class="muted">${t('Выберите две сборки для сравнения.')}</p>`;
    const result = compareShipBuilds({ left, right, catalog,
      combatAssumptions: estimateAssumptions(comparison) });
    return `<div class="table-wrap"><table><thead><tr><th>${t('Показатель')}</th><th>${esc(left.name)}</th><th>${esc(right.name)}</th></tr></thead><tbody>
      ${compareRow(t('Корпус'), result.left.hull, result.right.hull)}
      ${compareRow(t('Щит'), result.left.shieldCapacity, result.right.shieldCapacity)}
      ${compareRow(t('Цена'), result.left.totalPrice, result.right.totalPrice)}
      ${compareRow(t('Скорость'), result.left.performance.topSpeed, result.right.performance.topSpeed)}
      ${compareRow(t('Крейсерская скорость'), result.left.performance.travelSpeed, result.right.performance.travelSpeed)}
      <tr><th scope="row">${t('Урон по щиту · номинальный')}</th><td>${damageLabel(result.left, 'shield', 'burst')}</td><td>${damageLabel(result.right, 'shield', 'burst')}</td></tr>
      <tr><th scope="row">${t('Урон по корпусу · номинальный')}</th><td>${damageLabel(result.left, 'hull', 'burst')}</td><td>${damageLabel(result.right, 'hull', 'burst')}</td></tr>
      <tr><th scope="row">${t('Эффективный урон по щиту · известная часть')}</th><td>${effectiveLabel(result.left.oosEffective.shield)}</td><td>${effectiveLabel(result.right.oosEffective.shield)}</td></tr>
      <tr><th scope="row">${t('Эффективный урон по корпусу · известная часть')}</th><td>${effectiveLabel(result.left.oosEffective.hull)}</td><td>${effectiveLabel(result.right.oosEffective.hull)}</td></tr></tbody></table></div>
      <h3 class="ship-oos-heading">${t('Условный урон за 1, 10 и 30 секунд')}</h3>
      ${windowTable([{ name: left.name, windows: result.left.oosWindows }, { name: right.name, windows: result.right.oosWindows }])}
      <p class="table-footnote">${t(result.damageBasisLabel)}. ${t(result.oosLabel)}. ${t('Размер цели и установленное вооружение определяют условную долю попаданий; коэффициенты размера заданы приложением. Оценка основана на номинальном уроне без учёта перегрева; группировка стволов не проверена по нативной формуле. Это не нативная формула OOS; конечный боезапас не моделируется как непрерывный урон.')}</p>
      ${oosModelNotes()}`;
  }
  function renderCompare() {
    frame(`<main class="calculator-page ship-page"><nav class="breadcrumb" aria-label="${t('Корабли')}"><a href="#ships">← ${t('Корабли')}</a></nav>
      <div class="calc-heading"><div><div class="eyebrow">${t('СРАВНЕНИЕ')}</div><h1 tabindex="-1">${t('Сравнить сборки')}</h1>
        <p>${t('Общая цель и предположения применяются к обеим сборкам.')}</p></div></div>
      <section class="panel"><div class="ship-compare-fields">
        <label>${t('Сборка слева')}<select data-compare="leftId">${compareOptions(comparison.leftId)}</select></label>
        <label>${t('Сборка справа')}<select data-compare="rightId">${compareOptions(comparison.rightId)}</select></label>
        <label>${t('Размер цели')}<select data-compare="targetSize">${sizeOptions(comparison.targetSize)}</select></label></div></section>
      <section class="panel ship-comparison-results"><div class="panel-head"><h2>${t('Результаты')}</h2></div>${compareResults()}${oosFacts()}</section>
      ${comparison.leftId && comparison.rightId ? isCombatSection([
        { name: drafts.get(comparison.leftId)?.name ?? store.get(comparison.leftId)?.name ?? '',
          estimate: estimateIsCombat(drafts.get(comparison.leftId) ?? store.get(comparison.leftId), catalog) },
        { name: drafts.get(comparison.rightId)?.name ?? store.get(comparison.rightId)?.name ?? '',
          estimate: estimateIsCombat(drafts.get(comparison.rightId) ?? store.get(comparison.rightId), catalog) },
      ]) : ''}</main>`);
  }
  function download(id) {
    const build = store.get(id);
    if (!build) throw new Error('Сборка не найдена');
    const url = URL.createObjectURL(new Blob([JSON.stringify(build, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${build.name.replace(/[\\/:*?"<>|]/g, '_')}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function renderRoute() {
    notice = '';
    if (!store) { frame(`<main class="fatal"><h1>${t('Данные кораблей недоступны')}</h1><p>${t('Поместите ship-data.js рядом с index.html.')}</p></main>`); return; }
    const route = location.hash.startsWith('#ship-compare') ? '#ship-compare' : location.hash;
    if (location.hash === '#ships') renderList();
    else if (location.hash.startsWith('#ship-compare')) {
      if (lastRenderedRoute !== '#ship-compare') {
        comparison = comparisonDefaults();
        restoreComparison();
      }
      renderCompare();
    }
    else if (currentId()) renderEditor(currentId());
    lastRenderedRoute = route;
  }
  function handles(hash) { return hash === '#ships' || hash.startsWith('#ship-compare') || /^#ship\//.test(hash); }

  function handleClick(event) {
    const link = event.target.closest('a[href^="#ship"]');
    if (link) { event.preventDefault(); navigate(link.getAttribute('href')); return true; }
    const tab = event.target.closest('[data-ship-tab]');
    if (tab && currentId()) {
      editorViews.get(currentId()).tab = tab.dataset.shipTab;
      renderEditor(currentId());
      root.querySelector(`#ship-tab-${tab.dataset.shipTab}`)?.focus();
      return true;
    }
    const button = event.target.closest('[data-ship-action]');
    if (!button) return false;
    const id = button.dataset.id;
    try {
      switch (button.dataset.shipAction) {
        case 'create': root.querySelector('#ship-create-dialog').showModal(); root.querySelector('#ship-name').focus(); break;
        case 'cancel-create': root.querySelector('#ship-create-dialog').close(); break;
        case 'save': store.save(drafts.get(currentId())); message(t('Сборка сохранена')); break;
        case 'delete': {
          const build = store.get(id);
          if (build && confirm(`${t('Удалить сборку')} «${build.name}»?`)) {
            store.remove(id); drafts.delete(id); renderList(); message(t('Сборка удалена'));
          }
          break;
        }
        case 'export': download(id); break;
        case 'import': root.querySelector('#ship-import-file').click(); break;
      }
    } catch (error) { message(shipDiagnostic(error.message, locale())); }
    return true;
  }
  async function handleChange(event) {
    const element = event.target;
    if (element.id === 'ship-import-file') {
      try {
        const file = element.files?.[0];
        if (!file) return true;
        const json = await file.text();
        const incoming = JSON.parse(json);
        if (store.get(incoming.id) && !confirm(`${t('Заменить сборку')} «${store.get(incoming.id).name}»?`)) return true;
        store.importJson(json); drafts.delete(incoming.id); renderList(); message(t('Сборка импортирована'));
      } catch (error) { message(`${t('Ошибка импорта JSON')}: ${shipDiagnostic(error.message, locale())}`); }
      return true;
    }
    if (element.dataset.compare) {
      const field = element.dataset.compare;
      comparison[field] = element.value;
      saveComparisonUrl();
      try { renderCompare(); } catch (error) { message(shipDiagnostic(error.message, locale())); }
      return true;
    }
    if (element.dataset.editorOos && currentId()) {
      const state = editorViews.get(currentId()).oos;
      const field = element.dataset.editorOos;
      state[field] = element.value;
      try { renderEditor(currentId()); } catch (error) { message(shipDiagnostic(error.message, locale())); }
      return true;
    }
    if (element.dataset.shipRace && currentId()) {
      editorViews.get(currentId()).races[element.dataset.shipRace] = element.value;
      renderEditor(currentId());
      return true;
    }
    if (!currentId() || (!element.dataset.shipGroup && !element.dataset.shipAmmo &&
      !element.dataset.shipPrice && !element.hasAttribute('data-ship-name'))) return false;
    const build = drafts.get(currentId());
    if (!build) return false;
    try {
      if (element.dataset.shipGroup) {
        const group = model(build.shipId).slotGroups.find(item => item.id === element.dataset.shipGroup);
        const selected = Array.from({ length: group.count }, (_, index) =>
          index === Number(element.dataset.slotIndex) ? element.value : (build.loadout[group.id]?.[index] ?? ''));
        while (selected.at(-1) === '') selected.pop();
        build.loadout[group.id] = selected;
        const allowedAmmo = allowedAmmoIds(build);
        build.ammo = Object.fromEntries(Object.entries(build.ammo).filter(([id]) => allowedAmmo.has(id)));
      } else if (element.dataset.shipAmmo) {
        const value = Number(element.value);
        if (!Number.isSafeInteger(value) || value < 0) throw new Error(t('Некорректный боезапас'));
        build.ammo[element.dataset.shipAmmo] = value;
      } else if (element.dataset.shipPrice) {
        const value = Number(element.value);
        if (element.value === '' || !knownPrice(value)) throw new Error(t('Некорректная цена'));
        build.prices[element.dataset.shipPrice] = value;
      } else {
        if (!element.value.trim()) throw new Error(t('Введите название сборки'));
        build.name = element.value.trim();
      }
      renderEditor(build.id);
    } catch (error) { message(shipDiagnostic(error.message, locale())); renderEditor(build.id); }
    return true;
  }
  function knownPrice(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
  root.addEventListener('keydown', event => {
    const tab = event.target.closest('[data-ship-tab]');
    if (!tab || !currentId()) return;
    const index = equipmentTabs.findIndex(item => item.id === tab.dataset.shipTab);
    const next = event.key === 'ArrowRight' ? (index + 1) % equipmentTabs.length :
      event.key === 'ArrowLeft' ? (index - 1 + equipmentTabs.length) % equipmentTabs.length :
        event.key === 'Home' ? 0 : event.key === 'End' ? equipmentTabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    editorViews.get(currentId()).tab = equipmentTabs[next].id;
    renderEditor(currentId());
    root.querySelector(`#ship-tab-${equipmentTabs[next].id}`)?.focus();
  });
  function handleSubmit(event) {
    if (event.target.id !== 'ship-create-form') return false;
    event.preventDefault();
    const name = root.querySelector('#ship-name').value.trim();
    const shipId = root.querySelector('#ship-model').value;
    if (!name || !model(shipId)) { message(t('Выберите модель и название')); return true; }
    const id = globalThis.crypto?.randomUUID?.() ?? `ship-${Date.now()}`;
    const build = { id, name, shipId, loadout: {}, ammo: {}, prices: {} };
    try { store.save(build); navigate(`#ship/${encodeURIComponent(id)}`); }
    catch (error) { message(shipDiagnostic(error.message, locale())); }
    return true;
  }
  return { handles, renderRoute, handleClick, handleChange, handleSubmit };
}
