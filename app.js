/* Kalori Harian — PWA pencatat kalori & makro
   Data lokal: IndexedDB. Tanpa server, tanpa build step. */
(function () {
'use strict';

/* ============================================================
   1. Konstanta
   ============================================================ */
const MEALS = [
  { key: 'breakfast', label: 'Sarapan',     emoji: '☕' },
  { key: 'lunch',     label: 'Makan siang', emoji: '\u{1F35B}' },
  { key: 'dinner',    label: 'Makan malam', emoji: '\u{1F957}' },
  { key: 'snack',     label: 'Camilan',     emoji: '\u{1F34E}' }
];
const MEAL_BY_KEY = Object.fromEntries(MEALS.map(m => [m.key, m]));

const DEFAULT_SETTINGS = {
  gender: 'male', age: 28, height: 170, weight: 70,
  activity: 1.375, goal: -550, proteinKg: 1.8, fatPct: 25,
  override: false,
  targets: { kcal: 2000, protein: 140, fat: 60, carbs: 200 },
  split: { breakfast: 25, lunch: 35, dinner: 30, snack: 10 },
  theme: 'auto'
};

const RING_R = 56;
const RING_C = 2 * Math.PI * RING_R;
const RING_SPAN = RING_C * 0.75;   // busur 270 derajat

/* ============================================================
   2. IndexedDB mini-helper
   ============================================================ */
const DB_NAME = 'kalori-harian', DB_VER = 1;
let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('foods')) {
        const s = db.createObjectStore('foods', { keyPath: 'id' });
        s.createIndex('name', 'name');
      }
      if (!db.objectStoreNames.contains('entries')) {
        const s = db.createObjectStore('entries', { keyPath: 'id' });
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('days')) db.createObjectStore('days', { keyPath: 'date' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}
const dbGet    = (s, k)  => tx(s, 'readonly',  st => st.get(k));
const dbAll    = (s)     => tx(s, 'readonly',  st => st.getAll());
const dbPut    = (s, v)  => tx(s, 'readwrite', st => st.put(v));
const dbDel    = (s, k)  => tx(s, 'readwrite', st => st.delete(k));
const dbClear  = (s)     => tx(s, 'readwrite', st => st.clear());
const dbByDate = (s, d)  => tx(s, 'readonly',  st => st.index('date').getAll(IDBKeyRange.only(d)));
const dbRange  = (s,a,b) => tx(s, 'readonly',  st => st.index('date').getAll(IDBKeyRange.bound(a, b)));

/* ============================================================
   3. Util
   ============================================================ */
const $  = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const num = (v, d) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : (d || 0); };
const r0 = (n) => Math.round(n || 0);
const r1 = (n) => Math.round((n || 0) * 10) / 10;
const r2 = (n) => Math.round((n || 0) * 100) / 100;
const fmt = (n) => r0(n).toLocaleString('id-ID');
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

function ymd(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function shiftDay(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
const todayStr = () => ymd(new Date());

function headerLabel(s) {
  const t = todayStr();
  if (s === t) return 'Hari ini';
  if (s === shiftDay(t, -1)) return 'Kemarin';
  return parseYmd(s).toLocaleDateString('id-ID', { weekday: 'long' });
}
function fullDate(s) {
  return parseYmd(s).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}
function longDate(s) {
  const d = parseYmd(s);
  const t = todayStr();
  if (s === t) return 'Hari ini, ' + d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long' });
  if (s === shiftDay(t, -1)) return 'Kemarin, ' + d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long' });
  return d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

/* ============================================================
   4. State
   ============================================================ */
const state = {
  date: todayStr(),
  settings: structuredClone(DEFAULT_SETTINGS),
  entries: [],
  burned: 0,
  foods: [],
  expanded: {}
};

async function loadSettings() {
  const rec = await dbGet('meta', 'settings');
  const s = structuredClone(DEFAULT_SETTINGS);
  if (rec && rec.value) {
    Object.assign(s, rec.value);
    s.targets = Object.assign({}, DEFAULT_SETTINGS.targets, rec.value.targets || {});
    s.split = Object.assign({}, DEFAULT_SETTINGS.split, rec.value.split || {});
  }
  state.settings = s;
}
const saveSettings = () => dbPut('meta', { key: 'settings', value: state.settings });

/* ============================================================
   5. Perhitungan target (Mifflin-St Jeor)
   ============================================================ */
function computeTargets(s) {
  if (s.override) {
    const t = s.targets;
    return { kcal: r0(t.kcal), protein: r0(t.protein), fat: r0(t.fat), carbs: r0(t.carbs), bmr: null, tdee: null };
  }
  const bmr = 10 * s.weight + 6.25 * s.height - 5 * s.age + (s.gender === 'male' ? 5 : -161);
  const tdee = bmr * s.activity;
  const kcal = Math.max(1200, tdee + Number(s.goal));
  const protein = s.proteinKg * s.weight;
  const fat = (kcal * (s.fatPct / 100)) / 9;
  const carbs = Math.max(0, (kcal - protein * 4 - fat * 9) / 4);
  return { kcal: r0(kcal), protein: r0(protein), fat: r0(fat), carbs: r0(carbs), bmr: r0(bmr), tdee: r0(tdee) };
}

function mealTargets(totalKcal, split) {
  const sum = MEALS.reduce((a, m) => a + num(split[m.key]), 0) || 1;
  const out = {};
  MEALS.forEach(m => { out[m.key] = r0(totalKcal * num(split[m.key]) / sum); });
  return out;
}

function totalsOf(entries) {
  return entries.reduce((a, e) => ({
    kcal: a.kcal + num(e.kcal), protein: a.protein + num(e.protein),
    fat: a.fat + num(e.fat), carbs: a.carbs + num(e.carbs)
  }), { kcal: 0, protein: 0, fat: 0, carbs: 0 });
}

/* ============================================================
   6. Memuat data harian
   ============================================================ */
async function loadDay() {
  const [entries, day] = await Promise.all([dbByDate('entries', state.date), dbGet('days', state.date)]);
  entries.sort((a, b) => a.createdAt - b.createdAt);
  state.entries = entries;
  state.burned = day ? num(day.burned) : 0;
}
async function loadFoods() {
  const foods = await dbAll('foods');
  foods.sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0) || a.name.localeCompare(b.name));
  state.foods = foods;
}

/* ============================================================
   7. Render — Hari ini
   ============================================================ */
function renderToday() {
  const t = computeTargets(state.settings);
  const tot = totalsOf(state.entries);
  const remaining = t.kcal + state.burned - tot.kcal;

  $('#todayTitle').textContent = headerLabel(state.date);
  $('#todayDate').textContent = fullDate(state.date);
  $('#nextDay').disabled = state.date >= todayStr();

  $('#statEaten').textContent = fmt(tot.kcal);
  $('#statBurned').textContent = fmt(state.burned);
  $('#statRemaining').textContent = fmt(Math.abs(remaining));
  $('#ringCaption').textContent = remaining < 0 ? 'Kelebihan' : 'Sisa';

  const goal = t.kcal + state.burned;
  const pct = goal > 0 ? clamp(tot.kcal / goal, 0, 1) : 0;
  const ring = $('#ringValue');
  ring.style.strokeDasharray = (RING_SPAN * pct).toFixed(1) + ' ' + RING_C.toFixed(1);
  ring.classList.toggle('over', remaining < 0);

  const macro = (key, got, target) => {
    $('#bar' + key).style.width = (target > 0 ? clamp(got / target, 0, 1) * 100 : 0) + '%';
    $('#val' + key).textContent = r0(got) + ' / ' + r0(target) + ' g';
  };
  macro('Carbs', tot.carbs, t.carbs);
  macro('Protein', tot.protein, t.protein);
  macro('Fat', tot.fat, t.fat);

  const mt = mealTargets(t.kcal, state.settings.split);
  const byMeal = {};
  MEALS.forEach(m => byMeal[m.key] = []);
  state.entries.forEach(e => { (byMeal[e.meal] || byMeal.snack).push(e); });

  $('#mealList').innerHTML = MEALS.map(m => {
    const list = byMeal[m.key];
    const kc = totalsOf(list).kcal;
    const target = mt[m.key];
    const p = target > 0 ? clamp(kc / target, 0, 1) : 0;
    const c = 2 * Math.PI * 19;
    const open = !!state.expanded[m.key] && list.length;
    return `
      <div class="meal">
        <button class="meal-head" data-toggle="${m.key}">
          <span class="meal-ring">
            <svg viewBox="0 0 44 44">
              <circle cx="22" cy="22" r="19" stroke="var(--ring-track)"></circle>
              ${p > 0 ? `<circle cx="22" cy="22" r="19" stroke="${kc > target ? 'var(--fat)' : 'var(--carbs)'}"
                      stroke-dasharray="${(c * p).toFixed(1)} ${c.toFixed(1)}"></circle>` : ''}
            </svg>
            <span class="meal-emoji">${m.emoji}</span>
          </span>
          <span class="meal-info">
            <b>${m.label}</b>
            <span>${fmt(kc)} / ${fmt(target)} kkal${list.length ? ' · ' + list.length + ' item' : ''}</span>
          </span>
          <span class="addbtn" data-add="${m.key}" role="button" aria-label="Tambah ${m.label}">
            <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
          </span>
        </button>
        ${open ? `<div class="meal-entries">${list.map(entryRow).join('')}</div>` : ''}
      </div>`;
  }).join('');

  $('#todayHint').textContent = state.entries.length
    ? 'Ketuk nama waktu makan untuk melihat rinciannya.'
    : 'Belum ada catatan. Ketuk tombol + untuk menambah makanan.';
}

function entryRow(e) {
  const qty = e.qty && e.unit ? `${r2(e.qty)} × ${esc(e.unit)} · ` : '';
  return `
    <div class="entry">
      <span class="entry-main">
        <b>${esc(e.name)}</b>
        <span>${qty}P ${r0(e.protein)} · L ${r0(e.fat)} · K ${r0(e.carbs)}</span>
      </span>
      <span class="entry-kcal">${fmt(e.kcal)}</span>
      <button class="delbtn" data-del="${e.id}" aria-label="Hapus">
        <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>`;
}

/* ============================================================
   8. Render — Riwayat
   ============================================================ */
async function renderHistory() {
  const to = todayStr(), from = shiftDay(to, -13);
  const [entries, days] = await Promise.all([dbRange('entries', from, to), dbAll('days')]);
  const burnedBy = Object.fromEntries(days.map(d => [d.date, num(d.burned)]));
  const t = computeTargets(state.settings);

  const byDate = {};
  for (let i = 0; i < 14; i++) byDate[shiftDay(from, i)] = [];
  entries.forEach(e => { if (byDate[e.date]) byDate[e.date].push(e); });

  const dates = Object.keys(byDate).sort();
  const rows = dates.map(d => ({ date: d, tot: totalsOf(byDate[d]), n: byDate[d].length, burned: burnedBy[d] || 0 }));
  const active = rows.filter(r => r.n > 0);

  $('#avgKcal').textContent = active.length ? fmt(active.reduce((a, r) => a + r.tot.kcal, 0) / active.length) : '0';
  $('#avgProtein').textContent = (active.length ? r0(active.reduce((a, r) => a + r.tot.protein, 0) / active.length) : 0) + ' g';

  const max = Math.max(t.kcal, ...rows.map(r => r.tot.kcal), 1);
  $('#chart').innerHTML = rows.map(r => {
    const h = (r.tot.kcal / max) * 100;
    const d = parseYmd(r.date);
    const cls = r.tot.kcal === 0 ? 'none' : (r.tot.kcal > t.kcal ? 'over' : '');
    return `<div class="cbar ${cls}" title="${r.date}: ${fmt(r.tot.kcal)} kkal">
              <i style="height:${Math.max(2, h)}%"></i><em>${d.getDate()}</em>
            </div>`;
  }).join('');

  const withData = rows.filter(r => r.n > 0 || r.burned).reverse();
  $('#historyList').innerHTML = withData.length ? withData.map(r => `
    <button class="row" data-goto="${r.date}">
      <span class="row-main">
        <b>${esc(longDate(r.date))}</b>
        <span>P ${r0(r.tot.protein)} g · L ${r0(r.tot.fat)} g · K ${r0(r.tot.carbs)} g${r.burned ? ' · \u{1F525} ' + fmt(r.burned) : ''}</span>
      </span>
      <span class="row-right"><b>${fmt(r.tot.kcal)}</b><span>dari ${fmt(t.kcal)}</span></span>
    </button>`).join('')
    : '<p class="empty">Belum ada riwayat.<br>Catat makanan hari ini dulu.</p>';
}

/* ============================================================
   9. Render — Pustaka makanan
   ============================================================ */
function renderFoods() {
  const q = $('#foodSearch').value.trim().toLowerCase();
  const list = q ? state.foods.filter(f => f.name.toLowerCase().includes(q)) : state.foods;
  $('#foodCount').textContent = state.foods.length + ' item tersimpan';
  $('#foodList').innerHTML = list.length ? list.map(f => `
    <button class="row" data-food="${f.id}">
      <span class="row-main">
        <b>${esc(f.name)}</b>
        <span>per ${esc(f.unit)} · P ${r1(f.protein)} · L ${r1(f.fat)} · K ${r1(f.carbs)}</span>
      </span>
      <span class="row-right"><b>${fmt(f.kcal)}</b><span>kkal</span></span>
    </button>`).join('')
    : `<p class="empty">${q ? 'Tidak ada yang cocok.' : 'Pustaka masih kosong.<br>Makanan yang kamu simpan akan muncul di sini.'}</p>`;
}

/* ============================================================
   10. Render — Pengaturan
   ============================================================ */
function fillSettings() {
  const s = state.settings;
  $('#pGender').value = s.gender;
  $('#pAge').value = s.age;
  $('#pHeight').value = s.height;
  $('#pWeight').value = s.weight;
  $('#pActivity').value = String(s.activity);
  $('#pGoal').value = String(s.goal);
  $('#pProteinKg').value = s.proteinKg;
  $('#pFatPct').value = s.fatPct;
  $('#tOverride').checked = !!s.override;
  const t = computeTargets(s);
  $('#tKcal').value = s.targets.kcal;
  $('#tProtein').value = s.targets.protein;
  $('#tFat').value = s.targets.fat;
  $('#tCarbs').value = s.targets.carbs;
  MEALS.forEach(m => { $('#s' + m.key[0].toUpperCase() + m.key.slice(1)).value = s.split[m.key]; });
  $('#pTheme').value = s.theme;
  renderCalcBox(t);
  $('#manualTargets').dataset.disabled = String(!s.override);
  const sum = MEALS.reduce((a, m) => a + num(s.split[m.key]), 0);
  const mt = mealTargets(t.kcal, s.split);
  $('#splitHint').textContent = `Total ${r0(sum)}% → ` +
    MEALS.map(m => `${m.label} ${fmt(mt[m.key])}`).join(' · ') + ' kkal';
}

function renderCalcBox(t) {
  const s = state.settings;
  if (s.override) {
    $('#calcBox').innerHTML = 'Target manual sedang aktif, jadi hasil hitungan di bawah ini tidak dipakai.<br>' +
      `Hitungan: BMR <b>${fmt(computeTargets(Object.assign({}, s, { override: false })).bmr)}</b> kkal.`;
    return;
  }
  $('#calcBox').innerHTML =
    `BMR <b>${fmt(t.bmr)}</b> kkal · TDEE <b>${fmt(t.tdee)}</b> kkal<br>` +
    `Target harian <b>${fmt(t.kcal)}</b> kkal<br>` +
    `Protein <b>${fmt(t.protein)} g</b> · Lemak <b>${fmt(t.fat)} g</b> · Karbo <b>${fmt(t.carbs)} g</b>`;
}

function readSettingsForm() {
  const s = state.settings;
  s.gender = $('#pGender').value;
  s.age = clamp(num($('#pAge').value, 28), 10, 100);
  s.height = clamp(num($('#pHeight').value, 170), 100, 230);
  s.weight = clamp(num($('#pWeight').value, 70), 30, 250);
  s.activity = num($('#pActivity').value, 1.375);
  s.goal = num($('#pGoal').value, 0);
  s.proteinKg = clamp(num($('#pProteinKg').value, 1.8), 0.8, 3);
  s.fatPct = clamp(num($('#pFatPct').value, 25), 15, 45);
  s.override = $('#tOverride').checked;
  s.targets = {
    kcal: Math.max(0, num($('#tKcal').value, 2000)),
    protein: Math.max(0, num($('#tProtein').value, 140)),
    fat: Math.max(0, num($('#tFat').value, 60)),
    carbs: Math.max(0, num($('#tCarbs').value, 200))
  };
  MEALS.forEach(m => {
    s.split[m.key] = clamp(num($('#s' + m.key[0].toUpperCase() + m.key.slice(1)).value, 25), 0, 100);
  });
  s.theme = $('#pTheme').value;
  applyTheme();
  saveSettings();
  const t = computeTargets(s);
  renderCalcBox(t);
  $('#manualTargets').dataset.disabled = String(!s.override);
  const sum = MEALS.reduce((a, m) => a + num(s.split[m.key]), 0);
  const mt = mealTargets(t.kcal, s.split);
  $('#splitHint').textContent = `Total ${r0(sum)}% → ` +
    MEALS.map(m => `${m.label} ${fmt(mt[m.key])}`).join(' · ') + ' kkal';
  renderToday();
}

function applyTheme() {
  const t = state.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

/* ============================================================
   11. Sheet
   ============================================================ */
let sheetStack = [];

function openSheet(title, html, onMount, backFn) {
  $('#sheetTitle').textContent = title;
  $('#sheetBody').innerHTML = html;
  $('#backdrop').hidden = false;
  $('#sheet').hidden = false;
  const back = $('#sheetBack');
  back.hidden = !backFn;
  back.onclick = backFn || null;
  if (onMount) onMount($('#sheetBody'));
  $('#sheetBody').scrollTop = 0;
}
function closeSheet() {
  $('#sheet').hidden = true;
  $('#backdrop').hidden = true;
  $('#sheetBody').innerHTML = '';
  sheetStack = [];
}

/* ---- Tambah makanan ---- */
function openAddSheet(mealKey, tab) {
  const meal = MEAL_BY_KEY[mealKey] || MEALS[0];
  const mode = tab || 'lib';
  const html = `
    <div class="seg" id="addSeg">
      <button data-tab="lib"   class="${mode === 'lib' ? 'on' : ''}">Pustaka</button>
      <button data-tab="new"   class="${mode === 'new' ? 'on' : ''}">Baru</button>
      <button data-tab="quick" class="${mode === 'quick' ? 'on' : ''}">Cepat</button>
    </div>
    <div id="addPane"></div>`;
  openSheet(meal.label, html, (body) => {
    const pane = $('#addPane', body);
    const draw = (m) => {
      $$('#addSeg button', body).forEach(b => b.classList.toggle('on', b.dataset.tab === m));
      if (m === 'lib') drawLib(pane, mealKey);
      else if (m === 'new') drawNewFood(pane, mealKey);
      else drawQuick(pane, mealKey);
    };
    $('#addSeg', body).addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tab]');
      if (b) draw(b.dataset.tab);
    });
    draw(mode);
  });
}

