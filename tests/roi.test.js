import { describe, it, expect } from 'vitest';
import '../src/storage.js';
import '../src/stockPrice.js';
import '../src/exchangeRate.js';
import '../src/roi.js';

const {
  computeSymbolStats,
  computePortfolioSummary,
  filterTransactions,
  convertAmount,
  convertSummaryToDisplayCurrency,
  roiPct,
  resolveYearFilter,
  generateMonthEndSnapshotDates,
  computeRoiTrend,
} = window.PFD.roi;

describe('roi.computeSymbolStats', () => {
  it('averages cost basis across multiple buys', () => {
    const txs = [
      {
        symbol: 'AAA',
        name: 'A Corp',
        market: 'US',
        date: '2024-01-01',
        action: 'buy',
        quantity: 10,
        price: 100,
        fee: 0,
      },
      {
        symbol: 'AAA',
        name: 'A Corp',
        market: 'US',
        date: '2024-02-01',
        action: 'buy',
        quantity: 10,
        price: 200,
        fee: 0,
      },
    ];
    const stat = computeSymbolStats(txs).get('AAA');
    expect(stat.avgCost).toBe(150);
    expect(stat.remainingQty).toBe(20);
    expect(stat.totalInvested).toBe(3000);
  });

  it('caps a sell at remaining holdings and computes realized gain', () => {
    const txs = [
      {
        symbol: 'AAA',
        name: 'A',
        market: 'US',
        date: '2024-01-01',
        action: 'buy',
        quantity: 10,
        price: 100,
        fee: 0,
      },
      {
        symbol: 'AAA',
        name: 'A',
        market: 'US',
        date: '2024-02-01',
        action: 'sell',
        quantity: 50,
        price: 150,
        fee: 5,
      },
    ];
    const stat = computeSymbolStats(txs).get('AAA');
    expect(stat.remainingQty).toBe(0);
    expect(stat.realizedGain).toBe((150 - 100) * 10 - 5);
  });
});

describe('roi.computeSymbolStats with edge-case inputs', () => {
  it('keeps two same-date transactions in their original relative order', () => {
    const txs = [
      {
        symbol: 'AAA',
        name: 'A',
        market: 'US',
        date: '2024-01-01',
        action: 'buy',
        quantity: 10,
        price: 100,
        fee: 0,
      },
      {
        symbol: 'AAA',
        name: 'A',
        market: 'US',
        date: '2024-01-01',
        action: 'buy',
        quantity: 5,
        price: 200,
        fee: 0,
      },
    ];
    const stat = computeSymbolStats(txs).get('AAA');
    expect(stat.remainingQty).toBe(15);
    expect(stat.totalInvested).toBe(10 * 100 + 5 * 200);
  });

  it('sorts transactions into date order even when the input array is reverse-chronological', () => {
    const txs = [
      {
        symbol: 'AAA',
        name: 'A',
        market: 'US',
        date: '2024-03-01',
        action: 'buy',
        quantity: 5,
        price: 300,
        fee: 0,
      },
      {
        symbol: 'AAA',
        name: 'A',
        market: 'US',
        date: '2024-01-01',
        action: 'buy',
        quantity: 10,
        price: 100,
        fee: 0,
      },
    ];
    const stat = computeSymbolStats(txs).get('AAA');
    // If the rows were processed out of date order, the first buy would seed
    // avgCost from the 300 price instead of 100, giving a different blended cost.
    expect(stat.avgCost).toBe((10 * 100 + 5 * 300) / 15);
  });

  it('keeps avgCost at 0 when a zero-quantity buy leaves the running quantity at 0', () => {
    const txs = [
      {
        symbol: 'AAA',
        name: 'A',
        market: 'US',
        date: '2024-01-01',
        action: 'buy',
        quantity: 0,
        price: 100,
        fee: 0,
      },
    ];
    const stat = computeSymbolStats(txs).get('AAA');
    expect(stat.avgCost).toBe(0);
    expect(stat.remainingQty).toBe(0);
  });
});

