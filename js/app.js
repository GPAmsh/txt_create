const STORE_KEY = 'txtmake.v1';
const MAX_VARS = 20, MAX_SLOTS = 18;
const KEYS = 'abcdefghijklmnopqrst'.split('');
const TYPES = { url: 'URL', text: '문자열', multiline: '여러 줄 문자열', int: '정수' };
const TRANSFER = '이관여부'; // 특수변수: 문구 만들기에서 체크하면 변수 설정에 적어 둔 문자열이 들어감
const ATTACH = '첨부파일'; // 특수변수: 시트 열 연결이 '안 씀'이고 값이 비어 있으면 그 줄을 결과에서 지움
const isAttach = v => !!v.special && v.kind === 'attach';
const isTransfer = v => !!v.special && v.kind !== 'attach';
const transferVar = () => state.vars.find(isTransfer);
const attachVar = () => state.vars.find(isAttach);

// 저장값이 없을 때 쓰는 기본 설정. 파일은 공개되므로 양식·문구·열 연결은 넣지 않음 (백업 불러오기로 채움)
const defaults = () => ({
  vars: [
    { key: 'a', label: '항목', type: 'text' },
    { key: 'b', label: '플레이스', type: 'text' },
    { key: 'c', label: '주소', type: 'url' },
    { key: 'd', label: '주문수량', type: 'int', min: 1, max: 2000 },
    { key: 'e', label: '데일리캡', type: 'int', min: 1, max: 2000 },
    { key: 'f', label: '공유시트 주소', type: 'url' },
    { key: 'g', label: ATTACH, type: 'url', special: true, kind: 'attach' },
    { key: 'h', label: '주문번호', type: 'text' },
    { key: 'i', label: '경로', type: 'text' },
    { key: 'j', label: '고객', type: 'text' },
    { key: 'k', label: TRANSFER, type: 'text', special: true, text: '' },
  ],
  slots: Array.from({ length: MAX_SLOTS }, () => ({ name: '', body: '' })),
  values: {},
  slot: 0,
});

let state = load();
let editSlot = state.slot;

// 저장소·백업 파일의 값을 정해진 모양으로만 받아들임 (조작된 파일이 화면에 HTML/스크립트를 심지 못하게)
function str(x) { return typeof x === 'string' ? x : x == null ? '' : String(x); }
function intOr(x, d) { return Number.isFinite(+x) && x !== '' && x !== null ? Math.trunc(+x) : d; }
function sanitize(s) {
  const seen = new Set();
  const vars = (Array.isArray(s.vars) ? s.vars : []).filter(v => v && /^[a-t]$/.test(v.key) && !seen.has(v.key) && seen.add(v.key)).slice(0, MAX_VARS).map(v => {
    const o = { key: v.key, label: str(v.label).slice(0, 100) || `변수 ${v.key}`, type: TYPES[v.type] ? v.type : 'text' };
    if (o.type === 'int') { o.min = intOr(v.min, 1); o.max = intOr(v.max, 10000); }
    if (v.special === true) {
      delete o.min; delete o.max;
      Object.assign(o, v.kind === 'attach' ? { type: 'url', special: true, kind: 'attach' } : { type: 'text', special: true, text: str(v.text) });
    }
    return o;
  });
  const keys = new Set(vars.map(v => v.key));
  const pick = (obj, f) => Object.fromEntries(Object.entries(obj && typeof obj === 'object' ? obj : {}).filter(([k]) => keys.has(k)).map(([k, x]) => [k, f(x)]));
  return {
    vars,
    slots: (Array.isArray(s.slots) ? s.slots : []).map(x => ({ name: str(x?.name), body: str(x?.body) })),
    values: pick(s.values, str),
    slot: intOr(s.slot, 0),
    colMap: Object.fromEntries(Object.entries(pick(s.colMap, x => intOr(x, null))).filter(([, x]) => x !== null && x >= 0 && x < 200)),
    pasteSlots: Array.isArray(s.pasteSlots) ? s.pasteSlots.slice(0, 5).map(x => x == null ? null : intOr(x, null)) : undefined,
    pasteText: str(s.pasteText),
    transferN: str(s.transferN),
  };
}

