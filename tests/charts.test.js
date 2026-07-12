import { describe, it, expect, vi, beforeEach } from 'vitest';

class FakeChart {
  constructor(canvasEl, config) {
    this.canvasEl = canvasEl;
    this.config = config;
    this.resize = vi.fn();
    this.destroy = vi.fn();
    FakeChart.instances.push(this);
  }
}
FakeChart.defaults = {};
FakeChart.instances = [];

global.Chart = FakeChart;
await import('../src/charts.js');

const {
  renderAllocationChart,
  renderSymbolAllocationChart,
  renderRoiTrendChart,
  resizeCharts,
  groupTopN,
} = window.PFD.charts;

describe('charts.renderAllocationChart', () => {
  beforeEach(() => {
    FakeChart.instances = [];
  });

  it('creates a bar chart with the per-market percentage split', () => {
    const canvas = document.createElement('canvas');
    renderAllocationChart(canvas, { TW: 300, US: 100 }, 'TWD');
    expect(FakeChart.instances).toHaveLength(1);
    const config = FakeChart.instances[0].config;
    expect(config.type).toBe('bar');
    expect(config.data.datasets[0].data[0]).toBeCloseTo(75); // TW = 300/400
    expect(config.data.datasets[1].data[0]).toBeCloseTo(25); // US = 100/400
  });

  it('destroys the previous chart instance before creating a new one', () => {
    const canvas = document.createElement('canvas');
    renderAllocationChart(canvas, { TW: 300, US: 100 }, 'TWD');
    const firstInstance = FakeChart.instances[0];
    renderAllocationChart(canvas, { TW: 200, US: 200 }, 'TWD');
    expect(firstInstance.destroy).toHaveBeenCalled();
    expect(FakeChart.instances).toHaveLength(2);
  });

  it('does not create a chart when both amounts are zero', () => {
    const canvas = document.createElement('canvas');
    renderAllocationChart(canvas, { TW: 0, US: 0 }, 'TWD');
    expect(FakeChart.instances).toHaveLength(0);
  });

  it('formats the x-axis tick label as a percentage', () => {
    const canvas = document.createElement('canvas');
    renderAllocationChart(canvas, { TW: 300, US: 100 }, 'TWD');
    const config = FakeChart.instances[0].config;
    expect(config.options.scales.x.ticks.callback(25)).toBe('25%');
  });

  it('does not create a chart when an amount is not finite (e.g. missing fx rate -> NaN)', () => {
    const canvas = document.createElement('canvas');
    renderAllocationChart(canvas, { TW: NaN, US: 100 }, 'TWD');
    expect(FakeChart.instances).toHaveLength(0);
  });

  it('removes the existing chart (without leaving a stale reference) when the new totals are empty', () => {
    const canvas = document.createElement('canvas');
    renderAllocationChart(canvas, { TW: 300, US: 100 }, 'TWD');
    const firstInstance = FakeChart.instances[0];
    renderAllocationChart(canvas, { TW: 0, US: 0 }, 'TWD');
    expect(firstInstance.destroy).toHaveBeenCalled();
    // resizeCharts should now be a no-op for the allocation chart since it was cleared
    expect(() => resizeCharts()).not.toThrow();
  });

  it('formats the tooltip label with the percentage and converted amount', () => {
    const canvas = document.createElement('canvas');
    renderAllocationChart(canvas, { TW: 300, US: 100 }, 'TWD');
    const labelFn =
      FakeChart.instances[0].config.options.plugins.tooltip.callbacks.label;
    const text = labelFn({
      dataset: { label: '台股' },
      parsed: { x: 75 },
      datasetIndex: 0,
    });
    expect(text).toBe('台股: 75.0% (300 TWD)');
  });
});

