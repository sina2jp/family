/*! hub.js - the Family Hub: the grown-up's one place (setup checklist + dashboard), and the join page for his laptop. */
(function () {
  'use strict';
  var FS = window.FamilySync, FW = window.FamilyWallet, Codes = window.FamilyCodes, QR = window.QR;
  var K = FS.KEYS;
  var PREVIEW = !!window.__HUB_PREVIEW__;
  var HUB_KEY = 'familyApps.hub.v1'; // grown-up laptop only: which optional steps were skipped
  var SITE = PREVIEW ? 'https://sina2jp.github.io/' : new URL('../', location.href).href;
  var HUB_URL = PREVIEW ? 'https://sina2jp.github.io/family/' : new URL('./', location.href).href.split('#')[0];
  var APPS = [
    { id: 'math', name: 'Math Arena', path: 'math-arena/', icon: 'medallion_light', color: '#b8860b' },
    { id: 'language', name: 'Language Quest', path: 'language-quest/', icon: 'medallion_forest', color: '#2f7d3b' },
    { id: 'code', name: 'Code Quest', path: 'code-quest/', icon: 'medallion_fire', color: '#b8442e' },
    { id: 'music', name: 'Music Quest', path: 'music-quest/', icon: 'medallion_water', color: '#2e64a8' },
  ];
  var IMG = window.__HUB_IMG__ || {};
  function img(name) { return IMG[name] || 'kit/' + name + '.webp'; }
  var root = document.getElementById('app');
  var stash = { join: null, importText: '' };
  var ui = { open: null, msg: {}, pair: null, test: null, pendingApprove: {} };

  // ---------- tiny DOM helper ----------
  function h(tag, attrs) {
    var parts = tag.split('.'), e = document.createElement(parts[0] || 'div');
    if (parts.length > 1) e.className = parts.slice(1).join(' ');
    attrs = attrs || {};
    for (var k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'on') { for (var ev in v) e.addEventListener(ev, v[ev]); }
      else if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k in e && k !== 'list' && k !== 'type') { try { e[k] = v; } catch (x) { e.setAttribute(k, v); } }
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (var i = 2; i < arguments.length; i++) add(e, arguments[i]);
    return e;
  }
  function add(e, c) { if (c == null || c === false) return; if (Array.isArray(c)) c.forEach(function (x) { add(e, x); }); else e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c); }
  function clear(e) { while (e.firstChild) e.removeChild(e.firstChild); return e; }
  var LS = window.__HUB_STORAGE__ || (function () { try { var s = window.localStorage; s.getItem('x'); return s; } catch (e) { return null; } })();
  function raw(k) { try { return LS ? LS.getItem(k) : null; } catch (e) { return null; } }
  function readJSON(k) { try { var v = raw(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function prefs() { var p = readJSON(HUB_KEY) || {}; p.skipped = p.skipped || {}; return p; }
  function setPref(fn) { var p = prefs(); fn(p); try { if (LS) LS.setItem(HUB_KEY, JSON.stringify(p)); } catch (e) {} }
  function ago(t) {
    var ms = Date.now() - (typeof t === 'number' ? t : Date.parse(t || ''));
    if (!isFinite(ms)) return '—';
    if (ms < 90000) return 'just now';
    if (ms < 3600000) return Math.round(ms / 60000) + ' min ago';
    if (ms < 86400000 * 1.5) return Math.round(ms / 3600000) + ' h ago';
    return Math.round(ms / 86400000) + ' days ago';
  }
  function when(t) { var d = new Date(t); return isFinite(d) ? d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : ''; }
  function clearHash() { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { location.hash = ''; } }
  function appIcon(a, size) { return h('img.appicon', { src: img(a.icon), alt: '', width: size || 36, height: size || 36 }); }

  // ---------- boot ----------
  function readHash() {
    var hash = location.hash || '';
    if (/[#&]join=/.test(hash)) { stash.join = FS.parseJoin(hash); clearHash(); return 'join'; }
    if (/[#&]import=/.test(hash)) { try { stash.importText = decodeURIComponent((hash.split('import=')[1] || '').split('&')[0]); } catch (e) { stash.importText = ''; } clearHash(); ui.open = 'codes'; return 'import'; }
    return '';
  }
  function boot() {
    var kind = readHash();
    FS.start({ app: 'hub' });
    FS.onUpdate(function () { if (!stash.join) schedule(); });
    FS.onStatus(function () { if (!stash.join) schedule(); });
    // an import or join link opened while the Hub is already open only changes the #fragment (no reload)
    window.addEventListener('hashchange', function () { var k = readHash(); if (k === 'join') renderJoin(); else if (k === 'import') route(); });
    if (kind === 'join') return renderJoin();
    route();
  }
  var pending = null;
  function schedule() {
    if (pending) return;
    pending = setTimeout(function () {
      pending = null;
      var a = document.activeElement;
      if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && root.contains(a)) return schedule();
      route();
    }, 250);
  }
  function route() {
    var r = FS.role();
    if (r === 'grownup') return renderHub();
    if (r === 'kid') return renderKidHome();
    return renderWelcome();
  }
  function shell(title, sub, kid) {
    clear(root);
    var top = h('header.top' + (kid ? '.kid' : ''), null,
      h('div.brand', null, h('img.brandimg', { src: img('lesson_scroll'), alt: '', width: 40, height: 40 }), h('div', null, h('h1', { text: title }), sub ? h('p.sub', { text: sub }) : null)),
      h('div.topright', { id: 'topright' }));
    root.appendChild(top);
    if (FS.isConnected()) FS.mountStatus(top.querySelector('#topright'), { showRole: true });
    var main = h('main');
    root.appendChild(main);
    return main;
  }

  // ---------- welcome (this browser is not connected) ----------
  function renderWelcome() {
    var main = shell('Family Hub', 'Set up all four learning apps once, here on your laptop.');
    var input = h('input.inp', { type: 'url', placeholder: 'https://script.google.com/macros/s/…/exec', 'aria-label': 'Family backend address', spellcheck: false, autocomplete: 'off' });
    var msg = h('p.msg', { role: 'status' });
    var btn = h('button.btn.primary.big', { text: 'Set up our family', on: { click: function () {
      btn.disabled = true; msg.className = 'msg'; msg.textContent = 'Setting up…';
      FS.createFamily({ endpoint: input.value.trim() }).then(function () { route(); }, function (e) {
        btn.disabled = false; msg.className = 'msg bad';
        msg.textContent = e && e.code === 'exists' ? 'This backend already has a family. Use "Already set up?" below with your family link.' : (e && e.message) || 'That did not work.';
      });
    } } });
    var join = h('input.inp', { type: 'text', placeholder: 'https://sina2jp.github.io/family/#join=…', 'aria-label': 'Family link', autocomplete: 'off' });
    var jmsg = h('p.msg');
    main.appendChild(h('section.card.hero', null,
      h('h2', { text: 'Set up our family' }),
      h('p', { text: 'One place for the PIN, rewards, setup codes, the AI key and the look of all four apps. Each of his laptops picks it all up after one link. You see his week here.' }),
      h('label.lbl', { text: 'Family backend address (the web app URL from DEPLOY.md, ends with /exec)' }), input, btn, msg,
      stash.importText ? h('p.note', { text: 'Your private setup codes are ready. They are imported right after setup.' }) : null));
    main.appendChild(h('details.card.small', null, h('summary', { text: 'Already set up on another laptop?' }),
      h('p', { text: 'Paste your family link (Connect each laptop › link) to make this browser a second grown-up device.' }), join,
      h('button.btn', { text: 'Connect as a grown-up', on: { click: function () {
        var j = FS.parseJoin(join.value);
        if (!j) { jmsg.textContent = 'That is not a family link.'; return; }
        jmsg.textContent = 'Connecting…';
        FS.connect(Object.assign({}, j, { role: 'grownup' })).then(route, function (e) { jmsg.textContent = (e && e.message) || 'That did not work.'; });
      } } }), jmsg));
    if (PREVIEW) input.value = 'https://script.google.com/macros/s/AKfycbPreviewOnlyNotARealDeployment0000000000/exec';
    else fetch('endpoint.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { if (j && j.endpoint && !input.value) input.value = j.endpoint; }, function () {});
  }

  // ---------- grown-up hub ----------
  var STEPS = [
    { id: 'pin', title: 'One PIN for all 4 apps', icon: 'key_small' },
    { id: 'rewards', title: 'Rewards', icon: 'chest_closed' },
    { id: 'codes', title: 'Private setup codes', icon: 'lesson_scroll' },
    { id: 'ai', title: 'AI key (optional)', icon: 'ocarina_fairy' },
    { id: 'look', title: 'One look for all apps', icon: 'heart_container' },
    { id: 'connect', title: 'Connect each laptop he uses', icon: 'compass' },
  ];
  // ---------- his laptops (several are fine since 1.1) ----------
  function devMeta() { var m = readJSON(K.devices || 'familyApps.devices.v1') || {}; m.names = m.names || {}; m.removed = m.removed || {}; return m; }
  function removedNow(d, meta) { var r = meta.removed[d.id]; return !!r && !(Date.parse(d.lastSeen || '') > Date.parse(r)); }
  function allKids() { return (FS.mirror().devices || []).filter(function (d) { return d.role === 'kid' && !/^check-deploy/.test(d.id); }).sort(function (a, b) { return String(a.firstSeen).localeCompare(String(b.firstSeen)); }); }
  function kidDevices() { var meta = devMeta(); return allKids().filter(function (d) { return !removedNow(d, meta); }); }
  function labelOf(d) { var meta = devMeta(), all = allKids(), i = -1; for (var j = 0; j < all.length; j++) if (all[j].id === d.id) i = j; return meta.names[d.id] || 'Laptop ' + (i >= 0 ? i + 1 : all.length + 1); }
  function newest(list) { return list.slice().sort(function (a, b) { return Date.parse(b.lastSeen || 0) - Date.parse(a.lastSeen || 0); })[0]; }
  function stepState(id) {
    var p = prefs();
    if (id === 'pin') return FS.pinIsSet() ? { done: true, text: 'Set · unlocks the grown-up corner in every app' } : { done: false, text: 'Not set yet' };
    if (id === 'rewards') { var r = readJSON(K.rewards); if (!r) return { done: false, text: 'Using the default list' }; var pet = (r.rewards || []).some(function (x) { return /our pet/i.test(x.text); }); return { done: true, text: (r.rewards || []).length + ' rewards · up to ' + r.weeklyCap + ' a week' + (pet ? ' · rename the pet reward' : ''), warn: pet }; }
    if (id === 'codes') { var a = readJSON('mathArena.v3.schoolSync.v1'), b = readJSON('musicQuest.myLessons.v1'); if (a || b) return { done: true, text: [a ? 'Math school sync ✔' : null, b ? 'Music lessons ✔' : null].filter(Boolean).join(' · ') }; return p.skipped.codes ? { done: true, text: 'Skipped for now' } : { done: false, text: 'Paste the MA1: / MQ1: codes' }; }
    if (id === 'ai') { var key = raw(K.aiKey) || ''; return key ? { done: true, text: 'Saved · encrypted on the way to his laptops' } : p.skipped.ai ? { done: true, text: 'Skipped (apps work without it)' } : { done: false, text: 'Optional: for the AI helpers' }; }
    if (id === 'look') { var l = FS.look(); return l ? { done: true, text: l === 'grove' ? 'Starlit Grove' : 'Hyrule' } : { done: false, text: 'Hyrule unless you choose' }; }
    if (id === 'connect') { var k = kidDevices(), n = newest(k); return k.length ? { done: true, text: k.length + (k.length === 1 ? ' laptop' : ' laptops') + ' connected · last used ' + ago(n.lastSeen) } : { done: false, text: 'Open one link on each laptop he uses' }; }
    return { done: false, text: '' };
  }
  function renderHub() {
    if (stash.importText) { var t = stash.importText; stash.importText = ''; importCodes(t); ui.open = 'codes'; }
    var main = shell('Family Hub', 'Your laptop · grown-up');
    var states = STEPS.map(function (s) { return stepState(s.id); });
    var doneN = states.filter(function (s) { return s.done; }).length, allDone = doneN === STEPS.length;
    if (ui.open == null && !allDone) { for (var i = 0; i < STEPS.length; i++) if (!states[i].done) { ui.open = STEPS[i].id; break; } }
    var list = h('section.checklist' + (allDone && !ui.showSetup ? '.compact' : ''), { id: 'checklist' },
      h('div.sechead', null, h('h2', { text: allDone ? 'Setup ✔ (6 of 6)' : 'Set up once (' + doneN + ' of 6 done)' }),
        allDone ? h('button.btn.link', { text: ui.showSetup ? 'Hide setup' : 'Change setup', on: { click: function () { ui.showSetup = !ui.showSetup; ui.open = null; route(); } } }) : null));
    var grid = h('div.steps');
    STEPS.forEach(function (s, i) {
      var st = states[i], open = ui.open === s.id && (!allDone || ui.showSetup);
      var card = h('article.step' + (st.done ? '.done' : '') + (open ? '.open' : '') + (st.warn ? '.warn' : ''), { id: 'step-' + s.id, 'data-step': s.id },
        h('button.stephead', { 'aria-expanded': open ? 'true' : 'false', on: { click: function () { ui.open = open ? '' : s.id; route(); } } },
          h('span.tick', { text: st.done ? '✔' : String(i + 1), 'aria-label': st.done ? 'done' : 'step ' + (i + 1) }),
          h('img.stepimg', { src: img(s.icon), alt: '', width: 34, height: 34 }),
          h('span.steptext', null, h('b', { text: s.title }), h('small', { text: st.text }))),
        open ? h('div.stepbody', null, stepBody(s.id)) : null);
      grid.appendChild(card);
    });
    if (!allDone || ui.showSetup) list.appendChild(grid);
    else list.appendChild(h('div.ticks', null, STEPS.map(function (s) { return h('span.minitick', { text: '✔ ' + s.title }); })));
    var dash = dashboard();
    if (allDone) { main.appendChild(dash); main.appendChild(list); } else { main.appendChild(list); main.appendChild(dash); }
    main.appendChild(footer());
  }
  function say(id, text, bad) { ui.msg[id] = { text: text, bad: !!bad }; }
  function msgFor(id) { var m = ui.msg[id]; return h('p.msg' + (m && m.bad ? '.bad' : ''), { role: 'status', text: m ? m.text : '' }); }
  function stepBody(id) {
    if (id === 'pin') return pinBody();
    if (id === 'rewards') return rewardsBody();
    if (id === 'codes') return codesBody();
    if (id === 'ai') return aiBody();
    if (id === 'look') return lookBody();
    if (id === 'connect') return connectBody();
  }
  function pinBody() {
    var a = h('input.inp.pin', { type: 'password', inputMode: 'numeric', maxLength: 4, placeholder: '4 digits', autocomplete: 'new-password', 'aria-label': 'New PIN' });
    var b = h('input.inp.pin', { type: 'password', inputMode: 'numeric', maxLength: 4, placeholder: 'again', autocomplete: 'new-password', 'aria-label': 'Repeat PIN' });
    return [h('p', { text: 'This PIN unlocks the grown-up corner in Math Arena, Language Quest, Code Quest and Music Quest. It replaces any PIN set inside the apps.' }),
      h('div.row', null, a, b, h('button.btn.primary', { text: FS.pinIsSet() ? 'Change PIN' : 'Save PIN', on: { click: function () {
        if (!/^\d{4}$/.test(a.value)) { say('pin', 'Use 4 digits.', true); return route(); }
        if (a.value !== b.value) { say('pin', 'The two PINs are different.', true); return route(); }
        FS.setPin(a.value).then(function () { say('pin', 'Saved. His laptops get it on their next sync.'); ui.open = next('pin'); route(); }, function (e) { say('pin', e.message, true); route(); });
      } } })), msgFor('pin')];
  }
  function next(id) { for (var i = 0; i < STEPS.length; i++) if (STEPS[i].id === id) { for (var j = i + 1; j < STEPS.length; j++) if (!stepState(STEPS[j].id).done) return STEPS[j].id; } return ''; }
  function currentRewards() {
    var r = readJSON(K.rewards), ws = (r && r.wallet) || {};
    var list = (r && Array.isArray(r.rewards) && r.rewards.length ? r.rewards : FW.DEFAULT_REWARDS).map(function (x) { return { id: x.id, emoji: x.emoji, text: x.text, cost: (ws.costs && ws.costs[x.id]) || 1 }; });
    return { list: list, weeklyCap: r && r.weeklyCap != null ? r.weeklyCap : 5, appsInSet: ws.appsInSet || FW.DEFAULT_SETTINGS.appsInSet.slice(), per: (ws.perApp && ws.perApp.math) || 3, noRepeats: ws.noRepeats !== false, onceDailyCap: ws.onceDailyCap != null ? ws.onceDailyCap : 6 };
  }
  function rewardsBody() {
    var cur = ui.rewardsDraft || (ui.rewardsDraft = currentRewards());
    var rows = h('div.rewardrows');
    cur.list.forEach(function (r, i) {
      var pet = /our pet/i.test(r.text);
      rows.appendChild(h('div.rewardrow' + (pet ? '.pet' : ''), null,
        h('input.inp.emoji', { value: r.emoji, maxLength: 4, 'aria-label': 'Emoji', on: { input: function (e) { r.emoji = e.target.value; } } }),
        h('input.inp.rtext', { value: r.text, maxLength: 80, 'aria-label': 'Reward', on: { input: function (e) { r.text = e.target.value; } } }),
        h('select.inp.cost', { 'aria-label': 'Cost', on: { change: function (e) { r.cost = Number(e.target.value); } } }, [1, 2, 3, 4, 5].map(function (n) { return h('option', { value: n, text: n + ' Triforce' + (n > 1 ? 's' : ''), selected: r.cost === n }); })),
        h('button.btn.icon', { title: 'Remove', 'aria-label': 'Remove reward', text: '×', on: { click: function () { cur.list.splice(i, 1); route(); } } }),
        pet ? h('p.hint', { text: 'Rename this one with your pet\'s name, e.g. "Play time with Biscuit". Names stay private: they live only in your Sheet and his laptop.' }) : null));
    });
    var cap = h('input.inp.num', { type: 'number', min: 0, max: 14, value: cur.weeklyCap, 'aria-label': 'Weekly cap', on: { input: function (e) { cur.weeklyCap = Number(e.target.value); } } });
    var per = h('input.inp.num', { type: 'number', min: 1, max: 6, value: cur.per, 'aria-label': 'Shards per app', on: { input: function (e) { cur.per = Number(e.target.value); } } });
    var apps = h('div.apps', null, APPS.map(function (a) {
      return h('label.check', null, h('input', { type: 'checkbox', checked: cur.appsInSet.indexOf(a.id) >= 0, on: { change: function (e) { var s = cur.appsInSet.filter(function (x) { return x !== a.id; }); if (e.target.checked) s.push(a.id); cur.appsInSet = APPS.map(function (x) { return x.id; }).filter(function (x) { return s.indexOf(x) >= 0; }); } } }), appIcon(a, 22), a.name);
    }));
    return [h('p', { text: 'He earns shards in each app. One Triforce (a full set) buys a reward ticket; you approve it here or with the PIN on his laptop.' }),
      rows,
      cur.list.length < 8 ? h('button.btn.link', { text: '+ Add a reward', on: { click: function () { cur.list.push({ id: 'r' + Date.now().toString(36), emoji: '🎁', text: 'New reward', cost: 1 }); route(); } } }) : null,
      h('div.row.wrap', null, h('label.lbl.inline', null, 'Tickets per week (all apps): ', cap), h('label.lbl.inline', null, 'Shards from each app per Triforce: ', per)),
      h('p.lbl', { text: 'Apps that count toward a Triforce' }), apps,
      h('div.policy', null,
        h('label.check.big', null, h('input', { type: 'checkbox', id: 'norepeats', checked: cur.noRepeats, on: { change: function (e) { cur.noRepeats = e.target.checked; } } }), h('b', { text: 'Rewards only for new learning (no repeats)' })),
        h('label.lbl.inline', null, 'Max lesson shards per app per day: ', h('input.inp.num', { type: 'number', min: 0, max: 50, value: cur.onceDailyCap, 'aria-label': 'Max lesson shards per app per day', id: 'oncecap', on: { input: function (e) { cur.onceDailyCap = Number(e.target.value); } } })),
        h('p.small.muted', { text: policyText(cur.noRepeats, cur.onceDailyCap) })),
      h('div.row', null, h('button.btn.primary', { text: 'Save rewards', on: { click: saveRewards } })), msgFor('rewards')];
  }
  function policyText(on, cap) {
    var c = Math.max(0, Math.round(Number(cap) || 0));
    return on
      ? 'Applied policy: a lesson he passes pays once, on any of his laptops; at most ' + c + ' lesson shards per app per day (more are saved and paid on later days); a correct answer pays once per question every 30 days; review time counts as minutes but earns no shards. Apps not yet updated keep the old rules until they are.'
      : 'Applied policy: repeats pay again; still at most ' + c + ' lesson shards per app per day (more are saved for later days).';
  }
  function saveRewards() {
    var cur = ui.rewardsDraft;
    var list = cur.list.map(function (r) { return { id: String(r.id).slice(0, 40), emoji: (r.emoji || '🎁').slice(0, 8), text: String(r.text || '').trim().slice(0, 80) }; }).filter(function (r) { return r.text; });
    if (!list.length) { say('rewards', 'Keep at least one reward.', true); return route(); }
    if (!cur.appsInSet.length) { say('rewards', 'Pick at least one app.', true); return route(); }
    var per = Math.max(1, Math.min(6, Math.round(cur.per) || 3)), perApp = {}, costs = {};
    APPS.forEach(function (a) { perApp[a.id] = per; });
    cur.list.forEach(function (r) { costs[String(r.id).slice(0, 40)] = Math.max(1, Math.min(5, r.cost || 1)); });
    var old = readJSON(K.rewards) || {};
    FS.setSetting(K.rewards, { version: 1, enabled: old.enabled !== false, tokensPerTicket: old.tokensPerTicket || 3, weeklyCap: Math.max(0, Math.min(14, Math.round(cur.weeklyCap))), rewards: list, updatedAt: new Date().toISOString(), wallet: { mode: 'balanced', appsInSet: cur.appsInSet.slice(), perApp: perApp, costs: costs, noRepeats: cur.noRepeats !== false, onceDailyCap: Math.max(0, Math.min(50, Math.round(Number(cur.onceDailyCap)))) } });
    ui.rewardsDraft = null;
    say('rewards', /our pet/i.test(JSON.stringify(list)) ? 'Saved. Tip: rename "Play time with our pet".' : 'Saved for all 4 apps.');
    ui.open = /our pet/i.test(JSON.stringify(list)) ? 'rewards' : next('rewards');
    route();
  }
  function importCodes(text) {
    var res = Codes.read(text), okN = 0, out = [];
    if (!res.length) { say('codes', 'No MA1: or MQ1: code found in that text.', true); return 0; }
    res.forEach(function (r) {
      if (r.error) { out.push((r.kind === 'math' ? 'Math Arena: ' : 'Music Quest: ') + r.error); return; }
      if (FS.setSetting(r.key, r.value)) { okN++; out.push((r.kind === 'math' ? 'Math Arena school sync: ' : 'Music Quest lessons: ') + r.summary + ' ✔'); }
    });
    say('codes', out.join(' · '), okN === 0);
    return okN;
  }
  function codesBody() {
    var ta = h('textarea.inp.codes', { rows: 3, placeholder: 'Paste the MA1:… and MQ1:… codes here (one or both)', 'aria-label': 'Setup codes', spellcheck: false });
    var a = readJSON('mathArena.v3.schoolSync.v1'), b = readJSON('musicQuest.myLessons.v1');
    return [h('p', { text: 'The two private codes stay private: an #import= link is read in this browser only (the part after # is never sent to a server) and is removed from the address bar right away.' }),
      h('ul.status', null,
        h('li', { text: a ? 'Math Arena school sync: ' + (a.programs || []).length + ' classes, ' + (a.weeks || []).length + ' weeks' + (a.importedAt ? ' · ' + when(a.importedAt) : '') : 'Math Arena school sync: not yet' }),
        h('li', { text: b ? 'Music Quest lessons: ' + (b.pieces || []).length + ' pieces' + (Codes.music.extras(b) ? ' · ' + Codes.music.extras(b) : '') + (b.importedAt ? ' · ' + when(b.importedAt) : '') : 'Music Quest lessons: not yet', 'data-codes': 'music' })),
      ta,
      h('div.row', null, h('button.btn.primary', { text: 'Import codes', on: { click: function () { if (importCodes(ta.value)) { ui.open = 'codes'; } route(); } } }),
        !(a || b) ? h('button.btn.link', { text: 'Skip for now', on: { click: function () { setPref(function (p) { p.skipped.codes = true; }); ui.open = next('codes'); route(); } } }) : null),
      msgFor('codes')];
  }
  function testKey(key) {
    if (PREVIEW) return Promise.resolve({ ok: true, n: 0, preview: true });
    return fetch('https://api.anthropic.com/v1/models', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } })
      .then(function (r) { return r.json().then(function (j) { return r.ok ? { ok: true, n: (j.data || []).length } : { ok: false, text: (j.error && j.error.message) || 'HTTP ' + r.status }; }); }, function () { return { ok: false, text: 'Could not reach Anthropic from this browser.' }; });
  }
  function aiBody() {
    var cur = raw(K.aiKey) || '';
    var inp = h('input.inp', { type: 'password', value: ui.aiDraft || '', placeholder: cur ? 'sk-ant-… (saved; paste a new one to replace)' : 'sk-ant-…', autocomplete: 'off', 'aria-label': 'Anthropic API key', spellcheck: false, on: { input: function (e) { ui.aiDraft = e.target.value; } } });
    var res = ui.test ? h('p.msg' + (ui.test.ok ? '' : '.bad'), { text: ui.test.ok ? (ui.test.preview ? 'Preview: on the real page this calls api.anthropic.com/v1/models.' : 'Key works ✔ (' + ui.test.n + ' models)') : 'Key test failed: ' + ui.test.text }) : null;
    return [h('p', { text: 'Optional. The AI helpers in the apps use it. Use a key from its own Console workspace with a low monthly spend limit. It travels to his laptops encrypted with your family secret; the Sheet only holds ciphertext.' }),
      h('div.row', null, inp,
        h('button.btn', { text: 'Test key', on: { click: function () { var k = inp.value.trim() || cur; if (!k) return; ui.test = { ok: true, text: '…' }; testKey(k).then(function (r) { ui.test = r; route(); }); } } }),
        h('button.btn.primary', { text: 'Save key', on: { click: function () { var k = inp.value.trim(); if (!/^sk-/.test(k)) { say('ai', 'That does not look like an Anthropic key (sk-…).', true); return route(); } FS.setSetting(K.aiKey, k); ui.test = null; ui.aiDraft = ''; say('ai', 'Saved. His laptop gets it encrypted.'); ui.open = next('ai'); route(); } } })),
      res,
      h('div.row', null, cur ? h('button.btn.link', { text: 'Remove the key', on: { click: function () { FS.setSetting(K.aiKey, null); say('ai', 'Removed from all devices on the next sync.'); route(); } } }) : h('button.btn.link', { text: 'Skip (no AI)', on: { click: function () { setPref(function (p) { p.skipped.ai = true; }); ui.open = next('ai'); route(); } } })),
      msgFor('ai')];
  }
  function lookBody() {
    var cur = FS.look() || 'hyrule';
    function opt(id, title, pic, text) {
      return h('button.lookopt' + (cur === id ? '.sel' : ''), { 'aria-pressed': cur === id ? 'true' : 'false', on: { click: function () { FS.setSetting(K.look, { v: 1, skin: id, updatedAt: new Date().toISOString() }); say('look', title + ' for all 4 apps.'); ui.open = next('look'); route(); } } },
        h('img', { src: pic, alt: '' }), h('b', { text: title }), h('small', { text: text }));
    }
    return [h('div.looks', null, opt('hyrule', 'Hyrule', img('kokiri_16x9_800'), 'The adventure look (default)'), opt('grove', 'Starlit Grove', IMG.grove || 'kit/bg_meadow.svg', 'An original look with no game characters')), msgFor('look')];
  }
  function connectBody() {
    var link = FS.joinLink(HUB_URL);
    var qr = h('div.qr', { html: QR.svg(link, { ecl: 'M', border: 2, label: 'QR code for the family link' }) });
    var field = h('input.inp.link', { value: link, readOnly: true, 'aria-label': 'Family link', on: { focus: function (e) { e.target.select(); } } });
    var pair = ui.pair;
    var left = pair ? Math.max(0, Math.round((Date.parse(pair.expiresAt) - Date.now()) / 1000)) : 0;
    if (pair && left > 0 && !ui.pairTimer) ui.pairTimer = setInterval(function () { var el = document.getElementById('pairleft'); if (!ui.pair || !el) { clearInterval(ui.pairTimer); ui.pairTimer = null; return; } var s = Math.max(0, Math.round((Date.parse(ui.pair.expiresAt) - Date.now()) / 1000)); el.textContent = s ? Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2) + ' left' : 'expired'; }, 1000);
    return [h('p', { text: 'Open this link once on each laptop he uses, in Chrome (about 30 seconds each). It connects all 4 apps on that laptop, keeps what he already did there, brings over everything you set here, and asks for the microphone once. After that, any of his laptops just works: his progress follows him.' }),
      h('div.connect', null, h('div', null, field,
        h('div.row', null, h('button.btn.primary', { text: 'Copy link', on: { click: function () { (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(function () { say('connect', 'Copied. Send it to his laptop (Messages, AirDrop, or an email to yourself).'); route(); }, function () { field.select(); say('connect', 'Select the link and copy it.'); route(); }); } } }),
          h('button.btn', { text: pair && left > 0 ? 'New code' : 'Show a 6-character code', on: { click: function () { FS.pairCreate().then(function (p) { ui.pair = p; route(); }, function (e) { say('connect', (e && e.message) || 'Could not make a code.', true); route(); }); } } })),
        pair && left > 0 ? h('div.pair', null, h('span.code', { text: pair.code }), h('small', { id: 'pairleft', text: Math.floor(left / 60) + ':' + ('0' + (left % 60)).slice(-2) + ' left' }), h('small', { text: 'Type it in any app: Grown-up corner › Family sync › Connect. Works once, for 10 minutes.' })) : null,
        h('p.small', { text: 'Keep this link private: it is the key to your family data.' })), qr),
      msgFor('connect')];
  }

  // ---------- dashboard (his week, from the mirror) ----------
  function mirrorStore() {
    var m = FS.mirror(), map = {};
    for (var k in m.items) map[k] = m.items[k].raw;
    return { getItem: function (k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; }, setItem: function () {}, removeItem: function () {} };
  }
  function withMirror(fn) { var saved = window.__HUB_FW_STORAGE__ || null; FW.configure({ storage: mirrorStore() }); try { return fn(); } finally { FW.configure({ storage: saved }); } }
  function summary(app) { var it = FS.mirror().items[FS.summaryKey(app)]; return it && it.value; }
  function highlight(app, s) {
    if (!s) return '—';
    var w = s.week || {}, t = s.total || {};
    var bits = [];
    if (app === 'math') { if (t.mastered != null) bits.push('Mastered ' + t.mastered + (t.learning != null ? ' · learning ' + t.learning : '')); if (w.readAccuracy != null) bits.push('Reading ' + Math.round(w.readAccuracy) + '%'); }
    if (app === 'language') { if (w.wordsLearned != null) bits.push(w.wordsLearned + (w.wordsLearned === 1 ? ' new word' : ' new words')); if (t.wordsLearned != null) bits.push(t.wordsLearned + ' total'); }
    if (app === 'code') { if (w.gamesBuilt != null) bits.push(w.gamesBuilt + (w.gamesBuilt === 1 ? ' game built' : ' games built')); if (t.gamesBuilt != null) bits.push(t.gamesBuilt + ' total'); }
    if (app === 'music') { if (w.practiceMin != null) bits.push(w.practiceMin + ' min practice'); if (w.piecesPracticed != null) bits.push(w.piecesPracticed + (w.piecesPracticed === 1 ? ' piece' : ' pieces')); }
    return bits.join(' · ') || '—';
  }
  function dashboard() {
    var sec = h('section.dash', { id: 'dashboard' });
    var m = FS.mirror(), has = !!m.items[K.wallet] || !!m.items[K.walletTime];
    sec.appendChild(h('div.sechead', null, h('h2', { text: 'This week' }), h('small', { text: m.at ? 'Updated ' + ago(m.at) : '' })));
    alerts().forEach(function (a) { sec.appendChild(a); });
    if (!has && !kidDevices().length) { sec.appendChild(h('div.card.empty', { text: 'His week shows up here after his laptop is connected (step 6).' })); return sec; }
    var rep = withMirror(function () { return FW.weeklyReport(0); }) || { apps: {} };
    var table = h('div.week');
    APPS.forEach(function (a) {
      var r = rep.apps[a.id] || {}, s = summary(a.id), w = (s && s.week) || {};
      var last = s && s.lastActive;
      table.appendChild(h('div.appcard', { 'data-app': a.id, style: '--app:' + a.color },
        h('div.apphead', null, appIcon(a, 30), h('b', { text: a.name }), h('small', { text: last ? ago(last) : 'not yet' })),
        h('div.nums', null,
          h('div', null, h('span.n', { text: String(r.minutes || 0) }), h('small', { text: 'active min' })),
          h('div', null, h('span.n', { text: String(w.lessons != null ? w.lessons : '—') }), h('small', { text: 'lessons' })),
          h('div', null, h('span.n', { text: String(r.shards || 0) }), h('small', { text: 'shards' }))),
        h('p.hl', { text: highlight(a.id, s) })));
    });
    sec.appendChild(table);
    sec.appendChild(ticketsCard());
    sec.appendChild(walletCard());
    sec.appendChild(h('div.two', null, codesCard(), devicesCard()));
    return sec;
  }
  var DAY = 86400000;
  function appOfKey(k) { var m = /^(mathArena|langQuest|codeQuest|musicQuest)\./.exec(k || ''); return m ? { mathArena: 'Math Arena', langQuest: 'Language Quest', codeQuest: 'Code Quest', musicQuest: 'Music Quest' }[m[1]] : 'Family'; }
  function kb(n) { return Math.round((n || 0) / 1024) + ' KB'; }
  function healthMap() {
    var it = FS.mirror().items[K.health || 'familyApps.syncHealth.v1'], v = it && it.value, m = {};
    if (v && v.v === 2 && v.devices) { for (var k in v.devices) m[k] = v.devices[k]; } else if (v && v.device) m[v.device] = v;
    return m;
  }
  function healthOf(id) { return healthMap()[id] || null; }
  function tooBigText(hl) { return (hl.tooBig || []).map(function (t) { return appOfKey(t.key) + ' (' + kb(t.size) + ')'; }).join(', '); }
  function staleMs(d) { var t = Date.parse(d && d.lastSeen || ''); return isFinite(t) ? Date.now() - t : 0; }
  function alerts() {
    var out = [], kids = kidDevices(), k = newest(kids);
    if (k && staleMs(k) > DAY) out.push(h('div.alert', { role: 'status', 'data-alert': 'stale' }, h('b', { text: (kids.length > 1 ? 'None of his laptops has synced for ' : 'His laptop last synced ') + ago(k.lastSeen).replace(' ago', '') + (kids.length > 1 ? '. ' : ' ago. ') }), 'What you see may be out of date. It catches up the next time he opens any app online.'));
    kids.forEach(function (d) {
      var hl = healthOf(d.id);
      if (hl && hl.state === 'paused' && hl.paused === 'too-big') out.push(h('div.alert', { role: 'status', 'data-alert': 'too-big' }, h('b', { text: 'Sync paused on ' + labelOf(d) + ': too big. ' }), 'Some of his progress is over the 300 KB backup limit: ' + tooBigText(hl) + '. It stays safe on that laptop, but is not backed up. Tell the app builder.'));
    });
    return out;
  }
  function done() { var it = FS.mirror().items[K.requestsDone]; return (it && it.value && it.value.done) || {}; }
  function ticketsCard() {
    var tix = withMirror(function () { return FW.tickets(); }) || [];
    var approvals = (readJSON(K.ticketApprovals) || {}).approvals || [], d = done();
    var waiting = tix.filter(function (t) { return t.status !== 'used'; });
    var card = h('div.card', { id: 'tickets' }, h('h3', { text: 'Reward tickets waiting' }));
    if (!waiting.length) card.appendChild(h('p.muted', { text: 'No tickets waiting.' }));
    waiting.forEach(function (t) {
      var ap = approvals.filter(function (x) { return x.ticketId === t.id; })[0];
      card.appendChild(h('div.ticket', null, h('span.temoji', { text: t.emoji || '🎟️' }), h('span.ttext', null, h('b', { text: t.rewardText || t.rewardId }), h('small', { text: 'from ' + (APPS.filter(function (a) { return a.id === t.app; })[0] || { name: t.app }).name + ' · ' + when(t.earnedAt) })),
        ap ? h('span.pill', { text: d[ap.id] ? 'Approved ✔' : 'Approved · reaches his laptop on its next sync' }) : h('button.btn.primary', { text: 'Approve', 'data-ticket': t.id, on: { click: function () { FS.request('approve', { ticketId: t.id }); route(); } } })));
    });
    var used = tix.filter(function (t) { return t.status === 'used'; }).slice(0, 3);
    if (used.length) card.appendChild(h('p.small.muted', { text: 'Recently used: ' + used.map(function (t) { return (t.emoji || '') + ' ' + (t.rewardText || '') + ' (' + when(t.usedAt || t.earnedAt) + ')'; }).join(' · ') }));
    return card;
  }
  function walletCard() {
    var bal = withMirror(function () { return FW.balance(); }) || {}, ev = withMirror(function () { return FW.events({ limit: 50 }); }) || [];
    var reqs = ((readJSON(K.walletAdjust) || {}).requests || []).slice().reverse(), d = done();
    var target = h('select.inp', { 'aria-label': 'What to adjust' }, APPS.map(function (a) { return h('option', { value: a.id, text: a.name + ' shards' }); }).concat([h('option', { value: 'rupees', text: 'Rupees' })]));
    var amount = h('input.inp.num', { type: 'number', value: 1, min: -50, max: 200, 'aria-label': 'Amount (use minus to take away)' });
    var reason = h('input.inp', { type: 'text', maxLength: 80, placeholder: 'Why (he sees this)', 'aria-label': 'Reason' });
    var card = h('div.card', { id: 'wallet' }, h('h3', { text: 'Wallet' }),
      h('div.balances', null, APPS.map(function (a) { return h('span.bal', { style: '--app:' + a.color }, appIcon(a, 20), String(bal[a.id] || 0)); }), h('span.bal', null, h('img', { src: img('rupee_green'), alt: '', width: 20, height: 20 }), String(bal.rupees || 0) + ' rupees'), h('span.bal', { text: (bal.triforces || 0) + ' Triforce' + (bal.triforces === 1 ? '' : 's') + ' ready to claim' })),
      h('div.row.wrap.adjust', null, h('b', { text: '± Adjust' }), target, amount, reason, h('button.btn', { text: 'Send', on: { click: function () {
        var n = Math.round(Number(amount.value) || 0);
        if (!n) { say('wallet', 'Choose an amount (use a minus sign to take away).', true); return route(); }
        FS.request('adjust', { app: target.value, amount: n, reason: reason.value.trim() || 'From a grown-up' });
        say('wallet', 'Sent. It is applied once on his laptop.'); route();
      } } })), msgFor('wallet'),
      reqs.length ? h('p.small', null, 'Requests: ', reqs.slice(0, 5).map(function (r) { return h('span.pill' + (d[r.id] ? '' : '.wait'), { text: (r.amount > 0 ? '+' : '') + r.amount + ' ' + (r.app === 'rupees' ? 'rupees' : r.app) + (d[r.id] ? ' ✔' : ' · waiting') }); })) : null);
    var tbl = h('table.ledger', null, h('thead', null, h('tr', null, ['When', 'App', 'What', 'Amount'].map(function (x) { return h('th', { text: x }); }))));
    var tb = h('tbody');
    var dl = withMirror(function () { return FW.daily ? FW.daily() : {}; }) || {}, rows = ev.map(function (e) { return { at: Date.parse(e.at) || 0, e: e }; });
    var oldest = rows.length ? rows[rows.length - 1].at : 0;
    Object.keys(dl).forEach(function (day) {
      var parts = [], end = new Date(day + 'T23:59:59').getTime();
      if (rows.length >= 50 && end < oldest) return;
      APPS.forEach(function (a) {
        var x = dl[day][a.id];
        if (!x) return;
        var bits = [];
        if (x.repeat) bits.push(x.repeat + (x.repeat === 1 ? ' repeat' : ' repeats') + ' \u2014 no reward');
        if (x.repeatRupees) bits.push(x.repeatRupees + (x.repeatRupees === 1 ? ' repeated answer' : ' repeated answers') + ' \u2014 no rupees');
        if (x.banked) bits.push(x.banked + ' shards banked');
        if (x.released) bits.push(x.released + ' banked shards paid');
        if (bits.length) parts.push(a.name + ': ' + bits.join(', '));
      });
      if (parts.length) rows.push({ at: Math.min(end, Date.now()), sum: new Date(day + 'T12:00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ' \u00b7 ' + parts.join(' \u00b7 ') });
    });
    rows.sort(function (p, q) { return q.at - p.at; });
    rows.forEach(function (r) {
      if (r.sum) { tb.appendChild(h('tr.sumrow', null, h('td', { colSpan: 4, text: r.sum }))); return; }
      var e = r.e;
      var a = APPS.filter(function (x) { return x.id === e.app; })[0];
      tb.appendChild(h('tr', { style: a ? '--rowc:' + a.color : null }, h('td', { text: when(e.at) }), h('td', { text: a ? a.name : e.app === 'family' ? 'All' : e.app }), h('td', { text: (e.kind === 'adjust' || e.tag === 'parent' ? 'Grown-up: ' : '') + (e.reason || e.kind) }), h('td.amt' + (e.amount < 0 ? '.neg' : ''), null, (e.amount > 0 ? '+' : '') + e.amount, e.kind === 'rupee' || e.kind === 'buy' ? h('img.ramt', { src: img('rupee_green'), alt: 'rupees', width: 14, height: 14 }) : null)));
    });
    tbl.appendChild(tb);
    var rows = [].slice.call(tb.children);
    rows.forEach(function (r, i) { if (i >= 8 && !ui.ledgerAll) r.style.display = 'none'; });
    card.appendChild(h('div.ledgerbox', null, h('h4.lh', { text: 'Ledger · last ' + ev.length }), ev.length ? tbl : h('p.muted', { text: 'Nothing yet.' }),
      ev.length > 8 ? h('button.btn.link', { text: ui.ledgerAll ? 'Show fewer' : 'Show all ' + ev.length, on: { click: function () { ui.ledgerAll = !ui.ledgerAll; route(); } } }) : null));
    return card;
  }
  function codesCard() {
    var ta = h('textarea.inp.codes', { rows: 2, placeholder: 'Paste new MA1:… / MQ1:… codes', 'aria-label': 'New setup codes' });
    var mq = readJSON('musicQuest.myLessons.v1'), mx = mq ? Codes.music.extras(mq) : '';
    return h('div.card', { id: 'updatecodes' }, h('h3', { text: 'Update setup codes' }),
      mq ? h('p.small', { 'data-codes': 'music', text: 'Music Quest lessons: ' + (mq.pieces || []).length + ' pieces' + (mx ? ' · ' + mx : '') + (mq.importedAt ? ' · ' + when(mq.importedAt) : '') }) : null,
      h('p.small', { text: 'Paste new codes, or open an import link (…/family/#import=…) on this laptop.' }), ta,
      h('button.btn', { text: 'Import', on: { click: function () { importCodes(ta.value); route(); } } }), msgFor('codes'));
  }
  function saveDevMeta(fn) { var m = devMeta(); fn(m); m.v = 1; m.updatedAt = new Date().toISOString(); FS.setSetting(K.devices || 'familyApps.devices.v1', m); }
  function devicesCard() {
    var meta = devMeta(), kids = kidDevices(), me = (FS.config() || {}).deviceId;
    var grown = (FS.mirror().devices || []).filter(function (d) { return d.role !== 'kid' && !/^check-deploy/.test(d.id); });
    var hidden = allKids().filter(function (d) { return removedNow(d, meta); }).length;
    return h('div.card', { id: 'devices' }, h('h3', { text: 'His laptops' }),
      kids.length ? h('ul.devices.kids', null, kids.map(function (d) {
        var stale = staleMs(d) > DAY, hl = healthOf(d.id), big = hl && hl.state === 'paused' && hl.paused === 'too-big';
        var name = h('input.inp.devname', { value: ui.devDraft && ui.devDraft[d.id] != null ? ui.devDraft[d.id] : labelOf(d), maxLength: 30, 'aria-label': 'Name for this laptop', on: { input: function (e) { ui.devDraft = ui.devDraft || {}; ui.devDraft[d.id] = e.target.value; } } });
        return h('li' + (stale ? '.stale' : ''), { 'data-device': d.id },
          h('div.devrow', null, name,
            h('button.btn.small', { text: 'Rename', on: { click: function () { var v = (name.value || '').trim().slice(0, 30); saveDevMeta(function (m) { if (v) m.names[d.id] = v; else delete m.names[d.id]; }); if (ui.devDraft) delete ui.devDraft[d.id]; say('devices', 'Saved.'); route(); } } }),
            h('button.btn.small.link.danger', { text: 'Remove', on: { click: function () { if (!confirm('Remove "' + labelOf(d) + '" from this list? If he uses it again it comes back by itself. (The family link stays the same.)')) return; saveDevMeta(function (m) { m.removed[d.id] = new Date().toISOString(); }); say('devices', labelOf(d) + ' removed from the list.'); route(); } } })),
          h('small', { text: (d.name || 'laptop') + ' · ' + (stale ? '⚠ ' : '') + 'last seen ' + ago(d.lastSeen) + ' · last sync from it ' + (d.lastPush ? ago(d.lastPush) : '—') + (d.version ? ' · v' + String(d.version).split('/')[0] : '') }),
          big ? h('span.flag', { text: '⚠ sync paused: too big · ' + tooBigText(hl) }) : null);
      })) : h('p.muted', { text: 'No laptop connected yet (step 6).' }),
      hidden ? h('p.small.muted', { text: hidden + ' removed ' + (hidden === 1 ? 'laptop is' : 'laptops are') + ' hidden.' }) : null,
      msgFor('devices'),
      grown.length ? h('h4.lh', { text: 'Grown-up devices' }) : null,
      grown.length ? h('ul.devices', null, grown.map(function (d) {
        return h('li', { 'data-device': d.id }, h('b', { text: d.id === me ? 'This laptop (you)' : 'Grown-up device' }), h('span', { text: ' · ' + (d.name || 'device') }), h('small', { text: 'last seen ' + ago(d.lastSeen) }));
      })) : null);
  }
  function footer() {
    var s = FS.status();
    return h('footer.foot', null, h('span', { text: s.text + (s.lastSyncAt ? ' · ' + ago(s.lastSyncAt) : '') + (s.lastError ? ' · ' + s.lastError : '') }),
      h('button.btn.link', { text: 'Sync now', on: { click: function () { FS.syncNow().then(route); } } }),
      h('button.btn.link.danger', { text: 'Disconnect this laptop', on: { click: function () { if (confirm('Disconnect this laptop from the family? Your family data stays in your Sheet; you can reconnect with the family link.')) { FS.disconnect(); route(); } } } }),
      h('span.ver', { text: 'Family Sync ' + FS.VERSION }));
  }

  // ---------- his laptop ----------
  function appButtons() {
    return h('div.appbtns', null, APPS.map(function (a) { return h('a.appbtn', { href: SITE + a.path, style: '--app:' + a.color, target: PREVIEW ? '_blank' : null }, appIcon(a, 56), h('b', { text: a.name })); }));
  }
  function micCard() {
    var state = h('p.msg', { id: 'micstate' });
    var btn = h('button.btn.primary.big', { text: '🎤 Allow microphone', id: 'micbtn', on: { click: function () {
      if (PREVIEW) { state.textContent = 'Preview: on his laptop Chrome asks once, for all 4 apps.'; return; }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { state.textContent = 'This browser has no microphone access.'; return; }
      btn.disabled = true; state.textContent = 'Chrome is asking… click Allow.';
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) { s.getTracks().forEach(function (t) { t.stop(); }); state.textContent = 'Microphone allowed ✔ (for all 4 apps on this site)'; btn.textContent = 'Microphone allowed ✔'; }, function () { btn.disabled = false; state.textContent = 'Not allowed. Click the 🔒 in the address bar › Microphone › Allow, then try again.'; });
    } } });
    if (navigator.permissions && navigator.permissions.query && !PREVIEW) navigator.permissions.query({ name: 'microphone' }).then(function (p) { if (p.state === 'granted') { btn.textContent = 'Microphone allowed ✔'; state.textContent = 'Already allowed for all 4 apps.'; } }, function () {});
    return h('div.card.mic', null, h('h3', { text: 'Microphone' }), h('p', { text: 'Language Quest and Music Quest listen when he speaks or plays. One permission covers all 4 apps.' }), btn, state);
  }
  function renderKidHome() {
    var main = shell('Family apps', 'This laptop is connected to the family', true);
    main.appendChild(h('section.card.hero.kidhero', null, h('h2', { text: 'All set ✔' }), h('p', { text: 'Settings come from the grown-up\'s Family Hub. Progress is saved here first and backed up automatically.' }), appButtons()));
    main.appendChild(micCard());
    main.appendChild(h('details.card.small', null, h('summary', { text: 'Not his laptop?' }), h('button.btn.link.danger', { text: 'Disconnect this browser', on: { click: function () { if (confirm('Disconnect this browser from the family? Progress stays on this laptop.')) { FS.disconnect(); route(); } } } })));
  }
  function renderJoin(force) {
    var main = shell('Connecting this laptop', 'One time per laptop · about 30 seconds', true);
    var j = stash.join;
    if (!j) { main.appendChild(h('div.card.bad', null, h('h2', { text: 'This link is not complete' }), h('p', { text: 'Copy the whole link from the Family Hub (Connect each laptop › Copy link) and open it again.' }))); return; }
    if (FS.role() === 'grownup' && !force) {
      main.appendChild(h('div.card.warn', null, h('h2', { text: 'This is your grown-up laptop' }), h('p', { text: 'Open this link on his laptop instead. Using it here would turn this browser into his device.' }),
        h('div.row', null, h('a.btn.primary', { href: HUB_URL, text: 'Open the Family Hub', on: { click: function (e) { e.preventDefault(); stash.join = null; route(); } } }),
          h('button.btn.link.danger', { text: 'This really is his laptop — connect it', on: { click: function () { if (confirm('Make this browser his laptop? It stops being a grown-up device.')) { FS.disconnect(); renderJoin(true); } } } }))));
      return;
    }
    var steps = h('ol.progress', null, h('li', { id: 'j1', text: 'Checking the family link…' }), h('li', { id: 'j2', text: 'Keeping his progress' }), h('li', { id: 'j3', text: 'Getting the settings' }));
    var box = h('section.card.hero', null, h('h2', { text: 'Connecting…' }), steps);
    main.appendChild(box);
    function mark(id, text, ok) { var li = document.getElementById(id); if (li) { li.textContent = text; li.className = ok === false ? 'bad' : 'ok'; } }
    FS.connect(Object.assign({}, j, { role: 'kid' })).then(function (rep) {
      mark('j1', 'Family link saved for all 4 apps ✔', true);
      var prog = rep.downloaded.length ? 'His progress restored from the family backup ✔' + (rep.backups.length ? ' (this laptop\'s older copy is kept)' : '') : rep.uploaded.length ? 'His progress on this laptop is kept and backed up ✔' : 'Progress ready ✔';
      mark('j2', prog, true);
      mark('j3', (rep.settings.length ? rep.settings.length + ' settings from the Family Hub ✔' : 'Settings ready ✔') + (FS.pinIsSet() ? ' · family PIN' : ''), true);
      box.querySelector('h2').textContent = 'All set!';
      main.appendChild(micCard());
      main.appendChild(h('section.card', null, h('h3', { text: 'Open an app' }), appButtons()));
    }, function (e) {
      var code = e && e.code;
      mark('j1', code === 'auth' ? 'This family link is no longer valid. Ask for a new link from the Family Hub.' : code === 'network' || code === 'timeout' ? 'Can\'t reach the family backend. Check the internet connection, then try again.' : (e && e.message) || 'Something went wrong.', false);
      box.querySelector('h2').textContent = 'Not connected yet';
      box.appendChild(h('button.btn.primary.big', { text: 'Try again', on: { click: function () { renderJoin(true); } } }));
    });
  }

  try { boot(); } catch (e) { (window.__hubError || function () {})(e); throw e; }
  window.__hub = { route: route, ui: ui };
})();
