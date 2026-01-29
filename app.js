// Main application logic
let cachedData = {};

function showLoading(show) {
  const overlay = document.getElementById('loading-overlay');
  if (show) {
    overlay.classList.add('active');
  } else {
    overlay.classList.remove('active');
  }
}

function getDays() {
  return parseInt(document.getElementById('timeRange').value, 10);
}

// Safely extract per-slug timeseries from multi-query result
function extractTimeseries(result) {
  if (!result) return {};
  if (result.data) {
    return parsePerSlugData(result.data);
  }
  if (result.fallback) {
    // Convert aggregated fallback into a simple structure
    const out = {};
    for (const [slug, val] of Object.entries(result.fallback)) {
      if (val !== null) {
        out[slug] = [{ datetime: new Date().toISOString(), value: val }];
      }
    }
    return out;
  }
  return {};
}

// Get the latest value for a slug from result data
function getLatestFromResult(results, metric, slug) {
  const result = results[metric];
  if (!result) return null;

  if (result.data) {
    const parsed = parsePerSlugData(result.data);
    const series = parsed[slug];
    if (series && series.length > 0) {
      return series[series.length - 1].value;
    }
  }

  if (result.fallback && result.fallback[slug] !== undefined) {
    return result.fallback[slug];
  }

  return null;
}

// Main data loading function
async function loadAllData() {
  const days = getDays();
  showLoading(true);

  try {
    // Fetch all timeseries in parallel
    const [priceData, socialData, sentimentData, volumeData, devData, daaData, mcapData] = await Promise.allSettled([
      fetchMetricMulti('price_usd', ALL_SLUGS, days).catch(e => fetchIndividual('price_usd', days)),
      fetchMetricMulti('social_volume_total', ALL_SLUGS, days).catch(e => fetchIndividual('social_volume_total', days)),
      fetchMetricMulti('sentiment_balance_total', ALL_SLUGS, days).catch(e => fetchIndividual('sentiment_balance_total', days)),
      fetchMetricMulti('volume_usd', ALL_SLUGS, days).catch(e => fetchIndividual('volume_usd', days)),
      fetchMetricMulti('dev_activity', ALL_SLUGS, days).catch(e => fetchIndividual('dev_activity', days)),
      fetchMetricMulti('daily_active_addresses', ALL_SLUGS, days).catch(e => fetchIndividual('daily_active_addresses', days)),
      fetchMetricMulti('marketcap_usd', ALL_SLUGS, days).catch(e => fetchIndividual('marketcap_usd', days)),
    ]);

    cachedData = {
      price: extractResult(priceData),
      social: extractResult(socialData),
      sentiment: extractResult(sentimentData),
      volume: extractResult(volumeData),
      dev: extractResult(devData),
      daa: extractResult(daaData),
      mcap: extractResult(mcapData),
    };

    renderAll();
  } catch (err) {
    console.error('Failed to load data:', err);
    alert('Failed to load data from Santiment API. Check console for details.');
  } finally {
    showLoading(false);
  }
}

function extractResult(settled) {
  if (settled.status === 'fulfilled') return settled.value;
  console.warn('Metric fetch failed:', settled.reason);
  return null;
}

// Fallback: fetch each slug individually
async function fetchIndividual(metric, days) {
  const results = {};
  const promises = ALL_SLUGS.map(async slug => {
    try {
      const data = await fetchMetricSingle(metric, slug, days);
      results[slug] = data;
    } catch (e) {
      console.warn(`Could not fetch ${metric} for ${slug}:`, e.message);
    }
  });
  await Promise.all(promises);
  return results;
}

// Normalize raw API data into consistent {slug: [{datetime, value}]} format
function normalizeData(raw) {
  if (!raw) return {};

  // Already in expected format
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const result = {};
    for (const [key, val] of Object.entries(raw)) {
      if (Array.isArray(val)) {
        result[key] = val.map(item => ({
          datetime: item.datetime || item.d || item.date,
          value: item.value !== undefined ? item.value : item.v,
        })).filter(d => d.datetime && d.value !== undefined);
      }
    }
    return result;
  }

  return raw;
}

// Render everything
function renderAll() {
  renderNetworkCards();
  renderCharts();
  renderTable();
  renderInsights();
}

