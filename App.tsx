
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { binanceService, getQuoteAsset } from './services/binanceService';
import { TickerData } from './types';
import { VirtualTable } from './components/VirtualTable';

const ALPHA_COLUMN_OPTIONS = [
  { id: 'chainIcon', label: 'Chain Icon' },
  { id: 'tokenIcon', label: 'Token Icon' },
  { id: 'token', label: 'Token' },
  { id: 'name', label: 'Name' },
  { id: 'contractAddress', label: 'Contract' },
  { id: 'marketCap', label: 'Market Cap' },
  { id: 'fdv', label: 'FDV' },
  { id: 'liquidity', label: 'Liquidity' },
  { id: 'totalSupply', label: 'Total Supply' },
  { id: 'circulatingSupply', label: 'Circ Supply' },
  { id: 'holders', label: 'Holders' },
  { id: 'listingTime', label: 'Listing' },
  { id: 'price', label: 'Price' },
  { id: 'volume', label: 'Vol (24h)' },
  { id: 'change24h', label: '24h' },
] as const;

type AlphaColumnId = typeof ALPHA_COLUMN_OPTIONS[number]['id'];
type ViewMode = 'market' | 'favorites';
type SpotFilters = { selectedAssets: string[]; viewMode: ViewMode; searchQuery: string };
type AlphaFilters = { viewMode: ViewMode; searchQuery: string };

const PINNED_ALPHA_COLUMNS = ['chainIcon', 'tokenIcon', 'token'] as const;
const PINNED_ALPHA_COLUMN_SET = new Set<AlphaColumnId>(PINNED_ALPHA_COLUMNS);
const TAB_PATHS = {
  spot: '/spot',
  perp: '/perp',
  alpha: '/alpha',
} as const;

const SPOT_FILTERS_KEY = 'binance_spot_filters';
const ALPHA_FILTERS_KEY = 'binance_alpha_filters';
const ALPHA_COLUMNS_KEY = 'binance_alpha_columns';
const ALPHA_COLUMN_ORDER_KEY = 'binance_alpha_column_order';

const ALPHA_COLUMN_LABELS = ALPHA_COLUMN_OPTIONS.reduce((acc, col) => {
  acc[col.id] = col.label;
  return acc;
}, {} as Record<AlphaColumnId, string>);

const DEFAULT_ALPHA_COLUMN_ORDER: AlphaColumnId[] = [
  'chainIcon',
  'tokenIcon',
  'token',
  'price',
  'listingTime',
  'volume',
  'marketCap',
  'liquidity',
  'holders',
  'change24h',
  'contractAddress',
  'fdv',
  'name',
  'circulatingSupply',
  'totalSupply',
];
const DEFAULT_ALPHA_VISIBLE_COLUMNS = new Set<AlphaColumnId>([
  'chainIcon',
  'tokenIcon',
  'token',
  'price',
  'listingTime',
  'volume',
  'marketCap',
  'liquidity',
  'holders',
  'change24h',
]);

const getSpotFilters = (): SpotFilters => {
  const fallback: SpotFilters = { selectedAssets: ['USDT'], viewMode: 'market', searchQuery: '' };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(SPOT_FILTERS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<typeof fallback> | null;
    const selectedAssets = Array.isArray(parsed?.selectedAssets)
      ? parsed!.selectedAssets.filter((asset) => typeof asset === 'string')
      : fallback.selectedAssets;
    const viewMode: ViewMode = parsed?.viewMode === 'favorites' ? 'favorites' : 'market';
    const searchQuery = typeof parsed?.searchQuery === 'string' ? parsed.searchQuery : '';
    return {
      selectedAssets: selectedAssets.length ? selectedAssets : fallback.selectedAssets,
      viewMode,
      searchQuery,
    };
  } catch {
    return fallback;
  }
};

const getAlphaFilters = (): AlphaFilters => {
  const fallback: AlphaFilters = { viewMode: 'market', searchQuery: '' };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(ALPHA_FILTERS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<typeof fallback> | null;
    const viewMode: ViewMode = parsed?.viewMode === 'favorites' ? 'favorites' : 'market';
    const searchQuery = typeof parsed?.searchQuery === 'string' ? parsed.searchQuery : '';
    return { viewMode, searchQuery };
  } catch {
    return fallback;
  }
};

