import { describe, it, expect } from 'vitest';
import '../src/stockPrice.js';

const { resolveCurrentPrice, isPriceStale } = window.PFD.stockPrice;

describe('stockPrice.resolveCurrentPrice', () => {
  it('prefers a manual override over cache/estimate', () => {
    const resolved = resolveCurrentPrice('AAA', { priceOverrides: { AAA: 42 }, priceCache: {}, avgCost: 10 });
    expect(resolved).toMatchObject({ value: 42, source: 'override', fetchedAt: null });
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
    const resolved = resolveCurrentPrice('AAA', { priceOverrides: {}, priceCache: {}, avgCost: 88 });
    expect(resolved).toMatchObject({ value: 88, source: 'estimate', fetchedAt: null });
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