function renderNetworkCards() {
  const mcapData = normalizeData(cachedData.mcap);
  const socialData = normalizeData(cachedData.social);
  const sentimentData = normalizeData(cachedData.sentiment);

  for (const [network, coins] of Object.entries(COINS)) {
    let totalMcap = 0;
    let totalSocial = 0;
    let totalSentiment = 0;
    let sentimentCount = 0;

    for (const coin of coins) {
      const mcapSeries = mcapData[coin.slug];
      const socialSeries = socialData[coin.slug];
      const sentSeries = sentimentData[coin.slug];

      if (mcapSeries && mcapSeries.length > 0) {
        totalMcap += mcapSeries[mcapSeries.length - 1].value || 0;
      }
      if (socialSeries && socialSeries.length > 0) {
        totalSocial += socialSeries[socialSeries.length - 1].value || 0;
      }
      if (sentSeries && sentSeries.length > 0) {
        totalSentiment += sentSeries[sentSeries.length - 1].value || 0;
        sentimentCount++;
      }
    }

    const prefix = network === 'ethereum' ? 'eth' : network === 'solana' ? 'sol' : 'btc';
    document.getElementById(`${prefix}-mcap`).textContent = formatUSD(totalMcap);
    document.getElementById(`${prefix}-social`).textContent = formatCompact(totalSocial);
    document.getElementById(`${prefix}-sentiment`).textContent = sentimentCount > 0
      ? (totalSentiment / sentimentCount).toFixed(3)
      : '--';
  }
}

function renderCharts() {
  const priceData = normalizeData(cachedData.price);
  const socialData = normalizeData(cachedData.social);
  const sentimentData = normalizeData(cachedData.sentiment);
  const volumeData = normalizeData(cachedData.volume);
  const devData = normalizeData(cachedData.dev);
  const daaData = normalizeData(cachedData.daa);

  // Price chart (normalized)
  buildTimeseriesChart('priceChart', priceData, {
    normalize: true,
    yLabel: 'Normalized (100 = start)',
  });

  // Social volume
  buildTimeseriesChart('socialChart', socialData, {
    yLabel: 'Mentions',
  });

  // Sentiment
  buildTimeseriesChart('sentimentChart', sentimentData, {
    yLabel: 'Sentiment Balance',
    fill: true,
  });

  // Trading volume
  buildTimeseriesChart('volumeChart', volumeData, {
    yLabel: 'USD',
  });

  // Dev activity
  buildTimeseriesChart('devChart', devData, {
    yLabel: 'Activity',
  });

  // Daily active addresses
  buildTimeseriesChart('daaChart', daaData, {
    yLabel: 'Addresses',
  });

  // Network comparison charts
  renderNetworkComparisonCharts(socialData, volumeData);
}

function renderNetworkComparisonCharts(socialData, volumeData) {
  // Aggregate social volume by network
  buildNetworkTimeseriesChart('networkSocialChart', socialData, {
    yLabel: 'Social Mentions',
  });

  // Aggregate trading volume by network
  buildNetworkTimeseriesChart('networkVolumeChart', volumeData, {
    yLabel: 'Volume USD',
  });
}

function renderTable() {
  const tbody = document.getElementById('coinTableBody');
  const priceData = normalizeData(cachedData.price);
  const mcapData = normalizeData(cachedData.mcap);
  const volumeData = normalizeData(cachedData.volume);
  const socialData = normalizeData(cachedData.social);
  const sentimentData = normalizeData(cachedData.sentiment);
  const devData = normalizeData(cachedData.dev);

  const rows = [];

  for (const coin of ALL_COINS) {
    const network = getNetworkForSlug(coin.slug);
    const latest = (data) => {
      const series = data[coin.slug];
      if (series && series.length > 0) return series[series.length - 1].value;
      return null;
    };

    const price = latest(priceData);
    const mcap = latest(mcapData);
    const vol = latest(volumeData);
    const social = latest(socialData);
    const sentiment = latest(sentimentData);
    const dev = latest(devData);

    rows.push(`
      <tr>
        <td><strong>${coin.ticker}</strong> <span style="color:#999; font-size:0.8em">${coin.name}</span></td>
        <td><span class="network-badge" style="color:var(--${network})">${capitalize(network)}</span></td>
        <td>${formatUSD(price)}</td>
        <td>${formatUSD(mcap)}</td>
        <td>${formatUSD(vol)}</td>
        <td>${social !== null ? formatCompact(social) : '--'}</td>
        <td>${sentiment !== null ? sentiment.toFixed(3) : '--'}</td>
        <td>${dev !== null ? formatNumber(dev) : '--'}</td>
      </tr>
    `);
  }

  tbody.innerHTML = rows.length > 0 ? rows.join('') : '<tr><td colspan="8" class="loading">No data available</td></tr>';
}

