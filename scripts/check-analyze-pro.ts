// /analyze S2 スモーク: プロモードの条件ピッカー（分析タイプ軸→CompositeCondition写像）
// と、透明性カードの derivedGate 反映改修を検証する。
// ネットワーク・実API不要（合成データはこのスモーク限定 — COMPANY.md 原則9の範囲内）。
//
// 検証内容:
// 1. 分析タイプ軸（fundamental/technical/hybrid）それぞれが妥当な CompositeCondition
//    を生成する（technical は必須・fundamentalFiltersはtechnical型では空になる 等）。
// 2. ファンダ型の各ベースライントリガー（BASELINE_TRIGGERS）が実在の
//    evaluateTechnical（lib/backtest/rules.ts）へ写像できる（合成バーで例外なく実行できる）。
// 3. 不正入力（数値でない値・短期MA>=長期MA）が {error} になる。
// 4. buildTransparencyCard の改修（derivedGate.evaluations も反復）が pass/no_data を
//    正しく reasons/tags/caveats に反映する（原則9: 実測できた事実のみ・捏造禁止）。
//
// 実行: npx tsx scripts/check-analyze-pro.ts

import {
  buildProCondition,
  BASELINE_TRIGGERS,
  ANALYSIS_TYPE_TABS,
  DEFAULT_PERIODS,
  type BuildConditionInput,
  type BaselineTriggerId,
} from '../components/analyze/ProConditionPicker'
import { evaluateTechnical } from '../lib/backtest/rules'
import { buildTransparencyCard } from '../lib/report/transparency'
import type { PreparedBundle } from '../lib/report/types'
import type { FundamentalGateResult, DerivedGateResult } from '../lib/backtest/fundamental'
import type { BacktestSummary } from '../lib/report/types'
import type { HistoricalBar } from '../types'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  PASS ${name}`)
  } else {
    failures++
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

// ── 共通の合成入力（buildProCondition のデフォルト値） ─────────────────────
function baseInput(overrides: Partial<BuildConditionInput> = {}): BuildConditionInput {
  return {
    analysisType: 'technical',
    indicator: 'ma_cross',
    periods: { ...DEFAULT_PERIODS },
    shortPeriod: '20',
    longPeriod: '50',
    baselineTrigger: 'ma200',
    filters: [],
    dFilters: [],
    ...overrides,
  }
}

// ── 1. 分析タイプ軸 → CompositeCondition の写像 ────────────────────────────
console.log('buildProCondition — 分析タイプ軸ごとに妥当な CompositeCondition を生成する')
{
  check('ANALYSIS_TYPE_TABS に3種（fundamental/technical/hybrid）が定義されている',
    ANALYSIS_TYPE_TABS.length === 3 &&
    ['fundamental', 'technical', 'hybrid'].every(id => ANALYSIS_TYPE_TABS.some(t => t.id === id)))

  // technical: フル選択のテクニカル条件のみ。fundamentalFilters/derivedFiltersは空。
  {
    const input = baseInput({
      analysisType: 'technical',
      indicator: 'rsi_reversal',
      periods: { ...DEFAULT_PERIODS, rsi_reversal: '21' },
      filters: [{ metric: 'pe', operator: 'lte', value: '15' }], // technicalでは無視される想定
    })
    const cond = buildProCondition(input)
    check('technical: エラーにならない', !('error' in cond))
    if (!('error' in cond)) {
      check('technical: technical.indicator が選択どおり', cond.technical.indicator === 'rsi_reversal')
      check('technical: fundamentalFilters は空（fundamental入力があっても無視される）', cond.fundamentalFilters.length === 0)
      check('technical: derivedFilters は空', (cond.derivedFilters ?? []).length === 0)
    }
  }

  // fundamental: ベースライントリガー + fundamentalFilters + derivedFilters。
  {
    const input = baseInput({
      analysisType: 'fundamental',
      baselineTrigger: 'ma50',
      filters: [{ metric: 'dividendYield', operator: 'gte', value: '3' }],
      dFilters: [{ metric: 'revenueCagr3y', operator: 'gte', value: '10' }],
    })
    const cond = buildProCondition(input)
    check('fundamental: エラーにならない', !('error' in cond))
    if (!('error' in cond)) {
      check('fundamental: technical はベースライントリガー(ma50)に写像される',
        cond.technical.indicator === 'ma_cross' && 'period' in cond.technical && cond.technical.period === 50)
      check('fundamental: fundamentalFilters に指定した条件が反映される（%→小数変換）',
        cond.fundamentalFilters.length === 1 && cond.fundamentalFilters[0].value === 0.03)
      check('fundamental: derivedFilters に指定した条件が反映される（%→小数変換）',
        (cond.derivedFilters ?? []).length === 1 && cond.derivedFilters![0].value === 0.10)
    }
  }

  // hybrid: フル選択のテクニカル条件 + fundamentalFilters + derivedFilters。
  {
    const input = baseInput({
      analysisType: 'hybrid',
      indicator: 'ma_cross_dual',
      shortPeriod: '20',
      longPeriod: '50',
      filters: [{ metric: 'marketCap', operator: 'gte', value: '100' }], // 10億単位=100 → 1000億(1e11)
      dFilters: [],
    })
    const cond = buildProCondition(input)
    check('hybrid: エラーにならない', !('error' in cond))
    if (!('error' in cond)) {
      check('hybrid: technical はユーザー選択のテクニカルルール', cond.technical.indicator === 'ma_cross_dual')
      check('hybrid: fundamentalFilters が反映される（10億単位→実単位変換）',
        cond.fundamentalFilters.length === 1 && cond.fundamentalFilters[0].value === 100e9)
    }
  }
}

// ── 2. ファンダ型ベースライントリガーが実在evaluatorへ写像できる ────────────
console.log('BASELINE_TRIGGERS — 各トリガーが実在の evaluateTechnical に写像でき、例外なく実行できる')
{
  // 250本の合成バー（MA200・ゴールデンクロス50x200 の warm-up を満たす長さ）。
  const DAY = 86_400
  const bars: HistoricalBar[] = Array.from({ length: 250 }, (_, i) => {
    const close = 100 + i * 0.3 + Math.sin(i / 7) * 3 // 緩やかな上昇トレンド＋波
    return { time: 1_700_000_000 + i * DAY, open: close, high: close + 0.5, low: close - 0.5, close, volume: 1000 }
  })

  check('BASELINE_TRIGGERS に3種類定義されている', BASELINE_TRIGGERS.length === 3)
  check('「買い持ち（常時保有）」に相当する選択肢が無い（原則9: 未サポートトリガーの偽装禁止）',
    !BASELINE_TRIGGERS.some(t => t.label.includes('買い持ち') || t.label.includes('常時保有')))

  for (const trigger of BASELINE_TRIGGERS) {
    let signals: ReturnType<typeof evaluateTechnical> | null = null
    let threw: unknown = null
    try {
      signals = evaluateTechnical(bars, trigger.technical)
    } catch (e) {
      threw = e
    }
    check(`${trigger.id} (${trigger.technical.indicator}): 実在evaluatorが例外なく実行できる`,
      threw === null, threw instanceof Error ? threw.message : String(threw))
    check(`${trigger.id}: シグナル配列がバー数と一致する`,
      signals !== null && signals.length === bars.length)
    // サポート対象indicatorのホワイトリスト（lib/backtest/rules.tsのswitchで実装済みのもの）。
    check(`${trigger.id}: indicator が実サポート対象（ma_cross/ma_cross_dual等）`,
      ['ma_cross', 'ma_cross_dual', 'rsi_reversal', 'macd_cross', 'bb_break', 'hl_break', 'stoch_cross', 'roc_signal']
        .includes(trigger.technical.indicator))
  }
}

// ── 3. 不正入力が {error} になる ────────────────────────────────────────────
console.log('buildProCondition — 不正入力はCompositeConditionを生成せず{error}を返す')
{
  const badFundamentalValue = buildProCondition(baseInput({
    analysisType: 'fundamental',
    filters: [{ metric: 'pe', operator: 'lte', value: 'abc' }],
  }))
  check('ファンダ条件の値が数値でない → {error}', 'error' in badFundamentalValue)

  const badDerivedValue = buildProCondition(baseInput({
    analysisType: 'hybrid',
    dFilters: [{ metric: 'revenueCagr3y', operator: 'gte', value: '' }],
  }))
  check('決算トレンド条件の値が空 → {error}', 'error' in badDerivedValue)

  const badDual = buildProCondition(baseInput({
    analysisType: 'technical',
    indicator: 'ma_cross_dual',
    shortPeriod: '50',
    longPeriod: '20', // 短期 >= 長期 は不正
  }))
  check('短期MA >= 長期MA → {error}', 'error' in badDual)

  // ── レビュー指摘（suggestion）対応: 期間パーサ(parsePeriod)が無効値を黙って
  // デフォルト期間へフォールバックせず {error} を返すことを確認（buildFundamentalFilters/
  // buildDerivedFiltersと同じ扱いへの統一）。
  const badPeriodEmpty = buildProCondition(baseInput({
    analysisType: 'technical',
    indicator: 'ma_cross',
    periods: { ...DEFAULT_PERIODS, ma_cross: '' }, // 空文字
  }))
  check('period(ma_cross)が空文字 → {error}（黙ってデフォルト20日にフォールバックしない）', 'error' in badPeriodEmpty)

  const badPeriodNonNumeric = buildProCondition(baseInput({
    analysisType: 'technical',
    indicator: 'bb_break',
    periods: { ...DEFAULT_PERIODS, bb_break: 'abc' }, // 非数値
  }))
  check('period(bb_break)が非数値 → {error}', 'error' in badPeriodNonNumeric)

  const badPeriodZero = buildProCondition(baseInput({
    analysisType: 'hybrid',
    indicator: 'rsi_reversal',
    periods: { ...DEFAULT_PERIODS, rsi_reversal: '0' }, // 0以下
  }))
  check('period(rsi_reversal)が0 → {error}', 'error' in badPeriodZero)

  const badPeriodNegative = buildProCondition(baseInput({
    analysisType: 'technical',
    indicator: 'roc_signal',
    periods: { ...DEFAULT_PERIODS, roc_signal: '-5' }, // 負数
  }))
  check('period(roc_signal)が負数 → {error}', 'error' in badPeriodNegative)

  const goodPeriod = buildProCondition(baseInput({
    analysisType: 'technical',
    indicator: 'ma_cross',
    periods: { ...DEFAULT_PERIODS, ma_cross: '150' }, // 有効な期間は無視されず反映される
  }))
  check('period(ma_cross)=150(有効値) はエラーにならず period=150 が反映される',
    !('error' in goodPeriod) && goodPeriod.technical.indicator === 'ma_cross' &&
    'period' in goodPeriod.technical && goodPeriod.technical.period === 150)

  const unknownBaseline = buildProCondition(baseInput({
    analysisType: 'fundamental',
    // 実行時に想定外のIDが来た場合でもフォールバックで捏造せず{error}になることを確認
    // （型システムを迂回した防御的チェックの検証のため意図的にキャスト）。
    baselineTrigger: 'nonexistent' as unknown as BaselineTriggerId,
  }))
  check('未知のベースライントリガーID → {error}', 'error' in unknownBaseline)
}

// ── 4. 透明性カード改修: derivedGate.evaluations が反映される ────────────────
console.log('buildTransparencyCard — derivedGate.evaluations も反復し、pass/no_dataを正直に反映する（S2改修）')
{
  function makeBundle(overrides: Partial<PreparedBundle>): PreparedBundle {
    const base: PreparedBundle = {
      request: {
        symbol: 'AAPL',
        condition: {
          technical: { type: 'technical', indicator: 'ma_cross', period: 200 },
          fundamentalFilters: [],
        },
        initialCapital: 100_000,
      },
      conditionDescription: '',
      period: '5y',
      fundamentalGate: { passed: true, evaluations: [] } as FundamentalGateResult,
      statements: null,
      derived: null,
      derivedGate: {
        passed: false,
        evaluations: [
          { filter: { metric: 'revenueCagr3y', operator: 'gte', value: 0.10 }, actual: 0.18, result: 'pass' },
          { filter: { metric: 'fcfPositiveYears', operator: 'gte', value: 5 }, result: 'no_data' },
        ],
      } as DerivedGateResult,
      backtest: {
        symbol: 'AAPL', currency: 'USD', period: '5y', startDate: 0, endDate: 1, barCount: 1250,
        initialCapital: 100_000, finalValue: 120_000,
        metrics: { totalReturnPct: 20, winRate: 55, maxDrawdownPct: 15, sharpeRatio: 0.9, tradeCount: 8 },
        trades: [], buyHoldReturnPct: 15,
      } as BacktestSummary,
      current: {
        quote: { symbol: 'AAPL', name: 'Apple Inc.', price: 200, change: 1, changePercent: 0.5, volume: 1000, currency: 'USD', market: 'US', isMarketOpen: true, lastUpdated: '' },
        technicals: '', fundamentals: {},
      },
      aiEvidence: { hasData: false, tradeCount: 0, winRate: 0, avgPnlPct: 0, recentTrades: [], relevantLessons: [], decisionsSummary: '' },
      learningContext: '',
      news: [],
      macro: null,
      sources: [],
      preparedAt: new Date().toISOString(),
    }
    return { ...base, ...overrides }
  }

  const bundle = makeBundle({})
  const card = buildTransparencyCard(bundle)

  check('derivedGateのpass実測値(18.00%)がreasonsに反映される（改修前は欠落していた）',
    card.reasons.some(r => r.includes('18.00%') && r.includes('成立')))
  check('derivedGateのpass実測値がtagsに反映される', card.tags.some(t => t.includes('18.00%')))
  check('derivedGateのno_dataは実測値を捏造せず「データなし」としてcaveatsに載る',
    card.caveats.some(c => c.includes('FCF黒字の期数') && c.includes('データなし')))
  check('no_dataの決算指標がreasonsに実測値付きで載らない（捏造禁止）',
    !card.reasons.some(r => r.includes('FCF黒字の期数') && /実測 \d/.test(r)))
}

// ── 結果 ─────────────────────────────────────────────────────────────────────
console.log('')
if (failures > 0) {
  console.error(`NG: ${failures}件のチェックが失敗しました`)
  process.exit(1)
}
console.log('OK: 全チェック合格（/analyze S2 — プロモード条件ピッカー＋透明性カードderivedGate反映）')