function drawLib(pane, mealKey) {
  pane.innerHTML = `
    <label class="field"><input id="libSearch" type="search" placeholder="Cari di pustaka..." autocomplete="off"></label>
    <div class="sheet-list list" id="libList"></div>`;
  const render = () => {
    const q = $('#libSearch').value.trim().toLowerCase();
    const list = (q ? state.foods.filter(f => f.name.toLowerCase().includes(q)) : state.foods).slice(0, 60);
    $('#libList').innerHTML = list.length ? list.map(f => `
      <button class="row" data-pick="${f.id}">
        <span class="row-main"><b>${esc(f.name)}</b><span>per ${esc(f.unit)}</span></span>
        <span class="row-right"><b>${fmt(f.kcal)}</b><span>kkal</span></span>
      </button>`).join('')
      : `<p class="empty">${q ? 'Tidak ada yang cocok.' : 'Pustaka masih kosong.<br>Pakai tab <b>Baru</b> untuk menambah.'}</p>`;
  };
  $('#libSearch', pane).addEventListener('input', render);
  $('#libList', pane).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-pick]');
    if (!b) return;
    const food = state.foods.find(f => f.id === b.dataset.pick);
    if (food) openQtySheet(food, mealKey);
  });
  render();
}

function foodFormHTML(f) {
  f = f || {};
  return `
    <label class="field"><span>Nama makanan</span>
      <input id="fName" type="text" value="${esc(f.name || '')}" placeholder="Nasi putih" autocomplete="off"></label>
    <label class="field"><span>Takaran acuan</span>
      <input id="fUnit" type="text" value="${esc(f.unit || '100 g')}" placeholder="100 g / 1 porsi / 1 butir"></label>
    <div class="grid2">
      <label class="field"><span>Kalori (kkal)</span><input id="fKcal" type="number" inputmode="decimal" value="${f.kcal != null ? f.kcal : ''}"></label>
      <label class="field"><span>Protein (g)</span><input id="fProtein" type="number" inputmode="decimal" value="${f.protein != null ? f.protein : ''}"></label>
      <label class="field"><span>Lemak (g)</span><input id="fFat" type="number" inputmode="decimal" value="${f.fat != null ? f.fat : ''}"></label>
      <label class="field"><span>Karbo (g)</span><input id="fCarbs" type="number" inputmode="decimal" value="${f.carbs != null ? f.carbs : ''}"></label>
    </div>`;
}
function readFoodForm() {
  const name = $('#fName').value.trim();
  if (!name) { toast('Nama makanan belum diisi'); return null; }
  return {
    name,
    unit: $('#fUnit').value.trim() || '1 porsi',
    kcal: Math.max(0, num($('#fKcal').value)),
    protein: Math.max(0, num($('#fProtein').value)),
    fat: Math.max(0, num($('#fFat').value)),
    carbs: Math.max(0, num($('#fCarbs').value))
  };
}