// 예전 버전 데이터에 없는 항목 채우기
function normalize(s) {
  s = sanitize(s);
  while (s.slots.length < MAX_SLOTS) s.slots.push({ name: '', body: '' });
  s.slots.length = MAX_SLOTS; // 예전 20칸 데이터는 18칸으로 자름
  if (s.slot >= MAX_SLOTS) s.slot = 0;
  if (s.pasteSlots) s.pasteSlots = s.pasteSlots.map(i => i != null && i < MAX_SLOTS ? i : null);
  s.values ||= {};
  s.slot ||= 0;
  s.colMap ||= {};
  s.pasteSlots ||= [s.slot, null, null, null, null];
  s.pasteText ||= '';
  // 특수변수 '이관여부': 없으면 같은 이름의 변수를 특수변수로 바꾸거나 빈 글자로 새로 만듦
  if (!s.vars.some(isTransfer)) {
    const same = s.vars.find(v => !v.special && v.label.trim() === TRANSFER);
    const key = KEYS.find(k => !s.vars.some(v => v.key === k));
    if (same) Object.assign(same, { type: 'text', special: true, text: same.text ?? '' });
    else if (key) { s.vars.push({ key, label: TRANSFER, type: 'text', special: true, text: '' }); s.vars.sort((x, y) => x.key.localeCompare(y.key)); }
  }
  // 특수변수 '첨부파일': 같은 이름의 변수를 특수변수로 바꾸거나 새로 만듦
  if (!s.vars.some(isAttach)) {
    const same = s.vars.find(v => !v.special && v.label.trim() === ATTACH);
    const key = KEYS.find(k => !s.vars.some(v => v.key === k));
    if (same) { Object.assign(same, { type: 'url', special: true, kind: 'attach' }); delete same.min; delete same.max; }
    else if (key) { s.vars.push({ key, label: ATTACH, type: 'url', special: true, kind: 'attach' }); s.vars.sort((x, y) => x.key.localeCompare(y.key)); }
  }
  return s;
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && Array.isArray(s.vars) && Array.isArray(s.slots)) return normalize(s);
  } catch {}
  return normalize(defaults());
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { toast('저장 실패: 브라우저 저장소를 사용할 수 없습니다'); }
}

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 1600); }
const varOf = k => state.vars.find(v => v.key === k);
const usedKeys = body => new Set([...body.matchAll(/\(([a-t])\)/g)].map(m => m[1]).filter(varOf));

// 값 검사: 오류 메시지 또는 '' 반환
function check(v, val) {
  if (val === undefined || val === '') return '';
  if (v.type === 'int') {
    // 데일리캡은 '2일1'처럼 숫자가 든 글자도 허용
    if (v.label.trim() === DAILY_CAP && !/^-?\d+$/.test(val.trim()) && /\d/.test(val)) return '';
    if (!/^-?\d+$/.test(val.trim())) return '숫자만 입력하세요'; // 이관 수량을 빼서 음수가 되면 범위 오류로 표시
    const n = Number(val), min = v.min ?? 1, max = v.max ?? 10000;
    if (n < min || n > max) return `${min} ~ ${max} 사이여야 합니다`;
  }
  if (v.type === 'url') {
    const raw = val.trim();
    try {
      const u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : 'https://' + raw);
      if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) throw 0;
    } catch { return '올바른 주소가 아닙니다'; }
  }
  return '';
}