describe('charts.renderSymbolAllocationChart', () => {
  beforeEach(() => {
    FakeChart.instances = [];
  });

  it('creates a doughnut chart sorted by descending value', () => {
    const canvas = document.createElement('canvas');
    renderSymbolAllocationChart(
      canvas,
      [
        { symbol: 'A', value: 50 },
        { symbol: 'B', value: 150 },
      ],
      'USD',
    );
    const config = FakeChart.instances[0].config;
    expect(config.type).toBe('doughnut');
    expect(config.options.plugins.title.display).toBe(false);
    expect(config.options.plugins.legend.display).toBe(false);
    expect(config.options.cutout).toBe('70%');
    expect(config.data.labels).toEqual(['B', 'A']);
    expect(config.data.datasets[0].data).toEqual([150, 50]);
  });

  it('renders a custom legend list into the given legend element', () => {
    const canvas = document.createElement('canvas');
    const legendEl = document.createElement('ul');
    renderSymbolAllocationChart(
      canvas,
      [
        { symbol: 'A', value: 50 },
        { symbol: 'B', value: 150 },
      ],
      'USD',
      legendEl,
    );
    const items = legendEl.querySelectorAll('.symbol-allocation-legend-item');
    expect(items).toHaveLength(2);
    expect(items[0].querySelector('.legend-symbol').textContent).toBe('B');
    expect(items[0].querySelector('.legend-pct').textContent).toBe('75%');
    expect(items[1].querySelector('.legend-symbol').textContent).toBe('A');
    expect(items[1].querySelector('.legend-pct').textContent).toBe('25%');
  });

  it('destroys the previous symbol allocation chart before creating a new one', () => {
    const canvas = document.createElement('canvas');
    renderSymbolAllocationChart(canvas, [{ symbol: 'A', value: 50 }], 'USD');
    const firstInstance = FakeChart.instances[0];
    renderSymbolAllocationChart(canvas, [{ symbol: 'B', value: 80 }], 'USD');
    expect(firstInstance.destroy).toHaveBeenCalled();
  });

  it('does not create a chart when there is nothing held (empty list)', () => {
    const canvas = document.createElement('canvas');
    renderSymbolAllocationChart(canvas, [], 'USD');
    expect(FakeChart.instances).toHaveLength(0);
  });

  it('does not create a chart when a value is not finite', () => {
    const canvas = document.createElement('canvas');
    renderSymbolAllocationChart(canvas, [{ symbol: 'A', value: NaN }], 'USD');
    expect(FakeChart.instances).toHaveLength(0);
  });

  it('formats the tooltip label with the percentage share of the total', () => {
    const canvas = document.createElement('canvas');
    renderSymbolAllocationChart(
      canvas,
      [
        { symbol: 'A', value: 50 },
        { symbol: 'B', value: 150 },
      ],
      'USD',
    );
    const labelFn =
      FakeChart.instances[0].config.options.plugins.tooltip.callbacks.label;
    const text = labelFn({ label: 'B', parsed: 150 });
    expect(text).toBe('B: 75.0% (150 USD)');
  });
});

describe('charts.groupTopN', () => {
  it('returns the entries sorted by descending value when there are fewer than n', () => {
    const grouped = groupTopN(
      [
        { symbol: 'A', value: 10 },
        { symbol: 'B', value: 30 },
        { symbol: 'C', value: 20 },
      ],
      8,
    );
    expect(grouped).toEqual([
      { symbol: 'B', value: 30 },
      { symbol: 'C', value: 20 },
      { symbol: 'A', value: 10 },
    ]);
  });

  it('returns the entries unchanged in count when there are exactly n', () => {
    const data = [
      { symbol: 'A', value: 2 },
      { symbol: 'B', value: 1 },
    ];
    const grouped = groupTopN(data, 2);
    expect(grouped).toHaveLength(2);
    expect(grouped.map((s) => s.symbol)).toEqual(['A', 'B']);
  });

  it('keeps the top n and aggregates the remainder into a trailing 其他 slice', () => {
    const data = [
      { symbol: 'S1', value: 100 },
      { symbol: 'S2', value: 90 },
      { symbol: 'S3', value: 80 },
      { symbol: 'S4', value: 5 },
      { symbol: 'S5', value: 3 },
    ];
    const grouped = groupTopN(data, 3);
    expect(grouped).toHaveLength(4);
    expect(grouped.map((s) => s.symbol)).toEqual(['S1', 'S2', 'S3', '其他']);
    expect(grouped[3].value).toBe(8); // 5 + 3
  });

  it('sorts before grouping so a small early entry falls into 其他', () => {
    const data = [
      { symbol: 'TINY', value: 1 },
      { symbol: 'BIG', value: 100 },
      { symbol: 'MID', value: 50 },
    ];
    const grouped = groupTopN(data, 2);
    expect(grouped.map((s) => s.symbol)).toEqual(['BIG', 'MID', '其他']);
    expect(grouped[2].value).toBe(1);
  });

  it('does not mutate the input array', () => {
    const data = [
      { symbol: 'A', value: 1 },
      { symbol: 'B', value: 2 },
    ];
    groupTopN(data, 1);
    expect(data.map((s) => s.symbol)).toEqual(['A', 'B']);
  });
});

