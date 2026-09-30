// ホームの実例2件の選び方（lib/entry/answer-examples.ts・pickAnswerExamples）と、その画面側の条件の検査（S2「プレゼン型ホーム」・2026-09-29）。
//   $env:PATH = "C:\Program Files\nodejs;$env:PATH"; npx tsx scripts/check-answer-examples.ts
//
// 正は DECISIONS.md 2026-09-29 決定(2)と不変条件（法務 2026-09-28 論点7「カードの選び方は純関数」）:
//  A. ファイルの外形: lib/entry/answer-examples.ts に Date・Math.random・fetch・localStorage・process.env・'react' が無い（時計・乱数・
//     ユーザー・回線を入力にしない）。禁止語の判定は lib/entry/samples.ts の isTextShowable の1か所（answer-examples は forbidden.ts を直接読まない）
//  B. 実際に呼ぶ（合成データは検査の中だけ・製品コードに入れない）: 0件→null／19営業日だけ→null／上げしか無い→null／下げしか無い→null／
//     理由に禁止語→その件を飛ばす／入力をシャッフルしても同じ2件／changePct === 0 はどちらにも数えない／古い順に選ばれている
//     （新しい方が成績が良くても選ばない）／同じ tick（同じ decidedAt）でも入力順に依らない
//  C. MIN_ELAPSED_BUSINESS_DAYS === 20
//  D. app/(night)/page.tsx に選び方の1文「判断日が古い順に、値上がりした例と値下がりした例を1件ずつ。成績のよい判断を選んでいるのではありません。」がある
//  E. components/AnswerCheckCard.tsx: /stocks/ へのリンクが無い・色付きの影が無い・example が null なら null を返す・「やめる条件」の水平線を描かない・
//     騰落率を見出しにしない・出所の行がある・「当たった／外れた／的中」の語が無い
//
// 実ネットワーク不要。

import fs from 'fs'
import path from 'path'
import { FORBIDDEN_IN_OUTPUT } from '../lib/investors/rulebooks/forbidden'
import { MIN_ELAPSED_BUSINESS_DAYS, pickAnswerExamples, isEligible, type AnswerCandidate } from '../lib/entry/answer-examples'

let passed = 0
let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed++
    console.log(`  PASS ${name}`)
  } else {
    failed++
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const ROOT = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
/** 注釈を落とす（注釈に書いた「Date を使わない」を誤検知しないため）。文字列の中の // は残す（check-entry.ts と同じ） */
function stripComments(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (c === '"' || c === "'" || c === '`') {
      out += c; i++
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') { out += src[i]; i++ }
        out += src[i] ?? ''; i++
      }
      out += src[i] ?? ''; i++
      continue
    }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue }
    out += c; i++
  }
  return out
}
const j = (v: unknown) => JSON.stringify(v)

console.log('■ A. 純関数の外形（lib/entry/answer-examples.ts）')
const srcRaw = read('lib/entry/answer-examples.ts')
const src = stripComments(srcRaw)
for (const w of ['Date', 'Math.random', 'fetch', 'localStorage', 'sessionStorage', 'process.env', "'react'", 'document.cookie', 'navigator']) {
  check(`answer-examples.ts に「${w}」が無い（時計・乱数・回線・ユーザー・地域を入力にしない）`, !src.includes(w))
}
check('answer-examples.ts: 禁止語の判定は lib/entry/samples.ts の isTextShowable を使う（forbidden.ts を直接読まない＝判定は1か所）',
  src.includes("import { isTextShowable } from '@/lib/entry/samples'") && !src.includes('rulebooks/forbidden') && !src.includes('forbiddenWordsIn('))
check('answer-examples.ts: decidedAt → symbol → reasoning の順に並べ替えてから選ぶ（入力順に依らない）',
  src.includes('function compareCandidates') && src.includes('.sort(compareCandidates)') && src.includes('a.decidedAt !== b.decidedAt') && src.includes('a.symbol !== b.symbol') && src.includes('a.reasoning !== b.reasoning'))
