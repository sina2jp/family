/*! codes.js - reads the two private setup codes exactly the way the apps do (parsers copied from the apps' sources):
 *   "MA1:" + base64 JSON = Math Arena school sync   -> mathArena.v3.schoolSync.v1
 *   "MQ1:" + base64 JSON = Music Quest piano lessons -> musicQuest.myLessons.v1
 * FamilyCodes.read(text) -> [{kind:'math'|'music', key, value(object), summary, error?}] */
(function (root) {
  'use strict';
  // ---- Math Arena (src/codex/sync.js) ----
  var MA = (function () {
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const S = (v, n = 120) => String(v == null ? '' : v).replace(/[<>]/g, '').trim().slice(0, n);
const arr = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
const ids = (v) => arr(v, 12).map((x) => S(x, 60).toLowerCase()).filter((x) => /^[a-z0-9-]+$/.test(x));

/** Local Sunday (YYYY-MM-DD) of the week holding a date. */
function weekOf(dateLike) {
  const t = typeof dateLike === 'number' ? dateLike : Date.parse(String(dateLike || '').length === 10 ? `${dateLike}T12:00:00` : dateLike);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
  return `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}-${String(s.getDate()).padStart(2, '0')}`;
}

/** Decode and clean a code. Returns { ok, data, error }. Never throws. */
function parseSync(code) {
  const raw = String(code || '').trim();
  if (!raw.startsWith('MA1:')) return { ok: false, error: 'The code should start with MA1:' };
  let json;
  try {
    const b64 = raw.slice(4).replace(/\s+/g, '');
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { ok: false, error: 'That code could not be read. Copy it again, all of it.' };
  }
  if (!json || typeof json !== 'object') return { ok: false, error: 'That code is empty.' };
  const programs = arr(json.programs, 20)
    .map((p) => ({ id: S(p && p.id, 40), label: S(p && p.label, 60), day: DAYS.includes(p && p.day) ? p.day : '', time: /^\d{1,2}:\d{2}$/.test(String(p && p.time)) ? String(p.time) : '' }))
    .filter((p) => p.id && p.label);
  const pids = new Set(programs.map((p) => p.id));
  const weeks = arr(json.weeks, 60)
    .map((w) => ({
      weekOf: weekOf(w && w.weekOf),
      items: arr(w && w.items, 30)
        .map((it) => ({
          programId: S(it && it.programId, 40),
          topic: S(it && it.topic),
          codexIds: ids(it && it.codexIds),
          homework: S(it && it.homework),
          termsUsed: Object.fromEntries(Object.entries((it && it.termsUsed) || {}).slice(0, 12).map(([k, v]) => [S(k, 60), S(v, 60)]).filter(([k, v]) => k && v)),
        }))
        .filter((it) => it.topic && (!it.programId || pids.has(it.programId))),
    }))
    .filter((w) => w.weekOf);
  const books = arr(json.books, 20)
    .map((b) => ({
      id: S(b && b.id, 40),
      label: S(b && b.label, 60),
      tasks: arr(b && b.tasks, 200).map((t) => ({ pages: S(t && t.pages, 40), codexIds: ids(t && t.codexIds), due: /^\d{4}-\d{2}-\d{2}$/.test(String(t && t.due)) ? String(t.due) : '' })).filter((t) => t.pages),
    }))
    .filter((b) => b.id && b.label);
  const focus = ids(json.focus);
  const methods = arr(json.methods, 60)
    .map((m) => ({ codexId: S(m && m.codexId, 60).toLowerCase(), programId: S(m && m.programId, 40), theirMethod: S(m && m.theirMethod), link: S(m && m.link) }))
    .filter((m) => m.codexId && m.theirMethod);
  return { ok: true, data: { v: 1, programs, weeks, books, focus, methods, importedAt: Date.now() } };
}

    return { parseSync: parseSync, weekOf: weekOf };
  })();
  var parseSync = MA.parseSync, weekOf = MA.weekOf;
  // ---- Music Quest (src/10-mylessons.js) ----
  var L = (function () {
  var L = {};
  L.SKILLS = ['hands-separate', 'hands-together', 'staccato', 'legato', 'slurs', 'dynamics', 'crescendo', 'fingering', 'position', 'position-shift', 'thumb-under', 'finger-crossing', 'rhythm', 'counting', 'rests', 'eighth-notes', 'dotted-notes', 'ties', '3/4-time', '6/8-time', 'sharps-flats', 'accidentals', 'chords', 'scales', 'pedal', 'tempo', 'phrasing', 'memorize', 'sight-reading', 'bass-clef', 'ledger-lines',
    // also accepted (teacher focus drills)
    'octaves', 'octave-jumps', 'syncopation', 'alberti-bass', 'harmonic-minor', 'sixteenths', 'hand-crossing'];
  var DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  L.DAYS = DAYS;
  function str(v, max) { if (v == null) return ''; return String(v).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max || 200); }
  function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
  function num(v, lo, hi, d) { var n = Number(v); return isFinite(n) && n >= lo && n <= hi ? Math.round(n) : d; }
  var KEY_RE = /^\s*([A-Ga-g])\s*([#b♯♭])?\s*(major|minor|maj|min|m)?\s*$/i;
  /** normalize "db major", "A minor", "Ab", "F# minor" -> "Db major" etc. Returns null if not a key. */
  L.normKey = function (k) {
    var m = KEY_RE.exec(String(k || '')); if (!m) return null;
    var acc = m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : (m[2] || '');
    var mode = /^(minor|min|m)$/i.test(m[3] || '') ? 'minor' : 'major';
    return m[1].toUpperCase() + acc + ' ' + mode;
  };
  /** decode a lesson code: "MQ1:<base64>", plain base64, or raw JSON */
  L.decode = function (code) {
    if (code && typeof code === 'object') return code;
    var s = String(code || '').trim();
    if (!s) throw new Error('The lesson code is empty.');
    if (s[0] === '{') return JSON.parse(s);
    s = s.replace(/^MQ1:/i, '').replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var txt;
    try {
      var bin = (root.atob ? root.atob(s) : Buffer.from(s, 'base64').toString('binary'));
      txt = decodeURIComponent(Array.prototype.map.call(bin, function (c) { return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2); }).join(''));
    } catch (e) { throw new Error('That code could not be read. Check it was copied fully.'); }
    try { return JSON.parse(txt); } catch (e) { throw new Error('The code was read, but it is not valid lesson data.'); }
  };
  L.encode = function (obj) {
    var json = JSON.stringify(obj);
    var bin = unescape(encodeURIComponent(json));
    return 'MQ1:' + (root.btoa ? root.btoa(bin) : Buffer.from(bin, 'binary').toString('base64'));
  };
  /** validate + fill defaults. Returns {data, warnings}. Throws a friendly Error when unusable. */
  L.normalize = function (raw) {
    if (!raw || typeof raw !== 'object') throw new Error('Lesson data must be a JSON object.');
    var w = [];
    var out = { schema: 'music-quest/lessons@1', updated: isDate(raw.updated) ? raw.updated : null };
    var ld = raw.lessonDay;
    if (typeof ld === 'number' && ld >= 0 && ld <= 6) out.lessonDay = ld;
    else if (typeof ld === 'string' && DAYS.indexOf(ld.trim().toLowerCase()) >= 0) out.lessonDay = DAYS.indexOf(ld.trim().toLowerCase());
    else if (typeof ld === 'string' && DAYS.map(function (d) { return d.slice(0, 3); }).indexOf(ld.trim().toLowerCase().slice(0, 3)) >= 0) out.lessonDay = DAYS.map(function (d) { return d.slice(0, 3); }).indexOf(ld.trim().toLowerCase().slice(0, 3));
    else { out.lessonDay = null; if (ld != null) w.push('lessonDay not understood: ' + ld); }
    out.lessonTime = /^\d{1,2}:\d{2}$/.test(String(raw.lessonTime || '')) ? String(raw.lessonTime) : null;
    out.teacherNotes = str(raw.teacherNotes, 400);
    out.weeklyGoals = Array.isArray(raw.weeklyGoals) ? raw.weeklyGoals.map(function (g) { return str(g, 120); }).filter(Boolean).slice(0, 6) : [];
    out.recital = null;
    if (raw.recital && typeof raw.recital === 'object' && isDate(raw.recital.date)) out.recital = { date: raw.recital.date, title: str(raw.recital.title, 80) || 'Recital', pieceIds: Array.isArray(raw.recital.pieceIds) ? raw.recital.pieceIds.map(String).slice(0, 6) : [] };
    else if (raw.recital) w.push('recital needs a date (YYYY-MM-DD)');
    out.technique = (Array.isArray(raw.technique) ? raw.technique : []).slice(0, 12).map(function (t, i) {
      if (!t || typeof t !== 'object') return null;
      var name = str(t.name, 80); if (!name) { w.push('technique item ' + (i + 1) + ' has no name'); return null; }
      var key = L.normKey(t.key) || (t.key ? (w.push('technique key not understood: ' + t.key), null) : null);
      return { id: str(t.id, 40) || 't' + (i + 1), name: name, type: ['scale', 'five-finger', 'arpeggio', 'chord', 'exercise'].indexOf(t.type) >= 0 ? t.type : 'exercise', key: key, hands: ['RH', 'LH', 'separate', 'together'].indexOf(t.hands) >= 0 ? t.hands : 'separate', octaves: num(t.octaves, 1, 4, 1), targetTempo: num(t.targetTempo, 30, 240, null), notes: str(t.notes, 200) };
    }).filter(Boolean);
    if (!Array.isArray(raw.pieces) || !raw.pieces.length) throw new Error('Add at least one piece (pieces[] with a title).');
    var ids = {};
    out.pieces = raw.pieces.slice(0, 20).map(function (p, i) {
      if (!p || typeof p !== 'object') return null;
      var title = str(p.title, 80); if (!title) { w.push('piece ' + (i + 1) + ' has no title (skipped)'); return null; }
      var id = str(p.id, 40) || 'p' + (i + 1); while (ids[id]) id += 'x'; ids[id] = 1;
      var key = L.normKey(p.key);
      if (p.key && !key) w.push('"' + title + '": key not understood (' + p.key + '), using C major');
      var ts = /^(2|3|4|5|6|9|12)\/(2|4|8)$/.test(String(p.timeSignature || '')) ? String(p.timeSignature) : '4/4';
      var target = num(p.targetTempo, 30, 240, 96);
      var measures = num(p.measures, 1, 400, null);
      var chunks = Array.isArray(p.chunks) ? p.chunks.filter(function (c) { return Array.isArray(c) && c.length === 2 && +c[0] >= 1 && +c[1] >= +c[0]; }).map(function (c) { return [+c[0], +c[1]]; }).slice(0, 30) : [];
      var unknown = !measures && !chunks.length;
      if (!chunks.length) { var M = measures || 16; for (var s = 1; s <= M; s += 4) chunks.push([s, Math.min(M, s + 3)]); }
      var focus = Array.isArray(p.focusChunks) ? p.focusChunks.filter(function (c) { return Array.isArray(c) && c.length === 2; }).map(function (c) { return [+c[0], +c[1]]; }).slice(0, 6) : [];
      var skills = (Array.isArray(p.skills) ? p.skills : []).map(function (s) { return String(s).toLowerCase().trim(); }).filter(function (s, k, a) { return L.SKILLS.indexOf(s) >= 0 && a.indexOf(s) === k; });
      return {
        id: id, instrument: p.instrument === 'recorder' ? 'recorder' : 'piano', title: title, book: str(p.book, 80), page: str(p.page, 20),
        key: key || 'C major', timeSignature: ts, targetTempo: target, startTempo: num(p.startTempo, 20, 240, Math.round(target * 0.6)),
        measures: measures, measuresUnknown: unknown, chunks: chunks, focusChunks: focus,
        hands: ['RH', 'LH', 'separate', 'together'].indexOf(p.hands) >= 0 ? p.hands : 'separate', position: str(p.position, 40),
        skills: skills, teacherNotes: str(p.teacherNotes, 300), dueDate: isDate(p.dueDate) ? p.dueDate : null, memorize: p.memorize === true,
        status: ['new', 'learning', 'polishing', 'ready'].indexOf(p.status) >= 0 ? p.status : 'learning',
      };
    }).filter(Boolean);
    if (!out.pieces.length) throw new Error('No piece had a title.');
    return { data: out, warnings: w };
  };


    return L;
  })();
  function summaryMath(d) { return (d.programs || []).length + ' classes, ' + (d.weeks || []).length + ' weeks, ' + (d.books || []).length + ' books'; }
  function summaryMusic(d) { return (d.pieces || []).length + ' pieces, ' + (d.technique || []).length + ' technique items'; }
  /** Find every MA1:/MQ1: code in a pasted text (or an #import= fragment) and read each one. */
  function read(text) {
    // Codes are one long base64 word. Mail apps sometimes wrap them, so long base64-only lines that follow are joined.
    var toks = String(text || '').split(/\s+/), codes = [], cur = null;
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i], m = /(MA1|MQ1):([A-Za-z0-9+\/=_-]*)/.exec(t);
      if (m) { if (cur) codes.push(cur); cur = m[1] + ':' + m[2]; continue; }
      if (cur && /^[A-Za-z0-9+\/=_-]{16,}$/.test(t) && !/=$/.test(cur)) cur += t; else if (cur) { codes.push(cur); cur = null; }
    }
    if (cur) codes.push(cur);
    var out = [];
    codes.forEach(function (code) {
      if (code.indexOf('MA1:') === 0) {
        var r = parseSync(code);
        out.push(r.ok ? { kind: 'math', key: 'mathArena.v3.schoolSync.v1', value: r.data, summary: summaryMath(r.data) } : { kind: 'math', error: r.error });
      } else {
        try {
          var res = L.normalize(L.decode(code));
          res.data.importedAt = new Date().toISOString();
          out.push({ kind: 'music', key: 'musicQuest.myLessons.v1', value: res.data, summary: summaryMusic(res.data), warnings: res.warnings });
        } catch (e) { out.push({ kind: 'music', error: e && e.message ? e.message : 'That lesson code could not be read.' }); }
      }
    });
    return out;
  }
  root.FamilyCodes = { read: read, parseMath: parseSync, music: L, weekOf: weekOf };
})(typeof globalThis !== 'undefined' ? globalThis : this);
