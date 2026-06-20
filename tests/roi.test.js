import { describe, it, expect } from 'vitest';
import '../src/roi.js';

const { computeSymbolStats, roiPct } = window.PFD.roi;

describe('roi.computeSymbolStats', () => {
  it('averages cost basis across multiple buys', () => {
    const txs = [
      { symbol: 'AAA', name: 'A Corp', market: 'US', date: '2024-01-01', action: 'buy', quantity: 10, price: 100, fee: 0 },
      { symbol: 'AAA', name: 'A Corp', market: 'US', date: '2024-02-01', action: 'buy', quantity: 10, price: 200, fee: 0 },
    ];
    const stat = computeSymbolStats(txs).get('AAA');
    expect(stat.avgCost).toBe(150);
    expect(stat.remainingQty).toBe(20);
    expect(stat.totalInvested).toBe(3000);
  });

  it('caps a sell at remaining holdings and computes realized gain', () => {
    const txs = [
      { symbol: 'AAA', name: 'A', market: 'US', date: '2024-01-01', action: 'buy', quantity: 10, price: 100, fee: 0 },
      { symbol: 'AAA', name: 'A', market: 'US', date: '2024-02-01', action: 'sell', quantity: 50, price: 150, fee: 5 },
    ];
    const stat = computeSymbolStats(txs).get('AAA');
    expect(stat.remainingQty).toBe(0);
    expect(stat.realizedGain).toBe((150 - 100) * 10 - 5);
  });
});

describe('roi.computeSymbolStats with year filter (cross-year realized gain)', () => {
  const txs = [
    { symbol: 'AAA', name: 'A', market: 'US', date: '2022-03-01', action: 'buy', quantity: 1, price: 6, fee: 0 },
    { symbol: 'AAA', name: 'A', market: 'US', date: '2023-05-01', action: 'buy', quantity: 2, price: 8, fee: 0 },
    { symbol: 'AAA', name: 'A', market: 'US', date: '2024-07-01', action: 'sell', quantity: 1, price: 10, fee: 0 },
  ];

  it('computes realized gain against full-history avg cost when filtered to the sell year', () => {
    const stat = computeSymbolStats(txs, '2024').get('AAA');
    expect(stat.realizedGain).toBeCloseTo((10 - 22 / 3) * 1, 5); // ≈ 2.667
    expect(stat.remainingQty).toBe(2);
    expect(stat.totalInvested).toBe(22); // lifetime: 6 + 16
  });

  it('omits a symbol from a year-filtered report when it has no transactions that year', () => {
    expect(computeSymbolStats(txs, '2025').has('AAA')).toBe(false);
  });

  it('year="all" (and the default) still reflects full lifetime realized gain', () => {
    expect(computeSymbolStats(txs, 'all').get('AAA').realizedGain).toBeCloseTo((10 - 22 / 3) * 1, 5);
    expect(computeSymbolStats(txs).get('AAA').realizedGain).toBeCloseTo((10 - 22 / 3) * 1, 5);
  });
});

describe('roi.roiPct', () => {
  it('returns null when nothing has been invested', () => {
    expect(roiPct(0, 0, 0)).toBeNull();
  });

  it('computes gain as a percentage of invested capital', () => {
    expect(roiPct(50, -10, 1000)).toBeCloseTo(4);
  });
});
