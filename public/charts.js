// Chart management
const chartInstances = {};

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: true,
  aspectRatio: 2.5,
  plugins: {
    legend: {
      position: 'top',
      labels: {
        usePointStyle: true,
        pointStyle: 'circle',
        padding: 20,
        font: { size: 12, family: '-apple-system, BlinkMacSystemFont, sans-serif' },
        color: '#666',
      },
    },
    tooltip: {
      backgroundColor: '#fff',
      titleColor: '#1a1a1a',
      bodyColor: '#666',
      borderColor: '#e0e0e0',
      borderWidth: 1,
      padding: 12,
      displayColors: true,
      titleFont: { size: 12 },
      bodyFont: { size: 11 },
    },
  },
};

function getTimeScaleOptions() {
  return {
    type: 'time',
    time: {
      unit: 'day',
      displayFormats: { day: 'MMM d' },
    },
    grid: { color: '#f0f0f0', drawBorder: false },
    ticks: { color: '#999', font: { size: 11 }, maxTicksLimit: 12 },
  };
}

function getLinearScaleOptions(label = '') {
  return {
    grid: { color: '#f0f0f0', drawBorder: false },
    ticks: { color: '#999', font: { size: 11 } },
    title: label ? { display: true, text: label, color: '#999', font: { size: 11 } } : {},
  };
}

function destroyChart(id) {
  if (chartInstances[id]) {
    chartInstances[id].destroy();
    delete chartInstances[id];
  }
}

// Build a line chart from per-slug timeseries data
function buildTimeseriesChart(canvasId, perSlugData, options = {}) {
  destroyChart(canvasId);

  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const datasets = [];

  for (const [slug, dataPoints] of Object.entries(perSlugData)) {
    const coin = getCoinBySlug(slug);
    if (!coin || !dataPoints || dataPoints.length === 0) continue;

    let processedData = dataPoints.map(d => ({
      x: new Date(d.datetime),
      y: d.value,
    })).filter(d => d.y !== null && d.y !== undefined && !isNaN(d.y));

    // Normalize if requested
    if (options.normalize && processedData.length > 0) {
      const baseValue = processedData[0].y;
      if (baseValue !== 0) {
        processedData = processedData.map(d => ({
          x: d.x,
          y: (d.y / baseValue) * 100,
        }));
      }
    }

    datasets.push({
      label: `${coin.ticker} (${capitalize(getNetworkForSlug(slug))})`,
      data: processedData,
      borderColor: coin.color,
      backgroundColor: coin.color + '15',
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      fill: options.fill || false,
      tension: 0.3,
    });
  }

  if (datasets.length === 0) {
    showNoData(canvasId);
    return;
  }

  const yScale = getLinearScaleOptions(options.yLabel || '');
  if (options.yMin !== undefined) yScale.min = options.yMin;
  if (options.yMax !== undefined) yScale.max = options.yMax;

  const chartOpts = {
    ...CHART_DEFAULTS,
    scales: {
      x: getTimeScaleOptions(),
      y: yScale,
    },
  };
  if (options.large) chartOpts.aspectRatio = 2;

  chartInstances[canvasId] = new Chart(ctx, {
    type: 'line',
    data: { datasets },
    options: chartOpts,
  });
}

// Build a bar chart for network comparison
function buildNetworkBarChart(canvasId, networkData, label = '') {
  destroyChart(canvasId);

  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const networks = Object.keys(networkData);
  const colors = {
    ethereum: '#636890',
    solana: '#9945FF',
    bitcoin: '#f2a900',
  };

  chartInstances[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: networks.map(capitalize),
      datasets: [{
        label: label,
        data: networks.map(n => networkData[n]),
        backgroundColor: networks.map(n => colors[n] || '#999'),
        borderWidth: 0,
        borderRadius: 4,
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      aspectRatio: 1.5,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        legend: { display: false },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#666', font: { size: 12 } },
        },
        y: {
          grid: { color: '#f0f0f0', drawBorder: false },
          ticks: {
            color: '#999',
            font: { size: 11 },
            callback: function(v) { return formatCompact(v); },
          },
        },
      },
    },
  });
}

// Build network aggregated timeseries (sum coins per network)
function buildNetworkTimeseriesChart(canvasId, perSlugData, options = {}) {
  destroyChart(canvasId);

  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const networkColors = {
    ethereum: '#636890',
    solana: '#9945FF',
    bitcoin: '#f2a900',
  };

  // Aggregate by network
  const networkTimeseries = {};

  for (const [slug, dataPoints] of Object.entries(perSlugData)) {
    const network = getNetworkForSlug(slug);
    if (!networkTimeseries[network]) {
      networkTimeseries[network] = {};
    }

    for (const dp of dataPoints) {
      const dt = dp.datetime;
      if (!networkTimeseries[network][dt]) {
        networkTimeseries[network][dt] = 0;
      }
      if (dp.value !== null && dp.value !== undefined) {
        networkTimeseries[network][dt] += dp.value;
      }
    }
  }

  const datasets = [];

  for (const [network, dateMap] of Object.entries(networkTimeseries)) {
    const data = Object.entries(dateMap)
      .map(([dt, v]) => ({ x: new Date(dt), y: v }))
      .sort((a, b) => a.x - b.x);

    datasets.push({
      label: capitalize(network),
      data,
      borderColor: networkColors[network],
      backgroundColor: networkColors[network] + '20',
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      fill: true,
      tension: 0.3,
    });
  }

  if (datasets.length === 0) {
    showNoData(canvasId);
    return;
  }

  chartInstances[canvasId] = new Chart(ctx, {
    type: 'line',
    data: { datasets },
    options: {
      ...CHART_DEFAULTS,
      aspectRatio: 1.5,
      scales: {
        x: getTimeScaleOptions(),
        y: getLinearScaleOptions(options.yLabel || ''),
      },
    },
  });
}

function showNoData(canvasId) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  const parent = ctx.parentElement;
  const msg = document.createElement('p');
  msg.className = 'section-desc';
  msg.style.textAlign = 'center';
  msg.style.padding = '40px 0';
  msg.textContent = 'No data available for this metric.';
  parent.appendChild(msg);
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatUSD(n) {
  if (n === null || n === undefined) return '--';
  if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  if (n >= 1) return '$' + n.toFixed(2);
  if (n >= 0.01) return '$' + n.toFixed(4);
  return '$' + n.toFixed(8);
}

function formatCompact(n) {
  if (n === null || n === undefined) return '--';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(1);
}

function formatNumber(n) {
  if (n === null || n === undefined) return '--';
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
