// Main application logic
// Data shape: { metricName: { slug: [{datetime, value}] } }
let DATA = {};

function showLoading(show) {
  const el = document.getElementById('loading-overlay');
  el.classList.toggle('active', show);
}

function getDays() {
  return parseInt(document.getElementById('timeRange').value, 10);
}

// Helper: get last value from a series
function lastVal(series) {
  if (!series || series.length === 0) return null;
  return series[series.length - 1].value;
}

// Helper: get series for a metric+slug
function getSeries(metric, slug) {
  return (DATA[metric] && DATA[metric][slug]) || [];
}

// ----- Load -----
async function loadAllData() {
  const days = getDays();
  showLoading(true);
  try {
    DATA = await fetchAllData(days);
    renderAll();
  } catch (err) {
    console.error('Load failed:', err);
  } finally {
    showLoading(false);
  }
}

// ----- Render everything -----
function renderAll() {
  renderNetworkCards();
  renderCharts();
  renderTable();
  renderInsights();
}

// ----- Network overview cards -----
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
    document.getElementById(`${prefix}-sentiment`).textContent =
      sentCount > 0 ? (totalSent / sentCount).toFixed(3) : '--';
  }
}

// ----- Charts -----
function renderCharts() {
  // Price (normalized)
  buildTimeseriesChart('priceChart', DATA['price_usd'] || {}, {
    normalize: true, yLabel: 'Normalized (100 = start)',
  });

  // Social volume
  buildTimeseriesChart('socialChart', DATA['social_volume_total'] || {}, {
    yLabel: 'Mentions',
  });

  // Sentiment
  buildTimeseriesChart('sentimentChart', DATA['sentiment_balance_total'] || {}, {
    yLabel: 'Sentiment Balance', fill: true,
  });

  // Volume
  buildTimeseriesChart('volumeChart', DATA['volume_usd'] || {}, {
    yLabel: 'USD',
  });

  // Dev activity
  buildTimeseriesChart('devChart', DATA['dev_activity'] || {}, {
    yLabel: 'Activity',
  });

  // Daily active addresses
  buildTimeseriesChart('daaChart', DATA['daily_active_addresses'] || {}, {
    yLabel: 'Addresses',
  });

  // Network aggregated comparison
  buildNetworkTimeseriesChart('networkSocialChart', DATA['social_volume_total'] || {}, {
    yLabel: 'Social Mentions',
  });
  buildNetworkTimeseriesChart('networkVolumeChart', DATA['volume_usd'] || {}, {
    yLabel: 'Volume USD',
  });
}

// ----- Coin table -----
function renderTable() {
  const tbody = document.getElementById('coinTableBody');
  const rows = [];

  for (const coin of ALL_COINS) {
    const network = getNetworkForSlug(coin.slug);
    const price = lastVal(getSeries('price_usd', coin.slug));
    const mcap = lastVal(getSeries('marketcap_usd', coin.slug));
    const vol = lastVal(getSeries('volume_usd', coin.slug));
    const social = lastVal(getSeries('social_volume_total', coin.slug));
    const sent = lastVal(getSeries('sentiment_balance_total', coin.slug));
    const dev = lastVal(getSeries('dev_activity', coin.slug));

    rows.push(`<tr>
      <td><strong>${coin.ticker}</strong> <span style="color:#999;font-size:0.8em">${coin.name}</span></td>
      <td style="color:var(--${network})">${capitalize(network)}</td>
      <td>${formatUSD(price)}</td>
      <td>${formatUSD(mcap)}</td>
      <td>${formatUSD(vol)}</td>
      <td>${social !== null ? formatCompact(social) : '--'}</td>
      <td>${sent !== null ? sent.toFixed(3) : '--'}</td>
      <td>${dev !== null ? formatNumber(dev) : '--'}</td>
    </tr>`);
  }

  tbody.innerHTML = rows.join('');
}

// ----- Correlation insights -----
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
      if (series.length > 0) {
        const avg = series.reduce((s, d) => s + (d.value || 0), 0) / series.length;
        sum += avg;
        count++;
      }
    }
    avgs[network] = count > 0 ? sum / count : 0;
  }
  return avgs;
}

function analyzeSocial() {
  const avgs = avgMetricByNetwork('social_volume_total');
  const sorted = Object.entries(avgs).sort((a, b) => b[1] - a[1]);
  if (sorted.every(([, v]) => v === 0)) return 'Insufficient social data.';
  return `${capitalize(sorted[0][0])} meme coins lead in social activity with ~${formatCompact(sorted[0][1])} avg daily mentions. ` +
    sorted.map(([n, v]) => `${capitalize(n)}: ${formatCompact(v)}`).join(', ') + '.';
}

function analyzePrice() {
  const changes = {};
  for (const [network, coins] of Object.entries(COINS)) {
    const pcts = [];
    for (const coin of coins) {
      const series = getSeries('price_usd', coin.slug);
      if (series.length >= 2) {
        const first = series[0].value;
        const last = series[series.length - 1].value;
        if (first > 0) pcts.push(((last - first) / first) * 100);
      }
    }
    if (pcts.length > 0) changes[network] = pcts.reduce((s, v) => s + v, 0) / pcts.length;
  }

  if (Object.keys(changes).length === 0) return 'Insufficient price data.';
  const parts = Object.entries(changes)
    .sort((a, b) => b[1] - a[1])
    .map(([n, v]) => `${capitalize(n)}: ${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);

  const vals = Object.values(changes);
  const spread = Math.max(...vals) - Math.min(...vals);
  const correlation = spread < 15 ? 'correlated (moving together)' : 'divergent (different trajectories)';

  return `Avg price change — ${parts.join(', ')}. Networks appear ${correlation}.`;
}

function analyzeVolume() {
  const totals = {};
  for (const [network, coins] of Object.entries(COINS)) {
    let total = 0;
    for (const coin of coins) {
      const v = lastVal(getSeries('volume_usd', coin.slug));
      if (v) total += v;
    }
    totals[network] = total;
  }

  const grand = Object.values(totals).reduce((s, v) => s + v, 0);
  if (grand === 0) return 'Insufficient volume data.';

  const parts = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .map(([n, v]) => `${capitalize(n)}: ${formatUSD(v)} (${((v / grand) * 100).toFixed(1)}%)`);

  return `Volume distribution: ${parts.join(', ')}. Total: ${formatUSD(grand)}.`;
}

function generateSummary() {
  const priceData = DATA['price_usd'] || {};
  const loaded = Object.keys(priceData).filter(s => priceData[s] && priceData[s].length > 0).length;
  if (loaded === 0) return 'Awaiting data.';

  return `Tracking ${loaded} meme coins across 3 networks. ` +
    'Ethereum tokens (SHIB, PEPE, FLOKI) typically have deeper liquidity and richer on-chain metrics. ' +
    'Solana tokens (BONK, WIF) tend toward higher-velocity trading with lower fees. ' +
    'DOGE, as its own chain, has the longest history and broadest brand recognition.';
}

// ----- Init -----
document.getElementById('timeRange').addEventListener('change', loadAllData);
document.addEventListener('DOMContentLoaded', loadAllData);
