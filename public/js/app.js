import { makeDex, CARDS, SECONDS, TIERS, MAX_SCORE, rating, GROUPS, PACKS, dayNumber, dateOfDay, shareText, cleanName } from './core.js?v=4';

/* ============ helpers ============ */
const V = 4;
const CANON = 'dex.godpack.live';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const view = () => $('#view');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = () => matchMedia('(pointer: coarse)').matches;
const fmtDate = d => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
let regionNames = null;
try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { /* old browser */ }
const countryName = cc => { if (!cc) return ''; try { return regionNames?.of(cc) || cc; } catch { return cc; } };
const GROUP_COLOR = { type: '#ea9dce', region: '#8fc8ff', name: '#f6cc48', stats: '#b4dfb9', body: '#f1b1bf', evo: '#a38ce3', lore: '#f9e5ad' };
const TIER_COLOR = ['#d9d4ea', '#b4dfb9', '#8fc8ff', '#a38ce3', '#f6cc48', '#ea669c'];
const tcls = t => (t >= 0 ? `t-${t}` : 't-x');
const tname = t => (t >= 0 ? TIERS[t].name : 'Miss');
const icon = (id, cls = '') => `<svg${cls ? ` class="${cls}"` : ''} aria-hidden="true"><use href="#${id}"/></svg>`;
const STAT = ['HP', 'Attack', 'Defense', 'Sp. Atk', 'Sp. Def', 'Speed'];
const REG = { 1: 'Kanto', 2: 'Johto', 3: 'Hoenn', 4: 'Sinnoh', 5: 'Unova', 6: 'Kalos', 7: 'Alola', 8: 'Galar & Hisui', 9: 'Paldea' };
const letters = s => s.normalize('NFD').replace(/[^A-Za-z]/g, '');
const UTM = medium => `utm_source=godpack-dex&utm_medium=${medium}&utm_campaign=dex`;
const b64u = str => { const b = new TextEncoder().encode(str); let t = ''; for (let i = 0; i < b.length; i++) t += String.fromCharCode(b[i]); return btoa(t).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = str => new TextDecoder().decode(Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));
// in-app browsers (TikTok, Instagram…) usually can't use passkeys
const inApp = /FBAN|FBAV|Instagram|BytedanceWebview|musical_ly|TikTok|Snapchat|Line\//i.test(navigator.userAgent);

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('is-on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('is-on'), 2200);
}

/* ============ storage + state ============ */
const store = {
  get(k, d) { try { const v = localStorage.getItem('gpdex:' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('gpdex:' + k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem('gpdex:' + k); } catch { /* noop */ } }
};
const S = {
  settings: { sound: true, haptics: true, ...store.get('settings', {}) },
  profile: store.get('profile', null),
  history: store.get('history', {}),
  extra: store.get('extra', { unlimited: { best: 0, played: 0 }, packs: {}, archive: {} }),
  progress: store.get('progress', null),
  meta: store.get('meta', {}),
  geo: null,
  pid: store.get('pid', null) || (() => { const p = Math.random().toString(36).slice(2, 10); store.set('pid', p); return p; })()
};
const save = k => store.set(k, S[k]);
let dex, data;
const today = () => dayNumber(data);
const statsCache = {};

/* ============ api ============ */
async function api(path, { method, body } = {}) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (S.profile?.id) headers.authorization = `Bearer ${S.profile.id}.${S.profile.key}`;
  const res = await fetch('/api' + path, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error((json && json.error) || 'Request failed'), { status: res.status, data: json });
  return json;
}
let playerP = null;
function ensurePlayer() {
  if (S.profile?.id) return Promise.resolve(S.profile);
  if (!playerP) playerP = api('/player/new', { method: 'POST', body: {} }).then(p => { S.profile = p; save('profile'); return p; }).finally(() => { playerP = null; });
  return playerP;
}
async function submitDaily(n, retried) {
  const h = S.history[n]; if (!h || h.sent) return h?.rank || null;
  await ensurePlayer();
  try { const r = await api('/daily/submit', { body: { day: n, picks: h.p, ms: h.ms || [], ticket: h.ticket || null } }); h.sent = true; h.rank = r.rank; save('history'); return r.rank; }
  catch (e) {
    if (e.status === 409) { h.sent = true; h.rank = e.data?.rank || null; save('history'); return h.rank; }
    // the server no longer knows this device: start a fresh profile and send the score with it (a passkey sign-in merges it back later)
    if (e.status === 401 && !retried) { S.profile = null; store.del('profile'); return submitDaily(n, true); }
    throw e;
  }
}
async function flushPending() { for (const d of Object.keys(S.history)) { if (S.history[d].sent) continue; try { await submitDaily(+d); } catch { return; } } }
// keep this device in step with the server (another device may have played, or a passkey sign-in merged things)
function applyMe(me) {
  if (!S.profile) return false;
  Object.assign(S.profile, { name: me.name, code: me.code, country: me.country, region: me.region, regionName: me.regionName, passkeys: me.passkeys || 0 });
  save('profile');
  let changed = false;
  for (const h of me.history || []) if (!S.history[h.day] || !S.history[h.day].p) { S.history[h.day] = { score: h.score, t: h.tiers, p: h.picks, at: 0, sent: true }; changed = true; }
  if (changed) { save('history'); syncStreak(); }
  return changed;
}
async function syncMe(force) {
  if (!S.profile?.id || (!force && S.meta.synced === today())) return false;
  try { const me = await api('/me'); S.meta.synced = today(); save('meta'); return applyMe(me); }
  catch (e) { if (e.status === 401) { S.profile = null; store.del('profile'); } return false; }
}
async function geoInfo() {
  if (S.profile?.country) return { country: S.profile.country, region: S.profile.region, regionName: S.profile.regionName };
  if (!S.geo) S.geo = await api('/geo').catch(() => ({}));
  return S.geo;
}

/* ============ passkeys (optional: save your DEX, sign in anywhere) ============ */
const passkeyHost = () => location.hostname === CANON || location.hostname === 'localhost';
const passkeysOk = () => passkeyHost() && !!window.PublicKeyCredential;
let wa = null;
const webauthn = () => (wa ||= import(`./vendor/webauthn.js?v=${V}`).catch(e => { wa = null; throw e; }));
// the challenge is fetched before the tap, so the tap opens the passkey prompt straight away (Safari is strict about that)
const prepared = {};
function preparePasskey(kind) {
  const hit = prepared[kind];
  if (hit && Date.now() - hit.at < 4 * 60e3) return hit.promise;
  const promise = Promise.all([webauthn(), kind === 'reg'
    ? ensurePlayer().then(() => api('/passkey/register/options', { method: 'POST', body: {} }))
    : flushPending().catch(() => {}).then(() => api('/passkey/login/options', { method: 'POST', body: {} }))]);
  prepared[kind] = { at: Date.now(), promise };
  promise.catch(() => { if (prepared[kind]?.promise === promise) delete prepared[kind]; });
  return promise;
}
const passkeyError = (e, fallback) => (inApp ? 'Passkeys need Safari or Chrome. Open this page there.' : e?.name === 'InvalidStateError' ? 'This device already has a passkey for your DEX' : fallback);
async function savePasskey() {
  const [{ startRegistration }, { cid, options }] = await preparePasskey('reg');
  delete prepared.reg;
  let response;
  try { response = await startRegistration({ optionsJSON: options }); } catch (e) { throw new Error(passkeyError(e, 'Passkey not saved')); }
  const me = await api('/passkey/register/verify', { body: { cid, response } });
  S.profile.passkeys = me.passkeys; save('profile');
  return me;
}
async function signInPasskey() {
  const [{ startAuthentication }, { cid, options }] = await preparePasskey('auth');
  delete prepared.auth;
  let response;
  try { response = await startAuthentication({ optionsJSON: options }); } catch (e) { throw new Error(passkeyError(e, 'Sign-in cancelled')); }
  const me = await api('/passkey/login/verify', { body: { cid, response } });
  // scores this device hasn't sent yet come along to the account
  const unsent = Object.entries(S.history).filter(([, h]) => !h.sent);
  S.profile = { id: me.id, key: me.key, name: me.name, code: me.code, country: me.country, region: me.region, regionName: me.regionName, passkeys: me.passkeys };
  save('profile');
  S.history = {};
  applyMe(me);
  for (const [d, h] of unsent) if (!S.history[d]) S.history[d] = h;
  save('history'); S.meta.synced = today(); save('meta'); syncStreak();
  flushPending().catch(() => {});
  return me;
}
async function signOut() {
  await api('/signout', { method: 'POST', body: {} }).catch(() => {});
  S.profile = null; S.history = {}; S.progress = null; myHash = null;
  store.del('profile'); save('history'); store.del('progress'); syncStreak();
}
async function doSave(after) {
  try { await savePasskey(); toast('Saved. Sign in with your passkey on any device.'); after?.(); }
  catch (e) { toast(e.message || 'Passkey not saved'); }
}
async function doSignIn(after) {
  try { const me = await signInPasskey(); toast(`Welcome back${me.name ? ', ' + me.name : ''}`); after?.(); }
  catch (e) { toast(e.message || 'Couldn’t sign in'); }
}
// one place that renders the save / sign-in buttons and wires them up
function wirePasskeys(root, after) {
  const sv = $('[data-save]', root), si = $('[data-signin]', root);
  if (sv) { preparePasskey('reg').catch(() => {}); sv.addEventListener('click', () => doSave(after)); }
  if (si) { preparePasskey('auth').catch(() => {}); si.addEventListener('click', () => doSignIn(after)); }
}
function accountCard() {
  if (!passkeysOk() && !inApp) return '';
  if (S.profile?.passkeys) return `<p class="saved">${icon('i-check')}<span>Saved with a passkey</span><a href="/settings" data-link>Manage</a></p>`;
  const has = !!(S.profile?.id || Object.keys(S.history).length);
  if (inApp) return has ? `<p class="saved saved--warn">${icon('i-key')}<span>Open this page in Safari or Chrome to save your DEX with a passkey.</span></p>` : '';
  return `<section class="savecard" id="acct">
    <div class="savecard__t">${icon('i-key')}<div><h2 class="display">${has ? 'Save your DEX' : 'Played before?'}</h2>
      <p>${has ? 'Keep your streak safe and play on any device. Uses Face ID, fingerprint or your screen lock. No email, no password.' : 'Sign in with your passkey to bring back your streak and scores.'}</p></div></div>
    <div class="row">${has ? `<button class="btn btn--sm" type="button" data-save>Save with passkey</button><button class="link" type="button" data-signin>Already saved? Sign in</button>` : `<button class="btn btn--sm" type="button" data-signin>Sign in with passkey</button>`}</div>
  </section>`;
}
async function dayStats(n, force) {
  if (!force && statsCache[n] && Date.now() - statsCache[n].at < 60000) return statsCache[n].v;
  const v = await api(`/daily/${n}/stats`); statsCache[n] = { v, at: Date.now() }; return v;
}

/* ============ sound + haptics ============ */
let ac = null;
function audio() {
  if (!S.settings.sound) return null;
  try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); return ac; } catch { return null; }
}
function tone(freq, dur = .12, type = 'triangle', vol = .14, when = 0, to) {
  const a = audio(); if (!a) return;
  const t = a.currentTime + when, o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + .02);
}
function noise(dur = .35, from = 500, to = 3200, vol = .22) {
  const a = audio(); if (!a) return;
  const len = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  src.buffer = buf; f.type = 'bandpass'; f.Q.value = 1.4;
  f.frequency.setValueAtTime(from, a.currentTime); f.frequency.exponentialRampToValueAtTime(to, a.currentTime + dur);
  g.gain.value = vol; src.connect(f).connect(g).connect(a.destination); src.start();
}
const NOTES = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5];
const sfx = {
  rip: () => noise(.45, 400, 4200, .26),
  tick: () => tone(1320, .05, 'sine', .07),
  bad: () => { tone(180, .14, 'square', .05); tone(140, .16, 'square', .04, .08); },
  charge: t => tone(300, .3 + (t - 3) * .15, 'sawtooth', .04, 0, 900 + t * 200),
  pull: t => { for (let i = 0; i <= t + 1; i++) tone(NOTES[i], .22 + i * .02, 'triangle', .12, i * .07); if (t >= 4) noise(.6, 3000, 9000, .07); },
  miss: () => tone(220, .3, 'sine', .1),
  pop: () => { noise(.5, 120, 900, .4); tone(90, .4, 'sine', .25); },
  pass: () => tone(988, .08, 'triangle', .1)
};
const buzz = p => { if (S.settings.haptics && navigator.vibrate) try { navigator.vibrate(p); } catch { /* noop */ } };
function syncSoundBtn() {
  const b = $('#soundBtn'); b.setAttribute('aria-pressed', String(S.settings.sound));
  b.setAttribute('aria-label', S.settings.sound ? 'Sound on' : 'Sound off');
  b.innerHTML = icon(S.settings.sound ? 'i-sound' : 'i-mute');
}