// 데일리캡이 '-'이면 아래 순서로 먼저 값이 있는 변수의 값을 대신 씀 (저장된 '-'는 그대로 둠)
const DAILY_CAP = '데일리캡';
const DAILY_CAP_FALLBACK = ['주문수량', '총주문수량', '진행건수', '세팅수량'];
const varByLabel = label => state.vars.find(v => v.label.trim() === label);
const rawOf = v => (state.values[v.key] ?? '').toString();
// '-'처럼 보이는 문자(시트·한글 입력의 –, −, －, ㅡ 등)와 보이지 않는 공백도 '-'로 인정
const isDash = s => /^[-‐‑‒–—―−－﹣ㅡ]$/.test(s.replace(/[\s​-‍⁠﻿]/g, ''));
// 이관여부 체크 시 이 이름의 변수들에서 이관 수량(1~2000)만큼 뺌 (데일리캡은 capToOrderQty 참고)
const TRANSFER_QTY = ['주문수량', '총주문수량', '진행건수', '세팅수량'];
const validTransferN = s => /^\d+$/.test(String(s ?? '').trim()) && +s >= 1 && +s <= 2000;
function transferN() {
  const v = transferVar();
  return v && state.values[v.key] && validTransferN(state.transferN) ? +state.transferN : 0;
}
// 이관 체크 시 숫자인 데일리캡이 이관 후 주문수량보다 크면 주문수량으로 맞춤, 아니면 그대로 (주문수량이 숫자가 아니면 그대로)
function capToOrderQty(cap) {
  const q = varByLabel('주문수량'), qty = q ? valueOf(q).trim() : '';
  return /^-?\d+$/.test(qty) && cap > +qty ? qty : String(cap);
}
// 문구에 실제로 들어갈 값
function valueOf(v) {
  if (isTransfer(v)) return state.values[v.key] ? `\n${v.text ?? ''}\n` : ''; // 체크 시 앞뒤로 줄바꿈
  let val = rawOf(v);
  // 데일리캡이 '건'으로 끝나면 마지막 '건'은 뺌 (예: 2일1건 → 2일1, 양식의 '(e)건'과 겹치지 않게)
  if (v.label.trim() === DAILY_CAP) val = val.trim().replace(/건$/, '');
  // 주문수량 등은 이관 수량만큼 뺌. 숫자인 데일리캡은 빼지 않고, 이관 후 주문수량보다 클 때만 주문수량으로 맞춤
  // ('-'이면 아래에서 이관 후 주문수량을 가져옴)
  if (TRANSFER_QTY.includes(v.label.trim()) || v.label.trim() === DAILY_CAP) {
    const n = transferN();
    if (/^\d+$/.test(val.trim())) {
      if (!n) return val;
      return v.label.trim() === DAILY_CAP ? capToOrderQty(+val.trim()) : String(+val.trim() - n);
    }
  }
  if (v.label.trim() !== DAILY_CAP || !isDash(val)) return val;
  for (const label of DAILY_CAP_FALLBACK) {
    const src = varByLabel(label);
    if (src && src !== v && rawOf(src).trim()) return valueOf(src);
  }
  return '';
}

// 양식에 값 채우기. html=true면 오류를 표시. 값이 없는 변수 자리는 경고 없이 비워 둠
function render(body, html) {
  // 특수변수 '첨부파일'이 시트 열 연결에서 '안 씀'이고 직접 입력한 값도 없으면,
  // 해당 변수가 포함된 줄(예: '첨부파일: (g)')을 그 바로 앞의 줄바꿈까지 결과에서 제거한다.
  // (첫 줄이라 앞에 줄바꿈이 없으면 뒤의 줄바꿈을 지움)
  const attachmentVar = attachVar();
  if (attachmentVar && (state.colMap[attachmentVar.key] == null || state.colMap[attachmentVar.key] === '') && !rawOf(attachmentVar).trim()) {
    const key = attachmentVar.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const line = '[^\\n]*\\(' + key + '\\)[^\\n]*';
    body = body.replace(new RegExp('\\n' + line, 'g'), '').replace(new RegExp('^' + line + '\\n?'), '');
  }

  const out = [], problems = [];
  let last = 0;
  for (const m of body.matchAll(/\(([a-t])\)/g)) {
    const v = varOf(m[1]);
    if (!v) continue;
    out.push(html ? linkify(body.slice(last, m.index)) : body.slice(last, m.index));
    const val = valueOf(v);
    const val2 = v.type === 'int' ? val.trim() : val;
    const err = check(v, val);
    if (err) problems.push(`(${v.key}) ${v.label}: ${err}`);
    if (html) out.push(err ? `<mark>${linkify(val2)}</mark>` : v.type === 'url' && val2.trim() ? urlSpan(val2) : linkify(val2));
    else out.push(val2);
    last = m.index + m[0].length;
  }
  out.push(html ? linkify(body.slice(last)) : body.slice(last));
  return { text: out.join(''), problems: [...new Set(problems)] };
}

