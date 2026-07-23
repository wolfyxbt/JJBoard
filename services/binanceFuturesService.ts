
import { BinanceTickerWS, BinanceMarkPriceWS, TickerData, BinanceStreamMessage } from '../types';

// USDT-M futures has no public data-only mirror (unlike spot's binance.vision),
// and fapi geo-blocks some regions (HTTP 451, e.g. US) — those visitors fall
// back to the /api/perp serverless proxy pinned to an allowed region.
const FAPI_BASE = 'https://fapi.binance.com';
const PROXY_PATH = '/api/perp';

// Combined stream: all-market 24h tickers + all-market mark price / funding rate
const STREAMS = '?streams=!ticker@arr/!markPrice@arr';
const BASE_WS_URLS = [
  `wss://fstream.binance.com/stream${STREAMS}`,
];

// Re-fetch a symbol's open interest once it is older than this.
// Must be comfortably larger than (symbol count x fetch cadence) or the
// refresh loop can never complete a full pass over ~500 perpetuals.
const OI_STALE_MS = 5 * 60 * 1000;
// REST polling cadence when the WebSocket cannot connect (geo-blocked regions)
const POLL_INTERVAL_MS = 15000;

// Binance sends numeric values as strings; funding fields can be "" for
// non-funding symbols, so guard against NaN everywhere.
const toNum = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
};

// Networks that block binance.com domains often make connections HANG rather
// than fail fast — without a timeout the proxy fallback would never run.
const fetchWithTimeout = (url: string, timeoutMs = 8000): Promise<Response> => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(id));
};

type DataSource = 'direct' | 'proxy';

export class BinanceFuturesService {
  private ws: WebSocket | null = null;
  private subscribers: ((data: Map<string, TickerData>) => void)[] = [];
  private statusSubscribers: ((status: string) => void)[] = [];
  private tickerMap: Map<string, TickerData> = new Map();
  private reconnectAttempt = 0;
  private maxReconnectDelay = 10000;
  private reconnectTimeoutId: any = null;
  private endpointIndex = 0;
  private started = false;

  private dataSource: DataSource = 'direct';
  private wsEverOpened = false;
  private pollIntervalId: any = null;
  private snapshotPromise: Promise<void> | null = null;
  private wsConnectTimeoutId: any = null;

  // Symbols confirmed as TRADING PERPETUAL contracts via exchangeInfo.
  // Empty set means exchangeInfo failed — fall back to heuristic filtering.
  private perpSymbols: Set<string> = new Set();

  private oiFetchedAt: Map<string, number> = new Map();
  private oiFetchInFlight = false;

  public connect() {
    if (this.started) return;
    this.started = true;
    this.fetchSnapshot();
    this.connectWebSocket();
  }

  public isStarted() {
    return this.started;
  }

  // Delivery contracts look like BTCUSDT_240628 — exclude them when
  // exchangeInfo could not tell us the real perpetual list.
  private isPerpSymbol(symbol: string) {
    if (this.perpSymbols.size > 0) return this.perpSymbols.has(symbol);
    return !symbol.includes('_');
  }

  // Once exchangeInfo tells us the authoritative perpetual list, drop rows
  // that slipped in via the underscore heuristic (settling/delisted contracts).
  private pruneNonPerps() {
    if (this.perpSymbols.size === 0) return;
    Array.from(this.tickerMap.keys()).forEach((symbol) => {
      if (!this.perpSymbols.has(symbol)) this.tickerMap.delete(symbol);
    });
  }

  private applyTicker(item: any) {
    if (!this.isPerpSymbol(item.symbol)) return;
    const price = toNum(item.lastPrice);
    if (price === undefined) return;
    const existing = this.tickerMap.get(item.symbol);
    this.tickerMap.set(item.symbol, {
      ...existing,
      symbol: item.symbol,
      price,
      volume: toNum(item.quoteVolume) ?? 0,
      changePercent24h: toNum(item.priceChangePercent) ?? 0,
    });
  }

