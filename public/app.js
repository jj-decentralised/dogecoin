// Main application logic
let DATA = {};
let HISTORY_DATA = null;
let CORR_DATA = null;
let COHORT_DATA = null;

function showLoading(show, text) {
  const el = document.getElementById('loading-overlay');
  el.classList.toggle('active', show);
  if (text) document.getElementById('loading-text').textContent = text;
}

function getDays() {
  return parseInt(document.getElementById('timeRange').value, 10);
}

function lastVal(series) {
  if (!series || series.length === 0) return null;
  return series[series.length - 1].value;
}

function getSeries(metric, slug) {
  return (DATA[metric] && DATA[metric][slug]) || [];
}

// ═══════════════════════════════════════════════════
// Loading
// ═══════════════════════════════════════════════════
async function loadAllData() {
  const days = getDays();
  showLoading(true, 'Fetching current metrics...');
  try {
    DATA = await fetchAllData(days);
    renderMain();

    showLoading(true, 'Fetching historical data...');
    const [hist, corr, cohorts] = await Promise.allSettled([
      HISTORY_DATA ? Promise.resolve(HISTORY_DATA) : fetchPriceHistory(),
      fetchBtcCorrelation(Math.max(days, 365)),
      COHORT_DATA ? Promise.resolve(COHORT_DATA) : fetchCohorts(),
    ]);

    if (hist.status === 'fulfilled') { HISTORY_DATA = hist.value; renderHistory(); }
    if (corr.status === 'fulfilled') { CORR_DATA = corr.value; renderBtcCorrelation(); renderCorrelationMatrix(); }
    if (cohorts.status === 'fulfilled') { COHORT_DATA = cohorts.value; renderCohorts(); }
  } catch (err) {
    console.error('Load failed:', err);
  } finally {
    showLoading(false);
  }
}

// ═══════════════════════════════════════════════════
// Render: main metrics
// ═══════════════════════════════════════════════════
function renderMain() {
  renderNetworkCards();
  renderCharts();
  renderTable();
  renderInsights();
}

function renderNetworkCards() {
  for (const [network, coins] of Object.entries(COINS)) {
    let totalMcap = 0, totalSocial = 0, totalSent = 0, sentCount = 0;
    for (const coin of coins) {
      const mcap = lastVal(getSeries('marketcap_usd', coin.slug));
      const social = lastVal(getSeries('social_volume_total', coin.slug));
      const sent = lastVal(getSeries('sentiment_balance_total', coin.slug));
      if (mcap) totalMcap += mcap;
      if (social) totalSocial += social;
      if (sent !== null) { totalSent += sent; sentCount++; }
    }
    const prefix = network === 'ethereum' ? 'eth' : network === 'solana' ? 'sol' : 'btc';
    document.getElementById(`${prefix}-mcap`).textContent = formatUSD(totalMcap);
    document.getElementById(`${prefix}-social`).textContent = formatCompact(totalSocial);
    document.getElementById(`${prefix}-sentiment`).textContent = sentCount > 0 ? (totalSent / sentCount).toFixed(3) : '--';
  }
}

function renderCharts() {
  buildTimeseriesChart('priceChart', DATA['price_usd'] || {}, { normalize: true, yLabel: 'Normalized (100 = start)' });
  buildTimeseriesChart('socialChart', DATA['social_volume_total'] || {}, { yLabel: 'Mentions' });
  buildTimeseriesChart('sentimentChart', DATA['sentiment_balance_total'] || {}, { yLabel: 'Sentiment Balance', fill: true });
  buildTimeseriesChart('volumeChart', DATA['volume_usd'] || {}, { yLabel: 'USD' });
  buildTimeseriesChart('devChart', DATA['dev_activity'] || {}, { yLabel: 'Activity' });
  buildTimeseriesChart('daaChart', DATA['daily_active_addresses'] || {}, { yLabel: 'Addresses' });
  renderNetworkDominance();
  buildNetworkTimeseriesChart('networkSocialChart', DATA['social_volume_total'] || {}, { yLabel: 'Social Mentions' });
  buildNetworkTimeseriesChart('networkVolumeChart', DATA['volume_usd'] || {}, { yLabel: 'Volume USD' });
}

