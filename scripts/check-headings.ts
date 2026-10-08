// 見出しの階層の検査（DECISIONS 2026-10-05「見出しは --text-h2 に統一し、注記は1か所も弱めない」・DESIGN.md §5-2「見出しの階層」）。
//   $env:PATH = "C:\Program Files\nodejs;$env:PATH"; npx tsx scripts/check-headings.ts
//
// 見るもの（番号は designer の案のまま）:
//  1. 規則を当てた画面（APPLIED）の <h2 は class が text-h2 text-ink で始まる。text-small／text-caption／text-muted を含まない
//  2. <h1 は text-h1 text-ink（トップのヒーローだけ text-display）。1つの画面の状態（return ( … ) のまとまり）に1つまで
//  3. font-bold／font-extrabold が 0 件。見出し（<h1〜<h3）の class に素の Tailwind のサイズ（text-2xl／text-xl／text-lg／text-base／text-sm／text-xs）が無い
//  4. 法務が要求する注記の下限を守る（＝弱めていない）: Disclaimer.tsx は text-small text-ink-2 固定（caption／muted を含まない）。
//     DISTRIBUTION_NOTE・基準率の各項目の直下の行・PriceSincePanel の figcaption・PrimarySources の「取得 …・リンク先は当社と関係がありません。」は
//     text-caption text-muted のまま（12px・--muted が下限）。バッジ・フッター・/watch の免責・WrittenCard の hint と記入日時も据え置き
//  5. 畳まない・薄めない: app/review/**・components/review/**・Disclaimer.tsx に <details が無い。注記の開きタグに opacity-／aria-hidden が無い。
//     12px 未満の文字（text-[10px] 等）を作らない
//  6. 段ラベル（01 書く／02 くらべる／03 読み返す／AIの判断）が <h1／<h2 の中身そのものにならない（caption/--muted の <p> で置く）
//  7. 記録の整合: DESIGN.md §5-2 に「見出しの階層」の表・§6-6 に上書きの注記。check-review.ts が文字長で位置を決めていない
//
// まだ規則を当てていない画面（app/learn・app/simulate・app/stocks・components/analyze の中 等）は「情報:」として件数を出すだけで FAIL にしない
// （別のスライスで当てる。当てたら APPLIED に足す）。実ネットワーク不要。

import fs from 'fs'
import path from 'path'

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
/** 注釈を落とす（注釈に書いた「text-small text-muted に戻さない」等を誤検知しないため）。文字列の中は残す */
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
    else if (/\.tsx$/.test(e.name)) out.push(r)
  }
  return out
}
const count = (s: string, needle: string | RegExp) =>
  typeof needle === 'string' ? s.split(needle).length - 1 : (s.match(new RegExp(needle.source, needle.flags.includes('g') ? needle.flags : `${needle.flags}g`)) ?? []).length

