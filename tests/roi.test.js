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

describe('roi.roiPct', () => {
  it('returns null when nothing has been invested', () => {
    expect(roiPct(0, 0, 0)).toBeNull();
  });

  it('computes gain as a percentage of invested capital', () => {
    expect(roiPct(50, -10, 1000)).toBeCloseTo(4);
  });
});