  private applyPremium(item: any) {
    const existing = this.tickerMap.get(item.symbol);
    if (!existing) return; // Only enrich symbols already accepted as perps
    existing.markPrice = toNum(item.markPrice);
    existing.indexPrice = toNum(item.indexPrice);
    existing.fundingRate = toNum(item.lastFundingRate);
    const nextFunding = toNum(item.nextFundingTime);
    existing.nextFundingTime = nextFunding && nextFunding > 0 ? nextFunding : undefined;
    this.tickerMap.set(item.symbol, existing);
  }

  private async fetchSnapshotDirect(): Promise<boolean> {
    const [tickerRes, exchangeInfoRes, premiumRes] = await Promise.all([
      fetchWithTimeout(`${FAPI_BASE}/fapi/v1/ticker/24hr`),
      fetchWithTimeout(`${FAPI_BASE}/fapi/v1/exchangeInfo`),
      fetchWithTimeout(`${FAPI_BASE}/fapi/v1/premiumIndex`),
    ]);

    if (exchangeInfoRes.ok) {
      const exchangeInfo = await exchangeInfoRes.json();
      if (Array.isArray(exchangeInfo.symbols)) {
        this.perpSymbols = new Set(
          exchangeInfo.symbols
            .filter((s: any) => s.status === 'TRADING' && s.contractType === 'PERPETUAL')
            .map((s: any) => s.symbol as string)
        );
        this.pruneNonPerps();
      }
    }

    if (!tickerRes.ok) return false;
    const tickerData = await tickerRes.json();
    if (!Array.isArray(tickerData)) return false;
    tickerData.forEach((item: any) => {
      if (Number(item.count) === 0) return;
      this.applyTicker(item);
    });

    if (premiumRes.ok) {
      const premiumData = await premiumRes.json();
      const entries = Array.isArray(premiumData) ? premiumData : [premiumData];
      entries.forEach((item: any) => this.applyPremium(item));
    }

    return this.tickerMap.size > 0;
  }

  private async fetchSnapshotProxy(): Promise<boolean> {
    const res = await fetchWithTimeout(PROXY_PATH, 12000);
    if (!res.ok) return false;
    const contentType = res.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) return false;
    const json = await res.json();
    if (!Array.isArray(json.tickers)) return false;

    if (Array.isArray(json.perpSymbols) && json.perpSymbols.length > 0) {
      this.perpSymbols = new Set(json.perpSymbols as string[]);
      this.pruneNonPerps();
    }
    json.tickers.forEach((item: any) => {
      if (Number(item.count) === 0) return;
      this.applyTicker(item);
    });
    if (Array.isArray(json.premium)) {
      json.premium.forEach((item: any) => this.applyPremium(item));
    }

