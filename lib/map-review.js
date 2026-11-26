
'use strict';

function loadConfig() {
  const raw = process.env.MAP_REVIEW_CONFIG;

  if (!raw) {
    throw new Error('CONFIG_MISSING');
  }

  const config = JSON.parse(raw);

  for (const key of ['group1', 'group2', 'group3']) {
    if (!Array.isArray(config[key])) {
      throw new Error('CONFIG_INVALID');
    }
  }

  for (const key of ['exec', 'customer1', 'customer2', 'customer3']) {
    if (
      typeof config.templates?.[key] !== 'string' ||
      !config.templates[key].trim()
    ) {
      throw new Error('CONFIG_INVALID');
    }
  }

  return config;
}

// 데일리캡 계산
function dailyCap(v) {
  if (v.H === '-') {
    return v.FRaw.startsWith('카카오맵지정리뷰')
      ? '1'
      : v.G;
  }

  return v.H;
}

// 전달받은 값 정리
function normalizeValues(values) {
  const v = {};

  for (const col of [
    'B', 'D', 'E', 'F', 'G',
    'H', 'I', 'K', 'L', 'S'
  ]) {
    v[col] = String(values[col] ?? '').trim();
  }

  v.FRaw = v.F;

  v.F = v.F.replace(
    '카카오맵지정리뷰평가',
    '카카오맵지정리뷰'
  );

  v.CAP = dailyCap(v);

  return v;
}

// 양식에 변수 삽입
function renderTemplate(template, values) {
  return template.replace(
    /\{\{([A-Z]+)\}\}/g,
    (_, key) => values[key] ?? ''
  );
}

// 고객 경로 분류
function customerGroup(path, config) {
  if (config.group1.includes(path)) return 1;
  if (config.group2.includes(path)) return 2;
  if (config.group3.includes(path)) return 3;

  return 0;
}

// 문구 생성
function generateMessage(type, values, config) {
  const v = normalizeValues(values);

  if (!v.I) {
    return {
      status: 'skipped',
      reason: 'SHARED_SHEET_EMPTY'
    };
  }

  let template;

  if (type === 'exec') {
    template = config.templates.exec;

  } else if (type === 'customer') {
    const group = customerGroup(v.K, config);

    if (!group) {
      return {
        status: 'skipped',
        reason: 'UNSUPPORTED_PATH'
      };
    }

    template = config.templates['customer' + group];

  } else {
    return {
      status: 'error',
      reason: 'INVALID_TYPE'
    };
  }

  const message = renderTemplate(template, v);

  // 스프레드시트 수식으로 해석되는 결과 차단
  if (!message.trim() || /^\s*=/.test(message)) {
    return {
      status: 'error',
      reason: 'INVALID_MESSAGE'
    };
  }

  return {
    status: 'generated',
    message
  };
}

module.exports = {
  loadConfig,
  dailyCap,
  normalizeValues,
  renderTemplate,
  customerGroup,
  generateMessage
};