const getAlphaColumns = () => {
  const fallback = new Set(DEFAULT_ALPHA_VISIBLE_COLUMNS);
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(ALPHA_COLUMNS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as string[] | null;
    if (!Array.isArray(parsed)) return fallback;
    const allowed = new Set(ALPHA_COLUMN_OPTIONS.map((col) => col.id));
    const filtered = parsed.filter((id) => allowed.has(id as AlphaColumnId)) as AlphaColumnId[];
    return new Set([...PINNED_ALPHA_COLUMNS, ...filtered]);
  } catch {
    return fallback;
  }
};

const normalizeAlphaOrder = (order: AlphaColumnId[]) => {
  const allowed = new Set(DEFAULT_ALPHA_COLUMN_ORDER);
  const normalized = order.filter((id) => allowed.has(id));
  DEFAULT_ALPHA_COLUMN_ORDER.forEach((id) => {
    if (!normalized.includes(id)) normalized.push(id);
  });
  const rest = normalized.filter((id) => !PINNED_ALPHA_COLUMN_SET.has(id));
  return [...PINNED_ALPHA_COLUMNS, ...rest];
};

const getAlphaColumnOrder = () => {
  if (typeof window === 'undefined') return DEFAULT_ALPHA_COLUMN_ORDER;
  try {
    const raw = localStorage.getItem(ALPHA_COLUMN_ORDER_KEY);
    if (!raw) return DEFAULT_ALPHA_COLUMN_ORDER;
    const parsed = JSON.parse(raw) as string[] | null;
    if (!Array.isArray(parsed)) return DEFAULT_ALPHA_COLUMN_ORDER;
    const filtered = parsed.filter((id) =>
      DEFAULT_ALPHA_COLUMN_ORDER.includes(id as AlphaColumnId)
    ) as AlphaColumnId[];
    return normalizeAlphaOrder(filtered);
  } catch {
    return DEFAULT_ALPHA_COLUMN_ORDER;
  }
};

