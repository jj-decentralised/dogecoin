// Frontend API Layer — calls server proxy (no CORS issues)

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

const BTC = { slug: 'bitcoin', ticker: 'BTC', name: 'Bitcoin', color: '#f7931a' };

const ALL_COINS = Object.values(COINS).flat();
const ALL_SLUGS = ALL_COINS.map(c => c.slug);

function getCoinBySlug(slug) {
  if (slug === 'bitcoin') return BTC;
  return ALL_COINS.find(c => c.slug === slug);
}

function getNetworkForSlug(slug) {
  if (slug === 'bitcoin') return 'reference';
  for (const [network, coins] of Object.entries(COINS)) {
    if (coins.some(c => c.slug === slug)) return network;
  }
  return 'unknown';
}

async function fetchAllData(days) {
  const resp = await fetch(`/api/all?days=${days}`);
  if (!resp.ok) throw new Error(`Server error ${resp.status}`);
  return resp.json();
}

async function fetchPriceHistory() {
  const resp = await fetch('/api/price-history?from=2017-01-01T00:00:00Z&interval=7d');
  if (!resp.ok) throw new Error(`Server error ${resp.status}`);
  return resp.json();
}

async function fetchBtcCorrelation(days) {
  const resp = await fetch(`/api/btc-correlation?days=${days}&interval=1d`);
  if (!resp.ok) throw new Error(`Server error ${resp.status}`);
  return resp.json();
}

async function fetchCohorts() {
  const resp = await fetch('/api/cohorts');
  if (!resp.ok) throw new Error(`Server error ${resp.status}`);
  return resp.json();
}
