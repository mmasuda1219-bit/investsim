// 「書いたことと、したことのまとめ」（/review の一覧・S-H1・2026-10-25）の検査。
//   $env:PATH = "C:\Program Files\nodejs;$env:PATH"; npx tsx scripts/check-review-habits.ts
//
// 見るもの（番号は指示書 brief-builder-S-H1.md のまま）:
//  (1) 評価語・禁止語なし: lib/review/habits/text.ts と components/habits/** の固定の文字列、描いた画面（引用を除く）に
//      scripts/lib/habits-forbidden.ts の一覧（＋GUARD_FORBIDDEN の写し＋check-review (8) の語）が無い。法務の断り (a)(b) の全文は除いてから見る
//  (2) 点数なし: score・点数・ランク・偏差・勝率・% の記法が無い。types.ts の number の欄は total／hits／count／〜Count／〜At だけ
//  (3) 損益を読まない: lib/review/habits/**・components/habits/** に pnlPct・exitPrice・entryPrice・price・currentPrice の参照が無い。
//      買値・売値を変えても出力が同じ
//  (4) 本人の記録だけ: supabase・getAdminClient・fetch・process.env・next/headers を import／参照しない。summarizeHabits は記録だけを受ける
//  (5) 断りが常に出る: 4状態（売り終えた0件／5件未満／5件以上／見出し付き0件）で (a)(b) の全文。5件未満は傾向の段落が無く (d) がある。
//      5件以上は傾向の段落ごとに (c) の分母の文がある
//  (6) 決定的: 同じ入力を100回・並び順を入れ替えても同じ出力。Date.now・Math.random が無い
//  (7) 誤検知なし: 何も仕込まない合成の記録で K4・K8・K12 が0件。保有中・見出しの無い記録は数えない。練習と過去を混ぜない
//  (8) 凍結: patterns.ts・judgement.ts・record.ts・reason.ts・exit-rule.ts・planned-hold.ts・components/review/** が HEAD と同じ。
//      lib/review/habits/**・components/habits/**・この検査が lib/lab を import しない
//  (9) 正例: K2 の各区分・K4 の各材料・K8 (i)(ii)(iii)・K9 の両側・K12 に当たる文。否定文・仮定文・問いの文は当たらない
// (10) 語の固定: 見出しと (a)(b)(d) の全文が text.ts に一字一句ある
//
// 実ネットワーク不要。合成の記録はこの検査の中だけ（製品コードに入れない）。数字は実在の銘柄・日付ではない。

import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { HabitSummary } from '../components/habits/HabitSummary'
import {
  exitRuleKind,
  materialsOf,
  repeatedPhrases,
  sellLinks,
  summarizeHabits,
} from '../lib/review/habits/catalogue'
import { GUARD_FORBIDDEN_COPY, HABITS_FORBIDDEN_ALL, habitsForbiddenWordsIn } from './lib/habits-forbidden'
import * as TEXT from '../lib/review/habits/text'
import type { HabitRecordInput } from '../lib/review/habits/types'
import { MIN_RECORDS } from '../lib/review/patterns'

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
/** 注釈を落とす。文字列の中の // は残す（check-review.ts と同じ） */
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
/** JSX の {/* … *\/} の注釈も落とす */
const stripJsxComments = (s: string) => s.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
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
/** 文字列リテラル（'…' "…" `…`）の中身 */
function literals(code: string): string[] {
  const out: string[] = []
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) out.push(m[1] ?? m[2] ?? m[3] ?? '')
  return out
}
/** JSX の文字（> と < のあいだ） */
function jsxTexts(code: string): string[] {
  return [...code.matchAll(/>([^<>{}]+)</g)].map(m => m[1].trim()).filter(s => /[^\s]/.test(s) && !/^[)\]};,]/.test(s))
}

const HABIT_LIB = walk('lib/review/habits')
const HABIT_COMP = walk('components/habits')
const code = (f: string) => stripJsxComments(stripComments(read(f)))

// ── 合成の記録（この検査の中だけ） ─────────────────────────────────────────────
const DAY = 86_400_000
const T0 = Date.UTC(2026, 0, 15, 3, 0, 0)
type Fields = Record<string, string>
const compose = (f: Fields | string | null) =>
  f === null ? null : typeof f === 'string' ? f : Object.entries(f).filter(([, v]) => v).map(([k, v]) => `【${k}】${v}`).join('\n')
