// 過去の取引の記録（案C・migration 0007）のスモーク。
//
// ここで守りたいこと:
//  - 練習場の売買と «実際にやった取引の記録» を、突き合わせで混ぜない。
//    混ざると、練習の売りが記録の買いを決済して «存在しない往復» が結果として出る。
//  - 過去の記録でも往復・損益・保有日数が正しく出る（初日から振り返れるのが目的）。
//  - source が無い古い行は練習場扱いにする（0007以前のデータを壊さない）。
//  - 過去の記録用の問いは「降りる条件」を必須にしない（決めていなかった人に
//    でっち上げさせない）。
//
// 実行: npx tsx scripts/check-past-trade.ts

import { buildJudgements } from '../lib/review/judgement'
import { pastFieldsFor, validateFrom, composeFrom, parseReason } from '../lib/trade/reason'
import type { Trade } from '../lib/portfolio'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  PASS ${name}`)
  else { failures++; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}

const DAY = 86_400_000
const T0 = 1_700_000_000_000

const trade = (o: Partial<Trade> & Pick<Trade, 'symbol' | 'action' | 'shares' | 'price' | 'timestamp'>): Trade => ({
  id: `${o.symbol}-${o.timestamp}-${o.action}-${o.source ?? 'practice'}`,
  name: o.name ?? `${o.symbol} Inc.`,
  ...o,
} as Trade)

console.log('練習場と過去の記録を混ぜない')
{
  // 同じ AAPL を «練習場で買い» と «過去の記録で買い»、そのあと練習場で売る。
  // 混ざると、練習の売りが古い «記録の買い» を決済してしまう。
  const trades: Trade[] = [
    trade({ symbol: 'AAPL', action: 'buy',  shares: 10, price: 100, timestamp: T0,            source: 'past',     reason: '記録の買い' }),
    trade({ symbol: 'AAPL', action: 'buy',  shares: 10, price: 200, timestamp: T0 + 10 * DAY, source: 'practice', reason: '練習の買い' }),
    trade({ symbol: 'AAPL', action: 'sell', shares: 10, price: 220, timestamp: T0 + 20 * DAY, source: 'practice', reason: '練習の売り' }),
  ]
  const r = buildJudgements(trades)
  check('完結は1件だけ', r.closedCount === 1, `actual=${r.closedCount}`)
  check('未決済は1件（記録の買いが残る）', r.openCount === 1, `actual=${r.openCount}`)

  const closed = r.judgements.find(j => j.pnlPct !== null)
  check('決済されたのは練習場の買い', closed?.source === 'practice', `actual=${closed?.source}`)
  check('練習場の損益は+10.00%（200→220）',
    closed?.pnlPct !== null && Math.abs((closed!.pnlPct as number) - 10) < 1e-9, `actual=${closed?.pnlPct}`)
  check('練習の売りが記録の買いを決済していない', closed?.entryReason === '練習の買い', `actual=${closed?.entryReason}`)

  const open = r.judgements.find(j => j.pnlPct === null)
  check('残ったのは過去の記録', open?.source === 'past', `actual=${open?.source}`)
}

console.log('過去の記録だけでも往復が閉じる（初日から振り返れる）')
{
  const trades: Trade[] = [
    trade({ symbol: 'NVDA', action: 'sell', shares: 5, price: 90,  timestamp: T0 + 60 * DAY, source: 'past', reason: '怖くなって売った' }),
    trade({ symbol: 'NVDA', action: 'buy',  shares: 5, price: 100, timestamp: T0,            source: 'past', reason: 'SNSで見て買った' }),
  ]
  const r = buildJudgements(trades)
  check('往復1件が完結', r.closedCount === 1, `actual=${r.closedCount}`)
  const j = r.judgements[0]
  check('損益が-10.00%', j?.pnlPct !== null && Math.abs((j!.pnlPct as number) + 10) < 1e-9, `actual=${j?.pnlPct}`)
  check('保有日数60日', j?.heldDays === 60, `actual=${j?.heldDays}`)
  check('買いの理由が対応づく', j?.entryReason === 'SNSで見て買った')
  check('売りの理由が対応づく', j?.exitReason === '怖くなって売った')
  check('source=past が保持される', j?.source === 'past')
}

console.log('source が無い古い行は練習場扱い')
{
  const trades: Trade[] = [
    trade({ symbol: 'MSFT', action: 'buy',  shares: 1, price: 100, timestamp: T0, reason: '旧データ' }),
    trade({ symbol: 'MSFT', action: 'sell', shares: 1, price: 110, timestamp: T0 + DAY, reason: '旧データの売り' }),
  ]
  const r = buildJudgements(trades)
  check('往復が閉じる', r.closedCount === 1, `actual=${r.closedCount}`)
  check('source は practice に倒れる', r.judgements[0]?.source === 'practice', `actual=${r.judgements[0]?.source}`)
}

console.log('過去の記録用の問い')
{
  const entry = pastFieldsFor('entry')
  const exit = pastFieldsFor('exit')
  check('買ったときは2問', entry.length === 2, `actual=${entry.length}`)
  check('売ったときは2問', exit.length === 2, `actual=${exit.length}`)

  const exitField = entry.find(f => f.key === 'exit')
  check('「降りる条件」は必須にしない', exitField?.required === false,
    '決めていなかった人にでっち上げさせないため')
  check('主文だけで合格になる',
    validateFrom(entry, { thesis: 'SNSで見て、下げていたので買った。中身は見ていない。' }).ok)
  check('主文が無ければ不合格', !validateFrom(entry, { exit: '決めていなかった' }).ok)

  // 見出しは現在の売買と共通なので、parseReason がそのまま読める
  const text = composeFrom(entry, {
    thesis: 'SNSで見て、下げていたので買った。中身は見ていない。',
    exit: '決めていなかった',
  })
  const s = parseReason(text)
  check('見出し付きで保存される', s.length === 2 && s[0].label === '見立て' && s[1].label === '降りる条件',
    JSON.stringify(s.map(x => x.label)))
  check('「決めていなかった」がそのまま残る', s[1].value === '決めていなかった')
}

console.log('')
if (failures > 0) {
  console.error(`FAILED: ${failures} 件`)
  process.exit(1)
}
console.log('すべてPASS')