const App = () => {
  const getTabFromPath = (pathname: string) => {
    if (pathname.startsWith(TAB_PATHS.alpha)) return 'alpha';
    if (pathname.startsWith(TAB_PATHS.perp)) return 'perp';
    return 'spot';
  };
  const [tickerDataMap, setTickerDataMap] = useState<Map<string, TickerData>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState('Initializing...');
  const [alphaApiStatus, setAlphaApiStatus] = useState('Alpha API initializing...');
  const spotFilters = getSpotFilters();
  const [searchQuery, setSearchQuery] = useState(spotFilters.searchQuery);
  const [selectedAssets, setSelectedAssets] = useState<string[]>(spotFilters.selectedAssets);
  const [sortedSymbols, setSortedSymbols] = useState<string[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('binance_favorites');
      if (saved) {
        try { return new Set(JSON.parse(saved)); } catch (e) { return new Set(); }
      }
    }
    return new Set();
  });
  const [viewMode, setViewMode] = useState<ViewMode>(spotFilters.viewMode);
  const alphaFilters = getAlphaFilters();
  const [alphaViewMode, setAlphaViewMode] = useState<ViewMode>(alphaFilters.viewMode);
  const [alphaSearchQuery, setAlphaSearchQuery] = useState(alphaFilters.searchQuery);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isAlphaFilterOpen, setIsAlphaFilterOpen] = useState(false);
  const [alphaDraggingColumn, setAlphaDraggingColumn] = useState<AlphaColumnId | null>(null);
  const [alphaDropIndex, setAlphaDropIndex] = useState<number | null>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const alphaFilterRef = useRef<HTMLDivElement>(null);

  // New state for Tab Navigation
  const [activeTab, setActiveTab] = useState<'spot' | 'alpha' | 'perp'>(() => {
    if (typeof window === 'undefined') return 'spot';
    return getTabFromPath(window.location.pathname);
  });
  const [spotWidthRefreshKey, setSpotWidthRefreshKey] = useState(0);
  const [alphaWidthRefreshKey, setAlphaWidthRefreshKey] = useState(0);
  
  // State for Alpha Tab
  const [alphaData, setAlphaData] = useState<TickerData[]>([]);
  const [alphaVisibleColumns, setAlphaVisibleColumns] = useState<Set<AlphaColumnId>>(getAlphaColumns);
  const [alphaColumnOrder, setAlphaColumnOrder] = useState<AlphaColumnId[]>(getAlphaColumnOrder);

  // Spot Data Effect
  useEffect(() => {
    binanceService.connect();
    const unsubscribe = binanceService.subscribe((data) => {
      setTickerDataMap(data);
      if (data.size > 0) setIsLoading(false);
    });
    const unsubscribeStatus = binanceService.subscribeStatus((status) => {
      setConnectionStatus(status);
    });

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (filterRef.current && !filterRef.current.contains(target)) setIsFilterOpen(false);
      if (alphaFilterRef.current && !alphaFilterRef.current.contains(target)) setIsAlphaFilterOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      unsubscribe();
      unsubscribeStatus();
      binanceService.disconnect();
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Spot Lazy Load Effect
  useEffect(() => {
    if (tickerDataMap.size === 0 || sortedSymbols.length === 0) return;
    const fillNextEmpty = async () => {
      const targetSymbol = sortedSymbols.find(symbol => {
        const item = tickerDataMap.get(symbol);
        return item && (item.changePercent1h === undefined || item.changePercent4h === undefined);
      });
      if (targetSymbol) await binanceService.fetchDetailedStats(targetSymbol);
    };
    const intervalId = setInterval(fillNextEmpty, 200);
    return () => clearInterval(intervalId);
  }, [sortedSymbols, tickerDataMap]); 

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const payload = { selectedAssets, viewMode, searchQuery };
    localStorage.setItem(SPOT_FILTERS_KEY, JSON.stringify(payload));
  }, [selectedAssets, viewMode, searchQuery]);

  useEffect(() => {
    if (activeTab !== 'spot') return;
    setSpotWidthRefreshKey((prev) => prev + 1);
  }, [activeTab, viewMode, searchQuery, selectedAssets, tickerDataMap.size]);

  useEffect(() => {
    if (activeTab !== 'spot' || viewMode !== 'favorites') return;
    setSpotWidthRefreshKey((prev) => prev + 1);
  }, [favorites, activeTab, viewMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const nextPath = TAB_PATHS[activeTab];
    if (window.location.pathname !== nextPath) {
      window.history.pushState(null, '', nextPath);
    }
  }, [activeTab]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handlePopState = () => {
      setActiveTab(getTabFromPath(window.location.pathname));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const payload = { viewMode: alphaViewMode, searchQuery: alphaSearchQuery };
    localStorage.setItem(ALPHA_FILTERS_KEY, JSON.stringify(payload));
  }, [alphaViewMode, alphaSearchQuery]);

  useEffect(() => {
    if (activeTab !== 'alpha') return;
    setAlphaWidthRefreshKey((prev) => prev + 1);
  }, [activeTab, alphaViewMode, alphaSearchQuery, alphaVisibleColumns, alphaColumnOrder, alphaData.length]);

  useEffect(() => {
    if (activeTab !== 'alpha' || alphaViewMode !== 'favorites') return;
    setAlphaWidthRefreshKey((prev) => prev + 1);
  }, [favorites, activeTab, alphaViewMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(ALPHA_COLUMNS_KEY, JSON.stringify(Array.from(alphaVisibleColumns)));
  }, [alphaVisibleColumns]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(ALPHA_COLUMN_ORDER_KEY, JSON.stringify(alphaColumnOrder));
  }, [alphaColumnOrder]);

  // Alpha Data Fetch Effect
  useEffect(() => {
    if (activeTab === 'alpha') {
      const fetchAlphaData = async () => {
        const apiPath = '/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list';
        const targetUrl = `https://www.binance.com${apiPath}`;
        const formatApiStatus = (url: string) => {
          if (url.startsWith('/')) return `${window.location.origin}${url}`;
          return url;
        };

        // Define strategies to try in order.
        // 1. Local Proxy (defined in vite.config.ts)
        // 2. CorsProxy.io (Robust public proxy)
        // 3. AllOrigins (Fallback public proxy)
        const strategies = [
          apiPath,
          `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`,
          `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`
        ];

        const toNumber = (value: unknown) => {
          const num = Number(value);
          return Number.isFinite(num) ? num : undefined;
        };

        for (const url of strategies) {
          try {
            const res = await fetch(url);
            
            // Check content type to ensure we didn't get a 404 HTML page (common with failed proxies)
            const contentType = res.headers.get('content-type');
            const isJson = contentType && contentType.includes('application/json');

            if (!res.ok || !isJson) {
               continue; // Try next strategy
            }

            const json = await res.json();
            
            // Validate specific Binance BAPI structure
            if (json.code === '000000' && Array.isArray(json.data)) {
              const mapped: TickerData[] = json.data
                .filter((item: any) => !(item.offline === true || item.offline === 'true'))
                .map((item: any) => ({
                symbol: item.symbol,
                price: parseFloat(item.price),
                volume: parseFloat(item.volume24h),
                changePercent24h: parseFloat(item.percentChange24h),
                changePercent1h: undefined,
                changePercent4h: undefined,
                iconUrl: item.iconUrl,
                chainIconUrl: item.chainIconUrl,
                chainName: item.chainName,
                contractAddress: item.contractAddress,
                name: item.name,
                marketCap: toNumber(item.marketCap),
                fdv: toNumber(item.fdv),
                liquidity: toNumber(item.liquidity),
                totalSupply: toNumber(item.totalSupply),
                circulatingSupply: toNumber(item.circulatingSupply),
                holders: toNumber(item.holders),
                listingTime: toNumber(item.listingTime),
              }));
              setAlphaData(mapped);
              setAlphaApiStatus(formatApiStatus(url));
              return; // Success, exit the loop
            }
          } catch (e) {
            // Log warning but continue to next strategy
            // console.warn(`Strategy failed for ${url}`, e);
          }
        }
        
        setAlphaApiStatus('Alpha API unavailable');
        console.warn("All strategies to fetch Alpha data failed.");
      };

      fetchAlphaData();
      const interval = setInterval(fetchAlphaData, 10000); // Poll every 10s
      return () => clearInterval(interval);
    }
  }, [activeTab]);

  const toggleFavorite = (symbol: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      localStorage.setItem('binance_favorites', JSON.stringify(Array.from(next)));
      return next;
    });
    setSpotWidthRefreshKey((prev) => prev + 1);
    setAlphaWidthRefreshKey((prev) => prev + 1);
  };

  const { availableQuoteAssets, assetCounts } = useMemo(() => {
    const allData = Array.from(tickerDataMap.values());
    const counts: Record<string, number> = { 'ALL': allData.length };
    const presentAssets = new Set<string>();
    allData.forEach((item) => {
      const quote = getQuoteAsset(item.symbol);
      if (quote) {
        presentAssets.add(quote);
        counts[quote] = (counts[quote] || 0) + 1;
      }
    });
    const priority = ['USDT', 'FDUSD', 'USDC', 'BTC', 'BNB', 'ETH'];
    const sortedAssets = Array.from(presentAssets).sort((a, b) => {
      const idxA = priority.indexOf(a);
      const idxB = priority.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });
    return { availableQuoteAssets: ['ALL', ...sortedAssets], assetCounts: counts };
  }, [tickerDataMap]);

  const filteredData = useMemo(() => {
    let data = Array.from(tickerDataMap.values());
    if (viewMode === 'favorites') data = data.filter(item => favorites.has(item.symbol));
    if (!selectedAssets.includes('ALL')) {
      data = data.filter(item => selectedAssets.some(asset => item.symbol.endsWith(asset)));
    }
    if (searchQuery) {
      const q = searchQuery.toUpperCase();
      data = data.filter(item => {
        const quote = getQuoteAsset(item.symbol);
        const base = quote ? item.symbol.substring(0, item.symbol.length - quote.length) : item.symbol;
        return base.includes(q);
      });
    }
    return data;
  }, [tickerDataMap, selectedAssets, searchQuery, viewMode, favorites]);

  const spotWidthData = useMemo(() => {
    let data = Array.from(tickerDataMap.values());
    if (!selectedAssets.includes('ALL')) {
      data = data.filter(item => selectedAssets.some(asset => item.symbol.endsWith(asset)));
    }
    return data;
  }, [tickerDataMap, selectedAssets]);

  const stats = useMemo(() => {
    if (filteredData.length === 0) return { total: 0, up: 0, down: 0 };
    let up = 0, down = 0;
    filteredData.forEach((t) => {
      if (t.changePercent24h > 0) up++;
      else if (t.changePercent24h < 0) down++;
    });
    return { total: filteredData.length, up, down };
  }, [filteredData]);

  const filteredAlphaData = useMemo(() => {
    let data = alphaData;
    if (alphaViewMode === 'favorites') {
      data = data.filter(item => favorites.has(item.symbol));
    }
    if (alphaSearchQuery.trim()) {
      const q = alphaSearchQuery.trim().toLowerCase();
      data = data.filter(item => {
        const symbolMatch = item.symbol.toLowerCase().includes(q);
        const nameMatch = item.name ? item.name.toLowerCase().includes(q) : false;
        const contractMatch = item.contractAddress
          ? item.contractAddress.toLowerCase().includes(q)
          : false;
        return symbolMatch || nameMatch || contractMatch;
      });
    }
    return data;
  }, [alphaData, alphaViewMode, favorites, alphaSearchQuery]);

  const alphaStats = useMemo(() => {
    if (filteredAlphaData.length === 0) return { total: 0, up: 0, down: 0 };
    let up = 0, down = 0;
    filteredAlphaData.forEach((t) => {
      if (t.changePercent24h > 0) up++;
      else if (t.changePercent24h < 0) down++;
    });
    return { total: filteredAlphaData.length, up, down };
  }, [filteredAlphaData]);

  const toggleAsset = (asset: string) => {
    if (asset === 'ALL') { setSelectedAssets(['ALL']); return; }
    setSelectedAssets((prev) => {
      if (prev.includes('ALL')) return [asset];
      if (prev.includes(asset)) {
        const next = prev.filter((a) => a !== asset);
        return next.length === 0 ? ['ALL'] : next;
      } else return [...prev, asset];
    });
  };

  const toggleAlphaColumn = (columnId: AlphaColumnId) => {
    if (PINNED_ALPHA_COLUMN_SET.has(columnId)) return;
    setAlphaVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(columnId)) next.delete(columnId);
      else next.add(columnId);
      return next;
    });
  };

  const handleAlphaDragStart = (event: React.DragEvent<HTMLSpanElement>, columnId: AlphaColumnId) => {
    if (PINNED_ALPHA_COLUMN_SET.has(columnId)) return;
    setAlphaDraggingColumn(columnId);
    event.dataTransfer.setData('text/plain', columnId);
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleAlphaDragEnd = () => {
    setAlphaDraggingColumn(null);
    setAlphaDropIndex(null);
  };

  const handleAlphaDragOver = (event: React.DragEvent<HTMLDivElement>, targetId: AlphaColumnId) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    const targetIndex = alphaColumnOrder.indexOf(targetId);
    if (targetIndex === -1) return;
    const isAfter = event.clientY > rect.top + rect.height / 2;
    const nextIndex = isAfter ? targetIndex + 1 : targetIndex;
    const minIndex = PINNED_ALPHA_COLUMNS.length;
    const clampedIndex = Math.max(minIndex, nextIndex);
    if (alphaDropIndex !== clampedIndex) setAlphaDropIndex(clampedIndex);
  };

  const handleAlphaDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!alphaDraggingColumn || alphaDropIndex === null) return;
    setAlphaColumnOrder((prev) => {
      const next = [...prev];
      const from = next.indexOf(alphaDraggingColumn);
      if (from === -1) return prev;
      let insertIndex = alphaDropIndex;
      next.splice(from, 1);
      if (from < insertIndex) insertIndex -= 1;
      const minIndex = PINNED_ALPHA_COLUMNS.length;
      insertIndex = Math.max(minIndex, Math.min(insertIndex, next.length));
      next.splice(insertIndex, 0, alphaDraggingColumn);
      const rest = next.filter((id) => !PINNED_ALPHA_COLUMN_SET.has(id));
      return [...PINNED_ALPHA_COLUMNS, ...rest];
    });
    setAlphaDraggingColumn(null);
    setAlphaDropIndex(null);
  };

  const alphaHiddenColumns = useMemo<
    (AlphaColumnId | 'change1h' | 'change4h')[]
  >(() => {
    const hidden = ALPHA_COLUMN_OPTIONS
      .filter((col) => !alphaVisibleColumns.has(col.id))
      .map((col) => col.id);
    return ['change1h', 'change4h', ...hidden];
  }, [alphaVisibleColumns]);

  const filterLabel = useMemo(() => {
    if (selectedAssets.includes('ALL')) return 'All Markets';
    return selectedAssets.length === 1 ? selectedAssets[0] : `${selectedAssets.length} Selected`;
  }, [selectedAssets]);

  return (
    <div className="h-screen w-screen flex flex-col bg-gray-50 overflow-hidden">
      {/* Navbar */}
      <header className="flex-shrink-0 w-full bg-white border-b border-gray-200 z-20">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <h1 className="text-lg font-bold text-gray-800">JJ Board</h1>
            {/* Top Navigation Tabs - Updated to mimic Market/Favorites toggle style */}
            <nav className="flex items-center bg-gray-200 p-1 rounded-lg">
                {(
                  [
                    { id: 'spot', label: 'Spot' },
                    { id: 'perp', label: 'Perp' },
                    { id: 'alpha', label: 'Alpha' },
                  ] as const
                ).map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`px-4 py-1.5 rounded-md text-sm font-medium ${
                            activeTab === tab.id 
                            ? 'bg-white text-gray-900 shadow-sm' 
                            : 'text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        {tab.id === 'spot' ? 'BN Spot' : tab.id === 'perp' ? 'BN Perp' : 'BN Alpha'}
                    </button>
                ))}
            </nav>
          </div>

          {/* Right Side Status - Stats removed from here */}
          <div className="flex items-center space-x-2 text-sm">
              <div className="flex items-center space-x-2 mr-4">
                <a
                  href="https://x.com/wolfyxbt"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-black transition-colors"
                  title="Official X"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path>
                  </svg>
                </a>
                <a
                  href="https://github.com/wolfyxbt/JJBoard"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-black transition-colors"
                  title="Official GitHub"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor">
                    <path d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75 0 4.32 2.81 7.98 6.708 9.273.49.09.67-.213.67-.477 0-.236-.01-1.023-.014-1.855-2.732.594-3.31-1.173-3.31-1.173-.447-1.134-1.092-1.437-1.092-1.437-.892-.61.067-.598.067-.598 1.007.071 1.536 1.034 1.536 1.034.895 1.534 2.35 1.091 2.922.834.09-.65.35-1.092.636-1.343-2.18-.248-4.47-1.09-4.47-4.851 0-1.071.382-1.948 1.01-2.635-.101-.249-.438-1.248.096-2.602 0 0 .823-.264 2.696 1.008a9.374 9.374 0 0 1 2.454-.33c.832.004 1.67.112 2.453.33 1.874-1.272 2.696-1.008 2.696-1.008.534 1.354.197 2.353.096 2.602.628.687 1.01 1.564 1.01 2.635 0 3.77-2.294 4.6-4.479 4.843.36.31.68.922.68 1.858 0 1.343-.012 2.423-.012 2.754 0 .266.178.571.675.474C18.94 19.98 21.75 16.32 21.75 12c0-5.385-4.365-9.75-9.75-9.75z"></path>
                  </svg>
                </a>
              </div>
              <div className={`w-2 h-2 rounded-full ${isLoading ? 'bg-yellow-400' : 'bg-green-500 animate-pulse'}`}></div>
              <span className="text-xs font-medium text-gray-500">
                Live
              </span>
          </div>
        </div>
      </header>

      {/* Conditional Content */}
      {activeTab === 'spot' ? (
        <>
          {/* Toolbar */}
          <div className="flex-shrink-0 w-full max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
            {/* Left Side: Buttons & Filter */}
            <div className="flex items-center space-x-3">
              <div className="bg-gray-200 p-1 rounded-lg flex items-center">
                <button onClick={() => setViewMode('market')} className={`px-3 py-1.5 rounded-md text-sm font-medium ${viewMode === 'market' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>Market</button>
                <button onClick={() => setViewMode('favorites')} className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center space-x-1 ${viewMode === 'favorites' ? 'bg-white shadow-sm text-yellow-600' : 'text-gray-500 hover:text-gray-700'}`}>
                  <span>Favorites</span>
                </button>
              </div>
              <div className="relative" ref={filterRef}>
                <button onClick={() => setIsFilterOpen(!isFilterOpen)} className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium flex items-center space-x-2">
                  <span>Base: {filterLabel}</span>
                  <svg className={`w-4 h-4 transition-transform ${isFilterOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </button>
                {isFilterOpen && (
                  <div className="absolute top-full left-0 mt-2 w-44 bg-white border border-gray-200 rounded-xl shadow-xl z-30 py-2">
                    <div className="max-h-80 overflow-y-auto px-2 space-y-1">
                      {availableQuoteAssets.map(asset => (
                        <button key={asset} onClick={() => toggleAsset(asset)} className={`w-full px-3 py-2 rounded-lg text-sm font-medium flex justify-between ${selectedAssets.includes(asset) ? 'bg-gray-900 text-white' : 'hover:bg-gray-100'}`}>
                          <span>{asset}</span>
                          <span className="opacity-50">{asset === 'ALL' ? '' : assetCounts[asset]}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right Side: Stats & Search */}
            <div className="flex items-center gap-6">
                {/* Stats displayed here */}
                <div className="flex space-x-4 text-sm whitespace-nowrap">
                  <span className="text-gray-500">Pairs <span className="text-gray-900 font-bold ml-1">{stats.total}</span></span>
                  <span className="text-green-600 font-bold">Up {stats.up}</span>
                  <span className="text-red-600 font-bold">Down {stats.down}</span>
                </div>

                <div className="relative w-64">
                  <input type="text" className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-200" placeholder="Search symbol..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                  <svg className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeWidth={2} /></svg>
                </div>
            </div>
          </div>

          {/* Table - 占用剩余全部高度 */}
          <main className="flex-1 min-h-0 w-full max-w-7xl mx-auto px-4 pb-4 overflow-hidden">
            <VirtualTable 
              data={filteredData} 
              height="100%" 
              favorites={favorites}
              onToggleFavorite={toggleFavorite}
              onSortedIdsChange={setSortedSymbols}
              widthRefreshKey={spotWidthRefreshKey}
              widthSourceData={spotWidthData}
            />
          </main>
        </>
      ) : activeTab === 'alpha' ? (
        <>
          {/* Alpha Toolbar */}
          <div className="flex-shrink-0 w-full max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
            {/* Left Side: Buttons & Filter */}
            <div className="flex items-center space-x-3">
              <div className="bg-gray-200 p-1 rounded-lg flex items-center">
                <button onClick={() => setAlphaViewMode('market')} className={`px-3 py-1.5 rounded-md text-sm font-medium ${alphaViewMode === 'market' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>Market</button>
                <button onClick={() => setAlphaViewMode('favorites')} className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center space-x-1 ${alphaViewMode === 'favorites' ? 'bg-white shadow-sm text-yellow-600' : 'text-gray-500 hover:text-gray-700'}`}>
                  <span>Favorites</span>
                </button>
              </div>
              <div className="relative" ref={alphaFilterRef}>
                <button onClick={() => setIsAlphaFilterOpen(!isAlphaFilterOpen)} className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium flex items-center space-x-2">
                  <span>Columns: {alphaVisibleColumns.size}/{ALPHA_COLUMN_OPTIONS.length}</span>
                  <svg className={`w-4 h-4 transition-transform ${isAlphaFilterOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </button>
                {isAlphaFilterOpen && (
                  <div className="absolute top-full left-0 mt-2 w-56 bg-white border border-gray-200 rounded-xl shadow-xl z-30 py-2">
                    <div className="flex items-center justify-between px-3 pb-2 text-xs font-medium text-gray-500">
                      <button onClick={() => setAlphaVisibleColumns(new Set(ALPHA_COLUMN_OPTIONS.map((col) => col.id)))} className="hover:text-gray-900">All</button>
                      <button
                        onClick={() => {
                          setAlphaVisibleColumns(new Set(DEFAULT_ALPHA_VISIBLE_COLUMNS));
                          setAlphaColumnOrder([...DEFAULT_ALPHA_COLUMN_ORDER]);
                        }}
                        className="hover:text-gray-900"
                      >
                        Default
                      </button>
                      <button onClick={() => setAlphaVisibleColumns(new Set(PINNED_ALPHA_COLUMNS))} className="hover:text-gray-900">None</button>
                    </div>
                    <div
                      className="px-3 space-y-1"
                      onDragLeave={(event) => {
                        const related = event.relatedTarget as Node | null;
                        if (related && event.currentTarget.contains(related)) return;
                        setAlphaDropIndex(null);
                      }}
                    >
                      {alphaColumnOrder.map((columnId, index) => {
                        const isPinned = PINNED_ALPHA_COLUMN_SET.has(columnId);
                        return (
                        <div
                          key={columnId}
                          className={`w-full px-2 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2 transition-all duration-150 ease-out ${
                            alphaDraggingColumn === columnId
                              ? 'bg-gray-100 opacity-70 scale-[0.98]'
                              : 'hover:bg-gray-100'
                          } relative`}
                          onDragOver={(event) => handleAlphaDragOver(event, columnId)}
                          onDrop={handleAlphaDrop}
                        >
                          {alphaDraggingColumn && alphaDropIndex === index && (
                            <div className="absolute -top-0.5 left-2 right-2 h-0.5 bg-gray-900/80 shadow-sm pointer-events-none" />
                          )}
                          {alphaDraggingColumn &&
                            alphaDropIndex === alphaColumnOrder.length &&
                            index === alphaColumnOrder.length - 1 && (
                              <div className="absolute -bottom-0.5 left-2 right-2 h-0.5 bg-gray-900/80 shadow-sm pointer-events-none" />
                            )}
                          <span
                            className={`mr-2 select-none ${
                              isPinned ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400'
                            } ${alphaDraggingColumn === columnId ? 'cursor-grabbing' : isPinned ? '' : 'cursor-grab'}`}
                            draggable={!isPinned}
                            onDragStart={isPinned ? undefined : (event) => handleAlphaDragStart(event, columnId)}
                            onDragEnd={isPinned ? undefined : handleAlphaDragEnd}
                            title={isPinned ? 'Pinned' : 'Drag to reorder'}
                          >
                            ::
                          </span>
                          <label
                            className={`flex flex-1 items-center ${
                              isPinned ? 'cursor-not-allowed' : 'cursor-pointer'
                            }`}
                          >
                            <span>{ALPHA_COLUMN_LABELS[columnId]}</span>
                          </label>
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-gray-900 ml-auto"
                            checked={alphaVisibleColumns.has(columnId)}
                            disabled={isPinned}
                            onChange={() => toggleAlphaColumn(columnId)}
                          />
                        </div>
                      )})}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right Side: Stats & Search */}
            <div className="flex items-center gap-6">
                <div className="flex space-x-4 text-sm whitespace-nowrap">
                  <span className="text-gray-500">Pairs <span className="text-gray-900 font-bold ml-1">{alphaStats.total}</span></span>
                  <span className="text-green-600 font-bold">Up {alphaStats.up}</span>
                  <span className="text-red-600 font-bold">Down {alphaStats.down}</span>
                </div>

                <div className="relative w-64">
                  <input type="text" className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-200" placeholder="Search symbol, name, or contract..." value={alphaSearchQuery} onChange={(e) => setAlphaSearchQuery(e.target.value)} />
                  <svg className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeWidth={2} /></svg>
                </div>
            </div>
          </div>

          {/* Alpha Table */}
          <main className="flex-1 min-h-0 w-full max-w-7xl mx-auto px-4 pb-4 overflow-hidden">
            <VirtualTable 
              data={filteredAlphaData} 
              height="100%" 
              favorites={favorites}
              onToggleFavorite={toggleFavorite}
              hiddenColumns={alphaHiddenColumns}
              showIconColumn
              showChainIconColumn
              showAlphaDetails
              columnOrder={alphaColumnOrder}
              widthRefreshKey={alphaWidthRefreshKey}
              widthSourceData={alphaData}
            />
          </main>
        </>
      ) : (
        /* Blank State for Perp Tab */
        <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-8">
          <div className="h-full w-full flex items-center justify-center text-sm font-medium text-gray-400">
            Coming Soon
          </div>
        </main>
      )}
    </div>
  );
};

export default App;