/* ============ streak ============ */
function streakInfo() {
  const n = today(); let cur = 0, d = S.history[n] ? n : n - 1;
  while (S.history[d]) { cur++; d--; }
  let best = 0, run = 0;
  const days = Object.keys(S.history).map(Number).sort((a, b) => a - b);
  days.forEach((x, i) => { run = i && days[i - 1] === x - 1 ? run + 1 : 1; best = Math.max(best, run); });
  return { cur, best };
}
function syncStreak() {
  const { cur } = streakInfo(), el = $('#streak');
  el.hidden = !cur; el.querySelector('span').textContent = cur;
  el.setAttribute('aria-label', `${cur}-day streak`);
}

/* ============ facts: why an answer fits, why a guess doesn’t ============ */
const baseKey = q => q.k.replace(/^kanto:/, '');
function mult(att, defTypes) {
  const ai = data.types.indexOf(att);
  return defTypes.reduce((m, d) => { const v = data.taken[d]?.[ai]; return m * (v === 1 ? 2 : v === 2 ? .5 : v === 3 ? 0 : 1); }, 1);
}
const ft = m => { const i = Math.round(m * 39.37); return `${Math.floor(i / 12)}′${i % 12}″`; };
const lb = kg => `${Math.round(kg * 2.2046).toLocaleString()} lb`;
function fact(q, p) {
  const [k, a] = baseKey(q).split(':');
  switch (k) {
    case 'stat': return `Base ${STAT[+a]} ${p.s[+a]}`;
    case 'top': return `Highest stat: ${STAT[+a]} ${p.s[+a]}`;
    case 'spe': return `Base Speed ${p.s[5]}`;
    case 'atk': return `Base Attack ${p.s[1]}`;
    case 'hp': return `Base HP ${p.s[0]}`;
    case 'bst': return `Base stat total ${p.b}`;
    case 'max': { const m = Math.max(...p.s); return `Top stat ${m} (${STAT[p.s.indexOf(m)]})`; }
    case 'min': { const m = Math.min(...p.s); return `Lowest stat ${m} (${STAT[p.s.indexOf(m)]})`; }
    case 'atkspa': return `Sp. Atk ${p.s[3]} vs Attack ${p.s[1]}`;
    case 'defspd': return `Defense ${p.s[2]} · Speed ${p.s[5]}`;
    case 'tall': case 'short': return p.h == null ? '' : `${p.h} m tall (${ft(p.h)})${a === 'light' || a === 'heavy' ? ` · ${p.w} kg` : ''}`;
    case 'heavy': case 'light': return `Weighs ${p.w} kg (${lb(p.w)})`;
    case 'color': case 'ctype': return p.c ? `Mostly ${p.c}` : '';
    case 'cat': return p.cat ? `The ${p.cat} Pokémon` : '';
    case 'gen': case 'gentype': return `Gen ${p.g} · ${REG[p.g]}`;
    case 'dex': return `Pokédex #${p.d}`;
    case '4x': case 'imm': { const m = mult(a, p.t); return m === 0 ? `Immune to ${a}` : `Takes ${m}× from ${a}`; }
    case 'evo': case 'stone': return p.em || (p.ln ? 'Final form' : 'Doesn’t evolve');
    case 'egg': return `Egg Groups: ${(p.eg || []).join(', ')}`;
    case 'ab': return `Abilities: ${p.a.join(', ')}`;
    case 'len': return `${letters(p.n).length} letters`;
    case 'gd': return p.gd === 'N' ? 'Genderless' : p.gd === 'F' ? 'Always female' : p.gd === 'M' ? 'Always male' : '';
    case 'leg': case 'myth': case 'ub': case 'paradox': return { R: 'Box-art Legendary', L: 'Legendary', M: 'Mythical', U: 'Ultra Beast', P: 'Paradox Pokémon' }[p.tg] || '';
    default: return '';
  }
}
function whyNot(q, p) {
  const n = `<b>${esc(p.n)}</b>`;
  if (q.k.startsWith('kanto:') && p.g !== 1) return `${n} isn’t from Gen 1`;
  const [k] = baseKey(q).split(':');
  switch (k) {
    case 'type': case 'dual': case 'pure': case 'mono': return `${n} is ${p.t.join(' / ')}`;
    case 'gentype': return `${n} is ${p.t.join(' / ')} from Gen ${p.g}`;
    case 'gen': return `${n} is from Gen ${p.g}`;
    case 'letter': return `${n} starts with ${letters(p.n)[0].toUpperCase()}`;
    case 'ends': return `${n} ends in “${letters(p.n).slice(-1).toLowerCase()}”`;
    case 'len': return `${n} has ${letters(p.n).length} letters`;
    case 'cat': return p.cat ? `${n} is the ${esc(p.cat)} Pokémon` : `${n} doesn’t fit`;
    case 'starter': return `${n} isn’t that kind of starter`;
    default: { const f = fact(q, p); return f ? `${n}: ${esc(f)}` : `${n} doesn’t fit this one`; }
  }
}
function shortLabel(q) {
  const bk = baseKey(q);
  let s = /starting with$/.test(q.lead) ? `Starts with ${q.key}` : /ends in$/.test(q.lead) ? `Ends in “${q.key}”` : q.key.replace(/^an? /, '').replace(/^“|”$/g, '');
  if (bk.startsWith('gentype:')) s += ` · Gen ${bk.split(':')[1]}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const cardName = n => Math.min(17, 138 / Math.max(n.length, 1)).toFixed(2) + 'cqw';
function keySize(text, base) {
  const L = text.length, word = Math.max(...text.split(/[\s/]+/).map(w => w.length));
  const byLen = L <= 4 ? 30 : L <= 7 ? 21 : L <= 10 ? 16.5 : L <= 14 ? 13.5 : L <= 20 ? 11.5 : L <= 28 ? 9.8 : 8.4;
  return Math.min(byLen * (base || 1), 150 / Math.max(word, 1)).toFixed(2) + 'cqw';
}

/* ============ the godpack Amethyst pack ============ */
function zig(y, amp, n, x0, x1, seed) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * i / n; const j = (Math.sin(seed + i * 12.9898) * 43758.5453) % 1; pts.push(`${x.toFixed(2)}% ${(y + (i % 2 ? amp : -amp) * (.7 + .3 * Math.abs(j))).toFixed(2)}%`); }
  return pts;
}
const TEAR = zig(11.2, .9, 16, 0, 100, 3), CRIMP_T = zig(1.1, .9, 26, 0, 100, 7), CRIMP_B = zig(98.9, .9, 26, 100, 0, 9);
const CLIP_TOP = `polygon(${[...CRIMP_T, ...[...TEAR].reverse()].join(',')})`;
const CLIP_BODY = `polygon(${[...TEAR, ...CRIMP_B].join(',')})`;
function pack({ line1 = 'Daily pack', line2 = '7 cards inside', tag = 'button', id = '', small = false, label = '' }) {
  const attrs = tag === 'button' ? `type="button" aria-label="${esc(label || 'Rip ' + line1)}"` : 'aria-hidden="true"';
  return `<div class="pkwrap${small ? ' pkwrap--sm' : ''}"><${tag} class="pk"${id ? ` id="${id}"` : ''} ${attrs} style="--clip-top:${CLIP_TOP};--clip-body:${CLIP_BODY};container-type:inline-size">
    <span class="pk__body"><span class="pk__seal pk__seal--b"></span><img class="pk__logo" src="/img/godpack-logo.webp" alt="" width="409" height="89"><span class="pk__win"><svg viewBox="0 0 63 88"><use href="#cardback"/></svg></span><span class="pk__txt" style="font-size:4.3cqw"><b>${esc(line1)}</b><span>${esc(line2)}</span></span></span>
    <span class="pk__top"><span class="pk__seal pk__seal--t"></span></span>
  </${tag}><span class="pk__shadow"></span></div>`;
}
async function ripPack(line1, line2) {
  let el = $('#ripPack');
  if (!el) {
    view().innerHTML = `<div class="col"><section class="hero" style="min-height:50vh;align-content:center">${pack({ line1, line2, tag: 'div', id: 'ripPack' })}</section></div>`;
    el = $('#ripPack');
  }
  if (reduced) return;
  el.classList.add('is-ripping'); sfx.rip(); buzz(18);
  await sleep(640);
}

/* ============ inserts ============ */
const insertGodpack = medium => `<aside class="insert" aria-label="godpack.io">
  <span class="age">18+</span>
  ${pack({ line1: 'godpack.io', line2: 'Raw or graded card inside', tag: 'div', small: true })}
  <div class="insert__copy">
    <p class="label kicker">Made by godpack.io</p>
    <h3 class="display">Real packs.<br>Real graded cards.</h3>
    <p>Open TCG packs on godpack.io and ship your pulls to your door. Every pack’s pull rates are shown up front.</p>
    <a class="btn btn--sm" href="https://godpack.io/?${UTM(medium)}" target="_blank" rel="noopener">Visit godpack.io${icon('i-ext')}</a>
  </div>
</aside>`;
const insertLive = () => `<aside class="insert insert--live" aria-label="godpack LIVE">
  <span class="age">18+</span>
  <div class="insert__copy" style="grid-column:1/-1">
    <span class="live"><i></i>Live</span>
    <h3 class="display">Hot Pack on stream?</h3>
    <p>Already going LIVE on TikTok? godpack LIVE pays you for every hour you rip real packs on stream, paid out daily. For creators with 1,000+ followers.</p>
    <a class="btn btn--sm" href="https://godpack.live/?${UTM('party')}" target="_blank" rel="noopener">See godpack LIVE${icon('i-ext')}</a>
  </div>
</aside>`;

/* ============ router ============ */
let runAbort = null, room = null, ignorePop = false;
const routes = [
  [/^\/$/, () => viewHome()], [/^\/play$/, () => startDaily()], [/^\/daily\/(\d+)$/, m => viewDailyResults(+m[1])],
  [/^\/unlimited$/, () => viewUnlimited()], [/^\/packs$/, () => viewPacks()], [/^\/packs\/(\w+)$/, m => startPack(m[1])],
  [/^\/archive$/, () => viewArchive()], [/^\/archive\/(\d+)$/, m => viewArchiveDay(+m[1])],
  [/^\/boards$/, () => viewBoards()], [/^\/me$/, () => viewMe()], [/^\/friends$/, () => viewFriends()],
  [/^\/settings$/, () => viewSettings()], [/^\/faq$/, () => viewFaq()], [/^\/party$/, () => viewParty()],
  [/^\/party\/([A-Za-z]{4})$/, m => viewRoom(m[1].toUpperCase())]
];
function go(path, replace = false) {
  if (replace) history.replaceState({}, '', path); else history.pushState({}, '', path);
  route();
}
function route() {
  if (runAbort) { runAbort(); runAbort = null; }
  if (room) { room.close(); room = null; }
  closeSheet(true);
  document.body.classList.remove('playing');
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const key = path.split('/')[1] || 'home';
  const nav = { home: 'home', play: 'home', daily: 'home', unlimited: 'unlimited', party: 'party', boards: 'boards', me: 'me', friends: 'me', settings: 'me', packs: 'home', archive: 'home', faq: 'home' }[key];
  $$('[data-nav]').forEach(a => { if (a.dataset.nav === nav) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const run = () => {
    window.scrollTo(0, 0);
    for (const [re, fn] of routes) { const m = path.match(re); if (m) { fn(m); return; } }
    viewHome();
  };
  if (document.startViewTransition && !reduced && view().firstElementChild && !view().querySelector('.loading')) document.startViewTransition(run); else run();
}
document.addEventListener('click', e => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
  e.preventDefault(); go(a.getAttribute('href'));
});
addEventListener('popstate', () => {
  if (sheetOpen()) { closeSheet(true); return; }
  if (ignorePop) { ignorePop = false; return; }
  route();
});

/* ============ answer sheet ============ */
const sheetEl = () => $('#sheet');
const sheetOpen = () => !!sheetEl()?.open;
function closeSheet(fromHistory) {
  const d = sheetEl(); if (!d || !d.open) return;
  d.close();
  if (!fromHistory && history.state && history.state.sheet) { ignorePop = true; history.back(); }
}
function openSheet(ctx, k) {
  const d = sheetEl(), q = ctx.prompts[k], c = ctx.cards[k];
  const { map, sorted } = dex.tiers(q);
  const byTier = [[], [], [], [], [], []];
  [...sorted].reverse().forEach(i => byTier[map.get(i).t].push(i));
  const st = ctx.stats?.cards?.[k]?.top?.filter(x => dex.S[x.i]) || [];
  const you = c.i >= 0 ? dex.S[c.i] : null, chase = dex.S[c.chase];
  $('#sheetIn').innerHTML = `<span class="sheet__grab" aria-hidden="true"></span>
    <header class="sheet__head"><div><p class="label dim">Card ${k + 1} of ${CARDS}</p><h2 class="display" id="sheetTitle">${esc(shortLabel(q))}</h2><p>${esc(dex.promptText(q))}</p></div><button class="sheet__close" type="button" data-close aria-label="Close">${icon('i-x')}</button></header>
    <div class="you ${tcls(c.t)}"><span class="chip"></span><div><b>${you ? esc(you.n) : 'Miss'}</b> <span class="dim">· ${tname(c.t)} +${c.pts}</span><p>${c.hitChase ? '<b>You pulled the chase card</b>' : `Chase card: <b>${esc(chase.n)}</b>`}${you && fact(q, you) ? ` · ${esc(fact(q, you))}` : ''}</p></div></div>
    ${st.length ? `<section class="sec"><h3 class="label muted">Most said today</h3><ol class="said">${st.slice(0, 5).map(x => { const t = map.get(x.i)?.t ?? 0; return `<li class="${tcls(t)}"><span>${esc(dex.S[x.i].n)} <span class="dim">· ${tname(t)}</span></span><span>${x.pct}%</span><i style="--p:${Math.max(2, x.pct)}%"></i></li>`; }).join('')}</ol></section>` : ''}
    <section class="sec"><h3 class="label muted">All ${q.a.length} answers, rarest first</h3><div class="tiers">${byTier.map((list, t) => ({ list, t })).reverse().filter(x => x.list.length).map(({ list, t }) => `<div class="tier ${tcls(t)}"><h3><i></i>${TIERS[t].name}<em>${TIERS[t].pts} pts · ${list.length}</em></h3><ul class="names">${list.map(i => `<li class="${i === c.i ? 'is-you' : ''}${i === c.chase ? ' is-chase' : ''}">${esc(dex.S[i].n)}${i === c.i ? '<small>you</small>' : i === c.chase ? '<small>chase</small>' : ''}</li>`).join('')}</ul></div>`).join('')}</div></section>
    <nav class="actions" aria-label="Other cards">${k > 0 ? `<button class="btn btn--sm btn--ghost" type="button" data-go="${k - 1}">← Card ${k}</button>` : ''}${k < CARDS - 1 ? `<button class="btn btn--sm btn--ghost" type="button" data-go="${k + 1}">Card ${k + 2} →</button>` : ''}</nav>`;
  $('#sheetIn').scrollTop = 0;
  $$('[data-go]', d).forEach(b => b.addEventListener('click', () => openSheet(ctx, +b.dataset.go)));
  $('[data-close]', d).addEventListener('click', () => closeSheet());
  if (!d.open) {
    history.pushState({ sheet: 1 }, '', location.href);
    d.showModal();
  }
  $('[data-close]', d).focus({ preventScroll: true });
}

/* ============ home ============ */
function nextPackIn() {
  const now = new Date(), mid = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const s = Math.max(0, Math.floor((mid - now) / 1000));
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(v => String(v).padStart(2, '0')).join(':');
}
let tickTimer = null;
function startCountdown(n) {
  clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    const el = $('#countdown'); if (!el) return clearInterval(tickTimer);
    el.textContent = nextPackIn();
    if (today() !== n) { clearInterval(tickTimer); route(); }
  }, 1000);
}
function exampleHTML() {
  const q = data.pool.find(x => x.k === 'type:Electric') || data.pool[0];
  const { map, sorted } = dex.tiers(q);
  const ex = TIERS.map((_, t) => { const l = sorted.filter(i => map.get(i).t === t); return t === 0 ? l[0] : l[Math.floor(l.length / 2)]; });
  return `<section class="example" aria-label="How scoring works">
    <div class="example__q"><span class="label dim">How it works</span><b>${esc(dex.promptText(q))}</b></div>
    <ol>${ex.map((i, t) => `<li><span class="xcard ${tcls(t)}"><span style="font-size:${cardName(dex.S[i]?.n || '')}">${esc(dex.S[i]?.n || '')}</span></span><p><b>${TIERS[t].pts}</b><span>${TIERS[t].name}</span></p></li>`).join('')}</ol>
    <p class="muted" style="font-size:14px">Every answer is a pull. Obvious picks are Commons. Name the ones real fans forget and you pull a God Pull.</p>
  </section>`;
}
function viewHome() {
  const n = today(), done = S.history[n], resume = S.progress?.day === n && !done;
  view().innerHTML = `<div class="col">
    <section class="hero">
      <p class="label kicker">Daily pack #${n} · ${esc(fmtDate(new Date()))}</p>
      <h1 class="display"><span>Name the Pokémon</span><span class="l2">nobody else would.</span></h1>
      ${done ? todayCard(n, done) : `${pack({ line1: `Daily pack #${n}`, id: 'ripPack', label: 'Rip today’s pack' })}
        <button class="btn" id="ripBtn" type="button">${resume ? 'Finish today’s pack' : 'Rip today’s pack'}${icon('i-arrow')}</button>
        <p class="meta"><span><b>7</b> prompts</span><span class="dot"></span><span><b>25s</b> each</span><span class="dot"></span><span>same pack for everyone</span></p>
        ${!S.profile?.id && !Object.keys(S.history).length && passkeysOk() ? `<a class="link back" href="/me" data-link>Played before? Sign in</a>` : ''}`}
    </section>
    ${exampleHTML()}
    <section class="tiles">
      <a class="tile" href="/unlimited" data-link>${icon('i-inf')}<h3 class="display">Unlimited</h3><p>Random packs, no limit.</p></a>
      <a class="tile" href="/party" data-link>${icon('i-party')}<h3 class="display">Hot Pack</h3><p>Party room for 2–8.</p></a>
      <a class="tile" href="/packs" data-link>${icon('i-pack')}<h3 class="display">Themed packs</h3><p>Types, stats, Kanto only…</p></a>
      <a class="tile" href="/archive" data-link>${icon('i-cal')}<h3 class="display">Archive</h3><p>Every past daily pack.</p></a>
    </section>
  </div>`;
  $('#ripBtn')?.addEventListener('click', startDaily);
  $('#ripPack')?.addEventListener('click', startDaily);
  if (done) {
    startCountdown(n);
    $('#todayMinis')?.addEventListener('click', () => go(`/daily/${n}`));
    $('#shareToday')?.addEventListener('click', () => share(dailyShare(n)));
  }
}
function minisHTML(t, attrs = '') { return `<span class="minis" ${attrs}>${t.map(x => `<span class="mini ${tcls(x)}"></span>`).join('')}</span>`; }
function todayCard(n, h) {
  return `<div class="today">
    <div class="today__row"><div><p class="label muted" style="margin-bottom:8px">Today’s pull</p><div class="score">${h.score}<small>/ ${MAX_SCORE}</small></div></div><span class="rate">${esc(rating(h.score))}</span></div>
    <button class="minis" id="todayMinis" type="button" aria-label="See today’s results">${h.t.map(x => `<span class="mini ${tcls(x)}"></span>`).join('')}</button>
    <div class="row" style="flex-wrap:wrap"><button class="btn btn--sm" id="shareToday" type="button">${icon('i-share')}Share</button><a class="btn btn--sm btn--ghost" href="/daily/${n}" data-link>See every answer</a></div>
    <p class="muted">Next pack in <span class="countdown" id="countdown">${nextPackIn()}</span></p>
  </div>`;
}
function dailyShare(n) {
  const h = S.history[n], res = dex.scoreRun(dex.dailyPrompts(n), h.p, 'd' + n);
  return shareText({ label: `godpack DEX #${n}`, score: res.total, cards: res.cards, url: location.host });
}
async function share(text) {
  try {
    if (navigator.share && coarse()) { await navigator.share({ text }); return; }
    await navigator.clipboard.writeText(text); toast('Copied. Paste it anywhere');
  } catch (e) { if (e && e.name === 'AbortError') return; prompt('Copy your result:', text); }
}

/* ============ the play engine ============ */
let kbProxy = null;
function primeKeyboard() {
  if (!coarse()) return;
  kbProxy = kbProxy || Object.assign(document.createElement('input'), { type: 'text', tabIndex: -1 });
  kbProxy.setAttribute('aria-hidden', 'true');
  kbProxy.setAttribute('style', 'position:fixed;top:40%;left:0;width:1px;height:1px;opacity:0;font-size:16px;border:0;padding:0');
  document.body.appendChild(kbProxy); kbProxy.focus({ preventScroll: true });
}
const releaseKeyboard = () => { if (kbProxy && kbProxy.parentNode) kbProxy.remove(); };

function promptFace(q, n, label) {
  return `<div class="face"><div class="pc" style="--accent:${GROUP_COLOR[q.gp] || '#ccc6e4'}">
    <svg class="pc__art" viewBox="0 0 63 88" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><use href="#cb-art"/></svg>
    <div class="pc__head"><span class="pc__group">${esc(GROUPS[q.gp] || 'Prompt')}</span><span class="pc__secs" id="secs" aria-label="Seconds left">${SECONDS}</span></div>
    <div class="pc__mid"><p class="pc__lead">${esc(q.lead)}</p><h2 class="pc__key display" style="--ks:${keySize(q.key)}">${esc(q.key)}</h2>${q.tail ? `<p class="pc__tail">${esc(q.tail)}</p>` : ''}</div>
    <div class="pc__foot"><img src="/img/godpack-logo.webp" alt="" width="409" height="89"><span class="label">${esc(label)} · ${n + 1}/${CARDS}</span></div>
    <div class="pc__timer" id="timer"><i></i></div>
  </div></div>`;
}
function pullFace(q, p, t, pts, hit) {
  const why = fact(q, p);
  return `<div class="face face--back"><div class="pull ${tcls(t)}">
    <div class="pull__top"><span class="pull__tier">${tname(t)}</span><span class="pull__pts">+${pts}</span></div>
    <div class="pull__mid"><h3 class="pull__name display" style="--ns:${keySize(p.n, 1.15)}">${esc(p.n)}</h3><div class="facts"><span>#${p.d}</span><span>Gen ${p.g}</span>${p.t.map(x => `<span class="tp tp-${x}">${x}</span>`).join('')}</div>${why ? `<p class="pull__why">${esc(why)}</p>` : ''}</div>
    ${hit ? '<span class="pull__chase">Chase card</span>' : ''}
    <div class="pull__pips" aria-label="Rarity ${t + 1} of 6">${TIERS.map((_, i) => `<i class="${i <= t ? 'on' : ''}"></i>`).join('')}</div>
  </div></div>`;
}
function missFace(reason, chaseP) {
  return `<div class="face face--back"><div class="pull t-x">
    <div class="pull__top"><span class="pull__tier">Miss</span><span class="pull__pts">+0</span></div>
    <div class="pull__mid"><h3 class="pull__name display" style="--ns:16cqw">${esc(reason)}</h3><p class="pull__why">The chase card was <b>${esc(chaseP.n)}</b></p></div>
  </div></div>`;
}
function burst(stage, t) {
  if (reduced) return;
  const colors = t >= 5 ? ['#8fc8ff', '#a38ce3', '#ea9dce', '#f9e5ad', '#b4dfb9', '#fcfcfc'] : ['#f6cc48', '#fcfcfc', '#f9e5ad'];
  const n = t >= 5 ? 18 : 11;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, d = 120 + Math.random() * 120;
    const s = document.createElement('i'); s.className = 'spark';
    s.style.cssText = `--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d}px;--s:${.6 + Math.random() * .9};--c:${colors[i % colors.length]};animation-delay:${Math.random() * 90}ms`;
    s.innerHTML = icon('i-spark'); stage.appendChild(s); setTimeout(() => s.remove(), 1100);
  }
}