describe('charts.renderSymbolAllocationChart top-8 grouping', () => {
  beforeEach(() => {
    FakeChart.instances = [];
  });

  it('renders at most 8 named slices plus a 其他 slice when holdings exceed 8', () => {
    const canvas = document.createElement('canvas');
    const holdings = Array.from({ length: 12 }, (_, i) => ({
      symbol: `S${i + 1}`,
      value: 120 - i * 10, // S1 largest ... S12 smallest
    }));
    renderSymbolAllocationChart(canvas, holdings, 'TWD');
    const config = FakeChart.instances[0].config;
    expect(config.data.labels).toHaveLength(9);
    expect(config.data.labels.slice(0, 8)).toEqual([
      'S1',
      'S2',
      'S3',
      'S4',
      'S5',
      'S6',
      'S7',
      'S8',
    ]);
    expect(config.data.labels[8]).toBe('其他');
    // 其他 = S9..S12 values: 40 + 30 + 20 + 10
    expect(config.data.datasets[0].data[8]).toBe(100);
  });

  it('keeps all slices when there are 8 or fewer holdings', () => {
    const canvas = document.createElement('canvas');
    const holdings = Array.from({ length: 8 }, (_, i) => ({
      symbol: `S${i + 1}`,
      value: 80 - i * 10,
    }));
    renderSymbolAllocationChart(canvas, holdings, 'TWD');
    const config = FakeChart.instances[0].config;
    expect(config.data.labels).toHaveLength(8);
    expect(config.data.labels).not.toContain('其他');
  });

  it('gives 其他 a dedicated color instead of reusing the first symbol color', () => {
    const canvas = document.createElement('canvas');
    const holdings = Array.from({ length: 9 }, (_, i) => ({
      symbol: `S${i + 1}`,
      value: 90 - i * 10,
    }));
    renderSymbolAllocationChart(canvas, holdings, 'TWD');
    const colors =
      FakeChart.instances[0].config.data.datasets[0].backgroundColor;
    expect(colors).toHaveLength(9);
    expect(colors[8]).not.toBe(colors[0]);
  });
});

