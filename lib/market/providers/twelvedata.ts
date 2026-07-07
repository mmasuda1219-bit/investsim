// Twelve Data provider — real market data for US stocks + major JP ADRs
// Docs: https://twelvedata.com/docs
import type { StockQuote, HistoricalBar, FundamentalsData, SearchResult } from '@/types'

const API_KEY = process.env.TWELVE_DATA_API_KEY!
const BASE = 'https://api.twelvedata.com'

// Twelve Data returns data newest-first; we need oldest-first for charts
async function tdFetch(path: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`, { next: { revalidate: 60 } })
  if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`)
  const json = await res.json()
  if (json.code && json.code !== 200) throw new Error(json.message ?? 'Twelve Data error')
  return json
}

// Map our period to Twelve Data interval + outputsize
function periodToParams(period: string): { interval: string; outputsize: number } {
  const map: Record<string, { interval: string; outputsize: number }> = {
    '1d':  { interval: '5min',  outputsize: 78 },
    '5d':  { interval: '30min', outputsize: 80 },
    '1mo': { interval: '1day',  outputsize: 22 },
    '3mo': { interval: '1day',  outputsize: 65 },
    '6mo': { interval: '1day',  outputsize: 130 },
    '1y':  { interval: '1day',  outputsize: 260 },
    '2y':  { interval: '1week', outputsize: 104 },
  }
  return map[period] ?? { interval: '1day', outputsize: 65 }
}

function detectMarket(symbol: string): StockQuote['market'] {
  if (symbol.endsWith('.T')) return 'JP'
  if (/^[A-Z]{1,5}$/.test(symbol)) return 'US'
  return 'OTHER'
}

// Convert .T suffix to TM (ADR) or drop for unsupported JP stocks
function normalizeSymbol(symbol: string): string {
  // Twelve Data basic plan supports US stocks natively
  // For known JP stocks, use their US ADR ticker
  const jpToAdr: Record<string, string> = {
    '7203.T': 'TM',     // Toyota → TM (NYSE)
    '6758.T': 'SONY',   // Sony → SONY (NYSE)
    '9984.T': 'SFTBY',  // SoftBank → SFTBY (OTC)
    '6861.T': 'KYCCF',  // Keyence → OTC
    '8306.T': 'MUFG',   // MUFG → NYSE
  }
  return jpToAdr[symbol] ?? symbol.replace('.T', '')
}

export async function tdGetQuote(symbol: string): Promise<StockQuote> {
  const sym = normalizeSymbol(symbol)
  const data = await tdFetch(`/quote?symbol=${sym}&apikey=${API_KEY}`)

  return {
    symbol,
    name:          data.name ?? sym,
    price:         parseFloat(data.close ?? data.price ?? '0'),
    change:        parseFloat(data.change ?? '0'),
    changePercent: parseFloat(data.percent_change ?? '0'),
    volume:        parseInt(data.volume ?? '0', 10),
    currency:      data.currency ?? (symbol.endsWith('.T') ? 'JPY' : 'USD'),
    market:        detectMarket(symbol),
    isMarketOpen:  data.is_market_open ?? false,
    lastUpdated:   new Date().toISOString(),
  }
}

export async function tdGetHistory(symbol: string, period: string): Promise<HistoricalBar[]> {
  const sym = normalizeSymbol(symbol)
  const { interval, outputsize } = periodToParams(period)
  const data = await tdFetch(
    `/time_series?symbol=${sym}&interval=${interval}&outputsize=${outputsize}&apikey=${API_KEY}`
  )

  const values: any[] = data.values ?? []
  return values
    .reverse()
    .map((v: any) => ({
      time:   Math.floor(new Date(v.datetime).getTime() / 1000),
      open:   parseFloat(v.open),
      high:   parseFloat(v.high),
      low:    parseFloat(v.low),
      close:  parseFloat(v.close),
      volume: parseInt(v.volume ?? '0', 10),
    }))
}

export async function tdGetFundamentals(symbol: string): Promise<FundamentalsData> {
  // Fundamentals require Grow plan ($29/mo) on Twelve Data.
  // Fall back to mock fundamentals for known symbols so Buffett/Lynch signals work.
  const { mockGetFundamentals } = await import('./mock')
  return mockGetFundamentals(symbol)
}

export async function tdSearch(query: string): Promise<SearchResult[]> {
  try {
    const data = await tdFetch(`/symbol_search?symbol=${encodeURIComponent(query)}&outputsize=20&apikey=${API_KEY}`)
    const seen = new Set<string>()
    return (data.data ?? [])
      .filter((s: any) => s.instrument_type === 'Common Stock' || s.instrument_type === 'ETF')
      .filter((s: any) => {
        if (seen.has(s.symbol)) return false
        seen.add(s.symbol)
        return true
      })
      .map((s: any) => ({
        symbol: s.symbol,
        name:   s.instrument_name ?? s.symbol,
        type:   s.instrument_type ?? 'EQUITY',
        market: detectMarket(s.symbol),
      }))
      .slice(0, 8)
  } catch {
    return []
  }
}
