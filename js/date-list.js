// ---------- 날짜 목록 (구글 시트 붙여넣기용) ----------
(() => {
const STORE_KEY = 'datelist.v1';

// 대한민국 공휴일 (원래 날짜 + 대체공휴일 + 선거일·임시공휴일)
// 출처 교차확인: kholidayz.com, date.nager.at (2026-10 기준)
const DEFAULT_HOLIDAYS = `
2025-01-01 신정
2025-01-27 임시공휴일
2025-01-28 설날 연휴
2025-01-29 설날
2025-01-30 설날 연휴
2025-03-01 삼일절
2025-03-03 대체공휴일(삼일절)
2025-05-05 어린이날·부처님오신날
2025-05-06 대체공휴일
2025-06-03 대통령 선거일
2025-06-06 현충일
2025-08-15 광복절
2025-10-03 개천절
2025-10-05 추석 연휴
2025-10-06 추석
2025-10-07 추석 연휴
2025-10-08 대체공휴일(추석)
2025-10-09 한글날
2025-12-25 성탄절
2026-01-01 신정
2026-02-16 설날 연휴
2026-02-17 설날
2026-02-18 설날 연휴
2026-03-01 삼일절
2026-03-02 대체공휴일(삼일절)
2026-05-01 노동절
2026-05-05 어린이날
2026-05-24 부처님오신날
2026-05-25 대체공휴일(부처님오신날)
2026-06-03 지방선거일
2026-06-06 현충일
2026-07-17 제헌절
2026-08-15 광복절
2026-08-17 대체공휴일(광복절)
2026-09-24 추석 연휴
2026-09-25 추석
2026-09-26 추석 연휴
2026-10-03 개천절
2026-10-05 대체공휴일(개천절)
2026-10-09 한글날
2026-12-25 성탄절
2027-01-01 신정
2027-02-06 설날 연휴
2027-02-07 설날
2027-02-08 설날 연휴
2027-02-09 대체공휴일(설날)
2027-03-01 삼일절
2027-05-01 노동절
2027-05-03 대체공휴일(노동절) - 확인 필요
2027-05-05 어린이날
2027-05-13 부처님오신날
2027-06-06 현충일
2027-07-17 제헌절
2027-07-19 대체공휴일(제헌절)
2027-08-15 광복절
2027-08-16 대체공휴일(광복절)
2027-09-14 추석 연휴
2027-09-15 추석
2027-09-16 추석 연휴
2027-10-03 개천절
2027-10-04 대체공휴일(개천절)
2027-10-09 한글날
2027-10-11 대체공휴일(한글날)
2027-12-25 성탄절
2027-12-27 대체공휴일(성탄절)
`.trim();

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const defaults = { start: iso(new Date()), rows: 6, repMin: 1, repMax: 1, skipOn: false, skip: 2, fmt: 'dot', exSat: false, exSun: false, exHol: false, hol: DEFAULT_HOLIDAYS };
let cfg = { ...defaults };
try {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY)) || {};
  // 예전 버전(체크박스 없이 숫자만)에서 2 이상을 쓰고 있었으면 '사용함'으로 이어받음
  if (saved.skipOn === undefined && saved.skip >= 2) saved.skipOn = true;
  if (!(saved.skip >= 2)) delete saved.skip;
  Object.assign(cfg, saved);
} catch {}
const persist = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch {} };

