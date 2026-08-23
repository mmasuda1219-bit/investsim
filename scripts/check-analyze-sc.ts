// /analyze S-C スモーク: buildExecutionPlan（あなたが選んだルールの過去5年の成績）が
// PreparedBundle だけから、実測値のみを法務制約の範囲内で出すことを検証する。
// - 空状態4分岐（backtest=null / シグナル0件 / 往復0件 / 往復1件）で
//   「見出しだけ出て中身が空」「0や『—』を数値として並べる」が起きないこと
// - 末尾が buy のとき「未決済1件」として別掲され、約定件数と往復件数の辻褄が合うこと
// - 勝率が lib/backtest/metrics.ts（単一真実源）の値と一致すること（二重定義の検出）
// - 出力文字列に禁止語（推奨/おすすめ/買い時/売り時 等）・価格提示・禁止フィールド名が
//   含まれないこと
// - 母集団 n が3未満のとき統計語（中央値・平均）を使っていないこと
// - W1: ExecutionPlanCard.tsx のUI静的文言（見出し・バッジ・キャプション）にも同じ
//   禁止語走査をかけ、法務必須注記（EXECUTION_PLAN_NOTE_LINES/InsightNote）の参照が
//   消されていないことを固定する
// - W3: 全 TechnicalCondition で出口（売り側）文言の抽出が機能する（書式結合の検知）
// 合成bundleはこのスモーク限定（COMPANY.md 原則9の範囲内・実データ取得は一切行わない）。
// Claude API は呼ばない（純関数テスト）。
//
// 実行: npx tsx scripts/check-analyze-sc.ts

import {
  buildExecutionPlan,
  EXECUTION_PLAN_NOTE_LINES,
  type ExecutionPlan,
} from '../lib/report/execution'
import fs from 'node:fs'
import path from 'node:path'
import { computeMetrics, pairRoundTrips, roundTrips } from '../lib/backtest/metrics'
import type { BacktestTrade, EquityPoint, TechnicalCondition } from '../lib/backtest/types'
import type { PreparedBundle, BacktestSummary } from '../lib/report/types'
import type { FundamentalGateResult } from '../lib/backtest/fundamental'

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
const DAY = 86_400
const START = 1_600_000_000 // 2020-09-13 (UTC)
const END = START + 1825 * DAY // 約5年後

const buy = (day: number, value: number, price = 100): BacktestTrade => ({
  time: START + day * DAY, action: 'buy', price, shares: value / price, value,
})
const sell = (day: number, value: number, price = 100): BacktestTrade => ({
  time: START + day * DAY, action: 'sell', price, shares: value / price, value,
})

function makeBacktest(trades: BacktestTrade[], curve: EquityPoint[]): BacktestSummary {
  return {
    symbol: 'AAPL',
    currency: 'USD',
    period: '5y',
    startDate: START,
    endDate: END,
    barCount: 1250,
    initialCapital: 100_000,
    finalValue: curve[curve.length - 1]?.value ?? 100_000,
    // metrics は本物の computeMetrics で作る（勝率の単一真実源テストの前提）。
    metrics: computeMetrics(curve, trades),
    trades,
    buyHoldReturnPct: 30,
  }
}

