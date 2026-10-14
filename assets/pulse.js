/**
 * Pulse · CF-Server-Monitor theme
 * 实时主延迟卡片 + 地标详情侧栏的仪表盘主题，原生 ES Module，无构建依赖。
 * API 约定参考 CF-Server-Monitor theme-develop.md；结构参考 Horizon 主题（MIT）。
 */

// ==================== 1. 常量 ====================
const PROBES = [
  { key: 'ct', ping: 'ping_ct', loss: 'loss_ct', def: '电信' },
  { key: 'cu', ping: 'ping_cu', loss: 'loss_cu', def: '联通' },
  { key: 'cm', ping: 'ping_cm', loss: 'loss_cm', def: '移动' },
  { key: 'bd', ping: 'ping_bd', loss: 'loss_bd', def: 'BGP' },
  { key: 'node_1', ping: 'ping_node_1', loss: 'loss_node_1', def: '节点1' },
  { key: 'node_2', ping: 'ping_node_2', loss: 'loss_node_2', def: '节点2' },
  { key: 'node_3', ping: 'ping_node_3', loss: 'loss_node_3', def: '节点3' },
  { key: 'node_4', ping: 'ping_node_4', loss: 'loss_node_4', def: '节点4' }
];
const PROBE_MAP = Object.fromEntries(PROBES.map(p => [p.key, p]));
const LAT_SPAN_MS = 2 * 3600 * 1000; // 延迟图时间窗口：最近 2 小时（与后端 latency_window 一致）
const LAT_POINTS = 24;          // 卡片延迟图：24 个时间桶（每桶 5 分钟，与历史窗口约 6 分钟的采样间隔匹配）
const DRAWER_POINTS = 40;       // 详情页延迟图：40 个时间桶（每桶 3 分钟）
const PREF_KEY = 'pulse_primary_probe';
const APPEARANCE_KEY = 'pulse_appearance';
const CRED_KEY = 'pulse_ts_cred';

const LANDMARKS = {
  'us-la': '洛杉矶 · Los Angeles',
  'us-ny': '纽约 · New York',
  'us-dc': '华盛顿 · Washington',
  'us-slc': '盐湖城 · Salt Lake City',
  us: '旧金山 · San Francisco',
  de: '纽伦堡 · Nürnberg',
  fr: '巴黎 · Paris',
  gb: '伦敦 · London',
  nl: '阿姆斯特丹 · Amsterdam',
  jp: '东京 · Tokyo',
  hk: '香港 · Hong Kong',
  sg: '新加坡 · Singapore',
  kr: '首尔 · Seoul',
  tw: '台北 · Taipei',
  cn: '上海 · Shanghai',
  default: '数据中心 · Data Center'
};
// 随主题打包的地标图：夜景 assets/landmarks/<key>.jpg（深色模式），白天 <key>-day.jpg（浅色模式）
// 未打包的地区回退到 default / default-day
const SHIPPED_LANDMARKS = new Set(Object.keys(LANDMARKS));
const SHIPPED_DAY_LANDMARKS = new Set(Object.keys(LANDMARKS));
const US_CITY_RULES = [
  [/洛杉矶|los\s?angeles|\blax\b/i, 'us-la'],
  [/新泽西|纽约|new\s?jersey|new\s?york|\bnyc\b|newark|secaucus/i, 'us-ny'],
  [/阿什本|ashburn|华盛顿|washington|virginia|弗吉尼亚|\biad\b/i, 'us-dc'],
  [/盐湖城|salt\s?lake|\bslc\b|utah/i, 'us-slc']
];
const CURRENCY_CODE = { '¥': 'CNY', '￥': 'CNY', 'CNY': 'CNY', 'RMB': 'CNY', '$': 'USD', 'US$': 'USD', 'USD': 'USD', '€': 'EUR', 'EUR': 'EUR', '£': 'GBP', 'GBP': 'GBP', 'HK$': 'HKD', 'HKD': 'HKD', 'NT$': 'TWD', 'TWD': 'TWD', 'JPY': 'JPY', '円': 'JPY', 'C$': 'CAD', 'A$': 'AUD' };
const FALLBACK_CNY = { CNY: 1, USD: 7.1, EUR: 7.8, GBP: 9.1, HKD: 0.91, TWD: 0.22, JPY: 0.048, CAD: 5.2, AUD: 4.7 };
const CYCLE_MONTHS = { month: 1, monthly: 1, quarter: 3, quarterly: 3, half_year: 6, halfyear: 6, semiannual: 6, year: 12, yearly: 12, annual: 12, '2year': 24, biennial: 24, '3year': 36, triennial: 36 };
const CYCLE_LABEL = { 1: '月', 3: '季', 6: '半年', 12: '年', 24: '两年', 36: '三年' };

// ==================== 2. 状态 ====================
const state = {
  config: {},
  themeOptions: {},
  servers: [],
  map: new Map(),
  lat: new Map(),              // serverId -> { probeKey: [{ts, v, loss}] }
  group: 'ALL',
  query: '',
  sort: 'default',
  selectedId: null,
  detail: null,
  history: [],
  historyFor: null,
  wsState: 'connecting',
  speedTrail: [],
  fx: { ...FALLBACK_CNY },
  demo: false,
  prefs: readJSON(PREF_KEY, {}),
  appearance: null
};

// ==================== 3. 工具函数 ====================
function readJSON(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
function writeJSON(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }
const $ = (sel, root = document) => root.querySelector(sel);
function num(v, fb = 0) {
  if (v == null || v === '' || v === false) return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pct = (u, t) => (num(t) > 0 ? clamp(num(u) / num(t) * 100, 0, 100) : 0);
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
function fmtBytes(n, d = 1) {
  let v = Math.abs(num(n));
  if (!v) return '0 B';
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? Math.round(v) : parseFloat(v.toFixed(d))} ${UNITS[i]}`;
}
function fmtSpeed(n) {
  let v = Math.abs(num(n));
  if (!v) return '0 B/s';
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) { v /= 1024; i++; }
  return `${i <= 1 ? Math.round(v) : (v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.round(v))} ${UNITS[i]}/s`;
}
function fmtMB(mb) {
  const v = num(mb);
  if (v >= 1024 * 1024) return `${parseFloat((v / 1048576).toFixed(1))}T`;
  if (v >= 1024) return `${parseFloat((v / 1024).toFixed(1))}G`;
  return `${Math.round(v)}M`;
}
function parseTraffic(val) {
  if (val == null || val === '' || val === '0' || val === 0 || val === '-1' || val === -1) return 0;
  const s = String(val).trim().toUpperCase();
  const n = parseFloat(s);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const mult = /P/.test(s) ? 1125899906842624 : /T/.test(s) ? 1099511627776 : /M/.test(s) ? 1048576 : /K/.test(s) ? 1024 : 1073741824;
  return n * mult;
}
const pad2 = n => String(n).padStart(2, '0');
function fmtClock(d = new Date()) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; }
function fmtDateTime(ts) {
  if (!ts) return '--';
  const d = new Date(num(ts));
  return `${d.getMonth() + 1}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function uptimeDays(s) {
  const boot = num(s.boot_time);
  if (!boot) return null;
  const ms = boot > 1e12 ? boot : boot * 1000;
  return Math.max(0, Math.floor((Date.now() - ms) / 86400000));
}
function isOnline(s) {
  if (!s) return false;
  if (typeof s.is_online === 'boolean') return s.is_online;
  const last = num(s.last_updated || s.timestamp);
  if (!last) return false;
  return Date.now() - last <= Math.max(num(s.report_interval, 60) * 2500, 300000);
}
function probePresent(v) {
  if (v === undefined || v === null || v === false || v === 'false' || v === '') return false;
  const n = num(v, null);
  return n !== null && n > 0;
}
function pulseOpts() {
  const o = state.themeOptions && state.themeOptions.pulse;
  return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
}
// 五级延迟配色：优 / 良 / 中 / 偏高 / 差，阈值可通过 pulse.latency_thresholds 覆盖（4 个数，或旧版 2 个数）
function thresholds() {
  const t = pulseOpts().latency_thresholds;
  if (Array.isArray(t) && t.length === 4) return t.map(Number);
  if (Array.isArray(t) && t.length === 2) return [t[0] * 0.6, t[0], (t[0] + t[1]) / 2, t[1]].map(Number);
  return [60, 100, 160, 200];
}
function latLevel(v) {
  if (!probePresent(v)) return 'muted';
  const [a, b, c, d] = thresholds();
  return v < a ? 'ok' : v < b ? 'good' : v < c ? 'mid' : v < d ? 'warn' : 'danger';
}
function usageLevel(p) { return p >= 90 ? 'danger' : p >= 75 ? 'warn' : ''; }
function probeName(key) {
  const cfg = state.config || {};
  const ck = key.startsWith('node_') ? `${key}_name` : `custom_${key}_name`;
  const v = cfg[ck];
  return typeof v === 'string' && v.trim() ? v.trim() : PROBE_MAP[key].def;
}
function region(s) { return String(s.region || '').trim().toUpperCase(); }
function flagUrl(code) { return code ? `${API_BASE}/flags/${code.toLowerCase()}.svg` : ''; }
function monthlyTraffic(s) {
  const rx = num(s.net_rx_monthly), tx = num(s.net_tx_monthly);
  const t = String(s.traffic_calc_type || 'total');
  return t === 'dl' ? rx : t === 'ul' ? tx : t === 'max' ? Math.max(rx, tx) : rx + tx;
}
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), 2400);
}

