// Strict server-side validation of the /report R1 CompositeCondition.
//
// Pure functions (no I/O) so the API route stays thin and the rules are
// unit-smoked in scripts/check-report-r1.ts. Philosophy:
// - UNKNOWN identifiers (indicator / metric / operator) or wrong TYPES are a
//   hard ValidationError (=> HTTP 400): the client is buggy or hostile.
// - NUMERIC ranges are clamped, mirroring the established interpret.ts style
//   (a period of 10000 becomes the max, not an error).
// - Contradictory fundamental filters (PER<10 AND PER>20) are ALLOWED — the
//   gate simply evaluates them (and fails); never an error.

import type {
  CompositeCondition,
  FundamentalFilter,
  FundamentalMetric,
  DerivedFilter,
  TechnicalCondition,
} from '@/lib/backtest/types'
import type { DerivedMetric } from '@/lib/statements/types'
import { FUNDAMENTAL_METRICS, DERIVED_METRICS } from '@/lib/backtest/fundamental'

/** Thrown on malformed input — API routes map this to HTTP 400. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

const INDICATORS: TechnicalCondition['indicator'][] = [
  'ma_cross', 'ma_cross_dual', 'rsi_reversal', 'macd_cross',
  'bb_break', 'hl_break', 'stoch_cross', 'roc_signal',
]

const OPERATORS: FundamentalFilter['operator'][] = ['gt', 'lt', 'gte', 'lte']

/** Max fundamental filters per request (sanity bound, not a business rule). */
export const MAX_FUNDAMENTAL_FILTERS = 10

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : fallback
  return Math.min(Math.max(n, min), max)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/** Validate + normalize the technical half. Throws ValidationError on bad shape. */
export function parseTechnicalCondition(raw: unknown): TechnicalCondition {
  if (!isRecord(raw)) throw new ValidationError('condition.technical が指定されていません')
  if (raw.type !== 'technical') {
    throw new ValidationError('condition.technical.type は "technical" である必要があります')
  }
  const indicator = raw.indicator
  if (typeof indicator !== 'string' || !INDICATORS.includes(indicator as TechnicalCondition['indicator'])) {
    throw new ValidationError(`未対応のテクニカルルールです: ${String(indicator)}`)
  }

  switch (indicator as TechnicalCondition['indicator']) {
    case 'ma_cross':
      return { type: 'technical', indicator: 'ma_cross', period: clampInt(raw.period, 2, 200, 20) }
    case 'ma_cross_dual': {
      // 5y daily (~1250 bars) has ample warm-up headroom — long MA up to 200.
      let short = clampInt(raw.shortPeriod, 2, 199, 20)
      let long = clampInt(raw.longPeriod, 3, 200, 50)
      if (short > long) [short, long] = [long, short]
      if (short === long) long = Math.min(200, short * 2)
      return { type: 'technical', indicator: 'ma_cross_dual', shortPeriod: short, longPeriod: long }
    }
    case 'rsi_reversal':
      return { type: 'technical', indicator: 'rsi_reversal', period: clampInt(raw.period, 2, 50, 14) }
    case 'macd_cross':
      return { type: 'technical', indicator: 'macd_cross' }
    case 'bb_break':
      return { type: 'technical', indicator: 'bb_break', period: clampInt(raw.period, 2, 200, 20) }
    case 'hl_break':
      return { type: 'technical', indicator: 'hl_break', period: clampInt(raw.period, 5, 100, 20) }
    case 'stoch_cross':
      return { type: 'technical', indicator: 'stoch_cross', period: clampInt(raw.period, 5, 50, 14) }
    case 'roc_signal':
      return { type: 'technical', indicator: 'roc_signal', period: clampInt(raw.period, 2, 100, 12) }
  }
  // Unreachable — INDICATORS membership was checked above.
  throw new ValidationError(`未対応のテクニカルルールです: ${String(indicator)}`)
}

/** Validate the fundamental filter list. Throws ValidationError on bad shape. */
export function parseFundamentalFilters(raw: unknown): FundamentalFilter[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) {
    throw new ValidationError('condition.fundamentalFilters は配列である必要があります')
  }
  if (raw.length > MAX_FUNDAMENTAL_FILTERS) {
    throw new ValidationError(`ファンダメンタル条件は最大${MAX_FUNDAMENTAL_FILTERS}件までです`)
  }
  return raw.map((f, i) => {
    if (!isRecord(f)) throw new ValidationError(`fundamentalFilters[${i}] が不正です`)
    const { metric, operator, value } = f
    if (typeof metric !== 'string' || !FUNDAMENTAL_METRICS.includes(metric as FundamentalMetric)) {
      throw new ValidationError(`fundamentalFilters[${i}]: 未対応の指標です: ${String(metric)}`)
    }
    if (typeof operator !== 'string' || !OPERATORS.includes(operator as FundamentalFilter['operator'])) {
      throw new ValidationError(`fundamentalFilters[${i}]: 未対応の比較演算子です: ${String(operator)}`)
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new ValidationError(`fundamentalFilters[${i}]: value は有限の数値である必要があります`)
    }
    return {
      metric: metric as FundamentalMetric,
      operator: operator as FundamentalFilter['operator'],
      value,
    }
  })
}

/** Max derived (earnings-trend) filters per request. */
export const MAX_DERIVED_FILTERS = 10

/** Validate the derived (earnings-trend) filter list. Throws on bad shape. */
export function parseDerivedFilters(raw: unknown): DerivedFilter[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) {
    throw new ValidationError('condition.derivedFilters は配列である必要があります')
  }
  if (raw.length > MAX_DERIVED_FILTERS) {
    throw new ValidationError(`決算トレンド条件は最大${MAX_DERIVED_FILTERS}件までです`)
  }
  return raw.map((f, i) => {
    if (!isRecord(f)) throw new ValidationError(`derivedFilters[${i}] が不正です`)
    const { metric, operator, value } = f
    if (typeof metric !== 'string' || !DERIVED_METRICS.includes(metric as DerivedMetric)) {
      throw new ValidationError(`derivedFilters[${i}]: 未対応の決算指標です: ${String(metric)}`)
    }
    if (typeof operator !== 'string' || !OPERATORS.includes(operator as DerivedFilter['operator'])) {
      throw new ValidationError(`derivedFilters[${i}]: 未対応の比較演算子です: ${String(operator)}`)
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new ValidationError(`derivedFilters[${i}]: value は有限の数値である必要があります`)
    }
    return {
      metric: metric as DerivedMetric,
      operator: operator as DerivedFilter['operator'],
      value,
    }
  })
}

/** Validate the whole composite condition. Throws ValidationError on bad shape. */
export function parseCompositeCondition(raw: unknown): CompositeCondition {
  if (!isRecord(raw)) throw new ValidationError('condition が指定されていません')
  return {
    technical: parseTechnicalCondition(raw.technical),
    fundamentalFilters: parseFundamentalFilters(raw.fundamentalFilters),
    derivedFilters: parseDerivedFilters(raw.derivedFilters),
  }
}
