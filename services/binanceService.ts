
import { BinanceTickerWS, TickerData, BinanceStreamMessage } from '../types';

// Comprehensive list of known Quote Assets on Binance (Priority order for detection)
export const KNOWN_QUOTE_ASSETS = [
  // Stablecoins
  'USDT', 'FDUSD', 'USDC', 'TUSD', 'BUSD', 'USDP', 'DAI', 'EURI', 'AEUR', 'VAI', 'IDRT',
  // Major Crypto Quotes
  'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'TRX', 'DOGE', 'DOT',
  // Fiats
  'EUR', 'TRY', 'BRL', 'JPY', 'ZAR', 'IDR', 'RUB', 'GBP', 'AUD', 'COP', 'MXN', 'ARS', 'NGN', 'UAH', 'PLN', 'RON', 'KZT', 'VND'
];

// Helper to detect the quote asset of a symbol
export const getQuoteAsset = (symbol: string): string | null => {
  for (const asset of KNOWN_QUOTE_ASSETS) {
    if (symbol.endsWith(asset)) {
      return asset;
    }
  }
  return null;
};

// Combined Stream URL to get 24h, 1h, and 4h tickers simultaneously
// Updated with Vision domain and Port 443 priority for better connectivity
const STREAMS = '?streams=!ticker@arr/!ticker_1h@arr/!ticker_4h@arr';
const BASE_WS_URLS = [
  `wss://data-stream.binance.vision/stream${STREAMS}`,      // Vision (Often most accessible)
  `wss://stream.binance.com:443/stream${STREAMS}`,         // Main (Port 443 - Firewall friendly)
  `wss://stream.binance.com:9443/stream${STREAMS}`,        // Main (Port 9443 - Standard)
  `wss://data-stream.binance.com/stream${STREAMS}`,         // GCP Mirror
];

export class BinanceService {
  private ws: WebSocket | null = null;
  private subscribers: ((data: Map<string, TickerData>) => void)[] = [];
  private statusSubscribers: ((status: string) => void)[] = [];
  private tickerMap: Map<string, TickerData> = new Map();
  private reconnectAttempt = 0;
  private maxReconnectDelay = 10000;
  private reconnectTimeoutId: any = null;
  private endpointIndex = 0;
  
  // Set to track which symbols are currently being fetched to prevent duplicate requests
  private pendingFetches: Set<string> = new Set();

  constructor() {}

  public connect() {
    // 1. Fetch Snapshot (Client Side Direct)
    this.fetchInitialSnapshot();
    // 2. Start WebSocket (Real-time)
    this.connectWebSocket();
  }

  private async fetchInitialSnapshot() {
    console.log("[Client] Starting Client-Side Snapshot fetch...");
    
    // List of public API domains to try sequentially
    // Priority: Vision (Public Data) -> Main -> GCP Mirror
    const apiDomains = [
      'https://data-api.binance.vision', 
      'https://api.binance.com',         
      'https://api-gcp.binance.com'      
    ];

    for (const domain of apiDomains) {
      try {
        console.log(`[Client] Trying snapshot from: ${domain}`);
        
        // Parallel fetch: Get both Ticker Stats AND Exchange Info (for status)
        const [tickerRes, exchangeInfoRes] = await Promise.all([
          fetch(`${domain}/api/v3/ticker/24hr`),
          fetch(`${domain}/api/v3/exchangeInfo?permissions=SPOT`) // Filter for SPOT to reduce payload size
        ]);
        
        if (!tickerRes.ok) throw new Error(`Ticker Status ${tickerRes.status} from ${domain}`);
        if (!exchangeInfoRes.ok) throw new Error(`ExchangeInfo Status ${exchangeInfoRes.status} from ${domain}`);
        
        const tickerData = await tickerRes.json();
        const exchangeInfoData = await exchangeInfoRes.json();
        
        if (!Array.isArray(tickerData)) throw new Error('Invalid ticker data format');
        if (!Array.isArray(exchangeInfoData.symbols)) throw new Error('Invalid exchange info format');

        // 1. Build a whitelist of symbols that are actively TRADING
        // This filters out BREAK, HALT, and POST_TRADING (delisted/paused pairs)
        const tradingSymbols = new Set<string>();
        exchangeInfoData.symbols.forEach((s: any) => {
          if (s.status === 'TRADING') {
            tradingSymbols.add(s.symbol);
          }
        });

        let count = 0;
        tickerData.forEach((item: any) => {
          // STRICT FILTER:
          // 1. Must be explicitly 'TRADING' status
          // 2. Must have traded in the last 24h (count > 0)
          if (!tradingSymbols.has(item.symbol)) return;
          if (item.count === 0) return;

          this.tickerMap.set(item.symbol, {
            symbol: item.symbol,
            price: parseFloat(item.lastPrice),
            volume: parseFloat(item.quoteVolume),
            changePercent24h: parseFloat(item.priceChangePercent),
            changePercent1h: undefined, // Wait for Lazy Fill / WS
            changePercent4h: undefined, // Wait for Lazy Fill / WS
          });
          count++;
        });

        console.log(`[Client] Successfully loaded ${count} ACTIVE records from ${domain}`);
        this.notify();
        return; // Success, exit loop
      } catch (e) {
        console.warn(`[Client] Failed to fetch from ${domain}:`, e);
        // Continue to next domain
      }
    }
    
    console.error("[Client] Critical: All client-side snapshot endpoints failed.");
    // Even if it fails, we notify so the app might show an empty state or wait for WS
    this.notify();
  }

