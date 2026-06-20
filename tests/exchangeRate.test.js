import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '../src/storage.js';
import '../src/exchangeRate.js';

const { getExchangeRate, usdToTwd, twdToUsd } = window.PFD.exchangeRate;
const storage = window.PFD.storage;

describe('exchangeRate conversions', () => {
  it('converts USD to TWD', () => {
    expect(usdToTwd(100, 32)).toBe(3200);
  });

  it('converts TWD to USD', () => {
    expect(twdToUsd(3200, 32)).toBe(100);
  });

  it('returns NaN instead of Infinity when the rate is zero', () => {
    expect(twdToUsd(100, 0)).toBeNaN();
  });
});

describe('exchangeRate.getExchangeRate', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the cached rate without calling fetch when the cache is still fresh', async () => {
    storage.saveFxCache({
      rate: 32,
      base: 'USD',
      quote: 'TWD',
      fetchedAt: new Date().toISOString(),
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await getExchangeRate();
    expect(result).toMatchObject({ rate: 32, source: 'cache' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches a fresh rate and caches it on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({ result: 'success', rates: { TWD: 31.5 } }),
      }),
    );

    const result = await getExchangeRate();
    expect(result).toMatchObject({
      rate: 31.5,
      base: 'USD',
      quote: 'TWD',
      source: 'live',
    });
    expect(storage.loadFxCache()).toMatchObject({ rate: 31.5 });
  });

  it('forceRefresh bypasses a fresh cache and re-fetches', async () => {
    storage.saveFxCache({
      rate: 32,
      base: 'USD',
      quote: 'TWD',
      fetchedAt: new Date().toISOString(),
    });
    const fetchSpy = vi.fn().mockResolvedValue({
      json: async () => ({ result: 'success', rates: { TWD: 33 } }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await getExchangeRate({ forceRefresh: true });
    expect(fetchSpy).toHaveBeenCalled();
    expect(result).toMatchObject({ rate: 33, source: 'live' });
  });

  it('falls back to a stale cache when the live fetch fails and a cache exists', async () => {
    storage.saveFxCache({
      rate: 30,
      base: 'USD',
      quote: 'TWD',
      fetchedAt: '2000-01-01T00:00:00.000Z',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down')),
    );

    const result = await getExchangeRate({ forceRefresh: true });
    expect(result).toMatchObject({ rate: 30, source: 'stale-cache' });
  });

  it('returns null when the live fetch fails and there is no cache at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down')),
    );
    expect(await getExchangeRate()).toBeNull();
  });

  it('treats an unexpected response shape as a failure (falls back like a network error)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({ result: 'error' }),
      }),
    );
    expect(await getExchangeRate()).toBeNull();
  });
});
