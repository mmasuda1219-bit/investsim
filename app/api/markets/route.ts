import { NextResponse } from 'next/server'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
}

interface IndexData {
  symbol: string
  name: string
  price: number
  change: number
  changePercent: number
}

const FALLBACKS: Record<string, IndexData> = {
  '^GSPC':  { symbol: '^GSPC',  name: 'S&P 500',        price: 5428,  change: 0, changePercent: 0 },
  '^IXIC':  { symbol: '^IXIC',  name: 'NASDAQ',          price: 17397, change: 0, changePercent: 0 },
  '^DJI':   { symbol: '^DJI',   name: 'ダウ平均',         price: 39308, change: 0, changePercent: 0 },
  '^VIX':   { symbol: '^VIX',   name: 'VIX',             price: 18.5,  change: 0, changePercent: 0 },
  '^TNX':   { symbol: '^TNX',   name: '10年米国債利回り', price: 4.28,  change: 0, changePercent: 0 },
  '^W5000': { symbol: '^W5000', name: 'Wilshire 5000',   price: 56200, change: 0, changePercent: 0 },
}

async function fetchIndex(symbol: string): Promise<IndexData> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`
    const res = await fetch(url, { headers: HEADERS, next: { revalidate: 300 } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    const meta = json?.chart?.result?.[0]?.meta
    if (!meta) throw new Error('no meta')
    const price = meta.regularMarketPrice ?? meta.chartPreviousClose ?? 0
    const prevClose = meta.chartPreviousClose ?? price
    const change = parseFloat((price - prevClose).toFixed(2))
    const changePercent = parseFloat(((change / prevClose) * 100).toFixed(2))
    return {
      symbol,
      name: FALLBACKS[symbol]?.name ?? meta.shortName ?? symbol,
      price,
      change,
      changePercent,
    }
  } catch {
    return FALLBACKS[symbol] ?? { symbol, name: symbol, price: 0, change: 0, changePercent: 0 }
  }
}

export async function GET() {
  const SYMBOLS = ['^GSPC', '^IXIC', '^DJI', '^VIX', '^TNX', '^W5000']
  const indices = await Promise.all(SYMBOLS.map(fetchIndex))

  // Buffett Indicator
  const w5000 = indices.find(i => i.symbol === '^W5000')
  const US_GDP_BILLIONS = 29200  // 2024年 米国GDP（十億ドル）
  // Wilshire5000 index level ≈ total market cap in billions (approximation)
  const marketCapBillions = w5000 ? w5000.price : 56200
  const buffettIndicator = parseFloat(((marketCapBillions / US_GDP_BILLIONS) * 100).toFixed(1))

  // Buffett Indicator interpretation
  const buffettLevel =
    buffettIndicator < 75  ? { label: '著しく割安', color: 'green' } :
    buffettIndicator < 90  ? { label: '割安',       color: 'green' } :
    buffettIndicator < 115 ? { label: '適正水準',   color: 'yellow' } :
    buffettIndicator < 135 ? { label: '割高',       color: 'orange' } :
                             { label: '著しく割高', color: 'red' }

  return NextResponse.json({
    indices: indices.filter(i => i.symbol !== '^W5000'),
    buffettIndicator: {
      value: buffettIndicator,
      marketCap: marketCapBillions,
      gdp: US_GDP_BILLIONS,
      ...buffettLevel,
    },
  }, {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' }
  })
}
