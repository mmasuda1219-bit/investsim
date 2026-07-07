'use client'
// Portfolio store — localStorage based, Supabase-ready interface

export interface Position {
  symbol: string
  name: string
  shares: number
  avgCost: number    // average cost basis per share
}

export interface Trade {
  id: string
  timestamp: number
  symbol: string
  name: string
  action: 'buy' | 'sell'
  shares: number
  price: number      // price per share at execution
}

export interface Portfolio {
  cash: number
  positions: Position[]
  trades: Trade[]
}

const STORAGE_KEY = 'investsim_portfolio'
const INITIAL_CASH = 100_000  // $100,000 starting capital

export function getPortfolio(): Portfolio {
  // localStorage はサーバーサイドでは使えないのでguard必須
  if (typeof window === 'undefined') return { cash: INITIAL_CASH, positions: [], trades: [] }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : { cash: INITIAL_CASH, positions: [], trades: [] }
  } catch {
    return { cash: INITIAL_CASH, positions: [], trades: [] }
  }
}

export function savePortfolio(p: Portfolio): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
}

export function resetPortfolio(): void {
  savePortfolio({ cash: INITIAL_CASH, positions: [], trades: [] })
}

export interface TradeResult {
  success: boolean
  error?: string
}

export function executeTrade(
  symbol: string,
  name: string,
  action: 'buy' | 'sell',
  shares: number,
  price: number
): TradeResult {
  const portfolio = getPortfolio()
  const total = shares * price

  if (action === 'buy') {
    if (portfolio.cash < total) {
      return { success: false, error: `残高不足 (必要: $${total.toFixed(2)}, 残高: $${portfolio.cash.toFixed(2)})` }
    }
    portfolio.cash -= total

    const existing = portfolio.positions.find(p => p.symbol === symbol)
    if (existing) {
      // weighted average cost
      const totalShares = existing.shares + shares
      existing.avgCost = (existing.avgCost * existing.shares + price * shares) / totalShares
      existing.shares = totalShares
    } else {
      portfolio.positions.push({ symbol, name, shares, avgCost: price })
    }
  } else {
    const existing = portfolio.positions.find(p => p.symbol === symbol)
    if (!existing || existing.shares < shares) {
      return { success: false, error: `保有株数不足 (保有: ${existing?.shares ?? 0}株)` }
    }
    portfolio.cash += total
    existing.shares -= shares
    if (existing.shares === 0) {
      portfolio.positions = portfolio.positions.filter(p => p.symbol !== symbol)
    }
  }

  portfolio.trades.unshift({
    id: Date.now().toString(),
    timestamp: Date.now(),
    symbol, name, action, shares, price,
  })

  savePortfolio(portfolio)
  return { success: true }
}

export function getPortfolioValue(positions: Position[], prices: Record<string, number>): number {
  return positions.reduce((sum, pos) => sum + pos.shares * (prices[pos.symbol] ?? pos.avgCost), 0)
}
