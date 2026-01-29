// Santiment API Layer
const SAN_API = 'https://api.santiment.net/graphql';
const API_KEY = 'lslg6obns73tqqlb_fc5byjldbwd5lz6t';

// Meme coins grouped by network
const COINS = {
  ethereum: [
    { slug: 'shiba-inu', ticker: 'SHIB', name: 'Shiba Inu', color: '#e74c3c' },
    { slug: 'pepe', ticker: 'PEPE', name: 'Pepe', color: '#3cb043' },
    { slug: 'floki', ticker: 'FLOKI', name: 'Floki', color: '#d4a017' },
  ],
  solana: [
    { slug: 'bonk', ticker: 'BONK', name: 'Bonk', color: '#ff6b35' },
    { slug: 'dogwifhat', ticker: 'WIF', name: 'dogwifhat', color: '#9b59b6' },
  ],
  bitcoin: [
    { slug: 'dogecoin', ticker: 'DOGE', name: 'Dogecoin', color: '#c2a633' },
  ],
};

const ALL_SLUGS = Object.values(COINS).flat().map(c => c.slug);
const ALL_COINS = Object.values(COINS).flat();

function getCoinBySlug(slug) {
  return ALL_COINS.find(c => c.slug === slug);
}

function getNetworkForSlug(slug) {
  for (const [network, coins] of Object.entries(COINS)) {
    if (coins.some(c => c.slug === slug)) return network;
  }
  return 'unknown';
}

// Date helpers
function getDateRange(days) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

// GraphQL query executor
async function sanQuery(query) {
  const resp = await fetch(SAN_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Apikey ${API_KEY}`,
    },
    body: JSON.stringify({ query }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error('Santiment API error:', resp.status, text);
    throw new Error(`API error: ${resp.status}`);
  }

  const json = await resp.json();
  if (json.errors) {
    console.error('GraphQL errors:', json.errors);
    throw new Error(json.errors[0].message);
  }
  return json.data;
}

// Fetch a timeseries metric for multiple slugs
async function fetchMetricMulti(metric, slugs, days, interval = '1d') {
  const { from, to } = getDateRange(days);
  const slugList = slugs.map(s => `"${s}"`).join(', ');

  const query = `{
    getMetric(metric: "${metric}") {
      timeseriesDataPerSlugJson(
        selector: { slugs: [${slugList}] }
        from: "${from}"
        to: "${to}"
        interval: "${interval}"
      )
    }
  }`;

  const data = await sanQuery(query);
  const raw = data.getMetric.timeseriesDataPerSlugJson;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

// Fetch a single metric for a single slug
async function fetchMetricSingle(metric, slug, days, interval = '1d') {
  const { from, to } = getDateRange(days);

  const query = `{
    getMetric(metric: "${metric}") {
      timeseriesData(
        slug: "${slug}"
        from: "${from}"
        to: "${to}"
        interval: "${interval}"
      ) {
        datetime
        value
      }
    }
  }`;

  const data = await sanQuery(query);
  return data.getMetric.timeseriesData;
}

// Fetch aggregated metric value
async function fetchAggregated(metric, slug, days, aggregation = 'LAST') {
  const { from, to } = getDateRange(days);

  const query = `{
    getMetric(metric: "${metric}") {
      aggregatedTimeseriesData(
        slug: "${slug}"
        from: "${from}"
        to: "${to}"
        aggregation: ${aggregation}
      )
    }
  }`;

  const data = await sanQuery(query);
  return data.getMetric.aggregatedTimeseriesData;
}

// Batch fetch: latest values for all coins
async function fetchLatestForAllCoins(days) {
  const results = {};

  // Fetch each metric in parallel for all slugs
  const metrics = ['price_usd', 'marketcap_usd', 'volume_usd', 'social_volume_total', 'sentiment_balance_total', 'dev_activity'];

  const promises = metrics.map(async (metric) => {
    try {
      const data = await fetchMetricMulti(metric, ALL_SLUGS, days);
      return { metric, data, error: null };
    } catch (err) {
      console.warn(`Failed to fetch ${metric} multi:`, err.message);
      // Fallback: fetch individually
      const fallbackResults = {};
      for (const slug of ALL_SLUGS) {
        try {
          const val = await fetchAggregated(metric, slug, days, 'LAST');
          fallbackResults[slug] = val;
        } catch (e) {
          console.warn(`Failed to fetch ${metric} for ${slug}:`, e.message);
          fallbackResults[slug] = null;
        }
      }
      return { metric, data: null, fallback: fallbackResults, error: err };
    }
  });

  const settled = await Promise.all(promises);

  for (const result of settled) {
    results[result.metric] = result;
  }

  return results;
}

// Parse timeseries per-slug JSON into { slug: [{datetime, value}] }
function parsePerSlugData(rawData) {
  if (!rawData) return {};

  // Santiment returns data as { slug: { datetime: value, ... } } or array format
  // Handle various formats
  if (typeof rawData === 'object' && !Array.isArray(rawData)) {
    const parsed = {};
    for (const [slug, values] of Object.entries(rawData)) {
      if (Array.isArray(values)) {
        parsed[slug] = values;
      } else if (typeof values === 'object') {
        // Convert {datetime: value} to [{datetime, value}]
        parsed[slug] = Object.entries(values).map(([dt, v]) => ({
          datetime: dt,
          value: v,
        }));
      }
    }
    return parsed;
  }

  return rawData;
}

// Get the last value from a timeseries
function getLastValue(timeseries) {
  if (!timeseries || timeseries.length === 0) return null;
  return timeseries[timeseries.length - 1].value;
}
