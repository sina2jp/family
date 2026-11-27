/*!
 * family-sync.js 1.0.0 - Family Sync for Math Arena, Language Quest, Code Quest, Music Quest and the Family Hub.
 * Copy this file UNCHANGED into every app (same origin, same localStorage), like family-wallet.js. Vanilla JS, no deps.
 *
 * WHAT IT DOES
 *   A grown-up sets things up once in the Family Hub (/family/). His laptop connects once (the family link).
 *   Settings flow grown-up -> kid; progress flows kid -> grown-up, through the family's own backend (a Google Apps
 *   Script web app bound to a Sheet in the grown-up's account). Every key has ONE writer:
 *     settings keys: written only by grown-up devices;  progress keys: written only by the kid device.
 *   Parent actions on kid-owned data (shard/rupee adjustments, ticket approvals) are REQUESTS that the kid device
 *   applies once, idempotent by id, through FamilyWallet. Nothing can conflict.
 *
 * NOT CONNECTED = TODAY'S BEHAVIOUR: no network, no localStorage writes, status().state === 'off'.
 *
 * LOCAL KEYS (this file only)
 *   familyApps.sync.v1        { v:1, endpoint, familyId, secret, deviceId, role:'kid'|'grownup', connectedAt, lastRev }
 *   familyApps.sync.state.v1  bookkeeping: pushed hashes, applied revs, pending keys, retry timer
 *   familyApps.sync.mirror.v1 grown-up only: latest copy of the kid's family progress (Hub dashboard, offline first)
 *   familyApps.sync.backup.v1 kid only: the side that lost a first-connect merge
 *   familyApps.sync.lease.v1  tab lease when navigator.locks is missing
 *
 * PROTOCOL v1  POST text/plain (no CORS preflight) JSON {v:1, op, familyId, auth, device, ...} -> JSON {ok, ...}
 *   create {}                         first time only          ping {}  -> {ok, family}
 *   get {keys?, sinceRev?, role?, devices?} -> {rev, items:[{key, value, rev, updatedAt, device, role}], devices?}
 *   put {items:[{key, value}], claim?} -> {rev, revs:{key: rev}, refused:{key: reason}}
 *   pairCreate {secret} -> {code, expiresAt}       pairRedeem {code} -> {familyId, secret}
 *   auth = HKDF-SHA256(secret, 'auth'). The backend stores only a salted SHA-256 of it. The AI key is AES-GCM
 *   encrypted with HKDF-SHA256(secret, 'aes-gcm'), which never leaves the family's devices.
 */
