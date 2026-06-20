import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../src/storage.js';

const storage = window.PFD.storage;

describe('storage theme persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to the neon theme when nothing is saved', () => {
    expect(storage.loadTheme()).toBe('neon');
  });

  it('round-trips a saved theme', () => {
    storage.saveTheme('midnight');
    expect(storage.loadTheme()).toBe('midnight');
  });
});

describe('storage transactions', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts empty for a market with nothing saved', () => {
    expect(storage.loadTransactions('TW')).toEqual([]);
  });

  it('normalizes a legacy mixed-case action already sitting in localStorage', () => {
    localStorage.setItem(
      'pfd.transactions.tw',
      JSON.stringify([
        {
          id: '1',
          date: '2024-01-01',
          symbol: '2330',
          name: '',
          action: 'Buy',
          quantity: 10,
          price: 100,
          fee: 0,
          market: 'TW',
        },
      ]),
    );
    const list = storage.loadTransactions('TW');
    expect(list[0].action).toBe('buy');
  });

  it('addTransaction assigns an id/market and appends to the existing list', () => {
    const first = storage.addTransaction('TW', {
      date: '2024-01-01',
      symbol: '2330',
      name: '',
      action: 'buy',
      quantity: 10,
      price: 100,
      fee: 0,
    });
    expect(first.id).toBeTruthy();
    expect(first.market).toBe('TW');

    const second = storage.addTransaction('TW', {
      date: '2024-02-01',
      symbol: '2317',
      name: '',
      action: 'buy',
      quantity: 5,
      price: 50,
      fee: 0,
    });
    const list = storage.loadTransactions('TW');
    expect(list).toHaveLength(2);
    expect(list.map((t) => t.id)).toEqual([first.id, second.id]);
  });

  it('keeps TW and US transactions in separate keys', () => {
    storage.addTransaction('TW', {
      date: '2024-01-01',
      symbol: '2330',
      name: '',
      action: 'buy',
      quantity: 1,
      price: 1,
      fee: 0,
    });
    storage.addTransaction('US', {
      date: '2024-01-01',
      symbol: 'AAPL',
      name: '',
      action: 'buy',
      quantity: 1,
      price: 1,
      fee: 0,
    });
    expect(storage.loadTransactions('TW')).toHaveLength(1);
    expect(storage.loadTransactions('US')).toHaveLength(1);
  });

  it('replaceTransactions overwrites the full list for that market and assigns fresh ids', () => {
    storage.addTransaction('TW', {
      date: '2024-01-01',
      symbol: 'OLD',
      name: '',
      action: 'buy',
      quantity: 1,
      price: 1,
      fee: 0,
    });
    const replaced = storage.replaceTransactions('TW', [
      {
        date: '2024-03-01',
        symbol: 'NEW',
        name: '',
        action: 'buy',
        quantity: 2,
        price: 2,
        fee: 0,
      },
    ]);
    const list = storage.loadTransactions('TW');
    expect(list).toHaveLength(1);
    expect(list[0].symbol).toBe('NEW');
    expect(list[0].id).toBe(replaced[0].id);
  });

  it('deleteTransaction removes only the matching id', () => {
    const a = storage.addTransaction('TW', {
      date: '2024-01-01',
      symbol: 'A',
      name: '',
      action: 'buy',
      quantity: 1,
      price: 1,
      fee: 0,
    });
    const b = storage.addTransaction('TW', {
      date: '2024-02-01',
      symbol: 'B',
      name: '',
      action: 'buy',
      quantity: 1,
      price: 1,
      fee: 0,
    });
    storage.deleteTransaction('TW', a.id);
    const list = storage.loadTransactions('TW');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(b.id);
  });

  it('updateTransaction merges the given fields into the matching row and keeps its id/market', () => {
    const a = storage.addTransaction('TW', {
      date: '2024-01-01',
      symbol: 'A',
      name: '',
      action: 'buy',
      quantity: 1,
      price: 1,
      fee: 0,
    });
    const updated = storage.updateTransaction('TW', a.id, {
      symbol: 'B',
      quantity: 5,
    });
    expect(updated).toEqual({ ...a, symbol: 'B', quantity: 5 });
    const list = storage.loadTransactions('TW');
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual(updated);
  });

  it('updateTransaction returns null and leaves the list unchanged when the id is not found', () => {
    storage.addTransaction('TW', {
      date: '2024-01-01',
      symbol: 'A',
      name: '',
      action: 'buy',
      quantity: 1,
      price: 1,
      fee: 0,
    });
    const result = storage.updateTransaction('TW', 'missing-id', {
      symbol: 'B',
    });
    expect(result).toBeNull();
    expect(storage.loadTransactions('TW')).toHaveLength(1);
  });
});

