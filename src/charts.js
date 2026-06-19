(function () {
  Chart.defaults.color = '#e6f1ff';
  Chart.defaults.borderColor = 'rgba(0, 229, 255, 0.15)';

  let roiChart = null;
  let allocationChart = null;
  let symbolAllocationChart = null;

  function resizeCharts() {
    if (roiChart) roiChart.resize();
    if (allocationChart) allocationChart.resize();
    if (symbolAllocationChart) symbolAllocationChart.resize();
  }

  function renderRoiBarChart(canvasEl, perSymbolStats, displayCurrency) {
    if (roiChart) {
      roiChart.destroy();
      roiChart = null;
    }
    if (!perSymbolStats.length) return;

    roiChart = new Chart(canvasEl, {
      type: 'bar',
      data: {
        labels: perSymbolStats.map((s) => s.symbol),
        datasets: [
          {
            label: `已實現損益 (${displayCurrency})`,
            data: perSymbolStats.map((s) => s.realizedGain),
            backgroundColor: '#00e5ff',
          },
          {
            label: `未實現損益 (${displayCurrency})`,
            data: perSymbolStats.map((s) => s.unrealizedGain),
            backgroundColor: '#b14aff',
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { title: { display: true, text: '各標的損益' } },
        scales: { x: { stacked: false } },
      },
    });
  }

  function renderAllocationChart(canvasEl, byMarketTotals, displayCurrency) {
    if (allocationChart) {
      allocationChart.destroy();
      allocationChart = null;
    }
    const amounts = [byMarketTotals.TW || 0, byMarketTotals.US || 0];
    const total = amounts[0] + amounts[1];
    if (!total) return;

    const percentages = amounts.map((v) => (v / total) * 100);

    allocationChart = new Chart(canvasEl, {
      type: 'bar',
      data: {
        labels: ['台股', '美股'],
        datasets: [{ data: percentages, backgroundColor: ['#ffd166', '#b14aff'] }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        scales: { x: { min: 0, max: 100, ticks: { callback: (v) => `${v}%` } } },
        plugins: {
          title: { display: true, text: '持股成本配置' },
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.parsed.x.toFixed(1)}% (${amounts[ctx.dataIndex].toLocaleString(undefined, { maximumFractionDigits: 2 })} ${displayCurrency})`,
            },
          },
        },
      },
    });
  }

  function renderSymbolAllocationChart(canvasEl, perSymbolAmounts, displayCurrency) {
    if (symbolAllocationChart) {
      symbolAllocationChart.destroy();
      symbolAllocationChart = null;
    }
    const held = perSymbolAmounts.filter((s) => s.value > 0);
    const total = held.reduce((sum, s) => sum + s.value, 0);
    if (!total) return;

    const sorted = [...held].sort((a, b) => b.value - a.value);
    const percentages = sorted.map((s) => (s.value / total) * 100);

    symbolAllocationChart = new Chart(canvasEl, {
      type: 'bar',
      data: {
        labels: sorted.map((s) => s.symbol),
        datasets: [{ data: percentages, backgroundColor: '#00e5ff' }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        scales: { x: { min: 0, max: 100, ticks: { callback: (v) => `${v}%` } } },
        plugins: {
          title: { display: true, text: '個股持股成本占比' },
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.parsed.x.toFixed(1)}% (${sorted[ctx.dataIndex].value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${displayCurrency})`,
            },
          },
        },
      },
    });
  }

  window.PFD = window.PFD || {};
  window.PFD.charts = {
    renderRoiBarChart,
    renderAllocationChart,
    renderSymbolAllocationChart,
    resizeCharts,
  };
})();
