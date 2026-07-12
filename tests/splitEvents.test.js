import { describe, it, expect } from 'vitest';
import '../src/splitEvents.js';

const { getSplitsForSymbol, normalizeForSplits, adjustPricesForSplits } =
  window.PFD.splitEvents;

describe('splitEvents.getSplitsForSymbol', () => {
  it('returns the splits array for a known symbol', () => {
    const cache = { AAPL: { splits: [{ date: '2020-08-31', ratio: 4 }] } };
    expect(getSplitsForSymbol('AAPL', cache)).toEqual([
      { date: '2020-08-31', ratio: 4 },
    ]);
  });

  it('returns an empty array for a symbol not present in the cache', () => {
    expect(getSplitsForSymbol('AAPL', {})).toEqual([]);
  });
});

describe('splitEvents.normalizeForSplits', () => {
  const buyTx = (date, quantity, price) => ({
    symbol: 'AAPL',
    name: 'Apple',
    market: 'US',
    date,
    action: 'buy',
    quantity,
    price,
    fee: 0,
  });

  it('scales up quantity and scales down price for a transaction before a single split', () => {
    const txs = [buyTx('2020-01-01', 100, 400)];
    const cache = {
      AAPL: {
        splits: [
          { date: '2020-08-31', numerator: 4, denominator: 1, ratio: 4 },
        ],
      },
    };
    const [normalized] = normalizeForSplits(txs, cache);
    expect(normalized.quantity).toBe(400);
    expect(normalized.price).toBe(100);
  });

  it('leaves a transaction dated on or after the split unchanged', () => {
    const txs = [buyTx('2020-09-01', 100, 100)];
    const cache = {
      AAPL: {
        splits: [
          { date: '2020-08-31', numerator: 4, denominator: 1, ratio: 4 },
        ],
      },
    };
    const [normalized] = normalizeForSplits(txs, cache);
    expect(normalized).toBe(txs[0]);
  });

  it('compounds multiple splits that occur after the transaction date', () => {
    const txs = [buyTx('2019-01-01', 100, 800)];
    const cache = {
      AAPL: {
        splits: [
          { date: '2020-08-31', numerator: 4, denominator: 1, ratio: 4 },
          { date: '2022-06-01', numerator: 2, denominator: 1, ratio: 2 },
        ],
      },
    };
    const [normalized] = normalizeForSplits(txs, cache);
    expect(normalized.quantity).toBe(800);
    expect(normalized.price).toBe(100);
  });

  it('only applies splits that happened after the transaction, not ones before it', () => {
    const txs = [buyTx('2021-01-01', 100, 200)];
    const cache = {
      AAPL: {
        splits: [
          { date: '2020-08-31', numerator: 4, denominator: 1, ratio: 4 },
          { date: '2022-06-01', numerator: 2, denominator: 1, ratio: 2 },
        ],
      },
    };
    const [normalized] = normalizeForSplits(txs, cache);
    expect(normalized.quantity).toBe(200);
    expect(normalized.price).toBe(100);
  });

  it('returns the original object reference (no allocation) when the symbol has no splits at all', () => {
    const txs = [buyTx('2020-01-01', 100, 400)];
    const [normalized] = normalizeForSplits(txs, {});
    expect(normalized).toBe(txs[0]);
  });

  it('does not mutate the original transaction objects', () => {
    const txs = [buyTx('2020-01-01', 100, 400)];
    const cache = {
      AAPL: {
        splits: [
          { date: '2020-08-31', numerator: 4, denominator: 1, ratio: 4 },
        ],
      },
    };
    normalizeForSplits(txs, cache);
    expect(txs[0].quantity).toBe(100);
    expect(txs[0].price).toBe(400);
  });

  it('does not affect transactions for other symbols', () => {
    const txs = [
      buyTx('2020-01-01', 100, 400),
      { ...buyTx('2020-01-01', 10, 50), symbol: 'MSFT' },
    ];
    const cache = {
      AAPL: {
        splits: [
          { date: '2020-08-31', numerator: 4, denominator: 1, ratio: 4 },
        ],
      },
    };
    const [, msftTx] = normalizeForSplits(txs, cache);
    expect(msftTx).toBe(txs[1]);
  });
});

describe('splitEvents.adjustPricesForSplits', () => {
  it('divides pre-split closes by the ratio and leaves post-split closes unchanged', () => {
    const prices = [
      { date: '2020-08-01', close: 400 },
      { date: '2020-09-01', close: 120 },
    ];
    const splits = [
      { date: '2020-08-31', numerator: 4, denominator: 1, ratio: 4 },
    ];
    expect(adjustPricesForSplits(prices, splits)).toEqual([
      { date: '2020-08-01', close: 100 },
      { date: '2020-09-01', close: 120 },
    ]);
  });

  it('returns the same array reference when there are no splits', () => {
    const prices = [{ date: '2020-08-01', close: 400 }];
    expect(adjustPricesForSplits(prices, [])).toBe(prices);
    expect(adjustPricesForSplits(prices, undefined)).toBe(prices);
  });

  it('does not mutate the original price objects', () => {
    const prices = [{ date: '2020-08-01', close: 400 }];
    const splits = [
      { date: '2020-08-31', numerator: 4, denominator: 1, ratio: 4 },
    ];
    adjustPricesForSplits(prices, splits);
    expect(prices[0].close).toBe(400);
  });
});
