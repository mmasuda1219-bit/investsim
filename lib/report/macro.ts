// Macro / market-context collector (/report R3, US-focused).
// Fetches 5y daily history for a small set of market indicators via the same
// yahoo2 real-data path the rest of the report uses (no extra API key), then
// summarises each into a current value + the value ~5y ago (the "当時" anchor
// for backtest-period context). Per-symbol failures degrade to nulls — macro is
// optional enrichment and never mock-synthesised (原則9).

import { getHistory } from '@/lib/market'
import type { MacroContext, MacroItem } from './types'

const MACRO_SYMBOLS: { symbol: string; label: string; unit: string }[] = [
  { symbol: '^GSPC', label: 'S&P500指数',        unit: 'pt' },
  { symbol: '^IXIC', label: 'Nasdaq総合指数',    unit: 'pt' },
  { symbol: '^VIX',  label: 'VIX（恐怖指数）',    unit: '' },
  { symbol: '^TNX',  label: '米10年債利回り',      unit: '%(目安)' },
  { symbol: 'DX-Y.NYB', label: 'ドル指数(DXY)',   unit: '' },
  { symbol: 'CL=F',  label: 'WTI原油先物',        unit: 'USD' },
]

function n(v: number | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

async function oneMacro(m: { symbol: string; label: string; unit: string }): Promise<MacroItem> {
  const base: MacroItem = { label: m.label, symbol: m.symbol, current: null, periodStartValue: null, periodEndValue: null, unit: m.unit }
  try {
    const bars = await getHistory(m.symbol, '5y', { allowMock: false })
    if (bars.length === 0) return base
    const start = n(bars[0].close)
    const end = n(bars[bars.length - 1].close)
    return { ...base, current: end, periodStartValue: start, periodEndValue: end }
  } catch {
    return base
  }
}

export async function collectMacro(): Promise<MacroContext | null> {
  const items = await Promise.all(MACRO_SYMBOLS.map(oneMacro))
  const anyReal = items.some((i) => i.current !== null)
  return anyReal ? { asOf: new Date().toISOString(), items } : null
}
