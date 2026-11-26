'use strict';

const crypto = require('node:crypto');

const UPSTREAM =
  'https://gad.api.gpakorea.com/docs/manuscript/update';

const MAX_SIZE = 128 * 1024;

const ALLOWED_ITEMS = new Set([
  '인스타원고포스팅',
  '스레드원고포스팅',
  '트위터원고포스팅',
  '페이스북원고포스팅',
  '블로그원고포스팅'
]);

function equals(actual, expected) {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);

  return a.length === b.length &&
    crypto.timingSafeEqual(a, b);
}

function valid(body) {
  return body &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    typeof body.orderNo === 'string' &&
    body.orderNo.trim().length > 0 &&
    body.orderNo.length <= 100 &&
    ALLOWED_ITEMS.has(body.itemName) &&
    Array.isArray(body.contentItems) &&
    body.contentItems.length === 1 &&
    body.contentItems.every(item =>
      item &&
      typeof item === 'object' &&
      typeof item.title === 'string' &&
      item.title.length <= 1000 &&
      typeof item.content === 'string' &&
      item.content.length <= 50000 &&
      Array.isArray(item.attachment) &&
      item.attachment.length <= 25 &&
      item.attachment.every(url =>
        typeof url === 'string' &&
        url.length <= 2000 &&
        /^https:\/\/\S+$/i.test(url)
      ) &&
      !!(
        item.title ||
        item.content ||
        item.attachment.length
      )
    );
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');

    return res.status(405).json({
      success: false,
      error: 'METHOD_NOT_ALLOWED'
    });
  }

  const secret = process.env.MANUSCRIPT_WEB_PASSWORD;

  if (!secret) {
    return res.status(503).json({
      success: false,
      error: 'SERVER_NOT_CONFIGURED',
      message: 'Vercel 전송 비밀번호가 설정되지 않았습니다.'
    });
  }

  if (!equals(
    String(req.headers.authorization || ''),
    `Bearer ${secret}`
  )) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: '전송 암호가 올바르지 않습니다.'
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

  let payload;

  try {
    const raw = typeof req.body === 'string'
      ? req.body
      : JSON.stringify(req.body ?? null);

    if (Buffer.byteLength(raw, 'utf8') > MAX_SIZE) {
      return res.status(413).json({
        success: false,
        error: 'PAYLOAD_TOO_LARGE'
      });
    }

    payload = JSON.parse(raw);

  } catch {
    return res.status(400).json({
      success: false,
      error: 'INVALID_JSON'
    });
  }

  if (!valid(payload)) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_MANUSCRIPT',
      message: '주문번호, 상품명, 원고 형식을 확인하세요.'
    });
  }

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    20000
  );

  try {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    if (process.env.MANUSCRIPT_UPSTREAM_TOKEN) {
      headers.Authorization =
        `Bearer ${process.env.MANUSCRIPT_UPSTREAM_TOKEN}`;
    }

    const upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
      redirect: 'error'
    });

    const text = await upstream.text();
    let parsed;

    try {
      parsed = JSON.parse(text);
    } catch {
      return res.status(502).json({
        success: false,
        error: 'UPSTREAM_INVALID_RESPONSE',
        message: `원고 서버 응답 오류 (HTTP ${upstream.status})`
      });
    }

    if (!upstream.ok || parsed?.success !== true) {
      return res.status(502).json({
        success: false,
        error: 'UPSTREAM_FAILED',
        message: typeof parsed?.message === 'string'
          ? parsed.message.slice(0, 500)
          : `원고 서버 오류 (HTTP ${upstream.status})`
      });
    }

    return res.status(200).json({
      success: true,
      advertisementIds:
        Array.isArray(parsed.advertisementIds)
          ? parsed.advertisementIds
          : [],
      updatedCount:
        Number.isFinite(parsed.updatedCount)
          ? parsed.updatedCount
          : undefined
    });

  } catch (error) {
    return res.status(502).json({
      success: false,
      error: 'UPSTREAM_UNAVAILABLE',
      message: error?.name === 'AbortError'
        ? '원고 서버 응답 시간 초과'
        : '원고 서버 연결 실패'
    });
  } finally {
    clearTimeout(timeout);
  }
};