let seqN = 0
function R(o: {
  id?: string
  source?: 'practice' | 'past'
  day: number
  entry: Fields | string | null
  sells?: { day: number; reason: Fields | string | null; shares?: number }[]
  shares?: number
}): HabitRecordInput & { entryPrice: number; symbol: string; name: string } {
  seqN++
  const shares = o.shares ?? 10
  return {
    id: o.id ?? `r${seqN}`,
    seq: seqN,
    source: o.source ?? 'practice',
    entryAt: T0 + o.day * DAY,
    entryReason: compose(o.entry),
    shares,
    sells: (o.sells ?? []).map(s => ({ exitAt: T0 + s.day * DAY, exitReason: compose(s.reason), shares: s.shares ?? shares })),
    // 以下は検出器の型に無い欄（読まれないことを (3) で確かめる）
    entryPrice: 100,
    symbol: 'TEST',
    name: 'テスト',
  }
}

/** 何も仕込まない記録（実物の書き方を手本に builder が作った。欄どうしは受け合うが、K4・K8・K12 の形を含まない） */
function cleanSet(source: 'practice' | 'past', n: number, offset = 0): ReturnType<typeof R>[] {
  const theses = [
    '直近の四半期で売上は前年比+18%、営業利益率は12%で前年並み。在庫の回転も前の期と同じくらい。',
    '新しい工場が来年に動き出す予定。設備投資の額は会社の説明資料に載っている。',
    '配当は5期続けて同じ額。手元の現金は有利子負債より大きい。',
    '海外の店舗数が国内を上回った。地域ごとの売上の内訳は決算資料で読める。',
    '会員数の伸びが四半期ごとに公表されている。解約の数も同じ表に並ぶ。',
    '主力製品の値上げを発表済み。数量の見込みは会社が出していない。',
    '受注残の金額が過去の決算短信より大きい。納期は2年先まで埋まっている。',
    '自社株買いの枠を設定したと開示があった。実施の期間は1年。',
  ]
  const catalysts = ['次の四半期の売上の内訳', '工場の稼働開始の時期', '次の配当の発表', '地域別の店舗数', '会員数の公表', '値上げ後の数量', '受注残の推移', '自社株買いの実施状況']
  const exits = ['株価が-15%になったら売る', '$80を割ったら', '株価が-25%になったら売る', '1,500円を割ったら', '株価が-10%になったら売る', '$120を割ったら', '株価が-30%になったら売る', '2,400円を割ったら']
  const sellReasons = [
    '手元の現金を別の用途に回したくなり、持ち分を手放した。',
    '持ち分を整理して、銘柄の数を絞った。',
    '口座の中身を見直して、一部を現金に戻した。',
    '同じ業種に偏っていたので、持ち分を手放した。',
    '年末に口座をまとめるときに手放した。',
    '持ちすぎていると感じ、全部を手放した。',
    'まとまった出費があり、現金に替えた。',
    '銘柄を入れ替えるために手放した。',
  ]
  return Array.from({ length: n }, (_, i) =>
    R({
      source,
      day: offset + i * 20,
      entry: source === 'past'
        ? { 見立て: theses[i % theses.length], 降りる条件: exits[i % exits.length] }
        : { 見立て: theses[i % theses.length], 注目: catalysts[i % catalysts.length], 降りる条件: exits[i % exits.length] },
      sells: [{ day: offset + i * 20 + 9, reason: { 売る理由: sellReasons[i % sellReasons.length] } }],
    }),
  )
}

const render = (records: readonly HabitRecordInput[]) => renderToStaticMarkup(React.createElement(HabitSummary, { records }))
/** 引用（利用者の原文）を除いた画面の文 */
const withoutQuotes = (html: string) => html.replace(/<p[^>]*data-habit-quote=""[^>]*>[\s\S]*?<\/p>/g, '')
const textOf = (html: string) => html.replace(/<[^>]+>/g, '\n')

const openOnly = [R({ day: 0, entry: { 見立て: '保有中の記録の見立て', 降りる条件: '株価が-10%になったら売る' } })]
const S0 = [...openOnly]
const S1 = cleanSet('practice', 3)
const S2 = [...cleanSet('practice', 6), ...cleanSet('past', 5, 3), ...openOnly]
const S3 = [
  R({ day: 0, entry: '見出しの無い古い形の理由', sells: [{ day: 10, reason: '見出しの無い売りの理由' }] }),
  R({ day: 5, entry: null, sells: [{ day: 15, reason: null }] }),
]
const STATES: [string, ReturnType<typeof R>[]][] = [['売り終えた0件', S0], ['5件未満', S1], ['5件以上', S2], ['見出し付き0件', S3]]
const HTML = Object.fromEntries(STATES.map(([k, rs]) => [k, render(rs)])) as Record<string, string>