/** 見出しタグ（<h1 … > … </h1>）を全部拾う。className は "…" か {`…`} のどちらか */
type Heading = { level: 1 | 2 | 3; tag: string; className: string | null; inner: string; index: number }
function headings(src: string): Heading[] {
  const out: Heading[] = []
  const re = /<h([123])(\s[^>]*)?>([\s\S]*?)<\/h\1>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const attrs = m[2] ?? ''
    const cls = /className=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(attrs)
    out.push({ level: Number(m[1]) as 1 | 2 | 3, tag: `<h${m[1]}${attrs}>`, className: cls ? (cls[1] ?? cls[2]) : null, inner: m[3], index: m.index })
  }
  return out
}
/** 文字列 needle を含む要素の開きタグ（直前の <p／<figcaption／<span）を返す */
function openingTagBefore(src: string, needle: string): string | null {
  const i = src.indexOf(needle)
  if (i < 0) return null
  const head = src.slice(0, i)
  const start = Math.max(head.lastIndexOf('<p'), head.lastIndexOf('<figcaption'), head.lastIndexOf('<span'))
  if (start < 0) return null
  const end = src.indexOf('>', start)
  return end < 0 ? null : src.slice(start, end + 1)
}
const innerText = (s: string) => s.replace(/<[^>]+>/g, '').replace(/\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim()

// ── 規則を当てた画面（当てたら足す） ──────────────────────────────────────────
const APPLIED = [
  'app/(night)/page.tsx',
  'app/trade/page.tsx',
  'app/review/page.tsx',
  'app/review/[recordId]/page.tsx',
  'app/review/backfill/page.tsx',
  'app/watch/client.tsx',
  'components/review/PrimarySources.tsx',
  'components/review/PriceSincePanel.tsx',
  'components/review/PremiseChain.tsx',
  'components/review/PlanVsActualBars.tsx',
  'components/ui/Disclaimer.tsx',
  'components/analyze/AnalyzeBanner.tsx',
  'components/MasterSignals.tsx',
  'components/InvestorPanel.tsx',
]
const HERO = 'app/(night)/page.tsx'
const STAGE_LABELS = ['01 書く', '02 くらべる', '03 読み返す', 'AIの判断']
const RAW_SIZE = /(?:^|\s)text-(?:2xl|xl|lg|base|sm|xs)(?:\s|$)/

console.log('■ 0. 対象')
for (const f of APPLIED) check(`${f} がある`, exists(f))
const applied = APPLIED.filter(exists).map(f => [f, stripComments(read(f))] as const)

console.log('■ 1. <h2 は text-h2 text-ink で始まる（small／caption／muted を含まない）')
for (const [f, src] of applied) {
  const h2s = headings(src).filter(h => h.level === 2)
  if (h2s.length === 0) continue
  const bad = h2s.filter(h => !h.className || !h.className.startsWith('text-h2 text-ink') || /text-small|text-caption|text-muted/.test(h.className))
  check(`${f}: h2 ${h2s.length}件すべて text-h2 text-ink`, bad.length === 0, bad.map(h => h.tag).join(' / '))
}

console.log('■ 2. <h1 は text-h1 text-ink（トップのヒーローだけ text-display）・1つの画面の状態に1つまで')
for (const [f, src] of applied) {
  const h1s = headings(src).filter(h => h.level === 1)
  if (h1s.length === 0) continue
  const want = f === HERO ? 'text-display text-ink' : 'text-h1 text-ink'
  const bad = h1s.filter(h => !h.className || !h.className.startsWith(want) || /font-bold|text-small|text-caption|text-muted/.test(h.className))
  check(`${f}: h1 ${h1s.length}件すべて ${want}`, bad.length === 0, bad.map(h => h.tag).join(' / '))
  // 1つの return ( … ) のまとまり（＝画面の1つの状態）に h1 は1つまで。未ログイン／読み込み中の分岐は同時には出ない
  const chunks = src.split(/\breturn \(/).slice(1)
  const over = chunks.map(c => count(c, '<h1')).filter(n => n > 1)
  check(`${f}: 1つの画面の状態に h1 は1つまで`, over.length === 0 && chunks.reduce((s, c) => s + count(c, '<h1'), 0) === h1s.length, `複数の h1 を持つまとまり ${over.length}`)
}

console.log('■ 3. font-bold／font-extrabold が 0 件・見出しに素の Tailwind のサイズを書かない')
for (const [f, src] of applied) {
  check(`${f}: font-bold／font-extrabold が無い（太さは 400／600／900 の3つだけ）`, !/font-bold|font-extrabold/.test(src))
  const hs = headings(src)
  if (hs.length === 0) continue
  const raw = hs.filter(h => h.className && RAW_SIZE.test(h.className))
  check(`${f}: 見出し（h1〜h3）${hs.length}件に text-2xl／text-xl／text-lg／text-base／text-sm／text-xs が無い`, raw.length === 0, raw.map(h => h.tag).join(' / '))
}

console.log('■ 4. 法務が要求する注記の下限（＝弱めていない）')
{
  const disc = stripComments(read('components/ui/Disclaimer.tsx'))
  check('Disclaimer.tsx: text-small text-ink-2 固定（text-caption／text-muted を含まない）', disc.includes('text-small text-ink-2') && !/text-caption|text-muted/.test(disc))
  check('Disclaimer.tsx: opacity／aria-hidden／<details が無い', !/opacity-|aria-hidden|<details/.test(disc))

  const rec = stripComments(read('app/review/[recordId]/page.tsx'))
  check('[recordId]: DISTRIBUTION_NOTE は text-caption text-muted のまま', rec.includes('<p className="text-caption text-muted">{DISTRIBUTION_NOTE}</p>'))
  check('[recordId]: 基準率の各項目の直下の行（対象期間／日足 N本／Yahoo Finance／取得 …）は text-caption text-muted tabular-nums のまま',
    /<p className="text-caption text-muted tabular-nums">\s*対象期間 \{r\.window\.from\}〜\{r\.window\.to\}／日足 \{r\.window\.bars\.toLocaleString\(\)\}本／\{PRICE_SOURCE\}／\{fetched\}/.test(rec))
  check('[recordId]: バッジ「このサイトは良し悪しを判定しません」は text-caption text-ink のまま', /<span className="[^"]*text-caption text-ink">\{BADGE\}<\/span>/.test(rec))
  check('[recordId]: フッターの固定文は text-small text-ink-2 のまま', rec.includes('<p className="text-small text-ink-2 max-w-[42rem]">{FOOTER}</p>'))
  check('[recordId]: WrittenCard の hint と記入日時は text-caption text-muted のまま', rec.includes('<p className="text-caption text-muted">{hint}</p>') && /<p className="text-caption text-muted tabular-nums">\s*\{source === 'past'/.test(rec))

  const panel = stripComments(read('components/review/PriceSincePanel.tsx'))
  check('PriceSincePanel: figcaption（図の出所「Yahoo Finance・M/D HH:mm 時点」）は text-caption text-muted のまま', panel.includes('<figcaption className="text-caption text-muted tabular-nums">{asOf}</figcaption>'))

  const ps = stripComments(read('components/review/PrimarySources.tsx'))
  check('PrimarySources: 「取得 YYYY-MM-DD・リンク先は当社と関係がありません。」は text-caption text-muted のまま（1つの <p>）',
    /<p className="text-caption text-muted tabular-nums">\s*取得 \{isoDate\(result\.fetchedAt\)\}<span aria-hidden>・<\/span>\{NOT_AFFILIATED\}\s*<\/p>/.test(ps))
  check('PrimarySources: リードの文は text-small text-ink-2 のまま', ps.includes('<p className="text-small text-ink-2 max-w-[42rem]">{SECTION_LEAD}</p>'))

  const watch = stripComments(read('app/watch/client.tsx'))
  check('/watch: 判断の免責（「ここにあるのは、AIが仮想資金で行った売買判断の記録です」）は text-small text-ink-2 のまま',
    /<p className="text-small text-ink-2 max-w-\[42rem\]">\s*ここにあるのは、AIが仮想資金で行った売買判断の記録です/.test(watch))
  check('/watch: 「分析を動かせるのは運営者だけです。読むのはログインなしで自由にできます。」が残る', watch.includes('分析を動かせるのは運営者だけです。読むのはログインなしで自由にできます。'))
}

console.log('■ 5. 畳まない・薄めない（app/review/**・components/review/**・Disclaimer.tsx）')
{
  const files = [...walk('app/review'), ...walk('components/review'), 'components/ui/Disclaimer.tsx']
  for (const f of files) {
    const src = stripComments(read(f))
    check(`${f}: <details が無い`, !src.includes('<details'))
    const tiny = (src.match(/text-\[(\d+(?:\.\d+)?)px\]/g) ?? []).filter(s => Number(/\d+(?:\.\d+)?/.exec(s)![0]) < 12)
    check(`${f}: 12px 未満の文字を作らない`, tiny.length === 0, tiny.join(' / '))
  }
  // 注記の開きタグに opacity-／aria-hidden が無い（装飾の区切り「・」の <span aria-hidden> は注記そのものではないので対象外）
  const notes: [string, string][] = [
    ['app/review/[recordId]/page.tsx', '{DISTRIBUTION_NOTE}'],
    ['app/review/[recordId]/page.tsx', '対象期間 {r.window.from}'],
    ['app/review/[recordId]/page.tsx', '{BADGE}'],
    ['app/review/[recordId]/page.tsx', '{FOOTER}'],
    ['components/review/PriceSincePanel.tsx', '{asOf}</figcaption>'],
    ['components/review/PrimarySources.tsx', '取得 {isoDate(result.fetchedAt)}'],
    ['components/review/PrimarySources.tsx', '{SECTION_LEAD}'],
    ['components/ui/Disclaimer.tsx', '{part !== \'investor\' ? DISCLAIMER_TEXT'],
    ['app/watch/client.tsx', 'ここにあるのは、AIが仮想資金で行った売買判断の記録です'],
  ]
  for (const [f, needle] of notes) {
    const tag = openingTagBefore(stripComments(read(f)), needle)
    check(`${f}: 「${needle.slice(0, 24)}」の開きタグに opacity-／aria-hidden が無い`, tag !== null && !/opacity-|aria-hidden/.test(tag), tag ?? '開きタグが見つからない')
  }
}

console.log('■ 6. 段ラベルは見出し要素にしない（caption/--muted の <p>）')
for (const [f, src] of applied) {
  const hs = headings(src).filter(h => h.level <= 2)
  const bad = hs.filter(h => STAGE_LABELS.includes(innerText(h.inner)))
  if (hs.length > 0) check(`${f}: 段ラベルそのものが h1／h2 になっていない`, bad.length === 0, bad.map(h => h.tag).join(' / '))
}
{
  // 段ラベルを caption に下げた画面（2026-10-05 のスライスの範囲）。components/analyze/AnalyzeBanner.tsx（/learn の「02 くらべる」）は
  // まだ small のまま＝未決（別のスライスで揃える。揃えたらここに足す）
  const OLD_LABEL = /<p className="text-small text-muted">(?:01 書く|02 くらべる|03 読み返す|AIの判断)<\/p>/g
  for (const f of ['app/trade/page.tsx', 'app/review/page.tsx', 'app/review/backfill/page.tsx', 'app/watch/client.tsx', 'app/review/[recordId]/page.tsx']) {
    const old = stripComments(read(f)).match(OLD_LABEL) ?? []
    check(`${f}: 段ラベルの旧形（<p className="text-small text-muted">）が無い`, old.length === 0, old.join(' / '))
  }
  const trade = stripComments(read('app/trade/page.tsx'))
  const review = stripComments(read('app/review/page.tsx'))
  const bf = stripComments(read('app/review/backfill/page.tsx'))
  const watch = stripComments(read('app/watch/client.tsx'))
  const rec = stripComments(read('app/review/[recordId]/page.tsx'))
  check('/trade: 「01 書く」は <p className="text-caption text-muted">', trade.includes('<p className="text-caption text-muted">01 書く</p>'))
  check('/review: 「03 読み返す」は <p className="text-caption text-muted">', review.includes('<p className="text-caption text-muted">03 読み返す</p>'))
  check('/review/backfill: 「03 読み返す」は <p className="text-caption text-muted">（2つの画面の状態とも）', count(bf, '<p className="text-caption text-muted">03 読み返す</p>') === 2)
  check('/watch: 「AIの判断」は <p className="text-caption text-muted">', watch.includes('<p className="text-caption text-muted">AIの判断</p>'))
  check('/review/[recordId]: パンくずは <p className="text-caption text-muted">', /<p className="text-caption text-muted">\s*<Link href="\/review"/.test(rec))
}

console.log('■ 7. 記録の整合（DESIGN.md・check-review.ts）')
{
  const design = read('DESIGN.md')
  check('DESIGN.md §5-2: 「見出しの階層」の表（段ラベル／h1／リード／h2／h3／箱の中の見出し）', design.includes('**見出しの階層**') && design.includes('| 段ラベル') && design.includes('| 節の見出し') && design.includes('`text-h2 text-ink`'))
  check('DESIGN.md §5-2: 注記は3段（法務が要求＝弱めない／説明の注記／ラベル）・下限 12px・--muted', design.includes('法務が要求する注記') && design.includes('下限は 12px'))
  check('DESIGN.md §6-6: 「見出しはカードの外に small/--muted」を 2026-10-05 の規則で上書きした注記', design.includes('2026-10-05') && design.includes('§5-2「見出しの階層」') && /見出しはカードの外[^\n]*text-h2/.test(design))
  const cr = read('scripts/check-review.ts')
  check('check-review.ts: 見出しの位置を文字長（.length）で決めていない', !cr.includes(`'<h2 className="text-small text-muted">'.length`) && cr.includes("page.lastIndexOf('<h2')"))
}

console.log('■ 情報: まだ規則を当てていない画面（FAIL にしない。当てたら APPLIED に足す）')
{
  const all = [...walk('app'), ...walk('components')].filter(f => !APPLIED.includes(f))
  let h2Bad = 0, h1Bad = 0, bold = 0
  const list: string[] = []
  for (const f of all) {
    const src = stripComments(read(f))
    const hs = headings(src)
    const b2 = hs.filter(h => h.level === 2 && (!h.className || !h.className.startsWith('text-h2 text-ink'))).length
    const b1 = hs.filter(h => h.level === 1 && (!h.className || !h.className.startsWith('text-h1 text-ink'))).length
    const fb = count(src, /font-bold|font-extrabold/)
    if (b2 || b1 || fb) list.push(`    ${f}: h2 ${b2}件・h1 ${b1}件・font-bold ${fb}件`)
    h2Bad += b2; h1Bad += b1; bold += fb
  }
  console.log(`  情報: 未適用 ${list.length} ファイル（h2 ${h2Bad}件・h1 ${h1Bad}件・font-bold ${bold}件）`)
  for (const l of list) console.log(l)
}

console.log('')
console.log(`PASS ${passed} 件 / FAIL ${failed} 件`)
if (failed) process.exit(1)
console.log('すべてPASS')