// ═══════════════════════════════════════════════════
// Historical prices since 2017
// ═══════════════════════════════════════════════════
function renderHistory() {
  if (!HISTORY_DATA) return;
  buildTimeseriesChart('historyChart', HISTORY_DATA, {
    normalize: true,
    yLabel: 'Normalized (100 = start)',
    large: true,
  });
}

// ═══════════════════════════════════════════════════
// BTC correlation — with reference lines
// ═══════════════════════════════════════════════════
function renderBtcCorrelation() {
  if (!CORR_DATA) return;

  const btcSeries = CORR_DATA['bitcoin'] || [];
  if (btcSeries.length < 31) return;

  const btcReturns = computeReturns(btcSeries);
  const perSlugCorr = {};

  for (const slug of ALL_SLUGS) {
    const series = CORR_DATA[slug];
    if (!series || series.length < 31) continue;
    const coinReturns = computeReturns(series);
    const rolling = rollingCorrelation(coinReturns, btcReturns, 30);
    if (rolling.length > 0) perSlugCorr[slug] = rolling;
  }

  // Build datasets
  destroyChart('btcCorrChart');
  const ctx = document.getElementById('btcCorrChart');
  if (!ctx) return;

  const datasets = [];
  for (const [slug, series] of Object.entries(perSlugCorr)) {
    const coin = getCoinBySlug(slug);
    if (!coin) continue;
    datasets.push({
      label: `${coin.ticker}`,
      data: series.map(d => ({ x: new Date(d.datetime), y: d.value })),
      borderColor: coin.color,
      backgroundColor: coin.color + '15',
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      fill: false,
      tension: 0.3,
    });
  }

  // Get date range for reference lines
  const allDates = Object.values(perSlugCorr).flat();
  if (allDates.length === 0) return;
  const minDate = new Date(allDates.reduce((m, d) => d.datetime < m ? d.datetime : m, allDates[0].datetime));
  const maxDate = new Date(allDates.reduce((m, d) => d.datetime > m ? d.datetime : m, allDates[0].datetime));

  // High correlation threshold (0.7)
  datasets.push({
    label: 'High Correlation (0.7)',
    data: [{ x: minDate, y: 0.7 }, { x: maxDate, y: 0.7 }],
    borderColor: '#e6a817',
    borderWidth: 1,
    borderDash: [8, 4],
    pointRadius: 0,
    fill: false,
    tension: 0,
  });

  // Independence threshold (0.5)
  datasets.push({
    label: 'Independence (0.5)',
    data: [{ x: minDate, y: 0.5 }, { x: maxDate, y: 0.5 }],
    borderColor: '#2ecc71',
    borderWidth: 1,
    borderDash: [8, 4],
    pointRadius: 0,
    fill: false,
    tension: 0,
  });

  // Zero line
  datasets.push({
    label: 'Zero',
    data: [{ x: minDate, y: 0 }, { x: maxDate, y: 0 }],
    borderColor: '#ccc',
    borderWidth: 1,
    pointRadius: 0,
    fill: false,
    tension: 0,
  });

  chartInstances['btcCorrChart'] = new Chart(ctx, {
    type: 'line',
    data: { datasets },
    options: {
      ...CHART_DEFAULTS,
      aspectRatio: 2,
      scales: {
        x: getTimeScaleOptions(),
        y: {
          min: -1, max: 1,
          grid: { color: '#f0f0f0', drawBorder: false },
          ticks: { color: '#999', font: { size: 11 } },
          title: { display: true, text: 'Correlation with BTC', color: '#999', font: { size: 11 } },
        },
      },
    },
  });
}

