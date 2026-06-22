import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '../src/storage.js';
import '../src/stockPrice.js';
import '../src/historicalPrice.js';

const { findCloseOnOrBefore, findGaps, fetchHistoricalPrices, buildResolver } =
  window.PFD.historicalPrice;
const storage = window.PFD.storage;

describe('historicalPrice.findCloseOnOrBefore', () => {
  const prices = [
    { date: '2024-01-02', close: 10 },
    { date: '2024-01-03', close: 11 },
    { date: '2024-01-05', close: 12 },
  ];

  it('returns the close for an exact date match', () => {
    expect(findCloseOnOrBefore(prices, '2024-01-03')).toBe(11);
  });

  it('falls back to the last close before a weekend/holiday gap', () => {
    expect(findCloseOnOrBefore(prices, '2024-01-04')).toBe(11);
  });

  it('returns null when the date precedes the first entry', () => {
    expect(findCloseOnOrBefore(prices, '2024-01-01')).toBeNull();
  });

  it('returns null for an empty array', () => {
    expect(findCloseOnOrBefore([], '2024-01-03')).toBeNull();
  });

  it('returns null when prices is not an array', () => {
    expect(findCloseOnOrBefore(null, '2024-01-03')).toBeNull();
  });

  it('returns the latest close when the date is after the last entry', () => {
    expect(findCloseOnOrBefore(prices, '2024-12-31')).toBe(12);
  });
});

describe('historicalPrice.findGaps', () => {
  it('returns an empty array when the cache fully covers the requested range', () => {
    const cache = {
      AAPL: { rangeStart: '2024-01-01', rangeEnd: '2024-12-31' },
    };
    const ranges = [
      {
        symbol: 'AAPL',
        market: 'US',
        fromDate: '2024-03-01',
        toDate: '2024-06-01',
      },
    ];
    expect(findGaps(ranges, cache)).toEqual([]);
  });

  it('flags a symbol missing from the cache entirely', () => {
    const ranges = [
      {
        symbol: 'AAPL',
        market: 'US',
        fromDate: '2024-01-01',
        toDate: '2024-06-01',
      },
    ];
    expect(findGaps(ranges, {})).toEqual(ranges);
  });

  it('flags a symbol whose cached range does not cover the requested range', () => {
    const cache = {
      AAPL: { rangeStart: '2024-03-01', rangeEnd: '2024-06-01' },
    };
    const ranges = [
      {
        symbol: 'AAPL',
        market: 'US',
        fromDate: '2024-01-01',
        toDate: '2024-06-01',
      },
    ];
    expect(findGaps(ranges, cache)).toEqual(ranges);
  });

  it('only returns the entries that actually have gaps', () => {
    const cache = {
      AAPL: { rangeStart: '2024-01-01', rangeEnd: '2024-12-31' },
    };
    const ranges = [
      {
        symbol: 'AAPL',
        market: 'US',
        fromDate: '2024-03-01',
        toDate: '2024-06-01',
      },
      {
        symbol: '2330',
        market: 'TW',
        fromDate: '2024-01-01',
        toDate: '2024-06-01',
      },
    ];
    expect(findGaps(ranges, cache)).toEqual([ranges[1]]);
  });
});