function drawNewFood(pane, mealKey) {
  pane.innerHTML = foodFormHTML() + `
    <p class="hint" style="margin-top:14px">Isi nilai gizi untuk satu takaran acuan. Nanti tinggal atur jumlah porsinya.</p>
    <div class="btnrow"><button class="btn primary" id="saveFood">Simpan &amp; lanjut</button></div>`;
  $('#saveFood', pane).addEventListener('click', async () => {
    const data = readFoodForm();
    if (!data) return;
    const food = Object.assign({ id: uid(), lastUsed: Date.now(), uses: 0 }, data);
    await dbPut('foods', food);
    await loadFoods();
    toast('Tersimpan di pustaka');
    openQtySheet(food, mealKey);
  });
}

function drawQuick(pane, mealKey) {
  pane.innerHTML = `
    <label class="field"><span>Nama</span><input id="qName" type="text" placeholder="Makan di luar" autocomplete="off"></label>
    <div class="grid2">
      <label class="field"><span>Kalori (kkal)</span><input id="qKcal" type="number" inputmode="decimal"></label>
      <label class="field"><span>Protein (g)</span><input id="qProtein" type="number" inputmode="decimal"></label>
      <label class="field"><span>Lemak (g)</span><input id="qFat" type="number" inputmode="decimal"></label>
      <label class="field"><span>Karbo (g)</span><input id="qCarbs" type="number" inputmode="decimal"></label>
    </div>
    <p class="hint" style="margin-top:14px">Catatan sekali pakai, tidak disimpan ke pustaka.</p>
    <div class="btnrow"><button class="btn primary" id="quickAdd">Tambah</button></div>`;
  $('#quickAdd', pane).addEventListener('click', async () => {
    const name = $('#qName').value.trim() || 'Tanpa nama';
    await addEntry({
      meal: mealKey, name, foodId: null, qty: null, unit: null,
      kcal: Math.max(0, num($('#qKcal').value)),
      protein: Math.max(0, num($('#qProtein').value)),
      fat: Math.max(0, num($('#qFat').value)),
      carbs: Math.max(0, num($('#qCarbs').value))
    });
  });
}

