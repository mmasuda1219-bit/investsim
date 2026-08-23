// 「振り返る」スモーク: buildJudgements が売買履歴を判断↔結果の対応に組み直せることを検証する。
// - 保存順（新しい順）で渡されても時系列で正しく処理する
// - 部分決済がFIFOで対応づく
// - 未決済は含み損益を作らず null のままにする（現在値を持たないため・原則9）
// - 理由が無い取引を「理由あり」に見せない
// - 往復3件未満では enoughForStats=false（表示側が統計語を使わないため）
//
// 実行: npx tsx scripts/check-review-judgement.ts

import { buildJudgements } from '../lib/review/judgement'
import type { Trade } from '../lib/portfolio'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  PASS ${name}`)
  else { failures++; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}

const DAY = 86_400_000
const T0 = 1_700_000_000_000

const trade = (o: Partial<Trade> & Pick<Trade, 'symbol' | 'action' | 'shares' | 'price' | 'timestamp'>): Trade => ({
  id: `${o.symbol}-${o.timestamp}-${o.action}`,
  name: o.name ?? `${o.symbol} Inc.`,
  ...o,
} as Trade)

console.log('buildJudgements — 基本の往復')
{
  // 保存は新しい順（unshift）なので、あえて逆順で渡す
  const trades: Trade[] = [
    trade({ symbol: 'AAPL', action: 'sell', shares: 10, price: 110, timestamp: T0 + 30 * DAY, reason: '目標に届いたので利確' }),
    trade({ symbol: 'AAPL', action: 'buy',  shares: 10, price: 100, timestamp: T0,            reason: '決算が良く、下げたところを拾う' }),
  ]
  const r = buildJudgements(trades)
  check('往復1件が完結として数えられる', r.closedCount === 1, `actual=${r.closedCount}`)
  check('未決済は0件', r.openCount === 0, `actual=${r.openCount}`)
  const j = r.judgements[0]
  check('実現損益率が+10.00%', j?.pnlPct !== null && Math.abs((j!.pnlPct as number) - 10) < 1e-9, `actual=${j?.pnlPct}`)
  check('保有日数が30日', j?.heldDays === 30, `actual=${j?.heldDays}`)
  check('買いの理由が対応づく', j?.entryReason === '決算が良く、下げたところを拾う')
  check('売りの理由が対応づく', j?.exitReason === '目標に届いたので利確')
  check('往復3件未満なので enoughForStats=false', r.enoughForStats === false)
}

console.log('buildJudgements — 未決済は含み損益を作らない')
{
  const trades: Trade[] = [
    trade({ symbol: 'NVDA', action: 'buy', shares: 5, price: 200, timestamp: T0, reason: '成長が続くと考えた' }),
  ]
  const r = buildJudgements(trades)
  check('未決済1件', r.openCount === 1 && r.closedCount === 0)
  const j = r.judgements[0]
  check('pnlPct は null（現在値を持たないので算出しない）', j?.pnlPct === null, `actual=${j?.pnlPct}`)
  check('exitAt は null', j?.exitAt === null)
  check('heldDays は null', j?.heldDays === null)
  check('買いの理由は残る', j?.entryReason === '成長が続くと考えた')
}

console.log('buildJudgements — 部分決済はFIFOで対応づく')
{
  const trades: Trade[] = [
    trade({ symbol: 'MSFT', action: 'buy',  shares: 10, price: 100, timestamp: T0,            reason: '1回目の判断' }),
    trade({ symbol: 'MSFT', action: 'buy',  shares: 10, price: 200, timestamp: T0 + 5 * DAY,  reason: '2回目の判断' }),
    trade({ symbol: 'MSFT', action: 'sell', shares: 15, price: 300, timestamp: T0 + 10 * DAY, reason: '半分以上を利確' }),
  ]
  const r = buildJudgements(trades)
  check('完結2件（10株ぶん＋5株ぶん）', r.closedCount === 2, `actual=${r.closedCount}`)
  check('未決済1件（残り5株）', r.openCount === 1, `actual=${r.openCount}`)
  const closed = r.judgements.filter(j => j.pnlPct !== null)
  const first = closed.find(j => j.entryReason === '1回目の判断')
  const second = closed.find(j => j.entryReason === '2回目の判断')
  check('古い買いから充当される（1回目が10株）', first?.shares === 10, `actual=${first?.shares}`)
  check('1回目の損益率が+200.00%', first !== undefined && Math.abs(first.pnlPct! - 200) < 1e-9, `actual=${first?.pnlPct}`)
  check('2回目は5株ぶんだけ充当', second?.shares === 5, `actual=${second?.shares}`)
  check('2回目の損益率が+50.00%', second !== undefined && Math.abs(second.pnlPct! - 50) < 1e-9, `actual=${second?.pnlPct}`)
}

console.log('buildJudgements — 理由の欠落を偽らない')
{
  const trades: Trade[] = [
    trade({ symbol: 'V', action: 'buy',  shares: 1, price: 100, timestamp: T0 }),                       // 理由なし
    trade({ symbol: 'V', action: 'sell', shares: 1, price: 90,  timestamp: T0 + DAY, reason: '  ' }),   // 空白のみ
  ]
  const r = buildJudgements(trades)
  const j = r.judgements[0]
  check('理由なしの買いは null', j?.entryReason === null)
  check('空白だけの理由は null に正規化', j?.exitReason === null)
  check('理由ありの件数に数えない', r.withEntryReason === 0, `actual=${r.withEntryReason}`)
  check('買いの総数は数える', r.entryCount === 1, `actual=${r.entryCount}`)
  check('損失も正しく出る（-10.00%）', Math.abs((j!.pnlPct as number) + 10) < 1e-9, `actual=${j?.pnlPct}`)
}

console.log('buildJudgements — 往復3件で統計が許可される')
{
  const trades: Trade[] = []
  for (let i = 0; i < 3; i++) {
    trades.push(trade({ symbol: 'X', action: 'buy',  shares: 1, price: 100, timestamp: T0 + i * 10 * DAY }))
    trades.push(trade({ symbol: 'X', action: 'sell', shares: 1, price: 110, timestamp: T0 + (i * 10 + 5) * DAY }))
  }
  const r = buildJudgements(trades)
  check('完結3件', r.closedCount === 3, `actual=${r.closedCount}`)
  check('enoughForStats=true', r.enoughForStats === true)
}

console.log('buildJudgements — 空入力で落ちない')
{
  const r = buildJudgements([])
  check('空でも例外にならず0件を返す',
    r.judgements.length === 0 && r.closedCount === 0 && r.openCount === 0 && r.entryCount === 0)
  check('空では enoughForStats=false', r.enoughForStats === false)
}

console.log(`\n${failures === 0 ? '全PASS' : `NG: ${failures}件のチェックが失敗しました`}`)
process.exit(failures === 0 ? 0 : 1)
