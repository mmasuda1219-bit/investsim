// 03 読み返す（/review）の検査（S2b「振り返りの作り直し」・2026-09-30・designer 2026-09-29 の設計 F）。
//   $env:PATH = "C:\Program Files\nodejs;$env:PATH"; npx tsx scripts/check-review.ts
//
// 見るもの（番号は指示書のまま）:
//  1. 合成スコアを作っていない: lib/review/**・app/review/** に識別子・文字列としての score／点数／評価／ランク／偏差 が無い
//     （注釈は落として見る。「時点」「点を」は数の「点」ではないので対象外＝「点数・採点・得点・N点」を見る）
//  2. 成績の比較が無い: app/review/** が lib/ai-trader/**・lib/investors/** を import しない。勝率／利回り／シャープ が無い
//  3. 損益に色が無い: app/review/page.tsx の text-success|text-danger|--success|--danger は取り消しボタンの1件だけ。
//     app/review/backfill/page.tsx は「記録の成否」の2件だけ（--success＝「記録した」の完了・DECISIONS 2026-09-24 の定義）
//  4. クセの文が閾値未満で出ない: findPattern() を実際に呼ぶ（合成データは検査の中だけ・製品コードに入れない）
//     (a) 4件以下は null (b) 5件で 3/5 は null (c) 5件で 4/5 は非 null (d) 同じ入力を100回で同一 (e) 入力をシャッフルしても同一
//     ＋ 固定順（1→2→3→4）・keys の形・損益（pnlPct/exitPrice）を読まない・Date/Math.random が無い
//  5. 降りる条件の線を誤って引かない: parseExitLevel() に「成長率が15%を割ったら」「売上が前年を下回ったら」「次の決算が悪かったら」→ null。
//     「株価が-20%になったら売る」「$150を割ったら」→ 値
//  6. 株価が無いとき図を描かない: PriceSincePanel を bars: null / [] / 1点で描き、出力に <path <polyline <circle が無い
//  7. 出所が常に付く: bars が2点以上なら出力に「時点」が1つ
//  8. 禁止語: 守れた／守れなかった／正しかった／判断ミス／的中／当たった／外れた／正解／見本／お手本 が app/review/**・components/review/** に無い
//  9. 画面の構成（取引履歴の節が無い・初期資本をファーストビューに出さない・図は3件まで・カウントダウンにしない 等）
//
// 実ネットワーク不要。lib/review/judgement.ts は読むだけ（1文字も変えない方針の担保）。

import fs from 'fs'
import path from 'path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Judgement } from '../lib/review/judgement'
import { findPattern, MIN_RECORDS, SHORT_HOLD_DAYS, keyOf } from '../lib/review/patterns'
import { parseExitLevel } from '../lib/review/exit-rule'
import { PriceSincePanel, layoutPriceSince, gapSentence, type PriceSincePanelProps } from '../components/review/PriceSincePanel'
import type { HistoricalBar } from '../types'

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
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel))
/** 注釈を落とす（注釈に書いた「点数を作らない」を誤検知しないため）。文字列の中の // は残す（check-entry.ts と同じ） */
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
function walk(rel: string): string[] {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) return []
  const out: string[] = []
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const r = `${rel}/${e.name}`
    if (e.isDirectory()) out.push(...walk(r))
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(r)
  }
  return out
}
const count = (s: string, needle: string | RegExp) =>
  typeof needle === 'string' ? s.split(needle).length - 1 : (s.match(new RegExp(needle.source, needle.flags.includes('g') ? needle.flags : `${needle.flags}g`)) ?? []).length
const j = (v: unknown) => JSON.stringify(v)

const LIB_REVIEW = walk('lib/review')
const APP_REVIEW = walk('app/review')
const COMP_REVIEW = walk('components/review')
const codeOf = (files: string[]) => files.map(f => [f, stripComments(read(f))] as const)

console.log('■ 1. 合成スコアを作っていない（lib/review/**・app/review/**）')
check('lib/review に patterns.ts・exit-rule.ts・judgement.ts がある', exists('lib/review/patterns.ts') && exists('lib/review/exit-rule.ts') && exists('lib/review/judgement.ts'))
for (const [f, src] of codeOf([...LIB_REVIEW, ...APP_REVIEW])) {
  const hits = [/\bscore\b/i, /点数|採点|得点|\d点/, /評価/, /ランク/, /偏差/].map(re => re.exec(src)?.[0]).filter(Boolean)
  check(`${f}: score／点数／評価／ランク／偏差 が無い`, hits.length === 0, hits.join(' / '))
}
{
  const p = stripComments(read('lib/review/patterns.ts'))
  check('patterns.ts: Pattern の数は total / hits だけ（score・rank・rate の項目が無い）', /total: number/.test(p) && /hits: number/.test(p) && !/score|rank|rate\b|ratio:/.test(p))
}

