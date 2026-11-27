/*!
 * family-wallet.js 1.2 — the Family Wallet shared by Math Arena, Language Quest, Code Quest and Music Quest.
 * Copy this file unchanged into every app (same origin, same localStorage). No dependencies, no framework, no network.
 *
 * 1.2 ANTI-FARMING ("rewards only for new learning"; settings.noRepeats, on by default)
 *   earnOnce(app, onceId, shards, label) -> { paid, banked, reason: 'repeat' | 'cap' | 'guessing' | null }
 *     pays the first time (app, onceId) is ever earned (event id "once:<app>:<onceId>", plus wallet.once), at most
 *     settings.onceDailyCap (6) such shards per app per day; more is BANKED (wallet.bank) and released on later days.
 *   rupeesOnce(app, itemId, rupees, label) -> rupees paid: only the first correct answer on itemId within 30 days
 *     (wallet.seenRupee, at most 5,000 ids per app). Repeats pay 0 (counted in wallet.daily, not in the ledger).
 *   tickActive(app, ms, { repeat: true }) / startTracker(app, { isRepeat }): review minutes count, earn no shards.
 *   releaseBanked(app), policy(), daily(). The 1.1 calls (finishUnit, beatBoss, answer, earn, ...) are unchanged.
 *
 * LOAD IT
 *   <script src="family-wallet.js"></script>            -> window.FamilyWallet
 *   import './family-wallet.js'; const FW = globalThis.FamilyWallet;   (any bundler / ES module app)
 *   const FW = require('./family-wallet.js');            (Node tests)
 *
 * WHAT IT OWNS
 *   Shards: each app earns its own shard (math Wisdom, language Courage, code Power, music Song). A reward costs one full
 *   set: in 'balanced' mode perApp[app] shards (default 3) from EACH app in settings.appsInSet; in 'any' mode
 *   3 x (apps in the set) shards from any of them. Claiming spends the shards and adds a ticket to familyApps.tickets.v1;
 *   a grown-up approves it with the PIN (the host app checks the PIN).
 *   Rupees: one shared balance. Lifetime earned never goes down (ranks use it); spending only raises "spent".
 *   The Hyrule Market (one shared, cosmetic-only catalog), the inventory, the goal, and the UI (mountable vanilla parts).
 *
 * EARNING (defaults; the parent can change most of them)
 *   time      1 shard per 10 active minutes in that app, at most 6 a day per app. Active = page visible, an
 *             interaction in the last 60 s, and a learning screen (the host says which screens; see startTracker).
 *   progress  finishUnit(app): +2 shards, +10 rupees. beatBoss(app): +3 shards, +25 rupees.
 *   effort    comeback(app): +1 (solved after a miss, or finished after Help), at most 3 a day per app;
 *             +1 at every 3-day streak in an app (automatic).
 *   secret    secret(app): +1 per Gold Skulltula.
 *   rupees    answer(app, correct, lessonId): +1 per correct answer, at most 20 per lesson; +50 "Triforce Day" once a
 *             day when he earned shards in every app in the set that day (automatic).
 *   Anti-gaming: nothing counts while idle or hidden; 3+ wrong answers within 5 s (rapid guessing) pause shards and
 *   rupees for 60 s.
 *
 * STORAGE (localStorage, read-modify-write on every change; nothing is written at load)
 *   familyApps.wallet.v1    { version:1, settings:{ mode, appsInSet, perApp, anyCost, minutesPerShard, dailyTimeCap,
 *                             comebackDailyCap, costs:{ rewardId: sets }, points, rupees, ... },
 *                             totals:{ math:{earned,spent}, language:{…}, code:{…}, music:{…}, rupees:{earned,spent} },
 *                             events:[{ id, app, kind, amount, reason, at, tag?, ref? }] (newest 1000),
 *                             migrated:{ app: { rupees, tokens, owned } }, updatedAt }
 *                           kinds: time | progress | effort | secret | spend | adjust | rupee | buy. Balance = earned - spent;
 *                           the totals stay exact after old events are trimmed. Defaults are written on the first real write.
 *   familyApps.inventory.v1 { owned:[ids], equipped:{ background, buddy, naviColor, music, title, <app slots> }, goal, updatedAt }
 *   familyApps.rewards.v1   { version:1, enabled, tokensPerTicket, weeklyCap, rewards:[{ id, emoji, text }], updatedAt } (shape kept)
 *   familyApps.tickets.v1   [{ id, app, rewardId, rewardText, emoji, earnedAt, status:'earned'|'used', usedAt, cost? }] (newest 200)
 *   familyApps.walletTime.v1 { days:{ 'YYYY-MM-DD': { math: activeMs, …, done:{ app: 1 } } } } (last 70 days)
 *   The weekly ticket cap (rewards.weeklyCap) counts every app's tickets in the local Sun–Sat week.
 *
 * MAIN CALLS (all synchronous)
 *   balance() settings() setSettings(patch) appsInSet() isNew(app)
 *   earn(app, kind, n, reason, {tag}) finishUnit(app, reason) beatBoss(app, reason) comeback(app) secret(app)
 *   answer(app, correct, lessonId) tickActive(app, ms) startTracker(app, { isLearning }) -> { stop() }
 *   rewards() saveRewards({ enabled, weeklyCap, list }) canClaim(rewardId) claim(rewardId, app) tickets() markUsed(id)
 *   today() events({ app, limit }) weeklyReport(offset) lowest(skin) adjust(app, n, reason) adjustRupees(n, reason)
 *   migrateApp(app, { rupees, tokens, owned }) (once per app)
 *   catalog(app) registerItems(items) buy(id) equip(slot, id) setGoal(id) inventory() owns(id) affordable(app)
 *   goalProgress() weeklyItem() names(skin) itemName(item, skin) onChange(cb) registerApp(id, info)
 *   UI: mountWallet(el, opts) mountMarket(el, opts) mountParent(el, opts) mountGoal(el, opts) mountCounter(el, opts)
 *       applyEquipped(handlers)
 */