  // --- Lazy Loading 1h/4h data ---
  public async fetchDetailedStats(symbol: string) {
    if (this.pendingFetches.has(symbol)) return; // Already fetching
    this.pendingFetches.add(symbol);

    try {
      // Use binance.vision for best public API limits (Client Side)
      const baseUrl = 'https://data-api.binance.vision/api/v3/ticker';
      
      // We need to fetch 1h and 4h separately because the API doesn't support multiple windows in one call for a symbol
      const [res1h, res4h] = await Promise.all([
        fetch(`${baseUrl}?symbol=${symbol}&windowSize=1h`).then(r => r.ok ? r.json() : null),
        fetch(`${baseUrl}?symbol=${symbol}&windowSize=4h`).then(r => r.ok ? r.json() : null)
      ]);

      const item = this.tickerMap.get(symbol);
      if (item) {
        let updated = false;
        
        // Only update if we don't have WS data yet (WS data is usually more recent)
        // Or if the current value is undefined
        if (res1h && item.changePercent1h === undefined) {
           item.changePercent1h = parseFloat(res1h.priceChangePercent);
           updated = true;
        }
        
        if (res4h && item.changePercent4h === undefined) {
           item.changePercent4h = parseFloat(res4h.priceChangePercent);
           updated = true;
        }

        if (updated) {
          this.tickerMap.set(symbol, item);
          this.notify();
        }
      }
    } catch (e) {
      // Silently fail, we'll try again later or wait for WS
    } finally {
      this.pendingFetches.delete(symbol);
    }
  }
  // ----------------------------------------------

  private connectWebSocket() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }

    const url = BASE_WS_URLS[this.endpointIndex];
    this.emitStatus(); // Notify connecting
    console.log(`[Client] WebSocket Connecting to: ${url}`);

    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      console.error("Failed to construct WebSocket", e);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log(`[Client] WebSocket Connected`);
      this.reconnectAttempt = 0;
      this.emitStatus(); // Notify connected
    };

    this.ws.onmessage = (event) => {
      try {
        const message: BinanceStreamMessage = JSON.parse(event.data);
        
        // Check if it's a combined stream message
        if (!message.data) return;

        const rawData = Array.isArray(message.data) ? message.data : [message.data];
        
        const streamName = message.stream;
        const is1h = streamName.includes('1h');
        const is4h = streamName.includes('4h');
        const is24h = !is1h && !is4h; 

        rawData.forEach((item) => {
          const symbol = item.s;
          
          const existing = this.tickerMap.get(symbol) || {
            symbol: item.s,
            price: 0,
            volume: 0,
            changePercent24h: 0,
          };

          if (is24h) {
             existing.price = parseFloat(item.c);
             existing.volume = parseFloat(item.q); 
             existing.changePercent24h = parseFloat(item.P);
          } else if (is1h) {
             existing.price = parseFloat(item.c);
             existing.changePercent1h = parseFloat(item.P);
          } else if (is4h) {
             existing.price = parseFloat(item.c); 
             existing.changePercent4h = parseFloat(item.P);
          }

          this.tickerMap.set(symbol, existing);
        });

        this.notify();
      } catch (error) {
        console.error('Error parsing WebSocket message', error);
      }
    };

    this.ws.onclose = (event) => {
      console.log(`[Client] WebSocket Closed (Code: ${event.code}).`);
      this.ws = null;
      this.emitStatus();
      this.scheduleReconnect();
    };

    this.ws.onerror = (event) => {
      console.log('[Client] WebSocket Error.');
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
      // Parse the URL to get the origin (e.g., "wss://data-stream.binance.vision")
      // This strips the path and query parameters to match the user's requested format.
      const urlObj = new URL(fullUrl);
      displayUrl = urlObj.origin;
    } catch (e) {
      // Fallback: Strip parameters manually if URL parsing fails
      displayUrl = fullUrl.split('?')[0]; 
    }

    const targets = specificCallback ? [specificCallback] : this.statusSubscribers;
    targets.forEach(cb => cb(displayUrl));
  }

  private scheduleReconnect() {
    this.endpointIndex = (this.endpointIndex + 1) % BASE_WS_URLS.length;
    this.emitStatus(); // Update status to new endpoint name immediately
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempt), this.maxReconnectDelay);
    this.reconnectAttempt++;
    
    if (this.reconnectTimeoutId) clearTimeout(this.reconnectTimeoutId);
    
    console.log(`[Client] Reconnecting in ${delay}ms to ${BASE_WS_URLS[this.endpointIndex]}`);
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
  }
}

export const binanceService = new BinanceService();