console.log('■ 2. 成績の比較が無い（app/review/**）')
for (const [f, src] of codeOf(APP_REVIEW)) {
  check(`${f}: lib/ai-trader・lib/investors を import しない`, !/from ['"]@\/lib\/(?:ai-trader|investors)/.test(src) && !/from ['"]\.\.?\/.*(?:ai-trader|investors)/.test(src))
  const w = /勝率|利回り|シャープ/.exec(src)?.[0]
  check(`${f}: 勝率／利回り／シャープ が無い`, !w, w)
}

console.log('■ 3. 損益に色が無い')
{
  const page = stripComments(read('app/review/page.tsx'))
  const RE = /text-success|text-danger|--success|--danger/g
  const n = count(page, RE)
  check(`app/review/page.tsx: text-success|text-danger|--success|--danger は取り消しボタンの1件だけ（実測 ${n}）`, n === 1)
  check('app/review/page.tsx: その1件は「記録をすべて消す」のボタン', /text-danger[^>]*>\s*記録をすべて消す/.test(page.replace(/\n/g, ' ')))
  check('app/review/page.tsx: 損益の色は pnlClass（ゼロ text-muted・それ以外 text-ink）', page.includes("return v === 0 ? 'text-muted' : 'text-ink'"))
  // backfill は損益を出さない面。--danger／--success の4件は「入力の誤り」「記録の成否」「消す（取り消せない操作）」で、DESIGN.md §6-1・§6-9 の定義どおり
  const bf = stripComments(read('app/review/backfill/page.tsx'))
  const m = count(bf, RE)
  check(`app/review/backfill/page.tsx: 同じ語は 入力の誤り1件＋記録の成否2件＋消すボタン1件 の4件だけで、損益には無い（実測 ${m}）`,
    m === 4 && bf.includes("result.ok ? 'text-success' : 'text-danger'") && bf.includes('text-danger">売った日は買った日より後にしてください') && bf.includes('hover:text-danger') && !/pnl|損益/.test(bf))
  const panel = stripComments(read('components/review/PriceSincePanel.tsx'))
  check('PriceSincePanel.tsx: --success／--danger／text-success／text-danger を使わない（触れた／触れていないを色で区別しない）', count(panel, RE) === 0)
}

console.log('■ 4. クセの文が閾値未満で出ない（findPattern を実際に呼ぶ・合成データは検査の中だけ）')
const DAY = 86_400_000
const T0 = Date.UTC(2026, 6, 1, 14, 30, 0)
type Over = Partial<Judgement> & { exitRule?: string | null; catalyst?: string | null }
/** 合成の判断記録。exitRule / catalyst が null なら見出しごと落とす（＝空） */
function J(i: number, over: Over = {}): Judgement {
  const { exitRule = '株価が-10%になったら売る', catalyst = '次の決算', ...rest } = over
  const lines = ['【見立て】決算が良かった']
  if (catalyst) lines.push(`【注目】${catalyst}`)
  if (exitRule) lines.push(`【降りる条件】${exitRule}`)
  const held = rest.heldDays ?? 30
  const entryAt = T0 + i * 7 * DAY
  return {
    symbol: `S${i}`, name: `S${i} Inc`, entryAt, exitAt: entryAt + held * DAY, shares: 10, entryPrice: 100, exitPrice: 103,
    pnlPct: 3, entryReason: lines.join('\n'), exitReason: '【売る理由】想定どおり', heldDays: held, source: 'practice', ...rest,
  }
}
check('MIN_RECORDS === 5・SHORT_HOLD_DAYS === 7', MIN_RECORDS === 5 && SHORT_HOLD_DAYS === 7)
check('(a) 0件 → null', findPattern([]) === null)
check('(a) 4件（全部 降りる条件なし）→ null', findPattern([0, 1, 2, 3].map(i => J(i, { exitRule: null }))) === null)
check('(b) 5件で 3/5 が 降りる条件なし → null', findPattern([J(0, { exitRule: null }), J(1, { exitRule: null }), J(2, { exitRule: null }), J(3), J(4)]) === null)
{
  const js = [J(0, { exitRule: null }), J(1, { exitRule: null }), J(2, { exitRule: null }), J(3, { exitRule: null }), J(4)]
  const r = findPattern(js)
  check('(c) 5件で 4/5 が 降りる条件なし → 非 null・axis exitRule・「5件のうち4件は、降りる条件を決めないまま買っていました。」',
    r !== null && r.axis === 'exitRule' && r.total === 5 && r.hits === 4 && r.text === '5件のうち4件は、降りる条件を決めないまま買っていました。', j(r))
  check('(c) keys は該当した記録の `${symbol}-${entryAt}`（4件）', r !== null && r.keys.length === 4 && r.keys.every(k => /^S\d+-\d+$/.test(k)) && !r.keys.includes(keyOf(js[4])))
  const first = j(r)
  let same = true
  for (let k = 0; k < 100; k++) if (j(findPattern(js)) !== first) same = false
  check('(d) 同じ入力を100回呼んで同一', same)
  // (e) シャッフル: 5件の順列 120 通りすべて同じ
  const perms: Judgement[][] = []
  const permute = (arr: Judgement[], k: number) => {
    if (k === arr.length) { perms.push([...arr]); return }
    for (let i = k; i < arr.length; i++) { [arr[k], arr[i]] = [arr[i], arr[k]]; permute(arr, k + 1); [arr[k], arr[i]] = [arr[i], arr[k]] }
  }
  permute([...js], 0)
  check(`(e) 入力をシャッフルしても同一（${perms.length} 通り）`, perms.length === 120 && perms.every(p => j(findPattern(p)) === first))
  check('入力の配列を書き換えない', js[0].symbol === 'S0' && js[4].symbol === 'S4')
}
{
  // S2b レビュー W4: buildJudgements は1回の買いを、売った回数ぶんの行に分ける。間引かないと
  // 「1回の買いを4回に分けて売った＋別の買い1件」で「5件のうち4件は…」と、実際は2回しか
  // 買っていないのに数が膨らむ。1買い1行に間引いたので null になるはず。
  const split = [0, 1, 2, 3].map(i => ({ ...J(0, { exitRule: null }), exitAt: T0 + (10 + i) * DAY, shares: 2 }))
  const other = J(1)
  const r = findPattern([...split, other])
  check('分割して売った1回の買い（4行）＋別の買い1件 → null（1買い1行に間引く）', r === null, j(r))
  const split2 = [0, 1, 2, 3].map(i => ({ ...J(0, { exitRule: null }), exitAt: T0 + (10 + i) * DAY, shares: 2 }))
  const five = [split2[0], ...[1, 2, 3, 4].map(i => J(i, { exitRule: null }))]
  const r2 = findPattern([...split2, ...five.slice(1)])
  check('分割売りを間引いたうえで5件そろえば出る（5件のうち5件）', r2 !== null && r2.total === 5 && r2.hits === 5, j(r2))
}
check('5件で 5/5 が 降りる条件なし → 「5件のうち5件は…」', findPattern([0, 1, 2, 3, 4].map(i => J(i, { exitRule: null })))?.text === '5件のうち5件は、降りる条件を決めないまま買っていました。')
check('5件すべて条件あり・保有30日・注目あり・別銘柄 → null（偏りなし）', findPattern([0, 1, 2, 3, 4].map(i => J(i))) === null)
{
  const r = findPattern([0, 1, 2, 3, 4].map(i => J(i, { heldDays: i < 4 ? 3 : 30 })))
  check('軸2: 売って終わった5件のうち4件が1週間以内 → holdLength「売って終わった5件のうち4件は、買ってから1週間以内に売っています。」',
    r?.axis === 'holdLength' && r.text === '売って終わった5件のうち4件は、買ってから1週間以内に売っています。' && r.hits === 4, j(r))
  const open = findPattern([0, 1, 2, 3, 4].map(i => J(i, { heldDays: 3 })).map(x => ({ ...x, exitAt: null, exitPrice: null, pnlPct: null, heldDays: null })))
  check('軸2: 保有中（exitAt null）は数えない → null', open === null)
  const six = findPattern([0, 1, 2, 3, 4].map(i => J(i, { heldDays: 7 })))
  check('軸2: ちょうど7日は「1週間以内」に数えない → null', six === null)
}
{
  const r = findPattern([0, 1, 2, 3, 4].map(i => J(i, { catalyst: i < 4 ? null : '次の決算' })))
  check('軸3: 5件のうち4件が【注目】なし → catalyst「5件のうち4件は、これから何を見るかを書かずに買っています。」',
    r?.axis === 'catalyst' && r.text === '5件のうち4件は、これから何を見るかを書かずに買っています。', j(r))
}
{
  const r = findPattern([0, 1, 2, 3, 4].map(i => J(i, { symbol: i < 4 ? 'AAPL' : 'MSFT' })))
  check('軸4: 5件のうち4件が同じ銘柄 → sameSymbol「5件のうち4件が AAPL です。同じ銘柄に戻ってきています。」',
    r?.axis === 'sameSymbol' && r.text === '5件のうち4件が AAPL です。同じ銘柄に戻ってきています。', j(r))
  const r2 = findPattern([0, 1, 2, 3, 4].map(i => J(i, { symbol: i < 3 ? 'AAPL' : 'MSFT' })))
  check('軸4: 3/5 は null', r2 === null)
}
{
  // 固定順: 軸1と軸2の両方に該当しても 1（exitRule）を返す。1つだけ
  const r = findPattern([0, 1, 2, 3, 4].map(i => J(i, { exitRule: null, heldDays: 2, catalyst: null, symbol: 'AAPL' })))
  check('複数該当は固定順 1→2→3→4 で1つだけ（exitRule）', r?.axis === 'exitRule', j(r))
}
{
  // 損益で結果が変わらない: pnlPct / exitPrice を極端にしても同じ
  const base = [0, 1, 2, 3, 4].map(i => J(i, { exitRule: null }))
  const rich = base.map(x => ({ ...x, pnlPct: 500, exitPrice: 600 }))
  const poor = base.map(x => ({ ...x, pnlPct: -90, exitPrice: 10 }))
  check('損益（pnlPct・exitPrice）を変えても結果が同じ（相関を見ない）', j(findPattern(rich)) === j(findPattern(poor)) && j(findPattern(rich)) === j(findPattern(base)))
  // 旧形式（見出し無し）と理由なしは軸1・3の対象に数えない
  const free = [0, 1, 2, 3, 4].map(i => J(i, { entryReason: 'なんとなく上がりそうだったので' }))
  check('見出しの無い旧形式の理由は「降りる条件なし」に数えない → null', findPattern(free) === null)
  const none = [0, 1, 2, 3, 4].map(i => J(i, { entryReason: null }))
  check('理由が残っていない記録は「降りる条件なし」に数えない → null', findPattern(none) === null)
}
{
  const p = stripComments(read('lib/review/patterns.ts'))
  for (const w of ['Date', 'Math.random', 'fetch', 'localStorage', 'process.env', "'react'", 'navigator', 'pnlPct', 'exitPrice', 'entryPrice']) {
    check(`patterns.ts に「${w}」が無い（時計・乱数・ユーザー・損益を入力にしない）`, !p.includes(w))
  }
  check('patterns.ts: entryAt 昇順に並べ替えてから見る（入力順に依らない）', p.includes('a.entryAt - b.entryAt') && p.includes('[...js].sort('))
  check('patterns.ts: 軸は4つだけ（exitRule / holdLength / catalyst / sameSymbol）', p.includes("'exitRule' | 'holdLength' | 'catalyst' | 'sameSymbol'") && count(p, "axis: '") === 4)
  check('lib/review/judgement.ts: 合成指標を作らない方針の注釈と enoughForStats が残っている（1文字も変えない方針）',
    read('lib/review/judgement.ts').includes('「判断の質スコア」のような合成指標を作らない') && read('lib/review/judgement.ts').includes('enoughForStats: closed.length >= 3'))
}

console.log('■ 5. 降りる条件の線を誤って引かない（parseExitLevel を実際に呼ぶ）')
for (const t of ['成長率が15%を割ったら', '売上が前年を下回ったら', '次の決算が悪かったら', '成長率が15%を割ったら / 株価が-20%になったら売る',
  '-10% か $150', '20%下がったら', '150を割ったら', '買値の90%以下になったら', '時価総額が1000億ドルを割ったら', 'RSIが30を割ったら',
  '株価が-20%上がったら', '', '決めていなかった', '配当が減ったら', 'PERが40倍を超えたら']) {
  check(`「${t}」→ null`, parseExitLevel(t, 178.2) === null, j(parseExitLevel(t, 178.2)))
}
// S2b レビュー C1: 単位・助数詞の付いた数字を株価として拾っていた（「株価が2倍」→ $2.00 の線）。
// 買値の 1/10〜10倍のガードは値が偶然その範囲に入ると通るので、**安い買値**で確かめる。
for (const [t, entry] of [['株価が2倍になったら', 15], ['株価が3割下がったら', 20], ['株価が下がったら100株売る', 150],
  ['株価が3日連続で下がったら', 20], ['買値より下がったら、3か月で見直す', 20], ['決算で価格が2割落ちたら', 15],
  ['株価が2週間下げ続けたら', 15], ['買値を5回割ったら', 20]] as const) {
  check(`「${t}」（買値 $${entry}）→ null（単位の付いた数字を株価にしない）`, parseExitLevel(t, entry) === null, j(parseExitLevel(t, entry)))
}
{
  const r = parseExitLevel('株価が-20%になったら売る', 178.2)
  check('「株価が-20%になったら売る」→ 178.2 × 0.8 = 142.56', r !== null && Math.abs(r.price - 142.56) < 1e-9 && r.label === '$142.56（買値から−20%）', j(r))
  const r2 = parseExitLevel('$150を割ったら', 178.2)
  check('「$150を割ったら」→ 150', r2 !== null && r2.price === 150 && r2.label === '$150.00', j(r2))
  const r3 = parseExitLevel('−20%になったら', 100)
  check('「−20%になったら」（U+2212）→ 80', r3 !== null && r3.price === 80, j(r3))
  const r4 = parseExitLevel('-10%で切るつもりだった', 100)
  check('「-10%で切るつもりだった」→ 90', r4 !== null && r4.price === 90, j(r4))
  const r5 = parseExitLevel('買値から10%下がったら', 100)
  check('「買値から10%下がったら」→ 90', r5 !== null && r5.price === 90, j(r5))
  const r6 = parseExitLevel('株価が+20%になったら売る', 100)
  check('「株価が+20%になったら売る」→ 120（上）', r6 !== null && r6.price === 120 && r6.label.includes('+20%'), j(r6))
  const r7 = parseExitLevel('1,200円を割ったら', 1500, { yen: true })
  check('「1,200円を割ったら」→ 1200・¥表記', r7 !== null && r7.price === 1200 && r7.label === '¥1,200', j(r7))
  const r8 = parseExitLevel('株価が150を割ったら', 178.2)
  check('「株価が150を割ったら」（価格の語あり・単位なし）→ 150', r8 !== null && r8.price === 150, j(r8))
  check('買値の10倍超（$5,000 on 178.2）→ null', parseExitLevel('$5000を超えたら', 178.2) === null)
  check('買値が 0 → null', parseExitLevel('$150を割ったら', 0) === null)
  // 同じ入力には同じ答え
  const a = j(parseExitLevel('株価が-20%になったら売る', 178.2))
  check('同じ入力を100回で同一', Array.from({ length: 100 }, () => j(parseExitLevel('株価が-20%になったら売る', 178.2))).every(x => x === a))
}

console.log('■ 6. 株価が無いとき図を描かない（PriceSincePanel を実際に描く）')
const ENTRY = Date.UTC(2026, 7, 10, 14, 30) // 2026-08-10
function mkBars(n: number, startDay = Date.UTC(2026, 7, 3), step = (i: number) => 100 + i): HistoricalBar[] {
  return Array.from({ length: n }, (_, i) => {
    const t = Math.floor((startDay + i * DAY) / 1000)
    const c = step(i)
    return { time: t, open: c, high: c + 1, low: c - 1, close: c, volume: 1000 }
  })
}
const baseProps: PriceSincePanelProps = {
  symbol: 'AAPL', entryAt: ENTRY, entryPrice: 107, exitAt: null, exitPrice: null,
  exitRuleText: '株価が-20%になったら売る', exitLevel: parseExitLevel('株価が-20%になったら売る', 107), bars: null, quotedAt: null,
}
const render = (p: PriceSincePanelProps) => renderToStaticMarkup(React.createElement(PriceSincePanel, p))
for (const [label, bars] of [['null', null], ['[]', []], ['1点', mkBars(1)]] as const) {
  const html = render({ ...baseProps, bars: bars as PriceSincePanelProps['bars'] })
  check(`bars: ${label} → <path <polyline <circle が無い`, !/<path|<polyline|<circle/.test(html))
  check(`bars: ${label} → 描けない理由を --warning-ink の1文で出す（通信の失敗／買った日がまだ足に無い／5年より前のどれか）`,
    html.includes('text-warning-ink') && (html.includes('株価を取得できませんでした。書いた理由は残っています。') || html.includes('まだ日足に載っていません') || html.includes('5年より前の買いは')))
  check(`bars: ${label} → <svg が無い（ダミー線を描かない）`, !html.includes('<svg'))
}
{
  const html = render({ ...baseProps, bars: 'loading' })
  check("bars: 'loading' → 薄い枠（aria-busy）＋「株価を取得しています」・<svg 無し", html.includes('aria-busy="true"') && html.includes('株価を取得しています') && !html.includes('<svg'))
}
{
  // 買った日を覆っていない足の列（買った日より後から始まる）→ 描かない
  const html = render({ ...baseProps, bars: mkBars(10, Date.UTC(2026, 7, 20)) })
  check('買った日より後から始まる足の列 → 描かない＋「5年より前の買いは、この図にできません」（不具合ではないと分かる文）',
    !html.includes('<svg') && html.includes('5年より前の買いは、この図にできません'))
}

console.log('■ 7. 出所が常に付く／図の中身')
{
  const bars = mkBars(30)
  const html = render({ ...baseProps, bars, quotedAt: Date.UTC(2026, 8, 30, 5, 5) })
  check('bars 2点以上 → 「時点」が1つ', count(html, '時点') === 1, String(count(html, '時点')))
  check('出所は「Yahoo Finance・M/D HH:mm 時点」', /Yahoo Finance・\d{1,2}\/\d{1,2} \d{2}:\d{2} 時点/.test(html))
  check('図は <svg 1つ・<path 2つ（薄い面＋終値の線）・1系列（SERIES.you #5681DC）', count(html, '<svg') === 1 && count(html, '<path') === 2 && html.includes('#5681DC'))
  check('凡例を出さない（legend／凡例 の語が無い）', !/legend|凡例/i.test(html))
  check('買った日の縦線＋「▲ 買 $107.00」', html.includes('▲ 買 $107.00') && count(html, '<line') >= 1)
  check('保有中: 右端の点（fill #5681DC の circle）＋「今 $」', /<circle[^>]*fill="#5681DC"/.test(html) && html.includes('今 $'))
  check('降りる条件の水平線（破線 --muted）＋「降りる条件 $85.60（買値から−20%）」', html.includes('strokeDasharray') || html.includes('stroke-dasharray'), '')
  check('水平線のラベル', html.includes('降りる条件 $85.60（買値から−20%）'))
  check('role="img"＋aria-label に同じ内容の文', /<figure role="img" aria-label="[^"]*まだ触れていません[^"]*"/.test(html))
  // S2b レビュー W1: 「終値では」を必ず付ける（その日の安値が条件を割っていても、この図は終値の線なので見ていない）
  check('ずれの1文: 「…には、終値ではまだ触れていません。N日が過ぎました。」', /書いた条件（\$85\.60（買値から−20%））には、終値ではまだ触れていません。\d+日が過ぎました。/.test(html))
  // 足は 8/3 から 30 本（終値 100→129）。買った日 8/10 の5本前＝8/5（終値 102）から描くので、最安値は 102・左端は 8/5
  check('軸: 期間内の最高値・最安値の2つ（$129.00・$102.00）と左端・右端の日付（8/5・9/1）', html.includes('$129.00') && html.includes('$102.00') && !html.includes('$100.00') && html.includes('>8/5<') && html.includes('>9/1<'))
  check('目盛り線が無い（<line は縦線1本＋水平線1本の2本だけ）', count(html, '<line') === 2, String(count(html, '<line')))
  check('禁止語（守れた／守れなかった／正しかった／判断ミス／的中／当たった／外れた／正解）が出力に無い', !/守れ|正しかった|判断ミス|的中|当たっ|外れ|正解/.test(html))
  check('--success／--danger を出力に使わない', !/--success|--danger|text-success|text-danger/.test(html))
  const noAt = render({ ...baseProps, bars, quotedAt: null })
  check('quotedAt が null → 「取得時点が分かりません」（時刻を作らない）・「時点」は1つ', noAt.includes('Yahoo Finance・取得時点が分かりません') && count(noAt, '時点') === 1)
}
{
  // 触れた: 値が下がって条件に届く（買値 107 → 条件 85.6。終値 100→…→70）
  const bars = mkBars(30, Date.UTC(2026, 7, 3), i => 100 - i)
  const html = render({ ...baseProps, bars, quotedAt: null })
  check('触れた: 中空の丸（fill="none"・stroke var(--muted)・strokeWidth 1.5・r 3.5）', /<circle[^>]*fill="none"[^>]*stroke="var\(--muted\)"[^>]*stroke-width="1.5"/.test(html) && html.includes('r="3.5"'))
  check('触れた: 「書いた条件（…）に、M/D の終値で触れています。その後も持ち続けています。」', /書いた条件（\$85\.60（買値から−20%））に、\d{1,2}\/\d{1,2} の終値で触れています。その後も持ち続けています。/.test(html))
  const closedHtml = render({ ...baseProps, bars, quotedAt: null, exitAt: Date.UTC(2026, 7, 28, 14, 30), exitPrice: 80, changeText: '事業は悪くなっていなかったのに、値動きだけを見て売っていた。' })
  check('往復: 「▼ 売 $80.00」＋「そのあと売ったのは 8/28 です。」＋「売るときには『…』と書いています。」', closedHtml.includes('▼ 売 $80.00') && closedHtml.includes('そのあと売ったのは 8/28 です。') && closedHtml.includes('売るときには『事業は悪くなっていなかったのに、値動きだけを見て売っていた。』と書いています。'))
  check('往復: 「今」の点を出さない', !closedHtml.includes('今 $'))
  const layout = layoutPriceSince(bars, ENTRY, null, baseProps.exitLevel, 107)
  check('layoutPriceSince: 買った日の5本前から始まる・買った日の位置は 5', layout !== null && layout.entryIdx === 5 && layout.win.length === 30 - 2, j(layout && { entryIdx: layout.entryIdx, len: layout.win.length }))
  check('gapSentence は純関数（同じ入力で同じ文）', layout !== null && gapSentence({ exitRuleText: baseProps.exitRuleText, exitLevel: baseProps.exitLevel, layout }) === gapSentence({ exitRuleText: baseProps.exitRuleText, exitLevel: baseProps.exitLevel, layout }))
}
{
  // 条件が数字でない／空
  const bars = mkBars(30)
  const noNum = render({ ...baseProps, bars, quotedAt: null, exitRuleText: '成長率が15%を割ったら', exitLevel: null })
  // 「線が引けない」と「判定していない」は1文にまとめる（同じことを2回読ませない・2026-09-30 オーナー要望）
  check('数字でない条件: 水平線を引かない（<line は縦線1本だけ）＋理由は1文だけ（条件の全文つき）',
    count(noNum, '<line') === 1
    && noNum.includes('書いた条件『成長率が15%を割ったら』は株価の値ではないので、この図には線を引かず、触れたかどうかも見ていません。')
    // 目に見える文は1つ。図の aria-label（読み上げ用）に同じ文が入るので、数えるのではなく
    // 「別立ての注記が無い」ことで見る（2026-09-30）。
    && !noNum.includes('この図には線を引けません'),
    `line=${count(noNum, '<line')} 別立ての注記=${noNum.includes('この図には線を引けません')}`)
  const empty = render({ ...baseProps, bars, quotedAt: null, exitRuleText: null, exitLevel: null })
  check('条件が空: 「降りる条件は決めていませんでした。N日が過ぎました。」・「線を引けません」は出さない', /降りる条件は決めていませんでした。\d+日が過ぎました。/.test(empty) && !empty.includes('線を引けません') && count(empty, '<line') === 1)
}
{
  const panel = stripComments(read('components/review/PriceSincePanel.tsx'))
  check("PriceSincePanel.tsx: 'use client'・lightweight-charts を使わない・fetch を持たない", /^'use client'/.test(read('components/review/PriceSincePanel.tsx')) && !panel.includes('lightweight-charts') && !panel.includes('fetch('))
  check('PriceSincePanel.tsx: 高さ 96px（const H = 96）・SERIES.you・fade の薄い面', panel.includes('const H = 96') && panel.includes('SERIES.you') && panel.includes('fade(SERIES.you.color'))
  check('PriceSincePanel.tsx: 触れたかどうかは終値で見る（low/high を読まない）', !/\.low\b|\.high\b/.test(panel))
  check('PriceSincePanel.tsx: Date.now／Math.random を使わない', !/Date\.now|Math\.random/.test(panel))
}

console.log('■ 8. 禁止語（app/review/**・components/review/**）')
for (const [f, src] of codeOf([...APP_REVIEW, ...COMP_REVIEW])) {
  const w = /守れた|守れなかった|正しかった|判断ミス|的中|当たった|外れた|正解|見本|お手本/.exec(src)?.[0]
  check(`${f}: 禁止語が無い`, !w, w)
}

console.log('■ 9. 画面の構成（app/review/page.tsx）')
{
  const page = stripComments(read('app/review/page.tsx'))
  check('h1「書いたことを、株価と並べて読み返す」・小見出し「03 読み返す」', page.includes('<h1 className="text-h1 text-ink">書いたことを、株価と並べて読み返す</h1>') && page.includes('03 読み返す'))
  check('最初の1行（0件）「読み返す材料は、まだありません。」（text-h2 text-ink）', page.includes('<p className="text-h2 text-ink">読み返す材料は、まだありません。</p>'))
  check('最初の1行（1件）「{SYMBOL} を買ったときに書いたことが、1件残っています。」', page.includes('を買ったときに書いたことが、1件残っています。'))
  check('最初の1行（2〜4件）「{N}件の記録が残っています。」＋「同じことを5回書くと、共通するところを1つだけ出します。いまは1件ずつ読み返せます。」', page.includes('件の記録が残っています。') && page.includes('回書くと、共通するところを1つだけ出します。いまは1件ずつ読み返せます。'))
  check('最初の1行（5件以上・偏りあり）「あなたのクセが、1つ見えてきた。」＋ pattern.text', page.includes('あなたのクセが、1つ見えてきた。') && page.includes('{pattern.text}'))
  check('最初の1行（5件以上・偏りなし）「…同じ向きに寄っているものは見つかりませんでした。」', page.includes('件を読み返しましたが、同じ向きに寄っているものは見つかりませんでした。'))
  check('「あと◯件」のカウントダウンにしない', !/あと\$\{|あと\d+件|残り\$\{/.test(page))
  check('クセは findPattern（lib/review/patterns.ts）から。画面で軸を作り直していない', page.includes("from '@/lib/review/patterns'") && page.includes('findPattern(judgements)') && !/降りる条件を決めないまま/.test(page))
  check('h2「あなたが書いたことと、そのあとの株価」', page.includes('あなたが書いたことと、そのあとの株価'))
  check('h2「いまの仮想資金（実際のお金は1円も動きません）」', page.includes('いまの仮想資金（実際のお金は1円も動きません）'))
  check('h2「記録を足す・やり直す」が最後の節', page.includes('記録を足す・やり直す') && page.lastIndexOf('<h2') === page.indexOf('記録を足す・やり直す') - '<h2 className="text-small text-muted">'.length)
  check('「取引履歴（最新10件）」の節が無い', !page.includes('取引履歴'))
  check('初期資本をファーストビューに出さない（INITIAL_CASH は仮想資金の節の中だけ）', !page.includes('初期資本') && page.indexOf('formatUSD(INITIAL_CASH)') > page.indexOf('いまの仮想資金'))
  check('図は最新3件まで（MAX_FIGURES = 3・i >= MAX_FIGURES は図なし）', page.includes('const MAX_FIGURES = 3') && page.includes("i >= MAX_FIGURES ? 'none'"))
  check('日足は /api/stocks/{symbol}/history（実データ。getHistory allowMock:false の route）', page.includes('/history?period=') && !page.includes('mock'))
  check('取得時点は応答の Date ヘッダ。読めなければ null（時刻を作らない）', page.includes("r.headers.get('date')") && page.includes('Number.isNaN(at) ? null : at'))
  check('カードの並び: 買う前に書いたこと → 売るときに書いたこと → PriceSincePanel → 数字', (() => {
    const a = page.indexOf('買う前に、あなたが書いたこと'), b = page.indexOf('売るときに書いたこと'), c = page.indexOf('<PriceSincePanel'), d = page.indexOf('まだ売っていません（読み返すのはこれからです）')
    return a > 0 && a < b && b < c && c < d
  })())
  check('言い換え: 「この回は、理由を書いていません」「降りる条件は決めていませんでした」「まだ売っていません（読み返すのはこれからです）」「1つの銘柄を何回かに分けて売ったときは、古い買いから順に対応させています」',
    page.includes('この回は、理由を書いていません') && page.includes('降りる条件は決めていませんでした') && page.includes('まだ売っていません（読み返すのはこれからです）') && page.includes('1つの銘柄を何回かに分けて売ったときは、古い買いから順に対応させています'))
  check('旧文言が無い（見るべきは儲けた額／その後の値動き／保有中（結果はまだ出ていません）／理由が残っていません／決めていなかった／資産（仮想資金）／リセット）',
    !/見るべきは儲けた額|その後の値動き|保有中（結果はまだ出ていません）|理由が残っていません|決めていなかった|資産（仮想資金）|リセット/.test(page))
  check('確認文「記録をすべて消しますか？書いた理由も、前に売買したことの記録も、元に戻せません。」', page.includes("confirm('記録をすべて消しますか？書いた理由も、前に売買したことの記録も、元に戻せません。')"))
  check('空の状態: 主ボタンは /trade 1つ（bg-brand は1回）・文字リンク /review/backfill と /watch・架空のカードを描かない（見取り図は文字）', count(page, 'bg-brand ') === 2 /* 未ログイン画面のログイン＋空の状態の /trade（同時には出ない） */ && page.includes('href="/review/backfill"') && page.includes('href="/watch"') && page.includes('ここに並ぶもの') && page.includes('① あなたが書いた理由'))
  check('1件のとき: 【見立て】の再掲＋「それに気づけたことが、この記録のいちばんの中身です。」＋「ごろ、この記録を実際の株価と並べて読み返せます。」', page.includes("sectionOf(first.entryReason, '見立て')") && page.includes('それに気づけたことが、この記録のいちばんの中身です。') && page.includes('ごろ、この記録を実際の株価と並べて読み返せます。'))
  check('読み込み中の骨組み（aria-busy・animate-pulse）は残す（check-night-theme の許可リスト）', page.includes('aria-busy="true"') && page.includes('motion-safe:animate-pulse'))
  const bf = stripComments(read('app/review/backfill/page.tsx'))
  check('backfill: 「『03 読み返す』で、書いたことと株価を並べられます。」・「読み返す →」', bf.includes('「03 読み返す」で、書いたことと株価を並べられます。') && bf.includes('>読み返す →</Link>') && !bf.includes('振り返る →'))
  // S3a「1件のふりかえり」（2026-09-30）: 各カードから /review/[recordId] へ文字リンク1本。中身の検査は scripts/check-review-record.ts
  check('各カードに「この1件をくわしく読み返す →」（/review/[recordId] への文字リンク1本・S3a。詳細は check-review-record.ts）',
    page.includes('この1件をくわしく読み返す →') && page.includes('href={`/review/${recordId}`}') && page.includes("from '@/lib/review/record'") && exists('scripts/check-review-record.ts') && exists('app/review/[recordId]/page.tsx'))
}

console.log('■ ホーム（app/(night)/page.tsx）と DESIGN.md')
{
  const home = stripComments(read('app/(night)/page.tsx'))
  check('ホーム 03 の本文に「同じことを5回書くと、共通するところを1つだけ出します。」（実物が /review にある）', home.includes('同じことを5回書くと、共通するところを1つだけ出します。'))
  const design = read('DESIGN.md')
  check('DESIGN.md §6-15: 並びが「①書いた理由 → ②そのあとの株価（図）→ ③ずれの1文 → ④損益」・「④ずれのメモは未実装」が無い', design.includes('①書いた理由 → ②そのあとの株価（図）→ ③ずれの1文 → ④損益') && !design.includes('④ 未実装（別スライス）'))
  check('DESIGN.md §6-15: 図の仕様（96px・1系列・凡例なし・縦線は必ず・水平線は条件付き・出所必須）', design.includes('高さ 96px') && design.includes('1系列＝終値だけ') && design.includes('凡例なし') && design.includes('縦線は必ず引く') && design.includes('水平線は条件付き') && design.includes('出所は必須'))
}

console.log('')
console.log(`PASS ${passed} 件 / FAIL ${failed} 件`)
if (failed) process.exit(1)
console.log('すべてPASS')