(function (root, factory) {
  var FW = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = FW;
  if (root) root.FamilyWallet = FW;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  // ===================================================================================================================
  // CORE: storage, the shared ledger (shards + rupees), earning rules, rewards, tickets, the market and the inventory.
  // ===================================================================================================================
  var VERSION = 1; // the data version of familyApps.wallet.v1
  var MODULE_VERSION = '1.2.0';
  var KEYS = {
    wallet: 'familyApps.wallet.v1',
    inventory: 'familyApps.inventory.v1',
    rewards: 'familyApps.rewards.v1',
    tickets: 'familyApps.tickets.v1',
    time: 'familyApps.walletTime.v1', // active minutes per app per local day (small; written while he learns)
  };
  // The apps registry (generic over N apps). piece: 'triangle' (a Triforce piece) or 'note' (the Ocarina note).
  var APP_INFO = {
    math: { name: 'Math Arena', shard: 'Wisdom', color: '#d9a520', path: '../math-arena/', piece: 'triangle' },
    language: { name: 'Language Quest', shard: 'Courage', color: '#3fa34d', path: '../language-quest/', piece: 'triangle' },
    code: { name: 'Code Quest', shard: 'Power', color: '#d9534f', path: '../code-quest/', piece: 'triangle' },
    music: { name: 'Music Quest', shard: 'Song', color: '#3b7dd8', path: '../music-quest/', piece: 'note' },
  };
  var APPS = Object.keys(APP_INFO);
  var ANY_PER_APP = 3; // any mode: a full set costs 3 shards per app in the set
  /** Add another app to the registry (a future app); ids are short lowercase words. */
  function registerApp(id, info) {
    info = info || {};
    if (!/^[a-z][a-z0-9-]{1,20}$/.test(String(id)) || APP_INFO[id] || id === 'rupees' || id === 'family') return false;
    APP_INFO[id] = { name: String(info.name || id), shard: String(info.shard || 'Shard'), color: info.color || '#888888', path: info.path || '../' + id + '/', piece: info.piece === 'note' ? 'note' : 'triangle' };
    APPS.push(id);
    return true;
  }
  var MAX_EVENTS = 1000;
  var MAX_TICKETS = 200;
  var MAX_REWARDS = 8;
  var SHARD_KINDS = { time: 1, progress: 1, effort: 1, secret: 1 };
  var DEFAULT_SETTINGS = {
    mode: 'balanced', // 'balanced': perApp shards from EACH app in the set make one full set; 'any': anyCost shards from any of them
    appsInSet: ['math', 'language', 'code', 'music'],
    perApp: { math: 3, language: 3, code: 3, music: 3 },
    anyCost: 12, // always 3 x the number of apps in the set (derived)
    minutesPerShard: 10,
    dailyTimeCap: 6,
    comebackDailyCap: 3,
    costs: {}, // rewardId -> Triforces (default 1)
    points: { unit: 2, boss: 3, comeback: 1, streak: 1, secret: 1 },
    rupees: { correct: 1, lessonCap: 20, unit: 10, boss: 25, triforceDay: 50 },
    guessWindowMs: 5000, // 3+ wrong answers inside this window = rapid guessing
    guessCooldownMs: 60000, // ... then no shards or rupees for this long
    idleMs: 60000, // the tracker counts time only with an interaction in the last minute
    noRepeats: true, // 1.2: earnOnce / rupeesOnce / repeat minutes pay only for new learning
    onceDailyCap: 6, // 1.2: at most this many earnOnce shards per app per day; more is banked for later days
  };
  var DEFAULT_REWARDS = [
    { id: 'youtube', emoji: '📺', text: '15 minutes of YouTube' },
    { id: 'switch', emoji: '🎮', text: '20 minutes of Nintendo Switch' },
    { id: 'pet', emoji: '🐾', text: 'Play time with our pet' },
    { id: 'treat', emoji: '🍦', text: 'Pick a special treat' },
    { id: 'game', emoji: '🎲', text: 'Family game pick' },
  ];

  // ---------- environment (tests and hosts can swap storage and the clock) ----------
  var env = { storage: null, now: null, app: null };
  var memData = {};
  var memStore = {
    getItem: function (k) {
      return Object.prototype.hasOwnProperty.call(memData, k) ? memData[k] : null;
    },
    setItem: function (k, v) {
      memData[k] = String(v);
    },
    removeItem: function (k) {
      delete memData[k];
    },
  };
  function store() {
    if (env.storage) return env.storage;
    try {
      var s = root && root.localStorage;
      if (s) {
        s.getItem(KEYS.wallet); // throws in sandboxed frames (no write: loading never writes)
        return s;
      }
    } catch (e) {}
    return memStore;
  }
  function now() {
    return env.now ? env.now() : Date.now();
  }
  function iso(t) {
    return new Date(t).toISOString();
  }
  function timeOf(t) {
    return (typeof t === 'number' ? t : Date.parse(t || '')) || 0;
  }
  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }
  function dayKey(t) {
    var d = new Date(t);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function weekStart(t) {
    var d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()).getTime();
  }
  function addDays(t, n) {
    var d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
  }
  function readJSON(key) {
    try {
      var raw = store().getItem(key);
      return raw == null ? null : JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }
  function writeJSON(key, value) {
    try {
      store().setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }
  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }
  function clampInt(v, lo, hi, d) {
    var n = Math.round(Number(v));
    return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
  }
  function isApp(a) {
    return APPS.indexOf(a) >= 0;
  }
  function uid(prefix) {
    return prefix + '-' + now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  // ---------- change listeners (this tab and other tabs) ----------
  var listeners = [];
  var storageHooked = false;
  function emit(what) {
    for (var i = 0; i < listeners.length; i++) {
      try {
        listeners[i](what);
      } catch (e) {}
    }
  }
  function onChange(cb) {
    listeners.push(cb);
    if (!storageHooked && root && typeof root.addEventListener === 'function') {
      storageHooked = true;
      root.addEventListener('storage', function (e) {
        if (!e || e.key == null) return emit('all');
        for (var k in KEYS) if (KEYS[k] === e.key) return emit(k);
        return undefined;
      });
    }
    return function () {
      listeners = listeners.filter(function (f) {
        return f !== cb;
      });
    };
  }

  // ---------- settings ----------
  function normSettings(s) {
    s = s && typeof s === 'object' ? s : {};
    var d = DEFAULT_SETTINGS;
    var out = {};
    for (var k in s) out[k] = s[k]; // keep fields another app may add
    out.mode = s.mode === 'any' ? 'any' : 'balanced';
    var set = Array.isArray(s.appsInSet) ? s.appsInSet.filter(function (a, i, arr) { return isApp(a) && arr.indexOf(a) === i; }) : d.appsInSet.slice();
    out.appsInSet = set.length ? set : d.appsInSet.slice();
    out.perApp = {};
    for (var i = 0; i < APPS.length; i++) out.perApp[APPS[i]] = clampInt(s.perApp && s.perApp[APPS[i]], 0, 10, d.perApp[APPS[i]] == null ? 3 : d.perApp[APPS[i]]);
    out.anyCost = ANY_PER_APP * out.appsInSet.length;
    out.minutesPerShard = clampInt(s.minutesPerShard, 1, 60, d.minutesPerShard);
    out.dailyTimeCap = clampInt(s.dailyTimeCap, 0, 24, d.dailyTimeCap);
    out.comebackDailyCap = clampInt(s.comebackDailyCap, 0, 10, d.comebackDailyCap);
    out.costs = {};
    if (s.costs && typeof s.costs === 'object') for (var r in s.costs) out.costs[r] = clampInt(s.costs[r], 1, 5, 1);
    out.points = {};
    for (var p in d.points) out.points[p] = clampInt(s.points && s.points[p], 0, 10, d.points[p]);
    out.rupees = {};
    for (var q in d.rupees) out.rupees[q] = clampInt(s.rupees && s.rupees[q], 0, 1000, d.rupees[q]);
    out.guessWindowMs = clampInt(s.guessWindowMs, 1000, 60000, d.guessWindowMs);
    out.guessCooldownMs = clampInt(s.guessCooldownMs, 0, 600000, d.guessCooldownMs);
    out.idleMs = clampInt(s.idleMs, 10000, 600000, d.idleMs);
    out.noRepeats = s.noRepeats !== false;
    out.onceDailyCap = clampInt(s.onceDailyCap, 0, 50, d.onceDailyCap);
    return out;
  }

  // ---------- the wallet (familyApps.wallet.v1) ----------
  function freshTotals() {
    var t = {};
    for (var i = 0; i < APPS.length; i++) t[APPS[i]] = { earned: 0, spent: 0 };
    t.rupees = { earned: 0, spent: 0 };
    return t;
  }
  function normWallet(v) {
    v = v && typeof v === 'object' ? v : {};
    var w = {};
    for (var k in v) w[k] = v[k];
    w.version = VERSION;
    w.settings = normSettings(v.settings);
    var t = freshTotals();
    var src = v.totals && typeof v.totals === 'object' ? v.totals : {};
    for (var sk in src) if (src[sk] && typeof src[sk] === 'object' && !(sk in t)) t[sk] = {}; // an app this copy does not know yet
    for (var key in t) {
      var x = src[key] || {};
      t[key] = { earned: Math.max(0, Number(x.earned) || 0), spent: Math.max(0, Number(x.spent) || 0) };
    }
    w.totals = t;
    w.events = Array.isArray(v.events) ? v.events.filter(function (e) { return e && typeof e === 'object'; }) : [];
    w.migrated = v.migrated && typeof v.migrated === 'object' ? v.migrated : {};
    w.updatedAt = v.updatedAt || null;
    return w;
  }
  /** The wallet as stored (defaults filled in memory). Never writes. */
  function load() {
    return normWallet(readJSON(KEYS.wallet));
  }
  /** Read-modify-write. mutate(w) changes w in place and returns a result; returning false writes nothing. */
  function updateWallet(mutate) {
    var w = load();
    var res = mutate(w);
    if (res === false) return false;
    if (w.events.length > MAX_EVENTS) w.events = w.events.slice(w.events.length - MAX_EVENTS);
    w.updatedAt = iso(now());
    if (!writeJSON(KEYS.wallet, w)) return false;
    emit('wallet');
    return res === undefined ? true : res;
  }
  /** Append one event and apply it to the totals (the totals stay exact after old events are trimmed). */
  function addEvent(w, app, kind, amount, reason, tag, ref) {
    amount = Math.round(Number(amount) || 0);
    var ev = { id: uid(app || 'fw'), app: app, kind: kind, amount: amount, reason: String(reason || '').slice(0, 120), at: iso(now()) };
    if (tag) ev.tag = tag;
    if (ref != null) ev.ref = String(ref).slice(0, 80);
    applyTotals(w, ev, amount);
    w.events.push(ev);
    return ev;
  }
  function applyTotals(w, ev, amount) {
    if (ev.kind === 'rupee' || ev.kind === 'buy') {
      if (amount >= 0) w.totals.rupees.earned += amount;
      else w.totals.rupees.spent += -amount;
    } else if (isApp(ev.app)) {
      if (amount >= 0) w.totals[ev.app].earned += amount;
      else w.totals[ev.app].spent += -amount;
    }
  }
  function balanceOf(w) {
    var b = {};
    for (var i = 0; i < APPS.length; i++) {
      var t = w.totals[APPS[i]];
      b[APPS[i]] = Math.max(0, t.earned - t.spent);
    }
    b.rupees = Math.max(0, w.totals.rupees.earned - w.totals.rupees.spent);
    b.rupeesEarned = w.totals.rupees.earned; // lifetime: ranks use this, so spending never lowers a rank
    b.triforces = triforcesIn(b, w.settings);
    return b;
  }
  function setTotal(b, s) {
    var n = 0;
    for (var i = 0; i < s.appsInSet.length; i++) n += b[s.appsInSet[i]] || 0;
    return n;
  }
  function triforcesIn(b, s) {
    if (s.mode === 'any') return Math.floor(setTotal(b, s) / s.anyCost);
    var n = Infinity;
    for (var i = 0; i < s.appsInSet.length; i++) {
      var per = s.perApp[s.appsInSet[i]];
      if (per > 0) n = Math.min(n, Math.floor((b[s.appsInSet[i]] || 0) / per));
    }
    return n === Infinity ? 0 : n;
  }
  function balance() {
    return balanceOf(load());
  }
  function settings() {
    return load().settings;
  }
  function setSettings(patch) {
    return updateWallet(function (w) {
      var merged = {};
      for (var k in w.settings) merged[k] = w.settings[k];
      for (var p in patch || {}) merged[p] = patch[p];
      if (patch && patch.perApp) merged.perApp = Object.assign({}, w.settings.perApp, patch.perApp);
      if (patch && patch.appsInSet) merged.appsInSet = patch.appsInSet.slice();
      if (patch && patch.points) merged.points = Object.assign({}, w.settings.points, patch.points);
      if (patch && patch.rupees) merged.rupees = Object.assign({}, w.settings.rupees, patch.rupees);
      w.settings = normSettings(merged);
      return true;
    });
  }

  // ---------- today / week helpers over the ledger ----------
  function eventsOn(w, app, day, pred) {
    var out = 0;
    for (var i = w.events.length - 1; i >= 0; i--) {
      var e = w.events[i];
      if (dayKey(timeOf(e.at)) !== day) {
        if (timeOf(e.at) < addDays(new Date(day.replace(/-/g, '/')).getTime(), -1)) break; // events are in time order
        continue;
      }
      if ((app == null || e.app === app) && pred(e)) out += e.amount;
    }
    return out;
  }
  function shardsToday(w, app, day) {
    return eventsOn(w, app, day, function (e) {
      return SHARD_KINDS[e.kind] && e.amount > 0;
    });
  }

  // ---------- anti-guessing (in memory, per page) ----------
  var wrongs = {};
  var guessUntil = {};
  function guessing(app) {
    return (guessUntil[app] || 0) > now();
  }

  // ---------- active time (familyApps.walletTime.v1 = { days: { 'YYYY-MM-DD': { math: ms, …, done: { math: 1 } } } }) ----------
  function readTime() {
    var v = readJSON(KEYS.time);
    return v && typeof v === 'object' && v.days && typeof v.days === 'object' ? v : { days: {} };
  }
  function writeTime(t) {
    var keys = Object.keys(t.days).sort();
    while (keys.length > 70) delete t.days[keys.shift()];
    writeJSON(KEYS.time, t);
    emit('time');
  }
  function todayMinutes(app, t) {
    var d = (t || readTime()).days[dayKey(now())] || {};
    return Math.floor((d[app] || 0) / 60000);
  }
  function markDay(app) {
    var t = readTime();
    var day = dayKey(now());
    var d = (t.days[day] = t.days[day] || {});
    d.done = d.done || {};
    if (!d.done[app]) {
      d.done[app] = 1;
      writeTime(t);
    }
  }
  function activeOn(t, app, day) {
    var d = t.days[day];
    return !!d && ((d[app] || 0) >= 60000 || !!(d.done && d.done[app]));
  }
  function streakOf(app) {
    var t = readTime();
    var n = 0;
    var day = now();
    while (activeOn(t, app, dayKey(day)) && n < 400) {
      n++;
      day = addDays(day, -1);
    }
    return n;
  }

  // ---------- earning ----------
  /**
   * Earn shards for one app. kind: 'time' | 'progress' | 'effort' | 'secret'. Caps: time shards per day, comebacks per day
   * (opts.tag 'comeback'); no time/progress/effort shards while rapid guessing. Returns { granted, why }.
   */
  function earn(app, kind, amount, reason, opts) {
    opts = opts || {};
    if (!isApp(app) || !SHARD_KINDS[kind]) return { granted: 0, why: 'invalid' };
    amount = Math.round(Number(amount) || 0);
    if (amount <= 0) return { granted: 0, why: 'invalid' };
    if (kind !== 'secret' && guessing(app)) return { granted: 0, why: 'guessing' };
    var granted = updateWallet(function (w) {
      var s = w.settings;
      var day = dayKey(now());
      var allow = amount;
      if (kind === 'time') {
        var had = eventsOn(w, app, day, function (e) { return e.kind === 'time'; });
        allow = Math.min(amount, Math.max(0, s.dailyTimeCap - had));
      } else if (opts.tag === 'comeback') {
        var cb = eventsOn(w, app, day, function (e) { return e.tag === 'comeback'; });
        allow = Math.min(amount, Math.max(0, s.comebackDailyCap - cb));
      }
      if (allow <= 0) return false;
      addEvent(w, app, kind, allow, reason, opts.tag, opts.ref);
      triforceDayCheck(w, app, day);
      return allow;
    });
    if (!granted) return { granted: 0, why: 'cap' };
    if (kind !== 'time') markDay(app);
    streakCheck(app);
    return { granted: granted, why: 'ok' };
  }
  /** +50 rupees once a day when he earned shards in every app in the set today. */
  function triforceDayCheck(w, app, day) {
    var set = w.settings.appsInSet;
    for (var i = 0; i < set.length; i++) if (shardsToday(w, set[i], day) <= 0) return;
    if (eventsOn(w, null, day, function (e) { return e.tag === 'triforceDay'; }) > 0) return;
    if (w.settings.rupees.triforceDay > 0) addEvent(w, app, 'rupee', w.settings.rupees.triforceDay, 'Triforce Day: shards in every app today', 'triforceDay');
  }
  /** +1 effort shard at every 3-day streak milestone in an app (once a day). */
  function streakCheck(app) {
    var n = streakOf(app);
    if (n < 3 || n % 3 !== 0) return;
    var w = load();
    var day = dayKey(now());
    if (eventsOn(w, app, day, function (e) { return e.tag === 'streak'; }) > 0) return;
    var pts = w.settings.points.streak;
    if (pts > 0) {
      updateWallet(function (x) {
        if (eventsOn(x, app, day, function (e) { return e.tag === 'streak'; }) > 0) return false;
        addEvent(x, app, 'effort', pts, n + '-day streak', 'streak');
        triforceDayCheck(x, app, day);
        return true;
      });
    }
  }
  /** Shared rupees (kind 'rupee'), from any app's earning moments. */
  function earnRupees(app, amount, reason, opts) {
    opts = opts || {};
    amount = Math.round(Number(amount) || 0);
    if (!isApp(app) || amount <= 0) return 0;
    if (!opts.always && guessing(app)) return 0;
    return updateWallet(function (w) {
      addEvent(w, app, 'rupee', amount, reason, opts.tag, opts.ref);
      return amount;
    }) || 0;
  }
  // ---------- 1.2: rewards only for new learning ----------
  function dayNum(t) { return Math.floor((t - new Date(t).getTimezoneOffset() * 60000) / 86400000); }
  function bumpDaily(w, day, app, field, n) {
    var dl = (w.daily = w.daily && typeof w.daily === 'object' ? w.daily : {});
    var d = (dl[day] = dl[day] || {});
    var a = (d[app] = d[app] || {});
    a[field] = (a[field] || 0) + n;
    var ks = Object.keys(dl).sort();
    while (ks.length > 70) delete dl[ks.shift()];
  }
  function onceToday(w, app, day) {
    return eventsOn(w, app, day, function (e) { return e.tag === 'once' || e.tag === 'onceBank'; });
  }
  function hasDueBank(w, app, day) {
    var b = Array.isArray(w.bank) ? w.bank : [];
    for (var i = 0; i < b.length; i++) if (b[i] && b[i].app === app && (b[i].total || 0) > (b[i].released || 0) && dayKey(timeOf(b[i].at)) < day) return true;
    return false;
  }
  /** Release shards banked on earlier days, oldest first, within today's cap. Each release has a fixed id. */
  function releaseBankIn(w, app) {
    var bank = Array.isArray(w.bank) ? w.bank : [];
    if (!bank.length) return 0;
    var day = dayKey(now());
    var room = Math.max(0, w.settings.onceDailyCap - onceToday(w, app, day));
    var got = 0;
    for (var i = 0; i < bank.length && room > 0; i++) {
      var b = bank[i];
      if (!b || b.app !== app || dayKey(timeOf(b.at)) >= day) continue;
      var left = (b.total || 0) - (b.released || 0);
      if (left <= 0) continue;
      var n = Math.min(left, room);
      b.released = (b.released || 0) + n;
      var ev = addEvent(w, app, 'progress', n, String(b.label || 'Lesson') + ' (banked shards released)', 'onceBank', b.bid);
      ev.id = b.bid + ':r' + b.released;
      ev.total = b.total;
      room -= n;
      got += n;
    }
    w.bank = bank.filter(function (x) { return x && (x.total || 0) - (x.released || 0) > 0; });
    if (got) bumpDaily(w, day, app, 'released', got);
    return got;
  }
  /** Release banked shards now if any are due (apps may call this at start; writes only when something is released). */
  function releaseBanked(app) {
    if (!isApp(app)) return 0;
    var w0 = load();
    if (!hasDueBank(w0, app, dayKey(now()))) return 0;
    var got = updateWallet(function (w) { var n = releaseBankIn(w, app); if (n) triforceDayCheck(w, app, dayKey(now())); return n || false; });
    if (got) markDay(app);
    return got || 0;
  }
  /**
   * Pay shards for something he truly learned and passed, once: the first time (app, onceId) is ever earned, on any of
   * his laptops. At most settings.onceDailyCap such shards per app per day; more is banked and released on later days.
   * Returns { paid, banked, reason } (reason 'repeat' | 'cap' | 'guessing' | null).
   */
  function earnOnce(app, onceId, shards, label) {
    var res = { paid: 0, banked: 0, reason: null };
    if (!isApp(app) || onceId == null || String(onceId) === '') { res.reason = 'invalid'; return res; }
    var id = String(onceId).slice(0, 120);
    shards = Math.max(0, Math.min(20, Math.round(Number(shards) || 0)));
    if (!shards) { res.reason = 'invalid'; return res; }
    if (guessing(app)) { res.reason = 'guessing'; return res; }
    var day = dayKey(now());
    updateWallet(function (w) {
      releaseBankIn(w, app);
      var s = w.settings;
      var o = (w.once = w.once && typeof w.once === 'object' ? w.once : {});
      var m = (o[app] = o[app] && typeof o[app] === 'object' ? o[app] : {});
      if (s.noRepeats && m[id] != null) { bumpDaily(w, day, app, 'repeat', 1); res.reason = 'repeat'; return true; }
      var room = Math.max(0, s.onceDailyCap - onceToday(w, app, day));
      var pay = Math.min(shards, room);
      var bank = shards - pay;
      var base = 'once:' + app + ':' + id + (s.noRepeats ? '' : ':' + now().toString(36) + Math.random().toString(36).slice(2, 6));
      if (pay > 0) {
        var ev = addEvent(w, app, 'progress', pay, label || 'Learned something new', 'once', id);
        ev.id = base;
        ev.want = shards;
      }
      if (bank > 0) {
        w.bank = Array.isArray(w.bank) ? w.bank : [];
        w.bank.push({ bid: base + ':bank', app: app, onceId: id, want: shards, total: bank, released: 0, label: String(label || 'Lesson').slice(0, 80), at: iso(now()) });
        bumpDaily(w, day, app, 'banked', bank);
        res.reason = 'cap';
      }
      if (s.noRepeats) m[id] = dayNum(now());
      res.paid = pay;
      res.banked = bank;
      if (pay > 0) triforceDayCheck(w, app, day);
      return true;
    });
    if (res.paid) {
      markDay(app);
      streakCheck(app);
    }
    return res;
  }
  /** Rupees only for the first correct answer on itemId within 30 days (per app; at most 5,000 ids remembered). */
  function rupeesOnce(app, itemId, rupees, label) {
    if (!isApp(app) || itemId == null || String(itemId) === '') return 0;
    rupees = Math.max(0, Math.min(100, Math.round(Number(rupees) || 0)));
    if (!rupees || guessing(app)) return 0;
    var id = String(itemId).slice(0, 80);
    var dn = dayNum(now());
    var day = dayKey(now());
    var paid = 0;
    updateWallet(function (w) {
      var s = w.settings;
      var sr = (w.seenRupee = w.seenRupee && typeof w.seenRupee === 'object' ? w.seenRupee : {});
      var m = (sr[app] = sr[app] && typeof sr[app] === 'object' ? sr[app] : {});
      if (s.noRepeats && m[id] != null && dn - m[id] < 30) { bumpDaily(w, day, app, 'repeatRupees', 1); return true; }
      m[id] = dn;
      var keys = Object.keys(m);
      if (keys.length > 5000) {
        keys.sort(function (a, b) { return m[a] - m[b]; });
        for (var i = 0; i < keys.length - 5000; i++) delete m[keys[i]];
      }
      paid = rupees;
      for (var j = w.events.length - 1; j >= 0 && j >= w.events.length - 60; j--) {
        var e = w.events[j];
        if (e && e.tag === 'rupeeOnce' && e.app === app && e.ref === day) {
          e.amount += rupees; // one growing ledger line per app per day keeps the ledger short
          e.at = iso(now());
          w.events.splice(j, 1);
          w.events.push(e);
          applyTotals(w, e, rupees);
          return true;
        }
      }
      addEvent(w, app, 'rupee', rupees, label || 'New correct answers', 'rupeeOnce', day);
      return true;
    });
    return paid;
  }
  /** The parent's anti-farming settings, for UIs. */
  function policy() {
    var s = settings();
    return { noRepeats: s.noRepeats, onceDailyCap: s.onceDailyCap, rupeeDays: 30, minutesPerShard: s.minutesPerShard, dailyTimeCap: s.dailyTimeCap, version: MODULE_VERSION };
  }
  /** Daily repeat / banked / released counters: { 'YYYY-MM-DD': { app: { repeat, repeatRupees, banked, released } } }. */
  function daily() {
    var w = load();
    return w.daily && typeof w.daily === 'object' ? clone(w.daily) : {};
  }
  /** Shards waiting in the bank, per app. */
  function bankedNow() {
    var w = load(), out = {};
    (Array.isArray(w.bank) ? w.bank : []).forEach(function (b) { if (b && isApp(b.app)) out[b.app] = (out[b.app] || 0) + Math.max(0, (b.total || 0) - (b.released || 0)); });
    return out;
  }
  /** Finished a unit of work (a quest, lesson, mission, build...): +2 shards and +10 rupees by default. */
  function finishUnit(app, reason, ref) {
    releaseBanked(app);
    var s = settings();
    var r = earn(app, 'progress', s.points.unit, reason || 'Finished a lesson', { tag: 'unit', ref: ref });
    if (r.granted) earnRupees(app, s.rupees.unit, reason || 'Finished a lesson', { tag: 'unit', ref: ref });
    return r;
  }
  /** Beat a boss, guardian or temple: +3 shards and +25 rupees by default. */
  function beatBoss(app, reason, ref) {
    releaseBanked(app);
    var s = settings();
    var r = earn(app, 'progress', s.points.boss, reason || 'Beat a boss', { tag: 'boss', ref: ref });
    if (r.granted) earnRupees(app, s.rupees.boss, reason || 'Beat a boss', { tag: 'boss', ref: ref });
    return r;
  }
  /** Solved after a miss, or finished after using Help: +1 effort shard, at most comebackDailyCap a day per app. */
  function comeback(app, reason) {
    return earn(app, 'effort', settings().points.comeback, reason || 'Kept going after a miss', { tag: 'comeback' });
  }
  /** A secret (a Gold Skulltula token): +1 shard. Never blocked. */
  function secret(app, reason) {
    return earn(app, 'secret', settings().points.secret, reason || 'Found a Gold Skulltula', { tag: 'secret' });
  }
  /**
   * Every answer goes through here: 3+ wrong answers within 5 s start a 60 s cool-down (no shards, no rupees);
   * a correct answer earns +1 rupee, at most 20 per lesson (lessonId names the lesson, quest or round).
   */
  function answer(app, correct, lessonId) {
    if (!isApp(app)) return 0;
    var s = settings();
    var t = now();
    if (!correct) {
      var list = (wrongs[app] = (wrongs[app] || []).filter(function (x) { return t - x < s.guessWindowMs; }));
      list.push(t);
      if (list.length >= 3) {
        guessUntil[app] = t + s.guessCooldownMs;
        wrongs[app] = [];
      }
      return 0;
    }
    if (guessing(app) || s.rupees.correct <= 0) return 0;
    var ref = String(lessonId == null ? 'lesson' : lessonId);
    return updateWallet(function (w) {
      var cap = w.settings.rupees.lessonCap;
      for (var i = w.events.length - 1; i >= 0; i--) {
        var e = w.events[i];
        if (e.tag === 'correct' && e.app === app && e.ref === ref) {
          if (e.amount >= cap) return false;
          var add = Math.min(w.settings.rupees.correct, cap - e.amount);
          e.amount += add; // one growing ledger line per lesson keeps the ledger short
          e.at = iso(now());
          w.events.splice(i, 1);
          w.events.push(e);
          applyTotals(w, e, add);
          return add;
        }
      }
      addEvent(w, app, 'rupee', Math.min(w.settings.rupees.correct, cap), 'Correct answers', 'correct', ref);
      return Math.min(w.settings.rupees.correct, cap);
    }) || 0;
  }
  /** Add active learning time; every minutesPerShard minutes earn a time shard (dailyTimeCap a day). */
  function tickActive(app, ms, opts) {
    if (!isApp(app)) return 0;
    ms = Math.min(Number(ms) || 0, 120000); // one tick never adds more than two minutes (sleep / resume guard)
    if (ms <= 0 || guessing(app)) return 0;
    var t = readTime();
    var day = dayKey(now());
    var d = (t.days[day] = t.days[day] || {});
    var s = settings();
    d[app] = (d[app] || 0) + ms;
    // 1.2: review / graduated content: the minutes count (days[d][app]) but earn no shards (also kept in days[d].rep)
    if (opts && opts.repeat && s.noRepeats) { d.rep = d.rep && typeof d.rep === 'object' ? d.rep : {}; d.rep[app] = (d.rep[app] || 0) + ms; }
    writeTime(t);
    var earnMs = d[app] - ((d.rep && d.rep[app]) || 0);
    var due = Math.min(s.dailyTimeCap, Math.floor(earnMs / (s.minutesPerShard * 60000)));
    var w = load();
    if (hasDueBank(w, app, day)) { releaseBanked(app); w = load(); }
    var have = eventsOn(w, app, day, function (e) { return e.kind === 'time'; });
    var got = 0;
    if (due > have) got = earn(app, 'time', due - have, s.minutesPerShard + ' minutes of learning', { tag: 'time' }).granted;
    else if (d[app] >= 60000) streakCheck(app);
    return got;
  }
  /**
   * The activity tracker: counts time only while the page is visible, there was an interaction in the last minute and
   * isLearning() says he is on a learning screen. Returns stop(). (env lets tests pass a fake document and clock.)
   */
  function startTracker(app, opts) {
    opts = opts || {};
    var doc = opts.document || (root && root.document);
    var target = opts.target || root;
    var every = opts.intervalMs || 5000;
    var last = now();
    var lastTick = now();
    var poke = function () {
      last = now();
    };
    var evs = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'input'];
    if (target && target.addEventListener) for (var i = 0; i < evs.length; i++) target.addEventListener(evs[i], poke, true);
    var tick = function () {
      var t = now();
      var dt = t - lastTick;
      lastTick = t;
      var visible = !doc || doc.visibilityState === undefined || doc.visibilityState === 'visible';
      var learning = typeof opts.isLearning === 'function' ? !!opts.isLearning() : true;
      var rep = typeof opts.isRepeat === 'function' ? !!opts.isRepeat() : !!opts.repeat;
      if (visible && learning && t - last <= settings().idleMs) tickActive(app, Math.min(dt, every * 2), { repeat: rep });
    };
    var id = (opts.setInterval || setInterval)(tick, every);
    return {
      tick: tick,
      poke: poke,
      stop: function () {
        (opts.clearInterval || clearInterval)(id);
        if (target && target.removeEventListener) for (var j = 0; j < evs.length; j++) target.removeEventListener(evs[j], poke, true);
      },
    };
  }

  // ---------- parent adjustments ----------
  function adjust(app, amount, reason) {
    amount = Math.round(Number(amount) || 0);
    if (!isApp(app) || !amount || !String(reason || '').trim()) return false;
    return updateWallet(function (w) {
      if (amount < 0) amount = -Math.min(-amount, Math.max(0, w.totals[app].earned - w.totals[app].spent));
      if (!amount) return false;
      addEvent(w, app, 'adjust', amount, reason, 'parent');
      return true;
    });
  }
  function adjustRupees(amount, reason) {
    amount = Math.round(Number(amount) || 0);
    if (!amount || !String(reason || '').trim()) return false;
    return updateWallet(function (w) {
      if (amount < 0) amount = -Math.min(-amount, Math.max(0, w.totals.rupees.earned - w.totals.rupees.spent));
      if (!amount) return false;
      addEvent(w, 'family', 'rupee', amount, reason, 'parent');
      return true;
    });
  }

  // ---------- rewards (familyApps.rewards.v1; costs live in wallet.settings.costs) ----------
  function cleanRewards(list) {
    var out = [];
    var seen = {};
    for (var i = 0; i < (Array.isArray(list) ? list.length : 0); i++) {
      var r = list[i];
      if (!r || typeof r !== 'object') continue;
      var text = String(r.text || '').trim().slice(0, 80);
      if (!text) continue;
      var id = String(r.id || 'r' + (out.length + 1)).slice(0, 40);
      if (seen[id]) id = id + '-' + out.length;
      seen[id] = 1;
      out.push({ id: id, emoji: String(r.emoji || '🎁').slice(0, 8), text: text });
      if (out.length >= MAX_REWARDS) break;
    }
    return out;
  }
  /** The reward list with each reward's cost in Triforces. Never writes. */
  function rewards() {
    var v = readJSON(KEYS.rewards) || {};
    var list = cleanRewards(v.rewards);
    if (!list.length) list = clone(DEFAULT_REWARDS);
    var costs = settings().costs;
    return {
      enabled: v.enabled !== false,
      weeklyCap: clampInt(v.weeklyCap, 0, 14, 5),
      list: list.map(function (r) {
        return { id: r.id, emoji: r.emoji, text: r.text, cost: clampInt(costs[r.id], 1, 5, 1) };
      }),
    };
  }
  /** Save the list (rewards.v1 keeps its shape; costs go to wallet.settings.costs so older code cannot drop them). */
  function saveRewards(next) {
    next = next || {};
    var old = readJSON(KEYS.rewards) || {};
    var list = cleanRewards(next.list || next.rewards);
    if (!list.length) list = clone(DEFAULT_REWARDS);
    var v = {};
    for (var k in old) v[k] = old[k];
    v.version = 1;
    v.enabled = next.enabled === undefined ? old.enabled !== false : next.enabled !== false;
    v.tokensPerTicket = clampInt(old.tokensPerTicket, 1, 10, 3);
    v.weeklyCap = clampInt(next.weeklyCap === undefined ? old.weeklyCap : next.weeklyCap, 0, 14, 5);
    v.rewards = list;
    v.updatedAt = iso(now());
    writeJSON(KEYS.rewards, v);
    emit('rewards');
    var costs = {};
    var src = next.list || next.rewards || [];
    for (var i = 0; i < src.length; i++) if (src[i] && src[i].id && src[i].cost != null) costs[String(src[i].id).slice(0, 40)] = clampInt(src[i].cost, 1, 5, 1);
    var cur = settings().costs;
    var same = JSON.stringify(cur) === JSON.stringify(costs);
    if (!same) setSettings({ costs: costs });
    return rewards();
  }

  // ---------- tickets (familyApps.tickets.v1, shared by the three apps) ----------
  function tickets() {
    var v = readJSON(KEYS.tickets);
    var list = Array.isArray(v) ? v.filter(function (t) { return t && typeof t === 'object'; }) : [];
    return list.sort(function (a, b) { return timeOf(b.earnedAt) - timeOf(a.earnedAt); });
  }
  function writeTickets(list) {
    var sorted = list.slice().sort(function (a, b) { return timeOf(b.earnedAt) - timeOf(a.earnedAt); }).slice(0, MAX_TICKETS);
    var ok = writeJSON(KEYS.tickets, sorted);
    if (ok) emit('tickets');
    return ok;
  }
  function markUsed(id) {
    var list = tickets();
    var hit = false;
    var next = list.map(function (t) {
      if (t.id !== id || t.status === 'used') return t;
      hit = true;
      var u = {};
      for (var k in t) u[k] = t[k];
      u.status = 'used';
      u.usedAt = iso(now());
      return u;
    });
    if (hit) writeTickets(next);
    return hit;
  }
  function ticketsThisWeek(list, t) {
    var from = weekStart(t);
    var to = addDays(from, 7);
    return list.filter(function (x) {
      var e = timeOf(x.earnedAt);
      return e >= from && e < to;
    }).length;
  }
  function needFor(rewardId, s) {
    var tri = clampInt(s.costs[rewardId], 1, 5, 1);
    if (s.mode === 'any') return { triforces: tri, any: s.anyCost * tri, apps: s.appsInSet.slice() };
    var need = { triforces: tri };
    for (var i = 0; i < s.appsInSet.length; i++) need[s.appsInSet[i]] = s.perApp[s.appsInSet[i]] * tri;
    return need;
  }
  function missingFor(need, b) {
    var miss = {};
    var short = false;
    if (need.any != null) {
      var have = 0;
      for (var j = 0; j < need.apps.length; j++) have += b[need.apps[j]] || 0;
      if (have < need.any) {
        miss.any = need.any - have;
        short = true;
      }
    } else {
      for (var a in need) {
        if (!isApp(a)) continue;
        if ((b[a] || 0) < need[a]) {
          miss[a] = need[a] - (b[a] || 0);
          short = true;
        }
      }
    }
    return short ? miss : null;
  }
  /** Can he claim this reward now? why: 'ok' | 'short' | 'cap' (weekly ticket cap) | 'off' | 'unknown'. */
  function canClaim(rewardId) {
    var r = rewards();
    var w = load();
    var need = needFor(rewardId, w.settings);
    if (!r.enabled) return { ok: false, why: 'off', need: need, missing: {} };
    if (!r.list.some(function (x) { return x.id === rewardId; })) return { ok: false, why: 'unknown', need: need, missing: {} };
    var miss = missingFor(need, balanceOf(w));
    if (miss) return { ok: false, why: 'short', need: need, missing: miss };
    if (ticketsThisWeek(tickets(), now()) >= r.weeklyCap) return { ok: false, why: 'cap', need: need, missing: {} };
    return { ok: true, why: 'ok', need: need, missing: {} };
  }
  /** In 'any' mode, take shards from the biggest balances (of the apps in the set) first. */
  function spendPlan(need, b) {
    var plan = {};
    if (need.any == null) {
      for (var a in need) if (isApp(a) && need[a] > 0) plan[a] = need[a];
      return plan;
    }
    var left = {};
    for (var i = 0; i < need.apps.length; i++) left[need.apps[i]] = b[need.apps[i]] || 0;
    for (var n = 0; n < need.any; n++) {
      var best = need.apps.slice().sort(function (x, y) { return left[y] - left[x] || APPS.indexOf(x) - APPS.indexOf(y); })[0];
      left[best]--;
      plan[best] = (plan[best] || 0) + 1;
    }
    return plan;
  }
  /** Claim a reward: spends the shards and adds a ticket (status 'earned'); a grown-up approves it with the PIN. */
  function claim(rewardId, app) {
    var c = canClaim(rewardId);
    if (!c.ok) return null;
    var reward = rewards().list.filter(function (x) { return x.id === rewardId; })[0];
    var t = now();
    app = isApp(app) ? app : isApp(env.app) ? env.app : 'family';
    var ticket = {
      id: app + '-' + t + '-' + Math.random().toString(36).slice(2, 7),
      app: app,
      rewardId: reward.id,
      rewardText: reward.text,
      emoji: reward.emoji,
      earnedAt: iso(t),
      status: 'earned',
      usedAt: null,
      cost: null,
    };
    var spent = updateWallet(function (w) {
      var need = needFor(rewardId, w.settings);
      var b = balanceOf(w);
      if (missingFor(need, b)) return false; // another tab spent first
      var plan = spendPlan(need, b);
      ticket.cost = { triforces: need.triforces };
      for (var a in plan) {
        ticket.cost[a] = plan[a];
        addEvent(w, a, 'spend', -plan[a], 'Reward: ' + reward.text, 'claim', ticket.id);
      }
      return true;
    });
    if (!spent) return null;
    if (!writeTickets([ticket].concat(tickets()))) {
      // could not save the ticket: give the shards back
      updateWallet(function (w) {
        for (var a in ticket.cost) if (isApp(a)) addEvent(w, a, 'adjust', ticket.cost[a], 'Refund: the ticket could not be saved', 'refund', ticket.id);
        return true;
      });
      return null;
    }
    return ticket;
  }

  // ---------- reports ----------
  function today() {
    var w = load();
    var t = readTime();
    var day = dayKey(now());
    var out = {};
    for (var i = 0; i < APPS.length; i++) {
      var a = APPS[i];
      out[a] = {
        minutes: todayMinutes(a, t),
        shards: shardsToday(w, a, day),
        rupees: eventsOn(w, a, day, function (e) { return e.kind === 'rupee' && e.amount > 0; }),
      };
    }
    return out;
  }
  function events(opts) {
    opts = opts || {};
    var list = load().events.slice().reverse();
    if (opts.app) list = list.filter(function (e) { return e.app === opts.app; });
    return list.slice(0, opts.limit || 50);
  }
  function weeklyReport(offset) {
    var from = addDays(weekStart(now()), -7 * (offset || 0));
    var to = addDays(from, 7);
    var w = load();
    var t = readTime();
    var tix = tickets();
    var out = { from: iso(from), to: iso(to), apps: {} };
    for (var i = 0; i < APPS.length; i++) out.apps[APPS[i]] = { minutes: 0, shards: 0, rupees: 0, tickets: 0 };
    for (var day in t.days) {
      var dt = new Date(day.replace(/-/g, '/')).getTime();
      if (dt < from || dt >= to) continue;
      for (var j = 0; j < APPS.length; j++) out.apps[APPS[j]].minutes += Math.floor((t.days[day][APPS[j]] || 0) / 60000);
    }
    for (var k = 0; k < w.events.length; k++) {
      var e = w.events[k];
      var at = timeOf(e.at);
      if (at < from || at >= to || !out.apps[e.app]) continue;
      if (SHARD_KINDS[e.kind] && e.amount > 0) out.apps[e.app].shards += e.amount;
      if (e.kind === 'rupee' && e.amount > 0) out.apps[e.app].rupees += e.amount;
    }
    for (var m = 0; m < tix.length; m++) {
      var x = tix[m];
      var et = timeOf(x.earnedAt);
      if (et >= from && et < to && out.apps[x.app]) out.apps[x.app].tickets++;
    }
    return out;
  }
  /** Has this app never earned anything (never opened since the wallet started)? */
  function isNew(app, w, t) {
    w = w || load();
    var tot = w.totals[app];
    if (tot && tot.earned > 0) return false;
    t = t || readTime();
    for (var d in t.days) if (t.days[d][app] || (t.days[d].done && t.days[d].done[app])) return false;
    return true;
  }
  /** A friendly hint for the app in the set furthest from the next full set: { app, text, isNew } (null when none). */
  function lowest(skin) {
    var w = load();
    var s = w.settings;
    var t = readTime();
    var nm = names(skin);
    for (var j = 0; j < s.appsInSet.length; j++) {
      var na = s.appsInSet[j];
      if (isNew(na, w, t)) return { app: na, text: 'New: ' + APP_INFO[na].name + '!', isNew: true };
    }
    if (s.mode === 'any') return null;
    var b = balanceOf(w);
    var best = null;
    for (var i = 0; i < s.appsInSet.length; i++) {
      var a = s.appsInSet[i];
      var per = s.perApp[a];
      if (!per) continue;
      var target = per * (b.triforces + 1);
      var ratio = (b[a] || 0) / target;
      if ((b[a] || 0) >= target) continue;
      if (!best || ratio < best.ratio) best = { app: a, ratio: ratio };
    }
    return best ? { app: best.app, text: (nm.hint[best.app] || 'Do some ' + APP_INFO[best.app].name + ' next!'), isNew: false } : null;
  }

  // ---------- migration from each app's older local systems (once per app) ----------
  /**
   * opts: { rupees: unspent local rupees, tokens: waiting Skulltula tokens, owned: [catalog ids of items bought in the
   * app's old shop] }. Each part runs once per app (a flag per app in wallet.migrated); nothing is written when there is
   * nothing to move. Returns what moved.
   */
  function migrateApp(app, opts) {
    opts = opts || {};
    if (!isApp(app)) return null;
    var moved = { rupees: 0, tokens: 0, owned: 0 };
    var rupees = Math.max(0, Math.round(Number(opts.rupees) || 0));
    var tokens = Math.max(0, Math.round(Number(opts.tokens) || 0));
    var w0 = load();
    var m0 = w0.migrated[app] || {};
    if ((rupees > 0 && !m0.rupees) || (tokens > 0 && !m0.tokens)) {
      updateWallet(function (w) {
        var m = (w.migrated[app] = Object.assign({}, w.migrated[app] || {}));
        if (rupees > 0 && !m.rupees) {
          addEvent(w, app, 'rupee', rupees, 'Rupees saved before the shared wallet', 'migrate');
          m.rupees = iso(now());
          moved.rupees = rupees;
        }
        if (tokens > 0 && !m.tokens) {
          addEvent(w, app, 'secret', tokens, 'Gold Skulltula tokens saved before the wallet', 'migrate');
          m.tokens = iso(now());
          moved.tokens = tokens;
        }
        return true;
      });
    }
    var owned = Array.isArray(opts.owned) ? opts.owned.filter(function (id) { return !!itemById(id); }) : [];
    if (owned.length && !m0.owned) {
      updateInventory(function (inv) {
        for (var i = 0; i < owned.length; i++) if (inv.owned.indexOf(owned[i]) < 0) {
          inv.owned.push(owned[i]);
          moved.owned++;
        }
        return true;
      });
      updateWallet(function (w) {
        w.migrated[app] = Object.assign({}, w.migrated[app] || {}, { owned: iso(now()) });
        return true;
      });
    }
    return moved;
  }
  function migrated(app) {
    return load().migrated[app] || {};
  }

  // ---------- the market: one shared catalog (cosmetic and creative only) ----------
  // Every item: { id, cat, price, emoji, image (a kit picture id or null), app (null = all apps), slot (equippables),
  // hue (Navi colors), name: { hyrule, grove, classic } }. Nothing here changes learning: no hints, no skips, no time.
  var CATALOG = [
    {"id": "bg.kokiri", "cat": "background", "price": 40, "emoji": "🏞️", "image": "kokiri_16x9", "app": null, "slot": "background", "name": {"hyrule": "Kokiri Forest", "grove": "Moss Hollow", "classic": "Green Forest"}, "portrait": "kokiri_9x16"},
    {"id": "bg.lon_lon_ranch", "cat": "background", "price": 60, "emoji": "🏞️", "image": "lon_lon_ranch_16x9", "app": null, "slot": "background", "name": {"hyrule": "Lon Lon Ranch", "grove": "Meadow Farm", "classic": "Sunny Farm"}, "portrait": "lon_lon_ranch_9x16"},
    {"id": "bg.kakariko", "cat": "background", "price": 80, "emoji": "🏞️", "image": "kakariko_16x9", "app": null, "slot": "background", "name": {"hyrule": "Kakariko Village", "grove": "Lantern Village", "classic": "Hill Village"}, "portrait": "kakariko_9x16"},
    {"id": "bg.lost_woods", "cat": "background", "price": 100, "emoji": "🏞️", "image": "lost_woods_16x9", "app": null, "slot": "background", "name": {"hyrule": "Lost Woods", "grove": "Whisper Woods", "classic": "Deep Woods"}, "portrait": "lost_woods_9x16"},
    {"id": "bg.lake_hylia", "cat": "background", "price": 120, "emoji": "🏞️", "image": "lake_hylia_16x9", "app": null, "slot": "background", "name": {"hyrule": "Lake Hylia", "grove": "Mist Lake", "classic": "Blue Lake"}, "portrait": "lake_hylia_9x16"},
    {"id": "bg.zoras_domain", "cat": "background", "price": 150, "emoji": "🏞️", "image": "zoras_domain_16x9", "app": null, "slot": "background", "name": {"hyrule": "Zora's Domain", "grove": "Tide Halls", "classic": "Waterfall Hall"}, "portrait": "zoras_domain_9x16"},
    {"id": "bg.goron_city", "cat": "background", "price": 150, "emoji": "🏞️", "image": "goron_city_16x9", "app": null, "slot": "background", "name": {"hyrule": "Goron City", "grove": "Ember Peak", "classic": "Mountain Town"}, "portrait": "goron_city_9x16"},
    {"id": "bg.forest_temple", "cat": "background", "price": 200, "emoji": "🏞️", "image": "forest_temple_16x9", "app": null, "slot": "background", "name": {"hyrule": "Forest Temple", "grove": "Thorn Maze", "classic": "Leafy Temple"}, "portrait": "forest_temple_9x16"},
    {"id": "bg.fire_temple", "cat": "background", "price": 220, "emoji": "🏞️", "image": "fire_temple_16x9", "app": null, "slot": "background", "name": {"hyrule": "Fire Temple", "grove": "Ember Vault", "classic": "Lava Temple"}, "portrait": "fire_temple_9x16"},
    {"id": "bg.water_temple", "cat": "background", "price": 240, "emoji": "🏞️", "image": "water_temple_16x9", "app": null, "slot": "background", "name": {"hyrule": "Water Temple", "grove": "Tide Cave", "classic": "Wave Temple"}, "portrait": "water_temple_9x16"},
    {"id": "bg.temple_of_time", "cat": "background", "price": 300, "emoji": "🏞️", "image": "temple_of_time_16x9", "app": null, "slot": "background", "name": {"hyrule": "Temple of Time", "grove": "Starlit Hall", "classic": "Great Hall"}, "portrait": "temple_of_time_9x16"},
    {"id": "bg.shadow_temple", "cat": "background", "price": 320, "emoji": "🏞️", "image": "shadow_temple_16x9", "app": null, "slot": "background", "name": {"hyrule": "Shadow Temple", "grove": "Moon Crypt", "classic": "Night Temple"}, "portrait": "shadow_temple_9x16"},
    {"id": "bg.spirit_temple", "cat": "background", "price": 340, "emoji": "🏞️", "image": "spirit_temple_16x9", "app": null, "slot": "background", "name": {"hyrule": "Spirit Temple", "grove": "Sun Dune", "classic": "Desert Temple"}, "portrait": "spirit_temple_9x16"},
    {"id": "bg.ganon_castle", "cat": "background", "price": 600, "emoji": "🏞️", "image": "ganon_castle_16x9", "app": null, "slot": "background", "name": {"hyrule": "Ganon's Castle", "grove": "Storm Keep", "classic": "Storm Castle"}, "portrait": "ganon_castle_9x16"},
    {"id": "buddy.saria", "cat": "buddy", "price": 50, "emoji": "🌿", "image": "saria_bust_happy", "app": null, "slot": "buddy", "name": {"hyrule": "Saria", "grove": "Fern Sprite", "classic": "Forest Friend"}},
    {"id": "buddy.malon", "cat": "buddy", "price": 80, "emoji": "🐴", "image": "malon_bust", "app": null, "slot": "buddy", "name": {"hyrule": "Malon", "grove": "Meadow Friend", "classic": "Farm Friend"}},
    {"id": "buddy.darunia", "cat": "buddy", "price": 150, "emoji": "🪨", "image": "darunia_bust", "app": null, "slot": "buddy", "name": {"hyrule": "Darunia", "grove": "Stone Giant", "classic": "Mountain Friend"}},
    {"id": "buddy.ruto", "cat": "buddy", "price": 150, "emoji": "🐟", "image": "ruto_bust", "app": null, "slot": "buddy", "name": {"hyrule": "Ruto", "grove": "River Sprite", "classic": "Lake Friend"}},
    {"id": "buddy.impa", "cat": "buddy", "price": 250, "emoji": "🛡️", "image": "impa_bust", "app": null, "slot": "buddy", "name": {"hyrule": "Impa", "grove": "Shadow Keeper", "classic": "Brave Guard"}},
    {"id": "buddy.kaepora", "cat": "buddy", "price": 350, "emoji": "🦉", "image": "kaepora_gaebora", "app": null, "slot": "buddy", "name": {"hyrule": "Kaepora Gaebora", "grove": "Wise Owl", "classic": "Wise Owl"}},
    {"id": "navi.blue", "cat": "navi", "price": 0, "emoji": "🔵", "image": null, "app": null, "slot": "naviColor", "name": {"hyrule": "Navi: Blue Glow", "grove": "Glim: Blue Glow", "classic": "Blue Glow"}, "hue": 205, "free": true},
    {"id": "navi.pink", "cat": "navi", "price": 30, "emoji": "🩷", "image": null, "app": null, "slot": "naviColor", "name": {"hyrule": "Navi: Pink Glow", "grove": "Glim: Pink Glow", "classic": "Pink Glow"}, "hue": 320},
    {"id": "navi.green", "cat": "navi", "price": 40, "emoji": "🟢", "image": null, "app": null, "slot": "naviColor", "name": {"hyrule": "Navi: Green Glow", "grove": "Glim: Green Glow", "classic": "Green Glow"}, "hue": 125},
    {"id": "navi.teal", "cat": "navi", "price": 45, "emoji": "🩵", "image": null, "app": null, "slot": "naviColor", "name": {"hyrule": "Navi: Sea Glow", "grove": "Glim: Sea Glow", "classic": "Sea Glow"}, "hue": 175},
    {"id": "navi.purple", "cat": "navi", "price": 50, "emoji": "🟣", "image": null, "app": null, "slot": "naviColor", "name": {"hyrule": "Navi: Purple Glow", "grove": "Glim: Purple Glow", "classic": "Purple Glow"}, "hue": 275},
    {"id": "navi.gold", "cat": "navi", "price": 60, "emoji": "🟡", "image": null, "app": null, "slot": "naviColor", "name": {"hyrule": "Navi: Gold Glow", "grove": "Glim: Gold Glow", "classic": "Gold Glow"}, "hue": 45},
    {"id": "navi.red", "cat": "navi", "price": 80, "emoji": "🔴", "image": null, "app": null, "slot": "naviColor", "name": {"hyrule": "Navi: Ember Glow", "grove": "Glim: Ember Glow", "classic": "Ember Glow"}, "hue": 0},
    {"id": "trophy.bottle", "cat": "trophy", "price": 40, "emoji": "🍶", "image": "bottle", "app": null, "slot": null, "name": {"hyrule": "Empty Bottle", "grove": "Glass Bottle", "classic": "Glass Bottle"}},
    {"id": "trophy.ocarina_fairy", "cat": "trophy", "price": 60, "emoji": "🎶", "image": "ocarina_fairy", "app": null, "slot": null, "name": {"hyrule": "Fairy Ocarina", "grove": "Little Flute", "classic": "Little Flute"}},
    {"id": "trophy.map", "cat": "trophy", "price": 70, "emoji": "🗺️", "image": "dungeon_map", "app": null, "slot": null, "name": {"hyrule": "Dungeon Map", "grove": "Old Map", "classic": "Old Map"}},
    {"id": "trophy.compass", "cat": "trophy", "price": 70, "emoji": "🧭", "image": "compass", "app": null, "slot": null, "name": {"hyrule": "Compass", "grove": "Star Compass", "classic": "Compass"}},
    {"id": "trophy.key_boss", "cat": "trophy", "price": 120, "emoji": "🗝️", "image": "key_boss", "app": null, "slot": null, "name": {"hyrule": "Boss Key", "grove": "Big Key", "classic": "Big Key"}},
    {"id": "trophy.emerald", "cat": "trophy", "price": 180, "emoji": "💚", "image": "stone_kokiri_emerald", "app": null, "slot": null, "name": {"hyrule": "Kokiri Emerald (replica)", "grove": "Green Star Stone", "classic": "Green Gem"}},
    {"id": "trophy.ruby", "cat": "trophy", "price": 180, "emoji": "❤️", "image": "stone_goron_ruby", "app": null, "slot": null, "name": {"hyrule": "Goron Ruby (replica)", "grove": "Red Star Stone", "classic": "Red Gem"}},
    {"id": "trophy.sapphire", "cat": "trophy", "price": 180, "emoji": "💙", "image": "stone_zora_sapphire", "app": null, "slot": null, "name": {"hyrule": "Zora Sapphire (replica)", "grove": "Blue Star Stone", "classic": "Blue Gem"}},
    {"id": "trophy.med_forest", "cat": "trophy", "price": 200, "emoji": "🏅", "image": "medallion_forest", "app": null, "slot": null, "name": {"hyrule": "Forest Medallion (replica)", "grove": "Thorn Seal", "classic": "Leaf Medal"}},
    {"id": "trophy.med_fire", "cat": "trophy", "price": 220, "emoji": "🏅", "image": "medallion_fire", "app": null, "slot": null, "name": {"hyrule": "Fire Medallion (replica)", "grove": "Ember Seal", "classic": "Flame Medal"}},
    {"id": "trophy.med_water", "cat": "trophy", "price": 240, "emoji": "🏅", "image": "medallion_water", "app": null, "slot": null, "name": {"hyrule": "Water Medallion (replica)", "grove": "Tide Seal", "classic": "Wave Medal"}},
    {"id": "trophy.heart", "cat": "trophy", "price": 250, "emoji": "💗", "image": "heart_container", "app": null, "slot": null, "name": {"hyrule": "Heart Container", "grove": "Heart Crystal", "classic": "Big Heart"}},
    {"id": "trophy.med_shadow", "cat": "trophy", "price": 280, "emoji": "🏅", "image": "medallion_shadow", "app": null, "slot": null, "name": {"hyrule": "Shadow Medallion (replica)", "grove": "Moon Seal", "classic": "Night Medal"}},
    {"id": "trophy.med_spirit", "cat": "trophy", "price": 300, "emoji": "🏅", "image": "medallion_spirit", "app": null, "slot": null, "name": {"hyrule": "Spirit Medallion (replica)", "grove": "Sun Seal", "classic": "Sun Medal"}},
    {"id": "trophy.med_light", "cat": "trophy", "price": 400, "emoji": "🏅", "image": "medallion_light", "app": null, "slot": null, "name": {"hyrule": "Light Medallion (replica)", "grove": "Light Seal", "classic": "Light Medal"}},
    {"id": "trophy.ocarina_time", "cat": "trophy", "price": 500, "emoji": "🎵", "image": "ocarina_time", "app": null, "slot": null, "name": {"hyrule": "Ocarina of Time", "grove": "Silver Flute", "classic": "Silver Flute"}},
    {"id": "trophy.gold_rupee", "cat": "trophy", "price": 1000, "emoji": "🏆", "image": "rupee_gold", "app": null, "slot": null, "name": {"hyrule": "Golden Rupee Statue", "grove": "Golden Gem Statue", "classic": "Golden Gem Statue"}},
    {"id": "music.forest", "cat": "music", "price": 50, "emoji": "🎵", "image": null, "app": null, "slot": "music", "name": {"hyrule": "Forest Romp", "grove": "Forest Romp", "classic": "Forest Romp"}, "track": "forest"},
    {"id": "music.ranch", "cat": "music", "price": 60, "emoji": "🎵", "image": null, "app": null, "slot": "music", "name": {"hyrule": "Meadow Fence Reel", "grove": "Meadow Fence Reel", "classic": "Meadow Fence Reel"}, "track": "ranch"},
    {"id": "music.village", "cat": "music", "price": 80, "emoji": "🎵", "image": null, "app": null, "slot": "music", "name": {"hyrule": "Lantern Square Waltz", "grove": "Lantern Square Waltz", "classic": "Lantern Square Waltz"}, "track": "village"},
    {"id": "music.field", "cat": "music", "price": 90, "emoji": "🎵", "image": null, "app": null, "slot": "music", "name": {"hyrule": "Open Field", "grove": "Open Field", "classic": "Open Field"}, "track": "field"},
    {"id": "music.water", "cat": "music", "price": 120, "emoji": "🎵", "image": null, "app": null, "slot": "music", "name": {"hyrule": "Still Lake Halls", "grove": "Still Lake Halls", "classic": "Still Lake Halls"}, "track": "water"},
    {"id": "music.fire", "cat": "music", "price": 120, "emoji": "🎵", "image": null, "app": null, "slot": "music", "name": {"hyrule": "Ember Forge", "grove": "Ember Forge", "classic": "Ember Forge"}, "track": "fire"},
    {"id": "music.spirit", "cat": "music", "price": 150, "emoji": "🎵", "image": null, "app": null, "slot": "music", "name": {"hyrule": "Sandstone Mirage", "grove": "Sandstone Mirage", "classic": "Sandstone Mirage"}, "track": "spirit"},
    {"id": "music.shadow", "cat": "music", "price": 150, "emoji": "🎵", "image": null, "app": null, "slot": "music", "name": {"hyrule": "Lantern in the Dark", "grove": "Lantern in the Dark", "classic": "Lantern in the Dark"}, "track": "shadow"},
    {"id": "music.victory", "cat": "music", "price": 200, "emoji": "🎵", "image": null, "app": null, "slot": "music", "name": {"hyrule": "Bright Return", "grove": "Bright Return", "classic": "Bright Return"}, "track": "victory"},
    {"id": "music.boss", "cat": "music", "price": 250, "emoji": "🎵", "image": null, "app": null, "slot": "music", "name": {"hyrule": "Guardian Clash", "grove": "Guardian Clash", "classic": "Guardian Clash"}, "track": "boss"},
    {"id": "title.kokiri_kid", "cat": "title", "price": 30, "emoji": "🏷️", "image": null, "app": null, "slot": "title", "name": {"hyrule": "Kokiri Kid", "grove": "Moss Kid", "classic": "Rookie"}},
    {"id": "title.fairy_friend", "cat": "title", "price": 40, "emoji": "🏷️", "image": null, "app": null, "slot": "title", "name": {"hyrule": "Fairy Friend", "grove": "Glim's Friend", "classic": "Helper Friend"}},
    {"id": "title.rupee_ranger", "cat": "title", "price": 50, "emoji": "🏷️", "image": null, "app": null, "slot": "title", "name": {"hyrule": "Rupee Ranger", "grove": "Gem Ranger", "classic": "Gem Ranger"}},
    {"id": "title.puzzle_sage", "cat": "title", "price": 120, "emoji": "🏷️", "image": null, "app": null, "slot": "title", "name": {"hyrule": "Puzzle Sage", "grove": "Puzzle Sage", "classic": "Puzzle Sage"}},
    {"id": "title.temple_explorer", "cat": "title", "price": 150, "emoji": "🏷️", "image": null, "app": null, "slot": "title", "name": {"hyrule": "Temple Explorer", "grove": "Vault Explorer", "classic": "Explorer"}},
    {"id": "title.song_keeper", "cat": "title", "price": 200, "emoji": "🏷️", "image": null, "app": null, "slot": "title", "name": {"hyrule": "Song Keeper", "grove": "Song Keeper", "classic": "Song Keeper"}},
    {"id": "title.hero_of_time", "cat": "title", "price": 500, "emoji": "🏷️", "image": null, "app": null, "slot": "title", "name": {"hyrule": "Hero of Time", "grove": "Hero of the Grove", "classic": "Hero of the Day"}},
    {"id": "title.triforce_keeper", "cat": "title", "price": 800, "emoji": "🏷️", "image": null, "app": null, "slot": "title", "name": {"hyrule": "Keeper of the Triforce", "grove": "Keeper of the Star Crown", "classic": "Grand Champion"}},
    {"id": "maker.heroes_goron", "cat": "maker", "price": 150, "emoji": "🦸", "image": "darunia_bust", "app": "code", "slot": null, "name": {"hyrule": "Goron Heroes pack", "grove": "Stone Heroes pack", "classic": "Mountain Heroes pack"}},
    {"id": "maker.enemies_forest", "cat": "maker", "price": 150, "emoji": "👾", "image": "deku_tree_face", "app": "code", "slot": null, "name": {"hyrule": "Forest Critters pack", "grove": "Thorn Critters pack", "classic": "Forest Critters pack"}},
    {"id": "maker.world_lake", "cat": "maker", "price": 200, "emoji": "🌊", "image": "lake_hylia_16x9", "app": "code", "slot": null, "name": {"hyrule": "Lake Hylia world", "grove": "Mist Lake world", "classic": "Lake world"}},
    {"id": "maker.world_fire", "cat": "maker", "price": 250, "emoji": "🌋", "image": "fire_temple_16x9", "app": "code", "slot": null, "name": {"hyrule": "Fire Temple world", "grove": "Ember Vault world", "classic": "Lava world"}},
    {"id": "maker.boss_dodongo", "cat": "maker", "price": 300, "emoji": "🐉", "image": "boss_king_dodongo_battle", "app": "code", "slot": null, "name": {"hyrule": "King Dodongo boss", "grove": "Ember Shade boss", "classic": "Rock Dragon boss"}},
    {"id": "maker.boss_volvagia", "cat": "maker", "price": 400, "emoji": "🔥", "image": "boss_volvagia_battle", "app": "code", "slot": null, "name": {"hyrule": "Volvagia boss", "grove": "Ember Shade boss II", "classic": "Fire Dragon boss"}},
    {"id": "partner.saria", "cat": "partner", "price": 120, "emoji": "🌿", "image": "saria_bust_curious", "app": "language", "slot": null, "name": {"hyrule": "Chat with Saria in the forest", "grove": "Chat with the Fern Sprite", "classic": "Forest friend chat"}},
    {"id": "partner.malon", "cat": "partner", "price": 150, "emoji": "🐴", "image": "malon_bust", "app": "language", "slot": null, "name": {"hyrule": "Chat with Malon at the ranch", "grove": "Chat with the Meadow Friend", "classic": "Farm friend chat"}},
    {"id": "partner.impa", "cat": "partner", "price": 200, "emoji": "🛡️", "image": "impa_bust", "app": "language", "slot": null, "name": {"hyrule": "Chat with Impa in Kakariko", "grove": "Chat with the Shadow Keeper", "classic": "Village guard chat"}},
    {"id": "partner.ruto", "cat": "partner", "price": 200, "emoji": "🐟", "image": "ruto_bust", "app": "language", "slot": null, "name": {"hyrule": "Chat with Ruto at Zora's Domain", "grove": "Chat with the River Sprite", "classic": "Lake friend chat"}},
    {"id": "partner.darunia", "cat": "partner", "price": 200, "emoji": "🪨", "image": "darunia_bust", "app": "language", "slot": null, "name": {"hyrule": "Chat with Darunia on the mountain", "grove": "Chat with the Stone Giant", "classic": "Mountain friend chat"}},
    {"id": "partner.zelda", "cat": "partner", "price": 300, "emoji": "👑", "image": "zelda_bust", "app": "language", "slot": null, "name": {"hyrule": "Chat with Princess Zelda at the castle", "grove": "Chat with the Star Princess", "classic": "Castle chat"}},
    {"id": "math.arena_forest", "cat": "arena", "price": 150, "emoji": "🌲", "image": "forest_temple_16x9", "app": "math", "slot": "math.arena", "name": {"hyrule": "Forest Temple arena", "grove": "Thorn Maze arena", "classic": "Leafy arena"}},
    {"id": "math.arena_water", "cat": "arena", "price": 250, "emoji": "🌊", "image": "water_temple_16x9", "app": "math", "slot": "math.arena", "name": {"hyrule": "Water Temple arena", "grove": "Tide Cave arena", "classic": "Wave arena"}},
    {"id": "math.arena_spirit", "cat": "arena", "price": 300, "emoji": "🏜️", "image": "spirit_temple_16x9", "app": "math", "slot": "math.arena", "name": {"hyrule": "Spirit Temple arena", "grove": "Sun Dune arena", "classic": "Desert arena"}},
    {"id": "math.arena_castle", "cat": "arena", "price": 450, "emoji": "🏰", "image": "ganon_castle_16x9", "app": "math", "slot": "math.arena", "name": {"hyrule": "Ganon's Castle arena", "grove": "Storm Keep arena", "classic": "Storm arena"}},
  ];
  var CATS = {
    background: { hyrule: 'Home backgrounds', grove: 'Home backgrounds', classic: 'Backgrounds' },
    buddy: { hyrule: 'Buddies', grove: 'Buddies', classic: 'Buddies' },
    navi: { hyrule: 'Navi colors', grove: 'Glim colors', classic: 'Helper colors' },
    trophy: { hyrule: "Hero's Room trophies", grove: 'Treehouse treasures', classic: 'Trophies' },
    music: { hyrule: 'Music', grove: 'Music', classic: 'Music' },
    title: { hyrule: 'Titles', grove: 'Titles', classic: 'Titles' },
    maker: { hyrule: 'Maker packs', grove: 'Maker packs', classic: 'Maker packs' },
    partner: { hyrule: 'Conversation partners', grove: 'Conversation partners', classic: 'Conversation partners' },
    arena: { hyrule: 'Arena & guardian skins', grove: 'Arena skins', classic: 'Arena skins' },
    legacy: { hyrule: 'Outfits', grove: 'Outfits', classic: 'Outfits' },
  };
  var COSMETIC_CATS = Object.keys(CATS);
  var registered = [];
  function allItems() {
    return CATALOG.concat(registered);
  }
  function itemById(id) {
    var list = allItems();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  /** An app adds its own older shop items (priced in shared rupees). Ids should start with the app id ("math."). */
  function registerItems(items) {
    for (var i = 0; i < (items || []).length; i++) {
      var it = items[i];
      if (!it || !it.id || itemById(it.id) || COSMETIC_CATS.indexOf(it.cat) < 0) continue;
      registered.push({
        id: String(it.id),
        cat: it.cat,
        price: clampInt(it.price, 0, 1000, 100),
        emoji: it.emoji || '🎁',
        image: it.image || null,
        app: isApp(it.app) ? it.app : null,
        slot: it.slot || null,
        hue: it.hue == null ? null : Number(it.hue),
        color: it.color || null,
        free: !!it.free,
        name: typeof it.name === 'string' ? { hyrule: it.name, grove: it.plain || it.name, classic: it.plain || it.name } : it.name || {},
      });
    }
  }
  function weekIndex(t) {
    return Math.round((weekStart(t) - new Date(2026, 0, 4).getTime()) / (7 * 864e5)); // weeks since Sun Jan 4 2026
  }
  /** This week's new item: the same for every app (shared items only), rotating every Sunday. */
  function weeklyItem() {
    var pool = CATALOG.filter(function (it) { return !it.app && it.price >= 80; });
    if (!pool.length) return null;
    var n = weekIndex(now());
    return pool[((n % pool.length) + pool.length) % pool.length];
  }
  function catalog(app) {
    var wk = weeklyItem();
    return allItems()
      .filter(function (it) { return !it.app || it.app === app; })
      .map(function (it) {
        var o = {};
        for (var k in it) o[k] = it[k];
        o.weekly = !!wk && wk.id === it.id;
        return o;
      });
  }
  function itemName(item, skin) {
    if (!item) return '';
    var n = item.name || {};
    return n[skin] || n.hyrule || item.id;
  }
  function catName(cat, skin) {
    var c = CATS[cat] || {};
    return c[skin] || c.hyrule || cat;
  }

  // ---------- inventory (familyApps.inventory.v1) ----------
  var SLOTS = ['background', 'buddy', 'naviColor', 'music', 'title'];
  function normInventory(v) {
    v = v && typeof v === 'object' ? v : {};
    var out = {};
    for (var k in v) out[k] = v[k];
    out.owned = Array.isArray(v.owned) ? v.owned.filter(function (x) { return typeof x === 'string'; }) : [];
    var eq = v.equipped && typeof v.equipped === 'object' ? v.equipped : {};
    out.equipped = {};
    for (var e in eq) out.equipped[e] = typeof eq[e] === 'string' ? eq[e] : null;
    for (var i = 0; i < SLOTS.length; i++) if (!(SLOTS[i] in out.equipped)) out.equipped[SLOTS[i]] = null;
    out.goal = typeof v.goal === 'string' ? v.goal : null;
    out.updatedAt = v.updatedAt || null;
    return out;
  }
  function inventory() {
    return normInventory(readJSON(KEYS.inventory));
  }
  function updateInventory(mutate) {
    var inv = inventory();
    var res = mutate(inv);
    if (res === false) return false;
    inv.updatedAt = iso(now());
    if (!writeJSON(KEYS.inventory, inv)) return false;
    emit('inventory');
    return res === undefined ? true : res;
  }
  function owns(id) {
    var it = itemById(id);
    return !!it && (it.free || it.price === 0 || inventory().owned.indexOf(id) >= 0);
  }
  /** Buy an item with shared rupees. why: 'ok' | 'owned' | 'short' | 'unknown'. */
  function buy(id) {
    var it = itemById(id);
    if (!it) return { ok: false, why: 'unknown' };
    if (owns(id)) return { ok: false, why: 'owned' };
    var paid = updateWallet(function (w) {
      if (balanceOf(w).rupees < it.price) return false;
      if (it.price > 0) addEvent(w, 'family', 'buy', -it.price, 'Bought: ' + itemName(it, 'hyrule'), 'market', it.id);
      return true;
    });
    if (!paid) return { ok: false, why: 'short' };
    var ok = updateInventory(function (inv) {
      if (inv.owned.indexOf(id) < 0) inv.owned.push(id);
      if (inv.goal === id) inv.goal = null;
      return true;
    });
    if (!ok) {
      updateWallet(function (w) {
        addEvent(w, 'family', 'rupee', it.price, 'Refund: the item could not be saved', 'refund', it.id);
        return true;
      });
      return { ok: false, why: 'unknown' };
    }
    return { ok: true, why: 'ok' };
  }
  function equip(slot, id) {
    if (id != null) {
      var it = itemById(id);
      if (!it || it.slot !== slot || !owns(id)) return false;
    }
    return updateInventory(function (inv) {
      if (inv.equipped[slot] === (id || null)) return false;
      inv.equipped[slot] = id || null;
      return true;
    });
  }
  function setGoal(id) {
    if (id != null && (!itemById(id) || owns(id))) return false;
    return updateInventory(function (inv) {
      if (inv.goal === (id || null)) return false;
      inv.goal = id || null;
      return true;
    });
  }
  function equippedItems() {
    var eq = inventory().equipped;
    var out = {};
    for (var k in eq) out[k] = eq[k] ? itemById(eq[k]) : null;
    return out;
  }
  /** An unowned item he can afford now: the goal first, then this week's item, then the dearest affordable one. */
  function affordable(app) {
    var r = balance().rupees;
    var inv = inventory();
    var can = function (it) {
      return it && (!it.app || it.app === app) && !owns(it.id) && it.price > 0 && it.price <= r;
    };
    var goal = inv.goal ? itemById(inv.goal) : null;
    if (can(goal)) return goal;
    var wk = weeklyItem();
    if (can(wk)) return wk;
    var best = null;
    var list = allItems();
    for (var i = 0; i < list.length; i++) if (can(list[i]) && (!best || list[i].price > best.price)) best = list[i];
    return best;
  }
  function goalProgress() {
    var inv = inventory();
    var it = inv.goal ? itemById(inv.goal) : null;
    if (!it) return null;
    var have = Math.min(balance().rupees, it.price);
    return { item: it, have: have, price: it.price, pct: it.price ? Math.round((100 * have) / it.price) : 100 };
  }

  // ---------- words per look ----------
  var NAMES = {
    hyrule: {
      triforce: 'Triforce', triforces: 'Triforces', shard: { math: 'Wisdom', language: 'Courage', code: 'Power', music: 'Song' },
      rupee: 'rupee', rupees: 'rupees', market: 'Hyrule Market', room: "Hero's Room", wallet: 'Treasure Wallet',
      secrets: 'House of Skulltula', goal: 'Saving for', claim: 'Claim a reward', ticket: 'Reward Ticket',
      showGrownUp: 'Show a grown-up!', affordable: 'You can afford',
      hint: { math: 'Earn some Wisdom in Math Arena next!', language: 'Earn some Courage in Language Quest next!', code: 'Earn some Power in Code Quest next!', music: 'Earn a Song in Music Quest next!' },
    },
    grove: {
      triforce: 'Star Crown', triforces: 'Star Crowns', shard: { math: 'Wisdom', language: 'Courage', code: 'Power', music: 'Song' },
      rupee: 'gem', rupees: 'gems', market: 'Grove Market', room: 'Treehouse', wallet: 'Treasure Pouch',
      secrets: 'The Beetle Burrow', goal: 'Saving for', claim: 'Claim a reward', ticket: 'Reward Ticket',
      showGrownUp: 'Show a grown-up!', affordable: 'You can afford',
      hint: { math: 'Grow some Wisdom in Math Arena next!', language: 'Grow some Courage in Language Quest next!', code: 'Grow some Power in Code Quest next!', music: 'Grow a Song in Music Quest next!' },
    },
    classic: {
      triforce: 'Trophy', triforces: 'Trophies', shard: { math: 'Math', language: 'Language', code: 'Code', music: 'Music' },
      rupee: 'gem', rupees: 'gems', market: 'Market', room: 'Trophy Room', wallet: 'Treasure Wallet',
      secrets: 'The Star Vault', goal: 'Saving for', claim: 'Claim a reward', ticket: 'Reward Ticket',
      showGrownUp: 'Show a grown-up!', affordable: 'You can afford',
      hint: { math: 'Do some Math Arena next!', language: 'Do some Language Quest next!', code: 'Do some Code Quest next!', music: 'Do some Music Quest next!' },
    },
  };
  function names(skin) {
    return NAMES[skin] || NAMES.hyrule;
  }

  var FW = {
    VERSION: VERSION, KEYS: KEYS, APPS: APPS, APP_INFO: APP_INFO, DEFAULT_SETTINGS: DEFAULT_SETTINGS, DEFAULT_REWARDS: DEFAULT_REWARDS,
    MAX_EVENTS: MAX_EVENTS, MAX_TICKETS: MAX_TICKETS, MAX_REWARDS: MAX_REWARDS, SLOTS: SLOTS, COSMETIC_CATS: COSMETIC_CATS,
    configure: function (o) {
      o = o || {};
      if ('storage' in o) env.storage = o.storage;
      if ('now' in o) env.now = o.now;
      if ('app' in o) env.app = o.app; // this app's id: the default for claim()
      if (o.resetMemory) {
        memData = {};
        wrongs = {};
        guessUntil = {};
      }
    },
    load: load, balance: balance, settings: settings, setSettings: setSettings, getSettings: settings,
    earn: earn, earnRupees: earnRupees, finishUnit: finishUnit, beatBoss: beatBoss, comeback: comeback, secret: secret, answer: answer,
    guessing: guessing, tickActive: tickActive, startTracker: startTracker, todayMinutes: function (app) { return todayMinutes(app); },
    streak: streakOf, adjust: adjust, adjustRupees: adjustRupees,
    rewards: rewards, saveRewards: saveRewards, tickets: tickets, markUsed: markUsed, canClaim: canClaim, claim: claim,
    today: today, events: events, weeklyReport: weeklyReport, lowest: lowest,
    migrateApp: migrateApp, migrated: migrated,
    catalog: catalog, registerItems: registerItems, itemById: itemById, itemName: itemName, catName: catName, weeklyItem: weeklyItem,
    inventory: inventory, owns: owns, buy: buy, equip: equip, setGoal: setGoal, equippedItems: equippedItems, affordable: affordable, goalProgress: goalProgress,
    names: names, onChange: onChange, dayKey: dayKey, weekStart: weekStart,
    registerApp: registerApp, isNew: function (app) { return isNew(app); },
    MODULE_VERSION: MODULE_VERSION, earnOnce: earnOnce, rupeesOnce: rupeesOnce, releaseBanked: releaseBanked, policy: policy, daily: daily, bankedNow: bankedNow,
    appsInSet: function () { return settings().appsInSet.slice(); },
    _catalog: CATALOG,
  };

  // ---------- UI (vanilla) ----------
  function installUI(FW) {
    var SLOTS = ['background', 'buddy', 'naviColor', 'music', 'title'];
    var CAT_ORDER = ['background', 'buddy', 'navi', 'trophy', 'music', 'title', 'maker', 'partner', 'arena', 'legacy'];
    var uidSeq = 0;

    var CSS = [
      '.fw-root{--fw-bg:var(--bg,#f7f3e8);--fw-card:var(--card,#fff);--fw-ink:var(--ink,#222);--fw-muted:var(--muted,#6b6b6b);',
      '--fw-line:var(--line,#ddd6c4);--fw-accent:var(--primary,#2f6f3e);--fw-gold:#e7b53c;--fw-radius:16px;--fw-font:inherit;',
      'font-family:var(--fw-font);color:var(--fw-ink);line-height:1.4;font-size:17px;box-sizing:border-box;-webkit-text-size-adjust:100%}',
      '.fw-root *,.fw-root *::before,.fw-root *::after{box-sizing:border-box}',
      '.fw-page{max-width:680px;margin:0 auto;padding:12px 16px 24px;background:var(--fw-bg);border-radius:var(--fw-radius)}',
      '.fw-page-wide{max-width:960px}',
      '.fw-card{background:var(--fw-card);border:1px solid var(--fw-line);border-radius:var(--fw-radius);padding:16px;margin:0 0 14px}',
      '.fw-h2{font-size:20px;margin:0 0 10px;font-weight:700}',
      '.fw-h3{font-size:16px;margin:12px 0 8px;font-weight:700;color:var(--fw-muted)}',
      '.fw-muted{color:var(--fw-muted)}',
      '.fw-small{font-size:14px}',
      '.fw-note{margin:0 0 12px;padding:12px 14px;border-radius:12px;background:var(--fw-card);border:1px dashed var(--fw-gold)}',
      '.fw-line{margin:8px 0 0;color:var(--fw-muted)}',
      '.fw-ok{color:var(--fw-accent);font-weight:600}',
      '.fw-err{color:#a33a2a;font-weight:600}',
      '.fw-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;min-width:44px;padding:8px 16px;',
      'border-radius:12px;border:2px solid var(--fw-line);background:var(--fw-card);color:var(--fw-ink);font:inherit;font-weight:600;',
      'cursor:pointer;text-decoration:none;touch-action:manipulation;-webkit-tap-highlight-color:transparent;',
      'transition:background-color .15s ease,border-color .15s ease}',
      '.fw-btn:hover:not(:disabled){border-color:var(--fw-accent)}',
      '.fw-btn:focus-visible{outline:3px solid var(--fw-gold);outline-offset:2px}',
      '.fw-btn:disabled{opacity:.55;cursor:default}',
      '.fw-btn-primary{background:var(--fw-accent);border-color:var(--fw-accent);color:#fff}',
      '.fw-btn-primary:hover:not(:disabled){filter:brightness(1.08)}',
      '.fw-btn-big{width:100%;min-height:56px;font-size:19px}',
      '.fw-btn-quiet{border-color:transparent;background:transparent}',
      '.fw-btn[aria-pressed=true],.fw-tab[aria-selected=true]{background:var(--fw-ink);border-color:var(--fw-ink);color:var(--fw-card)}',
      '.fw-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
      '.fw-tabs{display:flex;gap:8px;margin:0 0 14px}',
      '.fw-tab{flex:1 1 0}',
      '.fw-chips{display:flex;gap:8px;overflow-x:auto;padding:2px 2px 8px;margin:0 0 8px;-webkit-overflow-scrolling:touch;scrollbar-width:thin}',
      '.fw-chip{flex:0 0 auto;border-radius:999px}',
      '.fw-tri-wrap{display:flex;flex-direction:column;align-items:center;text-align:center}',
      '.fw-tri{max-width:90%;height:auto}',
      '.fw-tri-label{margin:10px 0 0;font-weight:600}',
      '.fw-tri-full{stroke:var(--fw-gold)}',
      '.fw-big-num{font-size:32px;font-weight:800;line-height:1}',
      '.fw-rupee-row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}',
      '.fw-today{display:grid;grid-template-columns:repeat(auto-fit,minmax(78px,1fr));gap:8px}',
      '.fw-today-col{border-top:4px solid var(--fw-line);background:var(--fw-bg);border-radius:10px;padding:8px;text-align:center;font-size:15px}',
      '.fw-today-col b{display:block;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.fw-bar{height:12px;border-radius:999px;background:var(--fw-line);overflow:hidden;margin-top:6px}',
      '.fw-bar>span{display:block;height:100%;background:var(--fw-gold);border-radius:999px}',
      '.fw-ticket{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px;border:2px solid var(--fw-line);border-radius:14px;margin:0 0 10px;background:var(--fw-card)}',
      '.fw-ticket-big{border-color:var(--fw-gold);border-style:dashed;padding:20px;flex-direction:column;text-align:center}',
      '.fw-ticket-used{opacity:.7}',
      '.fw-ticket-emoji{font-size:30px;line-height:1}',
      '.fw-ticket-big .fw-ticket-emoji{font-size:56px}',
      '.fw-ticket-body{flex:1 1 180px;min-width:0}',
      '.fw-reward-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}',
      '.fw-reward{flex-direction:column;min-height:120px;padding:14px;text-align:center;white-space:normal}',
      '.fw-reward .fw-ticket-emoji{font-size:40px}',
      '.fw-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}',
      '.fw-item{display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px;padding:14px 10px;',
      'background:var(--fw-card);border:1px solid var(--fw-line);border-radius:var(--fw-radius);min-width:0}',
      '.fw-item-featured{border:3px solid var(--fw-gold);flex-direction:row;text-align:left;gap:14px;flex-wrap:wrap;margin:0 0 14px}',
      '.fw-item-featured .fw-item-body{flex:1 1 180px}',
      '.fw-item-name{font-weight:700;overflow-wrap:anywhere}',
      '.fw-item .fw-btn{width:100%}',
      '.fw-item-featured .fw-btn{width:auto;min-width:120px}',
      '.fw-badge{display:inline-block;font-size:13px;font-weight:700;padding:2px 10px;border-radius:999px;background:var(--fw-gold);color:#222}',
      '.fw-vis{display:flex;align-items:center;justify-content:center;width:72px;height:72px;border-radius:50%;background:var(--fw-bg);',
      'border:1px solid var(--fw-line);font-size:38px;line-height:1;overflow:hidden;flex:0 0 auto}',
      '.fw-vis img{width:100%;height:100%;object-fit:cover}',
      '.fw-vis-s{width:40px;height:40px;font-size:22px}',
      '.fw-price{display:inline-flex;align-items:center;gap:4px;font-weight:600}',
      '.fw-confirm{width:100%;display:flex;flex-direction:column;gap:6px}',
      '.fw-pin{font-size:14px;min-height:44px;padding:6px 10px}',
      '.fw-shelf{display:flex;flex-wrap:wrap;gap:12px;padding:12px;border-bottom:6px solid var(--fw-line);border-radius:12px;background:var(--fw-bg)}',
      '.fw-shelf .fw-item{width:140px}',
      '.fw-goal{display:flex;align-items:center;gap:12px;width:100%;min-height:56px;padding:8px 14px;text-align:left;justify-content:flex-start}',
      '.fw-goal-body{flex:1 1 auto;min-width:0}',
      '.fw-goal-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.fw-counter{border-radius:999px;padding:4px 12px;gap:8px;font-size:15px}',
      '.fw-counter.fw-ready{box-shadow:0 0 0 3px var(--fw-gold)}',
      '.fw-count{display:inline-flex;align-items:center;gap:3px;font-variant-numeric:tabular-nums}',
      '.fw-dot{display:inline-block;width:9px;height:9px;border-radius:50%}',
      '.fw-check{font-weight:600;gap:8px}.fw-check input{width:22px;height:22px;margin:0;accent-color:var(--fw-accent)}',
      '.fw-field{display:flex;flex-direction:column;gap:4px;font-size:15px;font-weight:600}',
      '.fw-fields{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;margin:0 0 12px}',
      '.fw-input{font:inherit;font-weight:400;min-height:44px;padding:8px 10px;border:2px solid var(--fw-line);border-radius:10px;background:var(--fw-card);color:var(--fw-ink);width:100%}',
      '.fw-input:focus-visible{outline:3px solid var(--fw-gold);outline-offset:1px}',
      '.fw-rw-row{display:grid;grid-template-columns:64px 1fr 84px auto;gap:8px;align-items:center;margin:0 0 8px}',
      '.fw-ev{display:grid;grid-template-columns:1fr auto;gap:2px 10px;padding:8px 0;border-bottom:1px solid var(--fw-line);font-size:15px}',
      '.fw-ev-amt{font-weight:700;font-variant-numeric:tabular-nums;text-align:right}',
      '.fw-ev-reason{grid-column:1/-1;color:var(--fw-muted)}',
      '.fw-table{width:100%;border-collapse:collapse;font-size:15px;font-variant-numeric:tabular-nums}',
      '.fw-table th,.fw-table td{padding:8px 6px;border-bottom:1px solid var(--fw-line);text-align:right}',
      '.fw-table th:first-child,.fw-table td:first-child{text-align:left}',
      '@media (max-width:480px){.fw-page{padding:10px 10px 20px}.fw-card{padding:12px}.fw-rw-row{grid-template-columns:56px 1fr 72px}',
      '.fw-rw-row .fw-btn{grid-column:1/-1}.fw-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.fw-shelf .fw-item{width:calc(50% - 6px)}}',
      '@media (prefers-reduced-motion:reduce){.fw-root *,.fw-root{transition:none!important;animation:none!important;scroll-behavior:auto!important}}'
    ].join('\n');

    // ---------- helpers ----------
    function injectCSS() {
      var st = document.getElementById('fw-style');
      if (!st) {
        st = document.createElement('style');
        st.id = 'fw-style';
        (document.head || document.documentElement).appendChild(st);
      }
      if (st.textContent !== CSS) st.textContent = CSS;
    }

    function add(e, kids) {
      if (kids == null || kids === false) return;
      if (Array.isArray(kids)) { for (var i = 0; i < kids.length; i++) add(e, kids[i]); return; }
      e.appendChild(typeof kids === 'object' ? kids : document.createTextNode(String(kids)));
    }

    function h(tag, props, kids) {
      var e = document.createElement(tag);
      if (props) {
        for (var k in props) {
          if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
          var v = props[k];
          if (v == null || v === false) continue;
          if (k === 'class') e.className = v;
          else if (k === 'text') e.textContent = v;
          else if (k === 'key') e.setAttribute('data-fw-key', v);
          else if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2), v);
          else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') e[k] = v;
          else e.setAttribute(k, v === true ? '' : String(v));
        }
      }
      add(e, kids);
      return e;
    }

    var SVGNS = 'http://www.w3.org/2000/svg';
    function s(tag, attrs, kids) {
      var e = document.createElementNS(SVGNS, tag);
      for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, String(attrs[k]));
      if (kids) for (var i = 0; i < kids.length; i++) if (kids[i]) e.appendChild(kids[i]);
      return e;
    }

    function btn(label, onClick, opts) {
      opts = opts || {};
      return h(opts.href ? 'a' : 'button', {
        'class': 'fw-btn' + (opts.cls ? ' ' + opts.cls : ''),
        type: opts.href ? null : 'button',
        href: opts.href || null,
        disabled: !!opts.disabled,
        'aria-pressed': opts.pressed == null ? null : String(!!opts.pressed),
        'aria-label': opts.label || null,
        key: opts.key || null,
        onclick: onClick || null
      }, label);
    }

    function names(skin) { return FW.names(skin || 'hyrule') || {}; }
    function info(app) { return (FW.APP_INFO && FW.APP_INFO[app]) || { name: app, color: '#888' }; }
    function appName(app) { return app && FW.APP_INFO && FW.APP_INFO[app] ? FW.APP_INFO[app].name : app ? 'All apps' : '\u2014'; }
    function shardName(n, app) { return (n.shard && n.shard[app]) || app; }
    function rupeeWord(n, count) { return count === 1 ? (n.rupee || 'rupee') : (n.rupees || 'rupees'); }
    function triWord(n, count) {
      var w = n.triforce || 'Triforce';
      return count === 1 ? w : (n.triforces || w + 's');
    }
    function affordableText(n, name) {
      var t = n.affordable;
      if (typeof t === 'function') return t(name);
      if (typeof t === 'string' && t.indexOf('{name}') >= 0) return t.replace('{name}', name);
      if (typeof t === 'string' && t) return /[!.?]$/.test(t) ? t + ' ' + name : t + ' ' + name + '!';
      return 'You can afford ' + name + '!';
    }
    function itemName(item, skin) { return FW.itemName(item, skin) || item.id; }
    function fmtTime(at) {
      var d = new Date(at);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    }
    function fmtDate(at) {
      var d = new Date(at);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
    function signed(n) { n = Number(n) || 0; return (n > 0 ? '+' : n < 0 ? '\u2212' : '') + Math.abs(n); }
    function clampInt(v, lo, hi, dflt) {
      var n = parseInt(v, 10);
      if (isNaN(n)) n = dflt;
      return Math.max(lo, Math.min(hi, n));
    }
    function owns(inv, id) { return (inv.owned || []).indexOf(id) >= 0; }

    function visual(item, imageFor, small) {
      var box = h('span', { 'class': 'fw-vis' + (small ? ' fw-vis-s' : ''), 'aria-hidden': 'true' });
      var url = null;
      if (item && item.image && typeof imageFor === 'function') {
        try { url = imageFor(item.image); } catch (e) { url = null; }
      }
      if (url) {
        var img = h('img', { src: url, alt: '', loading: 'lazy', decoding: 'async' });
        img.addEventListener('error', function () { box.textContent = (item && item.emoji) || '\u2B50'; });
        box.appendChild(img);
      } else {
        box.textContent = (item && item.emoji) || '\u2B50';
      }
      return box;
    }

    function rupeeIcon(size) {
      size = size || 16;
      return s('svg', { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' }, [
        s('polygon', { points: '8,1 13,5 13,11 8,15 3,11 3,5', fill: '#3fae5a', stroke: '#1f6e33', 'stroke-width': '1.2' }),
        s('polygon', { points: '8,4 10.5,6 10.5,10 8,12 5.5,10 5.5,6', fill: '#8fe3a1', opacity: '.8' })
      ]);
    }

    // Apps that count toward a reward (the parent's set); falls back to every app.
    function inSet() {
      var set = typeof FW.appsInSet === 'function' ? FW.appsInSet() : null;
      if (!set || !set.length) set = FW.APPS.slice();
      return FW.APPS.filter(function (a) { return set.indexOf(a) >= 0; });
    }
    function isNewApp(a) { return typeof FW.isNew === 'function' ? !!FW.isNew(a) : false; }

    // Fill fraction (0..1) per app in the set, plus label text.
    function triState(n) {
      var b = FW.balance() || {};
      var st = FW.settings() || {};
      var apps = inSet();
      var fr = {}, parts = [];
      if (st.mode === 'any') {
        var total = 0;
        apps.forEach(function (a) { total += Number(b[a]) || 0; });
        var cost = Math.max(1, Number(st.anyCost) || 1);
        var f = Math.min(total, cost) / cost;
        apps.forEach(function (a) { fr[a] = f; });
        return { fr: fr, apps: apps, label: total + '/' + cost + ' \u2192 1 ' + (n.triforceShort || triWord(n, 1)), any: true, total: total, cost: cost, b: b };
      }
      apps.forEach(function (a) {
        var need = Math.max(0, Number(st.perApp && st.perApp[a]) || 0);
        var have = Number(b[a]) || 0;
        fr[a] = need > 0 ? Math.min(have, need) / need : 1;
        parts.push(shardName(n, a) + ' ' + (need > 0 ? have + '/' + need : '\u2713'));
      });
      return { fr: fr, apps: apps, label: parts.join(' \u00B7 '), any: false, b: b };
    }

    // The "full set": triangle apps form the Triforce, note apps add an ocarina note beside it.
    var TRI = [
      { pts: '50,2 27,42 73,42', top: 2, bot: 42 },
      { pts: '25,45.5 2,85 48,85', top: 45.5, bot: 85 },
      { pts: '75,45.5 52,85 98,85', top: 45.5, bot: 85 }
    ];
    function noteShapes(x, attrs) {
      // An eighth note, 40 wide, 85 tall, starting at x.
      function a(extra) { var o = {}; for (var k in attrs) o[k] = attrs[k]; for (k in extra) o[k] = extra[k]; return o; }
      return [
        s('ellipse', a({ cx: x + 14, cy: 72, rx: 12, ry: 9, transform: 'rotate(-20 ' + (x + 14) + ' 72)' })),
        s('rect', a({ x: x + 22, y: 8, width: 5, height: 64, rx: 2 })),
        s('path', a({ d: 'M' + (x + 22) + ' 8 C ' + (x + 34) + ' 14 ' + (x + 42) + ' 22 ' + (x + 36) + ' 40 C ' + (x + 36) + ' 30 ' + (x + 32) + ' 25 ' + (x + 24) + ' 22 Z' }))
      ];
    }
    function triforceSVG(fr, uid, cls, label, apps) {
      apps = apps || inSet();
      var kids = [];
      var defs = s('defs', {});
      kids.push(defs);
      var triApps = FW.APPS.filter(function (a) { return info(a).piece !== 'note'; });
      var extras = [];
      var x = 100;
      var idx = 0;
      function piece(a, drawBg, drawFill, top, bot) {
        var on = apps.indexOf(a) >= 0;
        var color = info(a).color || '#888';
        var f = on ? Math.max(0, Math.min(1, fr[a] || 0)) : 0;
        var id = uid + '-c' + (idx++);
        if (!on) { kids.push(drawBg({ fill: 'none', stroke: '#bbb', 'stroke-width': '1.5', 'stroke-dasharray': '3 3', opacity: '.6' })); return; }
        defs.appendChild(s('clipPath', { id: id }, [s('rect', { x: 0, y: top + (1 - f) * (bot - top), width: 400, height: 200 })]));
        kids.push(drawBg({ fill: color, 'fill-opacity': '.14', stroke: color, 'stroke-width': '2', 'stroke-linejoin': 'round' }));
        if (f > 0) kids.push(drawFill({ fill: color, 'clip-path': 'url(#' + id + ')' }));
        if (f >= 1) kids.push(drawBg({ fill: 'none', 'class': 'fw-tri-full', 'stroke-width': '3', 'stroke-linejoin': 'round' }));
      }
      triApps.forEach(function (a, i) {
        if (i < 3) {
          var t = TRI[i];
          var poly = function (at) { at.points = t.pts; return s('polygon', at); };
          piece(a, poly, poly, t.top, t.bot);
        } else if (apps.indexOf(a) >= 0) extras.push({ a: a, kind: 'tri' });
      });
      FW.APPS.forEach(function (a) { if (info(a).piece === 'note' && apps.indexOf(a) >= 0) extras.push({ a: a, kind: 'note' }); });
      extras.forEach(function (e) {
        var x0 = x + 8;
        if (e.kind === 'note') {
          var g = function (at) { return s('g', {}, noteShapes(x0, at)); };
          piece(e.a, g, g, 8, 81);
        } else {
          var pts = (x0 + 20) + ',45.5 ' + x0 + ',85 ' + (x0 + 40) + ',85';
          var poly = function (at) { at.points = pts; return s('polygon', at); };
          piece(e.a, poly, poly, 45.5, 85);
        }
        x += 48;
      });
      var attrs = { viewBox: '0 0 ' + x + ' 87', 'class': cls, focusable: 'false' };
      if (label) { attrs.role = 'img'; attrs['aria-label'] = label; } else attrs['aria-hidden'] = 'true';
      var svg = s('svg', attrs, kids);
      svg.setAttribute('data-w', String(x));
      return svg;
    }

    function listJoin(parts) {
      if (parts.length <= 1) return parts.join('');
      return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
    }
    function missingTotal(c) {
      var m = (c && c.missing) || {};
      var t = 0;
      for (var k in m) t += m[k] > 0 ? m[k] : 0;
      return t;
    }
    function missingText(n, c) {
      var m = (c && c.missing) || {};
      if (m.any != null) return m.any + ' more to go.';
      var parts = [];
      FW.APPS.forEach(function (a) { if (m[a] > 0) parts.push(m[a] + (parts.length ? ' ' : ' more ') + shardName(n, a)); });
      return parts.length ? 'You need ' + listJoin(parts) + '.' : '';
    }

    // Claim status across all rewards.
    function claimState(n) {
      var r = FW.rewards() || {};
      var list = r.list || [];
      if (!r.enabled) return { ok: false, line: 'Rewards are resting right now.', r: r };
      if (!list.length) return { ok: false, line: 'No rewards yet. Ask a grown-up to add one.', r: r };
      var checks = list.map(function (rw) { return { rw: rw, c: FW.canClaim(rw.id) || {} }; });
      for (var i = 0; i < checks.length; i++) if (checks[i].c.ok) return { ok: true, line: '', r: r, checks: checks };
      for (i = 0; i < checks.length; i++) if (checks[i].c.why === 'cap') return { ok: false, line: 'That is all for this week. New rewards next week!', r: r, checks: checks };
      for (i = 0; i < checks.length; i++) if (checks[i].c.why === 'off') return { ok: false, line: 'Rewards are resting right now.', r: r, checks: checks };
      var cheapest = checks.slice().sort(function (x, y) { return (x.rw.cost || 1) - (y.rw.cost || 1); })[0];
      return { ok: false, line: (missingTotal(cheapest.c) <= 3 ? 'Almost there! ' : 'Keep going! ') + missingText(n, cheapest.c), r: r, checks: checks };
    }

    // Shared mount scaffold: renders, re-renders on FW.onChange, keeps focus, cleans up.
    function makeMount(el, render, opts) {
      injectCSS();
      var root = h('div', { 'class': 'fw-root' + (opts && opts.cls ? ' ' + opts.cls : '') });
      el.appendChild(root);
      var dead = false;
      function update() {
        if (dead) return;
        var ae = document.activeElement;
        var key = ae && root.contains(ae) ? ae.getAttribute('data-fw-key') : null;
        var frag = document.createDocumentFragment();
        add(frag, render());
        while (root.firstChild) root.removeChild(root.firstChild);
        root.appendChild(frag);
        root.hidden = !root.firstChild;
        if (key) {
          var nx = root.querySelector('[data-fw-key="' + key.replace(/"/g, '') + '"]');
          if (nx && !nx.disabled) { try { nx.focus({ preventScroll: true }); } catch (e) { nx.focus(); } }
        }
      }
      var off = FW.onChange(function () { update(); });
      update();
      return {
        update: update,
        destroy: function () {
          if (dead) return;
          dead = true;
          if (typeof off === 'function') off();
          if (root.parentNode) root.parentNode.removeChild(root);
        },
        root: root
      };
    }

    // ---------- 1. Wallet ----------
    FW.mountWallet = function (el, o) {
      o = o || {};
      var app = o.app, skin = o.skin;
      var st = { tab: 'wallet', view: 'main', ticketId: null, approved: {}, busy: false, msg: '' };
      var secretsBox = null;
      var m;
      function go(patch) { for (var k in patch) st[k] = patch[k]; m.update(); }

      function approve(t) {
        if (st.busy || typeof o.pinCheck !== 'function') return;
        st.busy = true;
        var p;
        try { p = Promise.resolve(o.pinCheck()); } catch (e) { p = Promise.resolve(false); }
        p.then(function (ok) {
          st.busy = false;
          if (ok) { FW.markUsed(t.id); st.approved[t.id] = true; }
          m.update();
        }, function () { st.busy = false; m.update(); });
      }

      function approveArea(t) {
        if (t.status === 'used') return st.approved[t.id] ? h('p', { 'class': 'fw-ok', text: 'Approved. Have fun!' }) : h('span', { 'class': 'fw-muted', text: 'Used \u2713' });
        if (typeof o.pinCheck !== 'function') return null;
        return btn('Grown-up: approve', function () { approve(t); }, { key: 'approve-' + t.id, disabled: st.busy });
      }

      function ticketCard(t, big, n) {
        var line2 = 'earned in ' + appName(t.app) + (t.status === 'used' ? '' : ' \u00B7 ' + (n.showGrownUp || 'Show a grown-up!'));
        return h('div', { 'class': 'fw-ticket' + (big ? ' fw-ticket-big' : '') + (t.status === 'used' ? ' fw-ticket-used' : ''), 'data-ticket': t.id }, [
          h('span', { 'class': 'fw-ticket-emoji', 'aria-hidden': 'true', text: t.emoji || '\uD83C\uDF9F\uFE0F' }),
          h('div', { 'class': 'fw-ticket-body' }, [
            h('div', { 'class': 'fw-item-name', text: t.rewardText || '' }),
            h('div', { 'class': 'fw-muted fw-small', text: line2 })
          ]),
          approveArea(t)
        ]);
      }

      function viewPick(n) {
        var cs = claimState(n);
        var r = cs.r;
        return [
          h('div', { 'class': 'fw-row', style: 'margin-bottom:12px' }, [btn('\u2190 Back', function () { go({ view: 'main', msg: '' }); }, { cls: 'fw-btn-quiet', key: 'back' })]),
          h('h2', { 'class': 'fw-h2', text: n.claim || 'Claim a reward' }),
          h('div', { 'class': 'fw-reward-list' }, (r.list || []).map(function (rw) {
            var c = FW.canClaim(rw.id) || {};
            var cost = rw.cost || 1;
            return h('button', {
              type: 'button', 'class': 'fw-btn fw-reward', disabled: !c.ok, key: 'rw-' + rw.id, 'data-reward': rw.id,
              onclick: function () {
                var t = FW.claim(rw.id, app);
                if (t) go({ view: 'ticket', ticketId: t.id, msg: '' });
                else go({ msg: 'Not enough yet.' });
              }
            }, [
              h('span', { 'class': 'fw-ticket-emoji', 'aria-hidden': 'true', text: rw.emoji || '\uD83C\uDF81' }),
              h('span', { text: rw.text }),
              h('span', { 'class': 'fw-muted fw-small', text: cost + ' ' + triWord(n, cost) + (c.ok ? '' : c.why === 'short' ? ' \u00B7 ' + missingText(n, c) : '') })
            ]);
          })),
          st.msg ? h('p', { 'class': 'fw-line', text: st.msg }) : null
        ];
      }

      function viewTicket(n) {
        var t = (FW.tickets() || []).filter(function (x) { return x.id === st.ticketId; })[0];
        if (!t) { st.view = 'main'; return viewMain(n); }
        return [
          h('h2', { 'class': 'fw-h2', text: n.ticket || 'Ticket' }),
          ticketCard(t, true, n),
          h('div', { 'class': 'fw-row' }, [btn('Done', function () { go({ view: 'main' }); }, { cls: t.status === 'used' ? 'fw-btn-primary fw-btn-big' : 'fw-btn-quiet', key: 'done' })])
        ];
      }

      function viewMain(n) {
        var ts = triState(n);
        var b = ts.b;
        var out = [];
        // The full set
        var svg = triforceSVG(ts.fr, m.uid, 'fw-tri', (n.triforce || 'Triforce') + ': ' + ts.label, ts.apps);
        var w = Number(svg.getAttribute('data-w')) || 100;
        svg.setAttribute('width', String(Math.round(w * 1.9)));
        svg.setAttribute('height', String(Math.round(87 * 1.9)));
        out.push(h('section', { 'class': 'fw-card fw-tri-wrap' }, [
          svg,
          h('p', { 'class': 'fw-tri-label', text: ts.label }),
          ts.any ? h('p', { 'class': 'fw-muted fw-small', style: 'margin:4px 0 0', text: ts.apps.map(function (a) { return shardName(n, a) + ' ' + (b[a] || 0); }).join(' \u00B7 ') }) : null
        ]));
        // Hint (and "New" cards for apps in the set that have never earned anything)
        var low = FW.lowest(skin);
        var lowNew = low && (low.isNew || isNewApp(low.app));
        // one calm card: the apps in the set he has not tried yet (or the hint for the one furthest behind),
        // with a button for every other app
        var fresh = ts.apps.filter(function (a) { return a !== app && isNewApp(a); });
        var others = FW.APPS.filter(function (a) { return a !== app; });
        var lead = fresh.length ? 'New: ' + listJoin(fresh.map(appName)) + '!' : low && low.text && low.app !== app ? low.text : others.length ? 'Visit your other apps:' : '';
        if (lead) {
          out.push(h('section', { 'class': 'fw-card fw-hint' + (fresh.length ? ' fw-new' : ''), 'data-new': fresh.length ? fresh.join(' ') : null }, [
            h('p', { style: 'margin:0 0 10px' + (fresh.length ? ';font-weight:700' : ''), text: lead }),
            h('div', { 'class': 'fw-row' }, others.map(function (a) {
              var strong = fresh.indexOf(a) >= 0 || (!fresh.length && low && low.app === a);
              return btn(appName(a), null, { href: info(a).path, cls: strong ? 'fw-btn-primary' : '' });
            }))
          ]));
        }
        // Rupees + goal
        var gp = FW.goalProgress(app);
        out.push(h('section', { 'class': 'fw-card' }, [
          h('div', { 'class': 'fw-rupee-row' }, [
            h('div', { 'class': 'fw-row' }, [rupeeIcon(28), h('span', { 'class': 'fw-big-num', text: String(b.rupees || 0) }), h('span', { 'class': 'fw-muted', text: rupeeWord(n, b.rupees) })]),
            typeof o.onOpenMarket === 'function' ? btn(n.market || 'Market', function () { o.onOpenMarket(); }, { key: 'open-market' }) : null
          ]),
          gp && gp.item ? h('div', { style: 'margin-top:12px' }, [
            h('div', { 'class': 'fw-small' }, [(n.goal || 'Goal') + ': ', h('b', { text: itemName(gp.item, skin) }), ' \u00B7 ' + gp.have + '/' + gp.price]),
            h('div', { 'class': 'fw-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(gp.price), 'aria-valuenow': String(Math.min(gp.have, gp.price)) }, [h('span', { style: 'width:' + Math.max(0, Math.min(100, gp.pct || 0)) + '%' })])
          ]) : null
        ]));
        // Today
        var td = FW.today() || {};
        out.push(h('section', { 'class': 'fw-card' }, [
          h('h2', { 'class': 'fw-h2', text: 'Today' }),
          h('div', { 'class': 'fw-today' }, FW.APPS.map(function (a) {
            var d = td[a] || {};
            return h('div', { 'class': 'fw-today-col', style: 'border-top-color:' + info(a).color }, [
              h('b', { text: appName(a) }),
              h('div', { text: (d.minutes || 0) + ' min' }),
              h('div', { text: (d.shards || 0) + ' ' + shardName(n, a) })
            ]);
          }))
        ]));
        // Claim
        var cs = claimState(n);
        out.push(h('section', { 'class': 'fw-card' }, [
          btn(n.claim || 'Claim a reward', function () { go({ view: 'pick', msg: '' }); }, { cls: 'fw-btn-primary fw-btn-big', disabled: !cs.ok, key: 'claim' }),
          cs.line ? h('p', { 'class': 'fw-line', text: cs.line }) : null
        ]));
        // My tickets
        var all = FW.tickets() || [];
        var earned = all.filter(function (t) { return t.status !== 'used'; });
        var used = all.filter(function (t) { return t.status === 'used'; }).slice(0, 3);
        out.push(h('section', { 'class': 'fw-card' }, [
          h('h2', { 'class': 'fw-h2', text: 'My tickets' }),
          earned.length || used.length ? earned.concat(used).map(function (t) { return ticketCard(t, false, n); }) : h('p', { 'class': 'fw-muted', style: 'margin:0', text: 'No tickets yet.' })
        ]));
        return out;
      }

      function render() {
        var n = names(skin);
        var hasSecrets = typeof o.renderSecrets === 'function';
        if (!hasSecrets) st.tab = 'wallet';
        var out = [];
        if (hasSecrets) {
          out.push(h('div', { 'class': 'fw-tabs', role: 'tablist' }, [
            h('button', { type: 'button', role: 'tab', 'class': 'fw-btn fw-tab', 'aria-selected': String(st.tab === 'wallet'), key: 'tab-wallet', onclick: function () { go({ tab: 'wallet' }); } }, n.wallet || 'Wallet'),
            h('button', {
              type: 'button', role: 'tab', 'class': 'fw-btn fw-tab', 'aria-selected': String(st.tab === 'secrets'), key: 'tab-secrets',
              onclick: function () {
                if (st.tab === 'secrets') return;
                secretsBox = h('div', { 'class': 'fw-secrets' });
                o.renderSecrets(secretsBox);
                go({ tab: 'secrets' });
              }
            }, n.secrets || 'Secrets')
          ]));
        }
        if (st.tab === 'secrets' && secretsBox) out.push(secretsBox);
        else if (st.view === 'pick') out.push(viewPick(n));
        else if (st.view === 'ticket') out.push(viewTicket(n));
        else out.push(viewMain(n));
        return h('div', { 'class': 'fw-page fw-wallet' }, out);
      }

      m = { uid: 'fw' + (++uidSeq) };
      var base = makeMount(el, render);
      m.update = base.update;
      return { update: base.update, destroy: base.destroy };
    };

    // ---------- 2. Market + Room ----------
    FW.mountMarket = function (el, o) {
      o = o || {};
      var app = o.app, skin = o.skin, imageFor = o.imageFor;
      var st = { tab: 'market', cat: null, confirm: null, msg: null };
      var base;
      function go(patch) { for (var k in patch) st[k] = patch[k]; base.update(); }

      function priceTag(n, price) {
        return h('span', { 'class': 'fw-price' }, [rupeeIcon(16), String(price), h('span', { 'class': 'fw-muted fw-small', text: rupeeWord(n, price) })]);
      }

      function actions(item, n, inv, b) {
        var name = itemName(item, skin);
        var owned = owns(inv, item.id);
        var eq = inv.equipped || {};
        if (st.confirm === item.id && !owned) {
          return h('div', { 'class': 'fw-confirm' }, [
            h('p', { style: 'margin:0', text: 'Buy ' + name + ' for ' + item.price + ' ' + rupeeWord(n, item.price) + '?' }),
            btn('Yes', function () {
              var r = FW.buy(item.id) || {};
              if (r.ok) {
                if (inv.goal === item.id) FW.setGoal(null);
                go({ confirm: null, msg: { ok: true, text: 'It is yours: ' + name + '!' } });
              } else {
                go({ confirm: null, msg: { ok: false, text: r.why === 'short' ? 'Not enough ' + rupeeWord(n, 2) + ' yet.' : r.why === 'owned' ? 'You already have it.' : 'That item is not here.' } });
              }
            }, { cls: 'fw-btn-primary', key: 'yes-' + item.id }),
            btn('Not now', function () { go({ confirm: null }); }, { key: 'no-' + item.id })
          ]);
        }
        var main;
        if (owned) {
          if (item.slot) {
            var on = eq[item.slot] === item.id;
            main = on ? btn('Equipped', null, { disabled: true, pressed: true, key: 'eq-' + item.id })
              : btn('Equip', function () { FW.equip(item.slot, item.id); base.update(); }, { key: 'eq-' + item.id });
          } else main = btn('Owned', null, { disabled: true, key: 'own-' + item.id });
          return main;
        }
        var short = (item.price || 0) - (b.rupees || 0);
        main = short > 0 ? btn(short + ' more', null, { disabled: true, key: 'buy-' + item.id, label: 'Buy ' + name + ': ' + short + ' more ' + rupeeWord(n, short) + ' needed' })
          : btn('Buy', function () { go({ confirm: item.id, msg: null }); }, { cls: 'fw-btn-primary', key: 'buy-' + item.id, label: 'Buy ' + name });
        var pinned = inv.goal === item.id;
        var pin = btn(pinned ? '\uD83D\uDCCC Saving for this' : '\uD83D\uDCCC Save for this', function () { FW.setGoal(pinned ? null : item.id); base.update(); },
          { cls: 'fw-btn-quiet fw-pin', pressed: pinned, key: 'pin-' + item.id });
        return [main, pin];
      }

      function card(item, n, inv, b, featured) {
        var body = [
          featured ? h('span', { 'class': 'fw-badge', text: 'New this week' }) : null,
          h('div', { 'class': 'fw-item-name', text: itemName(item, skin) }),
          h('div', { 'class': 'fw-muted fw-small fw-item-cat', text: FW.catName(item.cat, skin) }),
          priceTag(n, item.price)
        ];
        if (featured) {
          return h('div', { 'class': 'fw-item fw-item-featured', 'data-item': item.id }, [
            visual(item, imageFor),
            h('div', { 'class': 'fw-item-body' }, [body, h('div', { 'class': 'fw-row', style: 'margin-top:8px' }, actions(item, n, inv, b))])
          ]);
        }
        return h('div', { 'class': 'fw-item', 'data-item': item.id }, [visual(item, imageFor), body, actions(item, n, inv, b)]);
      }

      function viewMarket(n) {
        var b = FW.balance() || {};
        var inv = FW.inventory() || {};
        var items = FW.catalog(app) || [];
        var weekly = FW.weeklyItem(app);
        var aff = FW.affordable(app);
        var cats = [];
        CAT_ORDER.concat(items.map(function (i) { return i.cat; })).forEach(function (c) {
          if (cats.indexOf(c) < 0 && items.some(function (i) { return i.cat === c; })) cats.push(c);
        });
        // A long catalog opens on its first category so the page stays short; "All" is one tap away.
        if (st.cat == null) st.cat = items.length > 16 && cats.length ? cats[0] : 'all';
        if (st.cat !== 'all' && cats.indexOf(st.cat) < 0) st.cat = 'all';
        var shown = items.filter(function (i) { return (!weekly || i.id !== weekly.id) && (st.cat === 'all' || i.cat === st.cat); });
        return [
          h('div', { 'class': 'fw-row', style: 'justify-content:space-between;margin:0 0 10px' }, [
            h('h2', { 'class': 'fw-h2', style: 'margin:0', text: n.market || 'Market' }),
            h('span', { 'class': 'fw-price', 'aria-label': (b.rupees || 0) + ' ' + rupeeWord(n, b.rupees) }, [rupeeIcon(20), h('b', { text: String(b.rupees || 0) })])
          ]),
          st.msg ? h('p', { 'class': 'fw-note ' + (st.msg.ok ? 'fw-ok' : 'fw-err'), role: 'status', text: st.msg.text }) : null,
          aff ? h('p', { 'class': 'fw-note', text: affordableText(n, itemName(aff, skin)) }) : null,
          weekly ? card(weekly, n, inv, b, true) : null,
          h('div', { 'class': 'fw-chips', role: 'group', 'aria-label': 'Categories' }, [
            btn('All', function () { go({ cat: 'all' }); }, { cls: 'fw-chip', pressed: st.cat === 'all', key: 'cat-all' })
          ].concat(cats.map(function (c) {
            return btn(FW.catName(c, skin), function () { go({ cat: c }); }, { cls: 'fw-chip', pressed: st.cat === c, key: 'cat-' + c });
          }))),
          shown.length ? h('div', { 'class': 'fw-grid' }, shown.map(function (i) { return card(i, n, inv, b, false); }))
            : h('p', { 'class': 'fw-muted', text: 'Nothing here yet.' })
        ];
      }

      function viewRoom(n) {
        var inv = FW.inventory() || {};
        var eq = inv.equipped || {};
        var items = (FW.catalog(app) || []).filter(function (i) { return owns(inv, i.id); });
        var out = [h('h2', { 'class': 'fw-h2', text: n.room || 'Room' })];
        if (!items.length) {
          out.push(h('div', { 'class': 'fw-card', style: 'text-align:center' }, [
            h('p', { style: 'margin:0 0 12px', text: 'Your room is waiting for its first treasure.' }),
            btn(n.market || 'Market', function () { go({ tab: 'market' }); }, { cls: 'fw-btn-primary', key: 'to-market' })
          ]));
          return out;
        }
        var cats = [];
        CAT_ORDER.concat(items.map(function (i) { return i.cat; })).forEach(function (c) {
          if (cats.indexOf(c) < 0 && items.some(function (i) { return i.cat === c; })) cats.push(c);
        });
        cats.forEach(function (c) {
          out.push(h('h3', { 'class': 'fw-h3', text: FW.catName(c, skin) }));
          out.push(h('div', { 'class': 'fw-shelf' }, items.filter(function (i) { return i.cat === c; }).map(function (i) {
            var on = i.slot && eq[i.slot] === i.id;
            return h('div', { 'class': 'fw-item', 'data-item': i.id }, [
              visual(i, imageFor),
              h('div', { 'class': 'fw-item-name', text: itemName(i, skin) }),
              on ? h('span', { 'class': 'fw-badge', text: 'Equipped' })
                : i.slot ? btn('Equip', function () { FW.equip(i.slot, i.id); base.update(); }, { key: 'req-' + i.id }) : null
            ]);
          })));
        });
        return out;
      }

      function render() {
        var n = names(skin);
        return h('div', { 'class': 'fw-page fw-page-wide fw-market' }, [
          h('div', { 'class': 'fw-tabs', role: 'tablist' }, [
            h('button', { type: 'button', role: 'tab', 'class': 'fw-btn fw-tab', 'aria-selected': String(st.tab === 'market'), key: 'tab-market', onclick: function () { go({ tab: 'market' }); } }, n.market || 'Market'),
            h('button', { type: 'button', role: 'tab', 'class': 'fw-btn fw-tab', 'aria-selected': String(st.tab === 'room'), key: 'tab-room', onclick: function () { go({ tab: 'room', confirm: null, msg: null }); } }, n.room || 'Room')
          ]),
          st.tab === 'room' ? viewRoom(n) : viewMarket(n)
        ]);
      }

      base = makeMount(el, render);
      return { update: base.update, destroy: base.destroy };
    };

    // ---------- 3. Parent corner ----------
    FW.mountParent = function (el, o) {
      o = o || {};
      var skin = o.skin;
      var st = { sd: null, rd: null, ledger: 'all', week: 0, adj: { app: FW.APPS[0], amount: '', reason: '' }, msg: {} };
      var base;
      function go(patch) { for (var k in patch) st[k] = patch[k]; base.update(); }

      function settingsDraft() {
        if (!st.sd) {
          var s0 = FW.settings() || {}, r0 = FW.rewards() || {};
          var pa = {};
          FW.APPS.forEach(function (a) { pa[a] = s0.perApp ? s0.perApp[a] : 0; });
          st.sd = { mode: s0.mode || 'balanced', perApp: pa, set: inSet(), minutesPerShard: s0.minutesPerShard, dailyTimeCap: s0.dailyTimeCap,
            comebackDailyCap: s0.comebackDailyCap, enabled: !!r0.enabled, weeklyCap: r0.weeklyCap };
        }
        return st.sd;
      }
      function rewardsDraft() {
        if (!st.rd) {
          var r0 = FW.rewards() || {};
          st.rd = { list: (r0.list || []).map(function (r) { return { id: r.id, emoji: r.emoji || '', text: r.text || '', cost: r.cost || 1 }; }) };
        }
        return st.rd;
      }

      function numField(label, obj, key, lo, hi, fkey) {
        return h('label', { 'class': 'fw-field' }, [
          label + ' (' + lo + '\u2013' + hi + ')',
          h('input', {
            'class': 'fw-input', type: 'number', inputmode: 'numeric', min: lo, max: hi, step: 1, value: obj[key] == null ? '' : String(obj[key]),
            key: fkey, name: fkey, oninput: function (e) { obj[key] = e.target.value; }
          })
        ]);
      }

      function secSettings(n) {
        var d = settingsDraft();
        return h('section', { 'class': 'fw-card', 'data-sec': 'settings' }, [
          h('h2', { 'class': 'fw-h2', text: 'Settings' }),
          h('div', { 'class': 'fw-row', role: 'group', 'aria-label': 'Mode', style: 'margin:0 0 12px' }, [
            btn('Balanced', function () { d.mode = 'balanced'; base.update(); }, { pressed: d.mode !== 'any', key: 'mode-balanced' }),
            btn('Any app', function () { d.mode = 'any'; base.update(); }, { pressed: d.mode === 'any', key: 'mode-any' })
          ]),
          h('p', { 'class': 'fw-muted fw-small', style: 'margin:0 0 10px', text: d.mode === 'any'
            ? 'Any mix of shards from any app makes one ' + (n.triforce || 'Triforce') + '.'
            : 'Each app gives its own piece of the ' + (n.triforce || 'Triforce') + '.' }),
          h('h3', { 'class': 'fw-h3', text: 'Apps in the set' }),
          h('div', { 'class': 'fw-row', role: 'group', 'aria-label': 'Apps in the set', style: 'margin:0 0 12px' }, FW.APPS.map(function (a) {
            var on = d.set.indexOf(a) >= 0;
            return h('label', { 'class': 'fw-btn fw-check', 'data-app': a }, [
              h('input', { type: 'checkbox', checked: on, disabled: on && d.set.length <= 1, key: 'set-' + a, name: 'set-' + a,
                onchange: function (e) {
                  if (e.target.checked) { if (d.set.indexOf(a) < 0) d.set.push(a); }
                  else if (d.set.length > 1) d.set = d.set.filter(function (x) { return x !== a; });
                  d.set = FW.APPS.filter(function (x) { return d.set.indexOf(x) >= 0; });
                  base.update();
                } }),
              h('span', { 'class': 'fw-dot', style: 'background:' + info(a).color }),
              appName(a)
            ]);
          })),
          d.mode === 'any' ? h('p', { 'class': 'fw-small fw-any-cost', style: 'margin:0 0 12px' }, ['Cost of one ' + (n.triforce || 'Triforce') + ': ',
            h('b', { text: String((FW.settings() || {}).anyCost) }), ' shards (set by the apps in the set).']) : null,
          h('div', { 'class': 'fw-fields' }, (d.mode === 'any' ? [] : FW.APPS.filter(function (a) { return d.set.indexOf(a) >= 0; }).map(function (a) {
            return numField(appName(a) + ' \u00B7 ' + shardName(n, a), d.perApp, a, 0, 10, 'per-' + a);
          })).concat([
            numField('Minutes per shard', d, 'minutesPerShard', 1, 60, 'minutesPerShard'),
            numField('Daily time cap', d, 'dailyTimeCap', 0, 24, 'dailyTimeCap'),
            numField('Comeback daily cap', d, 'comebackDailyCap', 0, 10, 'comebackDailyCap'),
            numField('Weekly ticket cap', d, 'weeklyCap', 0, 14, 'weeklyCap')
          ])),
          h('div', { 'class': 'fw-row', style: 'margin:0 0 12px' }, [
            btn(d.enabled ? 'Reward tickets: on' : 'Reward tickets: off', function () { d.enabled = !d.enabled; base.update(); }, { pressed: d.enabled, key: 'tickets-on' })
          ]),
          h('div', { 'class': 'fw-row' }, [
            btn('Save', function () {
              var pa = {};
              FW.APPS.forEach(function (a) { pa[a] = clampInt(d.perApp[a], 0, 10, 0); });
              FW.setSettings({ mode: d.mode === 'any' ? 'any' : 'balanced', perApp: pa, appsInSet: d.set.length ? d.set.slice() : FW.APPS.slice(),
                minutesPerShard: clampInt(d.minutesPerShard, 1, 60, 1), dailyTimeCap: clampInt(d.dailyTimeCap, 0, 24, 0),
                comebackDailyCap: clampInt(d.comebackDailyCap, 0, 10, 0) });
              var cur = FW.rewards() || {};
              FW.saveRewards({ enabled: !!d.enabled, weeklyCap: clampInt(d.weeklyCap, 0, 14, 0), list: cur.list || [] });
              st.msg.settings = 'Saved.';
              go({ sd: null });
            }, { cls: 'fw-btn-primary', key: 'save-settings' }),
            st.msg.settings ? h('span', { 'class': 'fw-ok', role: 'status', text: st.msg.settings }) : null
          ])
        ]);
      }

      function secRewards(n) {
        var d = rewardsDraft();
        return h('section', { 'class': 'fw-card', 'data-sec': 'rewards' }, [
          h('h2', { 'class': 'fw-h2', text: 'Rewards' }),
          d.list.map(function (r, i) {
            return h('div', { 'class': 'fw-rw-row', 'data-row': String(i) }, [
              h('input', { 'class': 'fw-input', 'aria-label': 'Emoji', maxlength: 8, value: r.emoji, key: 'rw-emoji-' + i, oninput: function (e) { r.emoji = e.target.value; } }),
              h('input', { 'class': 'fw-input', 'aria-label': 'Reward', placeholder: 'Reward', maxlength: 80, value: r.text, key: 'rw-text-' + i, oninput: function (e) { r.text = e.target.value; } }),
              h('select', { 'class': 'fw-input', 'aria-label': 'Cost in ' + triWord(n, 2), key: 'rw-cost-' + i, onchange: function (e) { r.cost = clampInt(e.target.value, 1, 5, 1); } },
                [1, 2, 3, 4, 5].map(function (c) { return h('option', { value: String(c), selected: c === r.cost }, c + ' \u25B2'); })),
              btn('Remove', function () { d.list.splice(i, 1); base.update(); }, { key: 'rw-del-' + i })
            ]);
          }),
          h('p', { 'class': 'fw-muted fw-small', text: 'Cost is in ' + triWord(n, 2) + ' (\u25B2). Up to 8 rewards.' }),
          h('div', { 'class': 'fw-row' }, [
            btn('Add a reward', function () {
              d.list.push({ id: 'r' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), emoji: '\uD83C\uDF81', text: '', cost: 1 });
              base.update();
            }, { disabled: d.list.length >= 8, key: 'rw-add' }),
            btn('Save rewards', function () {
              var cur = FW.rewards() || {};
              var list = d.list.filter(function (r) { return String(r.text).trim(); }).slice(0, 8).map(function (r) {
                return { id: r.id, emoji: String(r.emoji).trim() || '\uD83C\uDF81', text: String(r.text).trim(), cost: clampInt(r.cost, 1, 5, 1) };
              });
              FW.saveRewards({ enabled: !!cur.enabled, weeklyCap: cur.weeklyCap, list: list });
              st.msg.rewards = 'Saved.';
              go({ rd: null });
            }, { cls: 'fw-btn-primary', key: 'rw-save' }),
            st.msg.rewards ? h('span', { 'class': 'fw-ok', role: 'status', text: st.msg.rewards }) : null
          ])
        ]);
      }

      function secLedger() {
        var evs = FW.events({ app: st.ledger === 'all' ? undefined : st.ledger, limit: 50 }) || [];
        return h('section', { 'class': 'fw-card', 'data-sec': 'ledger' }, [
          h('h2', { 'class': 'fw-h2', text: 'Ledger' }),
          h('div', { 'class': 'fw-chips', role: 'group', 'aria-label': 'Filter' }, [btn('All', function () { go({ ledger: 'all' }); }, { cls: 'fw-chip', pressed: st.ledger === 'all', key: 'lg-all' })]
            .concat(FW.APPS.map(function (a) { return btn(appName(a), function () { go({ ledger: a }); }, { cls: 'fw-chip', pressed: st.ledger === a, key: 'lg-' + a }); }))),
          evs.length ? h('div', { 'class': 'fw-ledger' }, evs.slice(0, 50).map(function (e) {
            return h('div', { 'class': 'fw-ev', 'data-ev': e.id }, [
              h('span', {}, [h('span', { 'class': 'fw-muted', text: fmtTime(e.at) }), ' \u00B7 ' + appName(e.app) + ' \u00B7 ', h('b', { text: e.kind })]),
              h('span', { 'class': 'fw-ev-amt', style: 'color:' + ((e.amount || 0) < 0 ? '#a33a2a' : 'var(--fw-accent)'), text: signed(e.amount) }),
              e.reason ? h('span', { 'class': 'fw-ev-reason', text: e.reason }) : null
            ]);
          })) : h('p', { 'class': 'fw-muted', style: 'margin:0', text: 'No events yet.' })
        ]);
      }

      function secWeekly() {
        var rep = FW.weeklyReport(st.week) || { apps: {} };
        return h('section', { 'class': 'fw-card', 'data-sec': 'weekly' }, [
          h('h2', { 'class': 'fw-h2', text: 'Weekly report' }),
          h('div', { 'class': 'fw-row', style: 'margin:0 0 8px' }, [
            btn('This week', function () { go({ week: 0 }); }, { pressed: st.week === 0, key: 'wk-0' }),
            btn('Last week', function () { go({ week: 1 }); }, { pressed: st.week === 1, key: 'wk-1' }),
            rep.from ? h('span', { 'class': 'fw-muted fw-small', text: fmtDate(rep.from) + ' \u2013 ' + fmtDate(rep.to) }) : null
          ]),
          h('table', { 'class': 'fw-table' }, [
            h('thead', {}, h('tr', {}, ['App', 'Minutes', 'Shards', 'Rupees', 'Tickets'].map(function (t) { return h('th', { scope: 'col', text: t }); }))),
            h('tbody', {}, FW.APPS.map(function (a) {
              var r = (rep.apps && rep.apps[a]) || {};
              return h('tr', {}, [h('td', { text: appName(a) }), h('td', { text: String(r.minutes || 0) }), h('td', { text: String(r.shards || 0) }),
                h('td', { text: String(r.rupees || 0) }), h('td', { text: String(r.tickets || 0) })]);
            }))
          ])
        ]);
      }

      function secTickets() {
        var ts = FW.tickets() || [];
        return h('section', { 'class': 'fw-card', 'data-sec': 'tickets' }, [
          h('h2', { 'class': 'fw-h2', text: 'Tickets' }),
          ts.length ? ts.map(function (t) {
            return h('div', { 'class': 'fw-ticket' + (t.status === 'used' ? ' fw-ticket-used' : ''), 'data-ticket': t.id }, [
              h('span', { 'class': 'fw-ticket-emoji', 'aria-hidden': 'true', text: t.emoji || '\uD83C\uDF9F\uFE0F' }),
              h('div', { 'class': 'fw-ticket-body' }, [
                h('div', { 'class': 'fw-item-name', text: t.rewardText || '' }),
                h('div', { 'class': 'fw-muted fw-small', text: appName(t.app) + ' \u00B7 ' + fmtTime(t.earnedAt) + (t.status === 'used' ? ' \u00B7 used ' + fmtTime(t.usedAt) : '') })
              ]),
              t.status === 'used' ? h('span', { 'class': 'fw-muted', text: 'Used \u2713' })
                : btn('Mark as used', function () { FW.markUsed(t.id); base.update(); }, { key: 'mu-' + t.id })
            ]);
          }) : h('p', { 'class': 'fw-muted', style: 'margin:0', text: 'No tickets yet.' })
        ]);
      }

      function secAdjust(n) {
        var a = st.adj;
        return h('section', { 'class': 'fw-card', 'data-sec': 'adjust' }, [
          h('h2', { 'class': 'fw-h2', text: 'Manual adjust' }),
          h('div', { 'class': 'fw-fields' }, [
            h('label', { 'class': 'fw-field' }, ['What',
              h('select', { 'class': 'fw-input', key: 'adj-app', name: 'adj-app', onchange: function (e) { a.app = e.target.value; } },
                FW.APPS.map(function (x) { return h('option', { value: x, selected: a.app === x }, appName(x) + ' \u00B7 ' + shardName(n, x)); })
                  .concat([h('option', { value: 'rupees', selected: a.app === 'rupees' }, n.rupees ? n.rupees.charAt(0).toUpperCase() + n.rupees.slice(1) : 'Rupees')]))
            ]),
            numField('Amount', a, 'amount', -20, 20, 'adj-amount'),
            h('label', { 'class': 'fw-field' }, ['Reason (required)',
              h('input', { 'class': 'fw-input', type: 'text', maxlength: 120, value: a.reason, key: 'adj-reason', name: 'adj-reason', oninput: function (e) { a.reason = e.target.value; } })])
          ]),
          h('div', { 'class': 'fw-row' }, [
            btn('Apply', function () {
              var amt = parseInt(a.amount, 10);
              var reason = String(a.reason || '').trim();
              if (isNaN(amt) || amt === 0 || amt < -20 || amt > 20) { st.msg.adjust = { ok: false, text: 'Pick an amount from \u221220 to 20 (not 0).' }; base.update(); return; }
              if (!reason) { st.msg.adjust = { ok: false, text: 'Add a reason.' }; base.update(); return; }
              if (a.app === 'rupees') FW.adjustRupees(amt, reason); else FW.adjust(a.app, amt, reason);
              st.msg.adjust = { ok: true, text: 'Applied ' + signed(amt) + '.' };
              a.amount = ''; a.reason = '';
              base.update();
            }, { cls: 'fw-btn-primary', key: 'adj-apply' }),
            st.msg.adjust ? h('span', { 'class': st.msg.adjust.ok ? 'fw-ok' : 'fw-err', role: 'status', text: st.msg.adjust.text }) : null
          ])
        ]);
      }

      function render() {
        var n = names(skin);
        var appList = FW.APPS.map(appName);
        var shared = appList.length > 1 ? appList.slice(0, -1).join(', ') + ' and ' + appList[appList.length - 1] : appList.join('');
        return h('div', { 'class': 'fw-page fw-page-wide fw-parent' }, [
          h('h2', { 'class': 'fw-h2', text: 'Parent corner \u203A Rewards' }),
          secSettings(n), secRewards(n), secLedger(), secWeekly(), secTickets(), secAdjust(n),
          h('p', { 'class': 'fw-muted fw-small fw-shared-note', text: 'Shared by ' + shared + ' on this browser.' })
        ]);
      }

      base = makeMount(el, render);
      return { update: base.update, destroy: base.destroy };
    };

    // ---------- 4. Goal bar ----------
    FW.mountGoal = function (el, o) {
      o = o || {};
      var app = o.app, skin = o.skin, imageFor = o.imageFor;
      function wrap(kids, label) {
        if (typeof o.onOpen === 'function') {
          return h('button', { type: 'button', 'class': 'fw-btn fw-goal', 'aria-label': label, key: 'goal', onclick: function () { o.onOpen(); } }, kids);
        }
        return h('div', { 'class': 'fw-card fw-goal', 'aria-label': label }, kids);
      }
      function render() {
        var n = names(skin);
        var gp = FW.goalProgress(app);
        if (gp && gp.item) {
          var nm = itemName(gp.item, skin);
          var pct = Math.max(0, Math.min(100, gp.pct || 0));
          return wrap([
            visual(gp.item, imageFor, true),
            h('span', { 'class': 'fw-goal-body' }, [
              h('span', { 'class': 'fw-goal-name' }, [h('b', { text: nm }), h('span', { 'class': 'fw-muted fw-small', text: ' \u00B7 ' + gp.have + '/' + gp.price })]),
              h('span', { 'class': 'fw-bar', style: 'display:block' }, [h('span', { style: 'width:' + pct + '%' })])
            ])
          ], (n.goal || 'Goal') + ': ' + nm + ', ' + gp.have + ' of ' + gp.price + ' ' + rupeeWord(n, gp.price));
        }
        var a = FW.affordable(app);
        if (a) {
          var t = affordableText(n, itemName(a, skin));
          return wrap([visual(a, imageFor, true), h('span', { 'class': 'fw-goal-body', text: t })], t);
        }
        return null;
      }
      var base = makeMount(el, render);
      return { update: base.update, destroy: base.destroy };
    };

    // ---------- 5. Top-bar counter ----------
    FW.mountCounter = function (el, o) {
      o = o || {};
      var skin = o.skin;
      var uid = 'fw' + (++uidSeq);
      function render() {
        var n = names(skin);
        var ts = triState(n);
        var b = ts.b;
        var ready = claimState(n).ok;
        var label = ts.apps.map(function (a) { return shardName(n, a) + ' ' + (b[a] || 0); }).join(', ') +
          ', ' + (b.rupees || 0) + ' ' + rupeeWord(n, b.rupees) + (ready ? '. ' + (n.claim || 'Claim a reward') + ' is ready.' : '');
        var mini = triforceSVG(ts.fr, uid, '', null, ts.apps);
        var mw = Number(mini.getAttribute('data-w')) || 100;
        mini.setAttribute('width', String(Math.round(mw * 0.21)));
        mini.setAttribute('height', '18');
        var kids = [mini];
        ts.apps.forEach(function (a) {
          kids.push(h('span', { 'class': 'fw-count', 'data-app': a }, [h('span', { 'class': 'fw-dot', style: 'background:' + info(a).color }), String(b[a] || 0)]));
        });
        kids.push(h('span', { 'class': 'fw-count', 'data-app': 'rupees' }, [rupeeIcon(14), String(b.rupees || 0)]));
        return h('button', {
          type: 'button', 'class': 'fw-btn fw-counter' + (ready ? ' fw-ready' : ''), 'aria-label': label, title: label, key: 'counter',
          onclick: typeof o.onOpen === 'function' ? function () { o.onOpen(); } : null
        }, kids);
      }
      var base = makeMount(el, render, { cls: 'fw-inline' });
      base.root.style.display = 'inline-block';
      return { update: base.update, destroy: base.destroy };
    };

    // ---------- 6. Equipped items ----------
    FW.applyEquipped = function (handlers) {
      handlers = handlers || {};
      var last = null;
      function lookup(id) {
        if (id == null) return null;
        if (typeof FW.itemById === 'function') return FW.itemById(id) || null;
        var lists = FW.APPS.map(function (a) { return FW.catalog(a) || []; });
        for (var i = 0; i < lists.length; i++) for (var j = 0; j < lists[i].length; j++) if (lists[i][j].id === id) return lists[i][j];
        return null;
      }
      function run() {
        var inv = FW.inventory() || {};
        var eq = inv.equipped || {};
        var key = JSON.stringify(SLOTS.map(function (sl) { return eq[sl] == null ? null : eq[sl]; }));
        if (key === last) return;
        last = key;
        SLOTS.forEach(function (sl) {
          var fn = handlers['set' + sl.charAt(0).toUpperCase() + sl.slice(1)];
          if (typeof fn === 'function') fn(lookup(eq[sl]));
        });
      }
      run();
      var off = FW.onChange(run);
      return function () { if (typeof off === 'function') off(); off = null; };
    };
  }

  installUI(FW);
  return FW;
});