/* ---- Jumlah porsi ---- */
function openQtySheet(food, mealKey) {
  const html = `
    <p class="card-sub" style="margin-bottom:14px">${esc(food.name)} — nilai per ${esc(food.unit)}</p>
    <label class="field"><span>Jumlah (× ${esc(food.unit)})</span>
      <span class="stepper">
        <button type="button" id="minus">−</button>
        <input id="qty" type="number" inputmode="decimal" step="0.25" min="0" value="1">
        <button type="button" id="plus">+</button>
      </span>
    </label>
    <div class="preview" id="prev"></div>
    <label class="field"><span>Waktu makan</span>
      <select id="qMeal">${MEALS.map(m => `<option value="${m.key}" ${m.key === mealKey ? 'selected' : ''}>${m.label}</option>`).join('')}</select>
    </label>
    <div class="btnrow"><button class="btn primary" id="addIt">Tambah ke catatan</button></div>`;

  openSheet('Jumlah porsi', html, (body) => {
    const qtyEl = $('#qty', body);
    const draw = () => {
      const q = Math.max(0, num(qtyEl.value, 0));
      $('#prev', body).innerHTML = `
        <div><strong>${fmt(food.kcal * q)}</strong><span>kkal</span></div>
        <div><strong>${r1(food.protein * q)}</strong><span>protein</span></div>
        <div><strong>${r1(food.fat * q)}</strong><span>lemak</span></div>
        <div><strong>${r1(food.carbs * q)}</strong><span>karbo</span></div>`;
    };
    const bump = (d) => { qtyEl.value = String(Math.max(0, r2(num(qtyEl.value, 0) + d))); draw(); };
    $('#minus', body).addEventListener('click', () => bump(-0.25));
    $('#plus', body).addEventListener('click', () => bump(0.25));
    qtyEl.addEventListener('input', draw);
    $('#addIt', body).addEventListener('click', async () => {
      const q = Math.max(0, num(qtyEl.value, 0));
      if (!q) { toast('Jumlah porsi belum diisi'); return; }
      const meal = $('#qMeal', body).value;
      await addEntry({
        meal, name: food.name, foodId: food.id, qty: q, unit: food.unit,
        kcal: food.kcal * q, protein: food.protein * q, fat: food.fat * q, carbs: food.carbs * q
      });
      food.lastUsed = Date.now();
      food.uses = (food.uses || 0) + 1;
      await dbPut('foods', food);
      await loadFoods();
    });
    draw();
  }, () => openAddSheet(mealKey, 'lib'));
}