function runPack(cfg) {
  // cfg: { label, prompts, seed, resume, onCard(picks, ms) }
  return new Promise(resolve => {
    document.body.classList.add('playing');
    const picks = [...(cfg.resume?.picks || [])], ms = [...(cfg.resume?.ms || [])];
    let n = picks.length, deadline = 0, raf = 0, state = 'idle', lastTick = 99, card = null, startedAt = 0, pendingAdvance = null, aborted = false;
    view().innerHTML = `<div class="col play">
      <div class="play__bar"><div class="play__meta"><span class="label muted">${esc(cfg.label)}</span><span class="label dim num" id="cnt">${n + 1} / ${CARDS}</span></div>
        <div class="slots">${Array.from({ length: CARDS }, (_, i) => `<span class="slot" data-i="${i}"></span>`).join('')}</div></div>
      <div class="stage" id="stage"><div class="deck" id="deck"><i></i><i></i></div></div>
      <form class="answer" id="answer" autocomplete="off"><label class="sr" for="ans">Your answer</label><input id="ans" name="ans" placeholder="Type a Pokémon…" autocomplete="off" autocapitalize="words" spellcheck="false" enterkeyhint="send" maxlength="24"><button type="submit" aria-label="Submit answer">${icon('i-arrow')}</button></form>
      <p class="hint" id="hint" aria-live="polite">&nbsp;</p>
      <button class="link" id="passBtn" type="button">Pass this card</button>
    </div>`;
    const input = $('#ans'), hint = $('#hint'), stage = $('#stage'), slots = $$('.slot');
    const fillSlot = k => { const q = cfg.prompts[k], i = picks[k], t = i >= 0 ? dex.tierOf(q, i) : -1; const s = slots[k]; s.classList.remove('is-now'); s.classList.add('is-done', tcls(t)); };
    picks.forEach((_, k) => fillSlot(k));
    const setHint = (html, bad) => { hint.innerHTML = html || '&nbsp;'; hint.classList.toggle('is-bad', !!bad); };
    runAbort = () => { aborted = true; cancelAnimationFrame(raf); document.body.classList.remove('playing'); releaseKeyboard(); resolve(null); };

    function deal() {
      if (aborted) return;
      if (n >= CARDS) { runAbort = null; document.body.classList.remove('playing'); releaseKeyboard(); resolve({ picks, ms }); return; }
      const q = cfg.prompts[n];
      slots.forEach((s, k) => s.classList.toggle('is-now', k === n));
      $('#cnt').textContent = `${n + 1} / ${CARDS}`;
      $('#deck').dataset.left = String(CARDS - n - 1);
      $('#card')?.remove();
      stage.insertAdjacentHTML('beforeend', `<div class="card3d is-in" id="card">${promptFace(q, n, cfg.label)}</div>`);
      card = $('#card'); state = 'ask'; setHint('');
      input.value = ''; input.readOnly = false;
      input.focus({ preventScroll: true }); releaseKeyboard();
      startedAt = performance.now(); deadline = startedAt + SECONDS * 1000; lastTick = 99;
      cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
    }
    function loop(now) {
      if (aborted || state !== 'ask') return;
      const left = Math.max(0, deadline - now), s = Math.ceil(left / 1000);
      const bar = $('#timer i', card), secs = $('#secs', card);
      if (bar) bar.style.transform = `scaleX(${left / (SECONDS * 1000)})`;
      if (secs && secs.textContent !== String(s)) secs.textContent = s;
      if (s <= 5) { secs?.classList.add('is-low'); $('#timer', card)?.classList.add('is-low'); if (s < lastTick && s > 0) { sfx.tick(); lastTick = s; } }
      if (left <= 0) return finish(-1, 'Time’s up');
      raf = requestAnimationFrame(loop);
    }
    async function finish(i, reason) {
      if (state !== 'ask') return;
      state = 'reveal'; cancelAnimationFrame(raf);
      const q = cfg.prompts[n], chaseI = dex.chase(q, cfg.seed + ':' + n);
      picks[n] = i; ms[n] = Math.round(Math.min(SECONDS * 1000, performance.now() - startedAt));
      cfg.onCard?.(picks, ms);
      input.readOnly = true;
      const t = i >= 0 ? dex.tierOf(q, i) : -1;
      card.classList.remove('is-in', 'is-shake');
      if (t >= 3 && !reduced) {
        card.style.setProperty('--glow', TIER_COLOR[t]); card.style.setProperty('--cd', [0, 0, 0, .42, .58, .78][t] + 's');
        card.classList.add('is-charge'); sfx.charge(t); buzz(10);
        await sleep([0, 0, 0, 420, 580, 780][t]);
        if (aborted) return;
        card.classList.remove('is-charge');
      }
      if (i >= 0) {
        const p = dex.S[i], hit = i === chaseI;
        card.insertAdjacentHTML('beforeend', pullFace(q, p, t, TIERS[t].pts, hit));
        sfx.pull(t); buzz(t >= 4 ? [20, 40, 30] : 12);
        setHint(hit ? '<b>Chase card!</b> Nobody saw that coming.' : `The chase card was <b>${esc(dex.S[chaseI].n)}</b>`);
      } else {
        card.insertAdjacentHTML('beforeend', missFace(reason, dex.S[chaseI]));
        sfx.miss(); buzz(30); setHint('Tap the card or press Enter to keep going');
      }
      requestAnimationFrame(() => requestAnimationFrame(() => { card.classList.add('is-flipped'); if (t >= 4) setTimeout(() => burst(stage, t), 220); }));
      fillSlot(n);
      const advance = () => {
        if (state !== 'reveal' || aborted) return;
        state = 'leaving'; clearTimeout(auto); card.classList.add('is-out');
        n++; setTimeout(deal, reduced ? 0 : 340);
      };
      const auto = setTimeout(advance, i >= 0 ? [1500, 1700, 1900, 2200, 2500, 2900][t] : 2300);
      card.addEventListener('click', advance, { once: true });
      pendingAdvance = advance;
    }
    $('#answer').addEventListener('submit', e => {
      e.preventDefault();
      if (state === 'reveal') { pendingAdvance?.(); return; }
      if (state !== 'ask') return;
      const q = cfg.prompts[n], text = input.value.trim();
      if (!text) return;
      const valid = new Set(q.a), m = dex.match(text, valid);
      if (!m) { setHint('Not a Pokémon we know. Check the spelling?', true); shake(); sfx.bad(); return; }
      if (!valid.has(m.i)) { setHint(`${whyNot(q, dex.S[m.i])}. Try another.`, true); shake(); sfx.bad(); input.select(); return; }
      finish(m.i);
    });
    $('#passBtn').addEventListener('click', () => { if (state === 'ask') finish(-1, 'Passed'); else if (state === 'reveal') pendingAdvance?.(); });
    function shake() { card.classList.remove('is-in', 'is-shake'); void card.offsetWidth; card.classList.add('is-shake'); buzz([8, 30, 8]); }
    deal();
  });
}

