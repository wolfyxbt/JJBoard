
import React, { useRef, useState, useEffect, useMemo } from 'react';
import { TickerData, SortField, SortDirection } from '../types';
import { getQuoteAsset } from '../services/binanceService';

type ColumnId =
  | 'token'
  | 'tokenIcon'
  | 'chainIcon'
  | 'name'
  | 'contractAddress'
  | 'marketCap'
  | 'fdv'
  | 'liquidity'
  | 'totalSupply'
  | 'circulatingSupply'
  | 'holders'
  | 'listingTime'
  | 'price'
  | 'volume'
  | 'change1h'
  | 'change4h'
  | 'change24h';

interface VirtualTableProps {
  data: TickerData[];
  height: string;
  favorites: Set<string>;
  onToggleFavorite: (symbol: string) => void;
  onSortedIdsChange?: (sortedIds: string[]) => void;
  hiddenColumns?: ColumnId[];
  showIconColumn?: boolean;
  showChainIconColumn?: boolean;
  showAlphaDetails?: boolean;
  columnOrder?: ColumnId[];
  widthRefreshKey?: number;
  widthSourceData?: TickerData[];
}

const ROW_HEIGHT = 48;
const HEADER_HEIGHT = 48;
const OVERSCAN = 10;
const SCROLLBAR_WIDTH = 8; // 匹配 index.html 中的 width: 8px
const CHANGE_COLUMN_WIDTH = 100;
const DEFAULT_COLUMN_WIDTHS: Record<ColumnId, number> = {
  token: 260,
  tokenIcon: 40,
  chainIcon: 40,
  name: 248,
  contractAddress: 780,
  marketCap: 162,
  fdv: 160,
  liquidity: 128,
  totalSupply: 200,
  circulatingSupply: 200,
  holders: 101,
  listingTime: 128,
  price: 120,
  volume: 134,
  change1h: CHANGE_COLUMN_WIDTH,
  change4h: CHANGE_COLUMN_WIDTH,
  change24h: CHANGE_COLUMN_WIDTH,
};

// --- 格式化器 ---
const priceFormatterHigh = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true });
const priceFormatterLow = new Intl.NumberFormat('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 8, useGrouping: true });
const volFormatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0, useGrouping: true });
const pctFormatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'always' });
const bigNumberFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0, useGrouping: true });
const integerFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0, useGrouping: true });
const dateFormatter = new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit' });

const formatPrice = (price: number) => price < 1 ? priceFormatterLow.format(price) : priceFormatterHigh.format(price);
const formatVolume = (vol: number) => volFormatter.format(vol);
const formatPercent = (pct: number | undefined) => pct === undefined ? '-' : pctFormatter.format(pct) + '%';
const formatBigNumber = (value: number | undefined) => value === undefined ? '-' : bigNumberFormatter.format(value);
const formatInteger = (value: number | undefined) => value === undefined ? '-' : integerFormatter.format(value);
const formatDate = (value: number | undefined) => value === undefined ? '-' : dateFormatter.format(new Date(value));

const FONT_SANS_BOLD = '700 14px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const FONT_SANS_SM = '400 13px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const FONT_SANS_XS = '500 10px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const FONT_HEADER = '700 11px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const FONT_MONO_12 = '400 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
const FONT_MONO_14 = '400 14px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
const FONT_MONO_15 = '400 15px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

const HEADER_ICON_WIDTH = 14;
const TOKEN_PADDING = 32;
const TOKEN_GAP = 8;
const ICON_SIZE = 24;
const ICON_GAP = 4;
const PADDING_PX_2 = 16;
const PADDING_PX_3 = 24;
const PADDING_PX_4 = 32;
const LISTING_GRADIENT_START = [235, 240, 248]; // #ebf0f8
const LISTING_GRADIENT_END = [101, 137, 193]; // #6589c1

const COLUMN_LABELS: Record<ColumnId, string> = {
  token: 'Token',
  tokenIcon: '',
  chainIcon: '',
  name: 'Name',
  contractAddress: 'Contract',
  marketCap: 'Market Cap',
  fdv: 'FDV',
  liquidity: 'Liquidity',
  totalSupply: 'Total Supply',
  circulatingSupply: 'Circ Supply',
  holders: 'Holders',
  listingTime: 'Listing',
  price: 'Price',
  volume: 'Vol (24h)',
  change1h: '1h',
  change4h: '4h',
  change24h: '24h',
};

// --- 图标组件 ---
const BinanceIcon = () => (
  <svg fill="currentColor" viewBox="0 0 32 32" className="w-[15px] h-[15px]" xmlns="http://www.w3.org/2000/svg">
    <title>binance</title>
    <path d="M15.986 1.019l9.189 9.159-3.396 3.393-5.793-5.793-5.793 5.823-3.396-3.393 9.189-9.189zM4.399 12.605l3.365 3.395-3.363 3.365-3.396-3.365zM15.986 12.607l3.394 3.363-3.395 3.395-3.395-3.365 3.395-3.393zM27.572 12.605l3.423 3.395-3.393 3.395-3.395-3.395zM21.778 18.399l3.396 3.393-9.189 9.189-9.189-9.187 3.396-3.395 5.793 5.823 5.793-5.823z"></path>
  </svg>
);

const TradingViewIcon = () => (
  <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" className="w-[18px] h-[18px]">
    <g fill="currentColor" stroke="none">
      <polygon points="4.5 14.453 4.5 22.273 11.865 22.273 11.865 33.547 19.685 33.547 19.685 14.453 4.5 14.453"></polygon>
      <polygon points="26.202 33.547 34.326 14.453 43.5 14.453 35.376 33.547 26.202 33.547"></polygon>
      <circle cx="25.8407" cy="18.3627" r="3.9101"></circle>
    </g>
  </svg>
);

const XIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="w-[15px] h-[15px] fill-current">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path>
  </svg>
);

export const VirtualTable: React.FC<VirtualTableProps> = ({ 
  data, 
  height, 
  favorites, 
  onToggleFavorite, 
  onSortedIdsChange,
  hiddenColumns = [],
  showIconColumn = false,
  showChainIconColumn = false,
  showAlphaDetails = false,
  columnOrder,
  widthRefreshKey = 0,
  widthSourceData
}) => {
  const tableRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [tableViewportWidth, setTableViewportWidth] = useState(0);
  const [columnWidths, setColumnWidths] = useState<Record<ColumnId, number>>(DEFAULT_COLUMN_WIDTHS);
  const COLUMN_WIDTHS = columnWidths;
  const [sortField, setSortField] = useState<SortField>('volume');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  useEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    const updateWidth = () => setTableViewportWidth(el.clientWidth);
    updateWidth();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => updateWidth());
      observer.observe(el);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onScroll = () => requestAnimationFrame(() => {
      if (container) setScrollTop(container.scrollTop);
    });
    container.addEventListener('scroll', onScroll);
    return () => container.removeEventListener('scroll', onScroll);
  }, []);

  const measureContext = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    return canvas.getContext('2d');
  }, []);

  useEffect(() => {
    if (!measureContext) return;
    const widthData = widthSourceData ?? data;
    const measureText = (text: string, font: string) => {
      measureContext.font = font;
      return measureContext.measureText(text).width;
    };
    const headerWidth = (label: string, padding: number) =>
      Math.ceil(measureText(label.toUpperCase(), FONT_HEADER) + HEADER_ICON_WIDTH + padding);

    let maxTokenTextWidth = 0;
    let maxNameWidth = 0;
    let maxContractWidth = 0;
    let maxMarketCapWidth = 0;
    let maxFdvWidth = 0;
    let maxLiquidityWidth = 0;
    let maxTotalSupplyWidth = 0;
    let maxCircSupplyWidth = 0;
    let maxHoldersWidth = 0;
    let maxListingWidth = 0;
    let maxPriceWidth = 0;
    let maxVolumeWidth = 0;
    let maxChange1hWidth = 0;
    let maxChange4hWidth = 0;
    let maxChange24hWidth = 0;

    widthData.forEach((item) => {
      const quoteAsset = showAlphaDetails ? '' : (getQuoteAsset(item.symbol) || '');
      const baseAsset = quoteAsset ? item.symbol.replace(quoteAsset, '') : item.symbol;
      const tokenTextWidth = measureText(baseAsset, FONT_SANS_BOLD)
        + (quoteAsset ? (4 + measureText(quoteAsset, FONT_SANS_XS)) : 0);
      if (tokenTextWidth > maxTokenTextWidth) maxTokenTextWidth = tokenTextWidth;

      const nameWidth = measureText(item.name || '-', FONT_SANS_SM);
      if (nameWidth > maxNameWidth) maxNameWidth = nameWidth;

      const contractWidth = measureText(item.contractAddress || '-', FONT_MONO_12);
      if (contractWidth > maxContractWidth) maxContractWidth = contractWidth;

      const marketCapWidth = measureText(formatBigNumber(item.marketCap), FONT_MONO_14);
      if (marketCapWidth > maxMarketCapWidth) maxMarketCapWidth = marketCapWidth;

      const fdvWidth = measureText(formatBigNumber(item.fdv), FONT_MONO_14);
      if (fdvWidth > maxFdvWidth) maxFdvWidth = fdvWidth;

      const liquidityWidth = measureText(formatBigNumber(item.liquidity), FONT_MONO_14);
      if (liquidityWidth > maxLiquidityWidth) maxLiquidityWidth = liquidityWidth;

      const totalSupplyWidth = measureText(formatBigNumber(item.totalSupply), FONT_MONO_14);
      if (totalSupplyWidth > maxTotalSupplyWidth) maxTotalSupplyWidth = totalSupplyWidth;

      const circSupplyWidth = measureText(formatBigNumber(item.circulatingSupply), FONT_MONO_14);
      if (circSupplyWidth > maxCircSupplyWidth) maxCircSupplyWidth = circSupplyWidth;

      const holdersWidth = measureText(formatInteger(item.holders), FONT_MONO_14);
      if (holdersWidth > maxHoldersWidth) maxHoldersWidth = holdersWidth;

      const listingWidth = measureText(formatDate(item.listingTime), FONT_MONO_14);
      if (listingWidth > maxListingWidth) maxListingWidth = listingWidth;

      const priceWidth = measureText(formatPrice(item.price), FONT_MONO_15);
      if (priceWidth > maxPriceWidth) maxPriceWidth = priceWidth;

      const volumeWidth = measureText(formatVolume(item.volume), FONT_MONO_15);
      if (volumeWidth > maxVolumeWidth) maxVolumeWidth = volumeWidth;

      const change1hWidth = measureText(formatPercent(item.changePercent1h), FONT_MONO_15);
      if (change1hWidth > maxChange1hWidth) maxChange1hWidth = change1hWidth;

      const change4hWidth = measureText(formatPercent(item.changePercent4h), FONT_MONO_15);
      if (change4hWidth > maxChange4hWidth) maxChange4hWidth = change4hWidth;

      const change24hWidth = measureText(formatPercent(item.changePercent24h), FONT_MONO_15);
      if (change24hWidth > maxChange24hWidth) maxChange24hWidth = change24hWidth;
    });

    const sampleListingWidth = measureText(formatDate(Date.now()), FONT_MONO_14);
    if (sampleListingWidth > maxListingWidth) maxListingWidth = sampleListingWidth;

    const iconCount = showAlphaDetails ? 4 : 3;
    const iconAreaWidth = iconCount * ICON_SIZE + (iconCount - 1) * ICON_GAP;
    const changePadding = showAlphaDetails ? PADDING_PX_2 : PADDING_PX_3;

    const nextWidths: Record<ColumnId, number> = {
      ...DEFAULT_COLUMN_WIDTHS,
      token: Math.ceil(Math.max(
        headerWidth(COLUMN_LABELS.token, PADDING_PX_4),
        maxTokenTextWidth + TOKEN_PADDING + TOKEN_GAP + iconAreaWidth
      )),
      name: Math.ceil(Math.max(
        headerWidth(COLUMN_LABELS.name, PADDING_PX_3),
        maxNameWidth + PADDING_PX_3
      )),
      contractAddress: Math.ceil(Math.max(
        headerWidth(COLUMN_LABELS.contractAddress, PADDING_PX_3),
        maxContractWidth + PADDING_PX_3
      )),
      marketCap: Math.ceil(Math.max(
        headerWidth(COLUMN_LABELS.marketCap, PADDING_PX_3),
        maxMarketCapWidth + PADDING_PX_3
      )),
      fdv: Math.ceil(Math.max(
        headerWidth(COLUMN_LABELS.fdv, PADDING_PX_3),
        maxFdvWidth + PADDING_PX_3
      )),
      liquidity: Math.ceil(Math.max(
        headerWidth(COLUMN_LABELS.liquidity, PADDING_PX_3),
        maxLiquidityWidth + PADDING_PX_3
      )),
      totalSupply: Math.ceil(Math.max(
        headerWidth(COLUMN_LABELS.totalSupply, PADDING_PX_3),
        maxTotalSupplyWidth + PADDING_PX_3
      )),
      circulatingSupply: Math.ceil(Math.max(
        headerWidth(COLUMN_LABELS.circulatingSupply, PADDING_PX_3),
        maxCircSupplyWidth + PADDING_PX_3
      )),
      holders: Math.ceil(Math.max(
        headerWidth(COLUMN_LABELS.holders, PADDING_PX_3),
        maxHoldersWidth + PADDING_PX_3
      )),
      listingTime: Math.ceil(Math.max(
        headerWidth(COLUMN_LABELS.listingTime, PADDING_PX_3),
        maxListingWidth + PADDING_PX_3
      ) * 1.05),
      price: Math.ceil(Math.max(
        headerWidth(COLUMN_LABELS.price, PADDING_PX_4),
        maxPriceWidth + PADDING_PX_4
      )),
      volume: Math.ceil(Math.max(
        headerWidth(COLUMN_LABELS.volume, PADDING_PX_4),
        maxVolumeWidth + PADDING_PX_4
      )),
      change1h: Math.ceil(Math.max(
        headerWidth(COLUMN_LABELS.listingTime, PADDING_PX_3),
        maxListingWidth + PADDING_PX_3
      ) * 1.05),
      change4h: Math.ceil(Math.max(
        headerWidth(COLUMN_LABELS.listingTime, PADDING_PX_3),
        maxListingWidth + PADDING_PX_3
      ) * 1.05),
      change24h: Math.ceil(Math.max(
        headerWidth(COLUMN_LABELS.listingTime, PADDING_PX_3),
        maxListingWidth + PADDING_PX_3
      ) * 1.05),
    };

    setColumnWidths(nextWidths);
  }, [widthRefreshKey, showAlphaDetails, measureContext, widthSourceData, data]);

  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => {
      let valA: string | number | undefined;
      let valB: string | number | undefined;
      switch (sortField) {
        case 'symbol': valA = a.symbol; valB = b.symbol; break;
        case 'price': valA = a.price; valB = b.price; break;
        case 'volume': valA = a.volume; valB = b.volume; break;
        case 'change1h': valA = a.changePercent1h ?? -999; valB = b.changePercent1h ?? -999; break;
        case 'change4h': valA = a.changePercent4h ?? -999; valB = b.changePercent4h ?? -999; break;
        case 'change24h': valA = a.changePercent24h; valB = b.changePercent24h; break;
        case 'name': valA = a.name; valB = b.name; break;
        case 'contractAddress': valA = a.contractAddress; valB = b.contractAddress; break;
        case 'marketCap': valA = a.marketCap; valB = b.marketCap; break;
        case 'fdv': valA = a.fdv; valB = b.fdv; break;
        case 'liquidity': valA = a.liquidity; valB = b.liquidity; break;
        case 'totalSupply': valA = a.totalSupply; valB = b.totalSupply; break;
        case 'circulatingSupply': valA = a.circulatingSupply; valB = b.circulatingSupply; break;
        case 'holders': valA = a.holders; valB = b.holders; break;
        case 'listingTime': valA = a.listingTime; valB = b.listingTime; break;
        default: valA = 0; valB = 0;
      }
      if (valA === undefined && valB === undefined) return 0;
      if (valA === undefined) return sortDirection === 'asc' ? 1 : -1;
      if (valB === undefined) return sortDirection === 'asc' ? -1 : 1;
      if (typeof valA === 'string' || typeof valB === 'string') {
        const aStr = String(valA);
        const bStr = String(valB);
        const cmp = aStr.localeCompare(bStr);
        return sortDirection === 'asc' ? cmp : -cmp;
      }
      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [data, sortField, sortDirection]);

  useEffect(() => {
    if (onSortedIdsChange) onSortedIdsChange(sortedData.map(d => d.symbol));
  }, [sortedData]);

  const totalHeight = sortedData.length * ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(800 / ROW_HEIGHT) + 2 * OVERSCAN;
  const visibleData = sortedData.slice(startIndex, startIndex + visibleCount);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDirection('desc'); }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    const isActive = sortField === field;
    return (
      <span className={`ml-1 w-3 inline-flex justify-center ${isActive ? 'text-gray-900' : 'text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity'}`}>
        {isActive ? (sortDirection === 'asc' ? '↑' : '↓') : '⇅'}
      </span>
    );
  };

  const getCellBackgroundColor = (pct: number | undefined) => {
    if (pct === undefined) return '#f3f4f6';
    if (pct > 30) return '#7bbc81';
    if (pct > 20) return '#a3d1aa';
    if (pct > 10) return '#b1d9b9';
    if (pct > 5) return '#c0e0c7';
    if (pct > 0.01) return '#dfeee2';
    if (pct >= -0.01) return '#fdf3d1';
    if (pct > -5) return '#efbdc2';
    if (pct > -10) return '#e8939a';
    if (pct > -20) return '#e68085';
    return '#e46c72';
  };
  const getListingBackgroundColor = (value: number | undefined) => {
    if (!showAlphaDetails || value === undefined) return 'transparent';
    const range = maxListingDiff || 1;
    const diff = Math.abs(value - Date.now());
    const t = Math.min(1, diff / range);
    const lerp = (start: number, end: number) => Math.round(start + (end - start) * t);
    const r = lerp(LISTING_GRADIENT_START[0], LISTING_GRADIENT_END[0]);
    const g = lerp(LISTING_GRADIENT_START[1], LISTING_GRADIENT_END[1]);
    const b = lerp(LISTING_GRADIENT_START[2], LISTING_GRADIENT_END[2]);
    return `rgb(${r}, ${g}, ${b})`;
  };

  const isHidden = (columnId: ColumnId) => hiddenColumns.includes(columnId);
  const orderedColumns = useMemo<ColumnId[]>(() => {
    if (columnOrder && columnOrder.length) return columnOrder;
    return [
      'chainIcon',
      'tokenIcon',
      'token',
      'name',
      'contractAddress',
      'marketCap',
      'fdv',
      'liquidity',
      'totalSupply',
      'circulatingSupply',
      'holders',
      'listingTime',
      'price',
      'volume',
      'change1h',
      'change4h',
      'change24h',
    ];
  }, [columnOrder]);

  const shouldRenderColumn = (columnId: ColumnId) => {
    if (isHidden(columnId)) return false;
    if (columnId === 'chainIcon' && !showChainIconColumn) return false;
    if (columnId === 'tokenIcon' && !showIconColumn) return false;
    if (!showAlphaDetails) {
      const alphaOnly = [
        'name',
        'contractAddress',
        'marketCap',
        'fdv',
        'liquidity',
        'totalSupply',
        'circulatingSupply',
        'holders',
        'listingTime',
      ];
      if (alphaOnly.includes(columnId)) return false;
    }
    return true;
  };

  const visibleColumns = useMemo(
    () => orderedColumns.filter(shouldRenderColumn),
    [orderedColumns, hiddenColumns, showAlphaDetails, showChainIconColumn, showIconColumn]
  );
  const pinnedColumns = useMemo<ColumnId[]>(
    () => (showAlphaDetails ? ['chainIcon', 'tokenIcon', 'token'] : ['token']),
    [showAlphaDetails]
  );
  const firstRightColumn = useMemo(
    () => visibleColumns.find((columnId) => !pinnedColumns.includes(columnId)),
    [visibleColumns, pinnedColumns]
  );

  const tableWidth = useMemo(() => {
    let width = 40;
    if (showChainIconColumn && !isHidden('chainIcon')) width += COLUMN_WIDTHS.chainIcon;
    if (showIconColumn && !isHidden('tokenIcon')) width += COLUMN_WIDTHS.tokenIcon;
    if (!isHidden('token')) width += COLUMN_WIDTHS.token;

    if (showAlphaDetails) {
      if (!isHidden('name')) width += COLUMN_WIDTHS.name;
      if (!isHidden('contractAddress')) width += COLUMN_WIDTHS.contractAddress;
      if (!isHidden('marketCap')) width += COLUMN_WIDTHS.marketCap;
      if (!isHidden('fdv')) width += COLUMN_WIDTHS.fdv;
      if (!isHidden('liquidity')) width += COLUMN_WIDTHS.liquidity;
      if (!isHidden('totalSupply')) width += COLUMN_WIDTHS.totalSupply;
      if (!isHidden('circulatingSupply')) width += COLUMN_WIDTHS.circulatingSupply;
      if (!isHidden('holders')) width += COLUMN_WIDTHS.holders;
      if (!isHidden('listingTime')) width += COLUMN_WIDTHS.listingTime;
    }

    if (!isHidden('price')) width += COLUMN_WIDTHS.price;
    if (!isHidden('volume')) width += COLUMN_WIDTHS.volume;
    if (!isHidden('change1h')) width += COLUMN_WIDTHS.change1h;
    if (!isHidden('change4h')) width += COLUMN_WIDTHS.change4h;
    if (!isHidden('change24h')) width += COLUMN_WIDTHS.change24h;

    return width;
  }, [hiddenColumns, showAlphaDetails, showChainIconColumn, showIconColumn, COLUMN_WIDTHS]);

  const tableGap = useMemo(() => {
    const usableWidth = Math.max(0, tableViewportWidth - SCROLLBAR_WIDTH);
    return Math.max(0, usableWidth - tableWidth);
  }, [tableViewportWidth, tableWidth]);
  const lastPinnedColumn = useMemo<ColumnId | undefined>(() => {
    for (let i = pinnedColumns.length - 1; i >= 0; i -= 1) {
      const columnId = pinnedColumns[i];
      if (visibleColumns.includes(columnId)) return columnId;
    }
    return undefined;
  }, [pinnedColumns, visibleColumns]);
  const expandPinnedColumn = tableGap > 0 && lastPinnedColumn !== undefined;
  const layoutColumnWidths = useMemo(() => {
    if (!expandPinnedColumn || !lastPinnedColumn) return COLUMN_WIDTHS;
    return {
      ...COLUMN_WIDTHS,
      [lastPinnedColumn]: COLUMN_WIDTHS[lastPinnedColumn] + tableGap,
    };
  }, [COLUMN_WIDTHS, expandPinnedColumn, lastPinnedColumn, tableGap]);
  const shouldPushRight = tableGap > 0 && !expandPinnedColumn;
  const maxListingDiff = useMemo(() => {
    if (!showAlphaDetails) return 0;
    const now = Date.now();
    const widthData = widthSourceData ?? data;
    let maxDiff = 0;
    widthData.forEach((item) => {
      if (item.listingTime === undefined) return;
      const diff = Math.abs(item.listingTime - now);
      if (diff > maxDiff) maxDiff = diff;
    });
    return maxDiff;
  }, [showAlphaDetails, widthSourceData, data]);
  const separatorOffsets = useMemo(() => {
    let x = 40;
    const offsets: number[] = [];
    visibleColumns.forEach((columnId) => {
      if (shouldPushRight && columnId === firstRightColumn) x += tableGap;
      offsets.push(x);
      x += layoutColumnWidths[columnId];
    });
    return offsets;
  }, [visibleColumns, firstRightColumn, shouldPushRight, tableGap, layoutColumnWidths]);

  return (
    <div className="flex flex-col border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm h-full w-full">
      <div className="flex-1 min-h-0 overflow-x-auto">
        <div ref={tableRef} className="flex flex-col h-full relative" style={{ width: '100%', minWidth: tableWidth }}>
          {/* Table Header - 移除滚动条属性，改用 padding-right 对齐 */}
          <div 
            className="flex items-center bg-gray-50 border-b border-gray-200 text-[11px] font-bold uppercase tracking-wider text-gray-500" 
            style={{ height: HEADER_HEIGHT, minHeight: HEADER_HEIGHT, paddingRight: `${SCROLLBAR_WIDTH}px` }}
          >
            <div className="w-10 flex-shrink-0"></div>
            {visibleColumns.map((columnId) => {
              const pushRight = shouldPushRight && columnId === firstRightColumn;
              switch (columnId) {
                case 'chainIcon':
                case 'tokenIcon':
                  return (
                    <div
                      key={columnId}
                      className={`flex-shrink-0 ${pushRight ? 'ml-auto' : ''}`}
                      style={{ width: layoutColumnWidths[columnId] }}
                    />
                  );
                case 'token': {
                  return (
                    <button
                      key={columnId}
                      className={`px-4 text-left hover:bg-gray-100 h-full flex items-center group transition-colors flex-shrink-0 ${
                        pushRight ? 'ml-auto' : ''
                      }`}
                      style={{ width: layoutColumnWidths.token }}
                      onClick={() => handleSort('symbol')}
                    >
                      Token <SortIcon field="symbol" />
                    </button>
                  );
                }
                case 'name':
                  return (
                    <button
                      key={columnId}
                      className={`px-3 text-left hover:bg-gray-100 h-full flex items-center group transition-colors flex-shrink-0 ${
                        pushRight ? 'ml-auto' : ''
                      }`}
                      style={{ width: layoutColumnWidths.name }}
                      onClick={() => handleSort('name')}
                    >
                      Name <SortIcon field="name" />
                    </button>
                  );
                case 'contractAddress':
                  return (
                    <button
                      key={columnId}
                      className={`px-3 text-left hover:bg-gray-100 h-full flex items-center group transition-colors flex-shrink-0 ${
                        pushRight ? 'ml-auto' : ''
                      }`}
                      style={{ width: layoutColumnWidths.contractAddress }}
                      onClick={() => handleSort('contractAddress')}
                    >
                      Contract <SortIcon field="contractAddress" />
                    </button>
                  );
                case 'marketCap':
                  return (
                    <button
                      key={columnId}
                      className={`px-3 text-right hover:bg-gray-100 h-full flex items-center justify-end group transition-colors flex-shrink-0 ${
                        pushRight ? 'ml-auto' : ''
                      }`}
                      style={{ width: layoutColumnWidths.marketCap }}
                      onClick={() => handleSort('marketCap')}
                    >
                      Market Cap <SortIcon field="marketCap" />
                    </button>
                  );
                case 'fdv':
                  return (
                    <button
                      key={columnId}
                      className={`px-3 text-right hover:bg-gray-100 h-full flex items-center justify-end group transition-colors flex-shrink-0 ${
                        pushRight ? 'ml-auto' : ''
                      }`}
                      style={{ width: layoutColumnWidths.fdv }}
                      onClick={() => handleSort('fdv')}
                    >
                      FDV <SortIcon field="fdv" />
                    </button>
                  );
                case 'liquidity':
                  return (
                    <button
                      key={columnId}
                      className={`px-3 text-right hover:bg-gray-100 h-full flex items-center justify-end group transition-colors flex-shrink-0 ${
                        pushRight ? 'ml-auto' : ''
                      }`}
                      style={{ width: layoutColumnWidths.liquidity }}
                      onClick={() => handleSort('liquidity')}
                    >
                      Liquidity <SortIcon field="liquidity" />
                    </button>
                  );
                case 'totalSupply':
                  return (
                    <button
                      key={columnId}
                      className={`px-3 text-right hover:bg-gray-100 h-full flex items-center justify-end group transition-colors flex-shrink-0 ${
                        pushRight ? 'ml-auto' : ''
                      }`}
                      style={{ width: layoutColumnWidths.totalSupply }}
                      onClick={() => handleSort('totalSupply')}
                    >
                      Total Supply <SortIcon field="totalSupply" />
                    </button>
                  );
                case 'circulatingSupply':
                  return (
                    <button
                      key={columnId}
                      className={`px-3 text-right hover:bg-gray-100 h-full flex items-center justify-end group transition-colors flex-shrink-0 ${
                        pushRight ? 'ml-auto' : ''
                      }`}
                      style={{ width: layoutColumnWidths.circulatingSupply }}
                      onClick={() => handleSort('circulatingSupply')}
                    >
                      Circ Supply <SortIcon field="circulatingSupply" />
                    </button>
                  );
                case 'holders':
                  return (
                    <button
                      key={columnId}
                      className={`px-3 text-right hover:bg-gray-100 h-full flex items-center justify-end group transition-colors flex-shrink-0 ${
                        pushRight ? 'ml-auto' : ''
                      }`}
                      style={{ width: layoutColumnWidths.holders }}
                      onClick={() => handleSort('holders')}
                    >
                      Holders <SortIcon field="holders" />
                    </button>
                  );
                case 'listingTime':
                  return (
                    <button
                      key={columnId}
                      className={`px-3 text-right hover:bg-gray-100 h-full flex items-center justify-end group transition-colors flex-shrink-0 ${
                        pushRight ? 'ml-auto' : ''
                      }`}
                      style={{ width: layoutColumnWidths.listingTime }}
                      onClick={() => handleSort('listingTime')}
                    >
                      Listing <SortIcon field="listingTime" />
                    </button>
                  );
                case 'price':
                  return (
                    <button
                      key={columnId}
                      className={`px-4 text-right hover:bg-gray-100 h-full flex items-center justify-end group transition-colors flex-shrink-0 ${
                        pushRight ? 'ml-auto' : ''
                      }`}
                      style={{ width: layoutColumnWidths.price }}
                      onClick={() => handleSort('price')}
                    >
                      Price <SortIcon field="price" />
                    </button>
                  );
                case 'volume':
                  return (
                    <button
                      key={columnId}
                      className={`hidden md:flex px-4 text-right hover:bg-gray-100 h-full items-center justify-end group transition-colors flex-shrink-0 ${
                        pushRight ? 'ml-auto' : ''
                      }`}
                      style={{ width: layoutColumnWidths.volume }}
                      onClick={() => handleSort('volume')}
                    >
                      Vol (24h) <SortIcon field="volume" />
                    </button>
                  );
                case 'change1h':
                  return (
                    <button 
                      key={columnId}
                      className={`hidden lg:flex h-full items-center justify-center px-2 text-center group transition-colors flex-shrink-0 hover:bg-gray-100 ${pushRight ? 'ml-auto' : ''}`}
                      style={{ width: layoutColumnWidths.change1h }}
                      onClick={() => handleSort('change1h')}
                    >
                      1h <SortIcon field="change1h" />
                    </button>
                  );
                case 'change4h':
                  return (
                    <button 
                      key={columnId}
                      className={`hidden lg:flex h-full items-center justify-center px-2 text-center group transition-colors flex-shrink-0 hover:bg-gray-100 ${pushRight ? 'ml-auto' : ''}`}
                      style={{ width: layoutColumnWidths.change4h }}
                      onClick={() => handleSort('change4h')}
                    >
                      4h <SortIcon field="change4h" />
                    </button>
                  );
                case 'change24h':
                  return (
                    <button 
                      key={columnId}
                      className={`h-full flex items-center justify-center px-4 text-center group transition-colors flex-shrink-0 hover:bg-gray-100 ${pushRight ? 'ml-auto' : ''}`}
                      style={{ width: layoutColumnWidths.change24h }}
                      onClick={() => handleSort('change24h')}
                    >
                      24h <SortIcon field="change24h" />
                    </button>
                  );
                default:
                  return null;
              }
            })}
          </div>

          {/* Body Container - 强制显示滚动条以保持占位一致 */}
          <div 
            ref={containerRef} 
            className="flex-1 relative overflow-y-scroll overflow-x-hidden"
          >
            <div style={{ height: totalHeight, position: 'relative' }}>
          {visibleData.map((item, index) => {
            const absoluteIndex = startIndex + index;
            const top = absoluteIndex * ROW_HEIGHT;
            const quoteAsset = showAlphaDetails ? '' : (getQuoteAsset(item.symbol) || '');
            const baseAsset = quoteAsset ? item.symbol.replace(quoteAsset, '') : item.symbol;
            const rowKey = item.contractAddress
              ? `${item.symbol}-${item.contractAddress}`
              : item.symbol;

                // Construct External Links
            const alphaChain = item.chainName ? item.chainName.toLowerCase() : '';
            const binanceUrl = showAlphaDetails && alphaChain && item.contractAddress
              ? `https://www.binance.com/zh-CN/alpha/${alphaChain}/${item.contractAddress}?ref=SPL002`
              : `https://www.binance.com/zh-CN/trade/${baseAsset}_${quoteAsset}?ref=SPL002&type=spot`;
                const tradingViewUrl = `https://www.tradingview.com/chart/?symbol=BINANCE:${item.symbol}`;
            const xTokenUrl = `https://x.com/search?q=${encodeURIComponent(`$${baseAsset}`)}&src=typed_query`;
            const xContractUrl = item.contractAddress
              ? `https://x.com/search?q=${encodeURIComponent(item.contractAddress)}&src=typed_query&f=top`
              : null;

                return (
                  <div
                    key={rowKey}
                    className="absolute top-0 left-0 w-full flex items-center border-b border-gray-50 hover:bg-gray-50 transition-colors group"
                    style={{ height: ROW_HEIGHT, transform: `translateY(${top}px)` }}
                  >
                    <div className="w-10 flex items-center justify-center flex-shrink-0">
                      <button onClick={() => onToggleFavorite(item.symbol)} className="p-1.5 rounded-full hover:bg-gray-100 transition-colors">
                        {/* Enlarged star icon to w-5 h-5 (20px) */}
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={`w-5 h-5 ${favorites.has(item.symbol) ? 'fill-yellow-400 text-yellow-400' : 'fill-none text-gray-300 group-hover:text-gray-400'}`} stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                        </svg>
                      </button>
                    </div>

                    {visibleColumns.map((columnId) => {
                      const pushRight = shouldPushRight && columnId === firstRightColumn;
                      switch (columnId) {
                        case 'chainIcon':
                          return (
                            <div
                              key={columnId}
                              className={`flex items-center justify-center flex-shrink-0 ${pushRight ? 'ml-auto' : ''}`}
                              style={{ width: layoutColumnWidths.chainIcon }}
                            >
                              {item.chainIconUrl ? (
                                <img
                                  src={item.chainIconUrl}
                                  alt={`${baseAsset} chain icon`}
                                  className="w-6 h-6 rounded object-contain"
                                  loading="lazy"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <div className="w-6 h-6 rounded bg-gray-100"></div>
                              )}
                            </div>
                          );
                        case 'tokenIcon':
                          return (
                            <div
                              key={columnId}
                              className={`flex items-center justify-center flex-shrink-0 ${pushRight ? 'ml-auto' : ''}`}
                              style={{ width: layoutColumnWidths.tokenIcon }}
                            >
                              {item.iconUrl ? (
                                <img
                                  src={item.iconUrl}
                                  alt={`${baseAsset} icon`}
                                  className="w-6 h-6 rounded object-contain"
                                  loading="lazy"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <div className="w-6 h-6 rounded bg-gray-100"></div>
                              )}
                            </div>
                          );
                        case 'token': {
                          const tokenIconCount = 3 + (xContractUrl ? 1 : 0);
                          const tokenIconAreaWidth = tokenIconCount * ICON_SIZE + (tokenIconCount - 1) * ICON_GAP;
                          const tokenTextMaxWidth = Math.max(
                            0,
                            layoutColumnWidths.token - TOKEN_PADDING - TOKEN_GAP - tokenIconAreaWidth
                          );
                          return (
                            <div
                              key={columnId}
                              className={`px-4 flex items-center gap-2 flex-shrink-0 overflow-hidden ${
                                pushRight ? 'ml-auto' : ''
                              }`}
                              style={{ width: layoutColumnWidths.token }}
                            >
                              <div
                                className="flex items-baseline min-w-0 truncate"
                                style={{ maxWidth: tokenTextMaxWidth }}
                              >
                                <span className="font-bold text-gray-900 truncate">{baseAsset}</span>
                                {quoteAsset && (
                                  <span className="text-[10px] text-gray-400 ml-1 font-medium truncate">{quoteAsset}</span>
                                )}
                              </div>
                              
                              {/* External Links - Always Visible */}
                              <div className="flex items-center space-x-1 flex-shrink-0">
                                <a href={binanceUrl} target="_blank" rel="noopener noreferrer" className="w-6 h-6 flex items-center justify-center rounded text-gray-300 hover:text-white hover:bg-black transition-colors" title="Trade on Binance">
                                  <BinanceIcon />
                                </a>
                                <a href={tradingViewUrl} target="_blank" rel="noopener noreferrer" className="w-6 h-6 flex items-center justify-center rounded text-gray-300 hover:text-white hover:bg-black transition-colors" title="View on TradingView">
                                  <TradingViewIcon />
                                </a>
                                <a
                                  href={xTokenUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="w-6 h-6 flex items-center justify-center rounded text-gray-300 hover:text-white hover:bg-black transition-colors"
                                  title="Search on X (Token)"
                                >
                                  <XIcon />
                                </a>
                              {xContractUrl && (
                                <a
                                  href={xContractUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="w-6 h-6 flex items-center justify-center rounded text-gray-300 hover:text-white hover:bg-black transition-colors"
                                  title="Search on X (Contract)"
                                >
                                  <XIcon />
                                </a>
                                )}
                              </div>
                            </div>
                          );
                        }
                        case 'name':
                          return (
                            <div
                              key={columnId}
                              className={`px-3 text-left text-[13px] text-gray-900 truncate flex-shrink-0 ${
                                pushRight ? 'ml-auto' : ''
                              }`}
                              style={{ width: layoutColumnWidths.name }}
                              title={item.name || ''}
                            >
                              {item.name || '-'}
                            </div>
                          );
                        case 'contractAddress':
                          return (
                            <div
                              key={columnId}
                              className={`px-3 text-left font-mono text-[12px] text-gray-700 truncate flex-shrink-0 ${
                                pushRight ? 'ml-auto' : ''
                              }`}
                              style={{ width: layoutColumnWidths.contractAddress }}
                              title={item.contractAddress || ''}
                            >
                              {item.contractAddress || '-'}
                            </div>
                          );
                        case 'marketCap':
                          return (
                            <div
                              key={columnId}
                              className={`px-3 text-right font-mono text-[14px] text-gray-900 flex-shrink-0 ${
                                pushRight ? 'ml-auto' : ''
                              }`}
                              style={{ width: layoutColumnWidths.marketCap }}
                            >
                              {formatBigNumber(item.marketCap)}
                            </div>
                          );
                        case 'fdv':
                          return (
                            <div
                              key={columnId}
                              className={`px-3 text-right font-mono text-[14px] text-gray-900 flex-shrink-0 ${
                                pushRight ? 'ml-auto' : ''
                              }`}
                              style={{ width: layoutColumnWidths.fdv }}
                            >
                              {formatBigNumber(item.fdv)}
                            </div>
                          );
                        case 'liquidity':
                          return (
                            <div
                              key={columnId}
                              className={`px-3 text-right font-mono text-[14px] text-gray-900 flex-shrink-0 ${
                                pushRight ? 'ml-auto' : ''
                              }`}
                              style={{ width: layoutColumnWidths.liquidity }}
                            >
                              {formatBigNumber(item.liquidity)}
                            </div>
                          );
                        case 'totalSupply':
                          return (
                            <div
                              key={columnId}
                              className={`px-3 text-right font-mono text-[14px] text-gray-900 flex-shrink-0 ${
                                pushRight ? 'ml-auto' : ''
                              }`}
                              style={{ width: layoutColumnWidths.totalSupply }}
                            >
                              {formatBigNumber(item.totalSupply)}
                            </div>
                          );
                        case 'circulatingSupply':
                          return (
                            <div
                              key={columnId}
                              className={`px-3 text-right font-mono text-[14px] text-gray-900 flex-shrink-0 ${
                                pushRight ? 'ml-auto' : ''
                              }`}
                              style={{ width: layoutColumnWidths.circulatingSupply }}
                            >
                              {formatBigNumber(item.circulatingSupply)}
                            </div>
                          );
                        case 'holders':
                          return (
                            <div
                              key={columnId}
                              className={`px-3 text-right font-mono text-[14px] text-gray-900 flex-shrink-0 ${
                                pushRight ? 'ml-auto' : ''
                              }`}
                              style={{ width: layoutColumnWidths.holders }}
                            >
                              {formatInteger(item.holders)}
                            </div>
                          );
                        case 'listingTime':
                          return (
                            <div
                              key={columnId}
                              className={`px-3 text-right font-mono text-[14px] text-gray-900 flex-shrink-0 h-full flex items-center justify-end ${
                                pushRight ? 'ml-auto' : ''
                              }`}
                              style={{ width: layoutColumnWidths.listingTime, backgroundColor: getListingBackgroundColor(item.listingTime) }}
                            >
                              {formatDate(item.listingTime)}
                            </div>
                          );
                        case 'price':
                          return (
                            <div
                              key={columnId}
                              className={`px-4 text-right font-mono text-[15px] text-gray-900 flex-shrink-0 ${
                                pushRight ? 'ml-auto' : ''
                              }`}
                              style={{ width: layoutColumnWidths.price }}
                            >
                              {formatPrice(item.price)}
                            </div>
                          );
                        case 'volume':
                          return (
                            <div
                              key={columnId}
                              className={`hidden md:flex px-4 text-right font-mono text-[15px] text-gray-900 items-center justify-end flex-shrink-0 ${
                                pushRight ? 'ml-auto' : ''
                              }`}
                              style={{ width: layoutColumnWidths.volume }}
                            >
                              {formatVolume(item.volume)}
                            </div>
                          );
                        case 'change1h':
                          return (
                            <div
                              key={columnId}
                              className={`hidden lg:flex h-full items-center justify-center font-mono text-[15px] text-gray-700 flex-shrink-0 ${pushRight ? 'ml-auto' : ''}`}
                              style={{ width: layoutColumnWidths.change1h, backgroundColor: getCellBackgroundColor(item.changePercent1h) }}
                            >
                              {formatPercent(item.changePercent1h)}
                            </div>
                          );
                        case 'change4h':
                          return (
                            <div
                              key={columnId}
                              className={`hidden lg:flex h-full items-center justify-center font-mono text-[15px] text-gray-700 flex-shrink-0 ${pushRight ? 'ml-auto' : ''}`}
                              style={{ width: layoutColumnWidths.change4h, backgroundColor: getCellBackgroundColor(item.changePercent4h) }}
                            >
                              {formatPercent(item.changePercent4h)}
                            </div>
                          );
                        case 'change24h':
                          return (
                            <div
                              key={columnId}
                              className={`h-full flex items-center justify-center font-mono text-[15px] text-gray-700 flex-shrink-0 ${pushRight ? 'ml-auto' : ''}`}
                              style={{ width: layoutColumnWidths.change24h, backgroundColor: getCellBackgroundColor(item.changePercent24h) }}
                            >
                              {formatPercent(item.changePercent24h)}
                            </div>
                          );
                        default:
                          return null;
                      }
                    })}
                  </div>
                );
              })}
            </div>
          </div>
          {separatorOffsets.length > 0 && (
            <div className="pointer-events-none absolute inset-0 z-10">
              {separatorOffsets.map((offset) => (
                <div key={offset} className="absolute top-0 bottom-0 w-px bg-gray-100" style={{ left: offset }} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
