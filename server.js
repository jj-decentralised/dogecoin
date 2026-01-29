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
// Holder distribution cohorts for each meme coin
// Returns { slug: { cohortLabel: [{datetime, value}] } }
app.get('/api/cohorts', async (req, res) => {
  const days = parseInt(req.query.days || '90', 10);
  const interval = req.query.interval || '1d';

  const ck = `cohorts:${days}:${interval}`;
  const hit = checkCache(ck, CACHE_TTL_LONG);
  if (hit) return res.json(hit);

  // Cohort buckets: metric suffix -> display label
  const cohorts = [
    { metric: 'holders_distribution_0_to_0.001',           label: '$0 - $0.001' },
    { metric: 'holders_distribution_0.001_to_0.01',        label: '$0.001 - $0.01' },
    { metric: 'holders_distribution_0.01_to_0.1',          label: '$0.01 - $0.1' },
    { metric: 'holders_distribution_0.1_to_1',             label: '$0.1 - $1' },
    { metric: 'holders_distribution_1_to_10',              label: '$1 - $10' },
    { metric: 'holders_distribution_10_to_100',            label: '$10 - $100' },
    { metric: 'holders_distribution_100_to_1k',            label: '$100 - $1K' },
    { metric: 'holders_distribution_1k_to_10k',            label: '$1K - $10K' },
    { metric: 'holders_distribution_10k_to_100k',          label: '$10K - $100K' },
    { metric: 'holders_distribution_100k_to_1M',           label: '$100K - $1M' },
    { metric: 'holders_distribution_1M_to_10M',            label: '$1M - $10M' },
    { metric: 'holders_distribution_10M_to_100M',          label: '$10M - $100M' },
    { metric: 'holders_distribution_100M_to_1B',           label: '$100M - $1B' },
    { metric: 'holders_distribution_1B_to_inf',            label: '$1B+' },
  ];

  // Also fetch combined_balance (total USD held per cohort)
  const balanceCohorts = [
    { metric: 'holders_distribution_combined_balance_0.001_to_0.01', label: '$0.001 - $0.01' },
    { metric: 'holders_distribution_combined_balance_0.01_to_0.1',   label: '$0.01 - $0.1' },
    { metric: 'holders_distribution_combined_balance_0.1_to_1',      label: '$0.1 - $1' },
    { metric: 'holders_distribution_combined_balance_1_to_10',       label: '$1 - $10' },
    { metric: 'holders_distribution_combined_balance_10_to_100',     label: '$10 - $100' },
    { metric: 'holders_distribution_combined_balance_100_to_1k',     label: '$100 - $1K' },
    { metric: 'holders_distribution_combined_balance_1k_to_10k',     label: '$1K - $10K' },
    { metric: 'holders_distribution_combined_balance_10k_to_100k',   label: '$10K - $100K' },
    { metric: 'holders_distribution_combined_balance_100k_to_1M',    label: '$100K - $1M' },
    { metric: 'holders_distribution_combined_balance_1M_to_10M',     label: '$1M - $10M' },
    { metric: 'holders_distribution_combined_balance_10M_to_100M',   label: '$10M - $100M' },
    { metric: 'holders_distribution_combined_balance_100M_to_1B',    label: '$100M - $1B' },
    { metric: 'holders_distribution_combined_balance_1B_to_inf',     label: '$1B+' },
  ];

  const to = new Date().toISOString();
  const from = new Date(Date.now() - days * 86400000).toISOString();

  const result = { holders: {}, balances: {} };
  MEME_SLUGS.forEach(s => { result.holders[s] = {}; result.balances[s] = {}; });

  // Fetch holder counts
  const tasks = [];
  for (const slug of MEME_SLUGS) {
    for (const c of cohorts) {
      tasks.push(async () => {
        try {
          result.holders[slug][c.label] = await sanFetch(c.metric, slug, from, to, interval);
        } catch (e) {
          result.holders[slug][c.label] = [];
        }
      });
    }
    for (const c of balanceCohorts) {
      tasks.push(async () => {
        try {
          result.balances[slug][c.label] = await sanFetch(c.metric, slug, from, to, interval);
        } catch (e) {
          result.balances[slug][c.label] = [];
        }
      });
    }
  }

  // Also fetch holders_distribution_total
  for (const slug of MEME_SLUGS) {
    tasks.push(async () => {
      try {
        result.holders[slug]['_total'] = await sanFetch('holders_distribution_total', slug, from, to, interval);
      } catch (e) {
        result.holders[slug]['_total'] = [];
      }
    });
  }

  await batchFetch(tasks, 8);

  setCache(ck, result);
  res.json(result);
});

// Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