describe('historicalPrice.fetchHistoricalPrices', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.PFD.config;
  });

  it('is a no-op and does not call fetch when given an empty array', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await fetchHistoricalPrices([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('prefixes the request URL with window.PFD.config.apiBaseUrl when set', async () => {
    window.PFD.config = { apiBaseUrl: 'https://api.example.com' };
    const fetchSpy = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchSpy);

    await fetchHistoricalPrices([
      {
        symbol: 'AAPL',
        market: 'US',
        fromDate: '2024-01-01',
        toDate: '2024-06-01',
      },
    ]);
    expect(fetchSpy.mock.calls[0][0]).toMatch(
      /^https:\/\/api\.example\.com\/api\/historical-price/,
    );
  });

  it('converts symbols to Yahoo format and fetches a shared period spanning all gap entries', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchSpy);

    await fetchHistoricalPrices([
      {
        symbol: '2330',
        market: 'TW',
        fromDate: '2024-01-01',
        toDate: '2024-03-01',
      },
      {
        symbol: 'AAPL',
        market: 'US',
        fromDate: '2024-02-01',
        toDate: '2024-06-01',
      },
    ]);
    const url = fetchSpy.mock.calls[0][0];
    expect(url).toContain('2330.TW');
    expect(url).toContain('AAPL');
    expect(url).toMatch(/period1=\d+/);
    expect(url).toMatch(/period2=\d+/);
  });

  it('merges successful results into the cache keyed by the original app symbol and persists them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          AAPL: [
            { date: '2024-01-02', close: 100 },
            { date: '2024-01-03', close: 101 },
          ],
        }),
      }),
    );

    const cache = await fetchHistoricalPrices([
      {
        symbol: 'AAPL',
        market: 'US',
        fromDate: '2024-01-01',
        toDate: '2024-01-31',
      },
    ]);
    expect(cache.AAPL.prices).toEqual([
      { date: '2024-01-02', close: 100 },
      { date: '2024-01-03', close: 101 },
    ]);
    expect(cache.AAPL.rangeStart).toBe('2024-01-01');
    expect(cache.AAPL.rangeEnd).toBe('2024-01-31');
    expect(storage.loadHistoricalPriceCache().AAPL).toMatchObject({
      rangeStart: '2024-01-01',
      rangeEnd: '2024-01-31',
    });
  });

  it('stores the requested range, not the data span, so a legitimately-empty range is not re-fetched forever', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ NEWCO: [] }),
      }),
    );

    const cache = await fetchHistoricalPrices([
      {
        symbol: 'NEWCO',
        market: 'US',
        fromDate: '2024-01-01',
        toDate: '2024-01-31',
      },
    ]);
    expect(cache.NEWCO.prices).toEqual([]);
    expect(cache.NEWCO.rangeStart).toBe('2024-01-01');
    expect(cache.NEWCO.rangeEnd).toBe('2024-01-31');
  });

  it('leaves existing cache entries untouched when the upstream fetch fails', async () => {
    storage.saveHistoricalPriceCache({
      AAPL: {
        prices: [{ date: '2024-01-02', close: 100 }],
        rangeStart: '2024-01-01',
        rangeEnd: '2024-01-31',
        fetchedAt: '2024-01-01T00:00:00.000Z',
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down')),
    );

    const cache = await fetchHistoricalPrices([
      {
        symbol: 'AAPL',
        market: 'US',
        fromDate: '2024-02-01',
        toDate: '2024-03-01',
      },
    ]);
    expect(cache.AAPL.rangeStart).toBe('2024-01-01');
    expect(cache.AAPL.rangeEnd).toBe('2024-01-31');
  });

  it('leaves existing cache entries untouched when the upstream response is not ok', async () => {
    storage.saveHistoricalPriceCache({
      AAPL: {
        prices: [{ date: '2024-01-02', close: 100 }],
        rangeStart: '2024-01-01',
        rangeEnd: '2024-01-31',
        fetchedAt: '2024-01-01T00:00:00.000Z',
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    const cache = await fetchHistoricalPrices([
      {
        symbol: 'AAPL',
        market: 'US',
        fromDate: '2024-02-01',
        toDate: '2024-03-01',
      },
    ]);
    expect(cache.AAPL.rangeStart).toBe('2024-01-01');
    expect(cache.AAPL.rangeEnd).toBe('2024-01-31');
  });
});

describe('historicalPrice.buildResolver', () => {
  it('resolves a price using the cache for the given symbol and date', () => {
    const resolver = buildResolver({
      AAPL: {
        prices: [
          { date: '2024-01-02', close: 100 },
          { date: '2024-01-05', close: 105 },
        ],
      },
    });
    expect(resolver('AAPL', '2024-01-04')).toBe(100);
  });

  it('returns null for a symbol not present in the cache', () => {
    const resolver = buildResolver({});
    expect(resolver('AAPL', '2024-01-04')).toBeNull();
  });
});
