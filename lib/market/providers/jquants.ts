// J-Quants API v2 provider — Japanese stocks (TSE) in JPY
// Auth: x-api-key header (registered after 2025-12-22)
// Free plan covers data up to ~3 months ago; recent data needs paid plan
// Docs: https://jpx-jquants.com/spec/

import type { StockQuote, HistoricalBar, FundamentalsData, SearchResult } from '@/types'

const API_KEY = process.env.JQUANTS_API_KEY!
const BASE = 'https://api.jquants.com/v2'

async function jqFetch(path: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'x-api-key': API_KEY },
    next: { revalidate: 300 },
  })
  const json = await res.json()
  if (json.message) throw new Error(json.message)
  return json
}

// Strip .T suffix → 4-digit code for J-Quants (7203.T → 72030, appended with 0)
function toJQCode(symbol: string): string {
  const code = symbol.replace('.T', '')
  return code.length === 4 ? code + '0' : code
}

// Get the latest available date within free plan range
function getLatestAvailableDate(): string {
  // Free plan max date: 2026-02-27
  // Use 2026-02-27 as the ceiling
  const ceiling = new Date('2026-02-27')
  const today = new Date()
  const d = today < ceiling ? today : ceiling
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

function getFromDate(period: string): string {
  const ceiling = new Date('2026-02-27')
  const today = new Date()
  const end = today < ceiling ? today : ceiling
  const start = new Date(end)

  const offsets: Record<string, () => void> = {
    '1d':  () => start.setDate(end.getDate() - 2),
    '5d':  () => start.setDate(end.getDate() - 7),
    '1mo': () => start.setMonth(end.getMonth() - 1),
    '3mo': () => start.setMonth(end.getMonth() - 3),
    '6mo': () => start.setMonth(end.getMonth() - 6),
    '1y':  () => start.setFullYear(end.getFullYear() - 1),
    '2y':  () => start.setFullYear(end.getFullYear() - 2),
  }
  ;(offsets[period] ?? offsets['3mo'])()

  // Clamp to subscription start
  const subscriptionStart = new Date('2024-02-27')
  if (start < subscriptionStart) start.setTime(subscriptionStart.getTime())

  return start.toISOString().slice(0, 10).replace(/-/g, '')
}

const JP_NAMES: Record<string, string> = {
  '7203': 'トヨタ自動車',
  '6758': 'ソニーグループ',
  '9984': 'ソフトバンクグループ',
  '6861': 'キーエンス',
  '8306': '三菱UFJフィナンシャルグループ',
  '9432': 'NTT',
  '7974': '任天堂',
  '6367': 'ダイキン工業',
  '4063': '信越化学工業',
  '8035': '東京エレクトロン',
}

export async function jqGetQuote(symbol: string): Promise<StockQuote> {
  const code = toJQCode(symbol)
  const toDate = getLatestAvailableDate()
  const fromDate = (() => { const d = new Date(toDate.slice(0,4)+'-'+toDate.slice(4,6)+'-'+toDate.slice(6)); d.setDate(d.getDate()-7); return d.toISOString().slice(0,10).replace(/-/g,'') })()

  const data = await jqFetch(`/equities/bars/daily?code=${code}&from=${fromDate}&to=${toDate}`)
  const bars: any[] = data.data ?? []
  if (bars.length === 0) throw new Error(`No data for ${symbol}`)

  const latest = bars[bars.length - 1]
  const prev = bars.length > 1 ? bars[bars.length - 2] : null

  const price = latest.AdjC
  const prevPrice = prev?.AdjC ?? price
  const change = parseFloat((price - prevPrice).toFixed(1))
  const changePercent = parseFloat(((change / prevPrice) * 100).toFixed(2))

  return {
    symbol,
    name: JP_NAMES[code.slice(0, 4)] ?? symbol,
    price,
    change,
    changePercent,
    volume: latest.AdjVo ?? 0,
    currency: 'JPY',
    market: 'JP',
    isMarketOpen: false, // Free plan doesn't have real-time; show as delayed
    lastUpdated: latest.Date,
  }
}

export async function jqGetHistory(symbol: string, period: string): Promise<HistoricalBar[]> {
  const code = toJQCode(symbol)
  const fromDate = getFromDate(period)
  const toDate = getLatestAvailableDate()

  const data = await jqFetch(`/equities/bars/daily?code=${code}&from=${fromDate}&to=${toDate}`)
  const bars: any[] = data.data ?? []

  return bars.map((b: any) => ({
    time:   Math.floor(new Date(b.Date).getTime() / 1000),
    open:   b.AdjO,
    high:   b.AdjH,
    low:    b.AdjL,
    close:  b.AdjC,
    volume: b.AdjVo ?? 0,
  }))
}

export async function jqGetFundamentals(_symbol: string): Promise<FundamentalsData> {
  // J-Quantsのファンダメンタルズは上位プランが必要。原則9によりモック（架空値）は返さず、
  // 空を返して「データなし」として扱わせる（ニセ指標でのAI判断を防ぐ）。
  return {}
}

const JP_SEARCH: SearchResult[] = [
  { symbol: '7203.T', name: 'トヨタ自動車',              type: 'EQUITY', market: 'JP' },
  { symbol: '6758.T', name: 'ソニーグループ',             type: 'EQUITY', market: 'JP' },
  { symbol: '9984.T', name: 'ソフトバンクグループ',       type: 'EQUITY', market: 'JP' },
  { symbol: '6861.T', name: 'キーエンス',                type: 'EQUITY', market: 'JP' },
  { symbol: '8306.T', name: '三菱UFJフィナンシャルグループ', type: 'EQUITY', market: 'JP' },
  { symbol: '9432.T', name: 'NTT（日本電信電話）',        type: 'EQUITY', market: 'JP' },
  { symbol: '7974.T', name: '任天堂',                    type: 'EQUITY', market: 'JP' },
  { symbol: '6367.T', name: 'ダイキン工業',              type: 'EQUITY', market: 'JP' },
  { symbol: '4063.T', name: '信越化学工業',              type: 'EQUITY', market: 'JP' },
  { symbol: '8035.T', name: '東京エレクトロン',           type: 'EQUITY', market: 'JP' },
]

export function jqSearch(query: string): SearchResult[] {
  const q = query.toLowerCase()
  const aliases: Record<string, string[]> = {
    '7203.T': ['toyota', 'トヨタ', 'toyoda'],
    '6758.T': ['sony', 'ソニー'],
    '9984.T': ['softbank', 'ソフトバンク'],
    '6861.T': ['keyence', 'キーエンス'],
    '8306.T': ['mufg', '三菱', 'mitsubishi'],
    '9432.T': ['ntt', '日本電信'],
    '7974.T': ['nintendo', '任天堂'],
    '6367.T': ['daikin', 'ダイキン'],
    '4063.T': ['shinetsu', '信越'],
    '8035.T': ['tokyo electron', 'tel', '東エレ'],
  }
  return JP_SEARCH.filter((s) =>
    s.symbol.toLowerCase().includes(q) ||
    s.name.includes(query) ||
    (aliases[s.symbol] ?? []).some((a) => a.toLowerCase().includes(q))
  )
}
