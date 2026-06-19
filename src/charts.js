(function () {
  Chart.defaults.color = '#e6f1ff';
  Chart.defaults.borderColor = 'rgba(0, 229, 255, 0.15)';

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
    const data = [byMarketTotals.TW, byMarketTotals.US];
    if (data.every((v) => !v)) return;

    allocationChart = new Chart(canvasEl, {
      type: 'doughnut',
      data: {
        labels: [`台股 (${displayCurrency})`, `美股 (${displayCurrency})`],
        datasets: [{ data, backgroundColor: ['#ffd166', '#b14aff'] }],
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
