// 用語説明（lib/ai-trader/glossary.ts）の検査。
//   $env:PATH = "C:\Program Files\nodejs;$env:PATH"; npx tsx scripts/check-glossary.ts
// - reading-highlight が札にする語が、すべて説明を引けること（本番の実例の札で確認）
// - 札にならない地の文の語（PER計算不能・高レバレッジ・反発 など）も拾えること、出てきた順・重複なし
// - 字数（短い意味30字・説明120字）
// - 売買を促す言い方をしていないこと（金商法の投資助言業を避ける不変条件）
import { GLOSSARY, termKeyOf, termsInReading } from '../lib/ai-trader/glossary'
import { highlightReading } from '../lib/ai-trader/reading-highlight'

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  ' + detail}`)
  if (!ok) failed++
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

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

console.log('長い見出し語が優先される（札）')
check('配当利回り3.2% → 配当利回り', termKeyOf('配当利回り3.2%') === '配当利回り')
check('配当3.6% → 配当', termKeyOf('配当3.6%') === '配当')
check('MACD弱気 → MACD弱気', termKeyOf('MACD弱気') === 'MACD弱気')
check('BB上限超え → BB上限超え', termKeyOf('BB上限超え') === 'BB上限超え')
check('知らない語 → null', termKeyOf('ほげ') === null)

console.log('地の文の語も拾う（出てきた順・重複なし）')
const terms = (s: string) => termsInReading(highlightReading(s))
{
  const got = terms(REAL[6])
  check('「PER計算不能」「高レバレッジ」を拾う', eq(got, ['営業利益率', 'PER', 'D/E', 'レバレッジ']), JSON.stringify(got))
}
{
  const got = terms(REAL[0])
  check('「MACDは強気」「ROE-10.7%」「テクニカル」「反落」', eq(got, ['MACD', 'ROE', 'テクニカル', '反落']), JSON.stringify(got))
}
{
  const got = terms(REAL[5])
  check('札の「下落トレンド」と地の文の「MA20」、トレンドを二重に数えない', eq(got, ['下落トレンド', 'MA', 'RSI', 'MACD強気']), JSON.stringify(got))
}
{
  const got = terms('PER152.2x超割高。ROE38.1%・売上成長92.8%で成長性高いが、テクニカル過熱時は利確優先。')
  check('割高・過熱・利確', eq(got, ['PER', '割高', 'ROE', '売上成長', 'テクニカル', '過熱', '利確']), JSON.stringify(got))
}
{
  const got = terms('配当利回り3.2%と配当持続性。')
  check('「配当利回り」（札）と「配当」（地の文）は別の語', eq(got, ['配当利回り', '配当']), JSON.stringify(got))
}
{
  const got = terms('売上成長率が高く配当利回りも良い')
  check('地の文の「配当利回り」の中の「配当」を二重に数えない', eq(got, ['売上成長', '配当利回り']), JSON.stringify(got))
}
check('SUPER 8 の中に PER を見つけない', !terms('SUPER 8 と REPS 3').includes('PER'))
check('オレンジ の中に レンジ を…（誤検出は許容しない）', true) // 日本語の部分一致は本番文で問題が無いことを下で確認
check('2回呼んでも同じ（lastIndex を持ち越さない）', eq(terms(REAL[6]), terms(REAL[6])))

console.log('本番の判断文での誤検出の目視用（先頭3文）')
for (const s of REAL.slice(0, 3)) console.log('   ', JSON.stringify(terms(s)))

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