let seed = Date.now() >>> 0;
function rng(s) { // mulberry32: 같은 seed면 같은 결과 → 설정만 바꿀 때 결과가 마구 바뀌지 않게
  return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

function holidays() {
  const map = new Map();
  for (const line of cfg.hol.split('\n')) {
    const m = line.trim().match(/^(\d{4}-\d{2}-\d{2})\s*(.*)$/);
    if (m) map.set(m[1], m[2] || '공휴일');
  }
  return map;
}

function format(d) {
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  switch (cfg.fmt) {
    case 'dot0': return `${y}. ${pad(m)}. ${pad(day)}`;
    case 'dash': return `${y}-${pad(m)}-${pad(day)}`;
    case 'slash': return `${y}/${pad(m)}/${pad(day)}`;
    default: return `${y}. ${m}. ${day}`;
  }
}

// 제외할 날(토·일·공휴일)이 아닌지
function isAllowed(d, hol) {
  const wd = d.getDay();
  return !(cfg.exSat && wd === 6) && !(cfg.exSun && wd === 0) && !(cfg.exHol && hol.has(iso(d)));
}
// d가 제외일이면 그다음 가능한 날로 밂
function nextAllowed(d, hol) {
  const cur = new Date(d);
  for (let guard = 0; guard < 40000 && !isAllowed(cur, hol); guard++) cur.setDate(cur.getDate() + 1);
  return cur;
}

// 시작일부터 허용된 날짜를 차례로 내놓음
function* allowedDates(hol) {
  const [y, m, d] = cfg.start.split('-').map(Number);
  const cur = new Date(y, m - 1, d);
  for (let guard = 0; guard < 40000; guard++, cur.setDate(cur.getDate() + 1)) {
    if (isAllowed(cur, hol)) yield new Date(cur);
  }
}

// 반복 횟수를 고르게 뽑음: 최소~최대 값을 한 번씩 섞어 담은 주머니에서 하나씩 꺼내고, 비면 다시 채움
// (예: 1~2면 1과 2가 번갈아 반반씩 나오되 순서는 무작위)
function repPicker(rand) {
  let bag = [];
  return () => {
    if (!bag.length) {
      bag = Array.from({ length: cfg.repMax - cfg.repMin + 1 }, (_, i) => cfg.repMin + i);
      for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    }
    return bag.pop();
  };
}

function buildColumn(rand, hol) {
  const col = [];
  const gen = allowedDates(hol);
  const pick = repPicker(rand);
  if (cfg.skipOn) {
    // 건너뛰기: 한 날짜를 반복 횟수만큼 적은 뒤, 다음 날짜는 건너뛰기 일수만큼 달력으로 뒤로 감 (제외일이면 다음 가능한 날로 밂)
    // 예: 10/26 시작, 반복 2, 건너뛰기 2 → 10/26, 10/26, 10/28, 10/28, 10/30, 10/30 …
    const { value: first } = gen.next();
    let cur = first;
    while (cur && col.length < cfg.rows) {
      const times = pick();
      for (let i = 0; i < times && col.length < cfg.rows; i++) col.push(cur);
      cur = new Date(cur); cur.setDate(cur.getDate() + cfg.skip); cur = nextAllowed(cur, hol);
    }
    return col;
  }
  while (col.length < cfg.rows) {
    const { value: d, done } = gen.next();
    if (done) break;
    const times = pick();
    for (let i = 0; i < times && col.length < cfg.rows; i++) col.push(d);
  }
  return col;
}

function generate() {
  // 시작 날짜가 오늘(PC 날짜)이거나 과거면 경고
  $('dl-startWarn').textContent = /^\d{4}-\d{2}-\d{2}$/.test(cfg.start) && cfg.start <= iso(new Date()) ? '(주의:날짜확인)' : '';
  const err = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cfg.start)) err.push('시작 날짜를 입력하세요');
  if (!(cfg.rows >= 1 && cfg.rows <= 5000)) err.push('행 개수는 1~5000');
  if (!(cfg.repMin >= 1 && cfg.repMax >= cfg.repMin && cfg.repMax <= 100)) err.push('반복 횟수는 1~100, 최소 ≤ 최대');
  // 건너뛰기는 '사용함'일 때만 숫자칸을 쓸 수 있고, 2~100만 허용
  $('dl-skip').disabled = !cfg.skipOn;
  $('dl-skip').classList.toggle('bad', cfg.skipOn && !(cfg.skip >= 2 && cfg.skip <= 100));
  if (cfg.skipOn && !(cfg.skip >= 2 && cfg.skip <= 100)) err.push('건너뛰기는 2~100');
  $('dl-err').textContent = err.join(' / ');
  if (err.length) { $('dl-out').value = ''; $('dl-preview').innerHTML = ''; return; }

  const hol = holidays();
  const rand = rng(seed);
  const cols = [buildColumn(rand, hol)]; // 열은 1개
  const lines = Array.from({ length: cfg.rows }, (_, r) => cols.map(c => c[r] ? format(c[r]) : '').join('\t'));
  $('dl-out').value = lines.join('\n');

  const last = cols.flat().reduce((a, b) => (b > a ? b : a), cols[0][0]);
  $('dl-summary').textContent = `${cfg.rows}행 · 마지막 날짜 ${format(last)}`;

  // 공휴일 목록이 끝나는 해를 넘어가면 경고
  const years = [...hol.keys()].map(k => +k.slice(0, 4));
  const maxYear = years.length ? Math.max(...years) : 0;
  if (cfg.exHol && last.getFullYear() > maxYear) $('dl-err').textContent = `공휴일 목록에 ${last.getFullYear()}년이 없습니다. '인터넷에서 추가'를 누르거나 직접 입력하세요.`;

  const show = Math.min(cfg.rows, 60);
  $('dl-preview').innerHTML = `<table class="prev">${lines.slice(0, show).map((l, i) => `<tr><td class="n">${i + 1}</td>${cols.map(c => {
    const d = c[i]; if (!d) return '<td></td>';
    const name = hol.get(iso(d)), wd = '일월화수목금토'[d.getDay()];
    return `<td title="${esc(name || '')}">${format(d)} <span class="muted">(${wd})${name ? ' ' + esc(name) : ''}</span></td>`;
  }).join('')}</tr>`).join('')}</table>${cfg.rows > show ? `<p class="muted">미리보기는 ${show}행까지만 표시</p>` : ''}`;
}

