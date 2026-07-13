import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  onRequestGet,
  onRequestOptions,
} from '../functions/api/stock-price.js';

function makeContext({ url, origin, env = {} }) {
  const headers = origin ? { origin } : {};
  return { request: new Request(url, { headers }), env };
}

describe('functions/api/stock-price (Cloudflare Pages Function)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back to null per-symbol when the upstream fetch fails, without crashing the whole request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down')),
    );
    const res = await onRequestGet(
      makeContext({
        url: 'https://example.com/api/stock-price?symbols=AAPL,2330.TW',
      }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ AAPL: null, '2330.TW': null });
  });

  it('returns 400 when the symbols query param is missing', async () => {
    const res = await onRequestGet(
      makeContext({ url: 'https://example.com/api/stock-price' }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects requests from a disallowed origin', async () => {
    const res = await onRequestGet(
      makeContext({
        url: 'https://example.com/api/stock-price?symbols=AAPL',
        origin: 'https://evil.example.com',
      }),
    );
    expect(res.status).toBe(403);
  });

  it('allows the configured GitHub Pages origin and echoes it back in the CORS header', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const res = await onRequestGet(
      makeContext({
        url: 'https://example.com/api/stock-price?symbols=AAPL',
        origin: 'https://rwech.github.io',
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://rwech.github.io',
    );
  });

  it('returns the live price for a symbol whose upstream fetch succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          chart: {
            result: [{ meta: { regularMarketPrice: 123.45, currency: 'USD' } }],
          },
        }),
      }),
    );
    const res = await onRequestGet(
      makeContext({ url: 'https://example.com/api/stock-price?symbols=AAPL' }),
    );
    const body = await res.json();
    expect(body.AAPL).toMatchObject({ price: 123.45, currency: 'USD' });
    expect(body.AAPL.fetchedAt).toBeTruthy();
  });

  it('responds to an OPTIONS preflight with 204', async () => {
    const res = await onRequestOptions(
      makeContext({
        url: 'https://example.com/api/stock-price',
        origin: 'https://rwech.github.io',
      }),
    );
    expect(res.status).toBe(204);
  });

  it('respects an ALLOWED_ORIGINS env override instead of the hardcoded default', async () => {
    const res = await onRequestGet(
      makeContext({
        url: 'https://example.com/api/stock-price?symbols=AAPL',
        origin: 'https://rwech.github.io',
        env: { ALLOWED_ORIGINS: 'https://example.com' },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('sets the live-price cache TTL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const res = await onRequestGet(
      makeContext({ url: 'https://example.com/api/stock-price?symbols=AAPL' }),
    );
    expect(res.headers.get('Cache-Control')).toBe(
      's-maxage=60, stale-while-revalidate=30',
    );
  });
});