describe('charts.renderRoiTrendChart', () => {
  beforeEach(() => {
    FakeChart.instances = [];
  });

  it('creates a line chart with YYYY-MM labels and the ROI%/total-assets data series', () => {
    const canvas = document.createElement('canvas');
    renderRoiTrendChart(
      canvas,
      [
        { date: '2024-01-31', roiPct: 5, totalAssets: 1000 },
        { date: '2024-02-29', roiPct: 7.5, totalAssets: 1100 },
      ],
      'cumulative',
      'TWD',
    );
    const config = FakeChart.instances[0].config;
    expect(config.type).toBe('line');
    expect(config.data.labels).toEqual(['2024-01', '2024-02']);
    expect(config.data.datasets[0].data).toEqual([5, 7.5]);
    expect(config.data.datasets[1].label).toBe('總資產');
    expect(config.data.datasets[1].data).toEqual([1000, 1100]);
    expect(config.data.datasets[0].yAxisID).toBe('y');
    expect(config.data.datasets[1].yAxisID).toBe('y1');
  });

  it('destroys the previous trend chart instance before creating a new one', () => {
    const canvas = document.createElement('canvas');
    renderRoiTrendChart(
      canvas,
      [{ date: '2024-01-31', roiPct: 5, totalAssets: 1000 }],
      'cumulative',
      'TWD',
    );
    const firstInstance = FakeChart.instances[0];
    renderRoiTrendChart(
      canvas,
      [{ date: '2024-02-29', roiPct: 1, totalAssets: 900 }],
      'cumulative',
      'TWD',
    );
    expect(firstInstance.destroy).toHaveBeenCalled();
    expect(FakeChart.instances).toHaveLength(2);
  });

  it('does not create a chart when snapshots is empty', () => {
    const canvas = document.createElement('canvas');
    renderRoiTrendChart(canvas, [], 'cumulative', 'TWD');
    expect(FakeChart.instances).toHaveLength(0);
  });

  it('does not create a chart when snapshots is not an array', () => {
    const canvas = document.createElement('canvas');
    renderRoiTrendChart(canvas, null, 'cumulative', 'TWD');
    expect(FakeChart.instances).toHaveLength(0);
  });

  it('does not create a chart when a roiPct value is not finite', () => {
    const canvas = document.createElement('canvas');
    renderRoiTrendChart(
      canvas,
      [{ date: '2024-01-31', roiPct: NaN, totalAssets: 1000 }],
      'cumulative',
      'TWD',
    );
    expect(FakeChart.instances).toHaveLength(0);
  });

  it('does not create a chart when a totalAssets value is not finite', () => {
    const canvas = document.createElement('canvas');
    renderRoiTrendChart(
      canvas,
      [{ date: '2024-01-31', roiPct: 5, totalAssets: NaN }],
      'cumulative',
      'TWD',
    );
    expect(FakeChart.instances).toHaveLength(0);
  });

  it('keeps x-axis labels horizontal and auto-skips them with a max of ~12 ticks', () => {
    const canvas = document.createElement('canvas');
    renderRoiTrendChart(
      canvas,
      [{ date: '2024-01-31', roiPct: 5, totalAssets: 1000 }],
      'cumulative',
      'TWD',
    );
    const ticks = FakeChart.instances[0].config.options.scales.x.ticks;
    expect(ticks.autoSkip).toBe(true);
    expect(ticks.maxTicksLimit).toBe(12);
    expect(ticks.maxRotation).toBe(0);
  });

  it('formats the y-axis tick label as a percentage', () => {
    const canvas = document.createElement('canvas');
    renderRoiTrendChart(
      canvas,
      [{ date: '2024-01-31', roiPct: 5, totalAssets: 1000 }],
      'cumulative',
      'TWD',
    );
    const config = FakeChart.instances[0].config;
    expect(config.options.scales.y.ticks.callback(12.34)).toBe('12.34%');
  });

  it('positions the total-assets axis on the right with no chart-area gridlines', () => {
    const canvas = document.createElement('canvas');
    renderRoiTrendChart(
      canvas,
      [{ date: '2024-01-31', roiPct: 5, totalAssets: 1000 }],
      'cumulative',
      'TWD',
    );
    const config = FakeChart.instances[0].config;
    expect(config.options.scales.y1.position).toBe('right');
    expect(config.options.scales.y1.grid.drawOnChartArea).toBe(false);
  });

  it('shows a combined tooltip across both series when hovering anywhere along the x-axis', () => {
    const canvas = document.createElement('canvas');
    renderRoiTrendChart(
      canvas,
      [{ date: '2024-01-31', roiPct: 5, totalAssets: 1000 }],
      'cumulative',
      'TWD',
    );
    const config = FakeChart.instances[0].config;
    expect(config.options.interaction).toEqual({
      mode: 'index',
      intersect: false,
    });
  });

  it('displays the legend now that there are two series to distinguish', () => {
    const canvas = document.createElement('canvas');
    renderRoiTrendChart(
      canvas,
      [{ date: '2024-01-31', roiPct: 5, totalAssets: 1000 }],
      'cumulative',
      'TWD',
    );
    expect(FakeChart.instances[0].config.options.plugins.legend.display).toBe(
      true,
    );
  });

  it('formats the ROI tooltip label as ROI: X.XX%', () => {
    const canvas = document.createElement('canvas');
    renderRoiTrendChart(
      canvas,
      [{ date: '2024-01-31', roiPct: 5.678, totalAssets: 1000 }],
      'cumulative',
      'TWD',
    );
    const labelFn =
      FakeChart.instances[0].config.options.plugins.tooltip.callbacks.label;
    expect(labelFn({ datasetIndex: 0, parsed: { y: 5.678 } })).toBe(
      'ROI: 5.68%',
    );
  });

  it('formats the total-assets tooltip label with the amount and display currency', () => {
    const canvas = document.createElement('canvas');
    renderRoiTrendChart(
      canvas,
      [{ date: '2024-01-31', roiPct: 5, totalAssets: 1234.5 }],
      'cumulative',
      'TWD',
    );
    const labelFn =
      FakeChart.instances[0].config.options.plugins.tooltip.callbacks.label;
    expect(labelFn({ datasetIndex: 1, parsed: { y: 1234.5 } })).toBe(
      '總資產: 1,234.5 TWD',
    );
  });

  it('uses the cumulative title when modeLabel is "cumulative"', () => {
    const canvas = document.createElement('canvas');
    renderRoiTrendChart(
      canvas,
      [{ date: '2024-01-31', roiPct: 5, totalAssets: 1000 }],
      'cumulative',
      'TWD',
    );
    expect(FakeChart.instances[0].config.options.plugins.title.text).toBe(
      'ROI 趨勢（累積）',
    );
  });

  it('uses the year-scoped title when modeLabel is "year-scoped"', () => {
    const canvas = document.createElement('canvas');
    renderRoiTrendChart(
      canvas,
      [{ date: '2024-01-31', roiPct: 5, totalAssets: 1000 }],
      'year-scoped',
      'TWD',
    );
    expect(FakeChart.instances[0].config.options.plugins.title.text).toBe(
      'ROI 趨勢（年度重置）',
    );
  });

  it('falls back to the cumulative title for an unrecognized modeLabel', () => {
    const canvas = document.createElement('canvas');
    renderRoiTrendChart(
      canvas,
      [{ date: '2024-01-31', roiPct: 5, totalAssets: 1000 }],
      'bogus',
      'TWD',
    );
    expect(FakeChart.instances[0].config.options.plugins.title.text).toBe(
      'ROI 趨勢（累積）',
    );
  });
});

describe('charts.resizeCharts', () => {
  beforeEach(() => {
    FakeChart.instances = [];
  });

  it('resizes all three chart instances when they exist', () => {
    const canvas1 = document.createElement('canvas');
    const canvas2 = document.createElement('canvas');
    const canvas3 = document.createElement('canvas');
    renderAllocationChart(canvas1, { TW: 100, US: 100 }, 'TWD');
    renderSymbolAllocationChart(canvas2, [{ symbol: 'A', value: 10 }], 'TWD');
    renderRoiTrendChart(
      canvas3,
      [{ date: '2024-01-31', roiPct: 5, totalAssets: 1000 }],
      'cumulative',
      'TWD',
    );
    const [allocation, symbolAllocation, roiTrend] = FakeChart.instances;
    resizeCharts();
    expect(allocation.resize).toHaveBeenCalled();
    expect(symbolAllocation.resize).toHaveBeenCalled();
    expect(roiTrend.resize).toHaveBeenCalled();
  });

  it('is a no-op when none of the charts have been created yet', () => {
    expect(() => resizeCharts()).not.toThrow();
  });
});