// 미리보기의 주소 표시: 더블클릭하면 새 탭에서 열림
const urlSpan = (text, href = text.trim()) =>
  `<span class="url" data-url="${esc(/^[a-z]+:\/\//i.test(href) ? href : 'https://' + href)}" title="더블클릭하면 새 탭에서 열림">${esc(text)}</span>`;
// 일반 글자 속 http(s):// 주소도 같은 방식으로 감쌈 (끝의 문장부호는 주소에서 뺌)
const linkify = s => String(s).split(/(https?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]])/).map((part, i) => i % 2 ? urlSpan(part) : esc(part)).join('');
document.addEventListener('dblclick', e => {
  const u = e.target.closest?.('#output .url, #pasteOut .url');
  if (!u) return;
  window.getSelection()?.removeAllRanges();
  window.open(u.dataset.url, '_blank', 'noopener');
});

// ---------- 탭 ----------
document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  if (b.dataset.tab !== 'tpl' && isDirty() && !confirm('양식 편집 내용이 저장되지 않았습니다. 그래도 이동할까요?')) return;
  if (b.dataset.tab !== 'tpl') loadEditor(editSlot);
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-' + b.dataset.tab));
  renderAll();
});

// ---------- 문구 만들기 ----------
const slotTitle = (s, i) => `${i + 1}. ${s.name || (s.body ? '(이름 없음)' : '(비어 있음)')}`;

function renderMake() {
  $('makeSlot').innerHTML = state.slots.map((s, i) => `<option value="${i}" ${i === state.slot ? 'selected' : ''} ${!s.body ? 'disabled' : ''}>${esc(slotTitle(s, i))}</option>`).join('');
  const body = state.slots[state.slot].body;
  const used = usedKeys(body);
  const focused = document.activeElement?.dataset?.key;
  $('makeInputs').innerHTML = state.vars.map(v => {
    if (isTransfer(v)) return ''; // 이관여부는 결과 옆 체크박스로 입력
    const val = state.values[v.key] ?? '';
    const err = check(v, valueOf(v));
    const attrs = `data-key="${v.key}" class="${err ? 'bad' : ''}"`;
    const hint = v.type === 'int' ? `${v.min ?? 1}~${v.max ?? 10000}` : TYPES[v.type];
    const input = v.type === 'multiline'
      ? `<textarea ${attrs}>${esc(val)}</textarea>`
      : `<input ${attrs} value="${esc(val)}" ${v.type === 'int' ? 'inputmode="numeric"' : ''} placeholder="${v.type === 'url' ? 'https://' : ''}">`;
    return `<label class="field ${used.has(v.key) ? '' : 'unused'}"><span><b>(${v.key})</b> ${esc(v.label)} · ${hint}${used.has(v.key) ? '' : ' · 이 양식에선 안 씀'}</span>${input}<div class="err">${err}</div></label>`;
  }).join('');
  $('makeInputs').querySelectorAll('[data-key]').forEach(el => {
    el.oninput = () => {
      state.values[el.dataset.key] = el.value;
      save();
      const v = varOf(el.dataset.key), err = check(v, valueOf(v));
      el.classList.toggle('bad', !!err);
      el.nextElementSibling.textContent = err;
      renderOutput();
    };
  });
  if (focused) $('makeInputs').querySelector(`[data-key="${focused}"]`)?.focus();
  syncTransfer();
  renderOutput();
}
// 이관여부 체크박스 (문구 만들기 결과 옆, 시트 붙여넣기 양식 선택 옆) — 같은 값을 공유
function syncTransfer() {
  const v = transferVar();
  document.querySelectorAll('input.transfer').forEach(el => {
    el.parentElement.hidden = !v;
    if (v) { el.checked = !!state.values[v.key]; el.parentElement.title = `(${v.key}) 체크하면 "${v.text ?? ''}" 출력`; }
  });
  const n = state.transferN ?? '';
  document.querySelectorAll('input.transferN').forEach(el => {
    el.hidden = !transferVar();
    if (document.activeElement !== el) el.value = n;
    el.classList.toggle('bad', n !== '' && !validTransferN(n));
  });
}
document.querySelectorAll('input.transferN').forEach(el => el.oninput = () => {
  state.transferN = el.value.trim();
  save(); syncTransfer(); renderOutput(); renderPaste();
});
document.querySelectorAll('input.transfer').forEach(el => el.onchange = () => {
  const v = transferVar();
  if (!v) return;
  state.values[v.key] = el.checked ? '1' : '';
  save(); syncTransfer(); renderOutput(); renderPaste();
});
function renderOutput() {
  const { text, problems } = render(state.slots[state.slot].body, true);
  $('output').innerHTML = text || '<span class="muted">양식이 비어 있습니다</span>';
  $('outErr').innerHTML = problems.map(esc).join('<br>');
}
$('makeSlot').onchange = e => { state.slot = +e.target.value; save(); renderMake(); };
$('clearValues').onclick = () => { if (confirm('입력값을 모두 지울까요?')) { state.values = {}; save(); renderMake(); } };
async function copySlot(i) {
  const { text, problems } = render(state.slots[i].body, false);
  if (problems.length && !confirm('확인이 필요한 값이 있습니다:\n' + problems.join('\n') + '\n\n그래도 복사할까요?')) return;
  await copyText(text);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch { const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); }
  toast('복사했습니다');
}
$('copyOut').onclick = () => copySlot(state.slot);

