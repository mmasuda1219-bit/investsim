// S4-0: extractDecisionArray（打ち切り耐性つきの判断 JSON 取り出し）のスモークテスト。
//   $env:PATH = "C:\Program Files\nodejs;$env:PATH"; npx tsx scripts/check-decision-parse.ts
import { extractDecisionArray } from '../lib/ai-trader/decision-parse'

let failed = 0
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`)
  if (!ok) failed++
}

const A = { symbol: 'AAPL', action: 'buy', reasoning: '決算が良い。' }
const B = { symbol: 'NVDA', action: 'hold', reasoning: 'RSI72で買われすぎ。' }
const C = { symbol: '7203.T', action: 'watch', reasoning: '値動きが「横ばい」で根拠不足。' }
const full = JSON.stringify([A, B, C], null, 2)

console.log('正常系')
check('フェンスあり・配列完結 → 3件', extractDecisionArray('前置き\n```json\n' + full + '\n```\n後書き').length, 3)
check('フェンスあり・中身が一致', extractDecisionArray('```json\n' + full + '\n```'), [A, B, C])
check('フェンス無し・配列完結 → 3件', extractDecisionArray(full).length, 3)

console.log('打ち切り（閉じフェンス無し）')
check('閉じフェンス無し・配列完結 → 3件', extractDecisionArray('```json\n' + full).length, 3)
const cut2 = '```json\n[\n' + JSON.stringify(A) + ',\n' + JSON.stringify(B).slice(0, 25)
check('2件目の途中で切れる → 1件救出', extractDecisionArray(cut2), [A])
const cut3 = '```json\n[\n' + JSON.stringify(A) + ',\n' + JSON.stringify(B) + ',\n' + JSON.stringify(C).slice(0, 40)
check('3件目の途中で切れる → 2件救出', extractDecisionArray(cut3), [A, B])
check('1件目の途中で切れる → 0件', extractDecisionArray('```json\n[\n{"symbol":"AAPL","action":"b').length, 0)

console.log('文字列の中の括弧・引用符')
const tricky = { symbol: 'META', action: 'sell', reasoning: '見出し「{注意}」と \\"引用\\" を含む。}]' }
const cutT = '```json\n[\n' + JSON.stringify(tricky) + ',\n' + JSON.stringify(B).slice(0, 10)
check('文字列内の { } " \\" を数えない → 1件救出・内容一致', extractDecisionArray(cutT), [tricky])

console.log('空・無関係')
check('空文字 → 0件', extractDecisionArray('').length, 0)
check('JSONが無い文章 → 0件', extractDecisionArray('判断できませんでした。').length, 0)
check('配列でなくオブジェクト → 0件', extractDecisionArray('```json\n{"symbol":"AAPL"}\n```').length, 0)
check('フェンスはあるが中身が空 → 0件', extractDecisionArray('```json\n\n```').length, 0)

console.log('本番っぽい打ち切り（13銘柄を9件目の途中で切る）')
const many = Array.from({ length: 13 }, (_, i) => ({ symbol: `S${i}`, action: 'hold', reasoning: `理由${i}。`.repeat(8) }))
const manyText = '```json\n' + JSON.stringify(many, null, 2)
const cutAt = manyText.indexOf('"symbol": "S8"') + 30
check('9件目の途中で切れる → 8件救出', extractDecisionArray(manyText.slice(0, cutAt)).length, 8)

// S4-1(2026-09-15): プロンプトを「1判断1行・字下げ無し」に変えたので、新旧どちらの形でも読めることを確かめる。
console.log('S4-1 1判断1行・字下げ無し（新しい出力形式）')
const compact = '[\n' + [A, B, C].map(o => JSON.stringify(o)).join(',\n') + '\n]'
check('1行形式・フェンスあり → 3件', extractDecisionArray('```json\n' + compact + '\n```').length, 3)
check('1行形式・フェンスあり・中身が一致', extractDecisionArray('```json\n' + compact + '\n```'), [A, B, C])
check('1行形式・フェンス無し → 3件', extractDecisionArray(compact).length, 3)
check('改行が1つも無い1行の配列 → 3件・中身が一致', extractDecisionArray(JSON.stringify([A, B, C])), [A, B, C])
const compactCut = '```json\n[\n' + JSON.stringify(A) + ',\n' + JSON.stringify(B) + ',\n' + JSON.stringify(C).slice(0, 30)
check('1行形式・3件目の途中で切れる → 2件救出', extractDecisionArray(compactCut), [A, B])
const compactCutNoLF = '```json\n[' + JSON.stringify(A) + ',' + JSON.stringify(B).slice(0, 18)
check('改行無し・2件目の途中で切れる → 1件救出', extractDecisionArray(compactCutNoLF), [A])

// 本番の形（9銘柄・新しい字数上限いっぱいの長さ）を1行ずつ書き、9件目の途中で切る
console.log('S4-1 本番の形（9銘柄・字数上限いっぱい・1件1行）')
const nine = Array.from({ length: 9 }, (_, i) => ({
  symbol: `S${i}`, action: 'hold', confidence: 'medium',
  reasoning: '理'.repeat(80), newsInfluence: 'ニ'.repeat(50),
  techSignal: 'テ'.repeat(50), fundSignal: 'フ'.repeat(60), knowledgeRefs: [],
}))
const nineLines = nine.map(o => JSON.stringify(o))
check('9件そろって完結 → 9件', extractDecisionArray('```json\n[\n' + nineLines.join(',\n') + '\n]\n```').length, 9)
const nineText = '```json\n[\n' + nineLines.join(',\n')
check('閉じフェンスも ] も無い（max_tokens 直前）→ 9件', extractDecisionArray(nineText).length, 9)
check('9件目の途中で切れる → 8件救出', extractDecisionArray(nineText.slice(0, nineText.lastIndexOf('{') + 120)).length, 8)
check('9件目の末尾の " が閉じずに切れる → 8件救出',
  extractDecisionArray(nineText.slice(0, nineText.length - 40)).length, 8)

console.log('')
if (failed) { console.log(`${failed} 件 FAIL`); process.exit(1) }
console.log('すべてPASS')
