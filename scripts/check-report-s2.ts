// /report S2 スモーク: 「未来予想」セクションの投資テーゼ化（strategist設計・
// オーナー承認済みロードマップ）を検証する。buildReportPrompt の出力（純文字列）
// のみを対象にし、ネットワーク・実API不要（合成bundleはテスト用途限定・
// COMPANY.md原則9の範囲内）。
//
// 検証項目:
// 1. 「未来予想」節にテーゼ差分（市場コンセンサスとの差分）を要求する指示がある
// 2. 3シナリオ（強気/中立/弱気）＋各カタリストを要求する指示がある
// 3. リスク＋緩和策のペアを要求する指示がある
// 4. ベア耐性の一言判定（安全域の言語化）を要求する指示がある
// 5. 架空の確率・具体的な騰落率を作らせない歯止めの指示がある（複数箇所）
// 6. 9セクションの見出し・順序が不変（profile有無どちらでも）
// 7. S1の読者プロファイル節・意味づけ強制・根拠チェーン・一貫性チェックが温存されている
// 8. 既存のリーガルトーン（断定回避・投資助言でない旨・免責）が温存されている
//
// 実行: npx tsx scripts/check-report-s2.ts

import { buildReportPrompt } from '../lib/report/prompt'
import type { PreparedBundle } from '../lib/report/types'
import type { ReaderProfile } from '../lib/report/profile'
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

// ── 1. テーゼ差分（市場コンセンサスとの差分）─────────────────────────────
console.log('未来予想 — 市場コンセンサスとの差分（テーゼ差分）を要求する指示がある')
{
  check('市場のコンセンサスとの差分を1〜2文で述べる指示がある', promptWithoutProfile.includes('市場のコンセンサス') && promptWithoutProfile.includes('差分'))
  check('可能性としての表現（断定回避）の指示がある', promptWithoutProfile.includes('可能性がある'))
  check('良い会社≠良い投資の視点を促す指示がある', promptWithoutProfile.includes('良い会社であることと良い投資であることは別である'))
  check('テーゼ差分にも引用元[n]を要求している', /差分[\s\S]{0,150}引用元番号\[n\]/.test(promptWithoutProfile))
}

// ── 2. 3シナリオ＋カタリスト ──────────────────────────────────────────────
console.log('未来予想 — 強気/中立/弱気の3シナリオ＋各カタリストを要求する指示がある')
{
  check('強気・中立・弱気の3シナリオ構造を明示している', promptWithoutProfile.includes('強気・中立・弱気の3シナリオ'))
  check('各シナリオにカタリストを要求している', promptWithoutProfile.includes('カタリスト'))
  check('カタリストの範囲を実データ/既知の一般情報に限定している', promptWithoutProfile.includes('既知の一般情報の範囲に限る'))
  check('条件・目安となる価格/指標水準の明示も維持されている', promptWithoutProfile.includes('目安となる価格/指標水準'))
}

// ── 3. リスク＋緩和策のペア ───────────────────────────────────────────────
console.log('未来予想 — リスクを挙げる際に緩和材料とのペアを強制する指示がある')
{
  check('リスクと緩和材料のペアを要求している', promptWithoutProfile.includes('緩和材料'))
  check('リスクの列挙だけで終わらせない旨の指示がある', promptWithoutProfile.includes('リスクの列挙だけで終わらせない'))
  check('厳守事項にもリスク＋緩和ペアの要求が反映されている', promptWithoutProfile.includes('リスクと緩和材料のペア'))
}

// ── 4. ベア耐性の一言判定 ─────────────────────────────────────────────────
console.log('未来予想 — 弱気シナリオでの株価水準の正当性についての一言判定を要求している')
{
  check('弱気シナリオが実現しても株価水準が正当化されうるかの判定を要求している',
    promptWithoutProfile.includes('弱気シナリオが実現しても、現在の株価水準は正当化されうるか'))
  check('安全域の言語化を求めている', promptWithoutProfile.includes('安全域'))
}