/* ============ starting runs (one path for every mode) ============ */
async function startDaily() {
  primeKeyboard();
  const n = today();
  if (S.history[n]) return go(`/daily/${n}`, true);
  if (location.pathname !== '/') history.replaceState({}, '', '/');
  const prompts = dex.dailyPrompts(n), resume = S.progress?.day === n ? S.progress : null;
  // a start ticket (no account needed) lets the server tell real runs from scripted ones
  let ticket = resume?.ticket || null, asking = false;
  const ask = () => { if (ticket || asking) return; asking = true; api(`/daily/ticket?day=${n}`).then(r => { ticket = r.ticket; if (S.progress?.day === n) { S.progress.ticket = ticket; save('progress'); } }).catch(() => { /* offline is fine */ }).finally(() => { asking = false; }); };
  ask();
  await ripPack(`Daily pack #${n}`, '7 cards inside');
  const out = await runPack({ label: `Daily pack #${n}`, prompts, seed: 'd' + n, resume, onCard: (picks, ms) => { if (picks.length < 4) ask(); S.progress = { day: n, picks, ms, ticket }; save('progress'); } });
  if (!out) return;
  const res = dex.scoreRun(prompts, out.picks, 'd' + n);
  S.history[n] = { score: res.total, t: res.cards.map(c => c.t), p: out.picks, ms: out.ms, at: Date.now(), sent: false, ticket };
  save('history'); S.progress = null; store.del('progress'); syncStreak();
  history.replaceState({}, '', `/daily/${n}`);
  viewDailyResults(n, true);
}
async function startUnlimited() {
  primeKeyboard();
  if (location.pathname !== '/unlimited') history.replaceState({}, '', '/unlimited');
  const seed = (Math.random() * 1e9) | 0, prompts = dex.randomPrompts(seed);
  await ripPack('Unlimited', 'Random pack');
  const out = await runPack({ label: 'Unlimited', prompts, seed: 'u' + seed });
  if (!out) return;
  const u = S.extra.unlimited, res = dex.scoreRun(prompts, out.picks, 'u' + seed);
  u.played = (u.played || 0) + 1; const best = res.total > (u.best || 0); if (best) u.best = res.total; save('extra');
  renderResults({ mode: 'unlimited', label: 'Unlimited', kicker: 'Unlimited pack · opened', prompts, picks: out.picks, seed: 'u' + seed });
  if (best && u.played > 1) toast('New Unlimited best');
}
async function startPack(id) {
  const p = PACKS.find(x => x.id === id); if (!p) return go('/packs', true);
  primeKeyboard();
  const seed = (Math.random() * 1e9) | 0;
  const prompts = p.id === 'kanto' ? dex.kantoPrompts(seed) : dex.randomPrompts(seed, p.groups);
  await ripPack(p.name, 'Themed pack');
  const out = await runPack({ label: p.name, prompts, seed: 'p' + seed });
  if (!out) return;
  const res = dex.scoreRun(prompts, out.picks, 'p' + seed);
  if (res.total > (S.extra.packs[id] || 0)) { S.extra.packs[id] = res.total; save('extra'); }
  renderResults({ mode: 'pack', packId: id, label: p.name, kicker: `${p.name} · opened`, prompts, picks: out.picks, seed: 'p' + seed });
}
async function startArchive(d) {
  primeKeyboard();
  const prompts = dex.dailyPrompts(d);
  await ripPack(`Daily pack #${d}`, 'From the archive');
  const out = await runPack({ label: `Archive #${d}`, prompts, seed: 'd' + d });
  if (!out) return;
  const res = dex.scoreRun(prompts, out.picks, 'd' + d);
  S.extra.archive[d] = { score: res.total, p: out.picks }; save('extra');
  renderResults({ mode: 'archive', day: d, label: `Archive #${d}`, kicker: `Daily pack #${d} · archive`, prompts, picks: out.picks, seed: 'd' + d });
}