function computeReturns(series) {
  const returns = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1].value, curr = series[i].value;
    if (prev > 0 && curr > 0) {
      returns.push({ datetime: series[i].datetime, value: Math.log(curr / prev) });
    }
  }
  return returns;
}

function rollingCorrelation(a, b, window) {
  const bMap = {};
  for (const d of b) bMap[d.datetime] = d.value;

  const aligned = [];
  for (const d of a) {
    if (bMap[d.datetime] !== undefined) {
      aligned.push({ datetime: d.datetime, av: d.value, bv: bMap[d.datetime] });
    }
  }

  const result = [];
  for (let i = window; i <= aligned.length; i++) {
    const slice = aligned.slice(i - window, i);
    const corr = pearson(slice.map(s => s.av), slice.map(s => s.bv));
    if (!isNaN(corr)) {
      result.push({ datetime: slice[slice.length - 1].datetime, value: corr });
    }
  }
  return result;
}

function pearson(x, y) {
  const n = x.length;
  if (n === 0) return NaN;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : num / denom;
}

// ═══════════════════════════════════════════════════
// Cross-Asset Correlation Matrix
// ═══════════════════════════════════════════════════
function renderCorrelationMatrix() {
  if (!CORR_DATA) return;
  const canvas = document.getElementById('corrMatrixChart');
  if (!canvas) return;
  destroyChart('corrMatrixChart');

  const slugs = ALL_SLUGS.filter(s => CORR_DATA[s] && CORR_DATA[s].length > 30);
  if (slugs.length < 2) return;

  // Compute returns for all
  const returnsMap = {};
  for (const slug of slugs) {
    returnsMap[slug] = computeReturns(CORR_DATA[slug]);
  }

  // Compute pairwise correlations (full period)
  const labels = slugs.map(s => {
    const coin = getCoinBySlug(s);
    return coin ? coin.ticker : s;
  });
  const matrix = [];

  for (let i = 0; i < slugs.length; i++) {
    const row = [];
    for (let j = 0; j < slugs.length; j++) {
      if (i === j) { row.push(1); continue; }
      const a = returnsMap[slugs[i]], b = returnsMap[slugs[j]];
      // Align by date
      const bMap = {};
      for (const d of b) bMap[d.datetime] = d.value;
      const ax = [], bx = [];
      for (const d of a) {
        if (bMap[d.datetime] !== undefined) { ax.push(d.value); bx.push(bMap[d.datetime]); }
      }
      row.push(ax.length > 10 ? pearson(ax, bx) : NaN);
    }
    matrix.push(row);
  }

  // Render as HTML table (Chart.js doesn't natively do heatmaps well)
  const container = canvas.parentElement;
  canvas.style.display = 'none';

  const table = document.createElement('div');
  table.className = 'corr-matrix';
  let html = '<table><thead><tr><th></th>';
  for (const l of labels) html += `<th>${l}</th>`;
  html += '</tr></thead><tbody>';

  for (let i = 0; i < labels.length; i++) {
    html += `<tr><th>${labels[i]}</th>`;
    for (let j = 0; j < labels.length; j++) {
      const v = matrix[i][j];
      const bg = corrColor(v);
      const text = isNaN(v) ? '--' : v.toFixed(2);
      html += `<td style="background:${bg};color:${v > 0.7 ? '#fff' : '#1a1a1a'};text-align:center;font-weight:500;font-size:0.85rem;padding:10px 8px">${text}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  table.innerHTML = html;
  container.appendChild(table);
}

function corrColor(v) {
  if (isNaN(v)) return '#f5f5f5';
  // Green gradient: 0 = light, 1 = dark green
  const t = Math.max(0, Math.min(1, (v + 1) / 2)); // map -1..1 to 0..1
  const r = Math.round(245 - t * 180);
  const g = Math.round(245 - t * 80);
  const b = Math.round(245 - t * 160);
  return `rgb(${r},${g},${b})`;
}

// ═══════════════════════════════════════════════════
// Network Dominance (ETH vs SOL meme market cap share)
// ═══════════════════════════════════════════════════
function renderNetworkDominance() {
  const mcapData = DATA['marketcap_usd'] || {};
  destroyChart('networkDominanceChart');
  const ctx = document.getElementById('networkDominanceChart');
  if (!ctx) return;

  // Aggregate mcap by network per date
  const networkTimeseries = { ethereum: {}, solana: {}, bitcoin: {} };

  for (const [slug, dataPoints] of Object.entries(mcapData)) {
    const network = getNetworkForSlug(slug);
    if (!networkTimeseries[network]) continue;
    for (const dp of dataPoints) {
      if (!networkTimeseries[network][dp.datetime]) networkTimeseries[network][dp.datetime] = 0;
      if (dp.value) networkTimeseries[network][dp.datetime] += dp.value;
    }
  }

  // Compute ETH dominance % per date
  const allDates = [...new Set(Object.values(networkTimeseries).flatMap(m => Object.keys(m)))].sort();
  const ethDom = [], solDom = [];

  for (const dt of allDates) {
    const eth = networkTimeseries.ethereum[dt] || 0;
    const sol = networkTimeseries.solana[dt] || 0;
    const btc = networkTimeseries.bitcoin[dt] || 0;
    const total = eth + sol + btc;
    if (total > 0) {
      ethDom.push({ x: new Date(dt), y: (eth / total) * 100 });
      solDom.push({ x: new Date(dt), y: (sol / total) * 100 });
    }
  }

  const networkColors = { ethereum: '#636890', solana: '#9945FF', bitcoin: '#f2a900' };

  chartInstances['networkDominanceChart'] = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Ethereum Memes',
          data: ethDom,
          borderColor: networkColors.ethereum,
          backgroundColor: networkColors.ethereum + '30',
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          tension: 0.3,
        },
        {
          label: 'Solana Memes',
          data: solDom,
          borderColor: networkColors.solana,
          backgroundColor: networkColors.solana + '30',
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          tension: 0.3,
        },
      ],
    },
    options: {
      ...CHART_DEFAULTS,
      aspectRatio: 1.5,
      scales: {
        x: getTimeScaleOptions(),
        y: {
          min: 0, max: 100,
          grid: { color: '#f0f0f0', drawBorder: false },
          ticks: { color: '#999', font: { size: 11 }, callback: v => v + '%' },
          title: { display: true, text: 'Market Cap Share (%)', color: '#999', font: { size: 11 } },
        },
      },
    },
  });
}

// ═══════════════════════════════════════════════════
// Cohorts — stacked area % per coin + comparison charts
// COHORT_DATA shape: { raw: {...}, grouped: { slug: { dates, retail[], mid[], large[], whales[], total[] } } }
// ═══════════════════════════════════════════════════
function renderCohorts() {
  if (!COHORT_DATA || !COHORT_DATA.grouped) return;

  const container = document.getElementById('cohort-charts');
  if (!container) return;

  // Clean up previous
  const prevIds = container.querySelectorAll('canvas');
  prevIds.forEach(c => destroyChart(c.id));
  container.innerHTML = '';

  const grouped = COHORT_DATA.grouped;
  const coinsWithData = ALL_COINS.filter(c => grouped[c.slug] && grouped[c.slug].dates && grouped[c.slug].dates.length > 10);
  if (coinsWithData.length === 0) {
    container.innerHTML = '<p class="section-desc" style="text-align:center;padding:40px">No cohort data available.</p>';
    return;
  }

  const groupColors = {
    retail: { border: '#2ecc71', bg: 'rgba(46,204,113,0.4)' },
    mid:    { border: '#3498db', bg: 'rgba(52,152,219,0.4)' },
    large:  { border: '#f39c12', bg: 'rgba(243,156,18,0.4)' },
    whales: { border: '#e74c3c', bg: 'rgba(231,76,60,0.4)' },
  };
  const groupLabels = { retail: '<$1K (Retail)', mid: '$1K–$10K', large: '$10K–$100K', whales: '$100K+ (Whales)' };
  const groupKeys = ['retail', 'mid', 'large', 'whales'];

  // === 1. Stacked area chart per coin (% of holders by group) ===
  const stackedGrid = document.createElement('div');
  stackedGrid.className = 'chart-row-wrap';
  const stackedTitle = document.createElement('h3');
  stackedTitle.textContent = 'Holder Distribution Over Time (% of Wallets)';
  stackedTitle.style.cssText = 'font-size:1.1rem;font-weight:400;color:#666;margin-bottom:12px';
  container.appendChild(stackedTitle);
  container.appendChild(stackedGrid);

  coinsWithData.forEach((coin, idx) => {
    const d = grouped[coin.slug];
    const canvasId = 'cohort-stacked-' + idx;
    const wrapper = document.createElement('div');
    wrapper.className = 'chart-container half';
    wrapper.innerHTML = `<h3>${coin.ticker}: Cohort Distribution</h3><canvas id="${canvasId}"></canvas>`;
    stackedGrid.appendChild(wrapper);

    const dates = d.dates.map(dt => new Date(dt));
    const datasets = groupKeys.map(g => ({
      label: groupLabels[g],
      data: dates.map((dt, i) => ({ x: dt, y: d[g][i] })),
      borderColor: groupColors[g].border,
      backgroundColor: groupColors[g].bg,
      borderWidth: 1.5,
      pointRadius: 0,
      fill: true,
      tension: 0.3,
    }));

    requestAnimationFrame(() => {
      const ctx = document.getElementById(canvasId);
      if (!ctx) return;
      chartInstances[canvasId] = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
          ...CHART_DEFAULTS,
          aspectRatio: 1.6,
          scales: {
            x: getTimeScaleOptions(),
            y: {
              stacked: true,
              min: 0, max: 100,
              grid: { color: '#f0f0f0', drawBorder: false },
              ticks: { color: '#999', font: { size: 10 }, callback: v => v + '%' },
              title: { display: true, text: '% of Wallets', color: '#999', font: { size: 10 } },
            },
          },
          plugins: {
            ...CHART_DEFAULTS.plugins,
            tooltip: {
              ...CHART_DEFAULTS.plugins.tooltip,
              callbacks: {
                label: function(context) {
                  return `${context.dataset.label}: ${context.parsed.y.toFixed(1)}%`;
                },
              },
            },
          },
        },
      });
    });
  });

  // === 2. Retail Ownership Comparison (all coins, line chart) ===
  const compTitle = document.createElement('h3');
  compTitle.textContent = 'Cross-Network Cohort Comparison';
  compTitle.style.cssText = 'font-size:1.1rem;font-weight:400;color:#666;margin-top:30px;margin-bottom:12px';
  container.appendChild(compTitle);

  const compGrid = document.createElement('div');
  compGrid.className = 'chart-row-wrap';
  container.appendChild(compGrid);

  // Retail comparison
  buildCohortComparisonChart(compGrid, 'cohort-retail-cmp', 'Retail Ownership (<$1K)', 'retail', coinsWithData, grouped);
  // Whale comparison
  buildCohortComparisonChart(compGrid, 'cohort-whale-cmp', 'Whale Concentration ($100K+)', 'whales', coinsWithData, grouped);
  // Total holders comparison
  buildCohortTotalChart(compGrid, 'cohort-total-cmp', 'Total Holders Over Time', coinsWithData, grouped);
  // Mid-tier comparison
  buildCohortComparisonChart(compGrid, 'cohort-mid-cmp', 'Mid-Tier ($1K–$10K)', 'mid', coinsWithData, grouped);
}

function buildCohortComparisonChart(parent, canvasId, title, groupKey, coins, grouped) {
  const wrapper = document.createElement('div');
  wrapper.className = 'chart-container half';
  wrapper.innerHTML = `<h3>${title}</h3><canvas id="${canvasId}"></canvas>`;
  parent.appendChild(wrapper);

  const datasets = coins.map(coin => {
    const d = grouped[coin.slug];
    const dates = d.dates.map(dt => new Date(dt));
    return {
      label: coin.ticker,
      data: dates.map((dt, i) => ({ x: dt, y: d[groupKey][i] })),
      borderColor: coin.color,
      backgroundColor: coin.color + '20',
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      fill: false,
      tension: 0.3,
    };
  });

  requestAnimationFrame(() => {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    chartInstances[canvasId] = new Chart(ctx, {
      type: 'line',
      data: { datasets },
      options: {
        ...CHART_DEFAULTS,
        aspectRatio: 1.6,
        scales: {
          x: getTimeScaleOptions(),
          y: {
            grid: { color: '#f0f0f0', drawBorder: false },
            ticks: { color: '#999', font: { size: 10 }, callback: v => v + '%' },
            title: { display: true, text: '% of Wallets', color: '#999', font: { size: 10 } },
          },
        },
      },
    });
  });
}

function buildCohortTotalChart(parent, canvasId, title, coins, grouped) {
  const wrapper = document.createElement('div');
  wrapper.className = 'chart-container half';
  wrapper.innerHTML = `<h3>${title}</h3><canvas id="${canvasId}"></canvas>`;
  parent.appendChild(wrapper);

  const datasets = coins.map(coin => {
    const d = grouped[coin.slug];
    const dates = d.dates.map(dt => new Date(dt));
    return {
      label: coin.ticker,
      data: dates.map((dt, i) => ({ x: dt, y: d.total[i] })),
      borderColor: coin.color,
      backgroundColor: coin.color + '20',
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      fill: false,
      tension: 0.3,
    };
  });

  requestAnimationFrame(() => {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    chartInstances[canvasId] = new Chart(ctx, {
      type: 'line',
      data: { datasets },
      options: {
        ...CHART_DEFAULTS,
        aspectRatio: 1.6,
        scales: {
          x: getTimeScaleOptions(),
          y: {
            grid: { color: '#f0f0f0', drawBorder: false },
            ticks: { color: '#999', font: { size: 10 }, callback: v => formatCompact(v) },
            title: { display: true, text: 'Total Holders', color: '#999', font: { size: 10 } },
          },
        },
      },
    });
  });
}

// ═══════════════════════════════════════════════════
// Table
// ═══════════════════════════════════════════════════
function renderTable() {
  const tbody = document.getElementById('coinTableBody');
  const rows = ALL_COINS.map(coin => {
    const network = getNetworkForSlug(coin.slug);
    const price = lastVal(getSeries('price_usd', coin.slug));
    const mcap = lastVal(getSeries('marketcap_usd', coin.slug));
    const vol = lastVal(getSeries('volume_usd', coin.slug));
    const social = lastVal(getSeries('social_volume_total', coin.slug));
    const sent = lastVal(getSeries('sentiment_balance_total', coin.slug));
    const dev = lastVal(getSeries('dev_activity', coin.slug));
    return `<tr>
      <td><strong>${coin.ticker}</strong> <span style="color:#999;font-size:0.8em">${coin.name}</span></td>
      <td style="color:var(--${network})">${capitalize(network)}</td>
      <td>${formatUSD(price)}</td><td>${formatUSD(mcap)}</td><td>${formatUSD(vol)}</td>
      <td>${social !== null ? formatCompact(social) : '--'}</td>
      <td>${sent !== null ? sent.toFixed(3) : '--'}</td>
      <td>${dev !== null ? formatNumber(dev) : '--'}</td>
    </tr>`;
  });
  tbody.innerHTML = rows.join('');
}

// ═══════════════════════════════════════════════════
// Insights
// ═══════════════════════════════════════════════════
function renderInsights() {
  document.getElementById('insight-social-text').textContent = analyzeSocial();
  document.getElementById('insight-price-text').textContent = analyzePrice();
  document.getElementById('insight-volume-text').textContent = analyzeVolume();
  document.getElementById('insight-summary-text').textContent = generateSummary();
}

function avgMetricByNetwork(metric) {
  const avgs = {};
  for (const [network, coins] of Object.entries(COINS)) {
    let sum = 0, count = 0;
    for (const coin of coins) {
      const series = getSeries(metric, coin.slug);
      if (series.length > 0) { sum += series.reduce((s, d) => s + (d.value || 0), 0) / series.length; count++; }
    }
    avgs[network] = count > 0 ? sum / count : 0;
  }
  return avgs;
}

function analyzeSocial() {
  const avgs = avgMetricByNetwork('social_volume_total');
  const sorted = Object.entries(avgs).sort((a, b) => b[1] - a[1]);
  if (sorted.every(([, v]) => v === 0)) return 'Insufficient social data.';
  return `${capitalize(sorted[0][0])} meme coins lead with ~${formatCompact(sorted[0][1])} avg daily mentions. ` +
    sorted.map(([n, v]) => `${capitalize(n)}: ${formatCompact(v)}`).join(', ') + '.';
}

function analyzePrice() {
  const changes = {};
  for (const [network, coins] of Object.entries(COINS)) {
    const pcts = [];
    for (const coin of coins) {
      const series = getSeries('price_usd', coin.slug);
      if (series.length >= 2) {
        const f = series[0].value, l = series[series.length - 1].value;
        if (f > 0) pcts.push(((l - f) / f) * 100);
      }
    }
    if (pcts.length > 0) changes[network] = pcts.reduce((s, v) => s + v, 0) / pcts.length;
  }
  if (Object.keys(changes).length === 0) return 'Insufficient price data.';
  const parts = Object.entries(changes).sort((a, b) => b[1] - a[1]).map(([n, v]) => `${capitalize(n)}: ${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);
  const vals = Object.values(changes);
  const spread = Math.max(...vals) - Math.min(...vals);
  return `Avg price change — ${parts.join(', ')}. Networks appear ${spread < 15 ? 'correlated' : 'divergent'}.`;
}

function analyzeVolume() {
  const totals = {};
  for (const [network, coins] of Object.entries(COINS)) {
    let total = 0;
    for (const coin of coins) { const v = lastVal(getSeries('volume_usd', coin.slug)); if (v) total += v; }
    totals[network] = total;
  }
  const grand = Object.values(totals).reduce((s, v) => s + v, 0);
  if (grand === 0) return 'Insufficient volume data.';
  return `Volume: ${Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([n, v]) => `${capitalize(n)}: ${formatUSD(v)} (${((v / grand) * 100).toFixed(1)}%)`).join(', ')}. Total: ${formatUSD(grand)}.`;
}

function generateSummary() {
  const priceData = DATA['price_usd'] || {};
  const loaded = Object.keys(priceData).filter(s => priceData[s] && priceData[s].length > 0).length;
  if (loaded === 0) return 'Awaiting data.';
  return `Tracking ${loaded} meme coins across 3 networks. Ethereum tokens (SHIB, PEPE, FLOKI) have deeper liquidity. Solana tokens (BONK, WIF) show higher-velocity trading. DOGE has the longest history and strongest brand.`;
}

// ═══════════════════════════════════════════════════
// Events
// ═══════════════════════════════════════════════════
document.getElementById('timeRange').addEventListener('change', loadAllData);
document.addEventListener('DOMContentLoaded', loadAllData);
