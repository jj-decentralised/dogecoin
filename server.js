const express = require('express');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

const SAN_API = 'https://api.santiment.net/graphql';
const API_KEY = 'lslg6obns73tqqlb_fc5byjldbwd5lz6t';

// In-memory cache
const cache = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 min
const CACHE_TTL_LONG = 60 * 60 * 1000; // 1 hour for historical

function checkCache(key, ttl) {
  const c = cache[key];
  if (c && (Date.now() - c.ts) < ttl) return c.data;
  return null;
}

function setCache(key, data) {
  cache[key] = { data, ts: Date.now() };
}

// Helper: fetch a single metric+slug from Santiment
async function sanFetch(metric, slug, from, to, interval) {
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

  const resp = await fetch(SAN_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Apikey ${API_KEY}`,
    },
    body: JSON.stringify({ query }),
  });
  const data = await resp.json();
  if (data.data && data.data.getMetric && data.data.getMetric.timeseriesData) {
    return data.data.getMetric.timeseriesData;
  }
  return [];
}

// Run fetches in batches
async function batchFetch(tasks, batchSize = 10) {
  for (let i = 0; i < tasks.length; i += batchSize) {
    await Promise.all(tasks.slice(i, i + batchSize).map(t => t()));
  }
}

const MEME_SLUGS = ['shiba-inu', 'pepe', 'floki', 'bonk', 'dogwifhat', 'dogecoin'];

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── GET /api/all ───────────────────────────────────────
// All standard metrics for all meme coins
app.get('/api/all', async (req, res) => {
  const days = parseInt(req.query.days || '30', 10);
  const interval = req.query.interval || '1d';

  const ck = `all:${days}:${interval}`;
  const hit = checkCache(ck, CACHE_TTL);
  if (hit) return res.json(hit);

  const metrics = [
    'price_usd', 'marketcap_usd', 'volume_usd',
    'social_volume_total', 'sentiment_balance_total',
    'dev_activity', 'daily_active_addresses',
  ];

  const to = new Date().toISOString();
  const from = new Date(Date.now() - days * 86400000).toISOString();
  const allData = {};
  metrics.forEach(m => allData[m] = {});

  const tasks = [];
  for (const metric of metrics) {
    for (const slug of MEME_SLUGS) {
      tasks.push(async () => {
        try {
          allData[metric][slug] = await sanFetch(metric, slug, from, to, interval);
        } catch (e) {
          allData[metric][slug] = [];
        }
      });
    }
  }
  await batchFetch(tasks);

  setCache(ck, allData);
  res.json(allData);
});

// ─── GET /api/price-history ─────────────────────────────
// Full price history since 2017 for all meme coins + bitcoin
app.get('/api/price-history', async (req, res) => {
  const from = req.query.from || '2017-01-01T00:00:00Z';
  const interval = req.query.interval || '7d';

  const ck = `price-hist:${from}:${interval}`;
  const hit = checkCache(ck, CACHE_TTL_LONG);
  if (hit) return res.json(hit);

  const slugs = [...MEME_SLUGS, 'bitcoin'];
  const to = new Date().toISOString();
  const result = {};

  const tasks = slugs.map(slug => async () => {
    try {
      result[slug] = await sanFetch('price_usd', slug, from, to, interval);
    } catch (e) {
      console.warn(`price-history ${slug}:`, e.message);
      result[slug] = [];
    }
  });
  await batchFetch(tasks);

  setCache(ck, result);
  res.json(result);
});

// ─── GET /api/btc-correlation ───────────────────────────
// Price data for meme coins + BTC for correlation charting
app.get('/api/btc-correlation', async (req, res) => {
  const days = parseInt(req.query.days || '365', 10);
  const interval = req.query.interval || '1d';

  const ck = `btc-corr:${days}:${interval}`;
  const hit = checkCache(ck, CACHE_TTL_LONG);
  if (hit) return res.json(hit);

  const slugs = [...MEME_SLUGS, 'bitcoin'];
  const to = new Date().toISOString();
  const from = new Date(Date.now() - days * 86400000).toISOString();
  const result = {};

  const tasks = slugs.map(slug => async () => {
    try {
      result[slug] = await sanFetch('price_usd', slug, from, to, interval);
    } catch (e) {
      result[slug] = [];
    }
  });
  await batchFetch(tasks);

  setCache(ck, result);
  res.json(result);
});

// ─── GET /api/cohorts ───────────────────────────────────
// Holder distribution since Jan 2024, daily.
// Fetches 8 tiers + total per coin, then groups into 4 buckets:
//   Retail (<$1K), Mid ($1K-$10K), Large ($10K-$100K), Whales ($100K+)
// Returns:
//   raw: { tierLabel: { slug: [series] } }
//   grouped: { slug: { dates, retail[], mid[], large[], whales[], total[] } }
app.get('/api/cohorts', async (req, res) => {
  const ck = 'cohorts4:2024-01-01:1d';
  const hit = checkCache(ck, CACHE_TTL_LONG);
  if (hit) return res.json(hit);

  const tiers = [
    { metric: 'holders_distribution_1_to_10',      label: '$1 – $10',       group: 'retail' },
    { metric: 'holders_distribution_10_to_100',     label: '$10 – $100',     group: 'retail' },
    { metric: 'holders_distribution_100_to_1k',     label: '$100 – $1K',     group: 'retail' },
    { metric: 'holders_distribution_1k_to_10k',     label: '$1K – $10K',     group: 'mid' },
    { metric: 'holders_distribution_10k_to_100k',   label: '$10K – $100K',   group: 'large' },
    { metric: 'holders_distribution_100k_to_1M',    label: '$100K – $1M',    group: 'whales' },
    { metric: 'holders_distribution_1M_to_10M',     label: '$1M – $10M',     group: 'whales' },
    { metric: 'holders_distribution_10M_to_100M',   label: '$10M – $100M',   group: 'whales' },
  ];

  const to = new Date().toISOString();
  const from = '2024-01-01T00:00:00Z';
  const interval = '1d';

  // Raw: { tierLabel: { slug: [{datetime,value}] } }
  const raw = {};
  tiers.forEach(t => { raw[t.label] = {}; });
  raw['_total'] = {};

  const tasks = [];
  for (const tier of tiers) {
    for (const slug of MEME_SLUGS) {
      tasks.push(async () => {
        try {
          raw[tier.label][slug] = await sanFetch(tier.metric, slug, from, to, interval);
        } catch (e) {
          raw[tier.label][slug] = [];
        }
      });
    }
  }
  for (const slug of MEME_SLUGS) {
    tasks.push(async () => {
      try {
        raw['_total'][slug] = await sanFetch('holders_distribution_total', slug, from, to, interval);
      } catch (e) {
        raw['_total'][slug] = [];
      }
    });
  }

  await batchFetch(tasks, 6);

  // Group tiers into 4 buckets per slug, compute % of total
  const grouped = {};
  const groupNames = ['retail', 'mid', 'large', 'whales'];

  for (const slug of MEME_SLUGS) {
    // Build date-indexed maps for each group
    const groupMaps = { retail: {}, mid: {}, large: {}, whales: {} };
    const totalMap = {};

    // Sum tiers into groups
    for (const tier of tiers) {
      const series = raw[tier.label][slug] || [];
      for (const dp of series) {
        if (!groupMaps[tier.group][dp.datetime]) groupMaps[tier.group][dp.datetime] = 0;
        if (dp.value > 0) groupMaps[tier.group][dp.datetime] += dp.value;
      }
    }

    // Total holders
    const totalSeries = raw['_total'][slug] || [];
    for (const dp of totalSeries) {
      if (dp.value > 0) totalMap[dp.datetime] = dp.value;
    }

    // Get all dates from total series (canonical)
    const dates = totalSeries.filter(dp => dp.value > 0).map(dp => dp.datetime);
    if (dates.length === 0) continue;

    // Build percentage arrays
    const result = { dates: dates };
    for (const g of groupNames) {
      result[g] = dates.map(dt => {
        const count = groupMaps[g][dt] || 0;
        const total = totalMap[dt] || 1;
        return Math.round((count / total) * 10000) / 100; // % with 2 decimals
      });
      result[g + '_abs'] = dates.map(dt => groupMaps[g][dt] || 0);
    }
    result['total'] = dates.map(dt => totalMap[dt] || 0);

    grouped[slug] = result;
  }

  const output = { raw, grouped };
  setCache(ck, output);
  res.json(output);
});

// Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