/* ============ results (shared by every mode) ============ */
function renderResults(ctx) {
  const res = dex.scoreRun(ctx.prompts, ctx.picks, ctx.seed);
  ctx.cards = res.cards;
  const actions = {
    daily: `<button class="btn" id="shareBtn" type="button">${icon('i-share')}Share</button><a class="btn btn--ghost" href="/boards" data-link>Boards</a>`,
    unlimited: `<button class="btn" id="againBtn" type="button">Rip another${icon('i-arrow')}</button><button class="btn btn--ghost" id="shareBtn" type="button">${icon('i-share')}Share</button>`,
    pack: `<button class="btn" id="againBtn" type="button">Rip again${icon('i-arrow')}</button><a class="btn btn--ghost" href="/packs" data-link>All packs</a>`,
    archive: `<button class="btn" id="shareBtn" type="button">${icon('i-share')}Share</button><a class="btn btn--ghost" href="/archive" data-link>Archive</a>`
  }[ctx.mode];
  view().innerHTML = `<div class="col results">
    <header class="res__head"><p class="label kicker">${esc(ctx.kicker)}</p><div class="score">${res.total}<small>/ ${MAX_SCORE}</small></div><span class="rate">${esc(rating(res.total))}</span></header>
    <div class="hand">${res.cards.map((c, k) => { const p = c.i >= 0 ? dex.S[c.i] : null; return `<button class="rcard ${tcls(c.t)}" type="button" data-k="${k}" style="--i:${k}" aria-label="Card ${k + 1}: ${esc(shortLabel(ctx.prompts[k]))}. ${p ? esc(p.n) + ', ' + tname(c.t) : 'Miss'}. See every answer"><b>${tname(c.t)}</b><small>${esc(shortLabel(ctx.prompts[k]))}</small>${c.hitChase ? `<em>${icon('i-spark')}</em>` : ''}<span style="--ns:${cardName(p ? p.n : 'Miss')}">${esc(p ? p.n : 'Miss')}</span></button>`; }).join('')}</div>
    <p class="hand__hint">Tap any card to see every answer</p>
    <div class="actions">${actions}</div>
    ${ctx.mode === 'daily' ? `<div class="ranks" id="ranks"><div><b>…</b><span>Worldwide</span></div><div><b>…</b><span>Country</span></div><div><b>…</b><span>Region</span></div></div><div id="nameBox"></div>` : ''}
    <section class="sec"><div class="sec__head"><h2 class="display h2">Your pulls</h2></div>
      <ol class="pulls">${res.cards.map((c, k) => { const q = ctx.prompts[k], p = c.i >= 0 ? dex.S[c.i] : null; return `<li><button class="prow" type="button" data-k="${k}"><span class="chip ${tcls(c.t)}"></span><span><span class="q">${esc(dex.promptText(q))}</span><span class="a">${p ? esc(p.n) : 'Miss'}<small>${c.t >= 0 ? `${TIERS[c.t].name} · +${c.pts}` : '+0'}</small></span><span class="q">${c.hitChase ? '<b style="color:var(--peach)">Chase card pulled</b>' : `Chase: ${esc(dex.S[c.chase].n)}`}</span></span><span class="go">${q.a.length}${icon('i-chev')}</span></button></li>`; }).join('')}</ol>
    </section>
    ${ctx.mode === 'daily' ? `<p class="next">Next daily pack in <span class="countdown" id="countdown">${nextPackIn()}</span><br><a class="link" href="/unlimited" data-link>Can’t wait? Rip an Unlimited pack</a></p>` : ''}
    ${insertGodpack('results')}
  </div>`;
  $$('[data-k]').forEach(b => b.addEventListener('click', () => openSheet(ctx, +b.dataset.k)));
  const shareLabel = { daily: `godpack DEX #${ctx.day}`, unlimited: 'godpack DEX Unlimited', pack: `godpack DEX · ${ctx.label}`, archive: `godpack DEX #${ctx.day} (archive)` }[ctx.mode];
  $('#shareBtn')?.addEventListener('click', () => share(shareText({ label: shareLabel, score: res.total, cards: res.cards, url: location.host })));
  $('#againBtn')?.addEventListener('click', () => (ctx.mode === 'unlimited' ? startUnlimited() : startPack(ctx.packId)));
  if (ctx.mode === 'daily') { startCountdown(today()); loadDailyExtras(ctx); }
  return res;
}
async function loadDailyExtras(ctx) {
  const n = ctx.day;
  try {
    const rk = await submitDaily(n) || (S.profile ? (await api(`/rank?day=${n}`).catch(() => null))?.rank : null);
    renderRanks(rk);
    if (!S.profile?.name) renderNameBox();
    renderSaveNudge();
    ctx.stats = await dayStats(n, true).catch(() => null);
  } catch {
    const el = $('#ranks'); if (el) el.outerHTML = `<p class="empty">Boards are offline right now. Your score is saved here and will sync later.</p>`;
  }
}
function renderRanks(rk) {
  const el = $('#ranks'); if (!el || !rk) return;
  const cell = (r, label, scope) => `<a href="/boards?scope=${scope}" data-link><b>${r && r.rank ? '#' + r.rank : '—'}</b><span>${esc(label)}${r && r.of ? ` · ${r.of}` : ''}</span></a>`;
  if (rk.global?.flagged) { el.outerHTML = `<p class="empty">${flagNote(rk.global.flagged)}</p>`; return; }
  el.innerHTML = cell(rk.global, 'Worldwide', 'global') + cell(rk.country, countryName(S.profile?.country) || 'Country', 'country') + cell(rk.region, S.profile?.regionName || 'Region', 'region');
}
const flagNote = f => (f === 1 ? 'This run was played offline, so it’s in your history and streak but not on today’s boards.' : 'This run finished too fast to count on the boards. It’s still in your history and streak.');
function renderSaveNudge() {
  const box = $('#nameBox');
  if (!box || box.firstElementChild || !passkeysOk() || !S.profile?.id || S.profile.passkeys) return;
  const m = S.meta;
  if (Object.keys(S.history).length < 2 || (m.nudges || 0) >= 3 || Date.now() - (m.nudgeAt || 0) < 6 * 864e5) return;
  const { cur } = streakInfo();
  box.innerHTML = `<section class="savecard">
    <div class="savecard__t">${icon('i-key')}<div><h2 class="display">${cur > 1 ? `Keep your ${cur}-day streak` : 'Keep your scores'}</h2><p>Save your DEX with a passkey and play on any device. No email, no password.</p></div></div>
    <div class="row"><button class="btn btn--sm" type="button" data-save>Save with passkey</button><button class="link" type="button" data-later>Not now</button></div>
  </section>`;
  wirePasskeys(box, () => { box.innerHTML = ''; });
  $('[data-later]', box).addEventListener('click', () => { m.nudges = (m.nudges || 0) + 1; m.nudgeAt = Date.now(); save('meta'); box.innerHTML = ''; });
}
function renderNameBox() {
  const box = $('#nameBox'); if (!box) return;
  box.innerHTML = `<form class="namecap" id="nameForm"><p>Add a trainer name so friends can find you on the boards.</p><div class="row"><label class="sr" for="tn">Trainer name</label><input class="input" id="tn" maxlength="16" placeholder="Trainer name" autocomplete="nickname"><button class="btn btn--sm" type="submit">Save</button></div></form>`;
  $('#nameForm').addEventListener('submit', async e => {
    e.preventDefault();
    const name = cleanName($('#tn').value); if (name.length < 2) return toast('Use at least 2 letters');
    try { const r = await api('/me/name', { body: { name } }); S.profile.name = r.name; save('profile'); box.innerHTML = ''; toast(`You’re on the boards as ${r.name}`); } catch (er) { toast(er.message); }
  });
}
function viewDailyResults(n, fresh) {
  const h = S.history[n];
  if (!h) return n === today() ? viewHome() : go(`/archive/${n}`, true);
  renderResults({ mode: 'daily', day: n, label: `Daily pack #${n}`, kicker: `Daily pack #${n} · opened`, prompts: dex.dailyPrompts(n), picks: h.p, seed: 'd' + n });
  if (fresh && h.score >= 450) sfx.pull(5);
}

/* ============ unlimited, packs, archive ============ */
function viewUnlimited() {
  const u = S.extra.unlimited;
  view().innerHTML = `<div class="col"><section class="hero">
    <p class="label kicker">Unlimited</p>
    <h1 class="display"><span>Rip another.</span><span class="l2">And another.</span></h1>
    ${pack({ line1: 'Unlimited', line2: 'Random pack', id: 'ripPack', label: 'Rip a random pack' })}
    <button class="btn" id="ripBtn" type="button">Rip a random pack${icon('i-arrow')}</button>
    <p class="meta"><span>Best <b>${u.best || 0}</b></span><span class="dot"></span><span><b>${u.played || 0}</b> ripped</span><span class="dot"></span><span>off the daily boards</span></p>
  </section></div>`;
  $('#ripBtn').addEventListener('click', startUnlimited);
  $('#ripPack').addEventListener('click', startUnlimited);
}
function viewPacks() {
  view().innerHTML = `<div class="col">
    <header class="ph"><p class="label kicker">Themed packs</p><h1 class="display ph__t">Pick your<br><span>specialty.</span></h1><p class="ph__sub">Seven prompts from one theme. For fun and bragging, off the daily boards.</p></header>
    <section class="tiles">${PACKS.map(p => `<a class="tile tile--pack" href="/packs/${p.id}" data-link>${S.extra.packs[p.id] ? `<span class="best" aria-label="Best score">${S.extra.packs[p.id]}</span>` : ''}<h3 class="display">${esc(p.name)}</h3><p>${esc(p.blurb)}</p></a>`).join('')}</section>
  </div>`;
}
const archiveScore = d => { const a = S.extra.archive[d]; return a == null ? null : typeof a === 'number' ? { score: a, p: null } : a; };
function viewArchive() {
  const n = today(), rows = [];
  for (let d = n - 1; d >= 1; d--) {
    const own = S.history[d], arc = archiveScore(d);
    const right = own ? `<span class="end"><b>${own.score}</b>${icon('i-chev')}</span>` : arc ? `<span class="end"><span class="dim">${arc.score} · replay</span>${icon('i-chev')}</span>` : `<span class="end"><span class="label">Rip</span>${icon('i-chev')}</span>`;
    rows.push(`<li><a href="${own ? `/daily/${d}` : `/archive/${d}`}" data-link><span><span class="t">Daily pack #${d}</span><br><span class="s">${esc(fmtDate(dateOfDay(data, d)))}</span></span>${right}</a></li>`);
  }
  view().innerHTML = `<div class="col">
    <header class="ph"><p class="label kicker">Archive</p><h1 class="display ph__t">Every daily<br><span>pack so far.</span></h1><p class="ph__sub">Archive packs don’t count toward the boards or your streak.</p></header>
    ${rows.length ? `<ul class="list">${rows.join('')}</ul>` : `<p class="empty">No old packs yet. Come back tomorrow.</p>`}
  </div>`;
}
function viewArchiveDay(d) {
  const n = today();
  if (d < 1 || d >= n) return go('/archive', true);
  if (S.history[d]) return go(`/daily/${d}`, true);
  const arc = archiveScore(d);
  if (arc && arc.p) return renderResults({ mode: 'archive', day: d, label: `Archive #${d}`, kicker: `Daily pack #${d} · archive`, prompts: dex.dailyPrompts(d), picks: arc.p, seed: 'd' + d });
  startArchive(d);
}

