import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  onRequestGet,
  onRequestOptions,
} from '../functions/api/historical-price.js';

function makeContext({ url, origin, env = {} }) {
  const headers = origin ? { origin } : {};
  return { request: new Request(url, { headers }), env };
}

describe('functions/api/historical-price (Cloudflare Pages Function)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 400 when the symbols query param is missing', async () => {
    const res = await onRequestGet(
      makeContext({
        url: 'https://example.com/api/historical-price?period1=1000&period2=2000',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when period1/period2 are missing', async () => {
    const res = await onRequestGet(
      makeContext({
        url: 'https://example.com/api/historical-price?symbols=AAPL',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when period2 <= period1', async () => {
    const res = await onRequestGet(
      makeContext({
        url: 'https://example.com/api/historical-price?symbols=AAPL&period1=2000&period2=1000',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects requests from a disallowed origin', async () => {
    const res = await onRequestGet(
      makeContext({
        url: 'https://example.com/api/historical-price?symbols=AAPL&period1=1000&period2=2000',
        origin: 'https://evil.example.com',
      }),
    );
    expect(res.status).toBe(403);
  });

  it('responds to an OPTIONS preflight with 204', async () => {
    const res = await onRequestOptions(
      makeContext({
        url: 'https://example.com/api/historical-price',
        origin: 'https://rwech.github.io',
      }),
    );
    expect(res.status).toBe(204);
  });

  it('falls back to null per-symbol when the upstream fetch fails, without crashing the whole request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down')),
    );
    const res = await onRequestGet(
      makeContext({
        url: 'https://example.com/api/historical-price?symbols=AAPL,2330.TW&period1=1000&period2=2000',
      }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ AAPL: null, '2330.TW': null });
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
    const res = await onRequestGet(
      makeContext({
        url: 'https://example.com/api/historical-price?symbols=AAPL&period1=1000&period2=2000',
      }),
    );
    const body = await res.json();
    expect(body.AAPL).toEqual([
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

  it('sets a longer cache TTL than the live-price endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const res = await onRequestGet(
      makeContext({
        url: 'https://example.com/api/historical-price?symbols=AAPL&period1=1000&period2=2000',
      }),
    );
    expect(res.headers.get('Cache-Control')).toBe(
      's-maxage=3600, stale-while-revalidate=300',
    );
  });
});
