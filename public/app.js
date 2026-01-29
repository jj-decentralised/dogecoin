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
      fetchCohorts(Math.min(days, 90)),
    ]);

    if (hist.status === 'fulfilled') { HISTORY_DATA = hist.value; renderHistory(); }
    if (corr.status === 'fulfilled') { CORR_DATA = corr.value; renderBtcCorrelation(); }
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
// BTC correlation
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

  buildTimeseriesChart('btcCorrChart', perSlugCorr, {
    yLabel: 'Correlation with BTC',
    large: true,
    yMin: -1,
    yMax: 1,
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
// Cohorts
// ═══════════════════════════════════════════════════
function renderCohorts() {
  if (!COHORT_DATA) return;
  const slug = document.getElementById('cohortCoin').value;
  renderCohortBar(slug);
  renderCohortTime(slug);
  renderCohortCompare();
}

function renderCohortBar(slug) {
  destroyChart('cohortBarChart');
  const ctx = document.getElementById('cohortBarChart');
  if (!ctx || !COHORT_DATA) return;

  const holders = COHORT_DATA.holders[slug];
  if (!holders) { showNoData('cohortBarChart'); return; }

  const tiers = [
    '$1 - $10', '$10 - $100', '$100 - $1K', '$1K - $10K',
    '$10K - $100K', '$100K - $1M', '$1M - $10M', '$10M - $100M',
    '$100M - $1B', '$1B+',
  ];
  const colors = [
    '#e0e0e0','#c8c8c8','#b0b0b0','#909090',
    '#707070','#555555','#404040','#2a2a2a',
    '#1a1a1a','#000000',
  ];

  const labels = [], values = [], barColors = [];
  for (let i = 0; i < tiers.length; i++) {
    const series = holders[tiers[i]];
    if (series && series.length > 0) {
      const v = series[series.length - 1].value;
      if (v > 0) { labels.push(tiers[i]); values.push(v); barColors.push(colors[i]); }
    }
  }

  if (values.length === 0) { showNoData('cohortBarChart'); return; }

  chartInstances['cohortBarChart'] = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ data: values, backgroundColor: barColors, borderWidth: 0, borderRadius: 3 }] },
    options: {
      ...CHART_DEFAULTS, aspectRatio: 1.3, indexAxis: 'y',
      plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false } },
      scales: {
        x: { grid: { color: '#f0f0f0' }, ticks: { color: '#999', font: { size: 10 }, callback: v => formatCompact(v) } },
        y: { grid: { display: false }, ticks: { color: '#666', font: { size: 10 } } },
      },
    },
  });
}

function renderCohortTime(slug) {
  destroyChart('cohortTimeChart');
  const ctx = document.getElementById('cohortTimeChart');
  if (!ctx || !COHORT_DATA) return;

  const holders = COHORT_DATA.holders[slug];
  if (!holders) { showNoData('cohortTimeChart'); return; }

  const keyTiers = [
    { label: '$100 - $1K', color: '#b0b0b0' },
    { label: '$1K - $10K', color: '#808080' },
    { label: '$10K - $100K', color: '#555555' },
    { label: '$100K - $1M', color: '#333333' },
    { label: '$1M - $10M', color: '#1a1a1a' },
  ];

  const datasets = [];
  for (const tier of keyTiers) {
    const series = holders[tier.label];
    if (series && series.length > 1) {
      datasets.push({
        label: tier.label,
        data: series.map(d => ({ x: new Date(d.datetime), y: d.value })),
        borderColor: tier.color, backgroundColor: tier.color + '15',
        borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: false,
      });
    }
  }

  if (datasets.length === 0) { showNoData('cohortTimeChart'); return; }

  chartInstances['cohortTimeChart'] = new Chart(ctx, {
    type: 'line', data: { datasets },
    options: { ...CHART_DEFAULTS, aspectRatio: 1.3, scales: { x: getTimeScaleOptions(), y: getLinearScaleOptions('Holders') } },
  });
}

function renderCohortCompare() {
  destroyChart('cohortCompareChart');
  const ctx = document.getElementById('cohortCompareChart');
  if (!ctx || !COHORT_DATA) return;

  const compareTiers = ['$100 - $1K', '$1K - $10K', '$10K - $100K', '$100K - $1M', '$1M - $10M'];
  const tierColors = ['#d0d0d0', '#a0a0a0', '#707070', '#444444', '#1a1a1a'];
  const coinLabels = ALL_COINS.map(c => c.ticker);

  const datasets = compareTiers.map((tier, t) => {
    const data = ALL_COINS.map(coin => {
      const holders = COHORT_DATA.holders[coin.slug];
      if (!holders) return 0;
      const tierVal = lastVal(holders[tier]) || 0;
      const totalVal = lastVal(holders['_total']) || 1;
      return totalVal > 0 ? (tierVal / totalVal) * 100 : 0;
    });
    return { label: tier, data, backgroundColor: tierColors[t], borderWidth: 0, borderRadius: 2 };
  });

  chartInstances['cohortCompareChart'] = new Chart(ctx, {
    type: 'bar', data: { labels: coinLabels, datasets },
    options: {
      ...CHART_DEFAULTS, aspectRatio: 2.5,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        tooltip: { ...CHART_DEFAULTS.plugins.tooltip, callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y.toFixed(2)}%` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#666', font: { size: 12 } } },
        y: { grid: { color: '#f0f0f0' }, ticks: { color: '#999', font: { size: 10 }, callback: v => v + '%' },
          title: { display: true, text: '% of Total Holders', color: '#999', font: { size: 11 } } },
      },
    },
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
document.getElementById('cohortCoin').addEventListener('change', () => renderCohorts());
document.addEventListener('DOMContentLoaded', loadAllData);