(function (root, factory) {
  var FS = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = FS;
  if (root && !root.FamilySync) root.FamilySync = FS;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  function make() {
    var VERSION = '1.0.0';
    var K = {
      config: 'familyApps.sync.v1', state: 'familyApps.sync.state.v1', mirror: 'familyApps.sync.mirror.v1',
      backup: 'familyApps.sync.backup.v1', lease: 'familyApps.sync.lease.v1',
      rewards: 'familyApps.rewards.v1', pin: 'familyApps.pin.v1', aiKey: 'familyApps.anthropicKey.v1',
      walletAdjust: 'familyApps.walletAdjust.v1', ticketApprovals: 'familyApps.ticketApprovals.v1', look: 'familyApps.look.v1',
      wallet: 'familyApps.wallet.v1', walletTime: 'familyApps.walletTime.v1', tickets: 'familyApps.tickets.v1',
      inventory: 'familyApps.inventory.v1', requestsDone: 'familyApps.requestsDone.v1', skin: 'hyruleKit.skin',
    };
    var APPS = ['math', 'language', 'code', 'music'];
    var LOOKS = { hyrule: 1, grove: 1 };
    var MAX_VALUE = 300000; // characters per key (the backend refuses more)
    var PIN_ITER = 120000;
    function summaryKey(app) { return 'familyApps.summary.' + app + '.v1'; }

    // ---------- environment (tests and the Hub preview swap these) ----------
    var env = { storage: undefined, transport: null, now: null, locks: undefined, wallet: undefined, win: undefined, crypto: null, channel: undefined, online: null, visible: null };
    function now() { return env.now ? env.now() : Date.now(); }
    function iso(t) { return new Date(t == null ? now() : t).toISOString(); }
    function win() { return env.win !== undefined ? env.win : (typeof root.addEventListener === 'function' ? root : null); }
    function store() {
      if (env.storage !== undefined) return env.storage;
      try { var s = root.localStorage; if (s) { s.getItem(K.config); return s; } } catch (e) {}
      return null;
    }
    function getRaw(k) { var s = store(); if (!s) return null; try { var v = s.getItem(k); return v == null ? null : String(v); } catch (e) { return null; } }
    function setRaw(k, v) { var s = store(); if (!s) return false; try { if (v == null) s.removeItem(k); else s.setItem(k, String(v)); return true; } catch (e) { return false; } }
    function parse(v) { if (v == null) return null; try { return JSON.parse(v); } catch (e) { return null; } }
    function readJSON(k) { return parse(getRaw(k)); }
    function writeJSON(k, o) { return setRaw(k, JSON.stringify(o)); }
    function each(a, f) { if (Array.isArray(a)) for (var i = 0; i < a.length; i++) f(a[i], i); }
    function keysOf(o) { return o ? Object.keys(o) : []; }
    function err(code, msg) { var e = new Error(msg || code); e.code = code; return e; }
    function seq(list, fn) { var p = Promise.resolve(); each(list, function (x) { p = p.then(function () { return fn(x); }); }); return p; }
    function hashStr(s) {
      if (s == null) return 'null';
      s = String(s);
      var h1 = 0x811c9dc5, h2 = 5381;
      for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); h1 ^= c; h1 = Math.imul(h1, 0x01000193); h2 = (Math.imul(h2, 33) + c) | 0; }
      return (h1 >>> 0).toString(16) + '.' + (h2 >>> 0).toString(16) + '.' + s.length;
    }
    function timingSafeEq(a, b) { a = String(a); b = String(b); if (a.length !== b.length) return false; var d = 0; for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
    function online() { if (env.online) return env.online(); return !(root.navigator && root.navigator.onLine === false); }
    function visible() { if (env.visible) return env.visible(); var d = root.document; return !d || d.visibilityState !== 'hidden'; }
    function later(fn, ms) { return setTimeout(fn, ms); }

    // ---------- bytes and crypto (WebCrypto) ----------
    function cryptoObj() { return env.crypto || root.crypto; }
    function subtle() { var c = cryptoObj(); return c && c.subtle; }
    function randomBytes(n) { var a = new Uint8Array(n); cryptoObj().getRandomValues(a); return a; }
    function utf8(s) { return new TextEncoder().encode(String(s)); }
    function b64u(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
    function unb64u(str) { var s = String(str).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; var bin = atob(s); var out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
    function randomId(n) { var abc = 'abcdefghijkmnpqrstuvwxyz23456789', b = randomBytes(n), s = ''; for (var i = 0; i < n; i++) s += abc[b[i] % abc.length]; return s; }
    var keyCache = {}, authCache = {};
    function familyKeys(secret) {
      if (keyCache[secret]) return keyCache[secret];
      var S = subtle();
      if (!S) return Promise.reject(err('no-crypto', 'This browser cannot do secure sync.'));
      var p = S.importKey('raw', unb64u(secret), 'HKDF', false, ['deriveBits', 'deriveKey']).then(function (base) {
        var salt = utf8('familyApps.sync.v1');
        return Promise.all([
          S.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt, info: utf8('auth') }, base, 256),
          S.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: salt, info: utf8('aes-gcm') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']),
        ]);
      }).then(function (r) { var o = { auth: b64u(new Uint8Array(r[0])), aes: r[1] }; authCache[secret] = o.auth; return o; });
      keyCache[secret] = p;
      p.catch(function () { delete keyCache[secret]; });
      return p;
    }
    function aesEncrypt(secret, familyId, key, plain) {
      return familyKeys(secret).then(function (fk) {
        var iv = randomBytes(12);
        return subtle().encrypt({ name: 'AES-GCM', iv: iv, additionalData: utf8(familyId + '|' + key) }, fk.aes, utf8(plain)).then(function (ct) {
          return 'fsenc1:' + b64u(iv) + '.' + b64u(new Uint8Array(ct));
        });
      });
    }
    function aesDecrypt(secret, familyId, key, value) {
      var m = /^fsenc1:([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(value || ''));
      if (!m) return Promise.reject(err('not-encrypted'));
      return familyKeys(secret).then(function (fk) {
        return subtle().decrypt({ name: 'AES-GCM', iv: unb64u(m[1]), additionalData: utf8(familyId + '|' + key) }, fk.aes, unb64u(m[2]));
      }).then(function (pt) { return new TextDecoder().decode(new Uint8Array(pt)); });
    }
    function pinHash(pin, salt, iter) {
      var S = subtle();
      return S.importKey('raw', utf8('familyApps.pin|' + pin), 'PBKDF2', false, ['deriveBits']).then(function (k) {
        return S.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64u(salt), iterations: iter }, k, 256);
      }).then(function (b) { return b64u(new Uint8Array(b)); });
    }
    function makePinRecord(pin) {
      pin = String(pin == null ? '' : pin);
      if (!/^\d{4}$/.test(pin)) return Promise.reject(err('bad-pin', 'The PIN must be 4 digits.'));
      var salt = b64u(randomBytes(16));
      return pinHash(pin, salt, PIN_ITER).then(function (h) { return { v: 1, alg: 'PBKDF2-SHA256', iter: PIN_ITER, salt: salt, hash: h, digits: 4, updatedAt: iso() }; });
    }
    function pinRecord() { var r = readJSON(K.pin); return r && r.v === 1 && r.salt && r.hash && r.iter >= 1000 ? r : null; }
    function pinIsSet() { return !!pinRecord(); }
    function checkPin(pin) {
      var r = pinRecord();
      if (!r) return Promise.resolve(false);
      return pinHash(String(pin == null ? '' : pin), r.salt, r.iter).then(function (h) { return timingSafeEq(h, r.hash); }, function () { return false; });
    }

    // ---------- registry: who writes which key ----------
    var REG = {}, GROUPS = {}, thisApp = '';
    function group(id) { return GROUPS[id] || (GROUPS[id] = { settings: [], progress: [], localOnly: [], score: null }); }
    function rule(key, owner, grp, extra) {
      var old = REG[key];
      if (old) { var og = group(old.group); ['settings', 'progress', 'localOnly'].forEach(function (n) { var i = og[n].indexOf(key); if (i >= 0) og[n].splice(i, 1); }); }
      var r = { key: key, owner: owner, group: grp, codec: (extra && extra.codec) || 'raw', keepLocal: extra && Array.isArray(extra.keepLocal) ? extra.keepLocal.slice() : null };
      REG[key] = r;
      group(grp)[owner === 'grownup' ? 'settings' : owner === 'kid' ? 'progress' : 'localOnly'].push(key);
      return r;
    }
    function isFamilyKey(k) { return !!(REG[k] && REG[k].group.indexOf('family') === 0); }
    function norm(x) { return typeof x === 'string' ? { key: x } : x && typeof x === 'object' && typeof x.key === 'string' ? x : null; }
    function register(app, spec) {
      app = String(app || '');
      if (!/^[a-z][a-z0-9-]{1,20}$/.test(app)) return false;
      spec = spec || {};
      each(spec.settings, function (x) { x = norm(x); if (x && !isFamilyKey(x.key)) rule(x.key, 'grownup', app, x); });
      each(spec.progress, function (x) { x = norm(x); if (x && !isFamilyKey(x.key)) rule(x.key, 'kid', app, x); });
      each(spec.localOnly, function (x) { x = norm(x); if (x && !isFamilyKey(x.key)) rule(x.key, 'local', app, x); });
      if (typeof spec.score === 'function') group(app).score = spec.score;
      if (!REG[summaryKey(app)]) rule(summaryKey(app), 'kid', 'family:summary');
      if (!thisApp && spec.current !== false) thisApp = app;
      return true;
    }
    [K.rewards, K.pin, K.walletAdjust, K.ticketApprovals, K.look].forEach(function (k) { rule(k, 'grownup', 'family'); });
    rule(K.aiKey, 'grownup', 'family', { codec: 'aes' });
    [K.wallet, K.walletTime, K.tickets, K.inventory, K.requestsDone].forEach(function (k) { rule(k, 'kid', 'family'); });
    APPS.forEach(function (a) { rule(summaryKey(a), 'kid', 'family:summary'); });
    // The four apps' own keys (same lists as INTEGRATION.md); an app's register() call can extend them.
    var BUILTIN = {
      math: { settings: [{ key: 'mathArena.v3.schoolSync.v1', keepLocal: ['done'] }],
        progress: ['mathArena.v3.data.v1', 'mathArena.v3.nickname', 'mathArena.v3.comebackStart', 'mathArena.v3.mockResults'],
        localOnly: ['mathArena.v3.active.v1', 'mathArena.v3.questTab', 'mathArena.v3.muted', 'mathArena.v3.keypad', 'mathArena.v3.migration', 'mathArena.v3.lastBackup', 'mathArena.v3.aiUsage', 'mathArena.v3.test'] },
      language: { progress: ['langQuest.state'], localOnly: ['langQuest.pin'] },
      code: { progress: ['codeQuest.progress.v1', 'codeQuest.settings.v1', 'codeQuest.secrets.v1', 'codeQuest.schema'], localOnly: ['codeQuest.parentPin.v1', 'codeQuest.usage.v1', 'familyApps.usage.v1'] },
      music: { settings: ['musicQuest.myLessons.v1'], progress: ['musicQuest.v1'] },
    };
    APPS.forEach(function (a) { var b = BUILTIN[a]; b.current = false; register(a, b); });
    thisApp = '';
    function ownerOf(k) { return REG[k] ? REG[k].owner : null; }
    function keysOwnedBy(owner) { var out = []; for (var k in REG) if (REG[k].owner === owner) out.push(k); return out; }

    // ---------- config + state ----------
    var cfg = null, st = null;
    function validFamilyId(id) { return /^[A-Za-z0-9_-]{6,128}$/.test(String(id || '')); }
    function validSecret(s) { return /^[A-Za-z0-9_-]{22}$/.test(String(s || '')); }
    function validEndpoint(u) { return /^https:\/\/[^\s/]+\/\S*$/.test(String(u || '')) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/\S*$/.test(String(u || '')); }
    function familyIdFor(endpoint) { var m = /^https:\/\/script\.google\.com\/macros\/s\/(AKfy[A-Za-z0-9_-]{20,120})\/exec$/.exec(String(endpoint || '').trim()); return m ? m[1] : null; }
    function endpointFor(familyId) { return /^AKfy[A-Za-z0-9_-]{20,120}$/.test(String(familyId || '')) ? 'https://script.google.com/macros/s/' + familyId + '/exec' : null; }
    function loadConfig() {
      var c = readJSON(K.config);
      cfg = c && c.v === 1 && validFamilyId(c.familyId) && validSecret(c.secret) && c.deviceId && (c.role === 'kid' || c.role === 'grownup') && validEndpoint(c.endpoint) ? c : null;
      return cfg;
    }
    function saveConfig() { if (cfg) writeJSON(K.config, cfg); }
    function isConnected() { return !!loadConfig(); }
    function role() { return loadConfig() ? cfg.role : null; }
    function freshState() { return { v: 1, pushed: {}, applied: {}, pending: {}, failCount: 0, nextRetryAt: 0, lastPullAt: 0, lastOkAt: 0, lastError: '', keysSig: '', paused: '', tooBig: {} }; }
    function loadState() { var s = readJSON(K.state); st = s && s.v === 1 ? s : freshState(); ['pushed', 'applied', 'pending', 'tooBig'].forEach(function (n) { if (!st[n] || typeof st[n] !== 'object') st[n] = {}; }); return st; }
    function saveState() { if (st && cfg) writeJSON(K.state, st); }
    function loadMirror() { var m = readJSON(K.mirror); return m && m.v === 1 ? m : { v: 1, items: {}, devices: [], at: '' }; }

    // ---------- transport (pluggable) ----------
    function httpTransport(endpoint, body, opts) {
      var f = root.fetch;
      if (!f) return Promise.reject(err('network', 'No network in this browser.'));
      var text = JSON.stringify(body), ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null, timer = null;
      var init = { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: text, credentials: 'omit', cache: 'no-store', redirect: 'follow' };
      if (ctrl) { init.signal = ctrl.signal; timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, opts.timeoutMs || 20000); }
      if (opts.keepalive) init.keepalive = true;
      var p;
      try { p = f.call(root, endpoint, init); } catch (e) {
        if (opts.keepalive && root.navigator && root.navigator.sendBeacon) { try { root.navigator.sendBeacon(endpoint, new Blob([text], { type: 'text/plain;charset=UTF-8' })); } catch (e2) {} return Promise.resolve({ ok: true, beacon: true }); }
        return Promise.reject(err('network', e && e.message));
      }
      return p.then(function (r) { return r.text(); }).then(function (t) {
        if (timer) clearTimeout(timer);
        try { return JSON.parse(t); } catch (e) { throw err('bad-response', 'The family backend sent something unexpected.'); }
      }, function (e) {
        if (timer) clearTimeout(timer);
        throw e && e.name === 'AbortError' ? err('timeout', 'The family backend did not answer in time.') : err('network', e && e.message);
      });
    }
    function transport() { return env.transport || httpTransport; }
    var appVersion = '';
    function deviceName() {
      var ua = (root.navigator && root.navigator.userAgent) || '';
      var os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : 'Device';
      var br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
      return os + ' · ' + br;
    }
    function currentApp() {
      if (thisApp) return thisApp;
      var m = /\/(math-arena|language-quest|code-quest|music-quest|family)\//.exec((root.location && root.location.pathname) || '');
      return m ? { 'math-arena': 'math', 'language-quest': 'language', 'code-quest': 'code', 'music-quest': 'music', family: 'hub' }[m[1]] : '';
    }
    function bodyFor(op, payload, c) {
      var body = { v: 1, op: op };
      if (c) { body.familyId = c.familyId; body.device = { id: c.deviceId, role: c.role, name: deviceName(), app: currentApp(), ver: VERSION + (appVersion ? '/' + appVersion : '') }; }
      for (var k in payload || {}) body[k] = payload[k];
      return body;
    }
    function check(res) {
      if (!res || typeof res !== 'object') throw err('bad-response', 'The family backend sent something unexpected.');
      if (!res.ok) throw err(res.error || 'error', res.message || res.error || 'error');
      return res;
    }
    function call(op, payload, opts) {
      opts = opts || {};
      var c = opts.cfg || cfg, endpoint = opts.endpoint || (c && c.endpoint);
      if (!endpoint) return Promise.reject(err('no-endpoint', 'No family backend address yet.'));
      var body = bodyFor(op, payload, c);
      var a = c && op !== 'pairRedeem' && op !== 'ping' ? familyKeys(c.secret).then(function (fk) { body.auth = fk.auth; }) : Promise.resolve();
      return a.then(function () { return transport()(endpoint, body, { timeoutMs: opts.timeoutMs || 20000, keepalive: !!opts.keepalive }); }).then(check);
    }

    // ---------- status ----------
    var statusCbs = [], updateCbs = [], cur = { state: 'off' };
    function computeStatus(state) {
      if (!loadConfig()) return { connected: false, role: null, state: 'off', text: '', pending: 0 };
      if (!st) loadState();
      var pending = keysOf(st.pending).length, s = state || cur.state;
      if (st.paused) s = 'paused';
      var text = { synced: '☁ synced', pending: '☁ saving…', syncing: '☁ syncing…', offline: '☁ offline · saved here', error: '☁ sync problem', paused: '☁ sync paused', idle: '☁ connected' }[s] || '☁ connected';
      return { connected: true, role: cfg.role, state: s, text: text, pending: pending, lastSyncAt: st.lastOkAt ? iso(st.lastOkAt) : '', lastError: st.lastError || '', paused: st.paused || '', deviceId: cfg.deviceId, familyId: cfg.familyId.slice(0, 6) + '…', tooBig: keysOf(st.tooBig) };
    }
    function setStatus(state) {
      var prev = cur.state;
      cur = computeStatus(state);
      if (prev !== cur.state || state === 'synced') statusCbs.slice().forEach(function (cb) { try { cb(cur); } catch (e) {} });
      return cur;
    }
    function status() { return computeStatus(); }
    function onStatus(cb) { statusCbs.push(cb); return function () { var i = statusCbs.indexOf(cb); if (i >= 0) statusCbs.splice(i, 1); }; }
    function onUpdate(cb) { updateCbs.push(cb); return function () { var i = updateCbs.indexOf(cb); if (i >= 0) updateCbs.splice(i, 1); }; }
    var bc = null;
    function channel() {
      if (env.channel !== undefined) return env.channel;
      if (bc === null) { try { bc = typeof BroadcastChannel === 'function' ? new BroadcastChannel('familyApps.sync') : false; if (bc) bc.onmessage = function (e) { var d = e && e.data; if (d && d.type === 'update' && Array.isArray(d.keys)) dispatch(d.keys, 'tab', true); else if (d && d.type === 'status') setStatus(); }; } catch (e) { bc = false; } }
      return bc || null;
    }
    function dispatch(keys, source, fromTab) {
      if (!keys || !keys.length) return;
      var detail = { keys: keys.slice(), source: source || 'pull' };
      updateCbs.slice().forEach(function (cb) { try { cb(detail); } catch (e) {} });
      var w = win();
      if (w && typeof w.dispatchEvent === 'function' && typeof CustomEvent === 'function') { try { w.dispatchEvent(new CustomEvent('familysync:update', { detail: detail })); } catch (e) {} }
      if (!fromTab) { var ch = channel(); if (ch) { try { ch.postMessage({ type: 'update', keys: detail.keys, source: detail.source }); } catch (e) {} } }
    }

    // ---------- locks (navigator.locks, else a localStorage lease) ----------
    var tabId = 't' + Math.random().toString(36).slice(2, 10);
    function withLock(name, fn, opts) {
      var locks = env.locks !== undefined ? env.locks : root.navigator && root.navigator.locks;
      var ifAvail = !!(opts && opts.ifAvailable);
      if (locks && typeof locks.request === 'function') {
        return locks.request(name, { ifAvailable: ifAvail }, function (lock) { return lock ? fn() : { skipped: true }; });
      }
      var key = K.lease + ':' + name;
      var tryTake = function () {
        var l = readJSON(key), t = now();
        if (l && l.tab !== tabId && l.until > t) return false;
        writeJSON(key, { tab: tabId, until: t + 15000 });
        var back = readJSON(key);
        return !!(back && back.tab === tabId);
      };
      var release = function () { var l = readJSON(key); if (l && l.tab === tabId) setRaw(key, null); };
      var run = function () { return Promise.resolve().then(fn).then(function (v) { release(); return v; }, function (e) { release(); throw e; }); };
      if (tryTake()) return run();
      if (ifAvail) return Promise.resolve({ skipped: true });
      return new Promise(function (res) {
        var tries = 0;
        (function again() { if (tryTake() || ++tries > 40) res(run()); else later(again, 100); })();
      });
    }

    // ---------- codecs + merge helpers ----------
    function encodeOut(key, plain) {
      if (plain == null) return Promise.resolve(null);
      var r = REG[key];
      if (r && r.codec === 'aes') return aesEncrypt(cfg.secret, cfg.familyId, key, plain);
      return Promise.resolve(plain);
    }
    function decodeIn(key, value) {
      if (value == null) return Promise.resolve(null);
      var r = REG[key];
      if (r && r.codec === 'aes') return aesDecrypt(cfg.secret, cfg.familyId, key, value);
      return Promise.resolve(String(value));
    }
    function keepLocalMerge(remote, local, fields) {
      var R = parse(remote);
      if (!R || typeof R !== 'object' || Array.isArray(R)) return remote;
      var L = parse(local);
      each(fields, function (f) { if (L && typeof L === 'object' && Object.prototype.hasOwnProperty.call(L, f)) R[f] = L[f]; else delete R[f]; });
      return JSON.stringify(R);
    }
    function stripLocal(v, r) {
      if (v == null || !r || !r.keepLocal) return v;
      var o = parse(v);
      if (!o || typeof o !== 'object' || Array.isArray(o)) return v;
      each(r.keepLocal, function (f) { delete o[f]; });
      return JSON.stringify(o);
    }
    function familyScore(vals) {
      var s = 0, w = parse(vals[K.wallet]), t = parse(vals[K.walletTime]), tk = parse(vals[K.tickets]), inv = parse(vals[K.inventory]);
      if (w && w.totals) for (var a in w.totals) { var x = w.totals[a]; if (x && typeof x.earned === 'number') s += a === 'rupees' ? x.earned : x.earned * 10; }
      if (t && t.days) for (var d in t.days) for (var b in t.days[d]) if (typeof t.days[d][b] === 'number') s += t.days[d][b] / 60000;
      if (Array.isArray(tk)) s += tk.length * 5;
      if (inv && Array.isArray(inv.owned)) s += inv.owned.length * 5;
      return s;
    }
    function score(grp, vals) {
      var g = GROUPS[grp];
      if (g && g.score) {
        try { var parsed = {}; for (var k in vals) parsed[k] = parse(vals[k]); var n = Number(g.score(parsed, vals)); if (isFinite(n)) return n; } catch (e) {}
      }
      if (grp === 'family') return familyScore(vals);
      var len = 0; for (var k2 in vals) len += String(vals[k2]).length;
      return len;
    }
    /** Decide a first-connect merge for one group. Pure: returns {use:'local'|'cloud'|'same'|'none', ...}. */
    function decideMerge(grp, keys, local, cloud) {
      var nl = 0, nc = 0, same = true;
      each(keys, function (k) { if (local[k] != null) nl++; if (cloud[k] != null) nc++; if ((local[k] == null ? null : local[k]) !== (cloud[k] == null ? null : cloud[k])) same = false; });
      if (!nl && !nc) return { use: 'none' };
      if (same) return { use: 'same' };
      if (!nc) return { use: 'local', reason: 'cloud-empty' };
      if (!nl) return { use: 'cloud', reason: 'local-empty' };
      var ls = score(grp, local), cs = score(grp, cloud);
      return ls >= cs ? { use: 'local', reason: 'more-progress', local: ls, cloud: cs } : { use: 'cloud', reason: 'more-progress', local: ls, cloud: cs };
    }

    // ---------- push / pull ----------
    function snapshot() {
      if (!cfg) return 0;
      var mine = keysOwnedBy(cfg.role === 'kid' ? 'kid' : 'grownup'), n = 0;
      for (var i = 0; i < mine.length; i++) {
        var k = mine[i], v = getRaw(k), h = hashStr(v);
        if (st.pushed[k] === undefined && v == null) continue;
        if (st.pushed[k] !== h) { if (!st.pending[k]) { st.pending[k] = now(); n++; } if (st.tooBig[k] && st.tooBig[k] !== h) delete st.tooBig[k]; }
        else if (st.pending[k]) delete st.pending[k];
      }
      return n;
    }
    function buildItems(keys, keepalive) {
      return Promise.all(keys.map(function (k) {
        if (st.tooBig[k] && st.tooBig[k] === hashStr(getRaw(k))) return null;
        var v = getRaw(k);
        return encodeOut(k, v).then(function (ev) { return { key: k, value: ev, hash: hashStr(v) }; }, function () { return null; });
      })).then(function (items) {
        var batches = [[]], size = 0, limit = keepalive ? 60000 : 400000;
        each(items, function (it) {
          if (!it) return;
          var len = (it.value == null ? 0 : it.value.length) + it.key.length + 40;
          if (it.value != null && it.value.length > MAX_VALUE) { st.tooBig[it.key] = it.hash; delete st.pending[it.key]; return; }
          if (keepalive && len > limit) return;
          if (size + len > limit && batches[batches.length - 1].length) { batches.push([]); size = 0; }
          batches[batches.length - 1].push(it); size += len;
        });
        return batches;
      });
    }
    function push(opts) {
      opts = opts || {};
      var keys = keysOf(st.pending);
      if (!keys.length && !opts.claim) return Promise.resolve(0);
      if (st.paused && !opts.claim) return Promise.resolve(0);
      return buildItems(keys, false).then(function (batches) {
        var count = 0, first = true;
        return seq(batches, function (batch) {
          if (!batch.length && !(opts.claim && first)) return;
          var payload = { items: batch.map(function (it) { return { key: it.key, value: it.value }; }) };
          if (opts.claim && first) payload.claim = true;
          first = false;
          return call('put', payload, {}).then(function (res) {
            var refused = res.refused || {};
            each(batch, function (it) {
              if (refused[it.key]) { if (refused[it.key] === 'too-large') { st.tooBig[it.key] = it.hash; delete st.pending[it.key]; } else st.lastError = 'refused:' + refused[it.key]; return; }
              st.pushed[it.key] = it.hash; count++;
              if (hashStr(getRaw(it.key)) === it.hash) delete st.pending[it.key];
            });
            if (opts.claim) st.paused = '';
          });
        }).then(function () { return count; });
      }).catch(function (e) {
        if (e && e.code === 'not-writer') { st.paused = 'not-writer'; st.lastError = 'Another laptop is now his main device.'; }
        throw e;
      });
    }
    function dashboardKeys() {
      var out = [];
      for (var k in REG) if (REG[k].owner !== 'local' && (REG[k].group.indexOf('family') === 0 || REG[k].owner === 'grownup')) out.push(k);
      return out.sort();
    }
    function pull(opts) {
      opts = opts || {};
      var q = {}, sig;
      if (cfg.role === 'kid') { q.role = 'grownup'; sig = 'kid'; } else { q.keys = dashboardKeys(); q.devices = true; sig = hashStr(q.keys.join(',')); }
      var since = st.keysSig === sig ? cfg.lastRev || 0 : 0;
      if (since) q.sinceRev = since;
      return call('get', q, { timeoutMs: opts.timeoutMs }).then(function (res) {
        if (since && typeof res.rev === 'number' && res.rev < since) { cfg.lastRev = 0; st.keysSig = ''; return pull(opts); }
        return applyItems(res.items || [], 'pull', res.devices).then(function (changed) {
          if (typeof res.rev === 'number') { cfg.lastRev = res.rev; saveConfig(); }
          st.keysSig = sig; st.lastPullAt = now();
          return changed;
        });
      });
    }
    function applySetting(it) {
      return decodeIn(it.key, it.value).then(function (plain) {
        var r = REG[it.key], local = getRaw(it.key), next = plain;
        if (plain != null && r && r.keepLocal) next = keepLocalMerge(plain, local, r.keepLocal);
        st.applied[it.key] = { rev: it.rev || 0, hash: hashStr(stripLocal(next, r)) };
        if (cfg.role === 'grownup') { st.pushed[it.key] = hashStr(next); delete st.pending[it.key]; }
        if (next === local) return false;
        setRaw(it.key, next);
        if (it.key === K.look) { var lk = parse(next); if (lk && LOOKS[lk.skin] && getRaw(K.skin) !== lk.skin) setRaw(K.skin, lk.skin); }
        return true;
      }, function () { st.lastError = 'Could not unlock ' + it.key + ' (family link changed?)'; return false; });
    }
    function applyItems(items, source, devices) {
      var changed = [], mir = cfg.role === 'grownup' ? loadMirror() : null, mirDirty = false;
      return seq(items, function (it) {
        if (!it || typeof it.key !== 'string') return;
        var o = ownerOf(it.key) || (it.role === 'grownup' ? 'grownup' : it.role === 'kid' ? 'kid' : 'local');
        if (o === 'local') return;
        if (cfg.role === 'kid') {
          if (o !== 'grownup') return; // his own data is never overwritten by a pull
          return applySetting(it).then(function (ch) { if (ch) changed.push(it.key); });
        }
        if (o === 'kid') { mir.items[it.key] = { value: it.value, rev: it.rev, updatedAt: it.updatedAt, device: it.device }; mirDirty = true; changed.push(it.key); return; }
        if (it.device === cfg.deviceId) { st.applied[it.key] = { rev: it.rev || 0, hash: hashStr(getRaw(it.key)) }; return; }
        if (st.pending[it.key]) return; // this grown-up device has a newer edit waiting to go up
        return applySetting(it).then(function (ch) { if (ch) changed.push(it.key); });
      }).then(function () {
        if (mir && (mirDirty || devices)) { if (devices) mir.devices = devices; mir.at = iso(); writeJSON(K.mirror, mir); if (devices && !mirDirty) changed.push('devices'); }
        if (changed.length) {
          dispatch(changed, source);
          if (cfg.role === 'kid' && (changed.indexOf(K.walletAdjust) >= 0 || changed.indexOf(K.ticketApprovals) >= 0 || changed.indexOf(K.rewards) >= 0)) later(function () { applyParentRequests(); }, 0);
        }
        return changed;
      });
    }
    var driftChecked = false;
    function driftRepair() {
      driftChecked = true;
      var drifted = [];
      keysOwnedBy('grownup').forEach(function (k) { var a = st.applied[k]; if (a && a.hash && hashStr(stripLocal(getRaw(k), REG[k])) !== a.hash) drifted.push(k); });
      if (!drifted.length) return Promise.resolve([]);
      return call('get', { keys: drifted }, { timeoutMs: 3000 }).then(function (res) { return applyItems(res.items || [], 'repair'); });
    }

    // ---------- parent requests (kid device applies them once, by id) ----------
    function walletApi() { return env.wallet !== undefined ? env.wallet : root.FamilyWallet || null; }
    function applyWalletSettings(FW) {
      var rw = readJSON(K.rewards);
      if (!rw || !rw.wallet || typeof rw.wallet !== 'object' || !FW || !FW.settings || !FW.setSettings) return false;
      var cur = FW.settings(), patch = {}, n = 0;
      ['mode', 'appsInSet', 'perApp', 'costs', 'minutesPerShard', 'dailyTimeCap', 'comebackDailyCap'].forEach(function (f) {
        if (rw.wallet[f] === undefined) return;
        if (JSON.stringify(rw.wallet[f]) !== JSON.stringify(cur[f])) { patch[f] = rw.wallet[f]; n++; }
      });
      if (!n) return false;
      FW.setSettings(patch);
      return true;
    }
    function applyParentRequests() {
      if (!loadConfig()) return Promise.resolve({ applied: 0 });
      var FW = walletApi();
      if (!FW) return Promise.resolve({ applied: 0, waiting: true });
      return withLock('familyApps.sync.requests', function () {
        var applied = 0;
        if (applyWalletSettings(FW)) applied++;
        if (cfg.role !== 'kid') return { applied: applied };
        var done = readJSON(K.requestsDone);
        if (!done || typeof done !== 'object' || !done.done) done = { v: 1, done: {} };
        var mark = function (id, kind, ok) { done.done[id] = { at: iso(), kind: kind, ok: ok }; done.updatedAt = iso(); writeJSON(K.requestsDone, done); };
        var adj = readJSON(K.walletAdjust), apr = readJSON(K.ticketApprovals);
        each(adj && adj.requests, function (r) {
          if (!r || typeof r.id !== 'string' || done.done[r.id]) return;
          var amount = Math.round(Number(r.amount) || 0), reason = String(r.reason || 'From a grown-up').slice(0, 80);
          mark(r.id, 'adjust', null); // first, so a crash can never apply it twice
          var ok = false;
          try { ok = r.app === 'rupees' ? FW.adjustRupees(amount, reason) : FW.adjust(r.app, amount, reason); } catch (e) {}
          done.done[r.id].ok = !!ok; writeJSON(K.requestsDone, done); applied++;
        });
        each(apr && apr.approvals, function (r) {
          if (!r || typeof r.id !== 'string' || done.done[r.id]) return;
          mark(r.id, 'approve', null);
          var ok = false;
          try { ok = FW.markUsed(String(r.ticketId)); if (!ok) ok = (FW.tickets() || []).some(function (t) { return t.id === r.ticketId && t.status === 'used'; }); } catch (e) {}
          done.done[r.id].ok = !!ok; writeJSON(K.requestsDone, done); applied++;
        });
        var ids = keysOf(done.done);
        if (ids.length > 400) { ids.sort(function (a, b) { return String(done.done[a].at).localeCompare(String(done.done[b].at)); }).slice(0, ids.length - 400).forEach(function (id) { delete done.done[id]; }); writeJSON(K.requestsDone, done); }
        if (applied) { later(function () { cycle({ force: true }); }, 50); dispatch([K.requestsDone, K.wallet, K.tickets], 'requests'); }
        return { applied: applied };
      });
    }

    // ---------- the loop ----------
    var started = false, loopTimer = null, cycling = null, lastFocus = 0, listening = false;
    function backoff(n) { return Math.min(300000, 2000 * Math.pow(2, Math.min(n, 8))) + Math.floor(Math.random() * 1000); }
    function cycle(o) {
      o = o || {};
      if (!loadConfig()) { stopLoop(); return Promise.resolve(status()); }
      if (cycling) return cycling;
      cycling = withLock('familyApps.sync', function () {
        loadState();
        snapshot();
        var t = now(), pend = keysOf(st.pending).length > 0;
        var pullDue = o.force || o.first || o.focus || (visible() && t - (st.lastPullAt || 0) >= 60000);
        var pushDue = (pend && !st.paused) || o.claim;
        if (!o.force && !o.focus && !o.online && t < (st.nextRetryAt || 0)) { saveState(); return setStatus(online() ? 'error' : 'offline'); }
        if (!pullDue && !pushDue) { saveState(); return setStatus(pend ? 'pending' : st.lastOkAt ? 'synced' : 'idle'); }
        if (!online()) { saveState(); return setStatus('offline'); }
        setStatus('syncing');
        var first = o.first && cfg.role === 'kid' && !driftChecked ? driftRepair().catch(function () {}) : Promise.resolve();
        return first.then(function () { return pushDue ? push({ claim: o.claim }) : 0; })
          .then(function () { return pullDue ? pull({ timeoutMs: o.first ? 3000 : 20000 }) : null; })
          .then(function () {
            st.failCount = 0; st.nextRetryAt = 0; st.lastOkAt = now(); if (!st.paused && st.lastError && st.lastError.indexOf('refused') < 0) st.lastError = '';
            saveState();
            return setStatus(keysOf(st.pending).length && !st.paused ? 'pending' : 'synced');
          }, function (e) {
            st.failCount = (st.failCount || 0) + 1; st.nextRetryAt = now() + backoff(st.failCount);
            st.lastError = (e && (e.code || e.message)) || 'error';
            saveState();
            return setStatus(e && (e.code === 'network' || e.code === 'timeout') ? 'offline' : 'error');
          });
      }, { ifAvailable: true }).then(function (r) {
        cycling = null;
        if (r && r.skipped) { loadState(); return setStatus(keysOf(st.pending).length ? 'pending' : st.lastOkAt ? 'synced' : 'idle'); }
        var ch = channel(); if (ch) { try { ch.postMessage({ type: 'status' }); } catch (e) {} }
        return r;
      }, function (e) { cycling = null; return setStatus('error'); });
      return cycling;
    }
    function flush() {
      // page hidden / closing: send pending changes with keepalive (fire-and-forget; next start re-checks)
      if (!loadConfig()) return;
      loadState(); snapshot(); saveState();
      if (st.paused || !authCache[cfg.secret]) return;
      var keys = keysOf(st.pending).filter(function (k) { return !REG[k] || REG[k].codec === 'raw'; });
      if (!keys.length) return;
      var items = [], size = 0;
      each(keys, function (k) { var v = getRaw(k), len = (v == null ? 0 : v.length) + k.length + 40; if (v != null && v.length > MAX_VALUE) return; if (size + len <= 60000) { items.push({ key: k, value: v }); size += len; } });
      if (!items.length) return;
      var body = bodyFor('put', { items: items }, cfg);
      body.auth = authCache[cfg.secret];
      try { var p = transport()(cfg.endpoint, body, { keepalive: true, timeoutMs: 10000 }); if (p && p.catch) p.catch(function () {}); } catch (e) {}
    }
    function attach() {
      if (listening) return;
      listening = true;
      var w = win();
      if (!w || typeof w.addEventListener !== 'function') return;
      w.addEventListener('storage', function (e) {
        if (e && e.key === K.config) { if (loadConfig()) { if (!loopTimer) startLoop(); } else stopLoop(); setStatus(); }
      });
      if (!started) return;
      var d = root.document;
      if (d && d.addEventListener) d.addEventListener('visibilitychange', function () { if (!cfg) return; if (d.visibilityState === 'hidden') flush(); else cycle({ focus: true }); });
      w.addEventListener('pagehide', function () { flush(); });
      w.addEventListener('focus', function () { if (now() - lastFocus > 5000) { lastFocus = now(); cycle({ focus: true }); } });
      w.addEventListener('online', function () { cycle({ online: true, force: true }); });
    }
    function startLoop() {
      if (loopTimer || !cfg) return;
      loadState();
      channel();
      loopTimer = setInterval(function () { cycle({}); }, 10000);
      later(function () { cycle({ first: true }).then(function () { if (cfg && cfg.role === 'kid') applyParentRequests(); }); }, startDelay);
    }
    function stopLoop() { if (loopTimer) { clearInterval(loopTimer); loopTimer = null; } }
    var startDelay = 300;
    /** Call once after the app's first render. Never blocks; does nothing (and writes nothing) when not connected. */
    function start(opts) {
      opts = opts || {};
      if (opts.app) thisApp = String(opts.app);
      if (opts.version) appVersion = String(opts.version).slice(0, 20);
      if (opts.delayMs != null) startDelay = opts.delayMs;
      if (started) return status();
      started = true;
      attach();
      if (loadConfig() && opts.loop !== false) startLoop();
      return status();
    }
    function syncNow() { return cycle({ force: true }); }

    // ---------- connect / create / pair ----------
    function newDeviceId() { return 'd-' + randomId(12); }
    function parseJoin(s) {
      var m = /(?:^|[#&?])join=([A-Za-z0-9_-]{6,128})\.([A-Za-z0-9_-]{22})(?:\.([A-Za-z0-9_-]+))?/.exec(String(s || ''));
      if (!m) return null;
      var o = { familyId: m[1], secret: m[2], endpoint: endpointFor(m[1]) };
      if (m[3]) { try { var e = new TextDecoder().decode(unb64u(m[3])); if (validEndpoint(e)) o.endpoint = e; } catch (x) {} }
      return o.endpoint ? o : null;
    }
    function joinLink(base) {
      if (!loadConfig()) return '';
      var b = String(base || 'https://sina2jp.github.io/family/').split('#')[0];
      var link = b + '#join=' + cfg.familyId + '.' + cfg.secret;
      if (endpointFor(cfg.familyId) !== cfg.endpoint) link += '.' + b64u(utf8(cfg.endpoint));
      return link;
    }
    function begin(c) {
      cfg = c; saveConfig(); st = freshState(); saveState(); driftChecked = true;
    }
    function firstConnectKid() {
      var report = { uploaded: [], downloaded: [], same: [], backups: [], settings: [] };
      var groups = {};
      keysOwnedBy('kid').forEach(function (k) { var g = REG[k].group; (groups[g] = groups[g] || []).push(k); });
      var all = [];
      for (var g in groups) all = all.concat(groups[g]);
      return call('get', { keys: all }).then(function (res) {
        var cloud = {};
        each(res.items, function (it) { if (it && it.value != null && ownerOf(it.key) === 'kid') cloud[it.key] = String(it.value); });
        var plan = [], backup = { v: 1, at: iso(), entries: [] };
        Object.keys(groups).forEach(function (grp) {
          var keys = groups[grp], L = {}, C = {};
          each(keys, function (k) { var v = getRaw(k); if (v != null) L[k] = v; if (cloud[k] != null) C[k] = cloud[k]; });
          var d = decideMerge(grp, keys, L, C);
          if (d.use === 'none') return;
          if (d.use === 'local' && keysOf(C).length) backup.entries.push({ group: grp, side: 'cloud', items: C });
          if (d.use === 'cloud' && keysOf(L).length) backup.entries.push({ group: grp, side: 'local', items: L });
          plan.push({ grp: grp, keys: keys, L: L, C: C, d: d });
        });
        if (backup.entries.length && !writeJSON(K.backup, backup)) {
          plan.forEach(function (p) { if (p.d.use === 'cloud') p.d = { use: 'local', reason: 'no-room-for-backup' }; });
        }
        plan.forEach(function (p) {
          if (p.d.use === 'same') { each(p.keys, function (k) { st.pushed[k] = hashStr(getRaw(k)); }); report.same.push(p.grp); return; }
          if (p.d.use === 'local') {
            each(p.keys, function (k) {
              if (p.L[k] != null) st.pending[k] = now();
              else if (p.C[k] != null) { setRaw(k, p.C[k]); st.pushed[k] = hashStr(p.C[k]); } // keep cloud-only keys: never lose data
            });
            report.uploaded.push(p.grp);
          } else {
            each(p.keys, function (k) {
              if (p.C[k] != null) { setRaw(k, p.C[k]); st.pushed[k] = hashStr(p.C[k]); }
              else if (p.L[k] != null) st.pending[k] = now();
            });
            report.downloaded.push(p.grp);
          }
          if (backup.entries.some(function (e) { return e.group === p.grp; })) report.backups.push(p.grp);
        });
        saveState();
        return push({ claim: true });
      }).then(function () {
        return call('get', { role: 'grownup' });
      }).then(function (res) {
        return applyItems(res.items || [], 'connect').then(function (ch) {
          report.settings = ch;
          if (typeof res.rev === 'number') { cfg.lastRev = res.rev; saveConfig(); }
          st.keysSig = 'kid'; st.lastPullAt = now(); st.lastOkAt = now(); saveState();
        });
      }).then(function () { return applyParentRequests(); }).then(function () { return report; });
    }
    /** Join this browser to the family (the join page or the Connect panel). A wrong secret is refused before anything is saved. */
    function connect(o) {
      o = o || {};
      var r = o.role === 'grownup' ? 'grownup' : 'kid';
      var familyId = String(o.familyId || ''), secret = String(o.secret || ''), endpoint = o.endpoint || endpointFor(familyId);
      if (!validFamilyId(familyId) || !validSecret(secret)) return Promise.reject(err('bad-link', 'That family link is not complete. Copy it again, all of it.'));
      if (!validEndpoint(endpoint)) return Promise.reject(err('no-endpoint', 'That link does not say where the family data lives.'));
      var old = loadConfig();
      var c = { v: 1, endpoint: endpoint, familyId: familyId, secret: secret, deviceId: (old && old.deviceId) || newDeviceId(), role: r, connectedAt: iso(), lastRev: 0 };
      return call('get', { keys: [K.pin] }, { cfg: c, timeoutMs: 20000 }).then(function () {
        begin(c);
        return r === 'kid' ? firstConnectKid() : pull().then(function (ch) { return { settings: ch }; });
      }).then(function (report) {
        setStatus('synced'); saveState();
        if (started) startLoop();
        dispatch(keysOwnedBy('grownup').concat(['familyApps.sync.v1']), 'connect');
        return report;
      });
    }
    function ping(endpoint) { return call('ping', {}, { endpoint: endpoint, cfg: null, timeoutMs: 20000 }); }
    /** Grown-up, first visit: create the family on a fresh backend. */
    function createFamily(o) {
      var endpoint = String((o && o.endpoint) || '').trim();
      if (!validEndpoint(endpoint)) return Promise.reject(err('bad-endpoint', 'Paste the web app address that ends with /exec.'));
      var familyId = familyIdFor(endpoint) || 'fam' + randomId(12);
      var c = { v: 1, endpoint: endpoint, familyId: familyId, secret: b64u(randomBytes(16)), deviceId: newDeviceId(), role: 'grownup', connectedAt: iso(), lastRev: 0 };
      return call('create', {}, { cfg: c, timeoutMs: 30000 }).then(function () {
        begin(c); setStatus('synced');
        if (started) startLoop();
        return { familyId: c.familyId };
      });
    }
    function pairCreate() {
      if (!loadConfig() || cfg.role !== 'grownup') return Promise.reject(err('not-grownup'));
      return call('pairCreate', { secret: cfg.secret });
    }
    function findEndpoint(opts) {
      if (opts && opts.endpoint) return Promise.resolve(opts.endpoint);
      var f = root.fetch, loc = root.location;
      if (!f || !loc) return Promise.resolve(null);
      return f.call(root, new URL('/family/endpoint.json', loc.href).href, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { return j && validEndpoint(j.endpoint) ? j.endpoint : null; }, function () { return null; });
    }
    function pairRedeem(code, opts) {
      code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length !== 6) return Promise.reject(err('bad-code', 'The code has 6 letters and numbers.'));
      return findEndpoint(opts).then(function (endpoint) {
        if (!endpoint) throw err('no-endpoint', 'Open the family link on this laptop instead (the code needs it).');
        return call('pairRedeem', { code: code }, { endpoint: endpoint, cfg: null }).then(function (res) {
          return connect({ familyId: res.familyId, secret: res.secret, endpoint: endpoint, role: 'kid' });
        });
      });
    }
    function disconnect() {
      stopLoop();
      [K.config, K.state, K.mirror].forEach(function (k) { setRaw(k, null); });
      cfg = null; st = null; setStatus('off');
      dispatch(['familyApps.sync.v1'], 'disconnect');
      return true;
    }

    // ---------- grown-up writes (the Hub) ----------
    function setSetting(key, value) {
      if (!loadConfig() || cfg.role !== 'grownup' || ownerOf(key) !== 'grownup') return false;
      var v = value == null ? null : typeof value === 'string' ? value : JSON.stringify(value);
      if (v != null && v.length > MAX_VALUE) return false;
      setRaw(key, v);
      if (key === K.look) { var lk = parse(v); if (lk && LOOKS[lk.skin]) setRaw(K.skin, lk.skin); }
      later(function () { cycle({ force: false }); }, 200);
      return true;
    }
    function request(kind, data) {
      if (!loadConfig() || cfg.role !== 'grownup') return null;
      var id = 'rq-' + now().toString(36) + '-' + randomId(6);
      if (kind === 'adjust') {
        var a = readJSON(K.walletAdjust) || { v: 1, requests: [] };
        if (!Array.isArray(a.requests)) a.requests = [];
        a.requests.push({ id: id, app: String(data.app), amount: Math.round(Number(data.amount) || 0), reason: String(data.reason || 'From a grown-up').slice(0, 80), at: iso() });
        a.requests = a.requests.slice(-100); a.updatedAt = iso();
        return setSetting(K.walletAdjust, a) ? id : null;
      }
      if (kind === 'approve') {
        var b = readJSON(K.ticketApprovals) || { v: 1, approvals: [] };
        if (!Array.isArray(b.approvals)) b.approvals = [];
        if (b.approvals.some(function (x) { return x.ticketId === data.ticketId; })) return 'dup';
        b.approvals.push({ id: id, ticketId: String(data.ticketId), at: iso() });
        b.approvals = b.approvals.slice(-200); b.updatedAt = iso();
        return setSetting(K.ticketApprovals, b) ? id : null;
      }
      return null;
    }
    function setPin(pin) { return makePinRecord(pin).then(function (rec) { return setSetting(K.pin, rec) ? rec : Promise.reject(err('not-grownup')); }); }
    function mirror() {
      var m = loadMirror(), out = { at: m.at, devices: m.devices || [], items: {} };
      for (var k in m.items) { var it = m.items[k]; out.items[k] = { raw: it.value, value: parse(it.value), rev: it.rev, updatedAt: it.updatedAt, device: it.device }; }
      return out;
    }
    function look() { var l = readJSON(K.look); return l && LOOKS[l.skin] ? l.skin : null; }

    // ---------- app helpers ----------
    function weekOf(t) { var d = new Date(t); var s = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()); return s.getFullYear() + '-' + ('0' + (s.getMonth() + 1)).slice(-2) + '-' + ('0' + s.getDate()).slice(-2); }
    function cleanObj(o, depth) {
      var out = {}, n = 0;
      for (var k in o || {}) {
        if (n >= 40 || !/^[A-Za-z][A-Za-z0-9_]{0,30}$/.test(k)) continue;
        var v = o[k];
        if (typeof v === 'number' && isFinite(v)) out[k] = Math.round(v * 100) / 100;
        else if (typeof v === 'boolean') out[k] = v;
        else if (typeof v === 'string') out[k] = v.replace(/[<>]/g, '').slice(0, 80);
        else if (v && typeof v === 'object' && !Array.isArray(v) && depth < 2) out[k] = cleanObj(v, depth + 1);
        else continue;
        n++;
      }
      return out;
    }
    /** Kid device only: a small weekly summary for the grown-up's dashboard. Writes nothing when not connected. */
    function writeSummary(app, obj) {
      if (!loadConfig() || cfg.role !== 'kid' || !/^[a-z][a-z0-9-]{1,20}$/.test(String(app)) || !obj || typeof obj !== 'object') return false;
      var key = summaryKey(app);
      if (!REG[key]) rule(key, 'kid', 'family:summary');
      var t = now(), la = obj.lastActive != null ? Date.parse(obj.lastActive) || Number(obj.lastActive) : t;
      var out = { v: 1, app: String(app), weekOf: weekOf(t), lastActive: iso(isFinite(la) && la > 0 ? la : t), week: cleanObj(obj.week || {}, 1), total: cleanObj(obj.total || {}, 1) };
      var prev = readJSON(key);
      if (prev) { var a = JSON.stringify(prev.week) + JSON.stringify(prev.total) + prev.weekOf, b = JSON.stringify(out.week) + JSON.stringify(out.total) + out.weekOf; if (a === b && t - Date.parse(prev.lastActive || 0) < 300000) return true; }
      out.updatedAt = iso(t);
      var s = JSON.stringify(out);
      return s.length <= 8000 ? setRaw(key, s) : false;
    }
    function el(tag, css, text) { var e = root.document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; }
    /** The tiny "☁ synced" dot for a Parent corner. Shows nothing when not connected. */
    function mountStatus(host, opts) {
      if (!host || !root.document) return { update: function () {}, destroy: function () {} };
      var dot = el('span', 'display:inline-flex;align-items:center;gap:4px;font:12px/1.2 system-ui,sans-serif;opacity:.85;white-space:nowrap');
      dot.className = 'fs-status';
      host.appendChild(dot);
      var color = { synced: '#2e7d32', pending: '#8a6d00', syncing: '#8a6d00', offline: '#6b6b6b', error: '#b3261e', paused: '#b3261e', idle: '#2e7d32' };
      function update() {
        var s = status();
        dot.style.display = s.connected ? 'inline-flex' : 'none';
        dot.textContent = s.text + (s.role === 'grownup' && opts && opts.showRole ? ' · grown-up' : '');
        dot.style.color = color[s.state] || 'inherit';
        dot.title = s.connected ? 'Family sync: ' + s.state + (s.lastSyncAt ? ' · last ' + new Date(s.lastSyncAt).toLocaleString() : '') + (s.lastError ? ' · ' + s.lastError : '') : '';
        dot.setAttribute('data-state', s.state);
      }
      update();
      var off = onStatus(update), iv = setInterval(update, 15000);
      return { update: update, destroy: function () { off(); clearInterval(iv); if (dot.parentNode) dot.parentNode.removeChild(dot); } };
    }
    /** Fallback Connect panel: type the 6-character code from the Family Hub. */
    function mountConnect(host, opts) {
      opts = opts || {};
      if (!host || !root.document) return { destroy: function () {} };
      var box = el('div', 'font:15px/1.4 system-ui,sans-serif;padding:12px;border:1px solid rgba(0,0,0,.15);border-radius:12px;max-width:420px');
      box.className = 'fs-connect';
      host.appendChild(box);
      function draw() {
        box.innerHTML = '';
        if (isConnected()) {
          box.appendChild(el('b', '', role() === 'kid' ? 'This laptop is connected to the family ✓' : 'This is a grown-up device (Family Hub) ✓'));
          box.appendChild(el('p', 'margin:6px 0 0;opacity:.8', 'Settings come from the Family Hub. ' + status().text));
          return;
        }
        box.appendChild(el('b', '', 'Connect this laptop to the family'));
        box.appendChild(el('p', 'margin:6px 0', 'Type the 6-character code shown in the grown-up\'s Family Hub.'));
        var row = el('div', 'display:flex;gap:8px');
        var inp = el('input', 'flex:1;font:600 20px/1 ui-monospace,monospace;letter-spacing:4px;text-transform:uppercase;padding:8px;border-radius:8px;border:1px solid rgba(0,0,0,.3)');
        inp.maxLength = 7; inp.autocomplete = 'off'; inp.setAttribute('aria-label', '6-character code'); inp.setAttribute('autocapitalize', 'characters');
        var btn = el('button', 'font:600 16px system-ui;padding:8px 14px;border-radius:8px;cursor:pointer', 'Connect');
        var msg = el('p', 'margin:6px 0 0;min-height:1.2em');
        btn.onclick = function () {
          btn.disabled = true; msg.textContent = 'Connecting…';
          pairRedeem(inp.value, opts).then(function () { msg.textContent = 'Connected ✓'; later(draw, 600); if (opts.onConnected) opts.onConnected(); }, function (e) { btn.disabled = false; msg.textContent = (e && e.code === 'bad-code') || (e && e.code === 'not-found') ? 'That code did not work. Check it, or ask for a new one.' : (e && e.message) || 'That did not work.'; });
        };
        row.appendChild(inp); row.appendChild(btn); box.appendChild(row); box.appendChild(msg);
      }
      draw();
      var off = onStatus(draw);
      return { update: draw, destroy: function () { off(); if (box.parentNode) box.parentNode.removeChild(box); } };
    }
    /** On a grown-up device the kid apps show this small banner. Shows nothing on his laptop or when not connected. */
    function mountPracticeBanner(host) {
      if (!host || !root.document || role() !== 'grownup') return { destroy: function () {} };
      var b = el('div', 'font:13px/1.3 system-ui,sans-serif;padding:4px 10px;border-radius:999px;background:rgba(255,240,200,.95);color:#4a3b00;display:inline-block', 'Your laptop: practice copy · his progress is not changed here');
      b.className = 'fs-practice';
      host.appendChild(b);
      return { destroy: function () { if (b.parentNode) b.parentNode.removeChild(b); } };
    }

    var FS = {
      VERSION: VERSION, KEYS: K, APPS: APPS.slice(), summaryKey: summaryKey,
      configure: function (o) {
        o = o || {};
        ['storage', 'transport', 'now', 'locks', 'wallet', 'win', 'crypto', 'channel', 'online', 'visible'].forEach(function (k) { if (k in o) env[k === 'win' ? 'win' : k] = o[k]; });
        if (o.resetCache) { keyCache = {}; authCache = {}; }
        cfg = null; st = null;
        return FS;
      },
      register: register, start: start, stop: function () { stopLoop(); started = false; },
      isConnected: isConnected, role: role, status: status, onStatus: onStatus, onUpdate: onUpdate,
      pinIsSet: pinIsSet, checkPin: checkPin, makePinRecord: makePinRecord, setPin: setPin,
      writeSummary: writeSummary, applyParentRequests: applyParentRequests, syncNow: syncNow, flush: flush, look: look,
      mountStatus: mountStatus, mountConnect: mountConnect, mountPracticeBanner: mountPracticeBanner,
      connect: connect, createFamily: createFamily, ping: ping, pairCreate: pairCreate, pairRedeem: pairRedeem, disconnect: disconnect,
      parseJoin: parseJoin, joinLink: joinLink, endpointFor: endpointFor, familyIdFor: familyIdFor,
      setSetting: setSetting, request: request, mirror: mirror, dashboardKeys: dashboardKeys,
      config: function () { if (!loadConfig()) return null; var c = {}; for (var k in cfg) if (k !== 'secret') c[k] = cfg[k]; return c; },
      rules: function () { var o = {}; for (var k in REG) o[k] = { owner: REG[k].owner, group: REG[k].group, codec: REG[k].codec, keepLocal: REG[k].keepLocal }; return o; },
      _t: { hashStr: hashStr, keepLocalMerge: keepLocalMerge, stripLocal: stripLocal, decideMerge: decideMerge, score: score, familyKeys: familyKeys, aesEncrypt: aesEncrypt, aesDecrypt: aesDecrypt, pinHash: pinHash, b64u: b64u, unb64u: unb64u, weekOf: weekOf, call: call, cycle: cycle },
      __new: function () { return make(); },
    };
    return FS;
  }
  return make();
});
