import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '../src/storage.js';
import '../src/stockPrice.js';

const { resolveCurrentPrice, isPriceStale, refreshPrices, toYahooSymbol } =
  window.PFD.stockPrice;
const storage = window.PFD.storage;

describe('stockPrice.resolveCurrentPrice', () => {
  it('prefers a manual override over cache/estimate', () => {
    const resolved = resolveCurrentPrice('AAA', {
      priceOverrides: { AAA: 42 },
      priceCache: {},
      avgCost: 10,
    });
    expect(resolved).toMatchObject({
      value: 42,
      source: 'override',
      fetchedAt: null,
    });
  });

  it('uses the cached price and carries its fetchedAt timestamp', () => {
    const fetchedAt = new Date().toISOString();
    const resolved = resolveCurrentPrice('AAA', {
      priceOverrides: {},
      priceCache: { AAA: { price: 99, source: 'live', fetchedAt } },
      avgCost: 10,
    });
    expect(resolved).toMatchObject({ value: 99, source: 'live', fetchedAt });
  });

  it('downgrades a live-sourced cache entry to cache once it goes stale, so live and stale never overlap', () => {
    const fetchedAt = '2024-01-01T00:00:00.000Z';
    const resolved = resolveCurrentPrice('AAA', {
      priceOverrides: {},
      priceCache: { AAA: { price: 99, source: 'live', fetchedAt } },
      avgCost: 10,
    });
    expect(resolved).toMatchObject({ value: 99, source: 'cache', fetchedAt });
  });

  it('falls back to avgCost as an estimate when nothing is cached', () => {
    const resolved = resolveCurrentPrice('AAA', {
      priceOverrides: {},
      priceCache: {},
      avgCost: 88,
    });
    expect(resolved).toMatchObject({
      value: 88,
      source: 'estimate',
      fetchedAt: null,
    });
  });

  it('falls back to null fetchedAt for a cache entry that has none', () => {
    const resolved = resolveCurrentPrice('AAA', {
      priceOverrides: {},
      priceCache: { AAA: { price: 99, source: 'cache' } },
      avgCost: 10,
    });
    expect(resolved).toMatchObject({
      value: 99,
      source: 'cache',
      fetchedAt: null,
    });
  });
});

describe('stockPrice.isPriceStale', () => {
  it('never flags manual overrides as stale', () => {
    expect(isPriceStale('override', null)).toBe(false);
  });

  it('flags estimate prices (never fetched) as stale', () => {
    expect(isPriceStale('estimate', null)).toBe(true);
  });

  it('flags a cached price as stale once past the threshold', () => {
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(isPriceStale('cache', old)).toBe(true);
  });

  it('treats a just-fetched price as fresh', () => {
    const recent = new Date().toISOString();
    expect(isPriceStale('live', recent)).toBe(false);
  });
});

describe('stockPrice.toYahooSymbol', () => {
  it('appends .TW for the Taiwan market', () => {
    expect(toYahooSymbol('2330', 'TW')).toBe('2330.TW');
  });

  it('leaves a US symbol unchanged', () => {
    expect(toYahooSymbol('AAPL', 'US')).toBe('AAPL');
  });
});

describe('stockPrice.refreshPrices', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.PFD.config;
  });

  it('prefixes the request URL with window.PFD.config.apiBaseUrl when it is set', async () => {
    window.PFD.config = { apiBaseUrl: 'https://api.example.com' };
    const fetchSpy = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchSpy);

    await refreshPrices([{ symbol: 'AAPL', market: 'US' }]);
    expect(fetchSpy.mock.calls[0][0]).toMatch(
      /^https:\/\/api\.example\.com\/api\/stock-price/,
    );
  });

  it('returns an empty map without calling fetch when there are no symbols to refresh', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await refreshPrices([]);
    expect(result.size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('stores live prices in the cache and returns them keyed by the original symbol', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          AAPL: {
            price: 200,
            currency: 'USD',
            fetchedAt: '2024-01-01T00:00:00.000Z',
          },
        }),
      }),
    );

    const result = await refreshPrices([{ symbol: 'AAPL', market: 'US' }]);
    expect(result.get('AAPL')).toMatchObject({
      price: 200,
      currency: 'USD',
      source: 'live',
    });
    expect(storage.loadPriceCache().AAPL).toMatchObject({
      price: 200,
      source: 'live',
    });
  });

  it('uses the Yahoo .TW suffix when requesting a Taiwan symbol', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchSpy);

    await refreshPrices([{ symbol: '2330', market: 'TW' }]);
    expect(fetchSpy.mock.calls[0][0]).toContain('2330.TW');
  });

  it('falls back to the existing cache entry when the API responds not-ok', async () => {
    storage.savePriceCache({
      AAPL: {
        price: 150,
        source: 'live',
        fetchedAt: '2024-01-01T00:00:00.000Z',
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    const result = await refreshPrices([{ symbol: 'AAPL', market: 'US' }]);
    expect(result.get('AAPL')).toMatchObject({ price: 150, source: 'cache' });
  });

  it('falls back to the existing cache entry when the fetch throws (e.g. offline)', async () => {
    storage.savePriceCache({
      AAPL: {
        price: 150,
        source: 'live',
        fetchedAt: '2024-01-01T00:00:00.000Z',
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down')),
    );

    const result = await refreshPrices([{ symbol: 'AAPL', market: 'US' }]);
    expect(result.get('AAPL')).toMatchObject({ price: 150, source: 'cache' });
  });

  it('resolves to null for a symbol with neither a live price nor a cache entry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const result = await refreshPrices([{ symbol: 'NEWSYM', market: 'US' }]);
    expect(result.get('NEWSYM')).toBeNull();
  });
});
