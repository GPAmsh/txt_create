(function () {
  'use strict';

  var ITEMS = [
    { key: 'order', label: '주문수량', short: '주문' },
    { key: 'setting', label: '세팅수량', short: '세팅' },
    { key: 'done', label: '완료수량', short: '완료' }
  ];
  var FIELDS = {
    base: [{ key: 'date', label: '날짜' }, { key: 'burn', label: '소진량' }, { key: 'order', label: '주문' }, { key: 'setting', label: '세팅' }, { key: 'done', label: '완료' }],
    inc: [{ key: 'date', label: '날짜' }, { key: 'order', label: '주문' }, { key: 'setting', label: '세팅' }, { key: 'done', label: '완료' }]
  };
  var HEADER_SCAN_ROWS = 30;
  var EPS = 1e-9;

  var state = {
    files: { base: [], inc: [] },   // { id, file, label, sheets, sheet, headerRow, headers, map, error }
    nextId: 1,
    pickKind: 'base',
    ran: false,
    result: null,
    tab: 't1',
    sort: { t1: { key: 'date', dir: 1 }, t2: { key: 'date', dir: 1 } }
  };
  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function round(n) { return Math.round(n * 1e6) / 1e6; }
  function fmt(n) { return n == null ? '' : round(n).toLocaleString('ko-KR', { maximumFractionDigits: 6 }); }
  function fmtSigned(n) { return (n > EPS ? '+' : '') + fmt(n); }

  // ---------- 열 제목 ----------
  function norm(v) { return String(v == null ? '' : v).normalize('NFC').replace(/[\s​-‍﻿]/g, '').toLowerCase(); }
  function fieldScore(kind, field, h) {
    if (!h) return 0;
    if (field === 'date') {
      if (['날짜', '일자', 'date', '일시', '기준일', '기준일자', '날짜(일자)'].indexOf(h) >= 0) return 3;
      return /^(날짜|일자)/.test(h) ? 2 : 0;
    }
    if (kind === 'inc' && h.indexOf('누적') >= 0) return 0;
    var word = { burn: ['소진'], order: ['주문'], setting: ['세팅', '셋팅', 'setting'], done: ['완료'] }[field];
    if (!word.some(function (w) { return h.indexOf(w) >= 0; })) return 0;
    var s = 1;
    if (kind === 'inc' && h.indexOf('증가') >= 0) s += 2;
    if (kind === 'base' && (h.indexOf('증가') >= 0 || h.indexOf('누적') >= 0)) s -= 0.5;
    if (h.length <= 4) s += 1;   // '주문수량', '소진량' 같은 짧은 제목 우선
    return s;
  }
  function autoMap(kind, headers) {
    var map = {}, used = {};
    FIELDS[kind].forEach(function (f) {
      var best = -1, bestScore = 0;
      headers.forEach(function (h, c) {
        if (used[c]) return;
        var s = fieldScore(kind, f.key, norm(h));
        if (s > bestScore) { bestScore = s; best = c; }
      });
      map[f.key] = best;
      if (best >= 0) used[best] = true;
    });
    return map;
  }

  // ---------- 값 ----------
  function cellText(cell) {
    if (!cell || cell.v == null || cell.t === 'e' || cell.t === 'z') return '';
    return String(cell.v);
  }
  function ymd(y, m, d) {
    if (!(y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1)) return null;
    if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
    return y + '-' + pad(m) + '-' + pad(d);
  }
  function serialToDate(n, d1904) {
    if (!(n >= 1 && n < 2958466)) return null;
    var p = XLSX.SSF.parse_date_code(n, { date1904: d1904 });
    return p ? ymd(p.y, p.m, p.d) : null;
  }
  function yyyymmdd(v) {
    var s = String(v);
    return /^\d{8}$/.test(s) ? ymd(+s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8)) : null;
  }
  function parseDateString(s, d1904) {
    s = s.normalize('NFC').trim();
    if (!s) return null;
    var m = s.match(/^(\d{4})\s*[-\/.년]\s*(\d{1,2})\s*[-\/.월]\s*(\d{1,2})(?!\d)/);
    if (m) return ymd(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{8})(?!\d)/);
    if (m) return yyyymmdd(m[1]);
    m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})(?!\d)/);
    if (m) { var a = +m[1], b = +m[2]; return a > 12 ? ymd(+m[3], b, a) : ymd(+m[3], a, b); }
    if (/^\d{1,7}(\.\d+)?$/.test(s)) return serialToDate(+s, d1904);
    if (/[a-z]{3}/i.test(s) && /\d{4}/.test(s)) {
      var t = Date.parse(s);
      if (!isNaN(t)) { var dt = new Date(t); return ymd(dt.getFullYear(), dt.getMonth() + 1, dt.getDate()); }
    }
    return null;
  }
  function parseDateCell(cell, d1904) {
    if (!cell || cell.v == null || cell.t === 'e' || cell.t === 'z') return null;
    if (cell.t === 'n') return yyyymmdd(cell.v) || serialToDate(cell.v, d1904);
    if (cell.t === 'd') { var d = new Date(cell.v); return isNaN(d) ? null : ymd(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
    return parseDateString(String(cell.v), d1904);
  }
  // 반환: { empty:true } | { num:n } | { bad:'원래 값' }
  function parseNum(cell) {
    if (!cell || cell.v == null || cell.t === 'z') return { empty: true };
    if (cell.t === 'n') return isFinite(cell.v) ? { num: cell.v } : { bad: String(cell.v) };
    if (cell.t === 'e') return { bad: cell.w || '#오류' };
    if (cell.t === 'b') return { bad: cell.v ? 'TRUE' : 'FALSE' };
    var s = String(cell.v).normalize('NFC').trim();
    if (!s || s === '-' || s === '–') return { empty: true };
    var t = s.replace(/[,\s]/g, '');
    if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return { num: +t };
    return { bad: s };
  }

  // ---------- 파일 읽기 ----------
  function Problem(msg) { this.message = msg; }

  async function readWorkbook(file) {
    var buf;
    try { buf = await file.arrayBuffer(); } catch (e) { throw new Problem('파일을 읽을 수 없습니다. 다시 올려 주세요.'); }
    if (!buf.byteLength) throw new Problem('내용이 비어 있는 파일입니다(0바이트).');
    var sig = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
    if (sig[0] === 0xD0 && sig[1] === 0xCF) throw new Problem('암호가 걸렸거나 옛 형식(.xls) 파일이라 열 수 없습니다. 엑셀에서 .xlsx로 다시 저장해 주세요.');
    if (!(sig[0] === 0x50 && sig[1] === 0x4B)) throw new Problem('정상적인 .xlsx 파일이 아닙니다(손상되었거나 확장자만 .xlsx).');
    try { return XLSX.read(buf, { type: 'array', cellDates: false, cellFormula: false, cellHTML: false }); }
    catch (e) { throw new Problem('엑셀 파일로 읽을 수 없습니다(손상된 파일). 엑셀에서 열어 다시 저장해 보세요.'); }
  }

  // 시트마다 위쪽 행에서 '날짜 + 항목' 제목이 가장 많이 맞는 행을 제목 행으로 고른다
  function detect(kind, wb) {
    var best = null;
    wb.SheetNames.forEach(function (name) {
      var ws = wb.Sheets[name];
      if (!ws || !ws['!ref']) return;
      var rg = XLSX.utils.decode_range(ws['!ref']);
      for (var r = rg.s.r; r <= Math.min(rg.e.r, rg.s.r + HEADER_SCAN_ROWS - 1); r++) {
        var headers = [];
        for (var c = 0; c <= rg.e.c; c++) headers.push(cellText(ws[XLSX.utils.encode_cell({ r: r, c: c })]).trim());
        var map = autoMap(kind, headers);
        var score = 0;
        FIELDS[kind].forEach(function (f) { if (map[f.key] >= 0) score += f.key === 'date' ? 2 : 1; });
        if (score > 0 && (!best || score > best.score)) best = { score: score, sheet: name, headerRow: r, headers: headers, map: map };
      }
    });
    return best;
  }

  async function loadEntry(kind, entry) {
    try {
      var wb = await readWorkbook(entry.file);
      var hasData = wb.SheetNames.some(function (n) {
        var ws = wb.Sheets[n];
        return ws && Object.keys(ws).some(function (k) { return k.charAt(0) !== '!' && cellText(ws[k]).trim(); });
      });
      if (!hasData) throw new Problem('내용이 비어 있는 파일입니다.');
      var d = detect(kind, wb);
      if (!d) throw new Problem('날짜·수량 열 제목을 하나도 찾지 못했습니다. 열 제목(날짜, 소진량, 주문수량 등)을 확인해 주세요.');
      entry.wb = wb;
      entry.d1904 = !!(wb.Workbook && wb.Workbook.WBProps && wb.Workbook.WBProps.date1904);
      entry.sheet = d.sheet;
      entry.headerRow = d.headerRow;
      entry.headers = d.headers;
      entry.map = d.map;
      entry.multiSheet = wb.SheetNames.length > 1;
    } catch (e) {
      entry.error = e instanceof Problem ? e.message : '알 수 없는 오류: ' + (e && e.message || e);
    }
  }

  // 매핑대로 행을 읽는다. 원본은 건드리지 않는다
  function extract(kind, entry) {
    var ws = entry.wb.Sheets[entry.sheet];
    var rg = XLSX.utils.decode_range(ws['!ref']);
    var map = entry.map, out = [], warn = { badDate: 0, badNum: [], noDateRows: 0 };
    var cols = FIELDS[kind].filter(function (f) { return f.key !== 'date' && map[f.key] >= 0; });
    for (var r = entry.headerRow + 1; r <= rg.e.r; r++) {
      var get = function (c) { return ws[XLSX.utils.encode_cell({ r: r, c: c })]; };
      var vals = {}, any = false;
      cols.forEach(function (f) {
        var p = parseNum(get(map[f.key]));
        if (!p.empty) any = true;
        vals[f.key] = p;
      });
      var dc = get(map.date), raw = cellText(dc).trim();
      if (!raw && !any) continue;                       // 빈 행
      var date = parseDateCell(dc, entry.d1904);
      if (!date) {
        if (/합계|총계|소계|total|sum/i.test(raw)) continue;   // 합계 행은 조용히 건너뜀
        if (any || raw) warn.noDateRows++;
        continue;
      }
      cols.forEach(function (f) {
        if (vals[f.key].bad != null) warn.badNum.push(date + ' ' + f.label + '="' + vals[f.key].bad + '"');
      });
      out.push({ date: date, vals: vals, row: r + 1 });
    }
    return { rows: out, warn: warn };
  }

  // ---------- 계산 ----------
  function readInputs() {
    var v = function (id) { var s = $(id).value.trim(); return s === '' ? null : Number(s); };
    return { baseDate: $('baseDate').value || '', pre: { order: v('preOrder'), setting: v('preSetting'), done: v('preDone') } };
  }

  function compute() {
    var inp = readInputs();
    var problems = [];
    if (!inp.baseDate) problems.push('기준 날짜를 선택해 주세요.');
    ITEMS.forEach(function (it) { var p = inp.pre[it.key]; if (p != null && !isFinite(p)) problems.push(it.label + ' 진행전 수치가 숫자가 아닙니다.'); });
    var baseOk = state.files.base.filter(function (e) { return !e.error && e.map.date >= 0; });
    var incOk = state.files.inc.filter(function (e) { return !e.error && e.map.date >= 0; });
    if (!state.files.base.length && !state.files.inc.length) problems.push('기준 데이터 또는 날짜별 증가량 파일을 올려 주세요.');
    else if (!baseOk.length && !incOk.length) problems.push('읽을 수 있는 파일이 없습니다. 파일 아래 오류 내용을 확인해 주세요.');
    if (problems.length) return { problems: problems };

    var B = inp.baseDate;
    var notes = [];
    var fileWarn = {};

    // 증가량: 같은 날짜는 합산
    var incAvail = {}, inc = new Map(), incBefore = 0;
    incOk.forEach(function (e) {
      ITEMS.forEach(function (it) { if (e.map[it.key] >= 0) incAvail[it.key] = true; });
      var x = extract('inc', e);
      fileWarn[e.id] = x.warn;
      x.rows.forEach(function (row) {
        if (row.date < B) { incBefore++; return; }
        var a = inc.get(row.date);
        if (!a) { a = { rows: 0, order: 0, setting: 0, done: 0 }; inc.set(row.date, a); }
        a.rows++;
        ITEMS.forEach(function (it) { var p = row.vals[it.key]; if (p && p.num != null) a[it.key] += p.num; });
      });
    });

    // 증가량 파일이 아예 없으면 모든 날짜 증가량 0
    if (!incOk.length) ITEMS.forEach(function (it) { incAvail[it.key] = true; });

    // 기준 데이터: 소진량은 합산, 주문·세팅·완료는 '그 날짜의 수치'라서 합산하지 않고 값이 하나인지 확인
    var baseAvail = { burn: false }, base = new Map(), baseBefore = 0;
    baseOk.forEach(function (e) {
      ['burn'].concat(ITEMS.map(function (i) { return i.key; })).forEach(function (k) { if (e.map[k] >= 0) baseAvail[k] = true; });
      var x = extract('base', e);
      fileWarn[e.id] = x.warn;
      x.rows.forEach(function (row) {
        if (row.date < B) { baseBefore++; return; }
        var a = base.get(row.date);
        if (!a) { a = { burn: null, order: [], setting: [], done: [] }; base.set(row.date, a); }
        var b = row.vals.burn;
        if (b && b.num != null) a.burn = (a.burn || 0) + b.num;
        ITEMS.forEach(function (it) { var p = row.vals[it.key]; if (p && p.num != null && a[it.key].indexOf(p.num) < 0) a[it.key].push(p.num); });
      });
    });

    var dateSet = new Set([B]);
    inc.forEach(function (_, d) { dateSet.add(d); });
    base.forEach(function (_, d) { dateSet.add(d); });
    var dates = Array.from(dateSet).sort();

    var before = [];
    if (incBefore) before.push('증가량 ' + incBefore + '행');
    if (baseBefore) before.push('기준 데이터 ' + baseBefore + '행');
    if (before.length) notes.push('기준 날짜(' + B + ') 이전 데이터는 누적 계산에서 제외했습니다: ' + before.join(', ') + '.');
    if (!incOk.length) notes.push('날짜별 증가량 파일이 없어 모든 증가량을 0으로 계산했습니다.');
    if (!baseOk.length) notes.push('기준 데이터 파일이 없어 수치 대조는 모두 "비교 불가"입니다.');
    if (dates.length === 1 && !inc.has(B) && !base.has(B)) notes.push('기준 날짜 이후(당일 포함)에 해당하는 데이터가 없습니다. 기준 날짜를 확인해 주세요.');

    var cum = { order: 0, setting: 0, done: 0 }, cumBurn = 0;
    var t1 = [], t2 = [], daily = [];
    var tot = { burn: 0, order: 0, setting: 0, done: 0 }, cnt = { ok: 0, bad: 0, na: 0 };
    dates.forEach(function (d) {
      var ia = inc.get(d), ba = base.get(d);
      var dayInc = {};
      ITEMS.forEach(function (it) {
        dayInc[it.key] = incAvail[it.key] ? (ia ? ia[it.key] : 0) : null;
        if (dayInc[it.key] != null) { cum[it.key] += dayInc[it.key]; tot[it.key] += dayInc[it.key]; }
      });
      var burn = ba ? ba.burn : null;
      if (burn != null) { cumBurn += burn; tot.burn += burn; }

      var progress = {};
      ITEMS.forEach(function (it) {
        var pre = inp.pre[it.key];
        var prog = (pre != null && incAvail[it.key]) ? round(pre + cum[it.key]) : null;
        progress[it.key] = prog;
        var vals = ba ? ba[it.key] : [];
        var row = { date: d, item: it.label, itemKey: it.key, base: null, inc: dayInc[it.key], incRecorded: !!ia, prog: prog, diff: null, status: 'na', why: '' };
        if (!baseAvail[it.key]) row.why = baseOk.length ? '기준 데이터에 ' + it.label + ' 열 없음' : '기준 데이터 파일 없음';
        else if (!vals.length) row.why = '기준 데이터에 이 날짜 값 없음';
        else if (vals.length > 1) row.why = '같은 날짜에 값이 여러 개(' + vals.map(fmt).join(', ') + ')';
        else row.base = vals[0];
        if (row.base != null) {
          if (pre == null) row.why = '진행전 ' + it.label + ' 미입력';
          else if (!incAvail[it.key]) row.why = '증가량 파일에 ' + it.label + ' 열 없음';
          else { row.diff = round(row.base - prog); row.status = Math.abs(row.diff) < EPS ? 'ok' : 'bad'; }
        }
        cnt[row.status]++;
        t1.push(row);
      });

      t2.push({ date: d, burn: burn, burnRecorded: !!(ba && burn != null), incRecorded: !!ia,
        order: dayInc.order, setting: dayInc.setting, done: dayInc.done,
        cumBurn: cumBurn, cumOrder: incAvail.order ? cum.order : null, cumSetting: incAvail.setting ? cum.setting : null, cumDone: incAvail.done ? cum.done : null });
      daily.push({ date: d, inc: dayInc, prog: progress, burn: burn, cumBurn: cumBurn });
    });

    return { inputs: inp, dates: dates, t1: t1, t2: t2, daily: daily, tot: tot, cnt: cnt, notes: notes, fileWarn: fileWarn,
      incAvail: incAvail, baseAvail: baseAvail, baseFiles: baseOk, incFiles: incOk };
  }

  // ---------- 파일 목록 ----------
  function addFiles(kind, list) {
    var rejected = [], dupl = [], added = [];
    Array.prototype.forEach.call(list, function (f) {
      if (!/\.xlsx$/i.test(f.name)) { rejected.push(f.name); return; }
      var all = state.files.base.concat(state.files.inc);
      if (all.some(function (e) { return e.file.name === f.name && e.file.size === f.size && e.file.lastModified === f.lastModified; })) { dupl.push(f.name); return; }
      var n = all.filter(function (e) { return e.file.name === f.name; }).length;
      var entry = { id: state.nextId++, file: f, label: n ? f.name + ' (' + (n + 1) + ')' : f.name, loading: true };
      state.files[kind].push(entry);
      added.push(entry);
    });
    var msgs = [];
    if (rejected.length) msgs.push('.xlsx 파일만 올릴 수 있어 제외했습니다: ' + rejected.join(', '));
    if (dupl.length) msgs.push('이미 올린 파일이라 제외했습니다(같은 파일을 두 번 넣으면 증가량이 두 번 더해집니다): ' + dupl.join(', '));
    $('addNotice').textContent = msgs.join(' / ');
    $('addNotice').classList.toggle('hidden', !msgs.length);
    renderFiles();
    return Promise.all(added.map(function (e) {
      return loadEntry(kind, e).then(function () { e.loading = false; renderFiles(); changed(); });
    }));
  }
  function findEntry(id) {
    var all = state.files.base.concat(state.files.inc);
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }
  function removeFile(id) {
    ['base', 'inc'].forEach(function (k) { state.files[k] = state.files[k].filter(function (e) { return e.id !== id; }); });
    renderFiles();
    changed();
  }

  function renderFiles() {
    ['base', 'inc'].forEach(function (kind) {
      var box = $(kind === 'base' ? 'listBase' : 'listInc');
      var warnMap = state.result && state.result.fileWarn || {};
      box.innerHTML = state.files[kind].map(function (e) {
        var cls = e.error ? ' err' : '';
        var msgs = [], meta = '';
        if (e.loading) meta = '읽는 중…';
        else if (e.error) msgs.push(e.error);
        else {
          meta = (e.multiSheet ? '[' + e.sheet + '] 시트, ' : '') + (e.headerRow + 1) + '행이 제목 행';
          var miss = FIELDS[kind].filter(function (f) { return e.map[f.key] < 0; }).map(function (f) { return f.label; });
          if (e.map.date < 0) { msgs.push('날짜 열을 찾지 못해 이 파일은 계산에서 빠집니다. 아래에서 날짜 열을 골라 주세요.'); cls = ' err'; }
          else if (miss.length) msgs.push('찾지 못한 열: ' + miss.join(', ') + (kind === 'inc' ? ' (해당 항목 증가량 없음)' : ' (해당 항목은 비교 불가)'));
          var w = warnMap[e.id];
          if (w) {
            if (w.noDateRows) msgs.push('날짜를 읽지 못한 행 ' + w.noDateRows + '개는 제외했습니다.');
            if (w.badNum.length) msgs.push('숫자가 아닌 값 ' + w.badNum.length + '개는 ' + (kind === 'inc' ? '0으로' : '"값 없음"으로') + ' 처리: ' + w.badNum.slice(0, 5).join(', ') + (w.badNum.length > 5 ? ' 외' : ''));
          }
          if (!cls && msgs.length) cls = ' warn';
        }
        var maps = '';
        if (!e.loading && !e.error) {
          maps = '<div class="maps">' + FIELDS[kind].map(function (f) {
            var opts = '<option value="-1">(없음)</option>' + e.headers.map(function (h, c) {
              return h ? '<option value="' + c + '"' + (e.map[f.key] === c ? ' selected' : '') + '>' + esc(XLSX.utils.encode_col(c) + ': ' + h) + '</option>' : '';
            }).join('');
            return '<label>' + esc(f.label) + ' <select data-map="' + e.id + '" data-field="' + f.key + '">' + opts + '</select></label>';
          }).join('') + '</div>';
        }
        return '<div class="fitem' + cls + '"><div class="top"><span class="name">' + esc(e.label) + '</span><button type="button" class="small" data-remove="' + e.id + '">삭제</button></div>' +
          (meta ? '<div class="meta">' + esc(meta) + '</div>' : '') + maps +
          (msgs.length ? '<ul class="msgs">' + msgs.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>' : '') + '</div>';
      }).join('');
    });
  }

  // ---------- 실행 / 다시 계산 ----------
  var timer = null;
  function changed() {
    if (!state.ran) return;
    clearTimeout(timer);
    timer = setTimeout(recalc, 150);
  }
  function recalc() {
    if (state.files.base.concat(state.files.inc).some(function (e) { return e.loading; })) return;
    var res = compute();
    var msg = $('runMsg');
    if (res.problems) {
      state.result = null;
      msg.textContent = res.problems.join(' ');
      msg.classList.remove('hidden');
      $('resultPanel').classList.add('hidden');
      $('exportBtn').disabled = true;
      renderFiles();
      return;
    }
    msg.classList.add('hidden');
    state.result = res;
    $('exportBtn').disabled = false;
    renderFiles();
    renderResult();
  }
  function run() {
    state.ran = true;
    recalc();
    if (state.result) $('resultPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function clearAll() {
    state.files = { base: [], inc: [] };
    state.ran = false;
    state.result = null;
    ['baseDate', 'preOrder', 'preSetting', 'preDone', 'search'].forEach(function (id) { $(id).value = ''; });
    $('statusFilter').value = $('itemFilter').value = '';
    $('addNotice').classList.add('hidden');
    $('runMsg').classList.add('hidden');
    $('resultPanel').classList.add('hidden');
    $('exportBtn').disabled = true;
    renderFiles();
  }

  // ---------- 결과 화면 ----------
  function renderResult() {
    var r = state.result;
    $('resultPanel').classList.remove('hidden');
    var s = [
      ['기준 날짜', r.inputs.baseDate],
      ['분석 대상 날짜 수', r.dates.length + '일'],
      ['전체 소진량', fmt(r.tot.burn)],
      ['전체 주문 증가량', r.incAvail.order ? fmt(r.tot.order) : '열 없음'],
      ['전체 세팅 증가량', r.incAvail.setting ? fmt(r.tot.setting) : '열 없음'],
      ['전체 완료 증가량', r.incAvail.done ? fmt(r.tot.done) : '열 없음'],
      ['일치 항목', r.cnt.ok + '개', 'ok'],
      ['차이 발생 항목', r.cnt.bad + '개', 'bad'],
      ['비교 불가 항목', r.cnt.na + '개', 'na']
    ];
    $('stats').innerHTML = s.map(function (x) {
      return '<div class="stat ' + (x[2] || '') + '"><div class="k">' + esc(x[0]) + '</div><div class="v">' + esc(x[1]) + '</div></div>';
    }).join('');
    var notes = r.notes.slice();
    if (r.dates.length) notes.push('분석 기간: ' + r.dates[0] + ' ~ ' + r.dates[r.dates.length - 1] + ' (두 파일 중 어느 쪽에라도 있는 날짜 + 기준 날짜)');
    if (!r.cnt.ok && !r.cnt.bad) notes.push('비교 가능한 날짜가 없습니다. 기준 데이터에 기준 날짜 이후의 주문·세팅·완료 수치가 있는지 확인해 주세요.');
    $('notes').innerHTML = notes.map(function (n) { return '<div class="alert info">' + esc(n) + '</div>'; }).join('') + (notes.length ? '<div class="spacer"></div>' : '');
    renderTable();
  }

  var COLS = {
    t1: [
      { key: 'date', label: '날짜' }, { key: 'item', label: '항목' },
      { key: 'base', label: '기준 데이터', num: true }, { key: 'inc', label: '날짜별 증가량', num: true },
      { key: 'prog', label: '누적 진행 수치', num: true }, { key: 'diff', label: '차이', num: true },
      { key: 'status', label: '비교 결과' }
    ],
    t2: [
      { key: 'date', label: '날짜' }, { key: 'burn', label: '소진량', num: true },
      { key: 'order', label: '주문 증가량', num: true }, { key: 'setting', label: '세팅 증가량', num: true }, { key: 'done', label: '완료 증가량', num: true },
      { key: 'cumBurn', label: '누적 소진량', num: true }, { key: 'cumOrder', label: '누적 주문 증가량', num: true },
      { key: 'cumSetting', label: '누적 세팅 증가량', num: true }, { key: 'cumDone', label: '누적 완료 증가량', num: true }
    ]
  };
  var STATUS = { ok: '일치', bad: '차이', na: '비교 불가' };
  var STATUS_ORDER = { bad: 0, na: 1, ok: 2 };
  var ITEM_ORDER = { order: 0, setting: 1, done: 2 };

  function sortRows(tab, rows) {
    var s = state.sort[tab];
    var key = s.key, dir = s.dir;
    return rows.slice().sort(function (a, b) {
      var c;
      if (key === 'status') c = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      else if (key === 'item') c = ITEM_ORDER[a.itemKey] - ITEM_ORDER[b.itemKey];
      else {
        var x = a[key], y = b[key];
        if (x == null && y == null) c = 0;
        else if (x == null) return 1;           // 값 없음은 항상 맨 뒤
        else if (y == null) return -1;
        else c = typeof x === 'string' ? (x < y ? -1 : x > y ? 1 : 0) : x - y;
      }
      c = c * dir;
      if (!c) c = a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
      if (!c && a.itemKey) c = ITEM_ORDER[a.itemKey] - ITEM_ORDER[b.itemKey];
      return c;
    });
  }

  function renderTable() {
    var r = state.result, tab = state.tab;
    $('statusFilter').classList.toggle('hidden', tab !== 't1');
    $('itemFilter').classList.toggle('hidden', tab !== 't1');
    var q = $('search').value.trim().replace(/[\/.]/g, '-');
    var rows = r[tab].filter(function (x) { return !q || x.date.indexOf(q) >= 0; });
    if (tab === 't1') {
      var sf = $('statusFilter').value, itf = $('itemFilter').value;
      rows = rows.filter(function (x) { return (!sf || x.status === sf) && (!itf || x.itemKey === itf); });
    }
    rows = sortRows(tab, rows);
    var s = state.sort[tab];
    var head = COLS[tab].map(function (c) {
      return '<th class="' + (c.num ? 'num' : '') + '" data-sort="' + c.key + '">' + esc(c.label) + (s.key === c.key ? ' <span class="arrow">' + (s.dir > 0 ? '▲' : '▼') + '</span>' : '') + '</th>';
    }).join('');
    var dateGrouped = tab === 't1' && s.key === 'date';
    var prev = null;
    var body = rows.map(function (x) {
      var sep = dateGrouped && prev !== null && prev !== x.date ? ' class="dsep"' : '';
      prev = x.date;
      if (tab === 't1') {
        return '<tr' + sep + '><td>' + esc(x.date) + '</td><td>' + esc(x.item) + '</td>' +
          '<td class="num">' + (x.base != null ? fmt(x.base) : '<span class="none">값 없음</span>') + '</td>' +
          '<td class="num">' + (x.inc == null ? '<span class="none">열 없음</span>' : fmt(x.inc) + (x.incRecorded ? '' : ' <span class="none">(기록 없음→0)</span>')) + '</td>' +
          '<td class="num">' + (x.prog != null ? fmt(x.prog) : '<span class="none">계산 불가</span>') + '</td>' +
          '<td class="num ' + (x.diff > EPS ? 'pos' : x.diff < -EPS ? 'neg' : '') + '">' + (x.diff != null ? fmtSigned(x.diff) : '') + '</td>' +
          '<td><span class="badge b-' + x.status + '">' + STATUS[x.status] + '</span>' + (x.why ? '<span class="why">' + esc(x.why) + '</span>' : '') + '</td></tr>';
      }
      var n = function (v, recorded) { return v == null ? '<span class="none">열 없음</span>' : fmt(v) + (recorded === false ? ' <span class="none">(기록 없음→0)</span>' : ''); };
      return '<tr><td>' + esc(x.date) + '</td>' +
        '<td class="num">' + (x.burn != null ? fmt(x.burn) : '<span class="none">기록 없음</span>') + '</td>' +
        '<td class="num">' + n(x.order, x.incRecorded) + '</td><td class="num">' + n(x.setting, x.incRecorded) + '</td><td class="num">' + n(x.done, x.incRecorded) + '</td>' +
        '<td class="num">' + fmt(x.cumBurn) + '</td><td class="num">' + n(x.cumOrder) + '</td><td class="num">' + n(x.cumSetting) + '</td><td class="num">' + n(x.cumDone) + '</td></tr>';
    }).join('');
    var foot = tab === 't1'
      ? '차이 = 기준 데이터 − 누적 진행 수치 (양수: 기준 데이터가 큼, 음수: 누적 진행 수치가 큼). 누적 진행 수치 = 진행전 수치 + 기준 날짜부터 그 날짜까지의 증가량 합계. "값 없음"은 0으로 바꾸지 않고 비교 불가로 둡니다.'
      : '소진량은 주문·세팅·완료와 별도 지표로, 서로 더하거나 빼지 않고 나란히 표시합니다. 증가량 기록이 없는 날짜는 0, 소진량 기록이 없는 날짜는 "기록 없음"(누적에는 더하지 않음)입니다.';
    $('tableBody').innerHTML = '<div class="tablebox"><table><thead><tr>' + head + '</tr></thead><tbody>' +
      (body || '<tr><td colspan="' + COLS[tab].length + '" class="empty">조건에 맞는 행이 없습니다</td></tr>') +
      '</tbody></table></div><div class="foot">' + esc(rows.length + '행 표시 · ' + foot) + '</div>';
  }

  // ---------- Excel 다운로드 ----------
  function rawSheet(entries) {
    var aoa = [], width = 0;
    entries.forEach(function (e) {
      var ws = e.wb.Sheets[e.sheet];
      var rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: true });
      rows.forEach(function (r) { aoa.push([e.label + (e.multiSheet ? ' [' + e.sheet + ']' : '')].concat(r)); width = Math.max(width, r.length); });
      aoa.push([]);
    });
    var head = ['파일명'];
    for (var i = 0; i < width; i++) head.push(XLSX.utils.encode_col(i) + '열');
    return XLSX.utils.aoa_to_sheet([head].concat(entries.length ? aoa : [['(올린 파일 없음)']]));
  }
  function exportXlsx() {
    var r = state.result;
    if (!r) return;
    var v = function (x) { return x == null ? '' : round(x); };
    var s1 = [['날짜', '항목', '기준 데이터', '날짜별 증가량', '누적 진행 수치', '차이', '비교 결과', '사유']];
    sortRows('t1', r.t1).forEach(function (x) {
      s1.push([x.date, x.item, x.base == null ? '값 없음' : v(x.base), x.inc == null ? '열 없음' : v(x.inc), x.prog == null ? '계산 불가' : v(x.prog), v(x.diff), STATUS[x.status], x.why]);
    });
    var s2 = [COLS.t2.map(function (c) { return c.label; })];
    sortRows('t2', r.t2).forEach(function (x) {
      s2.push([x.date, x.burn == null ? '기록 없음' : v(x.burn), v(x.order), v(x.setting), v(x.done), v(x.cumBurn), v(x.cumOrder), v(x.cumSetting), v(x.cumDone)]);
    });
    var pre = r.inputs.pre;
    var s3 = [['날짜', '주문 증가량', '누적 주문수량', '세팅 증가량', '누적 세팅수량', '완료 증가량', '누적 완료수량', '소진량', '누적 소진량'],
      [r.inputs.baseDate + ' 진행전', '', v(pre.order), '', v(pre.setting), '', v(pre.done), '', '']];
    r.daily.forEach(function (d) {
      s3.push([d.date, v(d.inc.order), v(d.prog.order), v(d.inc.setting), v(d.prog.setting), v(d.inc.done), v(d.prog.done), d.burn == null ? '기록 없음' : v(d.burn), v(d.cumBurn)]);
    });
    var wb = XLSX.utils.book_new();
    var add = function (aoa, name, w) { var ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = w.map(function (n) { return { wch: n }; }); XLSX.utils.book_append_sheet(wb, ws, name); };
    add(s1, '수치 대조 결과', [12, 10, 12, 14, 14, 10, 10, 34]);
    add(s2, '소진량 비교 결과', [12, 10, 12, 12, 12, 12, 16, 16, 16]);
    add(s3, '날짜별 누적 데이터', [18, 12, 14, 12, 14, 12, 14, 10, 12]);
    XLSX.utils.book_append_sheet(wb, rawSheet(r.baseFiles), '원본 기준 데이터');
    XLSX.utils.book_append_sheet(wb, rawSheet(r.incFiles), '원본 증가량 데이터');
    var now = new Date();
    XLSX.writeFile(wb, '수치대조_' + r.inputs.baseDate.replace(/-/g, '') + '_' + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '_' + pad(now.getHours()) + pad(now.getMinutes()) + '.xlsx', { compression: true });
  }

  // ---------- 이벤트 ----------
  var input = $('fileInput');
  ['dropBase', 'dropInc'].forEach(function (id) {
    var el = $(id), kind = el.getAttribute('data-kind');
    var pick = function () { state.pickKind = kind; input.click(); };
    el.addEventListener('click', pick);
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    ['dragenter', 'dragover'].forEach(function (t) { el.addEventListener(t, function (e) { e.preventDefault(); el.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (t) { el.addEventListener(t, function (e) { e.preventDefault(); el.classList.remove('over'); }); });
    el.addEventListener('drop', function (e) { if (e.dataTransfer) addFiles(kind, e.dataTransfer.files); });
  });
  input.addEventListener('change', function () { addFiles(state.pickKind, input.files); input.value = ''; });
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) { e.preventDefault(); });

  document.addEventListener('click', function (e) {
    var rm = e.target.closest('[data-remove]');
    if (rm) { removeFile(+rm.getAttribute('data-remove')); return; }
    var tb = e.target.closest('[data-tab]');
    if (tb) {
      state.tab = tb.getAttribute('data-tab');
      document.querySelectorAll('[data-tab]').forEach(function (b) { b.setAttribute('aria-selected', String(b === tb)); });
      renderTable();
      return;
    }
    var th = e.target.closest('th[data-sort]');
    if (th && state.result) {
      var s = state.sort[state.tab], k = th.getAttribute('data-sort');
      if (s.key === k) s.dir = -s.dir; else { s.key = k; s.dir = 1; }
      renderTable();
    }
  });
  document.addEventListener('change', function (e) {
    var sel = e.target.closest('select[data-map]');
    if (!sel) return;
    var entry = findEntry(+sel.getAttribute('data-map'));
    if (!entry) return;
    var field = sel.getAttribute('data-field'), col = +sel.value;
    Object.keys(entry.map).forEach(function (k) { if (k !== field && entry.map[k] === col && col >= 0) entry.map[k] = -1; });   // 한 열은 한 항목에만
    entry.map[field] = col;
    renderFiles();
    changed();
  });
  ['baseDate', 'preOrder', 'preSetting', 'preDone'].forEach(function (id) { $(id).addEventListener('input', changed); $(id).addEventListener('change', changed); });
  ['search', 'statusFilter', 'itemFilter'].forEach(function (id) { $(id).addEventListener(id === 'search' ? 'input' : 'change', function () { if (state.result) renderTable(); }); });
  $('runBtn').addEventListener('click', run);
  $('clearBtn').addEventListener('click', clearAll);
  $('exportBtn').addEventListener('click', exportXlsx);

  if (typeof XLSX === 'undefined') {
    $('runMsg').textContent = '엑셀 처리 라이브러리를 불러오지 못했습니다. 파일이 손상되지 않았는지 확인해 주세요.';
    $('runMsg').classList.remove('hidden');
  }
})();
