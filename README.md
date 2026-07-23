# JJ Board

一个基于 React + Vite 的 Binance 行情看板，实时展示现货（Spot）与 Alpha 代币行情。

<img width="1728" height="957" alt="JJ Board 截图" src="https://github.com/user-attachments/assets/27afe552-f0d7-4030-abbc-5cba8bf2a722" />

## 功能

### BN Spot（现货行情）
- WebSocket 实时推送行情，REST 快照秒开首屏
- 展示价格、24h 成交额、1h / 4h / 24h 涨跌幅（1h / 4h 后台自动补齐）
- 按计价币种筛选（USDT / USDC / BTC 等，可多选）
- 符号搜索、收藏（Favorites）视图
- 虚拟滚动表格，上千个交易对也能流畅渲染

### BN Alpha（Alpha 代币）
- 每 10 秒自动刷新 Binance Alpha 代币列表
- 展示价格、24h 成交额与涨跌幅、市值、FDV、流动性、持有人数、上线时间、合约地址等
- 列可显示 / 隐藏、拖拽排序，配置自动保存
- 支持按符号、名称、合约地址搜索，支持收藏

### BN Perp（U 本位永续合约）
- WebSocket 实时推送全市场行情与标记价格，REST 快照秒开首屏
- 展示最新价、标记价格（Mark）、资金费率（Funding）、下次资金结算倒计时、持仓量（OI，USDT 计价）、24h 成交额与涨跌幅
- 持仓量后台逐个自动补齐，并定期刷新保持新鲜
- 符号搜索、独立的收藏（Favorites）视图
- 行内快捷链接直达币安合约交易页与 TradingView 永续图表

### 通用
- 收藏、筛选、列配置保存在浏览器 localStorage，刷新不丢失
- 每个标签页有独立 URL（`/spot`、`/alpha`、`/perp`），支持浏览器前进 / 后退

## 快速开始

```bash
npm install    # 安装依赖
npm run dev    # 启动开发服务器，浏览器打开 http://localhost:3000
npm run build  # 构建生产版本（输出到 dist/）
```

## 部署（Vercel）

把仓库导入 Vercel 即可一键部署，无需额外配置：

- `vercel.json`：SPA 路由回退（直接刷新 `/alpha` 等路径不会 404），并把 Serverless Functions 固定在东京节点（`hnd1`），避免 Binance 屏蔽美国 IP
- `api/` 目录：Vercel Serverless Functions，在服务端代理 Binance 接口（绕过浏览器 CORS 限制）

## 项目结构

```
JJBoard/
├── App.tsx                  # 主组件：标签页、工具栏、筛选、Alpha 数据拉取
├── index.tsx                # React 入口
├── index.html               # HTML 模板（Tailwind CDN、全局样式）
├── components/
│   └── VirtualTable.tsx     # 虚拟滚动表格（排序、列宽自适应、收藏等）
├── services/
│   ├── binanceService.ts    # 现货数据服务：REST 快照 + WebSocket 实时推送
│   └── binanceFuturesService.ts  # 合约数据服务：行情/标记价/资金费率 + OI 懒加载
├── api/
│   ├── alpha.js             # Serverless：代理 Binance Alpha 代币列表接口
│   └── snapshot.js          # Serverless：代理现货 24h 行情快照
├── types.ts                 # TypeScript 类型定义
├── tokenMappings.ts         # 历史遗留占位文件（已不再使用）
├── favicon/                 # 网站图标
├── vite.config.ts           # Vite 配置（本地开发时把 /bapi 代理到 binance.com）
├── vercel.json              # Vercel 路由与区域配置
└── package.json
```

## 数据来源

- **现货**：Binance 公开行情 API（`data-api.binance.vision` 等）与 WebSocket，浏览器直连
- **合约**：Binance U 本位合约公开 API（`fapi.binance.com`）与 WebSocket（`fstream.binance.com`），浏览器直连；持仓量通过 `/fapi/v1/openInterest` 逐个懒加载
- **Alpha**：Binance BAPI 的 Alpha 代币列表接口。该接口不允许浏览器跨域直连，前端按顺序尝试以下通道，任一成功即用：
  1. `/api/alpha` — Vercel Serverless 代理（线上环境）
  2. `/bapi/...` — Vite 本地开发代理
  3. `corsproxy.io`、`allorigins.win` — 公共 CORS 代理（兜底）