// ---------- 시트 붙여넣기 ----------
const colName = i => (i >= 26 ? colName(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + i % 26);
const short = (s, n = 18) => s.length > n ? s.slice(0, n) + '…' : s;

// 구글 시트 복사 텍스트(TSV)의 첫 행만 읽음. 줄바꿈이 든 칸은 "..."로 감싸져 옴
function parseRow(text) {
  text = text.replace(/^[\r\n]+/, '');
  const cells = [];
  let cur = '', quoted = false, i = 0;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') cur += ch;
      else if (text[i + 1] === '"') { cur += '"'; i++; }
      else quoted = false;
    } else if (ch === '"' && cur === '') quoted = true;
    else if (ch === '\t') { cells.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') break;
    else cur += ch;
  }
  cells.push(cur);
  return { cells: text ? cells : [], more: text.slice(i).trim() !== '' };
}

function applyPaste() {
  const { cells } = parseRow(state.pasteText);
  for (const v of state.vars) {
    const idx = state.colMap[v.key];
    if (idx != null && idx !== '') state.values[v.key] = (cells[idx] ?? '').trim();
  }
  save();
}

function renderPaste() {
  const { cells, more } = parseRow(state.pasteText);
  if (document.activeElement !== $('pasteIn')) $('pasteIn').value = state.pasteText;
  $('pasteInfo').textContent = cells.length
    ? `${cells.length}개 열 인식` + (more ? ' · 여러 행이 들어와 첫 행만 사용합니다' : '')
    : '';

  const mapped = Object.values(state.colMap).filter(x => x != null && x !== '').map(Number);
  const nCols = Math.max(cells.length, 10, ...mapped.map(x => x + 1));
  // 특수변수 첨부파일을 맨 위에 두고, 값은 직접 고칠 수 있는 입력칸으로 보여 줌
  $('mapRows').innerHTML = [...state.vars.filter(isAttach), ...state.vars.filter(v => !v.special)].map(v => {
    const idx = state.colMap[v.key], val = state.values[v.key] ?? '', shown = valueOf(v), err = check(v, shown);
    const opts = ['<option value="">— 안 씀 —</option>'].concat(Array.from({ length: nCols }, (_, i) =>
      `<option value="${i}" ${String(idx) === String(i) ? 'selected' : ''}>${colName(i)}: ${esc(i < cells.length ? short(cells[i].trim() || '(빈칸)') : '')}</option>`));
    const valCell = isAttach(v)
      ? `<td class="val"><input data-val="${v.key}" class="${err ? 'bad' : ''}" value="${esc(val)}" placeholder="직접 입력 (https://...)"><div class="err">${err}</div></td>`
      : `<td class="val ${err ? 'err' : ''}">${esc(short(val, 60)) || '<span class="muted">비어 있음</span>'}${shown !== val ? ` → ${esc(short(shown, 60)) || '(빈 값)'}` : ''}${err ? '<br>' + err : ''}</td>`;
    return `<tr><td class="key">(${v.key})</td>
      <td><select data-key="${v.key}">${opts.join('')}</select><div class="muted">${esc(v.label)} · ${isAttach(v) ? '특수변수 · ' : ''}${TYPES[v.type]}</div></td>
      ${valCell}</tr>`;
  }).join('');
  $('mapRows').querySelectorAll('select').forEach(sel => sel.onchange = () => {
    if (sel.value === '') {
      delete state.colMap[sel.dataset.key];
      if (isAttach(varOf(sel.dataset.key))) state.values[sel.dataset.key] = ''; // 안 씀으로 바꾸면 예전 셀 값은 비움
    } else state.colMap[sel.dataset.key] = +sel.value;
    applyPaste(); renderPaste();
  });
  $('mapRows').querySelectorAll('[data-val]').forEach(el => el.oninput = () => {
    const v = varOf(el.dataset.val);
    state.values[v.key] = el.value;
    save();
    const err = check(v, valueOf(v));
    el.classList.toggle('bad', !!err);
    el.nextElementSibling.textContent = err;
    renderPasteOut();
  });

  $('pasteSlotSel').innerHTML = state.pasteSlots.map((cur, n) => `<select data-n="${n}"><option value="">${n + 1}번: 없음</option>${
    state.slots.map((s, i) => s.body ? `<option value="${i}" ${cur === i ? 'selected' : ''}>${esc(short(slotTitle(s, i), 14))}</option>` : '').join('')}</select>`).join('');
  $('pasteSlotSel').querySelectorAll('select').forEach(sel => sel.onchange = () => {
    state.pasteSlots[+sel.dataset.n] = sel.value === '' ? null : +sel.value;
    save(); renderPaste();
  });

  syncTransfer();
  renderPasteOut();
}