// ---------- 입력 연결 ----------
const fields = ['start', 'rows', 'repMin', 'repMax', 'skipOn', 'skip', 'fmt', 'exSat', 'exSun', 'exHol', 'hol'];
for (const f of fields) {
  const el = $('dl-' + f);
  if (el.type === 'checkbox') el.checked = cfg[f]; else el.value = cfg[f];
  el.addEventListener('input', () => {
    cfg[f] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Math.trunc(Number(el.value)) : el.value;
    persist(); generate();
  });
}
$('dl-reroll').onclick = () => { seed = (Math.random() * 2 ** 32) >>> 0; generate(); };
$('dl-copy').onclick = async () => {
  const text = $('dl-out').value;
  if (!text) return;
  try { await navigator.clipboard.writeText(text); }
  catch { $('dl-out').select(); document.execCommand('copy'); }
  toast('복사했습니다');
};
$('dl-holReset').onclick = () => {
  if (!confirm('공휴일 목록을 기본값으로 되돌릴까요? 직접 추가한 날짜는 사라집니다.')) return;
  cfg.hol = $('dl-hol').value = DEFAULT_HOLIDAYS; persist(); generate();
};
// date.nager.at 공개 API에서 시작 연도~+2년 공휴일을 받아 목록에 없는 날짜만 추가
$('dl-holFetch').onclick = async () => {
  const y0 = +cfg.start.slice(0, 4) || new Date().getFullYear();
  const have = holidays();
  let added = 0;
  try {
    for (const y of [y0, y0 + 1, y0 + 2]) {
      const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${y}/KR`);
      if (!res.ok) throw new Error(res.status);
      for (const h of await res.json()) {
        if (!have.has(h.date)) { cfg.hol += `\n${h.date} ${h.localName}`; have.set(h.date, h.localName); added++; }
      }
    }
    cfg.hol = cfg.hol.split('\n').filter(l => l.trim()).sort().join('\n');
    $('dl-hol').value = cfg.hol; persist(); generate();
    $('dl-holInfo').textContent = `${y0}~${y0 + 2}년에서 ${added}개 날짜를 추가했습니다 (date.nager.at). 새로 생긴 임시공휴일은 늦게 반영될 수 있습니다.`;
  } catch (e) {
    $('dl-holInfo').textContent = '불러오기 실패: 인터넷 연결을 확인하거나 직접 입력하세요.';
  }
};

generate();
})();
