// /watch: AIの文の数値トークン強調（lib/ai-trader/reading-highlight.ts）のスモーク。
// - 本番の判断から取った実例5件で、許可リストのトークンだけが metric / signal になる
// - 評価語（割安・秀逸・要監視・中位）は plain のまま
// - 括弧内の式 `価格<MA20<MA50` は plain
// - 空文字・トークンが1つも無い文
// - 全ケースで「セグメントを連結すると入力と完全一致」（1文字も変えない）
//
// 実行: npx tsx scripts/check-reading-highlight.ts

import { highlightReading, type ReadingSegment } from '../lib/ai-trader/reading-highlight'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  PASS ${name}`)
  else { failures++; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}

const joined = (segs: ReadingSegment[]) => segs.map(s => s.text).join('')
const of = (segs: ReadingSegment[], kind: ReadingSegment['kind']) => segs.filter(s => s.kind === kind).map(s => s.text)
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/** 連結一致は全ケースで必ず確認する。 */
const CASES: Array<{ name: string; text: string }> = []
function caseOf(name: string, text: string): ReadingSegment[] {
  CASES.push({ name, text })
  return highlightReading(text)
}

console.log('実例1: 評価語が数値の直後に付く形')
{
  const s = caseOf('実例1', 'PER24.3x中位、ROE49.5%優秀、FCF25.4B豊富で現金生成力確認。ただしD/E55倍で要監視。')
  const m = of(s, 'metric')
  check('metric は PER24.3x / ROE49.5% / FCF25.4B / D/E55倍 の4つ', same(m, ['PER24.3x', 'ROE49.5%', 'FCF25.4B', 'D/E55倍']), JSON.stringify(m))
  check('評価語（中位・優秀・豊富・要監視）は plain', of(s, 'plain').join('') === '中位、優秀、豊富で現金生成力確認。ただしで要監視。', JSON.stringify(of(s, 'plain')))
  check('signal は無い', of(s, 'signal').length === 0)
}

console.log('実例2: 3指標に評価が1つ（分解しない・評価は plain のまま）')
{
  const s = caseOf('実例2', 'PER20.4倍・ROE12.6%・営業利益率15.9%で配当エネルギー株の基準満たす。')
  const m = of(s, 'metric')
  check('metric は PER20.4倍 / ROE12.6% / 営業利益率15.9% の3つ', same(m, ['PER20.4倍', 'ROE12.6%', '営業利益率15.9%']), JSON.stringify(m))
  check('「配当エネルギー株」の 配当 は数値が続かないので plain', s.some(x => x.kind === 'plain' && x.text.includes('配当エネルギー株')))
  check('区切りの「・」「で」は plain に残る', of(s, 'plain').join('') === '・・で配当エネルギー株の基準満たす。', JSON.stringify(of(s, 'plain')))
}

console.log('実例3: 「PER計算不能」は数値が無いので plain')
{
  const s = caseOf('実例3', '営業利益率12.2%でテック平均以下、PER計算不能、D/E49倍で高レバレッジ。バリュートラップ警戒。')
  const m = of(s, 'metric')
  check('metric は 営業利益率12.2% / D/E49倍 の2つ', same(m, ['営業利益率12.2%', 'D/E49倍']), JSON.stringify(m))
  check('PER計算不能 は plain', s.some(x => x.kind === 'plain' && x.text.includes('PER計算不能')))
  check('「バリュートラップ警戒」は plain', s[s.length - 1].kind === 'plain' && s[s.length - 1].text.endsWith('バリュートラップ警戒。'))
}

console.log('実例4: technicals（信号語＋括弧内の式）')
{
  const s = caseOf('実例4', '下落トレンド継続（価格<MA20<MA50）・RSI47中立・MACD強気で乖離。反転候補の下げ場面。')
  const sig = of(s, 'signal')
  check('signal は 下落トレンド / RSI47 / MACD強気 の3つ', same(sig, ['下落トレンド', 'RSI47', 'MACD強気']), JSON.stringify(sig))
  check('括弧内の式 価格<MA20<MA50 は plain（MA20 等に印を付けない）', s.some(x => x.kind === 'plain' && x.text.includes('（価格<MA20<MA50）')))
  check('「中立」「乖離」は plain', of(s, 'plain').join('').includes('中立') && of(s, 'plain').join('').includes('で乖離'))
  check('metric は無い', of(s, 'metric').length === 0)
}

console.log('実例5: オーナー指摘の文')
{
  const s = caseOf('実例5', 'PER17.4x割安、ROE48.7%秀逸、FCF22.7B豊富。')
  const m = of(s, 'metric')
  check('metric は PER17.4x / ROE48.7% / FCF22.7B の3つ', same(m, ['PER17.4x', 'ROE48.7%', 'FCF22.7B']), JSON.stringify(m))
  check('割安・秀逸・豊富 は plain（AIの評価語に印を付けない）', same(of(s, 'plain'), ['割安、', '秀逸、', '豊富。']), JSON.stringify(of(s, 'plain')))
  check('セグメントは6つ（metric と plain が交互）', s.length === 6 && s.every((x, i) => x.kind === (i % 2 === 0 ? 'metric' : 'plain')))
}

console.log('空・トークン無し')
{
  check('空文字 → []', caseOf('空文字', '').length === 0)
  check('undefined → []', highlightReading(undefined).length === 0)
  check('null → []', highlightReading(null).length === 0)
  const s = caseOf('トークン無し', 'バリュートラップ警戒。強い競争優位を確認。')
  check('トークンが1つも無い文は plain 1つだけ', s.length === 1 && s[0].kind === 'plain' && s[0].text === 'バリュートラップ警戒。強い競争優位を確認。')
}

console.log('境界（許可リストの端）')
{
  const s1 = caseOf('空白あり', 'ROE 48.7%・時価総額 $226B・PEG1.2')
  check('指標名と数値の間の空白1つは札に含める', same(of(s1, 'metric'), ['ROE 48.7%', '時価総額 $226B', 'PEG1.2']), JSON.stringify(of(s1, 'metric')))

  const s2 = caseOf('配当利回り', '配当利回り1.5%と配当3%')
  check('配当利回り1.5% は1つの札（配当＋利回り1.5% に割れない）', same(of(s2, 'metric'), ['配当利回り1.5%', '配当3%']), JSON.stringify(of(s2, 'metric')))

  const s3 = caseOf('単位なしの後ろの空白', 'PER17 は高い')
  check('単位が無いとき、後ろの空白を札に取り込まない', same(of(s3, 'metric'), ['PER17']) && of(s3, 'plain').join('') === ' は高い', JSON.stringify(s3))

  const s4 = caseOf('= 付き', 'D/E=2.81xは投資基準超過、ROE=11%は未達。')
  check('`=` 付き（D/E=2.81x）は許可リスト外なので plain', of(s4, 'metric').length === 0, JSON.stringify(s4))

  const s5 = caseOf('RSI小数', 'RSI47.5で横ばい、BB内で買われすぎ')
  check('RSI47.5 は1つの札、横ばい・BB内・買われすぎ も signal', same(of(s5, 'signal'), ['RSI47.5', '横ばい', 'BB内', '買われすぎ']), JSON.stringify(of(s5, 'signal')))

  const s6 = caseOf('億・兆・T', '時価総額3.2兆、FCF120億、時価総額2.9T')
  check('億・兆・T の単位も札に含める', same(of(s6, 'metric'), ['時価総額3.2兆', 'FCF120億', '時価総額2.9T']), JSON.stringify(of(s6, 'metric')))

  const s7 = caseOf('末尾の句読点', 'EPS 3.2, PER 10.')
  check('英語の句読点 , . は札に取り込まない', same(of(s7, 'metric'), ['EPS 3.2', 'PER 10']), JSON.stringify(s7))

  const s8 = caseOf('ゴールデンクロス', '上昇トレンドでゴールデンクロス形成、デッドクロス回避、売られすぎ解消')
  check('クロス系・上昇トレンド・売られすぎ は signal', same(of(s8, 'signal'), ['上昇トレンド', 'ゴールデンクロス', 'デッドクロス', '売られすぎ']), JSON.stringify(of(s8, 'signal')))
}

console.log('連結一致（全ケース・1文字も変えない）')
{
  for (const c of CASES) {
    const segs = highlightReading(c.text)
    check(`${c.name}: 連結 === 入力`, joined(segs) === c.text, `\n    in : ${JSON.stringify(c.text)}\n    out: ${JSON.stringify(joined(segs))}`)
    check(`${c.name}: 空セグメントが無い`, segs.every(s => s.text.length > 0))
  }
  // 同じ文字列を2回呼んでも結果が同じ（g フラグの lastIndex を持ち越さない）
  const a = highlightReading('PER17.4x割安。')
  const b = highlightReading('PER17.4x割安。')
  check('2回呼んでも同じ結果（lastIndex を持ち越さない）', JSON.stringify(a) === JSON.stringify(b))
}

if (failures > 0) {
  console.error(`\n${failures} 件 FAIL`)
  process.exit(1)
}
console.log('\nすべてPASS')
