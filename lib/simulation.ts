// Auto-trading simulation engine
// Uses investor analyze() logic to make buy/sell decisions over 1 month of real price data

import type { FundamentalsData, HistoricalBar } from '@/types'
import { getHistory, getFundamentals } from '@/lib/market'

export interface SimConfig {
  investorId: string
  startCapital: number
  symbols: string[]
}

export interface SimTrade {
  date: string
  symbol: string
  name: string
  action: 'buy' | 'sell'
  shares: number
  price: number
  total: number
  reasons: string[]
}

export interface SimDayValue {
  date: string
  value: number
}

export interface SimStockResult {
  symbol: string
  name: string
  signal: 'buy' | 'hold' | 'sell'
  buyPrice: number | null
  currentPrice: number
  pnl: number
  pnlPct: number
  bought: boolean
}

export interface SimResult {
  investorId: string
  investorName: string
  investorNameJa: string
  startCapital: number
  finalValue: number
  pnl: number
  pnlPct: number
  winningPositions: number
  losingPositions: number
  winRate: number
  trades: SimTrade[]
  dailyValues: SimDayValue[]
  stockResults: SimStockResult[]
  simulationDays: number
  startDate: string
  endDate: string
}

interface Position {
  symbol: string
  name: string
  shares: number
  avgCost: number
  buyDate: string
}

const POSITION_SIZE_PCT = 0.20  // 20% of starting capital per position
const MAX_POSITIONS = 5

function getDateStr(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10)
}

function getInvestorInfo(id: string): { name: string; nameJa: string } {
  const map: Record<string, { name: string; nameJa: string }> = {
    buffett: { name: 'Warren Buffett', nameJa: 'バフェット戦略' },
    soros:   { name: 'George Soros',   nameJa: 'ソロス戦略' },
    lynch:   { name: 'Peter Lynch',    nameJa: 'リンチ戦略' },
    graham:  { name: 'Benjamin Graham', nameJa: 'グレアム戦略' },
    dalio:   { name: 'Ray Dalio',      nameJa: 'ダリオ戦略' },
  }
  return map[id] ?? { name: id, nameJa: id }
}