function renderInsights() {
  const socialData = normalizeData(cachedData.social);
  const priceData = normalizeData(cachedData.price);
  const volumeData = normalizeData(cachedData.volume);

  // Social behavior insight
  const socialInsight = analyzeSocialBehavior(socialData);
  document.getElementById('insight-social-text').textContent = socialInsight;

  // Price correlation insight
  const priceInsight = analyzePriceCorrelation(priceData);
  document.getElementById('insight-price-text').textContent = priceInsight;

  // Volume insight
  const volumeInsight = analyzeVolumePatterns(volumeData);
  document.getElementById('insight-volume-text').textContent = volumeInsight;

  // Summary
  const summaryInsight = generateSummary(socialData, priceData, volumeData);
  document.getElementById('insight-summary-text').textContent = summaryInsight;
}

// Analysis functions
function analyzeSocialBehavior(socialData) {
  const networkAvgs = {};

  for (const [network, coins] of Object.entries(COINS)) {
    let total = 0;
    let count = 0;
    for (const coin of coins) {
      const series = socialData[coin.slug];
      if (series && series.length > 0) {
        const avg = series.reduce((sum, d) => sum + (d.value || 0), 0) / series.length;
        total += avg;
        count++;
      }
    }
    networkAvgs[network] = count > 0 ? total / count : 0;
  }

  const sorted = Object.entries(networkAvgs).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return 'Insufficient data for social analysis.';

  const top = sorted[0];
  return `${capitalize(top[0])} meme coins average ${formatCompact(top[1])} social mentions/day, ` +
    `leading in social activity. ${sorted.map(([n, v]) => `${capitalize(n)}: ${formatCompact(v)}`).join(', ')}.`;
}

function analyzePriceCorrelation(priceData) {
  // Calculate average price change per network
  const networkChanges = {};

  for (const [network, coins] of Object.entries(COINS)) {
    const changes = [];
    for (const coin of coins) {
      const series = priceData[coin.slug];
      if (series && series.length >= 2) {
        const first = series[0].value;
        const last = series[series.length - 1].value;
        if (first > 0) {
          changes.push(((last - first) / first) * 100);
        }
      }
    }
    if (changes.length > 0) {
      networkChanges[network] = changes.reduce((s, v) => s + v, 0) / changes.length;
    }
  }

  if (Object.keys(networkChanges).length === 0) return 'Insufficient price data for correlation analysis.';

  const parts = Object.entries(networkChanges)
    .sort((a, b) => b[1] - a[1])
    .map(([n, v]) => `${capitalize(n)}: ${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);

  return `Average price change over period: ${parts.join(', ')}. ` +
    `${Object.keys(networkChanges).length > 1 ? 'Cross-network movements suggest ' +
    (Math.abs(Object.values(networkChanges).reduce((a, b) => a - b, 0)) < 10 ? 'correlated' : 'divergent') +
    ' behavior across ecosystems.' : ''}`;
}

function analyzeVolumePatterns(volumeData) {
  const networkTotals = {};

  for (const [network, coins] of Object.entries(COINS)) {
    let total = 0;
    for (const coin of coins) {
      const series = volumeData[coin.slug];
      if (series && series.length > 0) {
        total += series[series.length - 1].value || 0;
      }
    }
    networkTotals[network] = total;
  }

  if (Object.values(networkTotals).every(v => v === 0)) return 'Insufficient volume data.';

  const grandTotal = Object.values(networkTotals).reduce((s, v) => s + v, 0);
  const parts = Object.entries(networkTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([n, v]) => `${capitalize(n)}: ${formatUSD(v)} (${grandTotal > 0 ? ((v / grandTotal) * 100).toFixed(1) : 0}%)`);

  return `Volume distribution: ${parts.join(', ')}. ` +
    `Total meme coin trading volume: ${formatUSD(grandTotal)}.`;
}

function generateSummary(socialData, priceData, volumeData) {
  const hasData = Object.keys(normalizeData(priceData)).length > 0;
  if (!hasData) return 'Awaiting sufficient data for cross-network summary.';

  let ethCoins = 0, solCoins = 0, btcCoins = 0;
  for (const slug of Object.keys(normalizeData(priceData))) {
    const network = getNetworkForSlug(slug);
    if (network === 'ethereum') ethCoins++;
    else if (network === 'solana') solCoins++;
    else if (network === 'bitcoin') btcCoins++;
  }

  return `Tracking ${ethCoins} Ethereum, ${solCoins} Solana, and ${btcCoins} Bitcoin-derived meme coins. ` +
    `Ethereum-based meme coins (SHIB, PEPE, FLOKI) tend to have deeper liquidity and more on-chain metrics available. ` +
    `Solana-based tokens (BONK, WIF) often show higher velocity trading. ` +
    `DOGE, as a standalone chain, has the longest history and strongest brand recognition.`;
}

// Event listeners
document.getElementById('timeRange').addEventListener('change', loadAllData);

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadAllData();
});
