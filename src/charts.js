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
  let roiTrendChart = null;

  const TOP_SYMBOL_SLICES = 8;
  const OTHERS_LABEL = '其他';

  // 依 value 由大到小排序，保留前 n 名，其餘合併為一筆「其他」。
  // 純函式（不碰 DOM / Chart.js），方便單元測試。
  function groupTopN(perSymbolAmounts, n) {
    const sorted = [...perSymbolAmounts].sort((a, b) => b.value - a.value);
    if (sorted.length <= n) return sorted;
    const rest = sorted.slice(n);
    return [
      ...sorted.slice(0, n),
      {
        symbol: OTHERS_LABEL,
        value: rest.reduce((sum, s) => sum + s.value, 0),
      },
    ];
  }

  const ROI_TREND_MODE_LABELS = {
    cumulative: 'ROI 趨勢（累積）',
    'year-scoped': 'ROI 趨勢（年度重置）',
  };

  function resizeCharts() {
    if (allocationChart) allocationChart.resize();
    if (symbolAllocationChart) symbolAllocationChart.resize();
    if (roiTrendChart) roiTrendChart.resize();
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
    legendEl,
  ) {
    if (symbolAllocationChart) {
      symbolAllocationChart.destroy();
      symbolAllocationChart = null;
    }
    if (legendEl) legendEl.innerHTML = '';
    if (perSymbolAmounts.some((s) => !Number.isFinite(s.value))) return;
    const total = perSymbolAmounts.reduce((sum, s) => sum + s.value, 0);
    if (total <= 0) return;

    const sorted = groupTopN(perSymbolAmounts, TOP_SYMBOL_SLICES);
    const colors = sorted.map(
      (_, i) => SEGMENT_PALETTE[i % SEGMENT_PALETTE.length],
    );

    symbolAllocationChart = new Chart(canvasEl, {
      type: 'doughnut',
      data: {
        labels: sorted.map((s) => s.symbol),
        datasets: [{ data: sorted.map((s) => s.value), backgroundColor: colors }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        animation: {
          animateRotate: true,
          animateScale: true,
          duration: 800,
          easing: 'easeOutQuart',
        },
        plugins: {
          title: { display: false },
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) =>
                `${ctx.label}: ${((ctx.parsed / total) * 100).toFixed(1)}% (${ctx.parsed.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${displayCurrency})`,
            },
          },
        },
      },
    });

    if (legendEl) renderSymbolAllocationLegend(legendEl, sorted, colors, total);
  }

  function renderSymbolAllocationLegend(legendEl, sorted, colors, total) {
    legendEl.innerHTML = sorted
      .map(
        (s, i) =>
          `<li class="symbol-allocation-legend-item"><span class="legend-dot" style="background-color:${colors[i]}"></span><span class="legend-symbol">${s.symbol}</span><span class="legend-pct">${((s.value / total) * 100).toFixed(0)}%</span></li>`,
      )
      .join('');
  }

  function renderRoiTrendChart(
    canvasEl,
    snapshots,
    modeLabel,
    displayCurrency,
  ) {
    if (roiTrendChart) {
      roiTrendChart.destroy();
      roiTrendChart = null;
    }
    if (!Array.isArray(snapshots) || snapshots.length === 0) return;
    if (
      snapshots.some(
        (s) => !Number.isFinite(s.roiPct) || !Number.isFinite(s.totalAssets),
      )
    )
      return;

    const titleText =
      ROI_TREND_MODE_LABELS[modeLabel] || ROI_TREND_MODE_LABELS.cumulative;

    roiTrendChart = new Chart(canvasEl, {
      type: 'line',
      data: {
        labels: snapshots.map((s) => s.date.slice(0, 7)),
        datasets: [
          {
            label: 'ROI %',
            data: snapshots.map((s) => s.roiPct),
            borderColor: '#00e5ff',
            backgroundColor: 'rgba(0, 229, 255, 0.15)',
            fill: true,
            tension: 0.25,
            pointRadius: 2,
            yAxisID: 'y',
          },
          {
            label: '總資產',
            data: snapshots.map((s) => s.totalAssets),
            borderColor: '#39ff8f',
            backgroundColor: 'rgba(57, 255, 143, 0.15)',
            fill: false,
            tension: 0.25,
            pointRadius: 2,
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            ticks: { autoSkip: true, maxTicksLimit: 12, maxRotation: 0 },
          },
          y: { ticks: { callback: (v) => `${v}%` } },
          y1: {
            position: 'right',
            ticks: { callback: (v) => v.toLocaleString() },
            grid: { drawOnChartArea: false },
          },
        },
        plugins: {
          title: { display: true, text: titleText },
          legend: { display: true, position: 'bottom' },
          tooltip: {
            callbacks: {
              label: (ctx) =>
                ctx.datasetIndex === 0
                  ? `ROI: ${ctx.parsed.y.toFixed(2)}%`
                  : `總資產: ${ctx.parsed.y.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${displayCurrency}`,
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
    renderRoiTrendChart,
    resizeCharts,
    groupTopN,
  };
})();