function makeBundle(overrides: Partial<PreparedBundle>): PreparedBundle {
  const base: PreparedBundle = {
    request: {
      symbol: 'AAPL',
      condition: {
        technical: { type: 'technical', indicator: 'ma_cross', period: 20 },
        fundamentalFilters: [],
      },
      initialCapital: 100_000,
    },
    conditionDescription: '',
    period: '5y',
    fundamentalGate: { passed: true, evaluations: [] } as FundamentalGateResult,
    statements: null,
    derived: null,
    derivedGate: { passed: true, evaluations: [] },
    backtest: null,
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

/** プランの表示文字列を全部集める（禁止語・統計語の全文走査用）。 */
function planStrings(plan: ExecutionPlan): string[] {
  return [
    plan.ruleDescription,
    ...plan.exitLines,
    ...plan.notes,
    ...plan.facts.flatMap(f => [f.label, f.value, f.sub ?? '']),
    ...plan.rawRoundTrips,
  ]
}

/**
 * 統計語走査の前処理: 「移動平均」は指標名であって統計語ではないため除外する。
 * これを外すと ma_cross 系の ruleDescription（例:「終値が20日移動平均を上抜けで買い」）が
 * /平均/ に誤ヒットし、n<3 の分岐が実装の正否と無関係に落ちる。
 * 「中央値」および統計としての「平均」（例:「平均+15.00%」）の検出力は落とさない。
 */
const stripIndicatorName = (s: string) => s.replace(/移動平均(線)?/g, '')

const factByLabel = (plan: ExecutionPlan, part: string) =>
  plan.facts.find(f => f.label.includes(part))

// 禁止語（法務由来）— buildExecutionPlan の出力文字列と ExecutionPlanCard.tsx の
// UI静的文言（W1）の両方を、この単一の regex で走査する（二重定義しない）。
const forbiddenWords =
  /推奨|おすすめ|最適|買い時|売り時|エントリータイミング|今が好機|すべき|しましょう|目標株価|確率/

// リポジトリ内ファイルの解決（W1のソース走査用）: 既存スクリプト
// （sync-knowledge.ts 等）の process.cwd() 前提の作法に倣いつつ、cwd がリポジトリ
// ルート以外で実行された場合はこのスクリプト自身の位置（scripts/）から解決する
// 保険を掛ける。package.json に "type" 指定が無いため tsx は CJS 実行 —
// __dirname が利用できる。
function resolveFromRepo(rel: string): string {
  const fromCwd = path.join(process.cwd(), rel)
  if (fs.existsSync(fromCwd)) return fromCwd
  return path.join(__dirname, '..', rel)
}

// ── 各シナリオのプラン ───────────────────────────────────────────────────────
// A: ゲート不成立でバックテスト未実行（bundle.backtest === null）
const planA = buildExecutionPlan(makeBundle({
  backtest: null,
  gateFailReason: '時価総額が閾値未満',
  fundamentalGate: {
    passed: false,
    evaluations: [
      { filter: { metric: 'marketCap', operator: 'gte', value: 100e9 }, actual: 5e9, result: 'fail' },
    ],
  } as FundamentalGateResult,
}))

// B: シグナル未発火（trades.length === 0）
const flatCurve: EquityPoint[] = [
  { time: START, value: 100_000, price: 100 },
  { time: END, value: 100_000, price: 100 },
]
const planB = buildExecutionPlan(makeBundle({ backtest: makeBacktest([], flatCurve) }))

// C: 買いのみで完結した往復0件（未決済1件）
const planC = buildExecutionPlan(makeBundle({
  backtest: makeBacktest([buy(100, 100_000)], flatCurve),
}))

// D: 完結した往復1件（中央値に意味なし → 生の一覧）
const tradesD = [buy(0, 100_000, 100), sell(40, 105_000, 105)]
const curveD: EquityPoint[] = [
  { time: START, value: 100_000, price: 100 },
  { time: END, value: 105_000, price: 105 },
]
const planD = buildExecutionPlan(makeBundle({ backtest: makeBacktest(tradesD, curveD) }))

// E: 完結した往復3件＋末尾に未決済の買い1件（統計表示＋辻褄検査）
const tradesE = [
  buy(0, 100_000, 100),   sell(10, 110_000, 110),  // +10.00% / 10暦日 / 勝ち
  buy(100, 110_000, 100), sell(130, 104_500, 95),  // -5.00%  / 30暦日 / 負け
  buy(200, 104_500, 100), sell(250, 125_400, 120), // +20.00% / 50暦日 / 勝ち
  buy(300, 125_400, 100),                          // 未決済（往復には数えない）
]
const curveE: EquityPoint[] = [
  { time: START, value: 100_000, price: 100 },
  { time: START + 130 * DAY, value: 80_000, price: 95 }, // 最大DD 20%
  { time: END, value: 125_400, price: 120 },
]
const backtestE = makeBacktest(tradesE, curveE)
const planE = buildExecutionPlan(makeBundle({ backtest: backtestE }))

// E2: Eから末尾の未決済買いを除いたもの（クローズで終了）
const tradesE2 = tradesE.slice(0, 6)
const backtestE2 = makeBacktest(tradesE2, curveE)
const planE2 = buildExecutionPlan(makeBundle({ backtest: backtestE2 }))

// F: 損益ちょうど0の往復1件（勝敗表示の正確性 — S3）
const tradesF = [buy(0, 100_000, 100), sell(20, 100_000, 100)]
const planF = buildExecutionPlan(makeBundle({ backtest: makeBacktest(tradesF, flatCurve) }))

// G: 往復3件のうち負け1件が損益0（平均負け幅≈0 → ペイオフ算出不可の理由文 — S3）
const tradesG = [
  buy(0, 100_000, 100),   sell(10, 110_000, 110),  // +10.00% / 勝ち
  buy(100, 110_000, 100), sell(130, 110_000, 100), // ±0.00% / 勝率上は負け側
  buy(200, 110_000, 100), sell(250, 132_000, 120), // +20.00% / 勝ち
]
const curveG: EquityPoint[] = [
  { time: START, value: 100_000, price: 100 },
  { time: START + 130 * DAY, value: 90_000, price: 95 },
  { time: END, value: 132_000, price: 120 },
]
const planG = buildExecutionPlan(makeBundle({ backtest: makeBacktest(tradesG, curveG) }))

// ── 1. 空状態4分岐: 見出しだけ出て中身が空／0や「—」の羅列、を防ぐ ──────────
console.log('buildExecutionPlan — 分岐A: backtest=null（ゲート不成立・バックテスト未実行）')
{
  check('status=no_backtest', planA.status === 'no_backtest')
  check('factsは空（0や「—」を数値として並べない）', planA.facts.length === 0)
  check('rawRoundTripsも空', planA.rawRoundTrips.length === 0)
  check('notesに「実行されていません」の正直な説明がある',
    planA.notes.some(s => s.includes('実行されていません')))
  check('notesに「存在しない数字は表示しません」がある',
    planA.notes.some(s => s.includes('表示しません')))
  check('ルールの言語化は出る（ユーザーが選んだ条件そのもの）',
    planA.ruleDescription.includes('移動平均'))
  check('出口ルール再掲: 売り側（下抜けで売り）が明示される',
    planA.exitLines.some(s => s.includes('下抜けで売り')))
  check('「損切り・利確・保有期限は設定されていません」の明示がある',
    planA.exitLines.some(s => s.includes('損切り') && s.includes('利確') && s.includes('保有期限') && s.includes('設定されていません')))
}

console.log('buildExecutionPlan — 分岐B: trades=0件（シグナル未発火）')
{
  check('status=no_signals', planB.status === 'no_signals')
  check('factsは空（0%や0日を成績として並べない）', planB.facts.length === 0)
  check('notesに「一度も発生しませんでした」がある',
    planB.notes.some(s => s.includes('一度も発生しませんでした')))
  check('notesに実測値が無い理由の明示がある',
    planB.notes.some(s => s.includes('実測値はありません')))
  check('notesは「過去5年」固定でなく検証期間（開始日〜終了日）を表記（S5）',
    planB.notes.some(s => s.includes('検証期間（2020-09-13〜')) &&
    !planB.notes.some(s => s.includes('過去5年')))
}

console.log('buildExecutionPlan — 分岐C: 買いのみで往復0件（未決済1件）')
{
  check('status=open_only', planC.status === 'open_only')
  const signals = factByLabel(planC, '発生実績')
  check('発生実績 = 買い1回・売り0回', signals?.value === '買い1回・売り0回')
  check('未決済1件が別掲される（黙って落とさない）',
    (signals?.sub ?? '').includes('未決済1件'))
  check('約定件数と往復件数の辻褄: 買い1 = 完結0 + 未決済1',
    pairRoundTrips([buy(100, 100_000)]).length === 0)
  check('notesに「確定した成績ではない」旨がある',
    planC.notes.some(s => s.includes('確定した成績ではない')))
  const exposure = factByLabel(planC, '資金拘束率')
  check('資金拘束率は未決済分も含めて実測される（94.5%）', exposure?.value === '94.5%',
    `actual=${exposure?.value}`)
  const ddC = factByLabel(planC, '最大ドローダウン')
  check('DD=0のとき符号なし「0.00%」（-0.00%と表示しない・S2）', ddC?.value === '0.00%',
    `actual=${ddC?.value}`)
  check('n<3なので統計語（中央値・平均）を一切使わない',
    !planStrings(planC).some(s => /中央値|平均/.test(stripIndicatorName(s))))
  check('往復損益・保有日数の統計ファクトを出さない（勝率・CAGRなし）',
    !planC.facts.some(f => f.label.includes('勝率') || f.label.includes('CAGR') || f.label.includes('保有日数')))
}

console.log('buildExecutionPlan — 分岐D: 往復1件（中央値に意味なし → 生の一覧）')
{
  check('status=few_round_trips', planD.status === 'few_round_trips')
  check('生の一覧が1件出る', planD.rawRoundTrips.length === 1)
  const line = planD.rawRoundTrips[0] ?? ''
  check('一覧に暦日ベースの保有日数（保有40暦日）が入る', line.includes('保有40暦日'), line)
  check('一覧に実測往復損益（+5.00%）が入る', line.includes('+5.00%'), line)
  check('一覧に勝敗（勝ち）が入る', line.includes('勝ち'), line)
  check('n<3なので統計語（中央値・平均）を一切使わない',
    !planStrings(planD).some(s => /中央値|平均/.test(stripIndicatorName(s))))
  check('勝率・CAGRのファクトを出さない（n=1では誤解を生む）',
    !planD.facts.some(f => f.label.includes('勝率') || f.label.includes('CAGR')))
}

// ── 2. 末尾buy: 「未決済1件」の別掲と件数の辻褄 ─────────────────────────────
console.log('buildExecutionPlan — 分岐E: 往復3件＋末尾買い（未決済の別掲・辻褄）')
{
  check('status=ready', planE.status === 'ready')
  const signals = factByLabel(planE, '発生実績')
  check('発生実績 = 買い4回・売り3回', signals?.value === '買い4回・売り3回')
  check('完結した往復3件と未決済1件が両方明示される',
    (signals?.sub ?? '').includes('3件') && (signals?.sub ?? '').includes('未決済1件'))
  check('辻褄: 買い4回 = 完結3件 + 未決済1件', pairRoundTrips(tradesE).length + 1 === 4)
  const lastSig = factByLabel(planE, '検証期間末の状態')
  check('検証期間末の状態: 最後が買い＝保有状態と表示',
    (lastSig?.value ?? '').includes('買い') && (lastSig?.value ?? '').includes('保有'))
  check('「直近シグナル」ラベルを使っていない（“今のシグナル”への誤読防止・S1）',
    !planE.facts.some(f => f.label.includes('直近シグナル')))
  const lastSig2 = factByLabel(planE2, '検証期間末の状態')
  check('E2（クローズで終了）: 最後が売り＝ポジションなしと表示',
    (lastSig2?.value ?? '').includes('売り') && (lastSig2?.value ?? '').includes('ポジションなし'))
  check('E2には「未決済」の文言が出ない',
    !planStrings(planE2).some(s => s.includes('未決済')))
}

// ── 3. 勝率の単一真実源（metrics.ts との一致・二重定義の検出） ───────────────
console.log('buildExecutionPlan — 勝率が metrics.ts（単一真実源）と一致する')
{
  const rt = roundTrips(tradesE)
  const pairWins = pairRoundTrips(tradesE).filter(p => p.win).length
  check('pairRoundTrips と roundTrips の勝敗が同一（薄いラッパの検査）',
    rt.wins === pairWins && rt.total === pairRoundTrips(tradesE).length)
  check('computeMetrics の勝率 = 66.67（往復3件中2勝・約定額ベース）',
    backtestE.metrics.winRate === 66.67, `actual=${backtestE.metrics.winRate}`)
  const winRateFact = factByLabel(planE, '勝率')
  check('カードの勝率表示は metrics.winRate をそのまま流用（67%）',
    winRateFact?.value === `${backtestE.metrics.winRate.toFixed(0)}%`, `actual=${winRateFact?.value}`)
  check('勝率に母集団が併記される（勝ち2件・負け1件・n=3）',
    (winRateFact?.sub ?? '').includes('勝ち2件') && (winRateFact?.sub ?? '').includes('負け1件') && (winRateFact?.sub ?? '').includes('n=3'))
}

// ── 4. 統計値の実測（n>=3・暦日・母集団n併記） ──────────────────────────────
console.log('buildExecutionPlan — n=3の統計: 中央値/最短/最長・勝ち負け平均・ペイオフ・拘束率・DD・CAGR')
{
  const holding = factByLabel(planE, '保有日数')
  check('保有日数: 中央値30日（暦日）', holding?.value === '中央値30日', `actual=${holding?.value}`)
  check('保有日数: 最短10日〜最長50日とn=3が併記',
    (holding?.sub ?? '').includes('最短10日') && (holding?.sub ?? '').includes('最長50日') && (holding?.sub ?? '').includes('n=3'))
  check('保有日数は「過去の実績値」ラベルつき（手仕舞い目安と読ませない）',
    (holding?.label ?? '').includes('暦日') && (holding?.sub ?? '').includes('過去の実績値'))
  const winFact = factByLabel(planE, '勝ちトレード')
  check('勝ちトレード: 平均+15.00%', winFact?.value === '平均+15.00%', `actual=${winFact?.value}`)
  check('勝ちトレード: 最大+20.00%とn併記',
    (winFact?.sub ?? '').includes('最大+20.00%') && (winFact?.sub ?? '').includes('n=3'))
  const lossFact = factByLabel(planE, '負けトレード')
  check('負けトレード: 平均-5.00%', lossFact?.value === '平均-5.00%', `actual=${lossFact?.value}`)
  check('負けトレード: 最大-5.00%とn併記',
    (lossFact?.sub ?? '').includes('最大-5.00%') && (lossFact?.sub ?? '').includes('n=3'))
  const payoff = factByLabel(planE, 'ペイオフ比')
  check('ペイオフ比 = 3.00（15÷5）', payoff?.value === '3.00', `actual=${payoff?.value}`)
  const exposure = factByLabel(planE, '資金拘束率')
  check('資金拘束率 = 88.5%（保有90日＋未決済1525日 ÷ 1825日）', exposure?.value === '88.5%',
    `actual=${exposure?.value}`)
  const dd = factByLabel(planE, '最大ドローダウン')
  check('最大DDの再掲 = -20.00%（metrics実測の再掲）',
    dd?.value === `-${backtestE.metrics.maxDrawdownPct.toFixed(2)}%`, `actual=${dd?.value}`)
  check('最大DDは「耐える必要があった含み損」の文脈で表示',
    (dd?.sub ?? '').includes('含み損'))
  const cagr = factByLabel(planE, 'CAGR')
  check('CAGR（+4.6x%）が実測として出る', (cagr?.value ?? '').startsWith('+4.6'), `actual=${cagr?.value}`)
  check('CAGRに往復件数（3件）が必ず併記される', (cagr?.sub ?? '').includes('往復3件'))
  check('CAGR注記: 未決済1件を含む口座全体の年率であることを明示（W2）',
    (cagr?.sub ?? '').includes('口座全体') && (cagr?.sub ?? '').includes('未決済1件'))
  const cagrE2 = factByLabel(planE2, 'CAGR')
  check('E2（未決済なし）: 口座全体の年率と明示しつつ未決済の文言なし（W2）',
    (cagrE2?.sub ?? '').includes('口座全体') && !(cagrE2?.sub ?? '').includes('未決済'))
}

// ── 4b. 損益ちょうど0の往復の表示（S3 — 勝敗表示の正確性） ───────────────────
console.log('buildExecutionPlan — 損益0の往復を「+0.00%（負け）」と表示しない')
{
  check('F: status=few_round_trips', planF.status === 'few_round_trips')
  const line = planF.rawRoundTrips[0] ?? ''
  check('F: 損益0は符号なし「0.00%」で表示（+0.00%にしない）',
    line.includes('往復損益0.00%') && !line.includes('+0.00%'), line)
  check('F: 勝敗は「負け扱い・損益ほぼ0」と正確に注記（勝率の分類と矛盾させない）',
    line.includes('負け扱い・損益ほぼ0'), line)
  check('F: n<3なので統計語（中央値・平均）を使わない',
    !planStrings(planF).some(s => /中央値|平均/.test(stripIndicatorName(s))))
  const lossG = factByLabel(planG, '負けトレード')
  check('G: 平均負け幅0は「平均0.00%」（+符号なし）', lossG?.value === '平均0.00%',
    `actual=${lossG?.value}`)
  const payoffG = factByLabel(planG, 'ペイオフ比')
  check('G: ペイオフ算出不可の理由が実態どおり「平均負け幅がほぼ0」（S3）',
    payoffG?.value === '算出不可' && (payoffG?.sub ?? '').includes('平均負け幅がほぼ0'),
    `value=${payoffG?.value} sub=${payoffG?.sub}`)
}

// ── 4c. 出口文言と describeCondition 書式の結合検査（W3） ────────────────────
// 出口（売り側）の抽出は describeCondition の「で買い・」区切りに依存している。
// 書式変更・インジケータ追加でフォールバック（全文重複表示）へ静かに劣化しない
// よう、全 TechnicalCondition メンバーで抽出が機能することを固定する。
console.log('buildExecutionPlan — 全テクニカル条件で出口（売り側）の抽出が機能する')
{
  const ALL_TECHNICALS: TechnicalCondition[] = [
    { type: 'technical', indicator: 'ma_cross', period: 20 },
    { type: 'technical', indicator: 'rsi_reversal', period: 14 },
    { type: 'technical', indicator: 'macd_cross' },
    { type: 'technical', indicator: 'bb_break', period: 20 },
    { type: 'technical', indicator: 'ma_cross_dual', shortPeriod: 20, longPeriod: 50 },
    { type: 'technical', indicator: 'hl_break', period: 20 },
    { type: 'technical', indicator: 'stoch_cross', period: 14 },
    { type: 'technical', indicator: 'roc_signal', period: 12 },
  ]
  for (const t of ALL_TECHNICALS) {
    const plan = buildExecutionPlan(makeBundle({
      request: {
        symbol: 'AAPL',
        condition: { technical: t, fundamentalFilters: [] },
        initialCapital: 100_000,
      },
    }))
    const line = plan.exitLines[0] ?? ''
    check(`${t.indicator}: 出口行に「で売り」があり「で買い」が混入しない`,
      line.includes('で売り') && !line.includes('で買い'), line)
  }
}

// ── 5. 禁止パターン（法務由来）: 全シナリオの出力文字列を走査 ────────────────
console.log('buildExecutionPlan — 禁止語・価格提示・禁止フィールドが出力に無い')
{
  const allPlans = { A: planA, B: planB, C: planC, D: planD, E: planE, E2: planE2, F: planF, G: planG }
  for (const [name, plan] of Object.entries(allPlans)) {
    const strings = planStrings(plan)
    const hitWord = strings.find(s => forbiddenWords.test(s))
    check(`シナリオ${name}: 禁止語なし`, hitWord === undefined, hitWord)
    const hitPrice = strings.find(s => /\$\s?\d/.test(s))
    check(`シナリオ${name}: $価格の提示なし`, hitPrice === undefined, hitPrice)
    check(`シナリオ${name}: 禁止フィールド名なし（型に無いものは埋められない）`,
      !/targetPrice|stopLossPrice|takeProfitPrice|probability|allocationPct|expectedReturnPct/.test(JSON.stringify(plan)))
  }
}

// ── 6. 常時表示の法務注記（カードとテストで同じ定数を参照＝単一真実源） ───────
console.log('EXECUTION_PLAN_NOTE_LINES — 必須文言が揃っている')
{
  const joined = EXECUTION_PLAN_NOTE_LINES.join('')
  check('4文で構成される', EXECUTION_PLAN_NOTE_LINES.length === 4)
  check('「機械的に計算した結果」の明示', joined.includes('機械的に計算した結果'))
  check('「当社が特定の売買価格・数量・時期を推奨するものではありません」の明示',
    joined.includes('当社が特定の売買価格・数量・時期を推奨するものではありません'))
  check('「当社やAIが独自に決めた数値は含まれていません」の明示',
    joined.includes('当社やAIが独自に決めた数値は含まれていません'))
  check('「将来も機能することを示すものではありません」の明示',
    joined.includes('将来も機能することを示すものではありません'))
}

// ── 7. カードUIの静的文言の走査（W1 — 法務の再発防止装置） ────────────────────
// buildExecutionPlan の出力だけでなく、ExecutionPlanCard.tsx 自身の見出し・バッジ・
// キャプション等の静的文言にも禁止語が入らないことをソース走査で固定する。
// あわせて法務必須注記（EXECUTION_PLAN_NOTE_LINES を InsightNote で常時表示）の
// 参照が消されていないことも検知する。
// ※注記文言そのもの（「推奨するものではありません」と否定形で「推奨」を含む）は
//   lib/report/execution.ts 側の定数にあり、このソース走査の対象には入らない。
console.log('ExecutionPlanCard.tsx — UI静的文言の禁止語走査と必須注記参照の固定')
{
  const cardPath = resolveFromRepo(path.join('components', 'analyze', 'ExecutionPlanCard.tsx'))
  const src = fs.readFileSync(cardPath, 'utf8')
  const hitLine = src.split('\n').find(line => forbiddenWords.test(line))
  check('カードソースに禁止語なし（見出し・バッジ・キャプション含む）',
    hitLine === undefined, hitLine)
  check('カードソースに$価格の提示なし', !/\$\s?\d/.test(src))
  check('法務必須注記 EXECUTION_PLAN_NOTE_LINES を参照している（注記削除の検知）',
    src.includes('EXECUTION_PLAN_NOTE_LINES'))
  check('常時表示部品 InsightNote を参照している（折りたたみ化・削除の検知）',
    src.includes('InsightNote'))
}

// ── 結果 ─────────────────────────────────────────────────────────────────────
console.log('')
if (failures > 0) {
  console.error(`NG: ${failures}件のチェックが失敗しました`)
  process.exit(1)
}
console.log('OK: 全チェック合格（/analyze S-C — buildExecutionPlan）')