/* ============ boards ============ */
const PERIODS = [['day', 'Today'], ['month', 'Month'], ['all', 'All-time']];
const boardState = { period: 'day', scope: 'global' };
// public boards are cached at the edge and carry a short hash of each player id, so we can spot our own row
let myHash = null;
async function idHash() {
  const id = S.profile?.id; if (!id || !crypto.subtle) return null;
  if (myHash?.id !== id) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id)); myHash = { id, h: [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 12) }; }
  return myHash.h;
}
function viewBoards() {
  const sp = new URLSearchParams(location.search);
  if (sp.get('scope')) boardState.scope = sp.get('scope');
  if (PERIODS.some(([k]) => k === sp.get('period'))) boardState.period = sp.get('period');
  view().innerHTML = `<div class="col">
    <header class="ph"><p class="label kicker">Leaderboards</p><h1 class="display ph__t">Who pulled<br><span>deepest.</span></h1></header>
    <section class="sec">
      <div class="seg" role="group" aria-label="When">${PERIODS.map(([k, l]) => `<button type="button" data-p="${k}">${l}</button>`).join('')}</div>
      <div class="chips" id="scopes" role="group" aria-label="Where"></div>
      <div id="board"><div class="loading loading--sm"><span class="spinner"></span></div></div>
    </section>
  </div>`;
  const draw = g => {
    const el = $('#scopes'); if (!el) return;
    const scopes = [['global', 'Worldwide'], ['country', g.country ? countryName(g.country) : ''], ['region', g.regionName || ''], ['friends', 'Friends']].filter(([k, l]) => k === 'global' || k === 'friends' || l);
    if (!scopes.some(([k]) => k === boardState.scope)) boardState.scope = 'global';
    el.innerHTML = scopes.map(([k, l]) => `<button type="button" data-s="${k}" aria-pressed="${k === boardState.scope}">${esc(l)}</button>`).join('');
    $$('[data-p]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.p === boardState.period)));
    $$('[data-s]', el).forEach(b => b.addEventListener('click', () => { boardState.scope = b.dataset.s; draw(g); loadBoard(); }));
  };
  let geoNow = S.profile?.country ? { country: S.profile.country, regionName: S.profile.regionName } : S.geo || {};
  $$('[data-p]').forEach(b => b.addEventListener('click', () => { boardState.period = b.dataset.p; draw(geoNow); loadBoard(); }));
  draw(geoNow);
  geoInfo().then(g => { if (g.country !== geoNow.country || g.regionName !== geoNow.regionName) { geoNow = g; draw(g); } }).catch(() => {});
  loadBoard();
}
async function loadBoard() {
  const el = $('#board'); if (!el) return;
  el.innerHTML = `<div class="loading loading--sm"><span class="spinner"></span></div>`;
  const n = today(), { period, scope } = boardState, tag = (loadBoard.tag = `${period}:${scope}:${Math.random()}`);
  try {
    const g = await geoInfo();
    const q = `period=${period}&scope=${scope}&day=${n}`;
    const [pub, mine, h] = await Promise.all([
      scope === 'friends' ? null : api(`/board?${q}&cc=${g.country || ''}&rg=${g.region || ''}`),
      S.profile?.id ? api(`/board/me?${q}`).catch(() => null) : null,
      idHash()
    ]);
    if (!$('#board') || loadBoard.tag !== tag) return;
    const rows = (scope === 'friends' ? mine?.rows : pub?.rows) || [], me = mine?.me || null;
    const isMe = x => !!h && x.h === h, meIn = rows.some(isMe), link = period === 'day' && S.history[n];
    const row = (x, you) => { const inner = `<span class="r">${x.rank ? (x.capped ? '1k+' : '#' + x.rank) : '—'}</span><span class="n">${esc(x.name || 'Trainer')}${x.cc ? `<small>${esc(x.cc)}</small>` : ''}</span><span class="s">${x.score}</span>`; return `<li class="${you ? 'me' : ''}">${you && link ? `<a href="/daily/${n}" data-link>${inner}</a>` : `<div>${inner}</div>`}</li>`; };
    const empty = scope === 'friends' && !S.profile?.id ? 'Swap friend codes to race your crew. <a href="/friends" data-link>Add a friend</a>.'
      : period === 'day' ? (S.history[n] ? 'Your score is on its way to the board.' : 'Nobody here has ripped today’s pack yet. <a href="/" data-link>Be first</a>.')
      : 'No scores here yet. <a href="/" data-link>Rip today’s pack</a>.';
    let html = rows.length ? `<ol class="board">${rows.map(x => row(x, isMe(x))).join('')}</ol>` : `<p class="empty">${empty}</p>`;
    if (rows.length && me?.rank && !meIn) html += `<ol class="board board--me">${row({ rank: me.rank, capped: me.capped, name: 'You' + (S.profile?.name ? ' · ' + S.profile.name : ''), score: me.score }, true)}</ol>`;
    if (me?.flagged) html += `<p class="muted center">${flagNote(me.flagged)}</p>`;
    else if (scope === 'friends' && rows.length === 1 && meIn) html += `<p class="muted center">Just you so far. <a href="/friends" data-link>Add a friend code</a>.</p>`;
    if (!S.profile?.name && (me?.rank || meIn)) html += `<p class="muted center">You show up as a Trainer number. <a href="/me" data-link>Add a name</a>.</p>`;
    el.innerHTML = html;
  } catch {
    if ($('#board') && loadBoard.tag === tag) el.innerHTML = `<p class="empty">Boards are offline right now. Try again in a minute.</p>`;
  }
}

/* ============ my dex, friends, settings, faq ============ */
function viewMe() {
  const { cur, best } = streakInfo();
  const plays = Object.entries(S.history).sort((a, b) => b[0] - a[0]);
  const scores = plays.map(([, h]) => h.score);
  const tiers = [0, 0, 0, 0, 0, 0, 0];
  plays.forEach(([, h]) => h.t.forEach(t => tiers[t >= 0 ? t : 6]++));
  const tot = tiers.reduce((a, b) => a + b, 0) || 1;
  view().innerHTML = `<div class="col">
    <header class="ph"><p class="label kicker">My DEX</p>
      <div class="ph__row"><h1 class="display ph__t" id="meName">${esc(S.profile?.name || 'New trainer')}</h1><button class="link" id="editName" type="button"${S.profile?.name ? '' : ' hidden'}>Change name</button></div>
      <form class="row" id="nameForm"${S.profile?.name ? ' hidden' : ''}><label class="sr" for="tn">Trainer name</label><input class="input" id="tn" maxlength="16" placeholder="Add a trainer name" value="${esc(S.profile?.name || '')}" autocomplete="nickname"><button class="btn btn--sm" type="submit">Save</button></form>
      <p class="ph__sub" id="meWhere">${esc([countryName(S.profile?.country), S.profile?.regionName].filter(Boolean).join(' · '))}</p>
    </header>
    ${accountCard()}
    <section class="stats">
      <div class="stat"><b>${plays.length}</b><span>Daily packs</span></div>
      <div class="stat"><b>${cur}</b><span>Day streak</span></div>
      <div class="stat"><b>${best}</b><span>Best streak</span></div>
      <div class="stat"><b>${scores.length ? Math.max(...scores) : 0}</b><span>Best score</span></div>
      <div class="stat"><b>${scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0}</b><span>Average</span></div>
      <div class="stat"><b>${S.extra.unlimited.best || 0}</b><span>Unlimited best</span></div>
    </section>
    <section class="sec"><h2 class="display h2">Your pulls</h2>
      <div class="stack">${tiers.map((v, i) => `<i style="width:${(100 * v / tot).toFixed(2)}%;background:${i < 6 ? TIER_COLOR[i] : '#3a3150'}"></i>`).join('')}</div>
      <div class="legend">${TIERS.map((t, i) => `<span style="--c:${TIER_COLOR[i]}">${t.name} ${tiers[i]}</span>`).join('')}<span style="--c:#3a3150">Miss ${tiers[6]}</span></div>
    </section>
    <section class="sec"><h2 class="display h2">History</h2>
      ${plays.length ? `<ul class="list">${plays.slice(0, 40).map(([d, h]) => `<li><a href="/daily/${d}" data-link><span><span class="t">Pack #${d}</span><br><span class="s">${esc(fmtDate(dateOfDay(data, +d)))}</span></span><span class="end">${minisHTML(h.t)}<b>${h.score}</b>${icon('i-chev')}</span></a></li>`).join('')}</ul>` : `<p class="empty">Rip your first daily pack to start your history. <a href="/" data-link>Rip today’s pack</a></p>`}
    </section>
    <ul class="links">
      <li><a href="/friends" data-link>${icon('i-friends')}Friends${S.profile?.code ? ` <span class="code dim" style="font-size:13px">${esc(S.profile.code)}</span>` : ''}${icon('i-chev')}</a></li>
      <li><a href="/packs" data-link>${icon('i-pack')}Themed packs${icon('i-chev')}</a></li>
      <li><a href="/archive" data-link>${icon('i-cal')}Archive${icon('i-chev')}</a></li>
      <li><a href="/settings" data-link>${icon('i-gear')}Settings and devices${icon('i-chev')}</a></li>
      <li><a href="/faq" data-link>${icon('i-help')}How it works${icon('i-chev')}</a></li>
    </ul>
  </div>`;
  $('#nameForm').addEventListener('submit', async e => {
    e.preventDefault();
    const name = cleanName($('#tn').value); if (name.length < 2) return toast('Use at least 2 letters');
    try { await ensurePlayer(); const r = await api('/me/name', { body: { name } }); S.profile.name = r.name; save('profile'); $('#tn').value = r.name; $('#meName').textContent = r.name; $('#nameForm').hidden = true; $('#editName').hidden = false; toast('Name saved'); } catch (er) { toast(er.message || 'Couldn’t save that'); }
  });
  $('#editName').addEventListener('click', () => { $('#nameForm').hidden = false; $('#editName').hidden = true; $('#tn').focus(); $('#tn').select(); });
  wirePasskeys(view(), () => route());
  if (!S.profile?.id) { geoInfo().then(g => { const w = $('#meWhere'); if (w && !w.textContent) w.textContent = [countryName(g.country), g.regionName].filter(Boolean).join(' · '); }).catch(() => {}); return; }
  const had = !!S.profile.passkeys;
  api('/me').then(me => {
    const changed = applyMe(me);
    if (location.pathname !== '/me') return;
    if (changed || had !== !!me.passkeys) return route();
    const w = $('#meWhere'); if (w) w.textContent = [countryName(me.country), me.regionName].filter(Boolean).join(' · ');
    const tn = $('#tn'); if (tn && document.activeElement !== tn && !tn.value) tn.value = me.name || '';
    if (me.name && $('#meName')) { $('#meName').textContent = me.name; if ($('#nameForm') && document.activeElement !== tn) { $('#nameForm').hidden = true; $('#editName').hidden = false; } }
  }).catch(e => { if (e.status === 401) { S.profile = null; store.del('profile'); } });
}
function viewFriends() {
  view().innerHTML = `<div class="col">
    <header class="ph"><p class="label kicker">Friends</p><h1 class="display ph__t">Your<br><span>crew.</span></h1><p class="ph__sub">Swap friend codes to see each other on the Friends board.</p></header>
    <div class="card field"><span class="lbl">Your friend code</span><div class="row" style="justify-content:space-between"><span class="code" id="myCode" style="font-size:22px">······</span><button class="btn btn--sm btn--ghost" id="copyCode" type="button">${icon('i-copy')}Copy</button></div></div>
    <form class="row" id="addForm"><label class="sr" for="fc">Friend code</label><input class="input code" id="fc" maxlength="6" placeholder="FRIEND CODE" style="text-transform:uppercase" autocomplete="off"><button class="btn btn--sm" type="submit">Add</button></form>
    <div id="flist"><div class="loading loading--sm"><span class="spinner"></span></div></div>
  </div>`;
  ensurePlayer().then(() => {
    $('#myCode') && ($('#myCode').textContent = S.profile.code || '······');
    loadFriends();
  }).catch(() => { const f = $('#flist'); if (f) f.innerHTML = '<p class="empty">Friends need a connection. Try again in a minute.</p>'; });
  $('#copyCode').addEventListener('click', async () => { if (!S.profile?.code) return; try { await navigator.clipboard.writeText(S.profile.code); toast('Friend code copied'); } catch { prompt('Your friend code:', S.profile.code); } });
  $('#addForm').addEventListener('submit', async e => {
    e.preventDefault(); const code = $('#fc').value.trim().toUpperCase(); if (code.length !== 6) return toast('Friend codes have 6 characters');
    try { await ensurePlayer(); await api('/friends', { body: { code } }); $('#fc').value = ''; toast('Friend added'); loadFriends(); } catch (er) { toast(er.message); }
  });
}
async function loadFriends() {
  const el = $('#flist'); if (!el) return;
  try {
    const r = await api(`/friends?day=${today()}`);
    el.innerHTML = r.friends.length ? `<ul class="list">${r.friends.map(f => `<li><div><span><span class="t">${esc(f.name || 'Trainer')}</span> <span class="label dim">${esc(f.cc || '')}</span><br><span class="s">${f.today != null ? `Today ${f.today}` : 'Hasn’t ripped today'} · total ${f.total}</span></span><button class="link" data-rm="${esc(f.code)}" type="button">Remove</button></div></li>`).join('')}</ul><p style="text-align:center"><a class="btn btn--sm btn--ghost" href="/boards?scope=friends" data-link>Friends board</a></p>` : `<p class="empty">No friends yet. Share your code and add theirs.</p>`;
    $$('[data-rm]').forEach(b => b.addEventListener('click', async () => { await api('/friends/' + b.dataset.rm, { method: 'DELETE' }).catch(() => {}); loadFriends(); }));
  } catch { el.innerHTML = '<p class="empty">Couldn’t load friends right now.</p>'; }
}
function viewSettings() {
  const key = S.profile?.id ? `${S.profile.id}.${S.profile.key}` : '';
  const saved = !!S.profile?.passkeys, has = !!(S.profile?.id || Object.keys(S.history).length);
  const acct = !passkeysOk()
    ? `<p class="muted">${inApp ? 'Open this page in Safari or Chrome to save your DEX with a passkey.' : 'Passkeys aren’t available in this browser.'} You can still move devices with your device key below.</p>`
    : saved
      ? `<p class="muted">Saved with ${S.profile.passkeys === 1 ? 'a passkey' : S.profile.passkeys + ' passkeys'}. Sign in with it on any phone or computer to pick up where you left off.</p>
        <div class="row" style="flex-wrap:wrap"><button class="btn btn--sm btn--ghost" type="button" data-save>${icon('i-key')}Add a passkey</button><button class="btn btn--sm btn--ghost" type="button" id="signOut">Sign out</button></div>`
      : `<p class="muted">Save your DEX with a passkey to keep your streak safe and play on other devices. It uses Face ID, fingerprint or your screen lock. No email, no password.</p>
        <div class="row" style="flex-wrap:wrap">${has ? `<button class="btn btn--sm" type="button" data-save>${icon('i-key')}Save with passkey</button>` : ''}<button class="btn btn--sm ${has ? 'btn--ghost' : ''}" type="button" data-signin>Sign in</button></div>`;
  view().innerHTML = `<div class="col">
    <header class="ph"><p class="label kicker">Settings</p><h1 class="display ph__t">Settings</h1></header>
    <section class="sec">
      <label class="toggle"><span>Sound effects</span><input type="checkbox" id="setSound" ${S.settings.sound ? 'checked' : ''}></label>
      <label class="toggle"><span>Vibration on phones</span><input type="checkbox" id="setHap" ${S.settings.haptics ? 'checked' : ''}></label>
    </section>
    <section class="sec" id="acct"><h2 class="display h2">Your DEX</h2>
      ${acct}
      <details class="more"${passkeysOk() ? '' : ' open'}><summary>Device key</summary>
        <p class="muted">Copy it here and paste it on another phone or computer to carry your scores, streak and friends across. Keep it private: anyone with it can play as you.</p>
        <div class="row" style="flex-wrap:wrap"><button class="btn btn--sm btn--ghost" id="copyKey" type="button" ${key ? '' : 'disabled'}>${icon('i-copy')}Copy my device key</button></div>
        <form class="row" id="restoreForm"><label class="sr" for="rk">Device key</label><input class="input" id="rk" placeholder="Paste a device key" autocomplete="off"><button class="btn btn--sm" type="submit">Use</button></form>
      </details>
    </section>
    <section class="sec"><h2 class="display h2">Reset</h2>
      <p class="muted">Clears this device’s history, streak and bests. Scores already on the boards stay.</p>
      <div><button class="btn btn--sm btn--ghost" id="resetBtn" type="button">Clear this device</button></div>
    </section>
  </div>`;
  $('#setSound').addEventListener('change', e => { S.settings.sound = e.target.checked; save('settings'); syncSoundBtn(); if (S.settings.sound) sfx.pass(); });
  $('#setHap').addEventListener('change', e => { S.settings.haptics = e.target.checked; save('settings'); buzz(20); });
  $('#copyKey').addEventListener('click', async () => { try { await navigator.clipboard.writeText(key); toast('Device key copied'); } catch { prompt('Your device key:', key); } });
  wirePasskeys($('#acct'), () => viewSettings());
  $('#signOut')?.addEventListener('click', async () => {
    if (!confirm('Sign out on this device? Your DEX stays saved. Sign back in any time with your passkey.')) return;
    await signOut(); toast('Signed out'); go('/');
  });
  $('#restoreForm').addEventListener('submit', async e => {
    e.preventDefault(); const v = $('#rk').value.trim(); const [id, k] = v.split('.');
    if (!id || !k) return toast('That doesn’t look like a device key');
    const prev = S.profile; S.profile = { id, key: k };
    try {
      const me = await api('/me');
      S.profile = { id, key: k }; applyMe(me); save('history'); syncStreak();
      toast('Device key accepted'); viewSettings();
    } catch { S.profile = prev; toast('That key didn’t work'); }
  });
  $('#resetBtn').addEventListener('click', () => {
    if (!confirm('Clear history, streak and bests on this device?')) return;
    S.history = {}; S.extra = { unlimited: { best: 0, played: 0 }, packs: {}, archive: {} }; S.progress = null;
    save('history'); save('extra'); store.del('progress'); syncStreak(); toast('Cleared');
  });
}
function viewFaq() {
  const qa = [
    ['How does it work?', `One pack a day, 7 prompts, the same for everyone. Each prompt asks for a Pokémon that fits, like “a Fire-type” or “a Pokémon heavier than 200 kg”. You get ${SECONDS} seconds per card and as many guesses as you like inside that time.`],
    ['How is rarity decided?', 'Every answer is a pull. We rank each valid answer by how likely a typical fan is to say it, compared with the other answers to that prompt. Generation, starters, legendaries, anime fame and evolution stage all feed in. Obvious picks are Commons; the ones real fans forget are God Pulls.'],
    ['What are the tiers?', TIERS.map(t => `${t.name} ${t.pts}`).join(' · ') + `. A perfect pack scores ${MAX_SCORE} and earns the God Pack title.`],
    ['What’s the chase card?', 'Each prompt hides one chase card: a rare answer that some players will find. Pull it and your result gets a star.'],
    ['Can I see every answer?', 'Yes. After a pack, tap any card or row in your results to see every valid answer sorted by rarity, plus the most-said answers of the day.'],
    ['Does spelling matter?', 'A little. Small typos on longer names are fine, and spaces, accents and punctuation are ignored, so “mr mime”, “farfetchd” and “ho oh” all work.'],
    ['Which forms count?', 'Each species counts once, in its standard form. Regional forms and Megas don’t change the answer, so Vulpix is a Fire-type here.'],
    ['How do the boards work?', 'Your daily score goes on today’s boards: worldwide, your country, your region and your friends. Ties go to whoever answered faster. Month adds up your daily packs this calendar month, and All-time adds up every one. Your country and region come from your connection, and only your country code shows next to your name.'],
    ['What is Hot Pack?', 'A party room for 2 to 8 players. Name a Pokémon that fits the prompt to pass the pack on, no repeats. A hidden fuse runs 10 to 30 seconds and whoever holds the pack when it pops loses a life. Last trainer standing wins.'],
    ['Do I need an account?', 'No. Just play: your scores and streak are kept on this device. To keep them safe or play on another phone or computer, save your DEX with a passkey from My DEX. It uses Face ID, fingerprint or your screen lock, with no email and no password, and you sign in with it anywhere.'],
    ['Who made this?', 'godpack DEX is made by godpack.io, where you can open TCG packs and collect real graded cards (18+). It’s a fan-made game and isn’t affiliated with or endorsed by Nintendo, Creatures, GAME FREAK or The Pokémon Company.']
  ];
  view().innerHTML = `<div class="col">
    <header class="ph"><p class="label kicker">How it works</p><h1 class="display ph__t">FAQ</h1></header>
    ${exampleHTML()}
    <section class="faq">${qa.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</section>
  </div>`;
}

/* ============ party (Hot Pack) ============ */
function viewParty() {
  const nm = store.get('partyName', '') || S.profile?.name || '';
  view().innerHTML = `<div class="col">
    <section class="hero"><p class="label kicker">Hot Pack · party mode</p><h1 class="display"><span>Pass the pack</span><span class="l2">before it pops.</span></h1>
      <p class="muted" style="max-width:30em">Name a Pokémon that fits the prompt to pass the pack on. No repeats. A hidden fuse runs 10 to 30 seconds, and whoever holds it when it pops loses a life.</p></section>
    <form class="card field" id="createForm"><label for="pn">Your name</label><input class="input" id="pn" maxlength="16" value="${esc(nm)}" placeholder="Trainer name" autocomplete="nickname"><button class="btn btn--block" type="submit">Create a room${icon('i-arrow')}</button></form>
    <form class="card field" id="joinForm"><label for="rc">Joining a friend? Enter their room code</label><div class="row"><input class="input code" id="rc" maxlength="4" placeholder="ABCD" style="text-transform:uppercase" autocomplete="off"><button class="btn btn--sm" type="submit">Join</button></div></form>
  </div>`;
  const name = () => { const v = cleanName($('#pn').value) || cleanName(S.profile?.name) || 'Trainer'; store.set('partyName', v); return v; };
  $('#createForm').addEventListener('submit', async e => {
    e.preventDefault(); name();
    try { const r = await api('/party', { method: 'POST', body: {} }); go('/party/' + r.code); } catch { toast('Couldn’t create a room. Try again.'); }
  });
  $('#joinForm').addEventListener('submit', e => { e.preventDefault(); name(); const c = $('#rc').value.trim().toUpperCase(); if (!/^[A-Z]{4}$/.test(c)) return toast('Room codes are 4 letters'); go('/party/' + c); });
}
function viewRoom(code) {
  const name = store.get('partyName', '') || S.profile?.name || '';
  if (!name) {
    view().innerHTML = `<div class="col"><header class="ph"><p class="label kicker">Room ${esc(code)}</p><h1 class="display ph__t">Who’s<br><span>playing?</span></h1></header>
      <form class="row" id="nf"><label class="sr" for="pn">Your name</label><input class="input" id="pn" maxlength="16" placeholder="Trainer name" autocomplete="nickname"><button class="btn btn--sm" type="submit">Join</button></form></div>`;
    $('#pn').focus();
    $('#nf').addEventListener('submit', e => { e.preventDefault(); const v = cleanName($('#pn').value); if (v.length < 2) return toast('Use at least 2 letters'); store.set('partyName', v); viewRoom(code); });
    return;
  }
  view().innerHTML = `<div class="col room" id="room"><div class="loading"><span class="spinner"></span><p class="label">Joining room ${esc(code)}</p></div></div>`;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  let ws, closed = false, st = null, retry = 0, lastPhase = '', lastTurn = '', lastPrompt = '';
  const me = S.pid;
  const connect = () => {
    ws = new WebSocket(`${proto}://${location.host}/api/party/${code}/ws`);
    ws.onopen = () => { retry = 0; ws.send(JSON.stringify({ t: 'hello', name, pid: S.pid })); };
    ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch { return; } onMsg(m); };
    ws.onclose = () => { if (closed) return; if (retry++ < 6) setTimeout(connect, 600 * retry); else { const r = $('#room'); if (r) r.innerHTML = `<p class="empty">Lost the room. <a href="/party" data-link>Back to Hot Pack</a></p>`; } };
  };
  room = { close() { closed = true; try { ws.close(); } catch { /* noop */ } } };
  const send = m => { try { if (ws.readyState === 1) ws.send(JSON.stringify(m)); } catch { /* noop */ } };
  function onMsg(m) {
    if (m.t === 'state') { st = m.s; render(); return; }
    if (m.t === 'typing' && st && m.pid !== me) { const el = $('#typing'); if (el) el.textContent = m.text; return; }
    if (m.t === 'reject') { const h = $('#rhint'); if (h) { h.innerHTML = m.reason === 'used' ? `<b>${esc(m.name)}</b> was already said` : m.reason === 'invalid' ? `<b>${esc(m.name)}</b> doesn’t fit` : 'Not a Pokémon we know'; h.classList.add('is-bad'); } sfx.bad(); buzz([8, 30, 8]); return; }
    if (m.t === 'pass') { sfx.pass(); return; }
    if (m.t === 'pop') { sfx.pop(); buzz([60, 40, 60]); const b = $('#bomb'); if (b) { b.classList.remove('is-pop'); void b.offsetWidth; b.classList.add('is-pop'); } toast(`${m.name} got popped`); return; }
    if (m.t === 'err') { toast(m.msg); if (m.fatal) { closed = true; const r = $('#room'); if (r) r.innerHTML = `<p class="empty">${esc(m.msg)} <a href="/party" data-link>Back to Hot Pack</a></p>`; } }
  }
  function render() {
    const el = $('#room'); if (!el || !st) return;
    const host = st.players.find(p => p.host), isHost = host && host.pid === me, myTurn = st.turn === me && st.phase === 'play';
    const players = `<div class="players">${st.players.map(p => `<div class="player${p.pid === st.turn && st.phase === 'play' ? ' is-turn' : ''}${!p.alive && st.phase !== 'lobby' ? ' is-out' : ''}${!p.online ? ' is-off' : ''}"><span class="av">${esc((p.name || '?')[0].toUpperCase())}</span><span>${esc(p.name)}${p.pid === me ? ' (you)' : ''}${p.host ? ' · host' : ''}</span>${st.phase !== 'lobby' ? `<span class="lives" aria-label="${p.lives} lives">${Array.from({ length: st.settings.lives }, (_, i) => `<i class="${i < p.lives ? '' : 'lost'}"></i>`).join('')}</span>` : ''}</div>`).join('')}</div>`;
    const online = st.players.filter(p => p.online).length;
    if (st.phase === 'lobby') {
      el.innerHTML = `<section class="hero"><p class="label kicker">Room code</p><div class="bigcode">${esc(st.code)}</div>
          <button class="btn btn--sm btn--ghost" id="invite" type="button">${icon('i-share')}Invite friends</button></section>
        ${players}
        ${isHost ? `<div class="card field"><span class="lbl">Lives each</span><div class="seg" role="group" aria-label="Lives">${[1, 2, 3, 4, 5].map(v => `<button type="button" data-lives="${v}" aria-pressed="${st.settings.lives === v}">${v}</button>`).join('')}</div>
          <button class="btn btn--block" id="startBtn" type="button" ${online < 2 ? 'disabled' : ''}>${online < 2 ? 'Waiting for players…' : `Start with ${online} players`}</button></div>` : `<p class="muted" style="text-align:center">Waiting for ${esc(host ? host.name : 'the host')} to start…</p>`}`;
      $('#invite')?.addEventListener('click', async () => { const url = `${location.origin}/party/${st.code}`; try { if (navigator.share && coarse()) await navigator.share({ url, text: 'Join my Hot Pack room on godpack DEX' }); else { await navigator.clipboard.writeText(url); toast('Invite link copied'); } } catch { /* cancelled */ } });
      $$('[data-lives]').forEach(b => b.addEventListener('click', () => send({ t: 'settings', lives: +b.dataset.lives })));
      $('#startBtn')?.addEventListener('click', () => send({ t: 'start' }));
    } else if (st.phase === 'play') {
      const q = st.prompt, turnP = st.players.find(p => p.pid === st.turn), keep = document.activeElement?.id === 'rin';
      el.innerHTML = `${players}
        <div class="bomb is-hot" id="bomb" style="--jit:${Math.max(.12, .5 - (st.heat || 0) * .38)}s">${pack({ line1: 'Hot pack', line2: 'Don’t hold it', tag: 'div' })}</div>
        <div class="qcard"><p>${esc(q.lead)}</p><h2 class="display">${esc(q.key)}</h2>${q.tail ? `<p>${esc(q.tail)}</p>` : ''}</div>
        <p class="label turn">${myTurn ? '<span class="kicker">Your turn. Pass it on!</span>' : `${esc(turnP ? turnP.name : '…')} is holding the pack`}</p>
        <p class="typing" id="typing"></p>
        <form class="answer" id="rform" autocomplete="off" style="margin:0 auto"><label class="sr" for="rin">Your answer</label><input id="rin" placeholder="${myTurn ? 'Name a Pokémon…' : 'Wait for your turn'}" ${myTurn ? '' : 'disabled'} autocomplete="off" spellcheck="false" enterkeyhint="send" maxlength="24"><button type="submit" aria-label="Pass the pack" ${myTurn ? '' : 'disabled'}>${icon('i-arrow')}</button></form>
        <p class="hint" id="rhint" style="margin:0 auto">&nbsp;</p>
        ${st.used.length ? `<ul class="feed" aria-label="Already said">${st.used.slice(-24).reverse().map(u => `<li class="${tcls(u.t)}">${esc(dex.S[u.i]?.n || '?')}</li>`).join('')}</ul>` : ''}`;
      const inp = $('#rin');
      if (myTurn && (keep || lastTurn !== st.turn || q.k !== lastPrompt)) inp.focus({ preventScroll: true });
      if (myTurn && lastTurn !== st.turn) buzz(15);
      lastTurn = st.turn; lastPrompt = q.k;
      let tt = 0;
      inp.addEventListener('input', () => { clearTimeout(tt); tt = setTimeout(() => send({ t: 'typing', text: inp.value.slice(0, 24) }), 60); });
      $('#rform').addEventListener('submit', e => { e.preventDefault(); const v = inp.value.trim(); if (!v) return; send({ t: 'answer', text: v }); inp.select(); });
    } else if (st.phase === 'over') {
      const w = st.players.find(p => p.pid === st.winner);
      if (lastPhase !== 'over') { sfx.pull(5); buzz([30, 60, 30]); }
      el.innerHTML = `<section class="hero"><p class="label kicker">Room ${esc(st.code)} · game over</p><h1 class="display"><span>${esc(w ? w.name : 'Nobody')}</span><span class="l2">wins the pack.</span></h1></section>
        ${players}
        ${isHost ? `<button class="btn btn--block" id="again" type="button">Play again${icon('i-arrow')}</button>` : `<p class="muted" style="text-align:center">Waiting for the host to start a rematch…</p>`}
        <p style="text-align:center"><a class="link" href="/party" data-link>Leave room</a></p>
        ${insertLive()}`;
      $('#again')?.addEventListener('click', () => send({ t: 'start' }));
    }
    lastPhase = st.phase;
  }
  connect();
}