/* ---- Edit makanan di pustaka ---- */
function openFoodEditSheet(food) {
  openSheet('Edit makanan', foodFormHTML(food) + `
    <div class="btnrow">
      <button class="btn primary" id="saveEdit">Simpan</button>
      <button class="btn danger" id="delFood">Hapus</button>
    </div>
    <p class="hint" style="margin-top:12px">Mengubah di sini tidak mengubah catatan yang sudah tercatat sebelumnya.</p>`,
  (body) => {
    $('#saveEdit', body).addEventListener('click', async () => {
      const data = readFoodForm();
      if (!data) return;
      await dbPut('foods', Object.assign({}, food, data));
      await loadFoods();
      renderFoods();
      closeSheet();
      toast('Tersimpan');
    });
    $('#delFood', body).addEventListener('click', async () => {
      if (!confirm('Hapus "' + food.name + '" dari pustaka?')) return;
      await dbDel('foods', food.id);
      await loadFoods();
      renderFoods();
      closeSheet();
      toast('Dihapus');
    });
  });
}

/* ---- Kalori terbakar ---- */
function openBurnedSheet() {
  openSheet('Kalori terbakar', `
    <label class="field"><span>Kalori dibakar hari ini (kkal)</span>
      <input id="bVal" type="number" inputmode="numeric" min="0" value="${r0(state.burned) || ''}" placeholder="0"></label>
    <p class="hint" style="margin-top:14px">Isi dari jam tangan atau estimasi latihan. Angka ini menambah sisa kalori harian.</p>
    <div class="btnrow"><button class="btn primary" id="bSave">Simpan</button></div>`,
  (body) => {
    $('#bSave', body).addEventListener('click', async () => {
      state.burned = Math.max(0, num($('#bVal', body).value));
      await dbPut('days', { date: state.date, burned: state.burned });
      renderToday();
      closeSheet();
    });
  });
}