// ═════════════════════════════════════════════════════════════════════════════
console.log('■ (1) 評価語・禁止語なし')
{
  check('禁止語の一覧に legal §2 の語・GUARD_FORBIDDEN の写し・check-review (8) の語・診断／採点／べきが入っている',
    ['損切り', '遅すぎ', '早すぎ', '勝率', '判断の質', '評価', '分析', '改善', '次は', 'しましょう', '気質効果', 'アンカリング', '多い', '少ない', 'よくある', '珍しい', '正しかった', '見本', '診断', '採点', 'べき'].every(w => HABITS_FORBIDDEN_ALL.includes(w)) &&
      GUARD_FORBIDDEN_COPY.every(w => HABITS_FORBIDDEN_ALL.includes(w)))
  const textSrc = code('lib/review/habits/text.ts')
  const bad: string[] = []
  for (const s of literals(textSrc)) for (const w of habitsForbiddenWordsIn(s)) bad.push(`text.ts「${s.slice(0, 20)}…」: ${w}`)
  for (const f of HABIT_COMP) {
    const c = code(f)
    for (const s of [...literals(c), ...jsxTexts(c)]) for (const w of habitsForbiddenWordsIn(s)) bad.push(`${f}「${s.slice(0, 20)}」: ${w}`)
  }
  check('text.ts と components/habits/** の固定の文字列に禁止語が無い（法務の断り (a)(b) の全文は除いて見る）', bad.length === 0, bad.join(' / '))
  // 関数の文も実際に作って見る
  const built = [
    TEXT.headingText(12), TEXT.groupHeading('practice', 6), TEXT.groupHeading('past', 5), TEXT.periodText(T0, T0 + 90 * DAY),
    TEXT.countedText({ total: 11, practice: 6, past: 5, closedCount: 12, openCount: 1, unstructuredCount: 1, firstAt: T0, lastAt: T0 + 90 * DAY }),
    TEXT.countedText({ total: 0, practice: 0, past: 0, closedCount: 0, openCount: 2, unstructuredCount: 0, firstAt: null, lastAt: null }),
    TEXT.countedText({ total: 0, practice: 0, past: 0, closedCount: 2, openCount: 0, unstructuredCount: 2, firstAt: null, lastAt: null }),
    TEXT.denominatorText(12, '予定の期間が読めた', 4, '予定の期間が読めなかった'), TEXT.ofText(6, 2), TEXT.countText(3), TEXT.recordLinkText(4),
  ]
  const bad2 = built.flatMap(s => habitsForbiddenWordsIn(s).map(w => `「${s}」: ${w}`))
  check('text.ts の関数が作る文に禁止語が無い', bad2.length === 0, bad2.join(' / '))
  const bad3 = STATES.flatMap(([k]) => habitsForbiddenWordsIn(textOf(withoutQuotes(HTML[k]))).map(w => `${k}: ${w}`))
  check('4状態の描いた画面（利用者の原文の引用を除く）に禁止語が無い', bad3.length === 0, bad3.join(' / '))
}