    return this.tickerMap.size > 0;
  }

  private fetchSnapshot(): Promise<void> {
    // Dedupe concurrent calls (StrictMode double-mount, reconnect + poll overlap)
    if (this.snapshotPromise) return this.snapshotPromise;
    this.snapshotPromise = this.doFetchSnapshot().finally(() => {
      this.snapshotPromise = null;
    });
    return this.snapshotPromise;
  }

  private async doFetchSnapshot() {
    try {
      if (this.dataSource === 'direct') {
        try {
          if (await this.fetchSnapshotDirect()) {
            this.emitStatus();
            this.notify();
            return;
          }
        } catch (e) {
          console.warn('[Perp] Direct snapshot failed (possibly geo-blocked), trying proxy...', e);
        }
        if (await this.fetchSnapshotProxy()) {
          this.dataSource = 'proxy';
          console.log('[Perp] Using serverless proxy for futures data');
          // If direct REST is blocked, the WebSocket almost certainly is too —
          // keep data fresh via polling now instead of waiting for WS failures.
          this.startPollingFallback();
          this.emitStatus();
          this.notify();
          return;
        }
      } else {
        if (await this.fetchSnapshotProxy()) {
          this.emitStatus();
          this.notify();
          return;
        }
      }
      console.warn('[Perp] All snapshot sources failed, waiting for WebSocket data...');
      if (this.tickerMap.size === 0 && !this.wsEverOpened) {
        this.statusSubscribers.forEach((cb) => cb('unavailable'));
      }
      this.notify();
    } catch (e) {
      console.warn('[Perp] Snapshot fetch failed', e);
      this.notify();
    }
  }

  // Called on an interval by the UI with the current display order.
  // Never-fetched symbols win over stale refreshes, and stale refreshes pick
  // the OLDEST entry — otherwise the head of the list re-stales before a full
  // pass completes and tail symbols would never receive open interest.
  public async fetchNextOpenInterest(sortedSymbols: string[]) {
    if (this.oiFetchInFlight) return;
    const now = Date.now();
    let target = sortedSymbols.find(
      (symbol) => this.tickerMap.has(symbol) && !this.oiFetchedAt.has(symbol)
    );
    if (!target) {
      let oldest = Infinity;
      sortedSymbols.forEach((symbol) => {
        if (!this.tickerMap.has(symbol)) return;
        const fetchedAt = this.oiFetchedAt.get(symbol);
        if (fetchedAt !== undefined && now - fetchedAt > OI_STALE_MS && fetchedAt < oldest) {
          oldest = fetchedAt;
          target = symbol;
        }
      });
    }
    if (!target) return;

    this.oiFetchInFlight = true;
    try {
      const url = this.dataSource === 'proxy'
        ? `${PROXY_PATH}?symbol=${target}`
        : `${FAPI_BASE}/fapi/v1/openInterest?symbol=${target}`;
      const res = await fetchWithTimeout(url);
      // Record the attempt even on failure so one bad symbol can't stall the queue
      this.oiFetchedAt.set(target, Date.now());
      if (!res.ok) return;
      const json = await res.json();
      const item = this.tickerMap.get(target);
      const oi = toNum(json.openInterest);
      if (item && oi !== undefined) {
        item.openInterest = oi;
        const refPrice = item.markPrice ?? item.price;
        item.openInterestValue = refPrice ? oi * refPrice : undefined;
        this.tickerMap.set(target, item);
        this.notify();
      }
    } catch (e) {
      this.oiFetchedAt.set(target, Date.now());
    } finally {
      this.oiFetchInFlight = false;
    }
  }

  // When the WebSocket handshake keeps failing (geo-blocked visitors see
  // opaque connection errors), keep the table alive with REST polling.
  private startPollingFallback() {
    if (this.pollIntervalId) return;
    console.log('[Perp] WebSocket unavailable — starting REST polling fallback');
    this.pollIntervalId = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.stopPollingFallback();
        return;
      }
      this.fetchSnapshot();
    }, POLL_INTERVAL_MS);
  }

  private stopPollingFallback() {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
  }

  private connectWebSocket() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }

    const url = BASE_WS_URLS[this.endpointIndex];
    this.emitStatus();
    console.log(`[Perp] WebSocket connecting to: ${url}`);

    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      console.error('[Perp] Failed to construct WebSocket', e);
      this.scheduleReconnect();
      return;
    }

    // Blocked networks can leave the handshake hanging in CONNECTING forever —
    // force a close so the reconnect/polling logic keeps moving.
    if (this.wsConnectTimeoutId) clearTimeout(this.wsConnectTimeoutId);
    this.wsConnectTimeoutId = setTimeout(() => {
      if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
        console.log('[Perp] WebSocket handshake timed out');
        this.ws.close();
      }
    }, 10000);

    this.ws.onopen = () => {
      console.log('[Perp] WebSocket connected');
      if (this.wsConnectTimeoutId) {
        clearTimeout(this.wsConnectTimeoutId);
        this.wsConnectTimeoutId = null;
      }
      const isReconnect = this.wsEverOpened;
      this.reconnectAttempt = 0;
      this.wsEverOpened = true;
      this.stopPollingFallback();
      // After downtime (incl. the 24h forced disconnect), refresh the
      // snapshot so the symbol list and prices catch up on missed changes.
      if (isReconnect) this.fetchSnapshot();
      this.emitStatus();
    };

    this.ws.onmessage = (event) => {
      try {
        const message: BinanceStreamMessage = JSON.parse(event.data);
        if (!message.data) return;
        const rawData = Array.isArray(message.data) ? message.data : [message.data];

        if (message.stream === '!markPrice@arr') {
          (rawData as unknown as BinanceMarkPriceWS[]).forEach((item) => {
            if (!this.isPerpSymbol(item.s)) return;
            const existing = this.tickerMap.get(item.s);
            if (!existing) return; // Wait for a ticker event to create the row
            existing.markPrice = toNum(item.p);
            existing.indexPrice = toNum(item.i);
            existing.fundingRate = toNum(item.r);
            const nextFunding = toNum(item.T);
            existing.nextFundingTime = nextFunding && nextFunding > 0 ? nextFunding : undefined;
            if (existing.openInterest !== undefined && existing.markPrice) {
              existing.openInterestValue = existing.openInterest * existing.markPrice;
            }
            this.tickerMap.set(item.s, existing);
          });
        } else {
          (rawData as BinanceTickerWS[]).forEach((item) => {
            if (!this.isPerpSymbol(item.s)) return;
            const existing = this.tickerMap.get(item.s) || {
              symbol: item.s,
              price: 0,
              volume: 0,
              changePercent24h: 0,
            };
            existing.price = toNum(item.c) ?? existing.price;
            existing.volume = toNum(item.q) ?? existing.volume;
            existing.changePercent24h = toNum(item.P) ?? existing.changePercent24h;
            this.tickerMap.set(item.s, existing);
          });
        }

        this.notify();
      } catch (error) {
        console.error('[Perp] Error parsing WebSocket message', error);
      }
    };

    this.ws.onclose = (event) => {
      console.log(`[Perp] WebSocket closed (code: ${event.code})`);
      if (this.wsConnectTimeoutId) {
        clearTimeout(this.wsConnectTimeoutId);
        this.wsConnectTimeoutId = null;
      }
      this.ws = null;
      this.emitStatus();
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      console.log('[Perp] WebSocket error');
      if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
        this.ws.close();
      }
    };
  }

  public subscribe(callback: (data: Map<string, TickerData>) => void) {
    this.subscribers.push(callback);
    if (this.tickerMap.size > 0) {
      callback(new Map(this.tickerMap));
    }
    return () => {
      this.subscribers = this.subscribers.filter((cb) => cb !== callback);
    };
  }

  public subscribeStatus(callback: (status: string) => void) {
    this.statusSubscribers.push(callback);
    this.emitStatus(callback);
    return () => {
      this.statusSubscribers = this.statusSubscribers.filter((cb) => cb !== callback);
    };
  }

  private notify() {
    const snapshot = new Map(this.tickerMap);
    this.subscribers.forEach((cb) => cb(snapshot));
  }

  private emitStatus(specificCallback?: (status: string) => void) {
    const fullUrl = BASE_WS_URLS[this.endpointIndex];
    let displayUrl = fullUrl;
    try {
      displayUrl = new URL(fullUrl).origin;
    } catch (e) {
      displayUrl = fullUrl.split('?')[0];
    }
    if (this.dataSource === 'proxy') {
      displayUrl = this.pollIntervalId
        ? `${PROXY_PATH} (serverless proxy, polling)`
        : `${PROXY_PATH} (serverless proxy)`;
    }
    const targets = specificCallback ? [specificCallback] : this.statusSubscribers;
    targets.forEach((cb) => cb(displayUrl));
  }

  private scheduleReconnect() {
    this.endpointIndex = (this.endpointIndex + 1) % BASE_WS_URLS.length;
    this.emitStatus();
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempt), this.maxReconnectDelay);
    this.reconnectAttempt++;
    // After a couple of failed handshakes (initial geo-block OR a mid-session
    // permanent loss), keep data flowing via REST polling until a socket opens.
    if (this.reconnectAttempt >= 2) {
      this.startPollingFallback();
    }
    if (this.reconnectTimeoutId) clearTimeout(this.reconnectTimeoutId);
    console.log(`[Perp] Reconnecting in ${delay}ms`);
    this.reconnectTimeoutId = setTimeout(() => {
      this.connectWebSocket();
    }, delay);
  }

  public disconnect() {
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
    if (this.wsConnectTimeoutId) {
      clearTimeout(this.wsConnectTimeoutId);
      this.wsConnectTimeoutId = null;
    }
    this.stopPollingFallback();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
    this.started = false;
  }
}

export const binanceFuturesService = new BinanceFuturesService();
