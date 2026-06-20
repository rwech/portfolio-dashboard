import { describe, it, expect, vi, afterEach } from 'vitest';
import handler from '../api/stock-price.js';

function createRes() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    ended: false,
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
    },
    end() {
      this.ended = true;
    },
  };
}

describe('api/stock-price handler', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ALLOWED_ORIGINS;
  });

  it('loads and runs under the ESM loader without throwing (regression for the module.exports crash)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const req = { headers: {}, method: 'GET', query: { symbols: 'AAPL' } };
    const res = createRes();
    await expect(handler(req, res)).resolves.toBeUndefined();
    expect(res.statusCode).toBe(200);
  });

  it('falls back to null per-symbol when the upstream fetch fails, without crashing the whole request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const req = { headers: {}, method: 'GET', query: { symbols: 'AAPL,2330.TW' } };
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ AAPL: null, '2330.TW': null });
  });

  it('returns 400 when the symbols query param is missing', async () => {
    const req = { headers: {}, method: 'GET', query: {} };
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('rejects requests from a disallowed origin', async () => {
    const req = { headers: { origin: 'https://evil.example.com' }, method: 'GET', query: { symbols: 'AAPL' } };
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(403);
  });

  it('allows the configured GitHub Pages origin and echoes it back in the CORS header', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const req = { headers: { origin: 'https://rwech.github.io' }, method: 'GET', query: { symbols: 'AAPL' } };
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://rwech.github.io');
  });

  it('returns the live price for a symbol whose upstream fetch succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ chart: { result: [{ meta: { regularMarketPrice: 123.45, currency: 'USD' } }] } }),
    }));
    const req = { headers: {}, method: 'GET', query: { symbols: 'AAPL' } };
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.AAPL).toMatchObject({ price: 123.45, currency: 'USD' });
    expect(res.body.AAPL.fetchedAt).toBeTruthy();
  });

  it('falls back to a null currency when the chart response omits it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ chart: { result: [{ meta: { regularMarketPrice: 50 } }] } }),
    }));
    const req = { headers: {}, method: 'GET', query: { symbols: 'AAPL' } };
    const res = createRes();
    await handler(req, res);
    expect(res.body.AAPL).toMatchObject({ price: 50, currency: null });
  });

  it('returns null for a symbol whose chart response is missing a usable price', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ chart: { result: [{ meta: {} }] } }),
    }));
    const req = { headers: {}, method: 'GET', query: { symbols: 'AAPL' } };
    const res = createRes();
    await handler(req, res);
    expect(res.body.AAPL).toBeNull();
  });

  it('responds to an OPTIONS preflight with 204', async () => {
    const req = { headers: { origin: 'https://rwech.github.io' }, method: 'OPTIONS', query: {} };
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
  });

  it('respects an ALLOWED_ORIGINS env override instead of the hardcoded default', async () => {
    process.env.ALLOWED_ORIGINS = 'https://example.com';
    const req = { headers: { origin: 'https://rwech.github.io' }, method: 'GET', query: { symbols: 'AAPL' } };
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(403);
  });
});
