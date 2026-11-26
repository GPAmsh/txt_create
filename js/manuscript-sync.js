
/* Spreadsheet single-row manuscript sender. Independent of js/app.js. */
(() => {
  'use strict';
  const STORAGE_KEY = 'txtmake.manuscript.columns.v1';
  const $ = (id) => document.getElementById(id);
  const fields = ['orderNo', 'itemName', 'image', 'title', 'content'];
  const defaults = { orderNo: 'D', itemName: 'Q', image: 'AA', title: 'G', content: 'I' };
  let columns = { ...defaults };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    for (const key of fields) {
      if (typeof saved[key] === 'string' && (/^[A-Z]{1,3}$/.test(saved[key]) || saved[key] === '')) columns[key] = saved[key];
    }
  } catch { /* storage may be disabled */ }

  const columnLabel = index => {
    let result = '';
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
      result = String.fromCharCode(65 + ((n - 1) % 26)) + result;
    }
    return result;
  };
  const columnIndex = label => /^[A-Z]{1,3}$/.test(label) ?
    [...label].reduce((n, char) => n * 26 + char.charCodeAt(0) - 64, 0) - 1 : -1;

  function parseTSV(text) {
    const cells = [];
    let value = '', quoted = false, pos = 0, more = false;
    const src = text.replace(/^\uFEFF/, '').replace(/^[\r\n]+/, '');
    if (!src) return { cells: [], more: false };
    for (; pos < src.length; pos++) {
      const ch = src[pos];
      if (quoted) {
        if (ch === '"' && src[pos + 1] === '"') { value += '"'; pos++; }
        else if (ch === '"') quoted = false;
        else value += ch;
      } else if (ch === '"' && value === '') quoted = true;
      else if (ch === '\t') { cells.push(value); value = ''; }
      else if (ch === '\r' || ch === '\n') {
        more = src.slice(pos).trim().length > 0;
        break;
      } else value += ch;
    }
    cells.push(value);
    return { cells, more, unclosed: quoted };
  }

  let cellData = [];
  const cellsCount = () => Math.max(29, cellData.length, ...fields.map(key => columnIndex(columns[key]) + 1));
  const getCell = field => {
    const index = columnIndex(columns[field]);
    return index < 0 ? '' : (cellData[index] ?? '').trim();
  };

  function saveColumns() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(columns)); } catch { /* optional */ }
  }
  function options() {
    const n = Math.min(702, cellsCount());
    for (const key of fields) {
      const selector = $('ms-col-' + key);
      const current = columns[key];
      selector.replaceChildren();
      selector.add(new Option('— 선택 안 함 —', ''));
      for (let i = 0; i < n; i++) {
        const label = columnLabel(i), preview = (cellData[i] || '').replace(/\s+/g, ' ').slice(0, 38);
        selector.add(new Option(`${label}열${preview ? ': ' + preview : ''}`, label));
      }
      selector.value = current;
    }
  }
  function splitAttachments(value) {
    const images = [], txt = [];
    for (const address of value.split(/\r?\n/).map(x => x.trim()).filter(Boolean)) {
      let isTxt = false;
      try {
        const url = new URL(address);
        isTxt = url.protocol === 'https:' && /\.txt$/i.test(decodeURIComponent(url.pathname));
      } catch { /* retain unrecognized addresses for existing validation */ }
      (isTxt ? txt : images).push(address);
    }
    return { images, txt };
  }
  function populate() {
    $('ms-order').value = getCell('orderNo');
    $('ms-item').value = getCell('itemName');
    const { images, txt } = splitAttachments(getCell('image'));
    $('ms-image').value = images.join('\n');
    $('ms-title').value = getCell('title');
    $('ms-content').value = txt.length ? txt.join('\n') : getCell('content');
    updateSummary();
  }
  function updateSummary() {
    const total = $('ms-image').value.split(/\r?\n/).filter(x => x.trim()).length;
    $('ms-summary').textContent = `${cellData.length}개 열 인식 · 이미지 주소 ${total}개 · 전송 전 수정 가능`;
  }
  function status(text, error = false) {
    const target = $('ms-status');
    target.textContent = text;
    target.classList.toggle('err', error);
    target.setAttribute('role', error ? 'alert' : 'status');
  }
  $('ms-paste').addEventListener('input', () => {
    const result = parseTSV($('ms-paste').value);
    cellData = result.cells;
    options(); populate();
    status(result.unclosed ? '따옴표가 닫히지 않은 데이터입니다. 원본 행을 확인하세요.' :
      result.more ? '여러 행이 감지되어 첫 번째 행만 사용합니다.' :
      splitAttachments(getCell('image')).txt.length ? 'TXT 주소를 원고내용으로 이동했습니다.' : '');
  });
  fields.forEach(key => {
    $('ms-col-' + key).addEventListener('change', event => {
      columns[key] = event.target.value;
      saveColumns();
      populate();
    });
  });
  ['ms-order', 'ms-item', 'ms-image', 'ms-title', 'ms-content'].forEach(id =>
    $(id).addEventListener('input', updateSummary));

  $('ms-clear').addEventListener('click', () => {
    $('ms-paste').value = '';
    cellData = [];
    options(); populate();
    status('입력한 행 데이터를 지웠습니다.');
  });

  $('ms-send').addEventListener('click', async () => {
    const orderNo = $('ms-order').value.trim();
    const itemName = $('ms-item').value.trim();
    const title = $('ms-title').value.trim();
    const { images: attachments, txt } = splitAttachments($('ms-image').value);
    if (txt.length) {
      $('ms-image').value = attachments.join('\n');
      $('ms-content').value = txt.join('\n');
      updateSummary();
      return status('TXT 주소를 원고내용으로 이동했습니다. 확인 후 다시 전송하세요.');
    }
    const content = $('ms-content').value.trim();
    const password = $('ms-password').value;
    if (!orderNo || !itemName || (!title && !content && !attachments.length)) {
      return status('주문번호·상품명과 원고 데이터 중 하나 이상이 필요합니다.', true);
    }
    if (!password) return status('전송 암호를 입력하세요.', true);
    if (attachments.some(x => !/^https:\/\/\S+$/i.test(x))) {
      return status('이미지 주소는 https:// 로 시작하는 URL이어야 합니다. 여러 개면 줄을 나눠 입력하세요.', true);
    }
    const payload = { orderNo, itemName, contentItems: [{ title, attachment: attachments, content }] };
    if (!confirm(`주문번호: ${orderNo}\n상품명: ${itemName}\n사진 ${attachments.length}개, 제목 ${title.length}자, 본문 ${content.length}자\n\n실제 원고 동기화 서버로 전송할까요?`)) return;
    const button = $('ms-send');
    button.disabled = true;
    status('서버에 전송 중입니다…');
    try {
      const response = await fetch('/api/manuscript-sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${password}` },
        body: JSON.stringify(payload), cache: 'no-store'
      });
      const raw = await response.text();
      let data;
      try { data = JSON.parse(raw); } catch { throw new Error(`서버 응답을 해석할 수 없습니다 (HTTP ${response.status}).`); }
      if (!response.ok || data.success !== true) {
        throw new Error(data.message || data.error || `전송 실패 (HTTP ${response.status})`);
      }
      const ids = Array.isArray(data.advertisementIds) ? data.advertisementIds.join(', ') : '';
      status(`동기화 성공${ids ? ' · 광고 ID: ' + ids : ''}${data.updatedCount != null ? ' · 업데이트 ' + data.updatedCount + '개' : ''}`);
    } catch (error) {
      status('전송 실패: ' + (error.message || '네트워크 오류'), true);
    } finally { button.disabled = false; }
  });
  options();
  updateSummary();
})();