/* ============ one address: dex.godpack.live ============ */
// old workers.dev links land here with their progress, so nobody loses a streak in the move
function moveToCanonical() {
  if (!location.hostname.endsWith('.workers.dev')) return false;
  const m = {};
  if (S.profile?.id) m.p = { id: S.profile.id, key: S.profile.key };
  const unsent = Object.fromEntries(Object.entries(S.history).filter(([, h]) => !h.sent));
  if (Object.keys(unsent).length) m.h = unsent;
  const x = S.extra;
  if (x.unlimited.played || Object.keys(x.packs).length || Object.keys(x.archive).length) m.x = x;
  if (store.get('settings', null)) m.s = S.settings;
  if (S.progress) m.g = S.progress;
  location.replace(`https://${CANON}${location.pathname}${location.search}${Object.keys(m).length ? '#m=' + b64u(JSON.stringify(m)) : ''}`);
  return true;
}
function importMove() {
  const hit = location.hash.match(/^#m=([\w-]+)$/); if (!hit) return false;
  history.replaceState(history.state, '', location.pathname + location.search);
  let m; try { m = JSON.parse(unb64u(hit[1])); } catch { return false; }
  const fresh = !S.profile?.id || !Object.keys(S.history).length;
  if (m.p?.id && m.p.key && fresh) { S.profile = { id: m.p.id, key: m.p.key }; save('profile'); }
  if (m.h && S.profile?.id === m.p?.id) { for (const [d, h] of Object.entries(m.h)) if (!S.history[d]) S.history[d] = h; save('history'); }
  if (m.x) {
    const x = S.extra;
    x.unlimited = { best: Math.max(x.unlimited.best || 0, m.x.unlimited?.best || 0), played: Math.max(x.unlimited.played || 0, m.x.unlimited?.played || 0) };
    x.packs = { ...(m.x.packs || {}), ...x.packs }; x.archive = { ...(m.x.archive || {}), ...x.archive }; save('extra');
  }
  if (m.s && !store.get('settings', null)) { S.settings = { ...S.settings, ...m.s }; save('settings'); }
  if (m.g && !S.progress) { S.progress = m.g; save('progress'); }
  return true;
}
// redraw after a background sync only when nothing is in play
function refreshIdle() { if (!runAbort && !room && !sheetOpen() && (location.pathname === '/' || location.pathname === '/me')) route(); }

/* ============ boot ============ */
async function boot() {
  if (moveToCanonical()) return;
  const moved = importMove();
  syncSoundBtn();
  $('#soundBtn').addEventListener('click', () => { S.settings.sound = !S.settings.sound; save('settings'); syncSoundBtn(); if (S.settings.sound) sfx.pass(); });
  const vv = window.visualViewport;
  const setVV = () => document.documentElement.style.setProperty('--vvh', (vv ? vv.height : innerHeight) + 'px');
  setVV(); vv?.addEventListener('resize', setVV); addEventListener('resize', setVV);
  const d = sheetEl();
  d.addEventListener('cancel', e => { e.preventDefault(); closeSheet(); });
  d.addEventListener('click', e => { if (e.target === d) closeSheet(); });
  try {
    data = await fetch(`/data/dex.json?v=${V}`).then(r => { if (!r.ok) throw new Error('data'); return r.json(); });
  } catch {
    view().innerHTML = `<p class="empty">Couldn’t load the Pokédex. Check your connection and refresh.</p>`; return;
  }
  dex = makeDex(data);
  syncStreak();
  route();
  // no player is made just for visiting: one appears with the first score, name, friend or passkey
  if (S.profile?.id) flushPending().then(() => syncMe(moved)).then(changed => { if (changed) refreshIdle(); }).catch(() => { /* offline */ });
}
boot();
