
'use strict';

const crypto = require('node:crypto');

const {
  loadConfig,
  generateMessage
} = require('../lib/map-review');

const MAX_REQUESTS = 100;
const MAX_VALUE_LENGTH = 10000;
const MAX_BODY_BYTES = 1024 * 1024;

const ALLOWED_COLUMNS = [
  'B', 'D', 'E', 'F', 'G',
  'H', 'I', 'K', 'L', 'S'
];

// 인증키 비교
function isAuthorized(req) {
  const secret = process.env.MAP_REVIEW_API_KEY;

  if (!secret) return false;

  const actual = Buffer.from(
    String(req.headers.authorization || '')
  );

  const expected = Buffer.from(
    'Bearer ' + secret
  );

  return (
    actual.length === expected.length &&
    crypto.timingSafeEqual(actual, expected)
  );
}

// 개별 요청 검증
function isValidRequest(item) {
  if (!item || typeof item !== 'object') {
    return false;
  }

  if (
    !Number.isSafeInteger(item.row) ||
    item.row < 15
  ) {
    return false;
  }

  if (!['exec', 'customer'].includes(item.type)) {
    return false;
  }

  if (
    !item.values ||
    typeof item.values !== 'object' ||
    Array.isArray(item.values)
  ) {
    return false;
  }

  const required = item.type === 'exec'
    ? ['B', 'D', 'E', 'F', 'G', 'H', 'I']
    : ['D', 'F', 'I', 'K', 'L', 'S'];

  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(
      item.values, key
    )) {
      return false;
    }
  }

  for (const key of Object.keys(item.values)) {
    if (!ALLOWED_COLUMNS.includes(key)) {
      return false;
    }

    const value = item.values[key];

    if (
      value !== null &&
      typeof value !== 'string' &&
      typeof value !== 'number'
    ) {
      return false;
    }

    if (String(value ?? '').length > MAX_VALUE_LENGTH) {
      return false;
    }
  }

  return true;
}

// Vercel API
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');

    return res.status(405).json({
      success: false,
      error: 'METHOD_NOT_ALLOWED'
    });
  }

  if (!process.env.MAP_REVIEW_API_KEY) {
    return res.status(503).json({
      success: false,
      error: 'SERVER_NOT_CONFIGURED'
    });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED'
    });
  }

  if (!/^application\/json(?:;|$)/i.test(
    String(req.headers['content-type'] || '')
  )) {
    return res.status(415).json({
      success: false,
      error: 'UNSUPPORTED_CONTENT_TYPE'
    });
  }

  let body;

  try {
    const raw = typeof req.body === 'string'
      ? req.body
      : JSON.stringify(req.body ?? null);

    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
      return res.status(413).json({
        success: false,
        error: 'PAYLOAD_TOO_LARGE'
      });
    }

    body = JSON.parse(raw);

  } catch {
    return res.status(400).json({
      success: false,
      error: 'INVALID_JSON'
    });
  }

  if (
    !body ||
    !Array.isArray(body.requests) ||
    body.requests.length === 0 ||
    body.requests.length > MAX_REQUESTS
  ) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_REQUESTS'
    });
  }

  let config;

  try {
    config = loadConfig();
  } catch {
    return res.status(503).json({
      success: false,
      error: 'SERVER_CONFIG_ERROR'
    });
  }

  const results = body.requests.map(item => {
    if (!isValidRequest(item)) {
      return {
        row: Number.isSafeInteger(item?.row)
          ? item.row
          : null,
        type: ['exec', 'customer'].includes(item?.type)
          ? item.type
          : null,
        status: 'error',
        reason: 'INVALID_REQUEST'
      };
    }

    try {
      return {
        row: item.row,
        type: item.type,
        ...generateMessage(
          item.type,
          item.values,
          config
        )
      };

    } catch {
      return {
        row: item.row,
        type: item.type,
        status: 'error',
        reason: 'GENERATION_FAILED'
      };
    }
  });

  return res.status(200).json({
    success: true,
    results
  });
};