describe('storage price cache and overrides', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('loadPriceCache defaults to an empty object', () => {
    expect(storage.loadPriceCache()).toEqual({});
  });

  it('round-trips the price cache', () => {
    storage.savePriceCache({ AAPL: { price: 100, source: 'live' } });
    expect(storage.loadPriceCache()).toEqual({
      AAPL: { price: 100, source: 'live' },
    });
  });

  it('loadPriceOverrides defaults to an empty object', () => {
    expect(storage.loadPriceOverrides()).toEqual({});
  });

  it('savePriceOverride merges into existing overrides instead of replacing them', () => {
    storage.savePriceOverride('AAPL', 150);
    storage.savePriceOverride('2330', 600);
    expect(storage.loadPriceOverrides()).toEqual({ AAPL: 150, 2330: 600 });
  });

  it('clearPriceOverride removes only the given symbol', () => {
    storage.savePriceOverride('AAPL', 150);
    storage.savePriceOverride('2330', 600);
    storage.clearPriceOverride('AAPL');
    expect(storage.loadPriceOverrides()).toEqual({ 2330: 600 });
  });
});

describe('storage fx cache, ui filters, and unexported change tracking', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('loadFxCache defaults to null', () => {
    expect(storage.loadFxCache()).toBeNull();
  });

  it('round-trips the fx cache', () => {
    const fx = {
      rate: 32,
      base: 'USD',
      quote: 'TWD',
      fetchedAt: '2024-01-01T00:00:00.000Z',
    };
    storage.saveFxCache(fx);
    expect(storage.loadFxCache()).toEqual(fx);
  });

  it('loadUiFilters defaults to null', () => {
    expect(storage.loadUiFilters()).toBeNull();
  });

  it('round-trips ui filters', () => {
    const filters = { year: '2024', market: 'TW', displayCurrency: 'TWD' };
    storage.saveUiFilters(filters);
    expect(storage.loadUiFilters()).toEqual(filters);
  });

  it('loadUnexportedChangeCount defaults to 0', () => {
    expect(storage.loadUnexportedChangeCount()).toBe(0);
  });

  it('incrementUnexportedChanges increases and persists the count', () => {
    expect(storage.incrementUnexportedChanges()).toBe(1);
    expect(storage.incrementUnexportedChanges()).toBe(2);
    expect(storage.loadUnexportedChangeCount()).toBe(2);
  });

  it('resetUnexportedChanges sets the count back to 0', () => {
    storage.incrementUnexportedChanges();
    storage.incrementUnexportedChanges();
    storage.resetUnexportedChanges();
    expect(storage.loadUnexportedChangeCount()).toBe(0);
  });
});

describe('storage resilience to a corrupted localStorage value', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('falls back instead of throwing when the stored JSON is malformed', () => {
    localStorage.setItem(storage.KEYS.TX_TW, '{not valid json');
    expect(storage.loadTransactions('TW')).toEqual([]);
  });

  it('falls back instead of throwing when the stored JSON parses but is not an array', () => {
    localStorage.setItem(storage.KEYS.TX_TW, '{}');
    expect(storage.loadTransactions('TW')).toEqual([]);
  });

  it('keeps the app working in-memory when localStorage.setItem throws (e.g. quota exceeded)', () => {
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
    expect(() => storage.saveTheme('forest')).not.toThrow();
    spy.mockRestore();
  });
});