// 표시할 양식의 결과는 직접 고칠 수 있음. 고친 내용은 원래 결과가 바뀌기 전까지(새 붙여넣기·값 변경 등) 유지되고, 복사도 고친 내용으로 함
const pasteEdits = {};
function renderPasteOut() {
  const shown = state.pasteSlots.filter(i => i != null && state.slots[i]?.body);
  $('pasteOut').innerHTML = shown.length ? shown.map(i => {
    const { text, problems } = render(state.slots[i].body, true);
    const base = render(state.slots[i].body, false).text;
    if (pasteEdits[i] && pasteEdits[i].base !== base) delete pasteEdits[i];
    const ed = pasteEdits[i];
    return `<div class="result"><h3>${esc(slotTitle(state.slots[i], i))}<span class="dirty" data-mark="${i}">${ed ? '● 직접 고침' : ''}</span><span class="spacer"></span>
      <button class="btn" data-reset="${i}" ${ed ? '' : 'hidden'}>되돌리기</button><button class="btn primary" data-copy="${i}">복사</button></h3>
      <div class="output editable" data-edit="${i}" spellcheck="false" title="클릭해서 직접 고칠 수 있습니다">${ed ? linkify(ed.text) : text}</div><div class="err">${problems.map(esc).join('<br>')}</div></div>`;
  }).join('') : '<p class="muted">위에서 표시할 양식을 고르세요</p>';
  $('pasteOut').querySelectorAll('[data-edit]').forEach(el => {
    try { el.contentEditable = 'plaintext-only'; } catch { el.contentEditable = 'true'; } // 붙여넣을 때 서식은 빼고 글자만
    el.oninput = () => {
      const i = +el.dataset.edit;
      pasteEdits[i] = { base: render(state.slots[i].body, false).text, text: el.innerText };
      $('pasteOut').querySelector(`[data-mark="${i}"]`).textContent = '● 직접 고침';
      $('pasteOut').querySelector(`[data-reset="${i}"]`).hidden = false;
    };
  });
  $('pasteOut').querySelectorAll('[data-reset]').forEach(b => b.onclick = () => { delete pasteEdits[+b.dataset.reset]; renderPasteOut(); });
  $('pasteOut').querySelectorAll('[data-copy]').forEach(b => b.onclick = () => {
    const i = +b.dataset.copy;
    if (pasteEdits[i]) copyText(pasteEdits[i].text); else copySlot(i);
  });
}
$('pasteIn').oninput = () => { state.pasteText = $('pasteIn').value; applyPaste(); renderPaste(); };
$('pasteClear').onclick = () => { state.pasteText = ''; save(); $('pasteIn').value = ''; renderPaste(); };

