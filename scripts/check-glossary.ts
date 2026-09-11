// 用語説明（lib/ai-trader/glossary.ts）の検査。
//   $env:PATH = "C:\Program Files\nodejs;$env:PATH"; npx tsx scripts/check-glossary.ts
// - reading-highlight が札にする語が、すべて説明を引けること（本番の実例の札で確認）
// - 字数（短い意味30字・説明120字）
// - 売買を促す言い方をしていないこと（金商法の投資助言業を避ける不変条件）
import { GLOSSARY, termKeyOf } from '../lib/ai-trader/glossary'
import { highlightReading } from '../lib/ai-trader/reading-highlight'

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  ' + detail}`)
  if (!ok) failed++
}

console.log('本番の判断文の札が、すべて説明を引ける')
const REAL = [
  'MACDは強気だがROE-10.7%の根本的経営課題が未解決。テクニカルだけで買うと反落リスク高い。',
  'RSI54中立・BB内で横ばい。エントリーには根拠不足。',
  'PER17.4x割安、ROE48.7%秀逸、FCF22.7B豊富。営業利益率34%で安定。時価総額$4.2Tで反発までの時間を要する可能性。',
  'PER20.4倍・ROE12.6%・営業利益率15.9%で配当エネルギー株の基準満たす。FCF豊富で配当持続性高い。',
  'RSI72買われすぎが最強シグナル。価格>MA20>MA50の上昇トレンド継続でも反落リスク増加。',
  '下落トレンド継続（価格<MA20<MA50）・RSI47中立・MACD強気で乖離。反転候補の下げ場面。',
  '営業利益率12.2%でテック平均以下、PER計算不能、D/E49倍で高レバレッジ。バリュートラップ警戒。',
  'PER19.0x・ROE12.2%・配当3.6%・FCF$21.9Bで配当安定株の優等生。売上成長53.5%は地政学的要因',
]
for (const s of REAL) {
  for (const seg of highlightReading(s)) {
    if (seg.kind === 'plain') continue
    check(`「${seg.text}」→ 説明あり`, termKeyOf(seg.text) !== null, '説明が引けない')
  }
}

console.log('長い見出し語が優先される')
check('配当利回り3.2% → 配当利回り', termKeyOf('配当利回り3.2%') === '配当利回り')
check('配当3.6% → 配当', termKeyOf('配当3.6%') === '配当')
check('MACD弱気 → MACD弱気', termKeyOf('MACD弱気') === 'MACD弱気')
check('BB上限超え → BB上限超え', termKeyOf('BB上限超え') === 'BB上限超え')
check('知らない語 → null', termKeyOf('ほげ') === null)

console.log('字数')
for (const [k, t] of Object.entries(GLOSSARY)) {
  check(`${k}: 短い意味 ${[...t.short].length}字 ≤ 30`, [...t.short].length <= 30, t.short)
  check(`${k}: 説明 ${[...t.body].length}字 ≤ 120`, [...t.body].length <= 120, t.body)
}

console.log('売買を促す言い方をしていない')
const FORBIDDEN = ['おすすめ', 'オススメ', '買い時', '売り時', '買うべき', '売るべき', '割安だから', '今が', 'チャンス', '必ず', '儲か']
for (const [k, t] of Object.entries(GLOSSARY)) {
  const hit = FORBIDDEN.filter((w) => (t.name + t.short + t.body).includes(w))
  check(`${k}: 禁止語なし`, hit.length === 0, hit.join(','))
}

console.log('')
if (failed) { console.log(`${failed} 件 FAIL`); process.exit(1) }
console.log('すべてPASS')
