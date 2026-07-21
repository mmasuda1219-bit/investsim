// /analyze S4 スモーク: buildTransparencyCard（透明性カード）が PreparedBundle の
// 3要素（テクニカルトリガー・ファンダゲート実測・バックテスト要約）だけから、
// 事実のみを reasons/tags/caveats に載せることを検証する。
// - 実測値pass時: その値が reasons/tags に載る
// - no_data/欠損時: 値を創作せず「データなし」相当が caveats に載る（原則9リグレッション防止）
// - caveats に「現在値の静的判定（過去に遡及しない）」の恒久注記が必ず入る
// 合成bundleはこのスモーク限定（COMPANY.md 原則9の範囲内・実データ取得は一切行わない）。
//
// 実行: npx tsx scripts/check-analyze-s4.ts

import { buildTransparencyCard } from '../lib/report/transparency'
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

// ── 合成データ（テスト用途限定・実データ取得なし） ───────────────────────────
function makeBundle(overrides: Partial<PreparedBundle>): PreparedBundle {
  const base: PreparedBundle = {
    request: {
      symbol: 'AAPL',
      condition: {
        technical: { type: 'technical', indicator: 'ma_cross_dual', shortPeriod: 20, longPeriod: 50 },
        fundamentalFilters: [
          { metric: 'marketCap', operator: 'gte', value: 100e9 },
          { metric: 'dividendYield', operator: 'gte', value: 0.03 },
        ],
      },
      initialCapital: 100_000,
    },
    conditionDescription: '',
    period: '5y',
    fundamentalGate: {
      passed: true,
      evaluations: [
        { filter: { metric: 'marketCap', operator: 'gte', value: 100e9 }, actual: 3.2e12, result: 'pass' },
        { filter: { metric: 'dividendYield', operator: 'gte', value: 0.03 }, result: 'no_data' },
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
      finalValue: 145_000,
      metrics: {
        totalReturnPct: 45.0,
        winRate: 60,
        maxDrawdownPct: 20,
        sharpeRatio: 1.1,
        tradeCount: 12,
      },
      trades: [],
      buyHoldReturnPct: 30.0,
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
  return { ...base, ...overrides }
}

// ── 1. pass時: 実測値が reasons/tags に載る（原則9: 実測できた事実は正直に表示） ──
console.log('buildTransparencyCard — pass時に実測値がreasons/tagsに載る')
{
  const bundle = makeBundle({})
  const card = buildTransparencyCard(bundle)

  check('reasonsに技術トリガーの説明が入る',
    card.reasons.some(r => r.includes('ゴールデンクロス') || r.includes('デッドクロス') || /MAが.*上抜け/.test(r)))
  check('reasonsにmarketCapのpass実測値(3200.0B)が入る',
    card.reasons.some(r => r.includes('3200.0B') && r.includes('成立')))
  check('tagsにmarketCapの実測値タグが入る', card.tags.some(t => t.includes('3200.0B')))
  check('reasonsにバックテスト総リターン(+45.00%)が入る', card.reasons.some(r => r.includes('+45.00%')))
  check('tagsにバックテスト総合タグが入る', card.tags.some(t => t.includes('+45.00%')))
}

// ── 2. no_data/欠損時: 値を創作せず「データなし」相当がcaveatsに載る ─────────
console.log('buildTransparencyCard — no_data時に値を創作せず「データなし」がcaveatsに載る（原則9リグレッション防止）')
{
  const bundle = makeBundle({})
  const card = buildTransparencyCard(bundle)

  check('no_dataの配当利回りはreasons/tagsに実測値として載らない（捏造禁止）',
    !card.reasons.some(r => r.includes('配当利回り') && /実測 \d/.test(r)) &&
    !card.tags.some(t => t.includes('配当利回り') && /実測\d/.test(t)))
  check('no_dataの配当利回りは「データなし」としてcaveatsに載る',
    card.caveats.some(c => c.includes('配当利回り') && c.includes('データなし')))
}

// ── 3. caveatsに「現在値静的判定」の恒久注記が入る ───────────────────────────
console.log('buildTransparencyCard — caveatsに現在値静的判定（過去に遡及しない）の注記が必ず入る')
{
  const bundle = makeBundle({})
  const card = buildTransparencyCard(bundle)
  check('caveatsに「現在値」かつ「遡及」を含む注記がある',
    card.caveats.some(c => c.includes('現在値') && c.includes('遡及')))
}

// ── 4. バックテスト未実行（ゲート不成立でbacktest=null）時のfail-closed表示 ──
console.log('buildTransparencyCard — backtest=null（ゲート不成立）時は未実行とcaveatsに正直表示・数値を捏造しない')
{
  const bundle = makeBundle({
    backtest: null,
    fundamentalGate: {
      passed: false,
      evaluations: [
        { filter: { metric: 'marketCap', operator: 'gte', value: 100e9 }, actual: 5e9, result: 'fail' },
      ],
    } as FundamentalGateResult,
  })
  const card = buildTransparencyCard(bundle)
  check('reasonsにバックテストの数値を捏造しない（総リターン等の文言が無い）',
    !card.reasons.some(r => r.includes('総リターン')))
  check('caveatsに「バックテスト未実行」が入る', card.caveats.some(c => c.includes('バックテスト未実行')))
  check('fail評価はreasonsでなくcaveatsに実測値つきで載る（参加条件不成立）',
    card.caveats.some(c => c.includes('参加条件不成立') && c.includes('5.0B')))
}

// ── 結果 ─────────────────────────────────────────────────────────────────────
console.log('')
if (failures > 0) {
  console.error(`NG: ${failures}件のチェックが失敗しました`)
  process.exit(1)
}
console.log('OK: 全チェック合格（/analyze S4 — buildTransparencyCard）')