// ---------- 양식 편집 ----------
function isDirty() {
  const s = state.slots[editSlot];
  return $('tplName').value !== s.name || $('tplBody').value !== s.body;
}
function loadEditor(i) {
  editSlot = i;
  $('tplName').value = state.slots[i].name;
  $('tplBody').value = state.slots[i].body;
}
function renderTpl() {
  $('slotList').innerHTML = state.slots.map((s, i) =>
    `<button class="slot ${i === editSlot ? 'on' : ''} ${s.body ? '' : 'empty'}" data-i="${i}" title="${esc(s.name)}"><small>${i + 1}</small>${esc(s.name || (s.body ? '(이름 없음)' : '비어 있음'))}</button>`).join('');
  $('slotList').querySelectorAll('.slot').forEach(b => b.onclick = () => {
    if (+b.dataset.i === editSlot) return;
    if (isDirty() && !confirm('저장하지 않은 변경이 있습니다. 버리고 이동할까요?')) return;
    loadEditor(+b.dataset.i); renderTpl();
  });
  $('tplNo').textContent = editSlot + 1;
  $('tplChips').innerHTML = state.vars.map(v => `<button class="chip" data-key="${v.key}">(${v.key}) ${esc(v.label)}</button>`).join('');
  $('tplChips').querySelectorAll('.chip').forEach(c => c.onclick = () => {
    const ta = $('tplBody'), ins = `(${c.dataset.key})`, p = ta.selectionStart;
    ta.setRangeText(ins, p, ta.selectionEnd, 'end'); ta.focus(); updateTplPreview();
  });
  updateTplPreview();
}
function updateTplPreview() {
  $('tplPreview').innerHTML = render($('tplBody').value, true).text || '<span class="muted">내용을 입력하세요</span>';
  $('tplDirty').textContent = isDirty() ? '● 저장 안 됨' : '';
}
$('tplBody').oninput = $('tplName').oninput = updateTplPreview;
$('tplSave').onclick = () => {
  state.slots[editSlot] = { name: $('tplName').value.trim(), body: $('tplBody').value };
  $('tplName').value = state.slots[editSlot].name;
  if (state.slots[editSlot].body) state.slot = editSlot;
  save(); renderTpl(); toast(`슬롯 ${editSlot + 1} 저장됨`);
};
$('tplRevert').onclick = () => { loadEditor(editSlot); renderTpl(); };
$('tplClear').onclick = () => {
  if (!confirm(`슬롯 ${editSlot + 1}을(를) 비울까요?`)) return;
  state.slots[editSlot] = { name: '', body: '' };
  if (state.slot === editSlot) state.slot = Math.max(0, state.slots.findIndex(s => s.body));
  save(); loadEditor(editSlot); renderTpl();
};

