
import { BinanceTickerWS, BinanceMarkPriceWS, TickerData, BinanceStreamMessage } from '../types';

// USDT-M futures has no public data-only mirror (unlike spot's binance.vision)
const FAPI_BASE = 'https://fapi.binance.com';

// Combined stream: all-market 24h tickers + all-market mark price / funding rate
const STREAMS = '?streams=!ticker@arr/!markPrice@arr';
const BASE_WS_URLS = [
  `wss://fstream.binance.com/stream${STREAMS}`,
];

// Re-fetch a symbol's open interest once it is older than this
const OI_STALE_MS = 3 * 60 * 1000;

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

  // Symbols confirmed as TRADING PERPETUAL contracts via exchangeInfo.
  // Empty set means exchangeInfo failed — fall back to heuristic filtering.
  private perpSymbols: Set<string> = new Set();

  private oiFetchedAt: Map<string, number> = new Map();
  private oiFetchInFlight = false;

  public connect() {
    if (this.started) return;
    this.started = true;
    this.fetchInitialSnapshot();
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

  private async fetchInitialSnapshot() {
    console.log('[Perp] Starting snapshot fetch...');
    try {
      const [tickerRes, exchangeInfoRes, premiumRes] = await Promise.all([
        fetch(`${FAPI_BASE}/fapi/v1/ticker/24hr`),
        fetch(`${FAPI_BASE}/fapi/v1/exchangeInfo`),
        fetch(`${FAPI_BASE}/fapi/v1/premiumIndex`),
      ]);

      if (exchangeInfoRes.ok) {
        const exchangeInfo = await exchangeInfoRes.json();
        if (Array.isArray(exchangeInfo.symbols)) {
          exchangeInfo.symbols.forEach((s: any) => {
            if (s.status === 'TRADING' && s.contractType === 'PERPETUAL') {
              this.perpSymbols.add(s.symbol);
            }
          });
        }
      }

      if (tickerRes.ok) {
        const tickerData = await tickerRes.json();
        if (Array.isArray(tickerData)) {
          tickerData.forEach((item: any) => {
            if (!this.isPerpSymbol(item.symbol)) return;
            if (Number(item.count) === 0) return;
            const existing = this.tickerMap.get(item.symbol);
            this.tickerMap.set(item.symbol, {
              ...existing,
              symbol: item.symbol,
              price: parseFloat(item.lastPrice),
              volume: parseFloat(item.quoteVolume),
              changePercent24h: parseFloat(item.priceChangePercent),
            });
          });
        }
      }

      if (premiumRes.ok) {
        const premiumData = await premiumRes.json();
        const entries = Array.isArray(premiumData) ? premiumData : [premiumData];
        entries.forEach((item: any) => {
          const existing = this.tickerMap.get(item.symbol);
          if (!existing) return; // Only enrich symbols already accepted as perps
          existing.markPrice = parseFloat(item.markPrice);
          existing.indexPrice = parseFloat(item.indexPrice);
          existing.fundingRate = parseFloat(item.lastFundingRate);
          existing.nextFundingTime = Number(item.nextFundingTime) || undefined;
          this.tickerMap.set(item.symbol, existing);
        });
      }

      console.log(`[Perp] Snapshot loaded ${this.tickerMap.size} perpetual contracts`);
      this.notify();
    } catch (e) {
      console.warn('[Perp] Snapshot fetch failed, waiting for WebSocket data...', e);
      // WebSocket !ticker@arr will still populate the table over time
      this.notify();
    }
  }

  // Called on an interval by the UI with the current display order.
  // Picks the first symbol whose open interest is missing or stale.
  public async fetchNextOpenInterest(sortedSymbols: string[]) {
    if (this.oiFetchInFlight) return;
    const now = Date.now();
    const target = sortedSymbols.find((symbol) => {
      if (!this.tickerMap.has(symbol)) return false;
      const fetchedAt = this.oiFetchedAt.get(symbol);
      return fetchedAt === undefined || now - fetchedAt > OI_STALE_MS;
    });
    if (!target) return;

    this.oiFetchInFlight = true;
    try {
      const res = await fetch(`${FAPI_BASE}/fapi/v1/openInterest?symbol=${target}`);
      // Record the attempt even on failure so one bad symbol can't stall the queue
      this.oiFetchedAt.set(target, Date.now());
      if (!res.ok) return;
      const json = await res.json();
      const item = this.tickerMap.get(target);
      const oi = parseFloat(json.openInterest);
      if (item && Number.isFinite(oi)) {
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

    this.ws.onopen = () => {
      console.log('[Perp] WebSocket connected');
      this.reconnectAttempt = 0;
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
            existing.markPrice = parseFloat(item.p);
            existing.indexPrice = parseFloat(item.i);
            existing.fundingRate = parseFloat(item.r);
            existing.nextFundingTime = item.T || undefined;
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
            existing.price = parseFloat(item.c);
            existing.volume = parseFloat(item.q);
            existing.changePercent24h = parseFloat(item.P);
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
    const targets = specificCallback ? [specificCallback] : this.statusSubscribers;
    targets.forEach((cb) => cb(displayUrl));
  }

  private scheduleReconnect() {
    this.endpointIndex = (this.endpointIndex + 1) % BASE_WS_URLS.length;
    this.emitStatus();
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempt), this.maxReconnectDelay);
    this.reconnectAttempt++;
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
