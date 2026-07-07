// Yahoo Finance v8 Chart API — no API key required, works for US + Japan stocks
import type { StockQuote, HistoricalBar, FundamentalsData, SearchResult } from '@/types'

const CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart'
const SEARCH_BASE = 'https://query2.finance.yahoo.com/v1/finance/search'
const QUOTE_SUMMARY_BASE = 'https://query1.finance.yahoo.com/v11/finance/quoteSummary'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
}

function periodToParams(period: string): { range: string; interval: string } {
  const map: Record<string, { range: string; interval: string }> = {
    '1m':   { range: '1d',  interval: '1m' },
    '5m':   { range: '1d',  interval: '5m' },
    '15m':  { range: '5d',  interval: '15m' },
    '30m':  { range: '5d',  interval: '30m' },
    '1h':   { range: '1mo', interval: '60m' },
    '1d':   { range: '1d',  interval: '5m' },
    '5d':   { range: '5d',  interval: '30m' },
    '1mo':  { range: '1mo', interval: '1d' },
    '3mo':  { range: '3mo', interval: '1d' },
    '6mo':  { range: '6mo', interval: '1d' },
    '1y':   { range: '1y',  interval: '1d' },
    '2y':   { range: '2y',  interval: '1wk' },
  }
  return map[period] ?? { range: '3mo', interval: '1d' }
}

function detectMarket(symbol: string): StockQuote['market'] {
  if (symbol.endsWith('.T')) return 'JP'
  if (/^[A-Z]{1,5}$/.test(symbol)) return 'US'
  return 'OTHER'
}

async function yfFetch(url: string): Promise<any> {
  const res = await fetch(url, { headers: HEADERS, next: { revalidate: 60 } })
  if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status}`)
  const json = await res.json()
  const result = json?.chart?.result?.[0]
  if (!result) {
    const err = json?.chart?.error?.description ?? 'No data returned'
    throw new Error(err)
  }
  return result
}

export async function yfDirectGetQuote(symbol: string): Promise<StockQuote> {
  const result = await yfFetch(`${CHART_BASE}/${encodeURIComponent(symbol)}?range=5d&interval=1d`)
  const meta = result.meta

  const currency: string = meta.currency ?? (symbol.endsWith('.T') ? 'JPY' : 'USD')
  const price: number = meta.regularMarketPrice ?? meta.chartPreviousClose ?? 0
  const prevClose: number = meta.chartPreviousClose ?? meta.previousClose ?? price
  const change = parseFloat((price - prevClose).toFixed(currency === 'JPY' ? 1 : 2))
  const changePercent = parseFloat(((change / prevClose) * 100).toFixed(2))

  return {
    symbol,
    name: meta.longName ?? meta.shortName ?? symbol,
    price,
    change,
    changePercent,
    volume: meta.regularMarketVolume ?? 0,
    currency,
    market: detectMarket(symbol),
    isMarketOpen: meta.marketState === 'REGULAR',
    lastUpdated: new Date(meta.regularMarketTime * 1000).toISOString(),
  }
}

export async function yfDirectGetHistory(symbol: string, period: string): Promise<HistoricalBar[]> {
  const { range, interval } = periodToParams(period)
  const result = await yfFetch(
    `${CHART_BASE}/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`
  )

  const timestamps: number[] = result.timestamp ?? []
  const ohlcv = result.indicators?.quote?.[0]
  if (!ohlcv || timestamps.length === 0) return []

  return timestamps.map((t: number, i: number) => ({
    time:   t,
    open:   ohlcv.open?.[i]   ?? ohlcv.close?.[i] ?? 0,
    high:   ohlcv.high?.[i]   ?? ohlcv.close?.[i] ?? 0,
    low:    ohlcv.low?.[i]    ?? ohlcv.close?.[i] ?? 0,
    close:  ohlcv.close?.[i]  ?? 0,
    volume: ohlcv.volume?.[i] ?? 0,
  })).filter(b => b.close > 0)
}

export async function yfDirectGetFundamentals(symbol: string): Promise<FundamentalsData> {
  try {
    const url = `${QUOTE_SUMMARY_BASE}/${encodeURIComponent(symbol)}?modules=summaryDetail,defaultKeyStatistics,financialData`
    const res = await fetch(url, { headers: HEADERS, next: { revalidate: 3600 } })
    if (!res.ok) throw new Error(`Yahoo Finance quoteSummary HTTP ${res.status}`)
    const json = await res.json()
    const result = json?.quoteSummary?.result?.[0]
    if (!result) throw new Error('No quoteSummary data')

    const sd = result.summaryDetail ?? {}
    const ks = result.defaultKeyStatistics ?? {}
    const fd = result.financialData ?? {}

    return {
      pe:             sd.trailingPE?.raw           ?? undefined,
      pb:             sd.priceToBook?.raw          ?? undefined,
      pegRatio:       ks.pegRatio?.raw             ?? undefined,
      evToEbitda:     ks.enterpriseToEbitda?.raw   ?? undefined,
      roe:            fd.returnOnEquity?.raw        ?? undefined,
      roa:            fd.returnOnAssets?.raw        ?? undefined,
      operatingMargin: fd.operatingMargins?.raw    ?? undefined,
      grossMargin:    fd.grossMargins?.raw          ?? undefined,
      profitMargin:   fd.profitMargins?.raw         ?? undefined,
      eps:            ks.trailingEps?.raw           ?? undefined,
      freeCashflow:   fd.freeCashflow?.raw          ?? undefined,
      debtToEquity:   fd.debtToEquity?.raw          ?? undefined,
      currentRatio:   fd.currentRatio?.raw          ?? undefined,
      revenueGrowth:  fd.revenueGrowth?.raw         ?? undefined,
      earningsGrowth: fd.earningsGrowth?.raw        ?? undefined,
      marketCap:      sd.marketCap?.raw             ?? undefined,
      dividendYield:  sd.dividendYield?.raw         ?? undefined,
      week52High:     sd.fiftyTwoWeekHigh?.raw      ?? undefined,
      week52Low:      sd.fiftyTwoWeekLow?.raw       ?? undefined,
    }
  } catch (err) {
    // 原則9: 実データ取得失敗時にモック（架空PER/ROE）を返すと、AI投資家がニセ指標で
    // 売買判断してしまう。フォールバックせず空を返し「データなし」として扱わせる。
    console.warn(`[yahoodirect] fundamentals unavailable for ${symbol}:`, String(err))
    return {}
  }
}

export async function yfDirectSearch(query: string): Promise<SearchResult[]> {
  try {
    const res = await fetch(
      `${SEARCH_BASE}?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`,
      { headers: HEADERS, next: { revalidate: 300 } }
    )
    if (!res.ok) return []
    const json = await res.json()
    const quotes: any[] = json?.finance?.result?.[0]?.quotes ?? []
    const seen = new Set<string>()
    return quotes
      .filter((q: any) => q.quoteType === 'EQUITY' || q.quoteType === 'ETF')
      .filter((q: any) => {
        if (seen.has(q.symbol)) return false
        seen.add(q.symbol)
        return true
      })
      .map((q: any) => ({
        symbol: q.symbol,
        name:   q.longname ?? q.shortname ?? q.symbol,
        type:   q.quoteType ?? 'EQUITY',
        market: detectMarket(q.symbol),
      }))
      .slice(0, 8)
  } catch {
    return []
  }
}