describe('roi.computeSymbolStats with year filter (cross-year realized gain)', () => {
  const txs = [
    {
      symbol: 'AAA',
      name: 'A',
      market: 'US',
      date: '2022-03-01',
      action: 'buy',
      quantity: 1,
      price: 6,
      fee: 0,
    },
    {
      symbol: 'AAA',
      name: 'A',
      market: 'US',
      date: '2023-05-01',
      action: 'buy',
      quantity: 2,
      price: 8,
      fee: 0,
    },
    {
      symbol: 'AAA',
      name: 'A',
      market: 'US',
      date: '2024-07-01',
      action: 'sell',
      quantity: 1,
      price: 10,
      fee: 0,
    },
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
    expect(computeSymbolStats(txs, 'all').get('AAA').realizedGain).toBeCloseTo(
      (10 - 22 / 3) * 1,
      5,
    );
    expect(computeSymbolStats(txs).get('AAA').realizedGain).toBeCloseTo(
      (10 - 22 / 3) * 1,
      5,
    );
  });
});

describe('roi.resolveYearFilter', () => {
  it('passes "all" through unchanged', () => {
    expect(resolveYearFilter([], 'all')).toBe('all');
  });

  it('keeps a year that has at least one matching transaction', () => {
    const txs = [{ date: '2024-05-01' }];
    expect(resolveYearFilter(txs, '2024')).toBe('2024');
  });

  it('resets to "all" when no transaction matches the selected year (demo mode after import)', () => {
    // e.g. user imports real transactions dated 2026 and filters to that year,
    // then switches to demo mode, whose bundled dataset only spans 2023-2025.
    const demoTxs = [{ date: '2023-04-08' }, { date: '2024-07-17' }];
    expect(resolveYearFilter(demoTxs, '2026')).toBe('all');
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

describe('roi.filterTransactions', () => {
  const txs = [
    { symbol: 'AAA', market: 'TW', date: '2024-01-01' },
    { symbol: 'BBB', market: 'US', date: '2023-06-01' },
  ];

  it('returns everything when both filters are "all"', () => {
    expect(filterTransactions(txs, { year: 'all', market: 'all' })).toEqual(
      txs,
    );
  });

  it('filters by market', () => {
    expect(filterTransactions(txs, { year: 'all', market: 'TW' })).toEqual([
      txs[0],
    ]);
  });

  it('filters by year', () => {
    expect(filterTransactions(txs, { year: '2023', market: 'all' })).toEqual([
      txs[1],
    ]);
  });
});

describe('roi.computePortfolioSummary with a market filter', () => {
  it('restricts perSymbol and byMarket totals to the selected market only', () => {
    const txs = [
      {
        symbol: '2330',
        name: '台積電',
        market: 'TW',
        date: '2024-01-01',
        action: 'buy',
        quantity: 10,
        price: 100,
        fee: 0,
      },
      {
        symbol: 'AAPL',
        name: 'Apple',
        market: 'US',
        date: '2024-01-01',
        action: 'buy',
        quantity: 5,
        price: 200,
        fee: 0,
      },
    ];
    const summary = computePortfolioSummary(
      txs,
      { priceOverrides: {}, priceCache: {} },
      { year: 'all', market: 'TW' },
    );
    expect(summary.perSymbol).toHaveLength(1);
    expect(summary.perSymbol[0].symbol).toBe('2330');
    expect(summary.byMarket.US.totalInvested).toBe(0);
  });
});

describe('roi.convertAmount', () => {
  it('returns the amount unchanged when currencies already match', () => {
    expect(convertAmount(100, 'TWD', 'TWD', null)).toBe(100);
  });

  it('returns NaN when a conversion is needed but no fx rate is available', () => {
    expect(convertAmount(100, 'USD', 'TWD', null)).toBeNaN();
  });

  it('converts USD to TWD and back using the given rate', () => {
    expect(convertAmount(100, 'USD', 'TWD', 32)).toBe(3200);
    expect(convertAmount(3200, 'TWD', 'USD', 32)).toBe(100);
  });

  it('falls back to the raw amount for a currency pair it does not know how to convert', () => {
    expect(convertAmount(100, 'EUR', 'JPY', 32)).toBe(100);
  });
});

describe('roi.convertSummaryToDisplayCurrency', () => {
  it('sums TW (TWD) and US (USD) market summaries into a single display currency', () => {
    const byMarket = {
      TW: {
        totalInvested: 3200,
        costBasisHeld: 3200,
        realizedGain: 0,
        unrealizedGain: 0,
        currency: 'TWD',
      },
      US: {
        totalInvested: 100,
        costBasisHeld: 100,
        realizedGain: 0,
        unrealizedGain: 0,
        currency: 'USD',
      },
    };
    const result = convertSummaryToDisplayCurrency(byMarket, 'USD', 32);
    expect(result.totalInvested).toBeCloseTo(100 + 100);
    expect(result.currency).toBe('USD');
  });
});

describe('roi.generateMonthEndSnapshotDates', () => {
  it('generates a monthly span from the earliest transaction to today for "all"', () => {
    const dates = generateMonthEndSnapshotDates(
      '2024-01-15',
      'all',
      '2024-04-10',
    );
    expect(dates).toEqual([
      '2024-01-31',
      '2024-02-29',
      '2024-03-31',
      '2024-04-10',
    ]);
  });

  it('clips the window to Jan 1 - Dec 31 of a past selected year', () => {
    const dates = generateMonthEndSnapshotDates(
      '2022-01-01',
      '2023',
      '2024-06-01',
    );
    expect(dates).toHaveLength(12);
    expect(dates[0]).toBe('2023-01-31');
    expect(dates[dates.length - 1]).toBe('2023-12-31');
  });

  it('clips the window end to today when the selected year is the current year', () => {
    const dates = generateMonthEndSnapshotDates(
      '2024-01-01',
      '2024',
      '2024-03-01',
    );
    expect(dates).toEqual(['2024-01-31', '2024-02-29', '2024-03-01']);
  });

  it('returns an empty array when the selected year window precedes any transaction', () => {
    const dates = generateMonthEndSnapshotDates(
      '2024-06-01',
      '2023',
      '2024-06-01',
    );
    expect(dates).toEqual([]);
  });
});

describe('roi.computeRoiTrend', () => {
  it('returns [] when there are no transactions', () => {
    expect(
      computeRoiTrend([], {
        year: 'all',
        mode: 'cumulative',
        resolveHistoricalPrice: () => null,
        fxRate: null,
        displayCurrency: 'USD',
        today: '2024-01-01',
      }),
    ).toEqual([]);
  });

  it('cumulative mode keeps the full lifetime avg-cost baseline even when a later year is selected', () => {
    const txs = [
      {
        symbol: 'AAA',
        name: 'A',
        market: 'US',
        date: '2023-01-01',
        action: 'buy',
        quantity: 10,
        price: 100,
        fee: 0,
      },
      {
        symbol: 'AAA',
        name: 'A',
        market: 'US',
        date: '2024-01-01',
        action: 'buy',
        quantity: 10,
        price: 200,
        fee: 0,
      },
    ];
    const points = computeRoiTrend(txs, {
      year: '2024',
      mode: 'cumulative',
      resolveHistoricalPrice: () => 150,
      fxRate: null,
      displayCurrency: 'USD',
      today: '2024-03-01',
    });
    expect(points).toEqual([
      { date: '2024-01-31', roiPct: 0, totalAssets: 3000 },
      { date: '2024-02-29', roiPct: 0, totalAssets: 3000 },
      { date: '2024-03-01', roiPct: 0, totalAssets: 3000 },
    ]);
  });

  it("year-scoped mode restricts the avg-cost baseline to that year's own transactions", () => {
    const txs = [
      {
        symbol: 'AAA',
        name: 'A',
        market: 'US',
        date: '2023-01-01',
        action: 'buy',
        quantity: 10,
        price: 100,
        fee: 0,
      },
      {
        symbol: 'AAA',
        name: 'A',
        market: 'US',
        date: '2024-01-01',
        action: 'buy',
        quantity: 10,
        price: 200,
        fee: 0,
      },
    ];
    const points = computeRoiTrend(txs, {
      year: '2024',
      mode: 'year-scoped',
      resolveHistoricalPrice: () => 150,
      fxRate: null,
      displayCurrency: 'USD',
      today: '2024-03-01',
    });
    // Only the 2024 buy counts: avgCost=200, totalInvested=2000, qty=10.
    // unrealizedGain = (150 - 200) * 10 = -500 -> roiPct = -500/2000*100 = -25.
    expect(points).toEqual([
      { date: '2024-01-31', roiPct: -25, totalAssets: 1500 },
      { date: '2024-02-29', roiPct: -25, totalAssets: 1500 },
      { date: '2024-03-01', roiPct: -25, totalAssets: 1500 },
    ]);
  });

  it('year-scoped mode falls back to cumulative when "all" is selected', () => {
    const txs = [
      {
        symbol: 'AAA',
        name: 'A',
        market: 'US',
        date: '2023-01-01',
        action: 'buy',
        quantity: 10,
        price: 100,
        fee: 0,
      },
    ];
    const points = computeRoiTrend(txs, {
      year: 'all',
      mode: 'year-scoped',
      resolveHistoricalPrice: () => 100,
      fxRate: null,
      displayCurrency: 'USD',
      today: '2023-01-31',
    });
    expect(points).toEqual([
      { date: '2023-01-31', roiPct: 0, totalAssets: 1000 },
    ]);
  });

  it('falls back to avgCost as the estimate price when resolveHistoricalPrice returns a non-number', () => {
    const txs = [
      {
        symbol: 'AAA',
        name: 'A',
        market: 'US',
        date: '2024-01-01',
        action: 'buy',
        quantity: 10,
        price: 100,
        fee: 0,
      },
    ];
    const points = computeRoiTrend(txs, {
      year: 'all',
      mode: 'cumulative',
      resolveHistoricalPrice: () => null,
      fxRate: null,
      displayCurrency: 'USD',
      today: '2024-01-31',
    });
    // price falls back to avgCost (100), so unrealizedGain is 0 and roiPct is 0.
    expect(points).toEqual([
      { date: '2024-01-31', roiPct: 0, totalAssets: 1000 },
    ]);
  });

  it('converts totalInvested/realizedGain/unrealizedGain into the display currency via fxRate', () => {
    const txs = [
      {
        symbol: '2330',
        name: '台積電',
        market: 'TW',
        date: '2024-01-01',
        action: 'buy',
        quantity: 10,
        price: 3200,
        fee: 0,
      },
    ];
    const points = computeRoiTrend(txs, {
      year: 'all',
      mode: 'cumulative',
      resolveHistoricalPrice: () => 3200,
      fxRate: 32,
      displayCurrency: 'USD',
      today: '2024-01-31',
    });
    expect(points).toEqual([
      { date: '2024-01-31', roiPct: 0, totalAssets: 1000 },
    ]);
  });

  it('omits a snapshot date when the year-scoped transaction list is empty as of that date', () => {
    const txs = [
      {
        symbol: 'AAA',
        name: 'A',
        market: 'US',
        date: '2023-01-01',
        action: 'buy',
        quantity: 10,
        price: 100,
        fee: 0,
      },
      {
        symbol: 'BBB',
        name: 'B',
        market: 'US',
        date: '2024-03-01',
        action: 'buy',
        quantity: 5,
        price: 50,
        fee: 0,
      },
    ];
    const points = computeRoiTrend(txs, {
      year: '2024',
      mode: 'year-scoped',
      resolveHistoricalPrice: () => 50,
      fxRate: null,
      displayCurrency: 'USD',
      today: '2024-04-01',
    });
    // Jan/Feb 2024 have no 2024-dated transactions yet (AAA is from 2023), so
    // those snapshot dates are omitted; only Mar/Apr (after BBB's buy) appear.
    expect(points).toEqual([
      { date: '2024-03-31', roiPct: 0, totalAssets: 250 },
      { date: '2024-04-01', roiPct: 0, totalAssets: 250 },
    ]);
  });

  it('computes totalAssets as costBasisHeld + unrealizedGain, distinct from the totalInvested-based ROI denominator, after a partial sell', () => {
    const txs = [
      {
        symbol: 'AAA',
        name: 'A',
        market: 'US',
        date: '2024-01-01',
        action: 'buy',
        quantity: 10,
        price: 100,
        fee: 0,
      },
      {
        symbol: 'AAA',
        name: 'A',
        market: 'US',
        date: '2024-02-01',
        action: 'sell',
        quantity: 4,
        price: 150,
        fee: 0,
      },
    ];
    const points = computeRoiTrend(txs, {
      year: 'all',
      mode: 'cumulative',
      resolveHistoricalPrice: () => 120,
      fxRate: null,
      displayCurrency: 'USD',
      today: '2024-02-29',
    });
    // Before the sell: qty=10, costBasisHeld=1000, unrealizedGain=(120-100)*10=200 -> totalAssets=1200.
    // After the sell: qty=6, costBasisHeld=600, unrealizedGain=(120-100)*6=120 -> totalAssets=720,
    // even though totalInvested (1000) + realizedGain (200) + unrealizedGain (120) = 1320 -- the two
    // metrics diverge because totalInvested still counts the cost of shares no longer held.
    expect(points).toEqual([
      { date: '2024-01-31', roiPct: 20, totalAssets: 1200 },
      { date: '2024-02-29', roiPct: 32, totalAssets: 720 },
    ]);
  });
});

describe('annualizedRoiPct', () => {
  const { annualizedRoiPct } = window.PFD.roi;

  it('returns roughly the original ROI for a one-year holding period', () => {
    const result = annualizedRoiPct(10, '2023-01-01', '2024-01-01');
    expect(result).toBeGreaterThan(9.9);
    expect(result).toBeLessThan(10.2);
  });

  it('amplifies a six-month ROI when annualized', () => {
    const result = annualizedRoiPct(10, '2024-01-01', '2024-07-01');
    // (1.1)^(365.25/182) - 1 ≈ 21%
    expect(result).toBeGreaterThan(20);
    expect(result).toBeLessThan(23);
  });

  it('shrinks a multi-year ROI when annualized', () => {
    const result = annualizedRoiPct(100, '2020-01-01', '2024-01-01');
    // doubling over 4 years ≈ 18.9%/yr
    expect(result).toBeGreaterThan(18);
    expect(result).toBeLessThan(20);
  });

  it('returns null for holding periods shorter than 30 days (extrapolation nonsense)', () => {
    expect(annualizedRoiPct(5, '2024-01-01', '2024-01-20')).toBeNull();
    expect(annualizedRoiPct(5, '2024-01-01', '2024-01-01')).toBeNull();
  });

  it('returns null for a null/undefined/non-finite ROI', () => {
    expect(annualizedRoiPct(null, '2023-01-01', '2024-01-01')).toBeNull();
    expect(annualizedRoiPct(undefined, '2023-01-01', '2024-01-01')).toBeNull();
    expect(annualizedRoiPct(NaN, '2023-01-01', '2024-01-01')).toBeNull();
  });

  it('returns null for invalid dates', () => {
    expect(annualizedRoiPct(10, 'not-a-date', '2024-01-01')).toBeNull();
    expect(annualizedRoiPct(10, '2023-01-01', 'not-a-date')).toBeNull();
  });

  it('clamps a total-loss ROI at -100 instead of producing NaN', () => {
    expect(annualizedRoiPct(-100, '2023-01-01', '2024-01-01')).toBe(-100);
    expect(annualizedRoiPct(-150, '2023-01-01', '2024-01-01')).toBe(-100);
  });
});