console.log('■ (2) 点数なし')
{
  const files = [...HABIT_LIB, ...HABIT_COMP]
  for (const f of files) {
    const c = code(f)
    const hit = [/\bscore\b/i, /点数|採点|得点/, /ランク/, /偏差/, /勝率/, /\brank\b|\bratio\b|\brate\b/i].map(re => re.exec(c)?.[0]).filter(Boolean)
    check(`${f}: score・点数・ランク・偏差・勝率・rank・ratio が無い`, hit.length === 0, hit.join(' / '))
  }
  const pct: string[] = []
  for (const s of literals(code('lib/review/habits/text.ts'))) if (/[%％]/.test(s)) pct.push(s)
  for (const f of HABIT_COMP) for (const s of [...literals(code(f)), ...jsxTexts(code(f))]) if (/[%％]/.test(s)) pct.push(`${f}: ${s}`)
  check('画面の文（text.ts・components/habits/**）に % の記法が無い', pct.length === 0, pct.join(' / '))
  check('4状態の描いた画面（引用を除く）に % が無い・割合／ゲージ／順位の語が無い', STATES.every(([k]) => !/[%％]|割合|ゲージ|順位|位）/.test(textOf(withoutQuotes(HTML[k])))))
  check('描いた画面に棒・ゲージ（<progress・<meter・<svg・style="width）が無い', STATES.every(([k]) => !/<progress|<meter|<svg|style="width/.test(HTML[k])))
  check('件数に色を付けない（components/habits/** に text-success・text-danger・text-warning・bg-brand が無い）', HABIT_COMP.every(f => !/text-success|text-danger|text-warning|bg-brand|--success|--danger/.test(code(f))))
  const types = code('lib/review/habits/types.ts')
  const numFields = [...types.matchAll(/(\w+)\??:\s*number\b/g)].map(m => m[1])
  const badNum = numFields.filter(n => !/^(total|hits|count|seq|\w+Count|\w+At)$/.test(n))
  check(`types.ts の number の欄は total／hits／count／seq（記録の通し番号）／〜Count／〜At だけ（${numFields.join('・')}）`, numFields.length > 0 && badNum.length === 0, badNum.join(', '))
  check('types.ts の records の欄は id と seq だけ（K12 のリンク用）', /records:\s*\{\s*id:\s*string;\s*seq:\s*number\s*\}\[\]/.test(types))
}

console.log('■ (3) 損益を読まない')
{
  for (const f of [...HABIT_LIB, ...HABIT_COMP]) {
    const c = code(f)
    const hit = /pnlPct|exitPrice|entryPrice|currentPrice|\bprice\b|pnl\b|損益/.exec(c)?.[0]
    check(`${f}: pnlPct・exitPrice・entryPrice・price・currentPrice・損益 の参照が無い`, !hit, hit)
  }
  const types = code('lib/review/habits/types.ts')
  const pick = /Pick<ReviewRecord,([^>]+)>/.exec(types)?.[1] ?? ''
  check(`HabitRecordInput は ReviewRecord から価格・銘柄名を取らない（Pick: ${pick.trim()}）`, pick.length > 0 && !/Price|name|symbol/.test(pick) && /Pick<ReviewSell,\s*'exitAt'\s*\|\s*'exitReason'\s*\|\s*'shares'>/.test(types))
  const a = JSON.stringify(summarizeHabits(S2))
  const priced = S2.map((r, i) => ({ ...r, entryPrice: 1 + i * 997, sells: r.sells.map(s => ({ ...s, exitPrice: 5000 - i, pnlPct: -50 + i })) }))
  check('買値・売値・損益を変えても、まとめが同じ（読んでいない）', a === JSON.stringify(summarizeHabits(priced)) && render(S2) === render(priced))
}

console.log('■ (4) 本人の記録だけ')
{
  for (const f of [...HABIT_LIB, ...HABIT_COMP]) {
    const c = code(f)
    const hit = /supabase|getAdminClient|\bfetch\s*\(|process\.env|next\/headers|getCurrentUserId|getPortfolio|userId/.exec(c)?.[0]
    check(`${f}: supabase・getAdminClient・fetch・process.env・next/headers・userId を使わない`, !hit, hit)
  }
  check('summarizeHabits は記録の配列1つだけを受ける（利用者 ID を渡せない）', summarizeHabits.length === 1)
  const page = stripComments(read('app/review/page.tsx'))
  check('app/review/page.tsx: <HabitSummary records={records} /> を1か所（records＝buildRecords(portfolio.trades)。新しい取得をしない）',
    (page.match(/<HabitSummary /g) ?? []).length === 1 && page.includes('<HabitSummary records={records} />') && page.includes('const records = buildRecords(portfolio.trades)'))
}

console.log('■ (5) 断りが常に出る（4状態）')
{
  for (const [k] of STATES) {
    const h = HTML[k]
    check(`${k}: (a)(b) の全文がある`, h.includes(TEXT.DISCLAIMER_A) && h.includes(TEXT.DISCLAIMER_B))
    check(`${k}: 見出し「${TEXT.HABITS_HEADING}（売り終えた◯件から）」が h2 にある`, /<h2[^>]*>書いたことと、したことのまとめ（売り終えた\d+件から）<\/h2>/.test(h))
    check(`${k}: <details・opacity・aria-hidden が無い`, !/<details|opacity-|aria-hidden/.test(h))
  }
  for (const k of ['売り終えた0件', '5件未満', '見出し付き0件']) {
    check(`${k}: 傾向の段落が無く、(d) がある・(c) の分母の文が無い`, !HTML[k].includes('data-habit-trend') && HTML[k].includes(TEXT.DISCLAIMER_D) && !HTML[k].includes('数えたのは、'))
    check(`${k}: 「N件のうちM件」の文が無い`, !/\d+件のうち\d+件/.test(HTML[k]))
  }
  check('5件未満: 書き方の内訳の件数（「M件」）は並ぶ', HTML['5件未満'].includes(TEXT.EXIT_RULE_LABEL.pricePct) && HTML['5件未満'].includes('>2件<'))
  check('5件未満: カウントダウンにしない（「あと◯件」「残り」が無い）', !/あと\d+件|残り\d+件/.test(HTML['5件未満']))
  {
    const h = HTML['5件以上']
    const parts = h.split('data-habit-trend=""').slice(1)
    check(`5件以上: 傾向の段落が 7×2帳簿＝14（実測 ${parts.length}）`, parts.length === 14)
    check('5件以上: 傾向の段落ごとに (c) の分母の文（「数えたのは、売り終えた記録◯件のうち、…◯件は数えていません。」）がある',
      parts.every(p => /data-habit-denominator="">数えたのは、売り終えた記録\d+件のうち、[^<]+\d+件です。[^<]+\d+件は数えていません。</.test(p)))
    check('5件以上: (d) が無い', !h.includes(TEXT.DISCLAIMER_D))
    check('5件以上: 練習と過去を別々に数えた断り・帳簿の見出し2つ', h.includes(TEXT.SEPARATE_NOTE) && h.includes('練習の記録（6件）') && h.includes('過去の記録（5件）'))
    check('5件以上: 過去の記録の帳簿に【注目】の欄が無いことの断り', h.includes(TEXT.PAST_NO_CATALYST_NOTE))
    check('5件以上: 区分は0件でも全部出る（降りる条件の7区分・材料の5＋1・予定の3区分）',
      Object.values(TEXT.EXIT_RULE_LABEL).every(l => h.includes(l)) && Object.values(TEXT.MATERIAL_LABEL).every(l => h.includes(l)) && Object.values(TEXT.HOLD_LABEL).every(l => h.includes(l)))
  }
  check('売り終えた0件: §0「売り終えた記録は、まだありません。保有中の1件は数えていません。…」', HTML['売り終えた0件'].includes('売り終えた記録は、まだありません。保有中の1件は数えていません。'))
  check('見出し付き0件: §0「売り終えた記録2件は、どれも見出しの無い形で書かれているため、数えていません。…」', HTML['見出し付き0件'].includes('売り終えた記録2件は、どれも見出しの無い形で書かれているため、数えていません。'))
  check('記録が1件も無いときも節が出て (a)(b) がある', render([]).includes(TEXT.DISCLAIMER_A) && render([]).includes(TEXT.DISCLAIMER_B))
  const comp = code('components/habits/HabitSummary.tsx')
  check('断り (a)(b)(c)(d) の文字は 12px 以上・--muted 以上（text-small／text-caption で、text-[1x px] の小さい文字を作らない）', !/text-\[(?:[0-9]|1[01])px\]/.test(comp) && /data-habit-disclaimer="a"/.test(comp))
}

console.log('■ (6) 決定的')
{
  let seed = 20261025
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  const shuffle = <T,>(xs: T[]) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }
  const base = JSON.stringify(summarizeHabits(S2))
  const baseHtml = render(S2)
  let same = true
  for (let i = 0; i < 100; i++) {
    const s = shuffle(S2)
    if (JSON.stringify(summarizeHabits(s)) !== base || render(s) !== baseHtml) { same = false; break }
  }
  check('同じ入力を100回・並び順を入れ替えても、まとめと描いた画面が同じ', same)
  for (const f of [...HABIT_LIB, ...HABIT_COMP]) {
    const c = code(f)
    check(`${f}: Date.now・Math.random・引数なしの new Date() が無い`, !/Date\.now|Math\.random|new Date\(\s*\)/.test(c))
  }
}

console.log('■ (7) 誤検知なし（何も仕込まない記録）')
{
  const clean = [...cleanSet('practice', 8), ...cleanSet('past', 8, 5)]
  const s = summarizeHabits(clean)
  const mat = s.groups.flatMap(g => g.material.counts.map(c => c.count)).reduce((a, b) => a + b, 0)
  const links = s.groups.reduce((a, g) => a + g.sellLink.hits, 0)
  const phrases = s.groups.reduce((a, g) => a + g.phrase.phrases.length, 0)
  check(`K4 の材料の当たりが0件（実測 ${mat}）`, mat === 0, JSON.stringify(s.groups.map(g => g.material)))
  check(`K8 の当たりが0件（実測 ${links}）`, links === 0, JSON.stringify(s.groups.map(g => g.sellLink)))
  check(`K12 の言い回しが0件（実測 ${phrases}）`, phrases === 0, JSON.stringify(s.groups.map(g => g.phrase.phrases)))
  check('何も仕込まない記録の降りる条件は「買値からのパーセント」「株価の値」だけに入る（会社の数字・その他・組み合わせが0件）',
    s.groups.every(g => g.exitRule.counts.every(c => (c.key === 'pricePct' || c.key === 'priceValue') ? c.count > 0 : c.count === 0)), JSON.stringify(s.groups.map(g => g.exitRule.counts)))
  const mixed = summarizeHabits([
    ...cleanSet('practice', 2),
    ...cleanSet('past', 3, 2),
    R({ day: 300, entry: { 見立て: '保有中の記録の見立て', 降りる条件: '株価が-10%になったら売る' } }),
    R({ day: 310, entry: { 見立て: '一部だけ売った記録の見立て', 降りる条件: '株価が-10%になったら売る' }, shares: 10, sells: [{ day: 320, reason: { 売る理由: '一部だけ手放した' }, shares: 4 }] }),
    R({ day: 330, entry: '見出しの無い古い形の理由', sells: [{ day: 340, reason: '売った' }] }),
    R({ day: 350, entry: null, sells: [{ day: 360, reason: null }] }),
  ])
  check('保有中（一部だけ売った記録を含む）の2件は数えない・openCount=2', mixed.openCount === 2 && mixed.total === 5, JSON.stringify({ open: mixed.openCount, total: mixed.total }))
  check('見出しの無い2件は数えない・unstructuredCount=2', mixed.unstructuredCount === 2 && mixed.closedCount === 7)
  const pr = mixed.groups.find(g => g.source === 'practice')
  const pa = mixed.groups.find(g => g.source === 'past')
  check('練習と過去を混ぜない（練習2件・過去3件。練習の帳簿の売り終えた件数に見出しの無い2件を含む＝4）',
    pr?.total === 2 && pa?.total === 3 && pr?.closedCount === 4 && pa?.closedCount === 3 && mixed.groups.map(g => g.source).join(',') === 'practice,past')
  check('数えた記録が無い帳簿は出さない', summarizeHabits(cleanSet('past', 2)).groups.map(g => g.source).join(',') === 'past')
}

console.log('■ (9) 正例と、否定・仮定・問いの文')
{
  const k2: [string, string][] = [
    ['株価が-20%になったら売る', 'pricePct'], ['買値から10%下がったら売る', 'pricePct'], ['$150を割ったら', 'priceValue'], ['1,200円を割ったら', 'priceValue'],
    ['成長率が15%を割ったら', 'company'], ['次の決算で売上が前年を下回ったら', 'company'], ['3年は持つ', 'period'],
    ['成長率が15%を割ったら / 株価が-20%になったら売る', 'combined'], ['なんとなく怖くなったら', 'other'], ['金利が上がったら', 'other'],
    ['決めていなかった', 'none'], ['', 'none'],
  ]
  for (const [t, k] of k2) check(`K2「${t}」→ ${k}`, exitRuleKind(t) === k, exitRuleKind(t))
  const k4: [string, string][] = [
    ['売上が前年より伸びているので、買うことにした', 'company'], ['株価が下がっているから、いまのうちに買う', 'momentum'],
    ['誰もが知る大手なので、潰れないだろうから安心して持てる', 'fame'], ['これから上がりそうだから買う', 'forecast'],
    ['SNSで話題になっていたので買った', 'opinion'], ['アナリストが強気だと聞いたので買う', 'opinion'],
  ]
  for (const [t, k] of k4) check(`K4「${t}」→ ${k}`, materialsOf(t).includes(k as never), JSON.stringify(materialsOf(t)))
  const neg = ['株価が上がっているからといって買わない', 'もし決算が良ければ買う', '株価が上がっているのか？', '売上が伸びているから買う、というわけではない', '株価が上がったら買うつもり', '有名だから安心、とは限らない']
  for (const t of neg) check(`K4 否定・仮定・問いの文「${t}」は当たらない`, materialsOf(t).length === 0, JSON.stringify(materialsOf(t)))
  check('K4 触れただけの文（因果の語が無い）「売上は前年比+18%。株価は年初から上がっている。」は当たらない', materialsOf('売上は前年比+18%。株価は年初から上がっている。').length === 0)
  check('K8 (i) 固定語「決めた条件に当たったので売る」', sellLinks('成長率が15%を割ったら', '決めた条件に当たったので売る').includes('fixedWord'))
  check('K8 (ii) 同じ数字「−20%」と「-20％」（表記をならして一致）', sellLinks('株価が−20%になったら売る', '-20％に届いたので手放した').includes('sameNumber'))
  check('K8 (ii) 同じ数字「1,500円」と「1500円」', sellLinks('1,500円を割ったら', '1500円を下回ったので手放した').includes('sameNumber'))
  check('K8 (iii) 同じ語「決算」', sellLinks('次の決算が悪かったら', '決算が予想を下回ったので手放した').includes('sameWord'))
  check('K8 どれも出てこない「欲しいものがあり現金に替えた」', sellLinks('株価が-20%になったら売る', '欲しいものがあり現金に替えた').length === 0)
  {
    const hold = summarizeHabits([
      R({ day: 0, entry: { 見立て: '期間の正例1の見立て', 降りる条件: '1年は持つ' }, sells: [{ day: 30, reason: { 売る理由: '手放した' } }] }),
      R({ day: 0, entry: { 見立て: '半年様子を見る', 降りる条件: '株価が-20%になったら売る' }, sells: [{ day: 400, reason: { 売る理由: '手放した' } }] }),
      R({ day: 0, entry: { 見立て: '期間の正例3の見立て', 降りる条件: '株価が-20%になったら売る' }, sells: [{ day: 60, reason: { 売る理由: '手放した' } }] }),
    ]).groups[0].hold
    const by = Object.fromEntries(hold.counts.map(c => [c.key, c.count]))
    check('K9 予定より前に売った1件・予定を過ぎて売った1件・読めなかった1件は分母に入らない', hold.total === 2 && by.before === 1 && by.after === 1 && by.same === 0, JSON.stringify(hold))
  }
  {
    const ps = repeatedPhrases([
      { id: 'a', seq: 1, thesis: 'ブランドの力が強くて安心できる会社だと思う' },
      { id: 'b', seq: 2, thesis: '今回もブランドの力が強くて安心できると見た' },
      { id: 'c', seq: 3, thesis: 'ブランドの力が強くて　安心できるので持つ' },
      { id: 'd', seq: 4, thesis: '別の話を書いた記録' },
    ])
    check('K12 8字以上の同じ文字列が3件の別の記録に（全角の空白をならして一致・原文は最も古い記録から）',
      ps.length === 1 && ps[0].text === 'ブランドの力が強くて安心できる' && ps[0].records.map(r => r.id).join(',') === 'a,b,c', JSON.stringify(ps))
    const two = repeatedPhrases([{ id: 'a', seq: 1, thesis: 'ブランドの力が強くて安心' }, { id: 'b', seq: 2, thesis: 'ブランドの力が強くて安心' }])
    check('K12 2件にしか出てこない文字列は出さない', two.length === 0)
    const short = repeatedPhrases(['a', 'b', 'c'].map((id, i) => ({ id, seq: i + 1, thesis: `${id}：決算が良い。` })))
    check('K12 7字以下の重なり（「決算が良い。」）は出さない', short.length === 0)
    const six = repeatedPhrases(Array.from({ length: 4 }, (_, i) => ({ id: `x${i}`, seq: i + 1, thesis: '一つ目の言い回しです。二つ目の言い回しです。三つ目の言い回しです。四つ目の言い回しです。五つ目の言い回しです。六つ目の言い回しです' })))
    check('K12 最大5つ', six.length <= 5)
  }
  // fix9: reviewer 否定例 2026-10-25（reviewer の文。打ち消し・引用・注意の文は材料にしない）
  {
    const notHit: [string, string[]][] = [
      ['有名な会社なので安心だ、とは思わない', ['fame']],
      ['上がりそうだから買う、という理由は使わない', ['forecast']],
      ['友人が『株価が上がるから買え』と言ったが、自分では決算を見て決めた', ['momentum', 'opinion']],
      ['ニュースで見たので調べ始めた', ['opinion']],
      ['アナリストの評価が高いから買うのは危ない', ['opinion']],
    ]
    for (const [t, ks] of notHit) {
      const got = materialsOf(t) as readonly string[]
      check(`K4 「${t}」は ${ks.join('・')} に当たらない`, ks.every(k => !got.includes(k)), JSON.stringify(got))
    }
    check('K8 「条件に当てはまらないが売った」は固定語に当たらない', !sellLinks('成長率が15%を割ったら', '条件に当てはまらないが売った').includes('fixedWord'), JSON.stringify(sellLinks('成長率が15%を割ったら', '条件に当てはまらないが売った')))
    check('K2「保有比率が20%を超えたら」→ other', exitRuleKind('保有比率が20%を超えたら') === 'other', exitRuleKind('保有比率が20%を超えたら'))
    check('K2「含み損が20%になったら」→ pricePct', exitRuleKind('含み損が20%になったら') === 'pricePct', exitRuleKind('含み損が20%になったら'))
  }
  // 性能: 200件×300字が全部同じ見立てでも 300ms 以内（reviewer C1 の再発防止）
  {
    const body = 'ブランドの力が強くて安心できる会社だと思う。売上は前年より伸びている。'.repeat(10).slice(0, 300)
    const many = Array.from({ length: 200 }, (_, i) => R({ day: i, entry: { 見立て: body, 降りる条件: '株価が-20%になったら売る' }, sells: [{ day: i + 30, reason: { 売る理由: '決めた条件に当たったので売る' } }] }))
    const t0 = performance.now()
    summarizeHabits(many)
    const ms = performance.now() - t0
    check(`性能: 200件×300字・全部同じ見立てで summarizeHabits が 300ms 以内（実測 ${ms.toFixed(1)}ms）`, body.length === 300 && ms <= 300, `${ms.toFixed(1)}ms`)
  }
}

console.log('■ (8) 凍結')
{
  const frozen = ['lib/review/patterns.ts', 'lib/review/judgement.ts', 'lib/review/record.ts', 'lib/trade/reason.ts', 'lib/review/exit-rule.ts', 'lib/review/planned-hold.ts', 'components/review']
  for (const f of frozen) {
    let same = true
    try { execSync(`git diff --quiet HEAD -- "${f}"`, { cwd: ROOT, stdio: 'ignore' }) } catch { same = false }
    let untracked = ''
    try { untracked = execSync(`git ls-files --others --exclude-standard -- "${f}"`, { cwd: ROOT }).toString().trim() } catch { untracked = '?' }
    check(`${f} が HEAD と同じ（未追跡のファイルも無い）`, same && untracked === '', untracked)
  }
  // lib/lab への依存が無い（2026-10-25・reviewer C2。以前は lib/lab/critique/ の内容を sha256 で固定していたが、依存を外したので要らない）
  const NO_LAB = [...HABIT_LIB, ...HABIT_COMP, 'scripts/check-review-habits.ts']
  const IMPORT_RE = /^\s*(?:import|export)\b[^\n]*?\bfrom\s*['"][^'"]+['"]|^\s*import\s*['"][^'"]+['"]|\brequire\(\s*['"][^'"]+['"]\s*\)|\bimport\(\s*['"][^'"]+['"]\s*\)/gm
  for (const f of NO_LAB) {
    const bad = (read(f).match(IMPORT_RE) ?? []).filter(x => x.includes('lib/lab'))
    check(`${f} が lib/lab を import しない`, bad.length === 0, bad.join(' / '))
  }
  check('部品は components/habits/ にあり、components/review/ に Habit*.tsx を作っていない', HABIT_COMP.includes('components/habits/HabitSummary.tsx') && !walk('components/review').some(f => /Habit/.test(f)))
}

console.log('■ (10) 語の固定')
{
  const src = read('lib/review/habits/text.ts')
  const EXACT = [
    '書いたことと、したことのまとめ',
    'このまとめは、あなたが書いた文と、あなたの売買の記録の2つを、決まった規則で照らし合わせて並べたものです。判断の良し悪しや、これからの売買、どの銘柄がよいかは示しません。',
    'このまとめは、あなたが書いた文、あなたの売買の記録、公表されている株価（日足の終値）の3つを、決まった規則で照らし合わせて並べたものです。判断の良し悪しや、これからの売買、どの銘柄がよいかは示しません。',
    '数えているのは、決まった語と数字の規則で見つけられるものだけです。当てはまらなかったことは、判断が正しかったことを意味しません。',
    '記録が5件に満たないため、件数だけを並べています。',
  ]
  for (const e of EXACT) check(`text.ts に一字一句「${e.slice(0, 24)}…」`, src.includes(`'${e}'`) || src.includes(`\`${e}\``))
  check('定数も同じ文（HABITS_HEADING・DISCLAIMER_A・DISCLAIMER_A_WITH_PRICES・DISCLAIMER_B・DISCLAIMER_D）',
    TEXT.HABITS_HEADING === EXACT[0] && TEXT.DISCLAIMER_A === EXACT[1] && TEXT.DISCLAIMER_A_WITH_PRICES === EXACT[2] && TEXT.DISCLAIMER_B === EXACT[3] && TEXT.DISCLAIMER_D === EXACT[4])
  check('(d) の「5件」は lib/review/patterns.ts の MIN_RECORDS と同じ（値を写さず import して比べる）', MIN_RECORDS === 5 && TEXT.DISCLAIMER_D.includes(`${MIN_RECORDS}件`))
  check('S-H1 の画面は株価を使わない版の (a) を出す（3つの版は出さない）', !HTML['5件以上'].includes(TEXT.DISCLAIMER_A_WITH_PRICES))
  const design = read('DESIGN.md')
  check('DESIGN.md §6-20 に部品の仕様がある', design.includes('### 6-20. 書いたことと、したことのまとめ') && design.includes('components/habits/HabitSummary.tsx'))
}

console.log('')
console.log(`PASS ${passed} 件 / FAIL ${failed} 件`)
if (failed) process.exit(1)
console.log('すべてPASS')
