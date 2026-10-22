/*
 * Energy Scope Card — development version 0.1 (unreleased)
 * Copyright (c) 2026 luigi-regolo
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * Reads Home Assistant energy entities and Recorder statistics locally.
 * No external JavaScript, telemetry, or network endpoints.
 */
(() => {
  'use strict';

  const TAG = 'energy-scope-card';
  const EDITOR = 'energy-scope-card-editor';
  const GREEN = '#0E6B52';
  const ENERGY_ID = /^sensor\.[a-z0-9_]+$/;
  const THEMES = ['auto', 'light', 'dark'];
  const REFRESH_MS = 5 * 60 * 1000;
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const finite = (value) => value === '' || value === null || value === undefined ? null : (Number.isFinite(Number(value)) ? Number(value) : null);
  const count = (v, fallback = 2) => Number.isInteger(Number(v)) ? Math.max(0, Math.min(3, Number(v))) : fallback;
  const icon = (name) => `<ha-icon icon="${esc(name)}" aria-hidden="true"></ha-icon>`;
  const safeId = (value) => ENERGY_ID.test(String(value ?? '').trim()) ? String(value).trim() : '';
  // Keep DOM nodes and focus stable when Recorder or the selected period updates.
  const patchNodes = (current, desired) => {
    let i = 0;
    while (i < desired.childNodes.length || i < current.childNodes.length) {
      const next = desired.childNodes[i], old = current.childNodes[i];
      if (!next) { old.remove(); continue; }
      if (!old) { current.appendChild(next.cloneNode(true)); i++; continue; }
      if (old.isEqualNode(next)) { i++; continue; }
      if (old.nodeType !== next.nodeType || old.nodeName !== next.nodeName) {
        current.replaceChild(next.cloneNode(true), old); i++; continue;
      }
      if (old.nodeType !== 1) { old.nodeValue = next.nodeValue; i++; continue; }
      for (const a of Array.from(old.attributes)) if (!next.hasAttribute(a.name)) old.removeAttribute(a.name);
      for (const a of Array.from(next.attributes)) if (old.getAttribute(a.name) !== a.value) old.setAttribute(a.name, a.value);
      patchNodes(old, next);
      i++;
    }
  };
  const fmt = (value, decimals = 2) => value === null || !Number.isFinite(value) ? 'N/D' : value.toLocaleString('it-IT', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const pct = (newValue, oldValue) => newValue === null || oldValue === null || oldValue <= 0 ? null : (newValue - oldValue) / oldValue * 100;
  const configsEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  const normalize = (raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Energy Scope Card: configurazione non valida.');
    return {
      type: `custom:${TAG}`,
      energy_entity: safeId(raw.energy_entity || raw.entity),
      power_entity: safeId(raw.power_entity),
      house_energy_entity: safeId(raw.house_energy_entity),
      house_power_entity: safeId(raw.house_power_entity),
      source_name: String(raw.source_name ?? 'Prese elettriche').slice(0, 65),
      house_source_name: String(raw.house_source_name ?? 'Casa').slice(0, 65),
      eyebrow: String(raw.eyebrow ?? 'ENERGY SCOPE CARD').slice(0, 70),
      title: String(raw.title ?? 'Consumi energetici').slice(0, 70),
      theme_mode: THEMES.includes(raw.theme_mode) ? raw.theme_mode : 'auto',
      show_month_chart: raw.show_month_chart !== false,
      show_year_chart: raw.show_year_chart !== false,
      show_comparison: raw.show_comparison !== false,
      show_details: raw.show_details !== false,
      decimals: count(raw.decimals)
    };
  };

  const numberKwh = (v, unit) => {
    const n = finite(v);
    if (n === null || n < 0) return null;
    if (unit === 'Wh') return n / 1000;
    if (unit === 'kWh') return n;
    if (unit === 'MWh') return n * 1000;
    return null;
  };
  const energyValid = (entity) => !!entity && entity.attributes?.device_class === 'energy' &&
    ['total', 'total_increasing'].includes(entity.attributes?.state_class) &&
    ['Wh', 'kWh', 'MWh'].includes(entity.attributes?.unit_of_measurement);
  const powerValid = (entity) => !!entity && entity.attributes?.device_class === 'power' &&
    ['W', 'kW'].includes(entity.attributes?.unit_of_measurement);
  const watt = (entity) => {
    if (!powerValid(entity) || ['unknown', 'unavailable'].includes(entity.state)) return null;
    const n = finite(entity.state);
    return n === null ? null : n * (entity.attributes.unit_of_measurement === 'kW' ? 1000 : 1);
  };

  // Civil dates use the timezone configured in Home Assistant, not an assumed UTC offset.
  const parts = (date, timeZone) => {
    try {
      const p = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(date);
      const a = Object.fromEntries(p.filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
      return { year: a.year, month: a.month - 1, day: a.day, hour: a.hour };
    } catch (_) {
      return { year: date.getFullYear(), month: date.getMonth(), day: date.getDate(), hour: date.getHours() };
    }
  };
  const zonedMidnight = (year, month, day, timeZone) => {
    const expected = Date.UTC(year, month, day);
    let result = expected;
    for (let i = 0; i < 3; i++) {
      const p = parts(new Date(result), timeZone);
      const current = Date.UTC(p.year, p.month, p.day, p.hour);
      result += expected - current;
      if (current === expected) break;
    }
    return new Date(result);
  };
  const key = (year, month) => `${year}-${String(month + 1).padStart(2, '0')}`;
  const dateKey = (p) => `${key(p.year, p.month)}-${String(p.day).padStart(2, '0')}`;
  const daysOf = (year, month) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const isMonthlyUtility = (entity, now, tz) => {
    if (!energyValid(entity) || !entity.attributes?.next_reset || entity.attributes?.last_period === undefined) return false;
    const next = parts(new Date(entity.attributes.next_reset), tz);
    const target = new Date(Date.UTC(now.year, now.month + 1, 1));
    // A monthly utility meter is determined from the next reset, which is less sensitive to clock rounding.
    return next.year === target.getUTCFullYear() && next.month === target.getUTCMonth() && next.day === 1;
  };
  const rowsFor = (result, id) => Array.isArray(result?.[id]) ? result[id] : [];
  const readChange = (row) => {
    // A missing or negative change must not be silently represented as zero.
    const value = finite(row?.change);
    return value !== null && value >= 0 ? value : null;
  };
  const byCalendar = (rows, tz, monthly) => {
    const out = new Map();
    for (const row of rows) {
      const at = finite(row?.start);
      const change = readChange(row);
      if (at === null || change === null) continue;
      const p = parts(new Date(at), tz);
      out.set(monthly ? key(p.year, p.month) : dateKey(p), change);
    }
    return out;
  };
  const sumDailyRange = (data, year, month, lastDay) => {
    if (lastDay < 1) return null;
    let total = 0;
    for (let d = 1; d <= lastDay; d++) {
      const value = data.get(dateKey({ year, month, day: d }));
      if (value === undefined) return null;
      total += value;
    }
    return total;
  };
  const sumMonthlyRange = (data, year, lastMonth) => {
    if (lastMonth < 0) return null;
    let result = 0;
    for (let m = 0; m <= lastMonth; m++) {
      const value = data.get(key(year, m));
      if (value === undefined) return null;
      result += value;
    }
    return result;
  };
  const buildView = (entity, record, tz) => {
    const now = parts(new Date(), tz);
    const previous = new Date(Date.UTC(now.year, now.month - 1, 1));
    const py = previous.getUTCFullYear(), pm = previous.getUTCMonth();
    const monthly = byCalendar(record?.monthly || [], tz, true);
    const daily = byCalendar(record?.daily || [], tz, false);
    const utility = isMonthlyUtility(entity, now, tz);
    const live = utility ? numberKwh(entity.state, entity.attributes.unit_of_measurement) : null;
    const month = live ?? (monthly.get(key(now.year, now.month)) ?? null);
    const prior = utility ? (numberKwh(entity.attributes.last_period, entity.attributes.unit_of_measurement) ?? (monthly.get(key(py, pm)) ?? null)) : (monthly.get(key(py, pm)) ?? null);
    // Compare only fully elapsed calendar days, capped to the shorter month.
    const n = Math.min(now.day - 1, daysOf(py, pm));
    const actualComparable = sumDailyRange(daily, now.year, now.month, n);
    const priorComparable = sumDailyRange(daily, py, pm, n);
    const comparison = pct(actualComparable, priorComparable);
    const thisYearSum = sumMonthlyRange(monthly, now.year, now.month - 1);
    const lastYearSum = sumMonthlyRange(monthly, now.year - 1, now.month - 1);
    const monthsPresent = Array.from({ length: now.month }, (_, m) => monthly.has(key(now.year, m))).filter(Boolean).length;
    const lastMonth = monthly.get(key(py, pm));
    const statsConsistent = !utility || lastMonth === undefined || prior === null ||
      Math.abs(lastMonth - prior) <= Math.max(0.05, prior * 0.05);
    // An annual total requires every completed month, not an arbitrary partial sum.
    const yearComplete = thisYearSum !== null && month !== null && statsConsistent;
    const yearlyValue = yearComplete ? thisYearSum + month : null;
    const compareConsistent = statsConsistent && (month === null || actualComparable === null || actualComparable <= month + Math.max(0.05, month * 0.05)) &&
      (prior === null || priorComparable === null || priorComparable <= prior + Math.max(0.05, prior * 0.05));
    return { now, py, pm, monthly, daily, month, prior, utility,
      comparison: compareConsistent ? comparison : null, actualComparable, priorComparable,
      comparedDays: n, yearlyValue, yearComplete, statsConsistent, monthsPresent,
      yearComparison: statsConsistent && thisYearSum !== null && lastYearSum !== null ? pct(thisYearSum, lastYearSum) : null,
      dataPending: record?.loading, error: record?.error || '' };
  };

  const CSS = `
    :host{display:block;min-width:0;font-family:var(--ha-font-family-body,-apple-system,BlinkMacSystemFont,system-ui,Roboto,sans-serif);font-size:14px;color:var(--es-text)}
    *{box-sizing:border-box}
    :host([data-theme=light]){--es-bg:#FFFFFF;--es-panel:#F1F3EF;--es-text:#19221E;--es-muted:#68716C;--es-line:#E3E7E2;--es-other:#B1C5B8;--es-weak:#789A8A;--es-red:#B85D55}
    :host([data-theme=dark]){--es-bg:#101211;--es-panel:#191c1a;--es-text:#f5f7f4;--es-muted:#bbc5bd;--es-line:#2b302c;--es-other:#657D71;--es-weak:#88A99A;--es-red:#D27369}
    :host{--es-accent:var(--edera-emerald-color,${GREEN})}
    .es-container{container-type:inline-size;min-width:0;max-width:100%}
    .es-shell{padding:21px;border:1px solid var(--es-line);background:var(--es-bg);border-radius:26px;min-width:0;overflow:hidden}
    .es-header{min-width:0;margin:2px 4px 17px}
    .es-eyebrow{font-size:10px;letter-spacing:1.7px;font-weight:750;line-height:1.1;color:var(--es-muted);text-transform:uppercase;margin:0 0 7px}
    .es-title{font-size:25px;line-height:1.14;font-weight:780;letter-spacing:-.7px;margin:0;overflow-wrap:anywhere}
    .es-title b{color:var(--es-accent)}
    .es-source-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-top:16px}
    .es-source-tab{border:1px solid var(--es-line);background:var(--es-panel);color:var(--es-text);border-radius:10px;padding:8px 12px;font-size:12px;cursor:pointer}
    .es-source-tab[aria-pressed=true]{background:var(--es-accent);border-color:var(--es-accent);color:#fff}
    .es-summary{border:1px solid var(--es-line);border-radius:24px;background:var(--es-panel);padding:19px;margin-top:0;min-width:0}
    .es-hero-label{font-size:11px;color:var(--es-muted);font-weight:620}
    .es-hero{display:flex;flex-direction:column;gap:10px;min-width:0}
    .es-hero-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;min-width:0}
    .es-hero-head .es-hero-label{min-width:0;flex:1}
    .es-comparison-context{font-size:10px;font-weight:580;line-height:1.4;color:var(--es-muted);text-align:right;flex:none;max-width:47%}
    .es-comparison-context .es-context-short,.es-comparison-context .es-context-tiny{display:none}
    .es-hero-values{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
    .es-hero-values .es-total{min-width:0}
    .es-hero-values .es-comparison-pill{margin-left:auto}
    .es-comparison-pill{display:inline-flex;align-items:center;justify-content:center;gap:5px;white-space:nowrap;min-width:0;flex:none;border-radius:999px;padding:8px 11px;font-size:14px;line-height:1.2;font-weight:750;font-variant-numeric:tabular-nums}
    .es-comparison-pill ha-icon{--mdc-icon-size:16px;width:16px;height:16px;display:block;flex:none}
    .es-comparison-pill.bad{background:#382725;color:#e48a80}
    .es-comparison-pill.good{background:#113c2f;color:#88e1b4}
    .es-comparison-pill.na{background:#292d2a;color:var(--es-muted)}
    :host([data-theme=light]) .es-comparison-pill.bad{background:#fcebe9;color:#b85d55}
    :host([data-theme=light]) .es-comparison-pill.good{background:#e2f0e7;color:#0E6B52}
    :host([data-theme=light]) .es-comparison-pill.na{background:#e8ede9;color:#68716C}
    .es-total{font-size:38px;font-weight:780;line-height:1.16;letter-spacing:-1.2px;font-variant-numeric:tabular-nums;margin:0;overflow-wrap:anywhere}
    .es-unit{font-size:14px;font-weight:600;color:var(--es-muted);letter-spacing:0}
    .es-subgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:10px;align-items:stretch}
    .es-stat{padding:12px 13px;min-width:0;background:var(--es-panel);border:1px solid var(--es-line);border-radius:17px;display:grid;grid-template-rows:minmax(34px,auto) auto;align-content:start}
    .es-stat-label{font-size:11px;color:var(--es-muted);line-height:1.4;align-self:start;min-height:34px}
    .es-stat-val{font-size:22px;line-height:1.3;font-weight:750;font-variant-numeric:tabular-nums;margin:0;overflow-wrap:anywhere;display:flex;align-items:baseline;gap:4px;min-width:0}
    .es-stat-unit{font-size:11px;font-weight:500;color:var(--es-muted)}
    .es-note{font-size:11px;line-height:1.5;color:var(--es-muted);margin-top:10px}
    .es-charthead{display:flex;align-items:center;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-top:20px}
    .es-tabs{display:flex;gap:4px;padding:4px;border:1px solid var(--es-line);border-radius:12px;background:var(--es-panel)}
    .es-tab{font-size:12px;font-weight:650;cursor:pointer;border:0;border-radius:9px;background:transparent;color:var(--es-muted);padding:7px 12px}
    .es-tab[aria-pressed=true]{color:var(--es-text);background:var(--es-bg);box-shadow:0 0 0 1px var(--es-line)}
    :host([data-theme=dark]) .es-tabs{background:var(--es-bg)}
    :host([data-theme=dark]) .es-tab[aria-pressed=true]{background:var(--es-panel)}
    .es-graph-region{min-height:236px}
    .es-plot{height:156px;display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:3px;align-items:stretch;margin-top:17px;border-bottom:1px solid var(--es-line);background:linear-gradient(to top,transparent 24.6%,var(--es-line) 25%,transparent 25.4%,transparent 49.6%,var(--es-line) 50%,transparent 50.4%,transparent 74.6%,var(--es-line) 75%,transparent 75.4%)}
    .es-barcell{height:100%;display:flex;align-items:end;justify-content:center;gap:2px;min-width:0}
    .es-bar{min-width:2px;max-width:24px;width:43%;background:var(--es-accent);border-radius:4px 4px 0 0}
    .es-bar.other{background:var(--es-other)}
    .es-axis{font-size:10px;color:var(--es-muted);display:flex;justify-content:space-between;gap:5px;margin-top:9px}
    .es-legend{display:flex;gap:15px;flex-wrap:wrap;color:var(--es-muted);font-size:11px;margin-top:13px;min-height:18px}
    .es-dot{display:inline-block;width:9px;height:9px;border-radius:3px;background:var(--es-accent);margin-right:6px;vertical-align:middle}
    .es-dot.other{background:var(--es-other)}
    .es-chart-empty{margin-top:15px;padding:24px 12px;border:1px dashed var(--es-line);border-radius:14px;color:var(--es-muted);font-size:12px;text-align:center;min-height:190px;display:flex;align-items:center;justify-content:center}
    .es-details{display:flex;align-items:center;justify-content:space-between;width:100%;min-width:0;gap:12px;min-height:42px;padding:10px 14px;margin-top:14px;border:1px solid var(--es-accent);border-radius:16px;background:var(--es-accent);color:#fff;text-align:left;font-weight:650;font-size:12px;cursor:pointer}
    .es-details[aria-expanded=true],.es-details:hover{background:var(--es-accent);color:#fff}
    .es-details-label{display:inline-flex;align-items:center;gap:8px}.es-details ha-icon{--mdc-icon-size:17px;width:17px;height:17px}
    .es-empty{padding:20px 4px;color:var(--es-muted);line-height:1.6;font-size:13px}
    .es-backdrop{position:fixed;inset:0;z-index:9999;background:#0009;display:grid;place-items:center;overflow:hidden;overscroll-behavior:none;padding:max(20px,env(safe-area-inset-top)) 18px max(20px,env(safe-area-inset-bottom))}
    .es-dialog{display:flex;flex-direction:column;background:var(--es-bg);color:var(--es-text);border:1px solid var(--es-line);border-radius:26px;width:min(390px,100%);max-height:min(82vh,720px);max-height:min(82dvh,720px);box-shadow:0 18px 60px #0005;overflow:hidden;overscroll-behavior:contain;min-width:0}
    .es-dialog-head{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:62px;padding:18px 19px 12px;flex:none;background:var(--es-bg)}
    .es-dialog-head-title{font-size:17px;font-weight:600;line-height:1.3}.es-dialog-sub{font-size:12px;color:var(--es-muted);margin-top:4px}
    .es-close{display:flex;align-items:center;justify-content:center;border:0;border-radius:50%;background:var(--es-panel);color:var(--es-text);width:36px;height:36px;flex:none;line-height:0;padding:0;cursor:pointer}
    .es-close ha-icon{display:block;width:18px;height:18px;--mdc-icon-size:18px;flex:none}
    .es-dialog-scroll{min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y;padding:8px 19px 19px}
    .es-popup-label{font-size:13px;font-weight:700;margin:4px 0 10px}
    .es-popup-row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:10px 0;border:0;font-size:12px;line-height:1.5}
    .es-popup-row span{color:var(--es-muted);min-width:0;flex:1}.es-popup-row strong{font-variant-numeric:tabular-nums;text-align:right;max-width:48%;overflow-wrap:anywhere}
    .es-popup-panel{border:1px solid var(--es-line);background:var(--es-panel);border-radius:16px;padding:13px;margin:9px 0 15px}
    .es-popup-big{font-size:24px;font-weight:750;font-variant-numeric:tabular-nums;margin-top:6px}
    .es-popup-section{margin-top:25px}
    .es-popup-section .es-popup-label{font-size:14px;font-weight:700;margin-bottom:13px}
    button:focus-visible{outline:2px solid var(--es-accent);outline-offset:2px}
    @container (max-width:395px){.es-shell{padding:15px;border-radius:24px}.es-title{font-size:23px}.es-total{font-size:34px}.es-stat-val{font-size:20px}.es-plot{height:138px}.es-chart-empty{min-height:173px}.es-graph-region{min-height:214px}.es-summary{padding:15px}.es-hero{gap:10px}.es-comparison-context .es-context-long{display:none}.es-comparison-context .es-context-short{display:inline}}
    @container (max-width:325px){.es-total{font-size:30px}.es-unit{font-size:12px}.es-comparison-pill{font-size:12px;padding:7px 9px}.es-stat{padding:10px}.es-stat-val{font-size:18px}.es-comparison-context .es-context-short{display:none}.es-comparison-context .es-context-tiny{display:inline}}
    @media(max-width:599px){.es-dialog{width:min(350px,100%);max-height:min(68vh,560px);max-height:min(68dvh,560px);border-radius:24px}.es-backdrop{padding:max(20px,env(safe-area-inset-top)) 18px max(20px,env(safe-area-inset-bottom))}}
    @media(max-height:480px){.es-dialog{max-height:calc(100dvh - 24px)}}
    @media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
  `;

  class EnergyScopeCard extends HTMLElement {
    static getStubConfig() { const { type, ...value } = normalize({}); return value; }
    static getConfigElement() { return document.createElement(EDITOR); }
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._cfg = normalize({}); this._hass = null; this._source = 'plugs'; this._chart = 'month'; this._dialog = false;
      this._records = new Map(); this._signature = ''; this._focusBefore = null; this._modalLock = false;
      this._modalTouch = { x: 0, y: 0 };
      this._touchStart = (e) => { if (e.touches?.length === 1) this._modalTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
      this._touchMove = (e) => { if (e.touches?.length !== 1) return; const t = e.touches[0]; this._protectScroll(e, this._modalTouch.y - t.clientY, Math.abs(this._modalTouch.x - t.clientX) > Math.abs(this._modalTouch.y - t.clientY)); this._modalTouch = { x: t.clientX, y: t.clientY }; };
      this._wheel = (e) => this._protectScroll(e, e.deltaY, Math.abs(e.deltaX) > Math.abs(e.deltaY));
      this._media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
      this._onAppearance = () => this._render();
      this.shadowRoot.addEventListener('click', (e) => this._onClick(e));
      this.shadowRoot.addEventListener('keydown', (e) => this._onKeydown(e));
    }
    connectedCallback() { this._media?.addEventListener?.('change', this._onAppearance); this._render(); this._fetchIfNeeded(); }
    disconnectedCallback() { this._lock(false); this._media?.removeEventListener?.('change', this._onAppearance); }
    setConfig(raw) {
      const next = normalize(raw);
      const didChange = !configsEqual(next, this._cfg);
      this._cfg = next;
      if (didChange) { this._signature = ''; this._records.clear(); this._source = 'plugs'; }
      this._render(); this._fetchIfNeeded();
    }
    set hass(hass) { this._hass = hass; this._render(); this._fetchIfNeeded(); }
    getCardSize() { return this._cfg.show_month_chart || this._cfg.show_year_chart ? 6 : 3; }
    _tz() { return this._hass?.config?.time_zone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
    _theme() { return this._cfg.theme_mode !== 'auto' ? this._cfg.theme_mode : (typeof this._hass?.themes?.darkMode === 'boolean' ? (this._hass.themes.darkMode ? 'dark' : 'light') : (this._media?.matches ? 'dark' : 'light')); }
    _selected() {
      const isHouse = this._source === 'house' && !!this._cfg.house_energy_entity;
      return { id: isHouse ? this._cfg.house_energy_entity : this._cfg.energy_entity,
        power: isHouse ? this._cfg.house_power_entity : this._cfg.power_entity,
        name: isHouse ? this._cfg.house_source_name : this._cfg.source_name };
    }
    _fetchIfNeeded() {
      if (!this.isConnected || !this._hass || typeof this._hass.callWS !== 'function') return;
      const { id } = this._selected();
      if (!id || !energyValid(this._hass.states?.[id])) return;
      const tz = this._tz(), now = parts(new Date(), tz), cache = this._records.get(id);
      const token = `${tz}:${now.year}-${now.month}-${now.day}`;
      if (cache?.loading || (cache?.token === token && Date.now() - cache.fetchedAt < REFRESH_MS)) return;
      const record = { loading: true, error: cache?.error || '', monthly: cache?.monthly || [], daily: cache?.daily || [],
        revision: cache?.revision || 0, token, fetchedAt: Date.now() };
      this._records.set(id, record);
      // Query at civil midnights in the Home Assistant timezone, avoiding DST shortcuts.
      const firstMonthly = zonedMidnight(now.year - 1, 0, 1, tz);
      const firstDaily = zonedMidnight(now.year, now.month - 1, 1, tz);
      const nextDay = zonedMidnight(now.year, now.month, now.day + 1, tz);
      const query = (start, period) => this._hass.callWS({
        type: 'recorder/statistics_during_period', statistic_ids: [id], start_time: start.toISOString(),
        end_time: nextDay.toISOString(), period, types: ['change'], units: { energy: 'kWh' }
      });
      this._render();
      Promise.allSettled([query(firstDaily, 'day'), query(firstMonthly, 'month')]).then((out) => {
        if (this._records.get(id) !== record) return;
        const nextDaily = out[0].status === 'fulfilled' ? rowsFor(out[0].value, id) : record.daily;
        const nextMonthly = out[1].status === 'fulfilled' ? rowsFor(out[1].value, id) : record.monthly;
        if (JSON.stringify(nextDaily) !== JSON.stringify(record.daily) ||
            JSON.stringify(nextMonthly) !== JSON.stringify(record.monthly)) record.revision++;
        record.daily = nextDaily;
        record.monthly = nextMonthly;
        record.error = out.every((x) => x.status === 'rejected') ? 'Statistiche non disponibili: verifica Recorder e autorizzazioni.' : '';
        record.loading = false; record.fetchedAt = Date.now(); this._render();
      }).catch(() => { if (this._records.get(id) === record) { record.loading = false; record.error = 'Impossibile leggere le statistiche.'; record.loading = false; this._render(); } });
    }
    _chartFor(view) {
      const { now, pm, py, daily, monthly } = view;
      const annual = this._chart === 'year';
      const currentLabel = annual ? String(now.year) : new Date(now.year, now.month, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
      const pastLabel = new Date(py, pm, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
      const values = annual ? Array.from({ length: 12 }, (_, i) => ({ id: i + 1, now: i === now.month ? view.month : i < now.month ? monthly.get(key(now.year, i)) ?? null : null, other: null })) :
        Array.from({ length: now.day }, (_, i) => ({ id: i + 1, now: daily.get(dateKey({ year: now.year, month: now.month, day: i + 1 })) ?? null,
          other: i < daysOf(py, pm) ? daily.get(dateKey({ year: py, month: pm, day: i + 1 })) ?? null : null }));
      const present = values.filter((d) => d.now !== null || d.other !== null);
      if (!present.length) return `<div class="es-chart-empty" role="status">${view.dataPending ? 'Caricamento statistiche…' : 'Nessuna statistica disponibile per questo periodo.'}</div>`;
      const maximum = Math.max(0.001, ...values.map((x) => Math.max(x.now ?? 0, x.other ?? 0))) * 1.1;
      const bars = values.map((b) => {
        const entry = (v, kind) => v === null ? '' : `<span class="es-bar ${kind}" style="height:${Math.max(v > 0 ? 2 : 0, Math.min(100, v / maximum * 100)).toFixed(2)}%" title="${esc(`${b.id}: ${fmt(v, 2)} kWh`)}"></span>`;
        return `<div class="es-barcell" aria-label="${b.id}: ${b.now === null ? 'N/D' : fmt(b.now, 2) + ' kWh'}${annual ? '' : ' · precedente: ' + (b.other === null ? 'N/D' : fmt(b.other, 2) + ' kWh')}">${annual ? entry(b.now, b.id === now.month + 1 ? '' : 'other') : entry(b.other, 'other') + entry(b.now, '')}</div>`;
      }).join('');
      const axis = annual ? `<span>Gen</span><span>Mar</span><span>Mag</span><span>Lug</span><span>Set</span><span>Dic</span>` : `<span>1</span><span>${Math.max(1, Math.round(now.day / 3))}</span><span>${Math.max(1, Math.round(now.day * 2 / 3))}</span><span>${now.day}</span>`;
      return `<div class="es-plot" role="img" aria-label="Consumi ${esc(currentLabel)}${annual ? '' : ' e ' + esc(pastLabel)}; valori giornalieri o mensili in kWh">${bars}</div>
        <div class="es-axis">${axis}</div><div class="es-legend"><span><i class="es-dot"></i>${annual ? 'Mese in corso' : esc(currentLabel)}</span><span><i class="es-dot other"></i>${annual ? 'Mesi conclusi' : esc(pastLabel)}</span></div>`;
    }
    _popup(view, source) {
      const yearNote = view.yearComplete ? '' : ' (storico incompleto)';
      const line = (label, value) => `<div class="es-popup-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
      return `<div class="es-backdrop" data-backdrop="true"><div class="es-dialog" role="dialog" aria-modal="true" aria-label="Dettagli energetici">
          <div class="es-dialog-head"><div><div class="es-dialog-head-title">Dettagli energetici</div><div class="es-dialog-sub">${esc(source.name)}</div></div>
          <button class="es-close" type="button" data-close="true" aria-label="Chiudi">${icon('mdi:close')}</button></div>
          <div class="es-dialog-scroll"><div class="es-popup-section" style="margin-top:0"><div class="es-popup-label">Riepilogo consumi</div>
          <div class="es-popup-panel"><div class="es-hero-label">Mese in corso</div><div class="es-popup-big">${fmt(view.month, this._cfg.decimals)} <span class="es-unit">kWh</span></div></div></div>
          <div class="es-popup-section"><div class="es-popup-label">Confronto mensile</div>
          ${line('Mese precedente', `${fmt(view.prior, this._cfg.decimals)} kWh`)}
          ${line(`Mese corrente: primi ${view.comparedDays} giorni conclusi`, `${fmt(view.actualComparable, this._cfg.decimals)} kWh`)}
          ${line(`Mese precedente: primi ${view.comparedDays} giorni`, `${fmt(view.priorComparable, this._cfg.decimals)} kWh`)}
          ${line('Variazione periodi equivalenti', view.comparison === null ? 'N/D' : `${view.comparison > 0 ? '+' : ''}${fmt(view.comparison, 1)}%`)}
          </div><div class="es-popup-section"><div class="es-popup-label">Statistiche annuali</div>
          ${line(`Totale ${view.now.year}${yearNote}`, view.yearComplete ? `${fmt(view.yearlyValue, this._cfg.decimals)} kWh` : 'Dati insufficienti')}
          ${line(`Storico ${view.now.year}`, `${view.monthsPresent} mesi disponibili su ${view.now.month}`)}
          ${line(`Confronto con il ${view.now.year - 1}`, view.yearComparison === null ? 'Dati insufficienti' : `${view.yearComparison > 0 ? '+' : ''}${fmt(view.yearComparison, 1)}%`)}
          ${view.error ? `<div class="es-note" role="alert">${esc(view.error)}</div>` : ''}
          </div></div></div></div>`;
    }
    _lock(enable) {
      if (enable === this._modalLock) return;
      this._modalLock = enable;
      const method = enable ? 'addEventListener' : 'removeEventListener';
      document[method]('touchstart', this._touchStart, true);
      document[method]('touchmove', this._touchMove, { capture: true, passive: false });
      document[method]('wheel', this._wheel, { capture: true, passive: false });
    }
    _protectScroll(event, delta, horizontal = false) {
      if (!this._dialog || !event.cancelable) return;
      const inner = this.shadowRoot.querySelector('.es-dialog-scroll');
      if (!inner || !event.composedPath().includes(inner)) { event.preventDefault(); return; }
      const max = Math.max(0, inner.scrollHeight - inner.clientHeight);
      if (horizontal || max < 1 || (delta < 0 && inner.scrollTop <= 1) || (delta > 0 && inner.scrollTop >= max - 1)) event.preventDefault();
    }
    _close() {
      this._dialog = false; this._signature = ''; this._render();
      this.shadowRoot.querySelector('[data-details]')?.focus({ preventScroll: true });
    }
    _onClick(e) {
      if (e.target.closest('[data-close]') || e.target.matches('[data-backdrop]')) { this._close(); return; }
      const selector = e.target.closest('[data-source]');
      if (selector) { this._source = selector.dataset.source; this._signature = ''; this._render(); this._fetchIfNeeded(); return; }
      const chart = e.target.closest('[data-chart]');
      if (chart) { this._chart = chart.dataset.chart; this._signature = ''; this._render(); return; }
      if (e.target.closest('[data-details]')) {
        this._dialog = true; this._signature = ''; this._render(); this.shadowRoot.querySelector('[data-close]')?.focus({ preventScroll: true });
      }
    }
    _onKeydown(e) {
      if (!this._dialog) return;
      if (e.key === 'Escape') { e.preventDefault(); this._close(); return; }
      if (e.key !== 'Tab') return;
      const focusables = [...this.shadowRoot.querySelectorAll('.es-dialog button:not([disabled])')];
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && this.shadowRoot.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && this.shadowRoot.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    _render() {
      if (!this.isConnected) return;
      const source = this._selected(), entity = this._hass?.states?.[source.id];
      const valid = energyValid(entity), record = this._records.get(source.id);
      const view = buildView(entity, record, this._tz());
      const powerValue = source.power ? watt(this._hass?.states?.[source.power]) : null;
      const hasHouse = !!this._cfg.house_energy_entity;
      const sig = JSON.stringify({ cfg: this._cfg, source: this._source, chart: this._chart, dialog: this._dialog, theme: this._theme(),
        current: valid ? fmt(view.month, this._cfg.decimals) : entity?.state,
        last: valid ? fmt(view.prior, this._cfg.decimals) : entity?.attributes?.last_period,
        available: entity?.attributes?.state_class, powerValue: powerValue === null ? null : fmt(powerValue, 0),
        date: `${view.now.year}-${view.now.month}-${view.now.day}`,
        statsRevision: record?.revision || 0, initialLoading: !!record?.loading && !(record?.daily?.length || record?.monthly?.length),
        error: record?.error, exists: !!entity });
      if (sig === this._signature) return;
      this._signature = sig;
      const prevScroll = this.shadowRoot.querySelector('.es-dialog-scroll')?.scrollTop ?? 0;
      if (this.getAttribute('data-theme') !== this._theme()) this.setAttribute('data-theme', this._theme());
      const meta = view.now;
      const monthTitle = new Date(meta.year, meta.month, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
      const priorTitle = new Date(view.py, view.pm, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
      const compare = view.comparison;
      const compareLabel = compare === null ? 'N/D' : `${compare > 0 ? '+' : ''}${fmt(compare, 1)}%`;
      const canMonth = this._cfg.show_month_chart, canYear = this._cfg.show_year_chart;
      if (!canYear && this._chart === 'year') this._chart = 'month';
      if (!canMonth && this._chart === 'month') this._chart = 'year';
      let content;
      if (!source.id) {
        content = '<div class="es-empty">Seleziona un sensore di energia (kWh) dall’editor visuale per iniziare.</div>';
      } else if (!entity) {
        content = '<div class="es-empty" role="status">Entità non trovata in Home Assistant. Verifica la selezione nell’editor.</div>';
      } else if (!valid) {
        content = '<div class="es-empty" role="alert">Il sensore deve avere device_class energy, state_class total/total_increasing e unità Wh, kWh o MWh.</div>';
      } else {
        const direction = compare === null ? 'na' : compare > 0 ? 'bad' : 'good';
        const trendIcon = compare === null || compare === 0 ? 'mdi:minus' : compare > 0 ? 'mdi:trending-up' : 'mdi:trending-down';
        const shortPrior = new Date(view.py, view.pm, 1).toLocaleDateString('it-IT', { month: 'short' }).replace(/\.$/, '');
        content = `<div class="es-summary"><div class="es-hero"><div class="es-hero-head">
           <div class="es-hero-label">${esc(source.name)} · ${esc(monthTitle)}</div>
           ${this._cfg.show_comparison ? `<div class="es-comparison-context" aria-label="Confronto con ${esc(priorTitle)}, stessi giorni conclusi">
              <span class="es-context-long">vs ${esc(priorTitle)} · stessi giorni</span>
              <span class="es-context-short">vs ${esc(shortPrior)} · stessi giorni</span>
              <span class="es-context-tiny">vs ${esc(shortPrior)}</span></div>` : ''}</div>
           <div class="es-hero-values"><div class="es-total">${fmt(view.month, this._cfg.decimals)} <span class="es-unit">kWh</span></div>
           ${this._cfg.show_comparison ? `<span class="es-comparison-pill ${direction}" aria-label="Variazione consumi: ${esc(compareLabel)}">${icon(trendIcon)} ${esc(compareLabel)}</span>` : ''}</div></div>
           ${powerValue !== null ? `<div class="es-note">Potenza attuale: <strong>${fmt(powerValue, 0)} W</strong></div>` : ''}</div>
           <div class="es-subgrid"><div class="es-stat"><div class="es-stat-label">${esc(priorTitle)} · mese concluso</div><div class="es-stat-val">${fmt(view.prior, this._cfg.decimals)} <span class="es-stat-unit">kWh</span></div></div>
           <div class="es-stat"><div class="es-stat-label">${meta.year} · ${view.yearComplete ? 'totale progressivo' : 'storico disponibile'}</div><div class="es-stat-val">${fmt(view.yearlyValue, this._cfg.decimals)} <span class="es-stat-unit">kWh</span></div></div></div>
           ${(canMonth || canYear) ? `<div class="es-charthead"><div class="es-tabs" role="group" aria-label="Periodo del grafico">
             ${canMonth ? `<button class="es-tab" type="button" data-chart="month" aria-pressed="${this._chart === 'month'}">Mese</button>` : ''}
             ${canYear ? `<button class="es-tab" type="button" data-chart="year" aria-pressed="${this._chart === 'year'}">Anno</button>` : ''}</div></div>
             <div class="es-graph-region">${this._chartFor(view)}</div><div class="es-note">${this._chart === 'month' ? 'Consumi giornalieri; il giorno attuale può essere parziale.' : 'Consumi mensili; il mese corrente è progressivo.'}</div>` : ''}
           ${view.error ? `<div class="es-note" role="alert">${esc(view.error)}</div>` : ''}
           ${this._cfg.show_details ? `<button type="button" class="es-details" data-details="true" aria-haspopup="dialog" aria-expanded="${this._dialog}"><span class="es-details-label">${icon('mdi:chart-line')} Dettagli e statistiche</span>${icon('mdi:chevron-right')}</button>` : ''}`;
      }
      const nextMarkup = `<style>${CSS}</style><div class="es-container"><div class="es-shell">
         <header class="es-header"><div class="es-eyebrow">${esc(this._cfg.eyebrow)}</div><div class="es-title">${esc(this._cfg.title)}<b>.</b></div></header>
         ${hasHouse ? `<div class="es-source-tabs"><button class="es-source-tab" type="button" data-source="plugs" aria-pressed="${this._source !== 'house'}">${esc(this._cfg.source_name)}</button><button class="es-source-tab" type="button" data-source="house" aria-pressed="${this._source === 'house'}">${esc(this._cfg.house_source_name)}</button></div>` : ''}
         ${content}</div></div>${this._dialog && valid ? this._popup(view, source) : ''}`;
      const nextTree = document.createElement('template');
      nextTree.innerHTML = nextMarkup;
      patchNodes(this.shadowRoot, nextTree.content);
      const popup = this.shadowRoot.querySelector('.es-dialog-scroll');
      if (popup) popup.scrollTop = prevScroll;
      this._lock(!!popup);
    }
  }

  const EDIT_CSS = `
    :host{display:block;font-family:var(--ha-font-family-body,Roboto,Arial,sans-serif);color:var(--primary-text-color,#19221E);font-size:14px}
    *{box-sizing:border-box}.es-editor{min-width:0}.es-editor-tabs{display:flex;gap:4px;overflow-x:auto;border-bottom:1px solid var(--divider-color,#E1E5E1);padding-bottom:12px}
    .es-editor-tab{border:0;border-radius:11px;background:transparent;color:var(--secondary-text-color,#68716C);padding:10px 12px;cursor:pointer;white-space:nowrap;font:inherit;font-size:12px}
    .es-editor-tab.active{background:var(--secondary-background-color,#F1F3EF);color:var(--primary-text-color,#19221E);font-weight:700}
    .es-editor-heading{font-size:20px;font-weight:600;margin:22px 0 7px}.es-editor-description{font-size:12px;color:var(--secondary-text-color,#68716C);line-height:1.5;margin:0 0 17px}
    .es-editor-field{margin:20px 0}.es-editor-label{font-size:13px;font-weight:600;margin-bottom:9px}.es-editor-input{display:block;width:100%;background:var(--secondary-background-color,#F1F3EF);color:var(--primary-text-color,#19221E);border:1px solid var(--divider-color,#E1E5E1);border-radius:11px;min-height:44px;padding:11px 12px;font:inherit}
    .es-editor-check{display:flex;justify-content:space-between;gap:12px;align-items:center;border-bottom:1px solid var(--divider-color,#E1E5E1);padding:14px 0;font-size:13px}
    .es-editor-check input{width:18px;height:18px;accent-color:var(--edera-emerald-color,${GREEN})}
    .es-editor-help{font-size:11px;line-height:1.5;color:var(--secondary-text-color,#68716C);margin-top:7px}
    .es-editor-notice{padding:10px 12px;color:var(--error-color,#B85D55);font-size:12px;margin-top:10px}
    .es-editor-source{min-height:38px}.es-editor-source ha-selector{display:block;width:100%;--mdc-theme-primary:var(--edera-emerald-color,${GREEN})}
    .es-editor-native .es-editor-fallback{display:none}
    .es-editor-input:focus-visible,button:focus-visible{outline:2px solid var(--edera-emerald-color,${GREEN});outline-offset:2px}
  `;

  class EnergyScopeEditor extends HTMLElement {
    constructor() {
      super(); this.attachShadow({ mode: 'open' });
      this._cfg = normalize({}); this._hass = null; this._tab = 'sorgenti'; this._nativeTried = false; this._notice = '';
      this.shadowRoot.addEventListener('click', (e) => { const t = e.target.closest('[data-tab]'); if (t) { this._tab = t.dataset.tab; this._render(); } });
      this.shadowRoot.addEventListener('change', (e) => this._change(e));
    }
    connectedCallback() { this._render(); void this._ensureNative(); }
    set hass(value) { this._hass = value; this.shadowRoot.querySelectorAll('ha-selector').forEach((e) => e.hass = value); }
    setConfig(raw) { const next = normalize(raw); if (configsEqual(next, this._cfg) && this.shadowRoot.querySelector('.es-editor')) return; this._cfg = next; this._render(); }
    async _ensureNative() {
      if (this._nativeTried) return; this._nativeTried = true;
      if (!customElements.get('ha-selector')) {
        try { const helpers = await window.loadCardHelpers?.(); await helpers?.importSelector?.(); } catch (_) { /* Editable fallback remains available. */ }
      }
      this._render();
    }
    _save(changes) { this._cfg = normalize({ ...this._cfg, ...changes }); this._notice = '';
      this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: { ...this._cfg } }, bubbles: true, composed: true })); this._render(); }
    _field(k, label, hint = '') { return `<div class="es-editor-field"><div class="es-editor-label">${esc(label)}</div><input class="es-editor-input" data-key="${k}" maxlength="70" value="${esc(this._cfg[k])}">${hint ? `<div class="es-editor-help">${esc(hint)}</div>` : ''}</div>`; }
    _entityField(k, label, hint = '') { return `<div class="es-editor-field"><div class="es-editor-label">${esc(label)}</div><div class="es-editor-source" data-native-slot="${k}"></div><div class="es-editor-fallback"><input class="es-editor-input" data-key="${k}" value="${esc(this._cfg[k])}" placeholder="sensor.nome_entita"></div>${hint ? `<div class="es-editor-help">${esc(hint)}</div>` : ''}</div>`; }
    _check(k, label) { return `<label class="es-editor-check"><span>${esc(label)}</span><input type="checkbox" data-check="${k}" ${this._cfg[k] ? 'checked' : ''}></label>`; }
    _render() {
      if (!this.isConnected) return;
      const c = this._cfg, tabs = [['sorgenti','Sorgenti'],['grafici','Grafici'],['aspetto','Aspetto'],['avanzate','Avanzate']];
      let body = '';
      if (this._tab === 'sorgenti') body = `<div class="es-editor-heading">Sorgenti energetiche</div><div class="es-editor-description">Seleziona i sensori di consumo. Le sorgenti Prese e Casa restano distinte per evitare doppi conteggi.</div>
        ${this._entityField('energy_entity','Energia prese (kWh)','Obbligatorio per l’analisi attuale. Accetta total o total_increasing.')}
        ${this._field('source_name','Nome sorgente prese')}
        ${this._entityField('power_entity','Potenza prese (W) · opzionale','Usa un sensore di potenza aggregata, non quello di un singolo elettrodomestico se vuoi il totale delle prese.')}
        ${this._entityField('house_energy_entity','Energia totale casa (kWh)','Opzionale: seleziona un sensore di consumo generale compatibile.')}
        ${this._field('house_source_name','Nome sorgente casa')}
        ${this._entityField('house_power_entity','Potenza totale casa (W)','Facoltativo; seleziona il sensore totale della casa, non una singola fase.')}`;
      if (this._tab === 'grafici') body = `<div class="es-editor-heading">Grafici e statistiche</div><div class="es-editor-description">Le statistiche vengono lette esclusivamente dal Recorder della tua istanza Home Assistant.</div>
        ${this._check('show_month_chart','Grafico giornaliero · Mese')}${this._check('show_year_chart','Grafico mensile · Anno')}${this._check('show_comparison','Confronto percentuale con il mese precedente')}${this._check('show_details','Pulsante Dettagli e statistiche')}
        <div class="es-editor-help">Le percentuali sono calcolate sui giorni completi comparabili. Se lo storico è insufficiente, viene mostrato N/D.</div>`;
      if (this._tab === 'aspetto') body = `<div class="es-editor-heading">Identità Edera</div><div class="es-editor-description">Layout coerente con Battery Insight e Cover Flow.</div>
        ${this._field('eyebrow','Intestazione superiore')}${this._field('title','Titolo card')}
        <div class="es-editor-field"><div class="es-editor-label">Tema</div><select class="es-editor-input" data-key="theme_mode">
          <option value="auto" ${c.theme_mode === 'auto' ? 'selected' : ''}>Automatico · Home Assistant</option>
          <option value="light" ${c.theme_mode === 'light' ? 'selected' : ''}>Edera Light</option>
          <option value="dark" ${c.theme_mode === 'dark' ? 'selected' : ''}>Graphite Dark</option>
        </select></div>`;
      if (this._tab === 'avanzate') body = `<div class="es-editor-heading">Avanzate</div><div class="es-editor-description">Nessun comando o scrittura sulle entità. Nessun servizio esterno.</div>
        <div class="es-editor-field"><div class="es-editor-label">Precisione valori</div><select class="es-editor-input" data-key="decimals">
          ${[0,1,2,3].map((n) => `<option value="${n}" ${c.decimals === n ? 'selected' : ''}>${n} decimal${n === 1 ? 'e' : 'i'}</option>`).join('')}
        </select></div><div class="es-editor-help">Cache di 5 minuti per le statistiche storiche. Stati sconosciuti o mancanti non vengono stimati.</div>`;
      const native = !!customElements.get('ha-selector');
      this.shadowRoot.innerHTML = `<style>${EDIT_CSS}</style><div class="es-editor ${native ? 'es-editor-native' : ''}"><div class="es-editor-tabs">${tabs.map(([k, v]) => `<button class="es-editor-tab ${this._tab === k ? 'active' : ''}" data-tab="${k}" type="button">${v}</button>`).join('')}</div>${body}${this._notice ? `<div class="es-editor-notice" role="alert">${esc(this._notice)}</div>` : ''}</div>`;
      if (!native) return;
      this.shadowRoot.querySelectorAll('[data-native-slot]').forEach((slot) => {
        const id = slot.dataset.nativeSlot;
        const el = document.createElement('ha-selector'); el.hass = this._hass; el.selector = { entity: { filter: [{ domain: 'sensor', device_class: ['power_entity', 'house_power_entity'].includes(id) ? 'power' : 'energy' }] } }; el.value = c[id] || '';
        el.addEventListener('value-changed', (e) => { e.stopPropagation(); this._chooseEntity(id, e.detail?.value || ''); });
        slot.appendChild(el);
      });
    }
    _chooseEntity(field, value) {
      if (value && !safeId(value)) { this._notice = 'Seleziona un sensore valido.'; this._render(); return; }
      const entity = this._hass?.states?.[value];
      const isPower = field === 'power_entity' || field === 'house_power_entity';
      if (value && entity && !(isPower ? powerValid(entity) : energyValid(entity))) {
        this._notice = isPower ? 'Seleziona un sensore di potenza compatibile (W o kW).' :
          'Seleziona un sensore di energia compatibile (Wh, kWh o MWh).';
        this._render(); return;
      }
      this._save({ [field]: value });
    }
    _change(e) {
      const t = e.target;
      if (t.dataset.check) { this._save({ [t.dataset.check]: t.checked }); return; }
      if (!t.dataset.key) return;
      const field = t.dataset.key;
      if (field.endsWith('_entity')) { this._chooseEntity(field, t.value.trim()); return; }
      const value = field === 'decimals' ? count(t.value) : t.value;
      this._save({ [field]: value });
    }
  }

  if (!customElements.get(TAG)) customElements.define(TAG, EnergyScopeCard);
  if (!customElements.get(EDITOR)) customElements.define(EDITOR, EnergyScopeEditor);
  window.customCards = window.customCards || [];
  if (!window.customCards.some((c) => c.type === TAG)) {
    window.customCards.push({ type: TAG, name: 'Energy Scope Card', description: 'Analisi dei consumi energetici con grafici e confronti, nello stile Edera.', preview: true });
  }
})();