check('answer-examples.ts: 上げは changePct > 0・下げは changePct < 0（0 はどちらにも数えない）', src.includes('c.changePct > 0') && src.includes('c.changePct < 0') && !src.includes('changePct >= 0') && !src.includes('changePct <= 0'))
check('answer-examples.ts: どちらか欠けたら null', src.includes('return up && down ? { up, down } : null'))
check('samples.ts: isTextShowable が forbiddenWordsIn(text, FORBIDDEN_IN_OUTPUT) の1か所。isShowable / isFullyShowable はそれを呼ぶ', (() => {
  const s = stripComments(read('lib/entry/samples.ts'))
  return s.includes('export function isTextShowable(text: string): boolean') && s.includes('return forbiddenWordsIn(text, FORBIDDEN_IN_OUTPUT).length === 0')
    && s.includes('return isTextShowable(firstSentence(d.reasoning))') && s.includes('return isTextShowable(d.reasoning)')
    && s.split('forbiddenWordsIn(').length - 1 === 1
})())

console.log('■ B. 実際に呼ぶ')
const CLEAN = 'RSI81買われすぎ＋BB上限超え。出来高は平均並み。'
const BAD = `${CLEAN}この先は${FORBIDDEN_IN_OUTPUT[FORBIDDEN_IN_OUTPUT.length - 1]}と見る。`
let seq = 0
/** 合成データ（検査の中だけ）。日付は 2026-07-01 から n 日後 */
function C(over: Partial<AnswerCandidate> & { changePct: number }, dayOffset = seq++): AnswerCandidate {
  const d = new Date(Date.UTC(2026, 6, 1 + dayOffset, 14, 30, 0)).toISOString()
  return { symbol: 'AAA', decidedAt: d, reasoning: CLEAN, elapsedBusinessDays: MIN_ELAPSED_BUSINESS_DAYS + 5, ...over }
}
check('MIN_ELAPSED_BUSINESS_DAYS === 20', MIN_ELAPSED_BUSINESS_DAYS === 20, String(MIN_ELAPSED_BUSINESS_DAYS))
check('0件 → null', pickAnswerExamples([]) === null)
check('19営業日だけ（上げと下げがあっても）→ null', pickAnswerExamples([C({ changePct: 3, elapsedBusinessDays: 19 }), C({ changePct: -3, elapsedBusinessDays: 19 })]) === null)
check('20営業日ちょうどは出す（境界）', pickAnswerExamples([C({ changePct: 3, elapsedBusinessDays: 20 }), C({ changePct: -3, elapsedBusinessDays: 20 })]) !== null)
check('上げしか無い → null', pickAnswerExamples([C({ changePct: 1 }), C({ changePct: 8 }), C({ changePct: 2 })]) === null)
check('下げしか無い → null', pickAnswerExamples([C({ changePct: -1 }), C({ changePct: -8 })]) === null)
check('changePct === 0 はどちらにも数えない（0 と上げだけ → null）', pickAnswerExamples([C({ changePct: 0 }), C({ changePct: 4 })]) === null)
check('changePct が NaN はどちらにも数えない', pickAnswerExamples([C({ changePct: Number.NaN }), C({ changePct: -4 })]) === null)
check('isEligible: 20営業日以上かつ禁止語なし', isEligible(C({ changePct: 1 })) && !isEligible(C({ changePct: 1, elapsedBusinessDays: 19 })) && !isEligible(C({ changePct: 1, reasoning: BAD })))
{
  seq = 0
  const badUp = C({ changePct: 9, reasoning: BAD })   // 最古だが禁止語（2文目）
  const up = C({ changePct: 2 })
  const down = C({ changePct: -2 })
  const r = pickAnswerExamples([badUp, up, down])
  check('理由の全文に禁止語 → その件を飛ばす（冒頭1文が無害でも飛ばす）', r !== null && r.up === up && r.down === down, j(r))
}
{
  seq = 0
  const oldUp = C({ changePct: 1.2 })      // 最古の上げ（成績は小さい）
  const oldDown = C({ changePct: -0.8 })   // 最古の下げ（成績は小さい）
  const newUp = C({ changePct: 25 })       // 新しくて成績のよい上げ
  const newDown = C({ changePct: -30 })    // 新しくて成績の大きい下げ
  const r = pickAnswerExamples([newDown, newUp, oldDown, oldUp])
  check('古い順に選ぶ（新しい方が成績が良くても選ばない）', r !== null && r.up === oldUp && r.down === oldDown, j(r))
  // シャッフル: 4件の順列 24 通り全部で同じ2件
  const items = [oldUp, oldDown, newUp, newDown]
  const perms: AnswerCandidate[][] = []
  const permute = (arr: AnswerCandidate[], k: number) => {
    if (k === arr.length) { perms.push([...arr]); return }
    for (let i = k; i < arr.length; i++) { [arr[k], arr[i]] = [arr[i], arr[k]]; permute(arr, k + 1); [arr[k], arr[i]] = [arr[i], arr[k]] }
  }
  permute(items, 0)
  const same = perms.every(p => { const x = pickAnswerExamples(p); return x !== null && x.up === oldUp && x.down === oldDown })
  check(`入力をシャッフルしても同じ2件（${perms.length} 通り）`, perms.length === 24 && same)
  check('入力の配列を書き換えない（並べ替えは複製の上で）', j(items) === j([oldUp, oldDown, newUp, newDown]))
}
{
  // 同じ tick（decidedAt が同じ）の判断は symbol で順序が決まる。入力順を入れ替えても同じ
  const t = new Date(Date.UTC(2026, 6, 20, 14, 30, 0)).toISOString()
  const a = C({ changePct: 3, symbol: 'AAA', decidedAt: t })
  const b = C({ changePct: 5, symbol: 'BBB', decidedAt: t })
  const dn = C({ changePct: -5, symbol: 'CCC', decidedAt: t })
  const r1 = pickAnswerExamples([b, a, dn])
  const r2 = pickAnswerExamples([dn, b, a])
  check('同じ decidedAt（同じ tick）でも入力順に依らない（symbol の順で AAA が選ばれる）', r1 !== null && r2 !== null && r1.up === a && r2.up === a && r1.down === dn && r2.down === dn)
}
{
  // 型パラメータ: 余分な項目（bars 等）を持つ候補をそのまま返す
  const up = { ...C({ changePct: 1 }), extra: 'x' }
  const down = { ...C({ changePct: -1 }), extra: 'y' }
  const r = pickAnswerExamples([up, down])
  check('候補の余分な項目を落とさずそのまま返す（ジェネリック）', r !== null && r.up.extra === 'x' && r.down.extra === 'y')
}

