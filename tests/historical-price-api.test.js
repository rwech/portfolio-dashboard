import { describe, it, expect, vi, afterEach } from 'vitest';
import handler from '../api/historical-price.js';

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

describe('api/historical-price handler', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ALLOWED_ORIGINS;
  });

  it('loads and runs under the ESM loader without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const req = {
      headers: {},
      method: 'GET',
      query: { symbols: 'AAPL', period1: '1000', period2: '2000' },
    };
    const res = createRes();
    await expect(handler(req, res)).resolves.toBeUndefined();
    expect(res.statusCode).toBe(200);
  });

  it('returns 400 when the symbols query param is missing', async () => {
    const req = {
      headers: {},
      method: 'GET',
      query: { period1: '1000', period2: '2000' },
    };
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when period1/period2 are missing', async () => {
    const req = { headers: {}, method: 'GET', query: { symbols: 'AAPL' } };
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when period1/period2 are non-numeric', async () => {
    const req = {
      headers: {},
      method: 'GET',
      query: { symbols: 'AAPL', period1: 'abc', period2: 'def' },
    };
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when period2 <= period1', async () => {
    const req = {
      headers: {},
      method: 'GET',
      query: { symbols: 'AAPL', period1: '2000', period2: '1000' },
    };
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('rejects requests from a disallowed origin', async () => {
    const req = {
      headers: { origin: 'https://evil.example.com' },
      method: 'GET',
      query: { symbols: 'AAPL', period1: '1000', period2: '2000' },
    };
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(403);
  });

  it('allows the configured GitHub Pages origin and echoes it back in the CORS header', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const req = {
      headers: { origin: 'https://rwech.github.io' },
      method: 'GET',
      query: { symbols: 'AAPL', period1: '1000', period2: '2000' },
    };
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Access-Control-Allow-Origin']).toBe(
      'https://rwech.github.io',
    );
  });

  it('responds to an OPTIONS preflight with 204', async () => {
    const req = {
      headers: { origin: 'https://rwech.github.io' },
      method: 'OPTIONS',
      query: {},
    };
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
  });

  it('respects an ALLOWED_ORIGINS env override instead of the hardcoded default', async () => {
    process.env.ALLOWED_ORIGINS = 'https://example.com';
    const req = {
      headers: { origin: 'https://rwech.github.io' },
      method: 'GET',
      query: { symbols: 'AAPL', period1: '1000', period2: '2000' },
    };
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(403);
  });

  it('falls back to null per-symbol when the upstream fetch fails, without crashing the whole request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down')),
    );
    const req = {
      headers: {},
      method: 'GET',
      query: { symbols: 'AAPL,2330.TW', period1: '1000', period2: '2000' },
    };
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ AAPL: null, '2330.TW': null });
  });

  it('returns null when the upstream response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const req = {
      headers: {},
      method: 'GET',
      query: { symbols: 'AAPL', period1: '1000', period2: '2000' },
    };
    const res = createRes();
    await handler(req, res);
    expect(res.body).toEqual({ AAPL: null });
  });

  it('zips timestamps and closes, filtering out non-finite closes, and sorts ascending', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          chart: {
            result: [
              {
                timestamp: [1700000000, 1700086400, 1700172800],
                indicators: {
                  quote: [{ close: [150.5, null, 152.25] }],
                },
              },
            ],
          },
        }),
      }),
    );
    const req = {
      headers: {},
      method: 'GET',
      query: { symbols: 'AAPL', period1: '1000', period2: '2000' },
    };
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.AAPL).toEqual([
      {
        date: new Date(1700000000 * 1000).toISOString().slice(0, 10),
        close: 150.5,
      },
      {
        date: new Date(1700172800 * 1000).toISOString().slice(0, 10),
        close: 152.25,
      },
    ]);
  });

  it('returns null when the chart response is missing timestamp/close arrays', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ chart: { result: [{}] } }),
      }),
    );
    const req = {
      headers: {},
      method: 'GET',
      query: { symbols: 'AAPL', period1: '1000', period2: '2000' },
    };
    const res = createRes();
    await handler(req, res);
    expect(res.body.AAPL).toBeNull();
  });

  it('sets a longer cache TTL than the live-price endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const req = {
      headers: {},
      method: 'GET',
      query: { symbols: 'AAPL', period1: '1000', period2: '2000' },
    };
    const res = createRes();
    await handler(req, res);
    expect(res.headers['Cache-Control']).toBe(
      's-maxage=3600, stale-while-revalidate=300',
    );
  });
});
