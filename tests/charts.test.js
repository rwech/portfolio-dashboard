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

const { renderAllocationChart, renderSymbolAllocationChart, resizeCharts } =
  window.PFD.charts;

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

  it('creates a pie chart sorted by descending value', () => {
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
    expect(config.type).toBe('pie');
    expect(config.data.labels).toEqual(['B', 'A']);
    expect(config.data.datasets[0].data).toEqual([150, 50]);
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

describe('charts.resizeCharts', () => {
  beforeEach(() => {
    FakeChart.instances = [];
  });

  it('resizes both chart instances when they exist', () => {
    const canvas1 = document.createElement('canvas');
    const canvas2 = document.createElement('canvas');
    renderAllocationChart(canvas1, { TW: 100, US: 100 }, 'TWD');
    renderSymbolAllocationChart(canvas2, [{ symbol: 'A', value: 10 }], 'TWD');
    const [allocation, symbolAllocation] = FakeChart.instances;
    resizeCharts();
    expect(allocation.resize).toHaveBeenCalled();
    expect(symbolAllocation.resize).toHaveBeenCalled();
  });

  it('is a no-op when neither chart has been created yet', () => {
    expect(() => resizeCharts()).not.toThrow();
  });
});
