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

const ALL_COINS = Object.values(COINS).flat();
const ALL_SLUGS = ALL_COINS.map(c => c.slug);

const ALL_METRICS = [
  'price_usd',
  'marketcap_usd',
  'volume_usd',
  'social_volume_total',
  'sentiment_balance_total',
  'dev_activity',
  'daily_active_addresses',
];

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

// Fetch a single metric for a single slug — returns [{datetime, value}]
async function fetchMetric(metric, slug, days, interval = '1d') {
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
  return data.getMetric.timeseriesData || [];
}

// Fetch one metric for ALL coins in parallel
// Returns { slug: [{datetime, value}] }
async function fetchMetricForAll(metric, days) {
  const results = {};
  const promises = ALL_SLUGS.map(async (slug) => {
    try {
      const series = await fetchMetric(metric, slug, days);
      results[slug] = series;
    } catch (err) {
      console.warn(`Failed ${metric} for ${slug}:`, err.message);
      results[slug] = [];
    }
  });
  await Promise.all(promises);
  return results;
}

// Fetch ALL metrics for ALL coins
// Returns { metricName: { slug: [{datetime, value}] } }
async function fetchAllData(days) {
  const data = {};
  const promises = ALL_METRICS.map(async (metric) => {
    try {
      data[metric] = await fetchMetricForAll(metric, days);
    } catch (err) {
      console.warn(`Failed to fetch metric ${metric}:`, err.message);
      data[metric] = {};
    }
  });
  await Promise.all(promises);
  return data;
}