export async function runSimulation(config: SimConfig): Promise<SimResult> {
  const { investorId, startCapital, symbols } = config
  const { name, nameJa } = getInvestorInfo(investorId)

  // Load investor logic dynamically
  const investorsModule = await import('@/lib/investors')
  const invFound = investorsModule.default.find(i => i.id === investorId)
  if (!invFound) throw new Error(`Unknown investor: ${investorId}`)
  const inv = invFound

  // Fetch historical data (3 months for warmup + 1 month simulation)
  const [historyMap, fundamentalsMap] = await Promise.all([
    Promise.all(
      symbols.map(async (sym) => {
        try {
          const bars = await getHistory(sym, '3mo' as any)
          return [sym, bars] as [string, HistoricalBar[]]
        } catch {
          return [sym, []] as [string, HistoricalBar[]]
        }
      })
    ).then(entries => Object.fromEntries(entries)),
    Promise.all(
      symbols.map(async (sym) => {
        try {
          const f = await getFundamentals(sym)
          return [sym, f] as [string, FundamentalsData]
        } catch {
          return [sym, {}] as [string, FundamentalsData]
        }
      })
    ).then(entries => Object.fromEntries(entries)),
  ])

  // Find common trading days across all symbols with data
  const symbolsWithData = symbols.filter(s => (historyMap[s]?.length ?? 0) > 10)
  if (symbolsWithData.length === 0) throw new Error('No historical data available')

  // Use the symbol with most data points as reference calendar
  const refSymbol = symbolsWithData.reduce((a, b) =>
    (historyMap[a]?.length ?? 0) >= (historyMap[b]?.length ?? 0) ? a : b
  )
  const allBars = historyMap[refSymbol] ?? []

  // Simulation window = last ~22 trading days (1 month)
  const warmupBars = allBars.slice(0, Math.max(0, allBars.length - 22))
  const simBars = allBars.slice(Math.max(0, allBars.length - 22))
  if (simBars.length === 0) throw new Error('Insufficient data for simulation')

  // Portfolio state
  let cash = startCapital
  const positions: Record<string, Position> = {}
  const trades: SimTrade[] = []
  const dailyValues: SimDayValue[] = []
  const closedPositionResults: { symbol: string; pnl: number }[] = []

  // Evaluate signals for all symbols at start of simulation
  function evaluateAll(historyUpToNow: HistoricalBar[]) {
    const signals: Record<string, { action: 'buy' | 'hold' | 'sell'; reasons: string[] }> = {}
    for (const sym of symbolsWithData) {
      const symBars = historyMap[sym] ?? []
      // Use data up to corresponding index
      const pct = historyUpToNow.length / allBars.length
      const cutoff = Math.floor(symBars.length * pct)
      const history = symBars.slice(0, Math.max(1, cutoff))
      const latestBar = history[history.length - 1]
      const quote = {
        symbol: sym,
        name: sym,
        price: latestBar?.close ?? 0,
        change: 0,
        changePercent: 0,
        volume: latestBar?.volume ?? 0,
        currency: 'USD',
        market: 'US' as const,
        isMarketOpen: true,
        lastUpdated: new Date().toISOString(),
      }
      const result = inv.analyze({ quote, fundamentals: fundamentalsMap[sym], history })
      signals[sym] = { action: result.action, reasons: result.reasons }
    }
    return signals
  }

  // Run simulation day by day
  for (let i = 0; i < simBars.length; i++) {
    const day = simBars[i]
    const dateStr = getDateStr(day.time)
    const historyUpToNow = [...warmupBars, ...simBars.slice(0, i + 1)]

    // Rebalance on day 0, 5, 10, 15, 20
    if (i % 5 === 0) {
      const signals = evaluateAll(historyUpToNow)

      // Sell positions with "sell" signal
      for (const [sym, pos] of Object.entries(positions)) {
        const sig = signals[sym]
        if (sig?.action === 'sell') {
          const symBars = historyMap[sym] ?? []
          const pct = historyUpToNow.length / allBars.length
          const cutoff = Math.floor(symBars.length * pct)
          const sellPrice = symBars[Math.max(0, cutoff - 1)]?.close ?? pos.avgCost
          const total = pos.shares * sellPrice
          const pnl = total - pos.shares * pos.avgCost
          cash += total
          closedPositionResults.push({ symbol: sym, pnl })
          trades.push({
            date: dateStr,
            symbol: sym,
            name: pos.name,
            action: 'sell',
            shares: parseFloat(pos.shares.toFixed(4)),
            price: sellPrice,
            total: parseFloat(total.toFixed(2)),
            reasons: sig.reasons.slice(0, 2),
          })
          delete positions[sym]
        }
      }

      // Buy positions with "buy" signal
      for (const [sym, sig] of Object.entries(signals)) {
        if (sig.action !== 'buy') continue
        if (positions[sym]) continue  // already holding
        if (Object.keys(positions).length >= MAX_POSITIONS) continue

        const allocate = Math.min(startCapital * POSITION_SIZE_PCT, cash * 0.99)
        if (allocate < 100) continue  // not enough cash

        const symBars = historyMap[sym] ?? []
        const pct = historyUpToNow.length / allBars.length
        const cutoff = Math.floor(symBars.length * pct)
        const buyPrice = symBars[Math.max(0, cutoff - 1)]?.close ?? 0
        if (buyPrice <= 0) continue

        const shares = allocate / buyPrice
        cash -= allocate
        positions[sym] = { symbol: sym, name: sym, shares, avgCost: buyPrice, buyDate: dateStr }
        trades.push({
          date: dateStr,
          symbol: sym,
          name: sym,
          action: 'buy',
          shares: parseFloat(shares.toFixed(4)),
          price: buyPrice,
          total: parseFloat(allocate.toFixed(2)),
          reasons: sig.reasons.slice(0, 2),
        })
      }
    }

    // Calculate portfolio value at end of day
    let positionsValue = 0
    for (const [sym, pos] of Object.entries(positions)) {
      const symBars = historyMap[sym] ?? []
      const pct = historyUpToNow.length / allBars.length
      const cutoff = Math.floor(symBars.length * pct)
      const closePrice = symBars[Math.max(0, cutoff - 1)]?.close ?? pos.avgCost
      positionsValue += pos.shares * closePrice
    }
    dailyValues.push({ date: dateStr, value: parseFloat((cash + positionsValue).toFixed(2)) })
  }

  // Close all remaining positions at end
  const endBar = simBars[simBars.length - 1]
  const endDateStr = getDateStr(endBar.time)
  for (const [sym, pos] of Object.entries(positions)) {
    const symBars = historyMap[sym] ?? []
    const sellPrice = symBars[symBars.length - 1]?.close ?? pos.avgCost
    const total = pos.shares * sellPrice
    const pnl = total - pos.shares * pos.avgCost
    cash += total
    closedPositionResults.push({ symbol: sym, pnl })
    trades.push({
      date: endDateStr,
      symbol: sym,
      name: pos.name,
      action: 'sell',
      shares: parseFloat(pos.shares.toFixed(4)),
      price: sellPrice,
      total: parseFloat(total.toFixed(2)),
      reasons: ['シミュレーション終了'],
    })
    delete positions[sym]
  }

  const finalValue = parseFloat(cash.toFixed(2))
  const pnl = finalValue - startCapital
  const pnlPct = (pnl / startCapital) * 100
  const winning = closedPositionResults.filter(r => r.pnl > 0).length
  const losing  = closedPositionResults.filter(r => r.pnl <= 0).length
  const total   = winning + losing
  const winRate = total > 0 ? (winning / total) * 100 : 0

  // Stock result summary
  const boughtSymbols = new Set(trades.filter(t => t.action === 'buy').map(t => t.symbol))
  const stockResults: SimStockResult[] = symbolsWithData.map(sym => {
    const symBars = historyMap[sym] ?? []
    const buyTrade = trades.find(t => t.symbol === sym && t.action === 'buy')
    const sellTrade = [...trades].reverse().find(t => t.symbol === sym && t.action === 'sell')
    const lastPrice = symBars[symBars.length - 1]?.close ?? 0
    const bought = boughtSymbols.has(sym)

    // Evaluate final signal
    const finalHistory = symBars
    const lastBar = symBars[symBars.length - 1]
    const quote = {
      symbol: sym, name: sym, price: lastPrice, change: 0, changePercent: 0,
      volume: lastBar?.volume ?? 0, currency: 'USD', market: 'US' as const,
      isMarketOpen: false, lastUpdated: new Date().toISOString(),
    }
    const finalSig = inv.analyze({ quote, fundamentals: fundamentalsMap[sym], history: finalHistory })

    const buyPrice = buyTrade?.price ?? null
    const sellPrice = sellTrade?.price ?? lastPrice
    const positionPnl = buyPrice ? (sellPrice - buyPrice) / buyPrice * 100 : 0

    return {
      symbol: sym,
      name: sym,
      signal: finalSig.action,
      buyPrice,
      currentPrice: lastPrice,
      pnl: buyPrice ? parseFloat(((sellPrice - buyPrice) * (buyTrade ? buyTrade.total / buyPrice : 0)).toFixed(2)) : 0,
      pnlPct: parseFloat(positionPnl.toFixed(2)),
      bought,
    }
  })

  return {
    investorId,
    investorName: name,
    investorNameJa: nameJa,
    startCapital,
    finalValue,
    pnl: parseFloat(pnl.toFixed(2)),
    pnlPct: parseFloat(pnlPct.toFixed(2)),
    winningPositions: winning,
    losingPositions: losing,
    winRate: parseFloat(winRate.toFixed(1)),
    trades,
    dailyValues,
    stockResults,
    simulationDays: simBars.length,
    startDate: getDateStr(simBars[0].time),
    endDate: endDateStr,
  }
}
