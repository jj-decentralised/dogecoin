const express = require('express');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

const SAN_API = 'https://api.santiment.net/graphql';
const API_KEY = 'lslg6obns73tqqlb_fc5byjldbwd5lz6t';

// Simple in-memory cache: key -> { data, timestamp }
const cache = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Proxy endpoint for Santiment GraphQL
app.post('/api/santiment', async (req, res) => {
  const { query } = req.body;
  if (!query) {
    return res.status(400).json({ error: 'Missing query' });
  }

  // Check cache
  const cacheKey = query;
  const cached = cache[cacheKey];
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return res.json(cached.data);
  }

  try {
    const resp = await fetch(SAN_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Apikey ${API_KEY}`,
      },
      body: JSON.stringify({ query }),
    });

    const data = await resp.json();

    // Cache successful responses
    if (!data.errors) {
      cache[cacheKey] = { data, timestamp: Date.now() };
    }

    res.json(data);
  } catch (err) {
    console.error('Santiment proxy error:', err.message);
    res.status(502).json({ error: 'Failed to reach Santiment API', detail: err.message });
  }
});

// Pre-fetch endpoint: fetches one metric for all coins in a single round
app.get('/api/metric/:metric', async (req, res) => {
  const { metric } = req.params;
  const days = parseInt(req.query.days || '30', 10);
  const interval = req.query.interval || '1d';

  const slugs = [
    'shiba-inu', 'pepe', 'floki',
    'bonk', 'dogwifhat',
    'dogecoin',
  ];

  const to = new Date().toISOString();
  const from = new Date(Date.now() - days * 86400000).toISOString();

  // Check cache
  const cacheKey = `${metric}:${days}:${interval}`;
  const cached = cache[cacheKey];
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return res.json(cached.data);
  }

  // Fetch each slug in parallel
  const results = {};
  const promises = slugs.map(async (slug) => {
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

    try {
      const resp = await fetch(SAN_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Apikey ${API_KEY}`,
        },
        body: JSON.stringify({ query }),
      });
      const data = await resp.json();
      if (data.data && data.data.getMetric) {
        results[slug] = data.data.getMetric.timeseriesData || [];
      } else {
        console.warn(`No data for ${metric}/${slug}:`, data.errors?.[0]?.message);
        results[slug] = [];
      }
    } catch (err) {
      console.warn(`Error fetching ${metric}/${slug}:`, err.message);
      results[slug] = [];
    }
  });

  await Promise.all(promises);

  // Cache it
  cache[cacheKey] = { data: results, timestamp: Date.now() };
  res.json(results);
});

// Pre-fetch ALL metrics at once
app.get('/api/all', async (req, res) => {
  const days = parseInt(req.query.days || '30', 10);
  const interval = req.query.interval || '1d';

  const cacheKey = `all:${days}:${interval}`;
  const cached = cache[cacheKey];
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return res.json(cached.data);
  }

  const metrics = [
    'price_usd',
    'marketcap_usd',
    'volume_usd',
    'social_volume_total',
    'sentiment_balance_total',
    'dev_activity',
    'daily_active_addresses',
  ];

  const slugs = [
    'shiba-inu', 'pepe', 'floki',
    'bonk', 'dogwifhat',
    'dogecoin',
  ];

  const to = new Date().toISOString();
  const from = new Date(Date.now() - days * 86400000).toISOString();

  const allData = {};

  // Fetch all metric+slug combos in parallel
  const tasks = [];
  for (const metric of metrics) {
    allData[metric] = {};
    for (const slug of slugs) {
      tasks.push({ metric, slug });
    }
  }

  // Batch in groups of 10 to avoid overwhelming the API
  const BATCH_SIZE = 10;
  for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
    const batch = tasks.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async ({ metric, slug }) => {
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

      try {
        const resp = await fetch(SAN_API, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Apikey ${API_KEY}`,
          },
          body: JSON.stringify({ query }),
        });
        const data = await resp.json();
        if (data.data && data.data.getMetric) {
          allData[metric][slug] = data.data.getMetric.timeseriesData || [];
        } else {
          allData[metric][slug] = [];
        }
      } catch (err) {
        console.warn(`Error ${metric}/${slug}:`, err.message);
        allData[metric][slug] = [];
      }
    }));
  }

  cache[cacheKey] = { data: allData, timestamp: Date.now() };
  res.json(allData);
});

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
