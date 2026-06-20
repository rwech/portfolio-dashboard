(function () {
  Chart.defaults.color = '#e6f1ff';
  Chart.defaults.borderColor = 'rgba(0, 229, 255, 0.15)';

  const SEGMENT_PALETTE = [
    '#00e5ff',
    '#b14aff',
    '#ffd166',
    '#39ff8f',
    '#ff4d6d',
    '#5cf2ff',
    '#ffa94d',
    '#74c0fc',
  ];

  let allocationChart = null;
  let symbolAllocationChart = null;

  function resizeCharts() {
    if (allocationChart) allocationChart.resize();
    if (symbolAllocationChart) symbolAllocationChart.resize();
  }

  function renderAllocationChart(canvasEl, byMarketTotals, displayCurrency) {
    if (allocationChart) {
      allocationChart.destroy();
      allocationChart = null;
    }
    const amounts = [byMarketTotals.TW, byMarketTotals.US];
    if (amounts.some((v) => !Number.isFinite(v))) return;
    const total = amounts[0] + amounts[1];
    if (total <= 0) return;

    const labels = ['台股', '美股'];
    const colors = ['#ffd166', '#b14aff'];

    allocationChart = new Chart(canvasEl, {
      type: 'bar',
      data: {
        labels: ['持股成本配置'],
        datasets: labels.map((label, i) => ({
          label,
          data: [(amounts[i] / total) * 100],
          backgroundColor: colors[i],
        })),
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            stacked: true,
            min: 0,
            max: 100,
            ticks: { callback: (v) => `${v}%` },
          },
          y: { stacked: true },
        },
        plugins: {
          title: { display: true, text: '持股成本配置' },
          tooltip: {
            callbacks: {
              label: (ctx) =>
                `${ctx.dataset.label}: ${ctx.parsed.x.toFixed(1)}% (${amounts[ctx.datasetIndex].toLocaleString(undefined, { maximumFractionDigits: 2 })} ${displayCurrency})`,
            },
          },
        },
      },
    });
  }

  function renderSymbolAllocationChart(
    canvasEl,
    perSymbolAmounts,
    displayCurrency,
  ) {
    if (symbolAllocationChart) {
      symbolAllocationChart.destroy();
      symbolAllocationChart = null;
    }
    if (perSymbolAmounts.some((s) => !Number.isFinite(s.value))) return;
    const total = perSymbolAmounts.reduce((sum, s) => sum + s.value, 0);
    if (total <= 0) return;

    const sorted = [...perSymbolAmounts].sort((a, b) => b.value - a.value);

    symbolAllocationChart = new Chart(canvasEl, {
      type: 'pie',
      data: {
        labels: sorted.map((s) => s.symbol),
        datasets: [
          {
            data: sorted.map((s) => s.value),
            backgroundColor: sorted.map(
              (_, i) => SEGMENT_PALETTE[i % SEGMENT_PALETTE.length],
            ),
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          animateRotate: true,
          animateScale: true,
          duration: 800,
          easing: 'easeOutQuart',
        },
        plugins: {
          title: { display: true, text: '個股持股市值占比' },
          legend: { position: 'bottom' },
          tooltip: {
            callbacks: {
              label: (ctx) =>
                `${ctx.label}: ${((ctx.parsed / total) * 100).toFixed(1)}% (${ctx.parsed.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${displayCurrency})`,
            },
          },
        },
      },
    });
  }

  window.PFD = window.PFD || {};
  window.PFD.charts = {
    renderAllocationChart,
    renderSymbolAllocationChart,
    resizeCharts,
  };
})();
