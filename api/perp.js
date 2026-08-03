
// Server-side fallback for USDT-M futures market data.
// fapi.binance.com geo-blocks some visitor regions (e.g. US) with HTTP 451,
// and futures has no binance.vision-style open mirror — so blocked browsers
// fall back to this function (pinned to an allowed region via vercel.json).
const FAPI_BASE = 'https://fapi.binance.com';

const fetchJson = async (url, timeout = 8000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return await res.json();
  } finally {
    clearTimeout(id);
  }
};

export default async function handler(request, response) {
  const symbol = request.query && request.query.symbol;

  try {
    // Per-symbol open interest proxy: /api/perp?symbol=BTCUSDT
    if (symbol) {
      if (!/^[A-Z0-9_]{1,30}$/.test(symbol)) {
        return response.status(400).json({ error: 'Invalid symbol' });
      }
      const json = await fetchJson(`${FAPI_BASE}/fapi/v1/openInterest?symbol=${symbol}`);
      // Matches the client's 3-minute staleness window
      response.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=120');
      return response.status(200).json(json);
    }

    // Full snapshot: tickers + perpetual symbol list + mark/funding data.
    // Payloads are trimmed to the fields the client actually uses.
    const [tickers, exchangeInfo, premium] = await Promise.all([
      fetchJson(`${FAPI_BASE}/fapi/v1/ticker/24hr`),
      fetchJson(`${FAPI_BASE}/fapi/v1/exchangeInfo`),
      fetchJson(`${FAPI_BASE}/fapi/v1/premiumIndex`),
    ]);

    const perpSymbols = Array.isArray(exchangeInfo.symbols)
      ? exchangeInfo.symbols
          .filter((s) => s.status === 'TRADING' && s.contractType === 'PERPETUAL')
          .map((s) => s.symbol)
      : [];

    const body = {
      perpSymbols,
      tickers: (Array.isArray(tickers) ? tickers : []).map((t) => ({
        symbol: t.symbol,
        lastPrice: t.lastPrice,
        quoteVolume: t.quoteVolume,
        priceChangePercent: t.priceChangePercent,
        count: t.count,
      })),
      premium: (Array.isArray(premium) ? premium : []).map((p) => ({
        symbol: p.symbol,
        markPrice: p.markPrice,
        indexPrice: p.indexPrice,
        lastFundingRate: p.lastFundingRate,
        nextFundingTime: p.nextFundingTime,
      })),
    };

    response.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30');
    return response.status(200).json(body);
  } catch (error) {
    console.error('Perp proxy failed:', error.message);
    return response.status(502).json({ error: 'Failed to fetch futures data', message: error.message });
  }
}
