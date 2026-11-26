(function () {
  'use strict';

  var ADID_HEADER = 'ADID (구글 광고 ID / 기기식별값)';
  var HEADER_SCAN_ROWS = 50;     // 제목 행을 찾을 때 시트 위쪽에서 살펴볼 행 수
  var RENDER_LIMIT = 2000;       // 화면에 그릴 최대 행 수 (내보내기는 전체)
  var NO_DATE = '날짜 없음';

  var state = {
    files: [],          // { id, file, label, status, statusText }
    nextId: 1,
    running: false,
    occ: null,          // 마지막 분석에서 모은 ADID 전부
    report: null,       // 파일별 분석 결과
    result: null,       // 중복 집계
    stale: false
  };

  var $ = function (id) { return document.getElementById('adid-' + id); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n) { return Number(n).toLocaleString('ko-KR'); }
  function fmtSize(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // ---------- 열 제목 비교 ----------
  function normHeader(v) {
    return String(v == null ? '' : v).normalize('NFC').replace(/[\s​-‍﻿]/g, '').toLowerCase();
  }
  var ADID_NORM = normHeader(ADID_HEADER);
  function isAdidExact(n) { return n === ADID_NORM; }
  function isAdidLoose(n) { return n === 'adid' || n.indexOf('adid(') === 0; }
  function isDateHeader(n) { return n === 'date'; }

  // ---------- 셀 값 ----------
  function cellText(cell) {
    if (!cell || cell.v == null || cell.t === 'e' || cell.t === 'z') return '';
    if (cell.t === 'n') return String(cell.v);
    if (cell.t === 'b') return cell.v ? 'TRUE' : 'FALSE';
    if (cell.t === 'd') return cell.w != null ? String(cell.w) : String(cell.v);
    return String(cell.v);
  }

  function ymd(y, m, d) {
    if (!(y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1)) return null;
    var last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    if (d > last) return null;
    return y + '-' + pad(m) + '-' + pad(d);
  }
  function serialToDate(n, date1904) {
    if (!(n >= 1 && n < 2958466)) return null;
    var p = XLSX.SSF.parse_date_code(n, { date1904: date1904 });
    return p ? ymd(p.y, p.m, p.d) : null;
  }
  function yyyymmdd(n) {
    var s = String(n);
    if (!/^\d{8}$/.test(s)) return null;
    return ymd(+s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8));
  }
  function parseDateString(s, date1904) {
    s = s.normalize('NFC').trim();
    if (!s) return null;
    var m;
    // 2026-11-20, 2026/11/20, 2026.11.20, 2026. 11. 20., 2026년 11월 20일, 2026-11-20 13:00, 2026-11-20T…
    m = s.match(/^(\d{4})\s*[-\/.년]\s*(\d{1,2})\s*[-\/.월]\s*(\d{1,2})(?!\d)/);
    if (m) return ymd(+m[1], +m[2], +m[3]);
    // 20261120
    m = s.match(/^(\d{8})(?!\d)/);
    if (m) return yyyymmdd(m[1]);
    // 11/20/2026 (월/일/년), 첫 숫자가 12보다 크면 20/11/2026 (일/월/년)
    m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})(?!\d)/);
    if (m) {
      var a = +m[1], b = +m[2];
      return a > 12 ? ymd(+m[3], b, a) : ymd(+m[3], a, b);
    }
    // 문자열로 저장된 엑셀 날짜 일련번호 (예: "46346")
    if (/^\d{1,7}(\.\d+)?$/.test(s)) return serialToDate(+s, date1904);
    // Nov 20, 2026 / 20 Nov 2026 같은 영문 표기
    if (/[a-z]{3}/i.test(s) && /\d{4}/.test(s)) {
      var t = Date.parse(s);
      if (!isNaN(t)) { var dt = new Date(t); return ymd(dt.getFullYear(), dt.getMonth() + 1, dt.getDate()); }
    }
    return null;
  }
  function parseDateCell(cell, date1904) {
    if (!cell || cell.v == null || cell.t === 'e' || cell.t === 'z') return null;
    if (cell.t === 'n') return yyyymmdd(cell.v) || serialToDate(cell.v, date1904);
    if (cell.t === 'd') {
      var d = cell.v instanceof Date ? cell.v : new Date(cell.v);
      return isNaN(d) ? null : ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
    }
    if (cell.t === 's' || cell.t === 'str') return parseDateString(String(cell.v), date1904);
    return null;
  }

  // ---------- 파일 하나 분석 ----------
  function FileProblem(msg) { this.message = msg; }

  function findHeader(ws, range) {
    var lastRow = Math.min(range.e.r, range.s.r + HEADER_SCAN_ROWS - 1);
    var loose = null;
    for (var r = range.s.r; r <= lastRow; r++) {
      for (var c = range.s.c; c <= range.e.c; c++) {
        var cell = ws[XLSX.utils.encode_cell({ r: r, c: c })];
        if (!cell) continue;
        var n = normHeader(cellText(cell));
        if (!n) continue;
        if (isAdidExact(n)) return { row: r, col: c };
        if (!loose && isAdidLoose(n)) loose = { row: r, col: c };
      }
    }
    return loose;
  }
  function findDateCol(ws, range, headerRow) {
    var c;
    for (c = range.s.c; c <= range.e.c; c++) {
      var cell = ws[XLSX.utils.encode_cell({ r: headerRow, c: c })];
      if (cell && isDateHeader(normHeader(cellText(cell)))) return c;
    }
    return -1;
  }

  async function analyzeFile(entry) {
    var buf;
    try { buf = await entry.file.arrayBuffer(); }
    catch (e) { throw new FileProblem('파일을 읽을 수 없습니다. 파일이 이동·삭제되지 않았는지 확인한 뒤 다시 올려 주세요.'); }
    if (!buf.byteLength) throw new FileProblem('내용이 비어 있는 파일입니다(0바이트).');
    // .xlsx는 ZIP 형식(PK)이다. 암호가 걸린 .xlsx는 OLE 형식(D0 CF 11 E0)으로 저장된다
    var sig = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
    if (sig[0] === 0xD0 && sig[1] === 0xCF && sig[2] === 0x11 && sig[3] === 0xE0) {
      throw new FileProblem('암호가 걸린 파일이거나 옛 형식(.xls)을 이름만 바꾼 파일이라 열 수 없습니다. 엑셀에서 암호를 해제하거나 .xlsx로 다시 저장해 주세요.');
    }
    if (!(sig[0] === 0x50 && sig[1] === 0x4B)) {
      throw new FileProblem('정상적인 .xlsx 파일이 아니라 읽을 수 없습니다(손상되었거나 확장자만 .xlsx). 엑셀에서 열어 .xlsx로 다시 저장해 보세요.');
    }

    var wb;
    try { wb = XLSX.read(buf, { type: 'array', cellDates: false, cellHTML: false, cellFormula: false }); }
    catch (e) {
      var why = String(e && e.message || e);
      if (/password|encrypt/i.test(why)) throw new FileProblem('암호가 걸린 파일이라 열 수 없습니다. 엑셀에서 암호를 해제한 뒤 다시 올려 주세요.');
      throw new FileProblem('엑셀 파일로 읽을 수 없습니다(손상되었거나 .xlsx 형식이 아님). 엑셀에서 열어 .xlsx로 다시 저장해 보세요.');
    }
    if (!wb || !wb.SheetNames || !wb.SheetNames.length) throw new FileProblem('엑셀 파일로 읽을 수 없습니다(시트가 없음).');

    var date1904 = !!(wb.Workbook && wb.Workbook.WBProps && wb.Workbook.WBProps.date1904);
    var items = [];
    var warnings = [];
    var nonEmptySheets = 0;
    var adidSheets = [];

    wb.SheetNames.forEach(function (sheetName) {
      var ws = wb.Sheets[sheetName];
      if (!ws || !ws['!ref']) return;
      var range = XLSX.utils.decode_range(ws['!ref']);
      var hasValue = false;
      for (var k in ws) { if (k.charAt(0) !== '!' && cellText(ws[k]).trim()) { hasValue = true; break; } }
      if (!hasValue) return;
      nonEmptySheets++;

      var head = findHeader(ws, range);
      if (!head) return;
      var dateCol = findDateCol(ws, range, head.row);
      var info = { name: sheetName, dateCol: dateCol, count: 0, badDates: 0 };
      adidSheets.push(info);

      for (var r = head.row + 1; r <= range.e.r; r++) {
        var adid = cellText(ws[XLSX.utils.encode_cell({ r: r, c: head.col })]).normalize('NFC').trim();
        if (!adid) continue;
        var nAdid = normHeader(adid);
        if (isAdidExact(nAdid) || nAdid === 'adid') continue;   // 중간에 반복된 제목 행
        var date = null, raw = '';
        if (dateCol >= 0) {
          var dc = ws[XLSX.utils.encode_cell({ r: r, c: dateCol })];
          date = parseDateCell(dc, date1904);
          raw = dc ? cellText(dc).trim() : '';
          if (!date && raw) info.badDates++;
        }
        items.push({ adid: adid, date: date, dateRaw: raw, sheet: sheetName, row: r + 1 });
        info.count++;
      }
    });

    if (!nonEmptySheets) throw new FileProblem('내용이 비어 있는 파일입니다.');
    if (!adidSheets.length) throw new FileProblem('"' + ADID_HEADER + '" 열을 찾을 수 없습니다. 열 제목이 정확한지 확인해 주세요.');
    if (!items.length) throw new FileProblem('ADID 열은 있지만 ADID 데이터가 하나도 없습니다.');

    var multi = adidSheets.length > 1;
    adidSheets.forEach(function (s) {
      var where = multi ? '[' + s.name + '] 시트: ' : '';
      if (s.dateCol < 0 && s.count) warnings.push(where + 'date 열이 없어 날짜를 "' + NO_DATE + '"으로 표시합니다.');
      else if (s.badDates) warnings.push(where + '날짜로 인식하지 못한 값 ' + fmt(s.badDates) + '개는 "' + NO_DATE + '"으로 표시합니다.');
    });
    items.forEach(function (it) { it.source = multi ? entry.label + ' [' + it.sheet + ']' : entry.label; });
    return { items: items, warnings: warnings };
  }

  // ---------- 집계 ----------
  function aggregate(occ, caseSensitive) {
    var groups = new Map();
    occ.forEach(function (o) {
      var key = caseSensitive ? o.adid : o.adid.toLowerCase();
      var g = groups.get(key);
      if (!g) { g = { key: key, list: [] }; groups.set(key, g); }
      g.list.push(o);
    });
    var rows = [], kinds = 0, dupTotal = 0;
    groups.forEach(function (g) {
      if (g.list.length < 2) return;
      kinds++;
      dupTotal += g.list.length;
      g.list.forEach(function (o) {
        rows.push({ key: g.key, adid: o.adid, date: o.date, dateRaw: o.dateRaw, count: g.list.length, source: o.source, row: o.row, order: o.order });
      });
    });
    return { rows: rows, kinds: kinds, dupTotal: dupTotal, total: occ.length };
  }

  function cmpStr(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function cmpDate(a, b, dir) {
    if (a === b) return 0;
    if (!a) return 1;            // 날짜 없음은 항상 맨 뒤
    if (!b) return -1;
    return dir * cmpStr(a, b);
  }
  function sorter(mode) {
    var tail = function (a, b) { return a.order - b.order; };
    switch (mode) {
      case 'count-asc': return function (a, b) { return a.count - b.count || cmpStr(a.key, b.key) || cmpDate(a.date, b.date, 1) || tail(a, b); };
      case 'date-asc': return function (a, b) { return cmpDate(a.date, b.date, 1) || cmpStr(a.key, b.key) || tail(a, b); };
      case 'date-desc': return function (a, b) { return cmpDate(a.date, b.date, -1) || cmpStr(a.key, b.key) || tail(a, b); };
      case 'adid-asc': return function (a, b) { return cmpStr(a.key, b.key) || cmpDate(a.date, b.date, 1) || tail(a, b); };
      default: return function (a, b) { return b.count - a.count || cmpStr(a.key, b.key) || cmpDate(a.date, b.date, 1) || tail(a, b); };
    }
  }
  function sortedRows() {
    var rows = state.result.rows.slice();
    rows.sort(sorter($('sort').value));
    return rows;
  }

  // ---------- 파일 목록 ----------
  function isXlsx(f) { return /\.xlsx$/i.test(f.name); }

  function addFiles(list) {
    if (state.running) return;
    var rejected = [], dupl = [];
    Array.prototype.forEach.call(list, function (f) {
      if (!isXlsx(f)) { rejected.push(f.name); return; }
      var same = state.files.some(function (e) { return e.file.name === f.name && e.file.size === f.size && e.file.lastModified === f.lastModified; });
      if (same) { dupl.push(f.name); return; }
      var n = state.files.filter(function (e) { return e.file.name === f.name; }).length;
      state.files.push({ id: state.nextId++, file: f, label: n ? f.name + ' (' + (n + 1) + ')' : f.name, status: 'wait', statusText: '검사 전' });
    });
    var msgs = [];
    if (rejected.length) msgs.push('.xlsx 파일만 올릴 수 있어 제외했습니다: ' + rejected.join(', '));
    if (dupl.length) msgs.push('이미 목록에 있는 파일이라 제외했습니다: ' + dupl.join(', '));
    var box = $('addNotice');
    box.textContent = msgs.join(' / ');
    box.classList.toggle('hidden', !msgs.length);
    markStale();
    renderFiles();
  }
  function removeFile(id) {
    if (state.running) return;
    state.files = state.files.filter(function (e) { return e.id !== id; });
    markStale();
    renderFiles();
  }
  function clearAll() {
    if (state.running) return;
    state.files = [];
    state.occ = state.report = state.result = null;
    state.stale = false;
    $('addNotice').classList.add('hidden');
    $('search').value = '';
    renderFiles();
    renderIssues();
    renderResult();
  }
  function markStale() {
    if (state.result) { state.stale = true; $('stale').classList.remove('hidden'); }
  }

  function renderFiles() {
    var tb = $('fileRows');
    if (!state.files.length) {
      tb.innerHTML = '<tr><td colspan="5" class="empty">아직 올린 파일이 없습니다</td></tr>';
    } else {
      tb.innerHTML = state.files.map(function (e, i) {
        var cls = { wait: 'b-wait', ok: 'b-ok', warn: 'b-warn', err: 'b-err', run: 'b-wait' }[e.status];
        return '<tr><td>' + (i + 1) + '</td><td class="fname">' + esc(e.label) + '</td><td class="num size">' + esc(fmtSize(e.file.size)) +
          '</td><td><span class="badge ' + cls + '">' + esc(e.statusText) + '</span></td><td><button type="button" class="small" data-remove="' + e.id + '"' +
          (state.running ? ' disabled' : '') + ' aria-label="' + esc(e.label) + ' 삭제">삭제</button></td></tr>';
      }).join('');
    }
    $('fileCount').textContent = state.files.length ? '올린 파일 ' + fmt(state.files.length) + '개' : '올린 파일 없음';
    $('clearBtn').disabled = state.running || !state.files.length;
    $('runBtn').disabled = state.running || !state.files.length;
  }

  // ---------- 검사 실행 ----------
  async function run() {
    if (state.running || !state.files.length) return;
    state.running = true;
    var runBtn = $('runBtn');
    state.files.forEach(function (e) { e.status = 'wait'; e.statusText = '대기'; });
    renderFiles();

    var occ = [], report = [], order = 0;
    for (var i = 0; i < state.files.length; i++) {
      var e = state.files[i];
      runBtn.textContent = '분석 중… (' + (i + 1) + '/' + state.files.length + ')';
      e.status = 'run'; e.statusText = '분석 중';
      renderFiles();
      await new Promise(function (res) { setTimeout(res, 0); });
      try {
        var r = await analyzeFile(e);
        r.items.forEach(function (it) { it.order = order++; occ.push(it); });
        e.status = r.warnings.length ? 'warn' : 'ok';
        e.statusText = 'ADID ' + fmt(r.items.length) + '개' + (r.warnings.length ? ' · 주의' : '');
        report.push({ label: e.label, ok: true, count: r.items.length, warnings: r.warnings });
      } catch (err) {
        var msg = err instanceof FileProblem ? err.message : '분석 중 알 수 없는 오류가 났습니다: ' + (err && err.message || err);
        e.status = 'err'; e.statusText = '오류';
        report.push({ label: e.label, ok: false, error: msg });
      }
    }

    state.occ = occ;
    state.report = report;
    state.result = aggregate(occ, $('caseSensitive').checked);
    state.stale = false;
    state.running = false;
    runBtn.textContent = '중복 검사';
    renderFiles();
    renderIssues();
    renderResult();
    $('resultPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderIssues() {
    var rep = state.report || [];
    var errs = rep.filter(function (r) { return !r.ok; });
    var warns = rep.filter(function (r) { return r.ok && r.warnings.length; });
    var html = '';
    if (errs.length) {
      html += '<div class="issue err"><h3>분석하지 못한 파일 ' + errs.length + '개' + (errs.length < rep.length ? ' (나머지 파일은 정상 분석)' : '') + '</h3><ul>' +
        errs.map(function (r) { return '<li><b>' + esc(r.label) + '</b> — ' + esc(r.error) + '</li>'; }).join('') + '</ul></div>';
    }
    if (warns.length) {
      html += '<div class="issue warn"><h3>분석은 했지만 확인이 필요한 파일 ' + warns.length + '개</h3><ul>' +
        warns.map(function (r) { return '<li><b>' + esc(r.label) + '</b> — ' + r.warnings.map(esc).join(' / ') + '</li>'; }).join('') + '</ul></div>';
    }
    $('issues').innerHTML = html;
    $('issuesPanel').classList.toggle('hidden', !html);
  }

  function renderResult() {
    var panel = $('resultPanel');
    var res = state.result;
    if (!res) { panel.classList.add('hidden'); $('exportBtn').disabled = true; return; }
    panel.classList.remove('hidden');
    $('stale').classList.toggle('hidden', !state.stale);

    var okFiles = state.report.filter(function (r) { return r.ok; }).length;
    var stats = [
      ['업로드한 파일', fmt(state.report.length) + '개', okFiles < state.report.length ? '분석 성공 ' + fmt(okFiles) + '개' : ''],
      ['전체 추출 ADID', fmt(res.total) + '건', ''],
      ['중복된 ADID 종류', fmt(res.kinds) + '개', '', res.kinds > 0],
      ['중복 ADID 전체 발생', fmt(res.dupTotal) + '건', '', res.kinds > 0]
    ];
    $('stats').innerHTML = stats.map(function (s) {
      return '<div class="stat' + (s[3] ? ' hot' : '') + '"><div class="k">' + esc(s[0]) + '</div><div class="v">' + esc(s[1]) + '</div>' +
        (s[2] ? '<div class="k">' + esc(s[2]) + '</div>' : '') + '</div>';
    }).join('');

    $('exportBtn').disabled = !res.rows.length;
    $('search').disabled = $('sort').disabled = !res.rows.length;
    renderTable();
  }

  function renderTable() {
    var res = state.result;
    var body = $('resultBody');
    if (!res.total) {
      body.innerHTML = '<div class="msg">분석할 수 있는 ADID가 없습니다. 위의 "확인이 필요한 파일"을 확인해 주세요.</div>';
      return;
    }
    if (!res.rows.length) {
      body.innerHTML = '<div class="msg good">중복된 ADID가 없습니다. (전체 ' + fmt(res.total) + '건 모두 한 번씩만 나옵니다)</div>';
      return;
    }
    var q = $('search').value.normalize('NFC').trim().toLowerCase();
    var rows = sortedRows();
    if (q) rows = rows.filter(function (r) { return r.adid.toLowerCase().indexOf(q) >= 0; });
    var mode = $('sort').value;
    var arrow = function (kind) {
      if (mode.indexOf(kind) !== 0) return '';
      return ' <span class="arrow">' + (/-desc$/.test(mode) ? '▼' : '▲') + '</span>';
    };

    var shown = rows.slice(0, RENDER_LIMIT);
    var prevKey = null, g = 1;
    var trs = shown.map(function (r) {
      if (r.key !== prevKey) { g = 1 - g; prevKey = r.key; }
      var dateCell = r.date ? esc(r.date) : '<span title="' + esc(r.dateRaw ? '원본 값: ' + r.dateRaw : '날짜 값 없음') + '">' + NO_DATE + '</span>';
      return '<tr class="g' + g + '"><td class="adid">' + highlight(r.adid, q) + '</td><td class="' + (r.date ? '' : 'nodate') + '">' + dateCell +
        '</td><td class="num">' + fmt(r.count) + '</td><td class="src">' + esc(r.source) + ' <span class="rownum">' + fmt(r.row) + '행</span></td></tr>';
    }).join('');

    var html = '<div class="tablebox"><table class="res"><thead><tr>' +
      '<th class="sortable" data-sort="adid">ADID' + arrow('adid') + '</th>' +
      '<th class="sortable w120" data-sort="date">DATE' + arrow('date') + '</th>' +
      '<th class="sortable num w90" data-sort="count">중복수' + arrow('count') + '</th>' +
      '<th>파일명</th></tr></thead><tbody>' +
      (trs || '<tr><td colspan="4" class="empty">검색어와 일치하는 ADID가 없습니다</td></tr>') + '</tbody></table></div>';
    var foot = [];
    if (q) foot.push('검색 결과 ' + fmt(rows.length) + '행 / 전체 ' + fmt(res.rows.length) + '행');
    else foot.push('전체 ' + fmt(res.rows.length) + '행');
    if (rows.length > RENDER_LIMIT) foot.push('화면에는 앞의 ' + fmt(RENDER_LIMIT) + '행만 표시합니다. 검색으로 좁히거나 엑셀로 내보내 확인하세요');
    foot.push('엑셀 내보내기는 검색과 관계없이 전체 결과를 현재 정렬 순서로 저장합니다');
    body.innerHTML = html + '<div class="foot">' + foot.map(esc).join(' · ') + '</div>';
  }
  function highlight(text, q) {
    if (!q) return esc(text);
    var i = text.toLowerCase().indexOf(q);
    if (i < 0) return esc(text);
    return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
  }

  function headerSort(kind) {
    var cur = $('sort').value;
    var next = {
      count: cur === 'count-desc' ? 'count-asc' : 'count-desc',
      date: cur === 'date-asc' ? 'date-desc' : 'date-asc',
      adid: 'adid-asc'
    }[kind];
    $('sort').value = next;
    renderTable();
  }

  // ---------- 엑셀 내보내기 ----------
  function exportXlsx() {
    var res = state.result;
    if (!res || !res.rows.length) return;
    var rows = sortedRows();
    var aoa = [['ADID', 'DATE', '중복수', '파일명', '행 번호']];
    rows.forEach(function (r) { aoa.push([r.adid, r.date || NO_DATE, r.count, r.source, r.row]); });
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 40 }, { wch: 12 }, { wch: 8 }, { wch: 36 }, { wch: 8 }];
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: 4 } }) };

    var now = new Date();
    var stamp = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '_' + pad(now.getHours()) + pad(now.getMinutes());
    var sum = [
      ['항목', '값'],
      ['검사 일시', now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes())],
      ['비교 기준', $('caseSensitive').checked ? '대소문자 구분' : '대소문자 구분 안 함'],
      ['업로드한 파일 개수', state.report.length],
      ['전체 추출 ADID 개수', res.total],
      ['중복된 ADID 종류 개수', res.kinds],
      ['중복된 ADID 전체 발생 건수', res.dupTotal],
      [],
      ['파일명', '상태', 'ADID 개수', '내용']
    ];
    state.report.forEach(function (r) {
      sum.push(r.ok ? [r.label, r.warnings.length ? '주의' : '정상', r.count, r.warnings.join(' / ')] : [r.label, '오류', 0, r.error]);
    });
    var ws2 = XLSX.utils.aoa_to_sheet(sum);
    ws2['!cols'] = [{ wch: 36 }, { wch: 22 }, { wch: 10 }, { wch: 60 }];

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '중복 결과');
    XLSX.utils.book_append_sheet(wb, ws2, '검사 요약');
    XLSX.writeFile(wb, 'ADID_중복검사_' + stamp + '.xlsx', { compression: true });
  }

  // ---------- 이벤트 ----------
  var drop = $('drop'), input = $('fileInput');
  drop.addEventListener('click', function () { if (!state.running) input.click(); });
  drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!state.running) input.click(); } });
  input.addEventListener('change', function () { addFiles(input.files); input.value = ''; });
  ['dragenter', 'dragover'].forEach(function (t) {
    drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function (e) { if (e.dataTransfer) addFiles(e.dataTransfer.files); });
  // 영역 밖에 떨어뜨려도 브라우저가 파일을 열어 버리지 않도록
  window.addEventListener('dragover', function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') >= 0) e.preventDefault(); });
  window.addEventListener('drop', function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') >= 0) e.preventDefault(); });

  $('fileRows').addEventListener('click', function (e) {
    var b = e.target.closest('[data-remove]');
    if (b) removeFile(+b.getAttribute('data-remove'));
  });
  $('clearBtn').addEventListener('click', clearAll);
  $('runBtn').addEventListener('click', run);
  $('caseSensitive').addEventListener('change', function () {
    if (!state.occ || state.running) return;
    if (state.stale) return;   // 파일 목록이 바뀐 뒤라면 다시 검사할 때 반영
    state.result = aggregate(state.occ, $('caseSensitive').checked);
    renderResult();
  });
  $('search').addEventListener('input', function () { if (state.result) renderTable(); });
  $('sort').addEventListener('change', function () { if (state.result) renderTable(); });
  $('resultBody').addEventListener('click', function (e) {
    var th = e.target.closest('th[data-sort]');
    if (th) headerSort(th.getAttribute('data-sort'));
  });
  $('exportBtn').addEventListener('click', exportXlsx);

  if (typeof XLSX === 'undefined') {
    $('runBtn').disabled = true;
    $('addNotice').textContent = '엑셀 처리 라이브러리를 불러오지 못했습니다. 파일이 손상되지 않았는지 확인해 주세요.';
    $('addNotice').classList.remove('hidden');
  }
})();