// ==================== 4. API Client & Turnstile ====================
function resolveApiBase() {
  const meta = document.querySelector('meta[name="apiBase"]');
  const raw = (meta && meta.content) || window.__API_BASE__ || '';
  const first = String(raw).split(',')[0].trim();
  return (first || window.location.origin).replace(/\/+$/, '');
}
const API_BASE = resolveApiBase();
function token() { try { return localStorage.getItem('jwt_token') || localStorage.getItem('token'); } catch { return null; } }
function loadCred() {
  try {
    const official = localStorage.getItem('turnstile_verified');
    if (official) return official;
    const obj = JSON.parse(localStorage.getItem(CRED_KEY) || 'null');
    if (!obj || Date.now() - obj.savedAt > 55 * 60000) return null;
    return obj.value;
  } catch { return null; }
}
function saveCred(v) {
  try { localStorage.setItem('turnstile_verified', v); localStorage.setItem(CRED_KEY, JSON.stringify({ value: v, savedAt: Date.now() })); } catch {}
}
function authHeaders() {
  const h = {};
  const t = token();
  if (t) h.Authorization = `Bearer ${t}`;
  const c = loadCred();
  if (c) h['X-Turnstile-Verified'] = c;
  return h;
}
async function request(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include', ...opts, headers: { ...authHeaders(), ...(opts.headers || {}) } });
  if (res.status === 403 && state.config.turnstile_enabled && !opts._retried) {
    await ensureTurnstile();
    return request(path, { ...opts, _retried: true });
  }
  if (!res.ok) {
    let data = null;
    try { data = await res.json(); } catch {}
    const err = new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}
let tsPromise = null;
function ensureTurnstile() {
  if (loadCred() || !state.config.turnstile_site_key) return Promise.resolve();
  if (tsPromise) return tsPromise;
  tsPromise = new Promise((resolve, reject) => {
    const boot = () => {
      const ov = document.createElement('div');
      ov.className = 'overlay';
      ov.innerHTML = `<div class="dialog"><h3>安全验证</h3><p>站点已开启人机验证，请完成验证后查看探针数据。</p><div id="ts-holder"></div><p id="ts-err" class="c-danger"></p></div>`;
      $('#overlay-root').append(ov);
      window.turnstile.render($('#ts-holder', ov), {
        sitekey: state.config.turnstile_site_key,
        theme: document.documentElement.dataset.appearance === 'light' ? 'light' : 'dark',
        callback: async (tk) => {
          try {
            const res = await fetch(`${API_BASE}/api/config`, { credentials: 'include', headers: { ...authHeaders(), 'X-Turnstile-Token': tk } });
            const data = await res.json();
            if (data.turnstile_verified) saveCred(data.turnstile_verified);
            applyConfig(data);
            ov.remove();
            resolve();
          } catch {
            $('#ts-err', ov).textContent = '验证失败，请重试';
            try { window.turnstile.reset(); } catch {}
          }
        },
        'error-callback': () => { $('#ts-err', ov).textContent = '验证组件出错，请刷新页面'; }
      });
    };
    if (window.turnstile) return boot();
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = boot;
    s.onerror = () => reject(new Error('Turnstile 加载失败'));
    document.head.append(s);
  }).finally(() => { tsPromise = null; });
  return tsPromise;
}
async function saveThemeOptions(next) {
  const res = await request('/api/theme_options', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ theme_options: next })
  });
  state.themeOptions = res.theme_options || next;
  return state.themeOptions;
}