// ── 5. 架空の確率・具体的な騰落率の禁止（複数箇所での歯止め）───────────────
console.log('未来予想 — 架空の確率・具体的な騰落率を作らせない歯止めがある')
{
  const bogusExampleCount = (promptWithoutProfile.match(/70%の確率で\+20%/g) || []).length
  check('具体例つきの禁止指示が本文中にある（未来予想節・厳守事項の2箇所）', bogusExampleCount >= 2, `count=${bogusExampleCount}`)
  check('架空の確率という語で明示的に禁止している', promptWithoutProfile.includes('架空の確率'))
  check('バックテスト実測勝率と混同させない旨の説明がある（厳守事項）', promptWithoutProfile.includes('実際のバックテストの実測勝率データに基づく別機能の担当'))
  check('「過去の傾向に基づくと」等の条件付き定性表現の枠を明示するよう求めている', promptWithoutProfile.includes('過去の傾向に基づくと'))
  // 禁止用の反例（「70%の確率で+20%」）以外に、確率・騰落率を書けと促す文言が
  // 紛れ込んでいないこと（「禁止」「作らない」を伴わない裸の「〜%の確率で」が無い）
  const withoutBanExample = promptWithoutProfile.replace(/70%の確率で\+20%/g, '')
  check('禁止用の反例を除けば「〜%の確率で」という具体的確率の記述は無い',
    !/\d+%の確率で/.test(withoutBanExample))
}

// ── 6. 9セクションの見出し・順序が不変 ───────────────────────────────────
console.log('9セクションの見出し・順序が不変（profile有無どちらでも）')
{
  const HEADINGS = [
    '## 前提', '## 使用理論', '## バックテスト結果', '## 現状分析', '## 決算書分析（複数期推移）',
    '## AIトレーダーの実績', '## 未来予想', '## 根拠チェーン', '## 引用元',
  ]
  for (const p of [promptWithoutProfile, promptWithProfile]) {
    const idx = HEADINGS.map(h => p.indexOf(h))
    check(`全9見出しが存在する（${p === promptWithoutProfile ? 'profile無し' : 'profileあり'}）`, idx.every(i => i >= 0), JSON.stringify(idx))
    check(`見出しの順序が不変（${p === promptWithoutProfile ? 'profile無し' : 'profileあり'}）`, idx.every((v, i, arr) => i === 0 || arr[i - 1] < v))
  }
  check('maxTokens(4500)は本ファイルでは変更していない（generate route側の値・prompt.tsに数値なし）', !promptWithoutProfile.includes('max_tokens'))
}

// ── 7. S1の読者プロファイル節・意味づけ強制・根拠チェーン・一貫性チェックの温存 ──
console.log('S1（読者プロファイル）・既存の根拠チェーン/一貫性チェック/意味づけ強制が温存されている')
{
  check('profile無し: 【読者プロファイル】節を含まない', !promptWithoutProfile.includes('【読者プロファイル'))
  check('profileあり: 【読者プロファイル】節を含む', promptWithProfile.includes('【読者プロファイル'))
  check('意味づけの徹底の指示が残っている', promptWithoutProfile.includes('意味づけの徹底'))
  check('根拠チェーンの必須化の指示が残っている', promptWithoutProfile.includes('根拠チェーンの必須化'))
  check('一貫性チェックの小見出し指示が残っている', promptWithoutProfile.includes('一貫性チェック'))
  check('教訓の正直表示の指示が残っている', promptWithoutProfile.includes('教訓の正直表示'))
}

// ── 8. 既存のリーガルトーンの温存・強化 ──────────────────────────────────
console.log('既存のリーガルトーン（断定回避・投資助言でない旨・免責）が温存・強化されている')
{
  check('断定・助言表現の回避の指示が残っている', promptWithoutProfile.includes('断定・助言表現の回避'))
  check('投資助言でない旨の明記の指示が残っている', promptWithoutProfile.includes('投資助言でない旨の明記'))
  check('未来予想は予言ではない旨の明記が残っている', promptWithoutProfile.includes('未来予想は実データ＋AI推論であり予言ではない旨を明記する'))
  check('投資テーゼとしての未来予想の厳守事項が追加されている', promptWithoutProfile.includes('投資テーゼとしての未来予想'))
}

// ── 結果 ─────────────────────────────────────────────────────────────────
console.log('')
if (failures > 0) {
  console.error(`NG: ${failures}件のチェックが失敗しました`)
  process.exit(1)
}
console.log('OK: 全チェック合格（/report S2 投資テーゼ化）')
