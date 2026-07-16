// /report R1 スモーク: ファンダANDゲート評価器・CompositeConditionバリデーション・
// 5y相当（約1250本）の合成バーでの評価器実行を検証する。
// ネットワーク・実API不要（合成データはテスト用途 — COMPANY.md原則9の範囲内）。
//
// 実行: npx tsx scripts/check-report-r1.ts

import { evaluateFundamentalGate, toRawValue, formatMetricValue } from '../lib/backtest/fundamental'
import { parseCompositeCondition, ValidationError } from '../lib/report/validate'
import { describeCompositeCondition } from '../lib/report/prompt'
import { evaluateTechnical } from '../lib/backtest/rules'
import type { HistoricalBar, FundamentalsData } from '../types'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  PASS ${name}`)
  } else {
    failures++
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

// ── 1. ファンダANDゲート ─────────────────────────────────────────────────
console.log('evaluateFundamentalGate — pass / fail / no_data / 矛盾 / 空')
{
  const f: FundamentalsData = { pe: 15, roe: 0.18, marketCap: 2e12 }

  // 全条件成立 → passed
  const pass = evaluateFundamentalGate(f, [
    { metric: 'pe', operator: 'lte', value: 20 },
    { metric: 'roe', operator: 'gt', value: 0.15 },
  ])
  check('全フィルタ成立でpassed=true', pass.passed && pass.evaluations.every(e => e.result === 'pass'))
  check('実測値がevaluationsに入る', pass.evaluations[0].actual === 15 && pass.evaluations[1].actual === 0.18)

  // 1つでも不成立 → AND失敗
  const fail = evaluateFundamentalGate(f, [
    { metric: 'pe', operator: 'lte', value: 20 },
    { metric: 'roe', operator: 'gt', value: 0.30 },
  ])
  check('1つ不成立でpassed=false', !fail.passed)
  check('不成立フィルタはresult=fail', fail.evaluations[1].result === 'fail' && fail.evaluations[0].result === 'pass')

  // データ欠損 → no_data（fail-closed・failと区別）
  const nodata = evaluateFundamentalGate(f, [
    { metric: 'dividendYield', operator: 'gte', value: 0.02 },
  ])
  check('欠損指標はno_dataでpassed=false（fail-closed）',
    !nodata.passed && nodata.evaluations[0].result === 'no_data')
  check('no_dataはactualを持たない', nodata.evaluations[0].actual === undefined)

  // 矛盾条件（PER<10 AND PER>20）→ エラーにせず単に評価
  const contra = evaluateFundamentalGate(f, [
    { metric: 'pe', operator: 'lt', value: 10 },
    { metric: 'pe', operator: 'gt', value: 20 },
  ])
  check('矛盾条件はエラーにならず両方failで不成立',
    !contra.passed && contra.evaluations.every(e => e.result === 'fail'))

  // フィルタ0件 → passed（テクニカルのみ）
  const empty = evaluateFundamentalGate(f, [])
  check('フィルタ0件はpassed=true', empty.passed && empty.evaluations.length === 0)

  // 境界: gte/lteは等値で成立、gt/ltは等値で不成立
  const eq = evaluateFundamentalGate({ pe: 20 }, [
    { metric: 'pe', operator: 'lte', value: 20 },
    { metric: 'pe', operator: 'lt', value: 20 },
  ])
  check('lte等値=pass / lt等値=fail',
    eq.evaluations[0].result === 'pass' && eq.evaluations[1].result === 'fail')
}

// ── 2. 単位変換（人間入力 ⇔ 実単位）──────────────────────────────────────
console.log('toRawValue / formatMetricValue — 単位変換の往復')
{
  check('ROE 15(%) → 0.15', toRawValue('roe', 15) === 0.15)
  check('PER 20(倍) → 20', toRawValue('pe', 20) === 20)
  check('時価総額 100(B) → 1e11', toRawValue('marketCap', 100) === 1e11)
  check('0.15 → "15.00%"', formatMetricValue('roe', 0.15) === '15.00%')
  check('1e11 → "100.0B"', formatMetricValue('marketCap', 1e11) === '100.0B')
  check('20 → "20.00x"', formatMetricValue('pe', 20) === '20.00x')
}

// ── 3. CompositeCondition バリデーション ─────────────────────────────────
console.log('parseCompositeCondition — 正常系・異常系・clamp')
{
  // 正常系
  const ok = parseCompositeCondition({
    technical: { type: 'technical', indicator: 'ma_cross', period: 25 },
    fundamentalFilters: [{ metric: 'pe', operator: 'lte', value: 20 }],
  })
  check('正常系: そのまま通る',
    ok.technical.indicator === 'ma_cross' &&
    ok.technical.indicator === 'ma_cross' && (ok.technical as { period: number }).period === 25 &&
    ok.fundamentalFilters.length === 1)

  // fundamentalFilters省略 → []
  const noFund = parseCompositeCondition({
    technical: { type: 'technical', indicator: 'macd_cross' },
  })
  check('fundamentalFilters省略は空配列', noFund.fundamentalFilters.length === 0)

  // 期間clamp（10000 → 上限200）
  const clamped = parseCompositeCondition({
    technical: { type: 'technical', indicator: 'ma_cross', period: 10000 },
    fundamentalFilters: [],
  })
  check('period=10000は200にclamp', (clamped.technical as { period: number }).period === 200)

  // ma_cross_dual: short>long は入れ替え
  const dual = parseCompositeCondition({
    technical: { type: 'technical', indicator: 'ma_cross_dual', shortPeriod: 75, longPeriod: 25 },
  })
  const d = dual.technical as { shortPeriod: number; longPeriod: number }
  check('dualのshort>longは入れ替えて正規化', d.shortPeriod === 25 && d.longPeriod === 75)

  const throws = (fn: () => unknown): boolean => {
    try { fn(); return false } catch (e) { return e instanceof ValidationError }
  }
  check('未知metricはValidationError（→400）', throws(() => parseCompositeCondition({
    technical: { type: 'technical', indicator: 'ma_cross', period: 20 },
    fundamentalFilters: [{ metric: 'evil', operator: 'gt', value: 1 }],
  })))
  check('未知indicatorはValidationError', throws(() => parseCompositeCondition({
    technical: { type: 'technical', indicator: 'hax', period: 20 },
  })))
  check('未知operatorはValidationError', throws(() => parseCompositeCondition({
    technical: { type: 'technical', indicator: 'ma_cross', period: 20 },
    fundamentalFilters: [{ metric: 'pe', operator: '==', value: 1 }],
  })))
  check('非有限value(Infinity)はValidationError', throws(() => parseCompositeCondition({
    technical: { type: 'technical', indicator: 'ma_cross', period: 20 },
    fundamentalFilters: [{ metric: 'pe', operator: 'gt', value: Infinity }],
  })))
  check('value型違い(string)はValidationError', throws(() => parseCompositeCondition({
    technical: { type: 'technical', indicator: 'ma_cross', period: 20 },
    fundamentalFilters: [{ metric: 'pe', operator: 'gt', value: '10' }],
  })))
  check('condition未指定はValidationError', throws(() => parseCompositeCondition(undefined)))
  check('11件以上のフィルタはValidationError', throws(() => parseCompositeCondition({
    technical: { type: 'technical', indicator: 'ma_cross', period: 20 },
    fundamentalFilters: Array.from({ length: 11 }, () => ({ metric: 'pe', operator: 'gt', value: 1 })),
  })))
}

// ── 4. 条件の日本語説明 ──────────────────────────────────────────────────
console.log('describeCompositeCondition — テクニカル＋ファンダの説明文')
{
  const desc = describeCompositeCondition({
    technical: { type: 'technical', indicator: 'ma_cross_dual', shortPeriod: 20, longPeriod: 50 },
    fundamentalFilters: [
      { metric: 'roe', operator: 'gt', value: 0.15 },
      { metric: 'pe', operator: 'lte', value: 20 },
    ],
  })
  check('テクニカルとファンダ両方を含む',
    desc.includes('20日MAが50日MAを上抜け') && desc.includes('ROE') && desc.includes('15.00%') && desc.includes('AND'),
    desc)
  const techOnly = describeCompositeCondition({
    technical: { type: 'technical', indicator: 'rsi_reversal', period: 14 },
    fundamentalFilters: [],
  })
  check('ファンダ0件はテクニカルのみの説明', !techOnly.includes('ファンダ条件'), techOnly)
}

// ── 5. 5y相当（1250本）の合成バーで評価器が高速に回る ────────────────────
console.log('evaluateTechnical — 5y相当1250本の実行（純JSループ）')
{
  const DAY = 86_400
  const bars: HistoricalBar[] = Array.from({ length: 1250 }, (_, i) => {
    const c = 100 + 30 * Math.sin(i / 40) + 8 * Math.sin(i / 7.3) + i * 0.02
    return { time: 1_500_000_000 + i * DAY, open: c, high: c + 1, low: c - 1, close: parseFloat(c.toFixed(2)), volume: 1000 }
  })
  const t0 = Date.now()
  const sig1 = evaluateTechnical(bars, { type: 'technical', indicator: 'ma_cross_dual', shortPeriod: 20, longPeriod: 200 })
  const sig2 = evaluateTechnical(bars, { type: 'technical', indicator: 'rsi_reversal', period: 14 })
  const elapsed = Date.now() - t0
  check('1250本×2評価器が全バー分のシグナルを返す', sig1.length === 1250 && sig2.length === 1250)
  check(`長期MA200でも発火する（5yで初めて有効になる条件）`, sig1.some(s => s.signal !== 'hold'))
  check(`実行時間が実用範囲（${elapsed}ms < 2000ms）`, elapsed < 2000)
}

// ── 結果 ─────────────────────────────────────────────────────────────────
console.log('')
if (failures > 0) {
  console.error(`NG: ${failures}件のチェックが失敗しました`)
  process.exit(1)
}
console.log('OK: 全チェック合格（/report R1）')