// ---------- 변수 설정 ----------
function renderVars() {
  $('varCount').textContent = `${state.vars.length} / ${MAX_VARS}`;
  $('addVar').disabled = state.vars.length >= MAX_VARS;
  // 특수변수(이관여부, 첨부파일)는 아래 '특수변수' 표에서 따로 관리
  $('specialRows').innerHTML = state.vars.map((v, i) => !v.special ? '' : `<tr data-i="${i}">
    <td class="key">(${v.key})</td>
    <td class="nowrap"><b>${esc(v.label)}</b></td>
    <td class="muted">${isAttach(v)
      ? '주소(URL). 시트 붙여넣기에서 열을 연결하거나 직접 입력. 열 연결이 \'안 씀\'이고 값이 비어 있으면 그 줄을 결과에서 지움'
      : '문구 만들기·시트 붙여넣기의 체크박스로 켬. 체크하면 오른쪽 문자열을 앞뒤 줄바꿈과 함께 출력하고, 주문수량 등에서 이관 수량을 뺌'}</td>
    <td class="w-40">${isAttach(v) ? '<span class="muted">값은 시트 붙여넣기 탭에서 입력</span>' : `<input data-f="text" value="${esc(v.text ?? '')}" placeholder="체크하면 출력할 문자열">`}</td></tr>`).join('');
  $('varRows').innerHTML = state.vars.map((v, i) => v.special ? '' : `<tr data-i="${i}">
    <td class="key">(${v.key})</td>
    <td><input data-f="label" value="${esc(v.label)}"></td>
    <td><select data-f="type">${Object.entries(TYPES).map(([k, n]) => `<option value="${k}" ${k === v.type ? 'selected' : ''}>${n}</option>`).join('')}</select></td>
    <td>${v.type === 'int' ? `<input type="number" data-f="min" value="${v.min ?? 1}">` : ''}</td>
    <td>${v.type === 'int' ? `<input type="number" data-f="max" value="${v.max ?? 10000}">` : ''}</td>
    <td><button class="btn danger" data-del>삭제</button></td></tr>`).join('');
  document.querySelectorAll('#varRows tr, #specialRows tr').forEach(tr => {
    const v = state.vars[+tr.dataset.i];
    tr.querySelectorAll('[data-f]').forEach(el => el.onchange = () => {
      const f = el.dataset.f;
      if (f === 'min' || f === 'max') v[f] = Math.trunc(Number(el.value)) || 0;
      else v[f] = f === 'label' ? el.value.trim() || `변수 ${v.key}` : el.value;
      if (v.type === 'int') { v.min ??= 1; v.max ??= 10000; } else { delete v.min; delete v.max; }
      save(); renderVars();
    });
    if (v.special) return;
    tr.querySelector('[data-del]').onclick = () => {
      const uses = state.slots.map((s, i) => usedKeys(s.body).has(v.key) ? i + 1 : 0).filter(Boolean);
      const warn = uses.length ? `\n\n슬롯 ${uses.join(', ')}에서 사용 중입니다. 삭제하면 그 자리에 (${v.key})가 그대로 남습니다.` : '';
      if (!confirm(`(${v.key}) ${v.label} 변수를 삭제할까요?${warn}`)) return;
      state.vars.splice(+tr.dataset.i, 1); delete state.values[v.key]; delete state.colMap[v.key];
      save(); renderVars();
    };
  });
}
$('addVar').onclick = () => {
  const key = KEYS.find(k => !varOf(k));
  if (!key) return;
  state.vars.push({ key, label: `변수 ${key}`, type: 'text' });
  state.vars.sort((x, y) => x.key.localeCompare(y.key));
  save(); renderVars();
};
$('exportData').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
  a.download = `문구생성기_백업_${new Date().toISOString().slice(0, 10)}.json`;
  a.click(); URL.revokeObjectURL(a.href);
};
$('importData').onclick = () => $('importFile').click();
$('importFile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  try {
    const s = JSON.parse(await file.text());
    if (!Array.isArray(s.vars) || !Array.isArray(s.slots)) throw 0;
    if (!confirm('현재 데이터를 백업 파일 내용으로 덮어쓸까요?')) return;
    state = normalize(s); save(); loadEditor(state.slot); renderAll(); toast('불러왔습니다');
  } catch { alert('백업 파일 형식이 올바르지 않습니다'); }
};

function renderAll() { renderMake(); renderPaste(); renderTpl(); renderVars(); }
loadEditor(editSlot);
renderAll();