/* ============================================================
   12. Aksi data
   ============================================================ */
async function addEntry(partial) {
  const entry = Object.assign({ id: uid(), date: state.date, createdAt: Date.now() }, partial);
  await dbPut('entries', entry);
  await loadDay();
  state.expanded[entry.meal] = true;
  renderToday();
  closeSheet();
  toast(fmt(entry.kcal) + ' kkal ditambahkan');
}

async function deleteEntry(id) {
  await dbDel('entries', id);
  await loadDay();
  renderToday();
  toast('Dihapus');
}

async function exportData() {
  const [foods, entries, days, meta] = await Promise.all([
    dbAll('foods'), dbAll('entries'), dbAll('days'), dbAll('meta')
  ]);
  const blob = new Blob([JSON.stringify({ app: 'kalori-harian', version: 1, exportedAt: new Date().toISOString(), foods, entries, days, meta }, null, 2)],
    { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'kalori-backup-' + todayStr() + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  $('#dataHint').textContent = `Diexport: ${entries.length} catatan, ${foods.length} makanan.`;
}

async function importData(file) {
  let data;
  try { data = JSON.parse(await file.text()); }
  catch { toast('File tidak bisa dibaca'); return; }
  if (!data || data.app !== 'kalori-harian' || !Array.isArray(data.entries)) {
    toast('Bukan file backup aplikasi ini'); return;
  }
  if (!confirm(`Import akan mengganti seluruh data saat ini dengan ${data.entries.length} catatan dari file. Lanjutkan?`)) return;
  await Promise.all(['foods', 'entries', 'days', 'meta'].map(dbClear));
  for (const f of data.foods || []) await dbPut('foods', f);
  for (const e of data.entries) await dbPut('entries', e);
  for (const d of data.days || []) await dbPut('days', d);
  for (const m of data.meta || []) await dbPut('meta', m);
  await loadSettings(); await loadFoods(); await loadDay();
  applyTheme(); fillSettings(); renderToday(); renderFoods();
  toast('Data berhasil diimport');
}

async function resetAll() {
  if (!confirm('Hapus semua catatan, pustaka makanan dan pengaturan? Tindakan ini tidak bisa dibatalkan.')) return;
  if (!confirm('Yakin? Export dulu kalau belum punya backup.')) return;
  await Promise.all(['foods', 'entries', 'days', 'meta'].map(dbClear));
  state.settings = structuredClone(DEFAULT_SETTINGS);
  state.date = todayStr();
  await loadFoods(); await loadDay();
  applyTheme(); fillSettings(); renderToday(); renderFoods();
  toast('Semua data dihapus');
}

/* ============================================================
   13. Navigasi
   ============================================================ */
function showView(name) {
  ['today', 'history', 'foods', 'settings'].forEach(v => { $('#view-' + v).hidden = v !== name; });
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'history') renderHistory();
  if (name === 'foods') renderFoods();
  if (name === 'settings') fillSettings();
}

async function gotoDate(d) {
  state.date = d;
  state.expanded = {};
  await loadDay();
  renderToday();
  showView('today');
}

/* ============================================================
   14. Event binding
   ============================================================ */
function bind() {
  $$('.tab').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));

  $('#prevDay').addEventListener('click', () => gotoDate(shiftDay(state.date, -1)));
  $('#nextDay').addEventListener('click', () => { if (state.date < todayStr()) gotoDate(shiftDay(state.date, 1)); });
  $('#burnedTap').addEventListener('click', openBurnedSheet);
  $('#burnedTap').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBurnedSheet(); } });

  $('#mealList').addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) { e.stopPropagation(); openAddSheet(add.dataset.add); return; }
    const del = e.target.closest('[data-del]');
    if (del) { deleteEntry(del.dataset.del); return; }
    const head = e.target.closest('[data-toggle]');
    if (head) {
      const k = head.dataset.toggle;
      state.expanded[k] = !state.expanded[k];
      renderToday();
    }
  });

  $('#historyList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-goto]');
    if (b) gotoDate(b.dataset.goto);
  });

  $('#foodSearch').addEventListener('input', renderFoods);
  $('#newFoodBtn').addEventListener('click', () => {
    openSheet('Makanan baru', foodFormHTML() + `
      <div class="btnrow"><button class="btn primary" id="saveNew">Simpan ke pustaka</button></div>`,
    (body) => {
      $('#saveNew', body).addEventListener('click', async () => {
        const data = readFoodForm();
        if (!data) return;
        await dbPut('foods', Object.assign({ id: uid(), lastUsed: Date.now(), uses: 0 }, data));
        await loadFoods(); renderFoods(); closeSheet(); toast('Tersimpan');
      });
    });
  });
  $('#foodList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-food]');
    if (!b) return;
    const f = state.foods.find(x => x.id === b.dataset.food);
    if (f) openFoodEditSheet(f);
  });

  ['#pGender', '#pAge', '#pHeight', '#pWeight', '#pActivity', '#pGoal', '#pProteinKg', '#pFatPct',
   '#tOverride', '#tKcal', '#tProtein', '#tFat', '#tCarbs',
   '#sBreakfast', '#sLunch', '#sDinner', '#sSnack', '#pTheme'
  ].forEach(sel => {
    const el = $(sel);
    el.addEventListener('change', readSettingsForm);
    if (el.tagName === 'INPUT' && el.type === 'number') el.addEventListener('input', readSettingsForm);
  });

  $('#exportBtn').addEventListener('click', exportData);
  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) importData(f);
    e.target.value = '';
  });
  $('#resetBtn').addEventListener('click', resetAll);

  $('#sheetClose').addEventListener('click', closeSheet);
  $('#backdrop').addEventListener('click', closeSheet);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

  // tanggal berganti saat app dibuka lagi dari background
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    const t = todayStr();
    if (state.date !== t && state.date === shiftDay(t, -1)) await gotoDate(t);
  });
}

/* ============================================================
   15. Start
   ============================================================ */
async function init() {
  try {
    await loadSettings();
  } catch (err) {
    document.body.innerHTML = '<p style="padding:40px;text-align:center;line-height:1.6">' +
      'Penyimpanan lokal tidak bisa diakses.<br>Matikan mode penjelajahan pribadi lalu buka lagi.</p>';
    return;
  }
  applyTheme();
  await Promise.all([loadFoods(), loadDay()]);
  bind();
  renderToday();
  showView('today');

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

init();
})();
