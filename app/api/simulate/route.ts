import { NextResponse } from 'next/server'
import { runSimulation } from '@/lib/simulation'

const UNIVERSE_PRESETS: Record<string, string[]> = {
  large_cap: ['AAPL', 'NVDA', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'JPM', 'V', 'MA',
              'JNJ', 'UNH', 'KO', 'WMT', 'XOM', 'HD', 'MCD', 'LLY', 'COST', 'ABBV'],
  value:     ['BRK', 'KO', 'WFC', 'BAC', 'OXY', 'JPM', 'CVX', 'XOM', 'KHC', 'JNJ',
              'PG', 'MRK', 'C', 'V', 'VZ', 'T', 'MMM', 'CAT', 'AXP', 'GS'],
  growth:    ['NVDA', 'MSFT', 'META', 'AMZN', 'TSLA', 'NFLX', 'AMD', 'CRM', 'ADBE', 'COIN',
              'PLTR', 'SNOW', 'SHOP', 'UBER', 'NOW', 'AVGO', 'QCOM', 'LLY', 'SBUX', 'ORCL'],
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { investorId, startCapital, universe, customSymbols } = body

    if (!investorId) {
      return NextResponse.json({ error: 'investorId is required' }, { status: 400 })
    }

    let symbols: string[]
    if (universe === 'custom' && Array.isArray(customSymbols) && customSymbols.length > 0) {
      symbols = customSymbols.slice(0, 20)
    } else {
      symbols = UNIVERSE_PRESETS[universe as string] ?? UNIVERSE_PRESETS.large_cap
    }

    const capital = typeof startCapital === 'number' && startCapital > 0
      ? Math.min(startCapital, 10_000_000)
      : 100_000

    const result = await runSimulation({ investorId, startCapital: capital, symbols })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Simulation failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
