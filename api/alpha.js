
// Server-side proxy for the Binance Alpha token list.
// The BAPI endpoint has no CORS headers, so browsers cannot call it directly;
// public CORS proxies (corsproxy.io / allorigins) are now blocked by Binance's WAF.
const ALPHA_PATH = '/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list';
const HOSTS = ['https://www.binance.com', 'https://www.binance.info'];

export default async function handler(request, response) {
  const errors = [];

  for (const host of HOSTS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${host}${ALPHA_PATH}`, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        errors.push(`${host}: HTTP ${res.status}`);
        continue;
      }

      const json = await res.json();
      if (json && json.code === '000000' && Array.isArray(json.data)) {
        // Frontend polls every 10s; let Vercel's edge cache absorb most of that.
        response.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30');
        return response.status(200).json(json);
      }
      errors.push(`${host}: unexpected body (code=${json && json.code})`);
    } catch (e) {
      clearTimeout(timeoutId);
      errors.push(`${host}: ${e.message}`);
    }
  }

  console.error('Alpha proxy failed:', errors.join(' | '));
  return response.status(502).json({ error: 'Failed to fetch Alpha token list', details: errors });
}