// ==================== 5. WebSocket ====================
class MetricSocket {
  constructor(ids) {
    this.ids = ids;
    this.retry = 0;
    this.closed = false;
    this.ws = null;
    this.timer = null;
    this.ping = null;
    this.limitTimer = null;
    this.connect();
  }
  url() {
    let base = API_BASE.replace(/^http/, 'ws');
    let url = `${base}/api/ws?subscribe=all`;
    const sameHost = new URL(API_BASE).host === location.host;
    const t = token();
    if (t && !sameHost) url += `&token=${encodeURIComponent(t)}`;
    return url;
  }
  connect() {
    if (this.closed) return;
    setLive('connecting');
    try { this.ws = new WebSocket(this.url()); } catch { this.schedule(); return; }
    this.ws.onopen = () => {
      this.retry = 0;
      setLive('open');
      this.send({ type: 'subscribe', scope: 'all', ids: this.ids.slice(0, 500) });
      this.ping = setInterval(() => this.send({ type: 'ping', ts: Date.now() }), 25000);
      const minutes = num(state.config.frontend_ws_timeout_minutes);
      clearTimeout(this.limitTimer);
      if (minutes > 0) this.limitTimer = setTimeout(() => pauseRealtime(), minutes * 60000);
    };
    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg && msg.type === 'batchUpdate') applyBatch(msg);
      } catch {}
    };
    this.ws.onclose = () => { clearInterval(this.ping); if (!this.closed) this.schedule(); };
    this.ws.onerror = () => { try { this.ws.close(); } catch {} };
  }
  send(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }
  setIds(ids) { this.ids = ids; this.send({ type: 'subscribe', scope: 'all', ids: ids.slice(0, 500) }); }
  schedule() {
    setLive('closed');
    const delay = Math.min(30000, 1000 * 2 ** this.retry++);
    this.timer = setTimeout(() => this.connect(), delay);
  }
  close() {
    this.closed = true;
    clearTimeout(this.timer);
    clearTimeout(this.limitTimer);
    clearInterval(this.ping);
    try { this.ws && this.ws.close(); } catch {}
  }
}
let socket = null;
let pollTimer = null;
function startRealtime() {
  stopRealtime();
  if (state.demo) { setLive('open'); return; }
  socket = new MetricSocket(state.servers.map(s => s.id));
  // WebSocket 15 秒仍未连上时，启用 REST 轮询兜底
  pollTimer = setInterval(() => {
    if (state.wsState !== 'open') loadServers().catch(() => {});
  }, 15000);
}
function stopRealtime() {
  if (socket) socket.close();
  socket = null;
  clearInterval(pollTimer);
}
function pauseRealtime() {
  stopRealtime();
  setLive('paused');
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="dialog"><h3>实时连接已暂停</h3><p>已达到站点设置的实时连接时长上限。是否继续接收实时数据？</p><div class="dialog__actions"><button class="btn" data-a="stay">保持暂停</button><button class="btn btn--primary" data-a="go">继续连接</button></div></div>`;
  ov.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]');
    if (!a) return;
    ov.remove();
    if (a.dataset.a === 'go') loadServers().finally(startRealtime);
  });
  $('#overlay-root').append(ov);
}
function setLive(s) {
  state.wsState = s;
  const el = $('#live-indicator');
  if (!el) return;
  el.dataset.state = s;
  $('#live-text').textContent = state.demo ? '演示数据' : ({ open: '实时 · WSS', connecting: '连接中', closed: '重连中', polling: '轮询', paused: '已暂停' }[s] || s);
}

// ==================== 6. 实时延迟缓冲 ====================
function latStore(id) {
  if (!state.lat.has(id)) state.lat.set(id, {});
  return state.lat.get(id);
}
function pushLatency(id, ts, data) {
  const store = latStore(id);
  for (const p of PROBES) {
    if (!(p.ping in data) && !(p.loss in data)) continue;
    const v = data[p.ping];
    const arr = store[p.key] || (store[p.key] = []);
    const last = arr[arr.length - 1];
    if (last && last.ts === ts) continue;
    arr.push({ ts, v: probePresent(v) ? num(v) : null, loss: num(data[p.loss], 0) });
    // 只保留最近 LAT_SPAN_MS 的点（图表按时间分桶），并限制内存占用
    const cutoff = Date.now() - LAT_SPAN_MS;
    while (arr.length && arr[0].ts < cutoff) arr.shift();
    if (arr.length > 2000) arr.splice(0, arr.length - 2000);
  }
}
function seedLatency(s) {
  const store = latStore(s.id);
  if (Array.isArray(s.ping) && s.ping.length) {
    for (const key of PROBES.map(p => p.key)) {
      if (store[key] && store[key].length) continue;
      store[key] = s.ping
        .filter(pt => pt && pt.ts)
        .map(pt => ({ ts: num(pt.ts), v: probePresent(pt[key]) ? num(pt[key]) : null, loss: 0 }))
        .filter(pt => pt.v !== null);
      if (!store[key].length) delete store[key];
    }
  }
  pushLatency(s.id, num(s.last_updated || s.timestamp, Date.now()), s);
}
function availableProbes(s) {
  const store = latStore(s.id);
  return PROBES.filter(p => probePresent(s[p.ping]) || (store[p.key] || []).some(x => x.v !== null));
}
function primaryProbe(s) {
  const avail = availableProbes(s);
  if (!avail.length) return null;
  const to = pulseOpts();
  const wanted = [state.prefs[s.id], (to.primary_overrides || {})[s.id], state.prefs.__global, to.primary_probe, 'ct'];
  for (const k of wanted) {
    if (k && avail.some(p => p.key === k)) return PROBE_MAP[k];
  }
  return avail[0];
}
// 把最近 2 小时的点按固定时间桶聚合：历史窗口（约 6 分钟一个点）与实时推送点落在同一条时间轴上
function series(s, key, n) {
  const now = Date.now();
  const start = now - LAT_SPAN_MS;
  const size = LAT_SPAN_MS / n;
  const buckets = Array.from({ length: n }, () => null);
  for (const p of latStore(s.id)[key] || []) {
    if (p.ts < start) continue;
    const i = clamp(Math.floor((p.ts - start) / size), 0, n - 1);
    const b = buckets[i] || (buckets[i] = { sum: 0, count: 0, loss: false, ts: p.ts });
    if (p.v === null) { b.loss = true; continue; }
    b.sum += p.v;
    b.count++;
    b.ts = p.ts;
  }
  const out = buckets.map(b => (!b ? null : { ts: b.ts, v: b.count ? Math.round(b.sum / b.count) : null, loss: b.loss && !b.count }));
  // 采样间隔造成的 1–2 个空桶用前一个值补齐（半透明显示），真正的长时间中断仍保留空缺
  for (let i = 1; i < out.length; i++) {
    if (out[i] || !out[i - 1] || out[i - 1].v === null) continue;
    const next = out.slice(i + 1, i + 3).findIndex(Boolean);
    if (next === -1) continue;
    for (let k = 0; k <= next; k++) out[i + k] = { ...out[i - 1], filled: true };
    i += next;
  }
  return out;
}
function barsHtml(s, key, n, height) {
  const pts = series(s, key, n);
  const vals = pts.filter(p => p && p.v !== null).map(p => p.v);
  if (!vals.length) return `<div class="bars bars--empty" style="height:${height}px">等待探测数据…</div>`;
  // 自适应纵轴：以窗口内最小 / 最大值为范围，让波动清晰可见
  const hi = Math.max(...vals), lo = Math.min(...vals);
  const range = Math.max(hi - lo, hi * 0.2, 10);
  const base = Math.max(0, lo - range * 0.8);
  return `<div class="bars" style="height:${height}px">${pts.map(p => {
    if (!p) return '<i class="is-gap"></i>';
    if (p.v === null) return '<i class="is-loss" title="丢包 / 超时"></i>';
    const lv = latLevel(p.v);
    const h = 18 + (p.v - base) / Math.max(1, hi - base) * 82;
    return `<i class="bg-${lv}${p.filled ? ' is-filled' : ''}" style="height:${clamp(h, 12, 100).toFixed(1)}%" title="${p.v} ms · ${fmtDateTime(p.ts)}"></i>`;
  }).join('')}</div>`;
}

// ==================== 7. 地标 ====================
function landmarkKey(s) {
  const custom = pulseOpts().landmarks || {};
  const code = region(s).toLowerCase();
  const text = `${s.name || ''} ${s.server_group || ''} ${s.tags || ''}`;
  if (code === 'us' || /美国|\bus\b/i.test(text)) {
    for (const [re, key] of US_CITY_RULES) if (re.test(text)) return key;
    return 'us';
  }
  if (custom[code] || SHIPPED_LANDMARKS.has(code)) return code;
  if (/德国|germany|\bde\b/i.test(text)) return 'de';
  return 'default';
}
// 深色模式用黄昏 / 夜景（<key>.jpg），浅色模式用晴朗白天（<key>-day.jpg）
function landmarkUrl(s) {
  const custom = pulseOpts().landmarks || {};
  const key = landmarkKey(s);
  const light = state.appearance === 'light';
  const pick = (v) => (v && typeof v === 'object' ? (light ? v.light || v.dark : v.dark || v.light) : v);
  const override = pick(custom[s.id]) || pick(custom[key]);
  if (override) return override;
  const base = light && SHIPPED_DAY_LANDMARKS.has(key) ? `${key}-day` : (SHIPPED_LANDMARKS.has(key) ? key : (light ? 'default-day' : 'default'));
  return new URL(`./landmarks/${base}.jpg`, import.meta.url).href;
}

// ==================== 8. 小鸡价值 ====================
function priceInfo(s) {
  const raw = String(s.price ?? '').trim();
  if (!raw) return null;
  const p = num(raw, 0);
  if (p <= 0) return { free: true, text: '免费', monthlyCny: 0 };
  const cur = String(s.currency || '¥').trim();
  const code = CURRENCY_CODE[cur] || CURRENCY_CODE[cur.toUpperCase()] || 'CNY';
  const months = CYCLE_MONTHS[String(s.billing_cycle || 'month').toLowerCase()] || 1;
  const label = CYCLE_LABEL[months] || '月';
  const amount = parseFloat(p.toFixed(2));
  return { text: `${cur}${amount}/${label}`, monthlyCny: amount * (state.fx[code] || FALLBACK_CNY[code] || 1) / months, code, months, amount };
}
function expireInfo(s) {
  const d = String(s.expire_date || '').trim();
  if (!d) return null;
  const t = Date.parse(d);
  if (!Number.isFinite(t)) return null;
  const days = Math.ceil((t - Date.now()) / 86400000);
  return { date: d.slice(0, 10), days };
}
async function loadFx() {
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=CNY');
    const data = await res.json();
    for (const [code, rate] of Object.entries(data.rates || {})) {
      if (rate > 0) state.fx[code] = 1 / rate;
    }
    renderOverview();
  } catch {}
}

// ==================== 9. 渲染：总览 / 分组 / 卡片 ====================
const ICONS = {
  server: '<path d="M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  down: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.6-1-1.7-1.5-3-1.5-1.7 0-3 .9-3 2s1.3 1.7 3 2 3 .9 3 2-1.3 2-3 2c-1.3 0-2.4-.5-3-1.5M12 6v2M12 16v2"/>',
  caret: '<path d="m6 9 6 6 6-6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  pin: '<path d="M12 21s-7-6.1-7-11a7 7 0 1 1 14 0c0 4.9-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
  layers: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/>',
  landmark: '<path d="M3 21h18M5 21V10M19 21V10M9 21v-7M15 21v-7M2 10l10-7 10 7"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>'
};
const icon = (name, cls = 'i') => `<svg viewBox="0 0 24 24" class="${cls}">${ICONS[name] || ''}</svg>`;

function renderOverview() {
  const list = state.servers;
  const online = list.filter(isOnline);
  const up = list.reduce((a, s) => a + num(s.net_out_speed), 0);
  const down = list.reduce((a, s) => a + num(s.net_in_speed), 0);
  const rx = list.reduce((a, s) => a + num(s.net_rx), 0);
  const tx = list.reduce((a, s) => a + num(s.net_tx), 0);
  const cpuAvg = online.length ? online.reduce((a, s) => a + num(s.cpu), 0) / online.length : 0;
  const memAvg = online.length ? online.reduce((a, s) => a + pct(s.ram_used, s.ram_total), 0) / online.length : 0;
  let monthly = 0, remain = 0, priced = 0;
  for (const s of list) {
    const p = priceInfo(s);
    if (!p || p.free) continue;
    priced++;
    monthly += p.monthlyCny;
    const e = expireInfo(s);
    if (e && e.days > 0) remain += p.monthlyCny * e.days / 30.4;
  }
  const offline = list.filter(s => !isOnline(s));
  const trail = state.speedTrail;
  // 走势需要至少 6 个采样点才绘制，之前显示「采集中」，避免只有一根柱子
  const spark = key => {
    if (trail.length < 6) return `<div class="spark spark--empty">采集中 · ${trail.length}/6</div>`;
    const vals = trail.map(t => t[key]);
    const hi = Math.max(1, ...vals), lo = Math.min(...vals);
    const base = Math.max(0, lo - (hi - lo) * 0.6);
    return `<div class="spark">${vals.map(v => `<i style="height:${clamp(15 + (v - base) / Math.max(1, hi - base) * 85, 8, 100).toFixed(0)}%;background:var(--${key})"></i>`).join('')}</div>`;
  };
  const cards = [
    ['server', '当前在线', `${online.length}<small>/ ${list.length}</small>`, offline.length ? `<span class="c-danger">${offline.length} 离线</span> · ${esc(offline.slice(0, 2).map(s => s.name).join(', '))}` : `在线率 ${list.length ? Math.round(online.length / list.length * 100) : 0}% · 全部正常`, `<div class="meter"><span style="width:${list.length ? online.length / list.length * 100 : 0}%;background:var(--ok)"></span></div>`],
    ['up', '实时上行', fmtSpeed(up).replace(/ (\S+)$/, '<small>$1</small>'), `峰值 ${fmtSpeed(Math.max(up, ...trail.map(t => t.up)))}`, spark('up')],
    ['down', '实时下行', fmtSpeed(down).replace(/ (\S+)$/, '<small>$1</small>'), `峰值 ${fmtSpeed(Math.max(down, ...trail.map(t => t.down)))}`, spark('down')],
    ['db', '累计流量', fmtBytes(rx + tx, 2).replace(/ (\S+)$/, '<small>$1</small>'), `↓ ${fmtBytes(rx)} · ↑ ${fmtBytes(tx)}`, `<div class="meter"><span style="width:${rx + tx ? rx / (rx + tx) * 100 : 50}%;background:var(--down)"></span></div>`],
    ['cpu', '平均负载', `${Math.round(cpuAvg)}%<small>/ ${Math.round(memAvg)}%</small>`, `CPU / 内存 · ${online.length} 台在线均值`, `<div class="meter"><span style="width:${cpuAvg}%;background:var(--cpu)"></span></div>`],
    ['coin', '小鸡价值', `¥${Math.round(monthly)}<small>/月</small>`, priced ? `剩余价值 ¥${Math.round(remain)} · ${priced} 台计费` : '未设置价格', `<div class="meter"><span style="width:${monthly ? clamp(remain / (monthly * 12) * 100, 0, 100) : 0}%;background:var(--mem)"></span></div>`]
  ];
  $('#overview').innerHTML = cards.map(([ic, label, value, sub, extra]) => `
    <div class="stat">
      <div class="stat__head"><span>${label}</span>${icon(ic)}</div>
      <div class="stat__value">${value}</div>
      ${extra}
      <div class="stat__sub">${sub}</div>
    </div>`).join('');
}

function groups() {
  const counts = new Map();
  for (const s of state.servers) {
    const g = String(s.server_group || '').trim() || '未分组';
    counts.set(g, (counts.get(g) || 0) + 1);
  }
  return counts;
}
function renderTabs() {
  const counts = groups();
  if (state.group !== 'ALL' && !counts.has(state.group)) state.group = 'ALL';
  const items = [['ALL', '全部', state.servers.length], ...[...counts].map(([g, c]) => [g, g, c])];
  $('#group-tabs').innerHTML = items.map(([k, label, c]) => `<button class="tab ${state.group === k ? 'is-active' : ''}" data-group="${esc(k)}" type="button">${esc(label)} <b>${c}</b></button>`).join('');
}
function filtered() {
  const q = state.query.trim().toLowerCase();
  let list = state.servers.filter(s => {
    const g = String(s.server_group || '').trim() || '未分组';
    if (state.group !== 'ALL' && g !== state.group) return false;
    if (!q) return true;
    return [s.name, s.server_group, s.region, s.os, s.tags].some(v => String(v || '').toLowerCase().includes(q));
  });
  const key = {
    cpu: s => -num(s.cpu),
    mem: s => -pct(s.ram_used, s.ram_total),
    traffic: s => -monthlyTraffic(s),
    latency: s => { const p = primaryProbe(s); return p && probePresent(s[p.ping]) ? num(s[p.ping]) : 1e9; }
  }[state.sort];
  if (key) list = list.slice().sort((a, b) => key(a) - key(b));
  return list;
}

// 紧凑资源行：标签 | 进度条 | 百分比；具体用量放在悬停提示里（详情侧栏有完整数值）
function resRow(label, detail, p, color, valueText) {
  const lv = usageLevel(p);
  const bar = lv === 'danger' ? 'var(--danger)' : `var(--${color})`;
  return `<div class="row" title="${esc(detail ? `${label} ${detail}` : label)}"><span class="row__l">${label}</span><div class="meter"><span style="width:${Math.max(p > 0 ? 1.5 : 0, p)}%;background:${bar}"></span></div><span class="row__v ${lv ? 'is-' + lv : ''}">${valueText ?? Math.round(p) + '%'}</span></div>`;
}
function cardHtml(s) {
  const on = isOnline(s);
  const days = uptimeDays(s);
  const code = region(s);
  const cpu = num(s.cpu), mem = pct(s.ram_used, s.ram_total), disk = pct(s.disk_used, s.disk_total);
  const limit = parseTraffic(s.traffic_limit);
  const used = monthlyTraffic(s);
  const tp = limit ? pct(used, limit) : 0;
  const prim = primaryProbe(s);
  const now = prim ? s[prim.ping] : null;
  const lv = latLevel(now);
  const price = state.config.show_price === false ? null : priceInfo(s);
  const exp = expireInfo(s);
  const cores = num(s.cpu_cores);
  const alerts = [];
  if (on && cpu >= 90) alerts.push('CPU 过高');
  if (on && mem >= 90) alerts.push('内存过高');
  if (limit && tp >= 90) alerts.push('流量将满');
  const specs = [cores ? `${cores}C` : '', s.ram_total ? fmtMB(s.ram_total) : '', s.disk_total ? fmtMB(s.disk_total) : ''].filter(Boolean).join(' · ');
  const expText = exp ? (exp.days < 0 ? '<span class="c-danger">已过期</span>' : `余 ${exp.days} 天`) : '';
  return `
    <div class="card__head">
      <div class="card__title">
        <span class="dot ${on ? '' : 'is-off'}"></span>
        <span class="card__name" title="${esc(s.name)}">${esc(s.name)}</span>
        ${alerts.map(a => `<span class="tag tag--warn">${a}</span>`).join('')}
        <span class="card__uptime ${on ? '' : 'is-off'}">${on ? (days !== null ? `${days} 天` : '在线') : '离线'}</span>
      </div>
      <div class="card__meta">
        ${code ? `<span class="tag"><img src="${flagUrl(code)}" alt="" onerror="this.remove()">${esc(code)}</span>` : ''}
        ${specs ? `<span class="mono">${specs}</span>` : ''}
        ${price || expText ? `<span class="card__price">${price ? esc(price.text) : ''}${price && expText ? ' · ' : ''}${expText}</span>` : ''}
      </div>
    </div>
    <div class="rows">
      ${resRow('CPU', cores ? `${cores} 核` : '', cpu, 'cpu')}
      ${resRow('内存', s.ram_total ? `${fmtMB(s.ram_used)} / ${fmtMB(s.ram_total)}` : '', mem, 'mem')}
      ${resRow('磁盘', s.disk_total ? `${fmtMB(s.disk_used)} / ${fmtMB(s.disk_total)}` : '', disk, 'disk')}
      ${state.config.show_tf === false ? '' : resRow('流量', `${fmtBytes(used)} / ${limit ? fmtBytes(limit) : '不限'}`, tp, tp >= 90 ? 'warn' : 'down', limit ? undefined : fmtBytes(used))}
    </div>
    <div class="netline">
      <span><b style="color:var(--up)">↑</b> ${on ? fmtSpeed(s.net_out_speed) : '--'}</span>
      <span><b style="color:var(--down)">↓</b> ${on ? fmtSpeed(s.net_in_speed) : '--'}</span>
    </div>
    <div class="lat">
      <div class="lat__head">
        <span class="lat__dot bg-${lv}"></span>
        ${prim ? `<button class="probe-chip" type="button" data-probe-for="${esc(s.id)}" title="切换主延迟探测点">${esc(probeName(prim.key))}${icon('caret')}</button>` : '<span class="c-muted">未配置探测</span>'}
        <span class="lat__loss">${prim && probePresent(s[prim.loss]) ? `丢包 ${num(s[prim.loss])}%` : ''}</span>
        <span class="lat__now c-${lv}">${probePresent(now) ? `${Math.round(num(now))} ms` : '--'}</span>
      </div>
      ${prim ? barsHtml(s, prim.key, LAT_POINTS, 20) : '<div class="bars bars--empty" style="height:20px">—</div>'}
    </div>`;
}

const cardEls = new Map();
function renderGrid() {
  const grid = $('#server-grid');
  const list = filtered();
  const keep = new Set(list.map(s => s.id));
  for (const [id, el] of cardEls) {
    if (!keep.has(id)) { el.remove(); cardEls.delete(id); }
  }
  list.forEach((s, i) => {
    let el = cardEls.get(s.id);
    if (!el) {
      el = document.createElement('article');
      el.className = 'card';
      el.dataset.id = s.id;
      cardEls.set(s.id, el);
    }
    el.classList.toggle('is-selected', s.id === state.selectedId);
    el.classList.toggle('is-offline', !isOnline(s));
    el.innerHTML = cardHtml(s);
    if (grid.children[i] !== el) grid.insertBefore(el, grid.children[i] || null);
  });
  $('#empty-state').classList.toggle('hidden', list.length > 0);
  const on = state.servers.filter(isOnline).length;
  $('#fleet-head').innerHTML = `<strong>服务器</strong><span class="pill pill--mono">${list.length}</span>
    <span><span class="c-ok">●</span> ${on} 在线</span><span><span class="c-danger">●</span> ${state.servers.length - on} 离线</span>
    ${state.selectedId && state.map.has(state.selectedId) ? `<span class="sel pill" style="border-color:rgba(59,130,246,.4);color:var(--text)">已选中 ${esc(state.map.get(state.selectedId).name)} · Esc 关闭</span>` : ''}`;
}
function updateCard(id) {
  const el = cardEls.get(id);
  const s = state.map.get(id);
  if (!el || !s) return;
  el.classList.toggle('is-offline', !isOnline(s));
  el.innerHTML = cardHtml(s);
}

// ==================== 10. 渲染：详情侧栏 ====================
function drawerHtml(s) {
  const on = isOnline(s);
  const d = { ...s, ...(state.detail && state.detail.id === s.id ? state.detail : {}) };
  const list = filtered();
  const idx = list.findIndex(x => x.id === s.id);
  const code = region(d);
  const lmKey = landmarkKey(d);
  const cpu = num(d.cpu), mem = pct(d.ram_used, d.ram_total), disk = pct(d.disk_used, d.disk_total);
  const prim = primaryProbe(d);
  const probes = availableProbes(d);
  const days = uptimeDays(d);
  const price = priceInfo(d);
  const exp = expireInfo(d);
  const limit = parseTraffic(d.traffic_limit);
  const used = monthlyTraffic(d);
  const meta = [d.os, d.arch, d.cpu_cores ? `${d.cpu_cores} 核` : '', d.ram_total ? `${fmtMB(d.ram_total)} 内存` : '', d.disk_total ? `${fmtMB(d.disk_total)} 磁盘` : ''].filter(Boolean);
  const alert = on && cpu >= 90 ? `CPU 负载过高 · ${Math.round(cpu)}%` : on && mem >= 90 ? `内存占用过高 · ${Math.round(mem)}%` : limit && pct(used, limit) >= 90 ? `月流量已用 ${Math.round(pct(used, limit))}%` : '';
  const tiles = [['CPU', cpu, d.cpu_cores ? `${d.cpu_cores} 核 · 负载 ${String(d.load_avg || '').split(/\s+/)[0] || '--'}` : '', 'cpu'], ['内存', mem, d.ram_total ? `${fmtMB(d.ram_used)} / ${fmtMB(d.ram_total)}` : '', 'mem'], ['磁盘', disk, d.disk_total ? `${fmtMB(d.disk_used)} / ${fmtMB(d.disk_total)}` : '', 'disk']];
  return `
    <div class="hero" style="background-image:url('${esc(landmarkUrl(d))}')">
      <div class="hero__top">
        <span class="hero__sel glass">已选中</span>
        <span class="hero__nav glass">
          <button type="button" data-nav="-1" title="上一台">${icon('left')}</button>
          <span>${idx + 1} / ${list.length}</span>
          <button type="button" data-nav="1" title="下一台">${icon('right')}</button>
        </span>
        <button class="hero__close glass" type="button" data-close title="关闭 (Esc)">${icon('x')}</button>
      </div>
      <div>
        <div class="hero__name"><span class="dot ${on ? '' : 'is-off'}"></span><h2>${esc(d.name)}</h2>${code ? `<span class="tag glass"><img src="${flagUrl(code)}" alt="" onerror="this.remove()">${esc(code)}</span>` : ''}</div>
        <div class="hero__meta">
          ${meta.map(esc).join('<span class="meta-sep">·</span>')}
          <span class="${on ? 'c-ok' : 'c-danger'}">${on ? (days !== null ? `在线 ${days} 天` : '在线') : '离线'}</span>
          <span class="land">${icon('landmark')}${esc(LANDMARKS[lmKey] || '')}</span>
        </div>
      </div>
    </div>
    <div class="drawer__body">
      ${alert ? `<div class="banner banner--warn">${icon('cpu')}<span>${alert}</span></div>` : `<div class="banner banner--ok">${icon('check')}<span>${on ? `运行正常 · 最后上报 ${fmtDateTime(d.last_updated || d.timestamp)}` : `节点离线 · 最后上报 ${fmtDateTime(d.last_updated || d.timestamp)}`}</span></div>`}
      <div class="tiles">${tiles.map(([l, v, sub, c]) => `
        <div class="tile ${v >= 90 ? 'is-warn' : ''}">
          <div class="tile__head"><span>${l}</span>${v >= 90 ? '<span class="c-warn mono">&gt; 90%</span>' : ''}</div>
          <div class="tile__val ${v >= 90 ? 'c-warn' : ''}">${Math.round(v)}<small>%</small></div>
          <div class="meter"><span style="width:${v}%;background:var(--${c})"></span></div>
          <div class="tile__sub">${sub}</div>
        </div>`).join('')}
      </div>
      <div>
        <div class="section-head">实时延迟 <small>${probes.length} 个探测点 · 最近 2 小时</small><button class="link r" type="button" data-probe-for="${esc(d.id)}">设置主延迟</button></div>
        <div class="probes" style="margin-top:12px">
          ${probes.length ? probes.map(p => {
            const v = d[p.ping];
            return `<div class="probe">
              <div class="probe__name"><span>${esc(probeName(p.key))}</span>${prim && prim.key === p.key ? '<span class="badge">主延迟</span>' : ''}</div>
              ${barsHtml(d, p.key, DRAWER_POINTS, 30)}
              <div class="probe__now c-${latLevel(v)}">${probePresent(v) ? Math.round(num(v)) + ' ms' : '--'}</div>
              <div class="probe__loss">${probePresent(d[p.loss]) ? num(d[p.loss]) + '%' : '0%'}</div>
            </div>`;
          }).join('') : '<div class="chart__empty">该服务器尚未上报延迟探测数据</div>'}
        </div>
      </div>
      ${historyHtml(d)}
      <div>
        <div class="section-head">网络</div>
        <div class="rates" style="margin-top:12px">
          <div class="rate"><div class="l" style="color:var(--up)">↑ 上行</div><div class="v">${on ? fmtSpeed(d.net_out_speed) : '--'}</div></div>
          <div class="rate"><div class="l" style="color:var(--down)">↓ 下行</div><div class="v">${on ? fmtSpeed(d.net_in_speed) : '--'}</div></div>
        </div>
      </div>
      <div>
        <div class="section-head">系统详情</div>
        <div class="facts" style="margin-top:12px">
          ${[
            ['负载 1/5/15', d.load_avg || '--'],
            ['进程', d.processes ?? '--'],
            ['TCP / UDP', `${d.tcp_conn ?? '--'} / ${d.udp_conn ?? '--'}`],
            ['磁盘 IO', d.disk && typeof d.disk === 'object' ? `读 ${fmtSpeed(d.disk.read_bps)} · 写 ${fmtSpeed(d.disk.write_bps)}` : '--'],
            ['Swap', d.swap_total ? `${fmtMB(d.swap_used)} / ${fmtMB(d.swap_total)}` : '--'],
            ['月流量', `${fmtBytes(used)} / ${limit ? fmtBytes(limit) : '不限'}`],
            ['累计流量', `↓ ${fmtBytes(d.net_rx)} · ↑ ${fmtBytes(d.net_tx)}`],
            ['价格', price ? price.text : '--'],
            ['到期', exp ? `${exp.date}${exp.days >= 0 ? ` · 余 ${exp.days} 天` : ' · 已过期'}` : '--'],
            ['CPU 型号', d.cpu_info || '--'],
            ['内核', d.kernel_version || '--'],
            ['最后上报', fmtDateTime(d.last_updated || d.timestamp)]
          ].map(([l, v]) => `<div class="fact"><span class="l">${l}</span><span class="v" title="${esc(v)}">${esc(v)}</span></div>`).join('')}
        </div>
      </div>
    </div>`;
}
function bucket(rows, n, fn) {
  if (!rows.length) return [];
  const size = rows.length / n;
  const out = [];
  for (let i = 0; i < n; i++) {
    const part = rows.slice(Math.floor(i * size), Math.max(Math.floor((i + 1) * size), Math.floor(i * size) + 1));
    const vals = part.map(fn).filter(v => Number.isFinite(v));
    out.push(vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);
  }
  return out;
}
function historyHtml(d) {
  const rows = state.historyFor === d.id ? state.history : [];
  const head = '<div class="section-head">24 小时趋势 <small>平均值 · 30 分钟 / 柱</small></div>';
  if (!rows.length) return `<div>${head}<div class="chart__empty" style="margin-top:12px">${state.historyFor === d.id ? '暂无历史指标数据' : '加载中…'}</div></div>`;
  const cpu = bucket(rows, 48, r => num(r.cpu, NaN));
  const ramTotal = num(d.ram_total);
  const mem = ramTotal ? bucket(rows, 48, r => num(r.ram_used, NaN) / ramTotal * 100) : [];
  const hasNet = rows.some(r => 'net_in_speed' in r || 'net_out_speed' in r);
  const ups = hasNet ? bucket(rows, 48, r => num(r.net_out_speed, NaN)) : [];
  const downs = hasNet ? bucket(rows, 48, r => num(r.net_in_speed, NaN)) : [];
  const stat = arr => { const v = arr.filter(x => x !== null); return v.length ? { max: Math.max(...v), avg: v.reduce((a, b) => a + b, 0) / v.length, cur: v[v.length - 1] } : null; };
  const plot = (arr, color, thr) => `<div class="chart__plot">${thr ? `<div class="chart__thr" style="bottom:${thr}%"><span>${thr}%</span></div>` : ''}${arr.map(v => v === null ? '<i style="height:0"></i>' : `<i style="height:${clamp(v, 1, 100).toFixed(1)}%;background:${thr && v >= thr ? 'var(--danger)' : color}"></i>`).join('')}</div>`;
  const cs = stat(cpu), ms = stat(mem);
  const nmax = Math.max(1, ...ups.filter(Boolean), ...downs.filter(Boolean));
  return `<div>${head}
    <div style="display:flex;flex-direction:column;gap:16px;margin-top:12px">
      ${cs ? `<div class="chart"><div class="chart__head">CPU <b style="color:var(--cpu)">${Math.round(cs.cur)}%</b><span class="r">峰值 ${Math.round(cs.max)}% · 均值 ${Math.round(cs.avg)}%</span></div>${plot(cpu, 'var(--cpu)', 90)}</div>` : ''}
      ${ms ? `<div class="chart"><div class="chart__head">内存 <b style="color:var(--mem)">${Math.round(ms.cur)}%</b><span class="r">峰值 ${Math.round(ms.max)}% · 均值 ${Math.round(ms.avg)}%</span></div>${plot(mem, 'var(--mem)')}</div>` : ''}
      ${hasNet ? `<div class="chart"><div class="chart__head">网络 <span class="r">↑ 峰值 ${fmtSpeed(Math.max(...ups.filter(Boolean), 0))} · ↓ 峰值 ${fmtSpeed(Math.max(...downs.filter(Boolean), 0))}</span></div>
        <div class="mirror"><div class="mirror__up">${ups.map(v => `<i style="height:${v ? clamp(v / nmax * 100, 2, 100) : 0}%"></i>`).join('')}</div><div class="mirror__down">${downs.map(v => `<i style="height:${v ? clamp(v / nmax * 100, 2, 100) : 0}%"></i>`).join('')}</div></div></div>` : ''}
      <div class="chart__axis"><span>-24h</span><span>-18h</span><span>-12h</span><span>-6h</span><span>现在</span></div>
    </div></div>`;
}
let drawerClearTimer = 0;
function renderDrawer() {
  const ws = $('#workspace');
  const drawer = $('#drawer');
  const s = state.selectedId && state.map.get(state.selectedId);
  ws.classList.toggle('has-drawer', !!s);
  drawer.setAttribute('aria-hidden', s ? 'false' : 'true');
  drawer.inert = !s;
  clearTimeout(drawerClearTimer);
  if (!s) {
    // 保留内容直到渐出动画结束，再清空
    drawerClearTimer = setTimeout(() => { if (!state.selectedId) drawer.innerHTML = ''; }, 400);
    return;
  }
  const scroll = drawer.scrollTop;
  drawer.innerHTML = drawerHtml(s);
  drawer.scrollTop = scroll;
}
async function loadDetail(id) {
  state.detail = null;
  if (state.demo) {
    state.history = demoHistory(state.map.get(id));
    state.historyFor = id;
    renderDrawer();
    return;
  }
  try {
    const [detail, history] = await Promise.all([
      request(`/api/server?id=${encodeURIComponent(id)}`).catch(() => null),
      request(`/api/history/all?id=${encodeURIComponent(id)}&hours=24`).catch(() => [])
    ]);
    if (state.selectedId !== id) return;
    state.detail = detail;
    state.history = Array.isArray(history) ? history : [];
    state.historyFor = id;
    if (detail && detail.id) {
      const merged = Object.assign(state.map.get(id) || {}, detail);
      state.map.set(id, merged);
    }
  } catch {}
  renderDrawer();
}

// ==================== 11. 主延迟选择浮层 ====================
function openProbePopover(anchor, id) {
  closePopover();
  const s = state.map.get(id);
  if (!s) return;
  const prim = primaryProbe(s);
  const probes = availableProbes(s);
  const loggedIn = !!token();
  const pop = document.createElement('div');
  pop.className = 'popover';
  pop.innerHTML = `
    <div class="popover__title">选择主延迟探测 · ${esc(s.name)}</div>
    ${probes.map(p => `<button class="popover__item ${prim && prim.key === p.key ? 'is-active' : ''}" data-key="${p.key}" type="button">
      ${prim && prim.key === p.key ? icon('check') : '<span style="width:16px"></span>'}${esc(probeName(p.key))}
      <span class="v c-${latLevel(s[p.ping])}">${probePresent(s[p.ping]) ? Math.round(num(s[p.ping])) + ' ms' : '--'}</span></button>`).join('')}
    <div class="popover__foot">
      <label><input type="checkbox" id="pop-all"> 应用到全部服务器</label>
      ${loggedIn ? '<label><input type="checkbox" id="pop-sync"> 同步保存到站点（theme_options）</label>' : '<span>登录后台后可保存为站点默认值</span>'}
    </div>`;
  $('#popover-root').append(pop);
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = `${clamp(r.left, 8, innerWidth - w - 8)}px`;
  pop.style.top = `${r.bottom + 6 + h > innerHeight ? r.top - h - 6 : r.bottom + 6}px`;
  pop.addEventListener('click', async (e) => {
    const item = e.target.closest('[data-key]');
    if (!item) return;
    const key = item.dataset.key;
    const all = $('#pop-all', pop).checked;
    const sync = $('#pop-sync', pop)?.checked;
    if (all) {
      state.prefs = { __global: key };
    } else {
      state.prefs[id] = key;
    }
    writeJSON(PREF_KEY, state.prefs);
    closePopover();
    rerenderAll();
    if (sync) {
      const mine = { ...pulseOpts() };
      if (all) { mine.primary_probe = key; mine.primary_overrides = {}; } else { mine.primary_overrides = { ...(mine.primary_overrides || {}), [id]: key }; }
      // theme_options 由所有主题共享，只写入 pulse 命名空间，保留其它主题的配置
      try { await saveThemeOptions({ ...state.themeOptions, pulse: mine }); toast('已保存到站点主题配置'); } catch (err) { toast(`保存失败：${err.message}`); }
    } else {
      toast(all ? `全部服务器主延迟：${probeName(key)}` : `${s.name} 主延迟：${probeName(key)}`);
    }
  });
}
function closePopover() { $('#popover-root').innerHTML = ''; }

// ==================== 12. 数据更新 ====================
let frame = 0;
const dirty = new Set();
let dirtyAll = false;
function schedule(id) {
  if (id) dirty.add(id); else dirtyAll = true;
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    if (dirtyAll) {
      dirtyAll = false;
      dirty.clear();
      rerenderAll();
      return;
    }
    for (const sid of dirty) updateCard(sid);
    if (state.selectedId && dirty.has(state.selectedId)) renderDrawer();
    dirty.clear();
    renderOverviewThrottled();
  });
}
let lastOverview = 0;
function renderOverviewThrottled() {
  const now = Date.now();
  if (now - lastOverview < 1000) return;
  lastOverview = now;
  trackSpeed();
  renderOverview();
}
function trackSpeed() {
  const up = state.servers.reduce((a, s) => a + num(s.net_out_speed), 0);
  const down = state.servers.reduce((a, s) => a + num(s.net_in_speed), 0);
  const last = state.speedTrail[state.speedTrail.length - 1];
  if (last && Date.now() - last.ts < 1800) { last.up = up; last.down = down; return; }
  state.speedTrail.push({ ts: Date.now(), up, down });
  if (state.speedTrail.length > 30) state.speedTrail.shift();
}
function rerenderAll() {
  renderOverview();
  renderTabs();
  renderGrid();
  renderDrawer();
}
function applyBatch(msg) {
  for (const u of msg.updates || []) {
    const s = state.map.get(u.serverId);
    if (!s) continue;
    for (const sample of u.samples || []) {
      const data = sample.data || sample.payload || sample.metrics || {};
      Object.assign(s, data);
      const ts = num(sample.ts, Date.now());
      s.last_updated = Math.max(num(s.last_updated), ts);
      if (typeof s.is_online === 'boolean') s.is_online = true;
      if (PROBES.some(p => p.ping in data)) pushLatency(s.id, ts, data);
    }
    schedule(s.id);
  }
}
function applyConfig(cfg) {
  state.config = cfg || {};
  state.themeOptions = (cfg && cfg.theme_options && typeof cfg.theme_options === 'object') ? cfg.theme_options : {};
  const title = state.config.site_title;
  if (title) { $('#site-title').textContent = title; document.title = title; }
  if (state.config.version) {
    $('#site-version').textContent = `v${state.config.version}`;
    $('#footer-version').textContent = `v${state.config.version}`;
  }
}
function ingestServers(data) {
  const list = Array.isArray(data.servers) ? data.servers : [];
  const sys = data.sysConfig || {};
  Object.assign(state.config, sys);
  const next = new Map();
  for (const s of list) {
    const prev = state.map.get(s.id);
    const merged = prev ? Object.assign(prev, s) : { ...s };
    next.set(s.id, merged);
    seedLatency(merged);
  }
  state.map = next;
  state.servers = list.map(s => next.get(s.id));
}
async function loadServers() {
  const data = await request('/api/servers');
  ingestServers(data);
  if (socket) socket.setIds(state.servers.map(s => s.id));
  trackSpeed();
  rerenderAll();
}

// ==================== 13. 路由 ====================
function parseRoute() {
  const m = (location.hash || '').match(/^#\/server\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
function onRoute() {
  const id = parseRoute();
  const changed = id !== state.selectedId;
  state.selectedId = id && state.map.has(id) ? id : null;
  if (id && !state.map.has(id) && state.servers.length) { location.hash = '#/'; return; }
  for (const [sid, el] of cardEls) el.classList.toggle('is-selected', sid === state.selectedId);
  renderGrid();
  renderDrawer();
  if (state.selectedId && changed) {
    $('#drawer').scrollTop = 0;
    loadDetail(state.selectedId);
    if (innerWidth > 1100) {
      // 让侧栏顶部对齐视口，避免详情卡下半截超出屏幕
      const top = $('#workspace').getBoundingClientRect().top + scrollY - 12;
      if (scrollY < top) window.scrollTo({ top, behavior: 'smooth' });
    }
  }
}
function go(id) { location.hash = id ? `#/server/${encodeURIComponent(id)}` : '#/'; }

// ==================== 14. 外观 ====================
function initAppearance() {
  const saved = localStorage.getItem(APPEARANCE_KEY);
  const pref = saved || state.config.preferred_theme || 'auto';
  const mode = pref === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : pref;
  setAppearance(mode, false);
}
function setAppearance(mode, save = true) {
  state.appearance = mode;
  document.documentElement.dataset.appearance = mode;
  $('#theme-color-meta').setAttribute('content', mode === 'light' ? '#f3f5f8' : '#0b0e13');
  $('#btn-theme').innerHTML = icon(mode === 'light' ? 'moon' : 'sun');
  if (save) localStorage.setItem(APPEARANCE_KEY, mode);
  // 切换外观时同步更换地标插图（白天 / 夜景）
  if (state.selectedId) renderDrawer();
}

// ==================== 15. 演示数据 (?demo=1) ====================
function demoData() {
  const now = Date.now();
  const mk = (id, name, group, region, cores, ramG, diskG, cpu, ram, disk, ping, price, cur, limitT) => ({
    id, name, server_group: group, region, os: 'Debian 12', arch: 'x86_64', cpu_cores: cores, cpu_info: 'AMD EPYC Processor',
    cpu, ram_total: ramG * 1024, ram_used: ramG * 1024 * ram / 100, disk_total: diskG * 1024, disk_used: diskG * 1024 * disk / 100,
    swap_total: 1024, swap_used: 30, net_in_speed: 20000 + Math.random() * 400000, net_out_speed: 20000 + Math.random() * 400000,
    net_rx: 1.2e12 * Math.random(), net_tx: 1.5e12 * Math.random(), net_rx_monthly: 4e10 * Math.random(), net_tx_monthly: 4e10 * Math.random(),
    processes: 120 + Math.round(Math.random() * 80), tcp_conn: 40 + Math.round(Math.random() * 300), udp_conn: 6, load_avg: '0.21 0.18 0.15',
    ping_ct: ping[0], ping_cu: ping[1], ping_cm: ping[2], ping_bd: ping[3], ping_node_1: ping[4] ?? null,
    loss_ct: 0, loss_cu: 0, loss_cm: ping[2] > 200 ? 1.2 : 0, loss_bd: 0, loss_node_1: 0,
    price: String(price), currency: cur, billing_cycle: 'month', expire_date: '', traffic_limit: `${limitT}TB`,
    boot_time: String(now - (5 + Math.random() * 300) * 86400000), last_updated: now, is_online: true, report_interval: 60
  });
  return {
    config: { site_title: 'Pulse Demo', version: '2.8.7', custom_bd_name: 'BGP', node_1_name: '海外', theme_options: {}, show_price: true },
    servers: [
      mk('demo-hk', 'HK-Lite-01', '亚太', 'HK', 1, 1, 20, 18, 41, 36, [38, 42, 29, 30, 60], 30, '¥', 0.5),
      mk('demo-jp', 'JP-Tokyo-02', '亚太', 'JP', 2, 4, 60, 94, 85, 52, [71, 77, 86, 52, 40], 6, '$', 2),
      mk('demo-sg', 'SG-Edge', '亚太', 'SG', 2, 4, 50, 31, 65, 44, [64, 72, 88, 45, 30], 5, '$', 1),
      mk('demo-la', 'US-LosAngeles-03', '北美', 'US', 1, 1, 20, 4, 38, 12, [158, 179, 197, 23, 62], 3, '$', 2.4),
      mk('demo-ash', 'US-Ashburn-01', '北美', 'US', 4, 4, 59, 2, 11, 3, [223, 244, 228, 73, 2], 6, '$', 19.5),
      mk('demo-slc', 'US-SaltLake-02', '北美', 'US', 1, 2, 18.6, 1, 16, 8, [185, 188, 209, 30, 47], 5, '$', 23.4),
      mk('demo-de', 'DE-Nuremberg-8h8g', '欧洲', 'DE', 4, 8, 252, 28, 46, 68, [208, 265, 258, 155, 96], 15, '€', 58.6),
      mk('demo-de2', 'DE-Nuremberg-1h1g', '欧洲', 'DE', 1, 1, 29.4, 3, 37, 8, [200, 195, 250, 165, 102], 2, '€', 29.3)
    ]
  };
}
function demoHistory(s) {
  const rows = [];
  const now = Date.now();
  for (let i = 0; i < 120; i++) {
    const t = now - (120 - i) * 12 * 60000;
    rows.push({ timestamp: t, cpu: clamp(num(s.cpu) * (0.4 + i / 200) + Math.sin(i / 6) * 6 + Math.random() * 6, 0, 100), ram_used: num(s.ram_used) * (0.85 + i / 800), net_in_speed: num(s.net_in_speed) * (0.5 + Math.random()), net_out_speed: num(s.net_out_speed) * (0.5 + Math.random()) });
  }
  return rows;
}
function seedDemoHistory() {
  const now = Date.now();
  for (const s of state.servers) {
    const store = latStore(s.id);
    for (const p of PROBES) {
      const base = num(s[p.ping], 0);
      if (!base) continue;
      store[p.key] = Array.from({ length: 120 }, (_, i) => ({
        ts: now - (120 - i) * 60000,
        v: Math.random() < 0.02 ? null : Math.max(1, Math.round(base * (0.85 + Math.random() * 0.3 + (i % 17 === 0 ? 0.35 : 0)))),
        loss: 0
      }));
    }
  }
  const up = state.servers.reduce((a, s) => a + num(s.net_out_speed), 0);
  const down = state.servers.reduce((a, s) => a + num(s.net_in_speed), 0);
  state.speedTrail = Array.from({ length: 30 }, (_, i) => ({ ts: now - (30 - i) * 2000, up: up * (0.6 + Math.random() * 0.6), down: down * (0.6 + Math.random() * 0.6) }));
}
function startDemoTicks() {
  setInterval(() => {
    const now = Date.now();
    for (const s of state.servers) {
      const jitter = (v, r) => Math.max(1, Math.round(v * (1 + (Math.random() - 0.5) * r)));
      s.__base_in = s.__base_in ?? num(s.net_in_speed, 5e4);
      s.__base_out = s.__base_out ?? num(s.net_out_speed, 5e4);
      s.__base_cpu = s.__base_cpu ?? num(s.cpu);
      const data = { cpu: clamp(s.__base_cpu + (Math.random() - 0.5) * 6, 0, 100), net_in_speed: jitter(s.__base_in, 0.5), net_out_speed: jitter(s.__base_out, 0.5) };
      for (const p of PROBES) if (probePresent(s[`__base_${p.key}`] ?? s[p.ping])) {
        s[`__base_${p.key}`] = s[`__base_${p.key}`] ?? s[p.ping];
        data[p.ping] = Math.random() < 0.02 ? null : jitter(s[`__base_${p.key}`], 0.18);
      }
      applyBatch({ updates: [{ serverId: s.id, samples: [{ ts: now, data }] }] });
    }
  }, 2000);
}

// ==================== 16. 事件与初始化 ====================
function bindEvents() {
  $('#group-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-group]');
    if (!b) return;
    state.group = b.dataset.group;
    renderTabs();
    renderGrid();
  });
  $('#search-input').addEventListener('input', (e) => { state.query = e.target.value; renderGrid(); });
  $('#sort-select').addEventListener('change', (e) => { state.sort = e.target.value; renderGrid(); });
  $('#server-grid').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-probe-for]');
    if (chip) { e.stopPropagation(); openProbePopover(chip, chip.dataset.probeFor); return; }
    const card = e.target.closest('.card');
    if (card) go(card.dataset.id === state.selectedId ? null : card.dataset.id);
  });
  $('#drawer').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return go(null);
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      const list = filtered();
      const i = list.findIndex(s => s.id === state.selectedId);
      const next = list[(i + num(nav.dataset.nav) + list.length) % list.length];
      if (next) go(next.id);
      return;
    }
    const chip = e.target.closest('[data-probe-for]');
    if (chip) openProbePopover(chip, chip.dataset.probeFor);
  });
  // 点击大卡片以外的区域关闭大卡片，恢复原布局。
  // 例外：服务器卡片（切换到另一台）、顶栏、主延迟浮层与弹窗。
  document.addEventListener('click', (e) => {
    if (!state.selectedId) return;
    const t = e.target;
    if (!t.isConnected) return;
    if (t.closest('.drawer, .card, .topbar, .popover, .overlay, [data-probe-for]')) return;
    go(null);
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.popover') && !e.target.closest('[data-probe-for]')) closePopover(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closePopover(); if (state.selectedId) go(null); }
    if (e.key === '/' && document.activeElement !== $('#search-input')) { e.preventDefault(); $('#search-input').focus(); }
  });
  $('#btn-theme').addEventListener('click', () => setAppearance(state.appearance === 'light' ? 'dark' : 'light'));
  window.addEventListener('hashchange', onRoute);
  document.addEventListener('visibilitychange', () => {
    if (state.demo || state.wsState === 'paused') return;
    if (document.visibilityState === 'hidden') { stopRealtime(); setLive('closed'); return; }
    loadServers().catch(() => {}).finally(startRealtime);
  });
  setInterval(() => { $('#clock').textContent = fmtClock(); }, 1000);
}
function showError(err) {
  $('#server-grid').innerHTML = '';
  const empty = $('#empty-state');
  empty.classList.remove('hidden');
  empty.innerHTML = `<div class="empty__title">数据加载失败</div><div class="empty__desc">${esc(err.message || err)}<br>请检查 Worker 地址（meta apiBase）与跨域白名单 CORS_ALLOWED_ORIGINS。<br><br><button class="btn btn--primary" onclick="location.reload()">重试</button> <a class="btn" href="?demo=1">查看演示数据</a></div>`;
  setLive('closed');
}
async function init() {
  bindEvents();
  $('#clock').textContent = fmtClock();
  const params = new URLSearchParams(location.search);
  state.demo = params.get('demo') === '1';
  if (state.demo) {
    const demo = demoData();
    applyConfig(demo.config);
    initAppearance();
    ingestServers({ servers: demo.servers });
    seedDemoHistory();
    rerenderAll();
    onRoute();
    setLive('open');
    startDemoTicks();
    return;
  }
  try {
    const cfg = await request('/api/config');
    applyConfig(cfg);
    initAppearance();
    if (cfg.turnstile_enabled && !loadCred()) await ensureTurnstile();
    await loadServers();
    onRoute();
    startRealtime();
    loadFx();
  } catch (err) {
    initAppearance();
    showError(err);
  }
}
init();