console.log('■ C/D. 画面（app/(night)/page.tsx）')
const page = stripComments(read('app/(night)/page.tsx'))
const PICK_NOTE = '判断日が古い順に、値上がりした例と値下がりした例を1件ずつ。成績のよい判断を選んでいるのではありません。'
check('page: 選び方の1文が一字違わずある', page.includes(PICK_NOTE))
check('page: 選び方の1文は small・--ink-2 の <p>（畳まない・caption にしない）', /<p className="max-w-\[42rem\] text-small text-ink-2">\{PICK_NOTE\}<\/p>/.test(page) && page.includes(`const PICK_NOTE = '${PICK_NOTE}'`))
check('page: 20営業日の数は MIN_ELAPSED_BUSINESS_DAYS から（画面の文言と選び方の出所が同じ）', page.includes("import { MIN_ELAPSED_BUSINESS_DAYS } from '@/lib/entry/answer-examples'") && page.includes('${MIN_ELAPSED_BUSINESS_DAYS}営業日ほど経つと') && !/20営業日/.test(page))
check('page: 実例は up と down を1件ずつ AnswerCheckCard に渡す', page.includes('<AnswerCheckCard example={examples.up} kind="up" />') && page.includes('<AnswerCheckCard example={examples.down} kind="down" />'))
check('page: 選び方を画面で作り直していない（sort・filter で判断を選ぶコードが無い。選ぶのは API 側の純関数）', !/\.sort\(|\.filter\(/.test(page))
check('page: ヒーローと 02 の1件は「2件のうち判断日が古い方」（成績で選ばない）', page.includes('examples.up.decidedAt < examples.down.decidedAt') && !/changePct\s*[<>]/.test(page))

console.log('■ E. カード（components/AnswerCheckCard.tsx）')
const cardRaw = read('components/AnswerCheckCard.tsx')
const card = stripComments(cardRaw)
check('カード: /stocks/ へリンクしない', !card.includes('/stocks/') && !card.includes('<Link') && !card.includes('<a '))
check('カード: 色付きの影が無い（rgb(45 212 191・shadow-）', !/rgb\(45[ _]212[ _]191|shadow-/.test(card))
check('カード: example が null なら null を返す（ダミー線・「準備中」を描かない）', card.includes('if (example === null) return null') && !card.includes('準備中'))
check('カード: 折れ線は1系列（path が1本）・SERIES.ai（紫・破線）・凡例を出さない', card.split('<path').length - 1 === 1 && card.includes('series = SERIES.ai') && !/凡例|legend/i.test(card))
check('カード: 判断日の縦破線は --muted 1本。「やめる条件」の水平線を描かない（<line> は縦の1本だけ・y1 === y2 の線が無い）',
  card.split('<line').length - 1 === 1 && /x1=\{x\(di\)\} x2=\{x\(di\)\} y1=\{0\} y2=\{100\}/.test(card) && card.includes("stroke: 'var(--muted)'") && !/y1=\{y\(|y2=\{y\(/.test(card))
check('カード: 軸の文字は実値2つ（高値と安値）だけ', card.includes('<span>{fmtAxis(symbol, max)}</span>') && card.includes('<span>{fmtAxis(symbol, min)}</span>') && card.split('fmtAxis(symbol,').length - 1 === 2)
check('カード: 3段の並び（理由1行 → 折れ線 → 文）で、騰落率は見出しにしない（h1〜h3 が無く、KIND_LABEL は語）',
  card.indexOf('firstSentence(example.reasoning)') < card.indexOf('<MiniLine') && card.indexOf('<MiniLine') < card.indexOf('{sentence}</p>') && !/<h[1-6]/.test(card)
  && card.includes("up: '値上がりした例', down: '値下がりした例'"))
// 文に「どの日の終値から、どの日まで」を書く。図の線と数字が同じ系列を指していることを読み手が確かめられるように
// （2026-09-29: 記録側の価格が実際の株価と食い違っていたので、騰落率は日足だけから出す）
check('カード: ③の文に起点と終点の日付が入る（AIは◯月◯日にこう書きました。◯月◯日の終値から◯月◯日までで ±◯% でした。）',
  card.includes('`AIは${fmtMonthDay(e.decidedAt)}にこう書きました。${fmtMonthDay(e.baseAsOf)}の終値から${fmtMonthDay(e.priceAsOf)}までで ${fmtSignedPct(e.changePct)} でした。`'))
check('カード: AnswerExample に baseAsOf（騰落率の起点の日付）がある', card.includes('baseAsOf: string'))
check('カード: 出所と時点の行（source・priceAsOf・判断日）がある（R8）', card.includes('{example.source}・${fmtSlashDate(example.priceAsOf)} の終値まで') && card.includes('判断日から${example.elapsedBusinessDays}営業日'))
check('カード: 「当たった／外れた／的中／正解／見本／お手本」の語が無い', !/当たっ|外れ|的中|正解|見本|お手本/.test(card))
check('カード: 図は role="img"＋aria-label（同じ内容の文）', card.includes('<figure role="img" aria-label={label}') && card.includes('${sentence}`}'))
check('カード: マイナスは U+2212・小数1桁', card.includes("`−${abs}%`") && card.includes('.toFixed(1)'))
check('カード: 線の色を文字に使わない（style={{ color: … }} が無い）', !/style=\{\{\s*color/.test(card))
check("カード: 'use client'（inline SVG は描くだけ。fetch・保存を持たない）", /^'use client'/.test(cardRaw) && !/fetch\(|localStorage|useEffect/.test(card))

console.log('')
console.log(`PASS ${passed} 件 / FAIL ${failed} 件`)
if (failed) process.exit(1)
console.log('すべてPASS')
