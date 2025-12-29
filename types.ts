
// Raw data format from Binance WebSocket
// When using combined streams, the payload is wrapped in "data"
export interface BinanceStreamMessage {
  stream: string;
  data: BinanceTickerWS[] | BinanceTickerWS; // Can be array or single object depending on stream
}

export interface BinanceTickerWS {
  s: string; // Symbol
  c: string; // Last Price
  v: string; // Total Traded Base Asset Volume
  q: string; // Total Traded Quote Asset Volume (Turnover)
  P: string; // Price change percent
  e?: string; // Event type (e.g., "24hrTicker", "1hTicker")
}

// Normalized application data format
export interface TickerData {
  symbol: string;
  price: number;
  volume: number;
  changePercent1h?: number;
  changePercent4h?: number;
  changePercent24h: number;
  iconUrl?: string;
  chainIconUrl?: string;
  chainName?: string;
  contractAddress?: string;
  name?: string;
  marketCap?: number;
  fdv?: number;
  liquidity?: number;
  totalSupply?: number;
  circulatingSupply?: number;
  holders?: number;
  listingTime?: number;
}

export type SortField =
  | 'symbol'
  | 'price'
  | 'volume'
  | 'change1h'
  | 'change4h'
  | 'change24h'
  | 'name'
  | 'contractAddress'
  | 'marketCap'
  | 'fdv'
  | 'liquidity'
  | 'totalSupply'
  | 'circulatingSupply'
  | 'holders'
  | 'listingTime';
export type SortDirection = 'asc' | 'desc';
// Timeframe type removed as it is no longer needed for state
