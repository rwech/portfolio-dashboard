(function () {
  Chart.defaults.color = '#e8eaed';
  Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.12)';

  let roiChart = null;
  let allocationChart = null;

  function resizeCharts() {
    if (roiChart) roiChart.resize();
    if (allocationChart) allocationChart.resize();
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
            backgroundColor: '#4c8bf5',
          },
          {
            label: `未實現損益 (${displayCurrency})`,
            data: perSymbolStats.map((s) => s.unrealizedGain),
            backgroundColor: '#34a853',
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
    const data = [byMarketTotals.TW, byMarketTotals.US];
    if (data.every((v) => !v)) return;

    allocationChart = new Chart(canvasEl, {
      type: 'doughnut',
      data: {
        labels: [`台股 (${displayCurrency})`, `美股 (${displayCurrency})`],
        datasets: [{ data, backgroundColor: ['#fbbc04', '#ea4335'] }],
      },
      options: {
        responsive: true,
        plugins: { title: { display: true, text: '持股成本配置' } },
      },
    });
  }

  window.PFD = window.PFD || {};
  window.PFD.charts = {
    renderRoiBarChart,
    renderAllocationChart,
    resizeCharts,
  };
})();
