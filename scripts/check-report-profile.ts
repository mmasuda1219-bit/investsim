// /analyze・/report S1 スモーク: 読者プロファイル（lib/report/profile.ts）の
// 純関数と、buildReportPrompt へのプロファイル注入（任意第2引数・後方互換）を
// 検証する。ネットワーク・実API不要（合成bundleはテスト用途限定・COMPANY.md
// 原則9の範囲内）。
//
// 検証項目:
// 1. isReaderProfile が不正/未知の値を弾き、正当な値（capacity省略含む）を通す
// 2. describeReaderProfile / buildEmphasisHints が各プロファイルで妥当な文字列・
//    実在指標名（METRIC_INFO/DERIVED_METRIC_INFOのlabelそのもの）を返す
// 3. buildEmphasisHints が「この指標だけ見ろ／リスクを省け」的な指示を含まない
// 4. buildReportPrompt はprofile指定時のみ【読者プロファイル】節を含み、
//    profile無しでは含まない
// 5. 意味づけ強制の指示（厳守事項）はprofile有無に関わらず常に含まれる
//
// 実行: npx tsx scripts/check-report-profile.ts

import {
  isReaderProfile, describeReaderProfile, buildEmphasisHints,
  HORIZON_LABELS, TOLERANCE_LABELS, STYLE_LABELS, CAPACITY_LABELS,
} from '../lib/report/profile'
import type { ReaderProfile } from '../lib/report/profile'
import { buildReportPrompt } from '../lib/report/prompt'
import { METRIC_INFO, DERIVED_METRIC_INFO } from '../lib/backtest/fundamental'
import type { PreparedBundle } from '../lib/report/types'
import type { FundamentalGateResult } from '../lib/backtest/fundamental'
import type { BacktestSummary } from '../lib/report/types'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  PASS ${name}`)
  } else {
    failures++
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

// ── 1. isReaderProfile — ホワイトリスト検証 ─────────────────────────────────
console.log('isReaderProfile — 不正/未知を弾き、正当な値のみ通す')
{
  check('null は false', !isReaderProfile(null))
  check('{} は false（必須3問欠如）', !isReaderProfile({}))
  check('horizon のみは false（tolerance/style欠如）', !isReaderProfile({ horizon: 'short' }))
  check(
    '未知の horizon 値は false',
    !isReaderProfile({ horizon: 'unknown', tolerance: 'low', style: 'income' }),
  )
  check(
    '未知の tolerance 値は false',
    !isReaderProfile({ horizon: 'short', tolerance: 'unknown', style: 'income' }),
  )
  check(
    '未知の style 値は false',
    !isReaderProfile({ horizon: 'short', tolerance: 'low', style: 'unknown' }),
  )
  check(
    '必須3問のみ（capacity省略）は true',
    isReaderProfile({ horizon: 'short', tolerance: 'low', style: 'income' }),
  )
  check(
    '必須3問＋正当なcapacityは true',
    isReaderProfile({ horizon: 'long', tolerance: 'high', style: 'growth', capacity: 'core' }),
  )
  check(
    '不正なcapacity値は false',
    !isReaderProfile({ horizon: 'long', tolerance: 'high', style: 'growth', capacity: 'bogus' }),
  )
  check('文字列そのものは false', !isReaderProfile('short'))
  check('数値は false', !isReaderProfile(42))
}

// ── 2. describeReaderProfile — 各プロファイルで妥当なラベル文字列 ──────────
console.log('describeReaderProfile — 各プロファイルで妥当な人間可読ブロックを返す')
{
  const withoutCapacity: ReaderProfile = { horizon: 'short', tolerance: 'low', style: 'income' }
  const desc1 = describeReaderProfile(withoutCapacity)
  check('投資期間ラベルを含む', desc1.includes(HORIZON_LABELS.short))
  check('リスク許容度ラベルを含む', desc1.includes(TOLERANCE_LABELS.low))
  check('スタイル志向ラベルを含む', desc1.includes(STYLE_LABELS.income))
  check('capacity省略時は資金の性格の行が無い', !desc1.includes('資金の性格'))

  const withCapacity: ReaderProfile = { horizon: 'long', tolerance: 'high', style: 'growth', capacity: 'tight' }
  const desc2 = describeReaderProfile(withCapacity)
  check('capacity指定時は資金の性格の行がある', desc2.includes('資金の性格'))
  check('capacityのラベルを含む', desc2.includes(CAPACITY_LABELS.tight))
}

// ── 3. buildEmphasisHints — 実在指標名のみ・順序/語り口の指示に留める ───────
console.log('buildEmphasisHints — 実在指標名（METRIC_INFO/DERIVED_METRIC_INFOのlabel）を返し、内容を変える指示を含まない')
{
  const income = buildEmphasisHints({ horizon: 'mid', tolerance: 'mid', style: 'income' })
  const incomeText = income.join(' ')
  check('incomeにdividendYieldの実在ラベルを含む', incomeText.includes(METRIC_INFO.dividendYield.label))
  check('incomeにfcfMarginの実在ラベルを含む', incomeText.includes(DERIVED_METRIC_INFO.fcfMargin.label))
  check('incomeにfcfPositiveYearsの実在ラベルを含む', incomeText.includes(DERIVED_METRIC_INFO.fcfPositiveYears.label))
  check('incomeにequityRatioの実在ラベルを含む', incomeText.includes(DERIVED_METRIC_INFO.equityRatio.label))
  check('incomeにprofitQualityの実在ラベルを含む', incomeText.includes(DERIVED_METRIC_INFO.profitQuality.label))

  const growth = buildEmphasisHints({ horizon: 'mid', tolerance: 'mid', style: 'growth' })
  const growthText = growth.join(' ')
  check('growthにrevenueCagr3yの実在ラベルを含む', growthText.includes(DERIVED_METRIC_INFO.revenueCagr3y.label))
  check('growthにepsCagr3yの実在ラベルを含む', growthText.includes(DERIVED_METRIC_INFO.epsCagr3y.label))
  check('growthにearningsGrowthの実在ラベルを含む', growthText.includes(METRIC_INFO.earningsGrowth.label))
  check('growthにpe(PEG文脈)の実在ラベルを含む', growthText.includes(METRIC_INFO.pe.label) && growthText.includes('PEG'))

  const value = buildEmphasisHints({ horizon: 'mid', tolerance: 'mid', style: 'value' })
  const valueText = value.join(' ')
  check('valueにpeの実在ラベルを含む', valueText.includes(METRIC_INFO.pe.label))
  check('valueにpbの実在ラベルを含む', valueText.includes(METRIC_INFO.pb.label))
  check('valueにprofitQualityの実在ラベルを含む', valueText.includes(DERIVED_METRIC_INFO.profitQuality.label))
  check('valueにequityRatioの実在ラベルを含む', valueText.includes(DERIVED_METRIC_INFO.equityRatio.label))
  check('valueにnetDebtToEbitdaの実在ラベルを含む', valueText.includes(DERIVED_METRIC_INFO.netDebtToEbitda.label))

  // 条件付きヒント: 弱気/DD厚め・長期複利・強気上値
  const bearish = buildEmphasisHints({ horizon: 'short', tolerance: 'mid', style: 'value' })
  check('horizon=shortで弱気シナリオ・最大ドローダウンのヒントが入る',
    bearish.some(h => h.includes('弱気シナリオ') && h.includes('最大ドローダウン')))

  const tightCapacity = buildEmphasisHints({ horizon: 'mid', tolerance: 'mid', style: 'value', capacity: 'tight' })
  check('capacity=tightでも弱気シナリオ・最大ドローダウンのヒントが入る',
    tightCapacity.some(h => h.includes('弱気シナリオ') && h.includes('最大ドローダウン')))

  const lowTolerance = buildEmphasisHints({ horizon: 'mid', tolerance: 'low', style: 'value' })
  check('tolerance=lowでも弱気シナリオ・最大ドローダウンのヒントが入る',
    lowTolerance.some(h => h.includes('弱気シナリオ') && h.includes('最大ドローダウン')))

  const neutral = buildEmphasisHints({ horizon: 'mid', tolerance: 'mid', style: 'value' })
  check('horizon=mid・tolerance=mid・capacity省略では弱気厚めヒントが入らない',
    !neutral.some(h => h.includes('弱気シナリオ') && h.includes('最大ドローダウン')))

  const longHorizon = buildEmphasisHints({ horizon: 'long', tolerance: 'mid', style: 'value' })
  check('horizon=longで複利・時間分散のヒントが入る',
    longHorizon.some(h => h.includes('複利') && h.includes('時間分散')))
  check('horizon=longのヒントに免責（予言ではない旨）が入る',
    longHorizon.some(h => h.includes('複利') && h.includes('予言ではない')))

  const highTolerance = buildEmphasisHints({ horizon: 'mid', tolerance: 'high', style: 'value' })
  check('tolerance=highで上値余地・カタリストのヒントが入る',
    highTolerance.some(h => h.includes('上値余地') || h.includes('カタリスト')))

  // 「この指標だけ見ろ／リスクを省け」的な内容変更の指示を含まないこと
  const all = [...income, ...growth, ...value, ...bearish, ...longHorizon, ...highTolerance]
  check(
    '「〜だけ見ろ」等の指標限定の指示を含まない',
    !all.some(h => /だけ(見|注目|重視せよ)/.test(h)),
  )
  check(
    '「リスクを省略する／触れない」等のリスク隠蔽指示を含まない',
    !all.some(h => /リスク.*(省略する|触れない|省く)/.test(h)),
  )
}

// ── 4/5. buildReportPrompt — profile有無での差分・意味づけ強制の常時性 ──────
console.log('buildReportPrompt — profile指定時のみ【読者プロファイル】節を含み、意味づけ強制は常に含む')
{
  const bundle: PreparedBundle = {
    request: {
      symbol: 'AAPL',
      condition: {
        technical: { type: 'technical', indicator: 'ma_cross_dual', shortPeriod: 20, longPeriod: 50 },
        fundamentalFilters: [{ metric: 'dividendYield', operator: 'gte', value: 0.03 }],
      },
      initialCapital: 100_000,
    },
    conditionDescription: '',
    period: '5y',
    fundamentalGate: {
      passed: true,
      evaluations: [
        { filter: { metric: 'dividendYield', operator: 'gte', value: 0.03 }, actual: 0.04, result: 'pass' },
      ],
    } as FundamentalGateResult,
    statements: null,
    derived: null,
    derivedGate: { passed: true, evaluations: [] },
    backtest: {
      symbol: 'AAPL',
      currency: 'USD',
      period: '5y',
      startDate: 0,
      endDate: 1,
      barCount: 1250,
      initialCapital: 100_000,
      finalValue: 120_000,
      metrics: { totalReturnPct: 20, winRate: 55, maxDrawdownPct: 15, sharpeRatio: 0.9, tradeCount: 8 },
      trades: [],
      buyHoldReturnPct: 18,
    } as BacktestSummary,
    current: {
      quote: {
        symbol: 'AAPL', name: 'Apple Inc.', price: 200, change: 1, changePercent: 0.5,
        volume: 1000, currency: 'USD', market: 'US', isMarketOpen: true, lastUpdated: '',
      },
      technicals: '',
      fundamentals: {},
    },
    aiEvidence: { hasData: false, tradeCount: 0, winRate: 0, avgPnlPct: 0, recentTrades: [], relevantLessons: [], decisionsSummary: '' },
    learningContext: '',
    news: [],
    macro: null,
    sources: [],
    preparedAt: new Date().toISOString(),
  }

  const profile: ReaderProfile = { horizon: 'short', tolerance: 'low', style: 'income' }

  const promptWithoutProfile = buildReportPrompt(bundle)
  const promptWithProfile = buildReportPrompt(bundle, profile)

  check('profile無し: 【読者プロファイル】節を含まない', !promptWithoutProfile.includes('【読者プロファイル'))
  check('profileあり: 【読者プロファイル】節を含む', promptWithProfile.includes('【読者プロファイル'))
  check('profileあり: describeReaderProfileの内容が本文に反映される', promptWithProfile.includes(HORIZON_LABELS.short))
  check('profileあり: buildEmphasisHintsのヒントが本文に反映される',
    promptWithProfile.includes(METRIC_INFO.dividendYield.label))

  check('profile無しでも意味づけ強制の指示を含む', promptWithoutProfile.includes('意味づけの徹底'))
  check('profileありでも意味づけ強制の指示を含む', promptWithProfile.includes('意味づけの徹底'))

  // 既存規約の不変性: 9セクション見出し・順序は profile有無に関わらず同一
  const HEADINGS = [
    '## 前提', '## 使用理論', '## バックテスト結果', '## 現状分析', '## 決算書分析（複数期推移）',
    '## AIトレーダーの実績', '## 未来予想', '## 根拠チェーン', '## 引用元',
  ]
  const headingsWithout = HEADINGS.map(h => promptWithoutProfile.indexOf(h))
  const headingsWith = HEADINGS.map(h => promptWithProfile.indexOf(h))
  check('profile無し: 9セクション見出しが全て存在し順序通り', headingsWithout.every(i => i >= 0) && headingsWithout.every((v, i, arr) => i === 0 || arr[i - 1] < v))
  check('profileあり: 9セクション見出しが全て存在し順序通り', headingsWith.every(i => i >= 0) && headingsWith.every((v, i, arr) => i === 0 || arr[i - 1] < v))
}

// ── 結果 ─────────────────────────────────────────────────────────────────────
console.log('')
if (failures > 0) {
  console.error(`NG: ${failures}件のチェックが失敗しました`)
  process.exit(1)
}
console.log('OK: 全チェック合格（読者プロファイル /analyze・/report S1）')
