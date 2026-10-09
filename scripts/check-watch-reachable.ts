// /watch（AIの判断）の到達性の検査。**二択の規則**（S1「3段の道」2026-09-29 新設・2026-10-09 に二択へ書き換え・同日レビュー W2〜W6・S1 で強化）。
//   $env:PATH = "C:\Program Files\nodejs;$env:PATH"; npx tsx scripts/check-watch-reachable.ts
//
// 規則は lib/features.ts の SHOW_AI_WATCH に連動する二択。期待値をベタ書きせず同じ定数から導くので、定数を true に戻せば検査も一緒に戻る:
//   true  … 公開。未ログインで読め、noindex にせず sitemap に残し、フッターの常設リンクをログイン状態・流入元で出し分けない
//           （監督指針 VII-3-1(2)②イ「随時に利用可能」の外形。DECISIONS.md 2026-09-29）
//   false … 全面非表示。画面は 404、入口（4ファイル）は全部閉じ、sitemap から外し、画面専用の読み出し口（API 4本）も 404。
//           中身 app/watch/client.tsx は残す（戻せる）（2026-10-09 オーナー指示「いったん全面的に隠す」）
//   その中間＝「ログインした人にだけ見せる」は**どちらの規則でも FAIL**。理由は監督指針 VII-3-1(2)② の原文（MC 2026-10-07 取得・確認）:
//     「会員登録等を行わないと投資情報等を購入・利用できない（単発での購入・利用を受け付けない）ような場合には
//       登録が必要となることに十分に留意するものとする。」
//   誰でも読めるのはよく、投資情報を一切出さないのもよい。ログインした人にだけ投資情報を出す形が一番危ない。
//
// 見るもの:
//  [共通]
//   A. lib/features.ts が SHOW_AI_WATCH（boolean）を export している
//   B. app/layout.tsx 全体に cookies(・headers(・session・user が無い（フッターを条件で包めない）
//   C.【最重要】/watch へのリンク（4ファイル）の分岐〜リンクの間と app/watch/page.tsx 全体に、ログイン・利用者ごとの出し分けに使う語
//      （session|user|cookie|header|auth|sign|logged|login|token|account|viewer|supabase。大文字小文字を無視した部分一致）が無い。
//      唯一の許可: app/watch/page.tsx の import 名 AISessionClient（画面部品の名前であって、ログイン状態の判定ではない。
//      レビュー W3 の指示どおり誤検知として報告済み・2026-10-09）
//   D. components/SiteNav.tsx の NAV に /watch が無い（段に置かない）・app/watch/page.tsx と client.tsx が存在する
//   E. 画面専用の読み出し口 5本（GET /api/ai-session・/api/ai-session/latest・/api/ai-session/[id]・/api/markets・
//      /api/ai-session/[id]/chart/[symbol]）は同じ定数で 404 にする仕掛け（GET の先頭で if (!SHOW_AI_WATCH) return … 404）を持つ。
//      AI 自身が売買を進める /[id]/tick と、トップの見本が使う /api/entry/examples・保管庫 /api/ai-decisions は定数を読まない
//      （隠している間も記録を溜め続ける＝戻すときに空白ができない）。/[id] の PATCH（自動運転の ON/OFF）も定数を読まない
//   F. app/not-found.tsx がある（/watch に来た人に日本語の 404 を出す。text-h1 text-ink・/ と /trade への文字リンク・主ボタン無し）
//  [SHOW_AI_WATCH === true: 公開]（S1 の7項目そのまま。許す分岐は `{SHOW_AI_WATCH && (` の1つだけ）
//   1. app/layout.tsx の <footer> 内に href="/watch" がちょうど1本、その行までに &&・? (・session・user・cookies・headers が無い
//   2. リンクの文言に「ログイン不要」
//   3. リポジトリ直下に middleware.ts / proxy.ts（Next 16 での改名）が無い。あっても matcher が /watch に当たらない
//   4. app/watch/page.tsx に noindex / index: false が無い（notFound() は !SHOW_AI_WATCH の枝にだけ）
//   5. app/sitemap.ts を実際に呼んで /watch が含まれる
//   6. app/watch/client.tsx の「読むのはログインなしで自由にできます」が if (!session) の枝の外・PageHeader の中・3経路すべて
//   7. （D と同じ）
//  [SHOW_AI_WATCH === false: 全面非表示]
//   1. app/watch/page.tsx に notFound() があり、SHOW_AI_WATCH で分岐している
//   2. 4ファイル（app/layout.tsx・app/(night)/page.tsx・app/review/page.tsx・app/review/[recordId]/page.tsx）に、
//      `{SHOW_AI_WATCH && (` の分岐の**外**にある /watch へのリンクが1本も無い（分岐の内側に残っているのは戻すため）。
//      「内側」は分岐の { から1文字ずつ深さを数え、リンクに届く前に深さが 0 になったら「外」（レビュー W2。{ } の総数の比較ではない）
//   3. app/sitemap.ts を実際に呼んで /watch が無い。源（PUBLIC_PATHS）も同じ定数で分岐している
//   4. app/watch/client.tsx が残っている（消していない＝戻せる）。隠した時点の blob hash（HIDDEN_CLIENT_BLOB）と、HEAD の版・
//      作業ツリーの版の両方が一致（コミットを跨いでも無改修を守る＝レビュー S1。true に戻したら改修してよいので、この枝でだけ見る）
//
// 実ネットワーク不要。ファイルを読むだけ（sitemap だけは関数を実際に呼ぶ。4 は git を呼ぶ）。

import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { SHOW_AI_WATCH } from '../lib/features'
import sitemap from '../app/sitemap'

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
/** 注釈を落とす（注釈に「session で出し分けない」と書いてあるのを誤検知しないため）。文字列の中の // は残す（check-entry.ts と同じ） */
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
const count = (s: string, needle: string) => s.split(needle).length - 1
/** `from` 以降で最初の `to` までを切り出す（無ければ空） */
function between(s: string, from: string, to: string): string {
  const i = s.indexOf(from)
  if (i < 0) return ''
  const j = s.indexOf(to, i + from.length)
  return j < 0 ? '' : s.slice(i, j + to.length)
}
const lineOf = (src: string, at: number) => src.slice(0, at).split('\n').length

/** /watch へのリンクを置いてよい4ファイル（入口）。ここ以外に /watch へのリンクを作らない */
const ENTRY_FILES = ['app/layout.tsx', 'app/(night)/page.tsx', 'app/review/page.tsx', 'app/review/[recordId]/page.tsx'] as const
/** 許された唯一の分岐の形。定数での出し分けはログイン状態での出し分けではない */
const GATE_OPEN = '{SHOW_AI_WATCH && ('
/** ログイン状態・利用者ごとの出し分けに使われる語（分岐の条件〜リンクの間、または app/watch/page.tsx にあれば FAIL）。
 *  大文字小文字を無視した部分一致（isSignedIn・userId・useSession()・getUser()・loggedIn・currentUser も拾う＝レビュー W3） */
const LOGIN_WORDS = /session|user|cookie|header|auth|sign|logged|login|token|account|viewer|supabase/i
/** C の唯一の許可。画面部品の名前であって、ログイン状態の判定ではない（レビュー W3 の指示で報告済み・許可） */
const ALLOWED_IDENTIFIERS = ['AISessionClient']
const HREF_WATCH = /href=\{?["'`]\/watch\b/g
/** 画面専用の読み出し口（GET が SHOW_AI_WATCH=false なら 404） */
const GATED_ROUTES = ['app/api/ai-session/route.ts', 'app/api/ai-session/latest/route.ts', 'app/api/ai-session/[id]/route.ts', 'app/api/markets/route.ts', 'app/api/ai-session/[id]/chart/[symbol]/route.ts'] as const
/** 表示ではない口（定数を読まない。隠している間も動く） */
const UNGATED_ROUTES = ['app/api/ai-session/[id]/tick/route.ts', 'app/api/entry/examples/route.ts', 'app/api/ai-decisions/route.ts'] as const
/** 隠した時点（2026-10-09）の app/watch/client.tsx の blob hash（git hash-object app/watch/client.tsx）。false の枝でだけ比べる */
const HIDDEN_CLIENT_BLOB = '392d02c1ce9056b2d77f0fe4f792f814a9df01fe'

type WatchLink = { at: number; gated: boolean; gateSeg: string }
/** ファイル中の /watch へのリンクを全部拾い、各々が `{SHOW_AI_WATCH && (` の内側にあるかを返す。
 *  内側の判定（レビュー W2）: 直前の分岐の { から1文字ずつ、深さ 1 で始めて { で +1・} で −1。リンクに届く前に 0 に達したら
 *  その分岐はそこで閉じている＝リンクは外（閉じた分岐の直後に別の分岐 {isPro && ( があっても誤って内側にしない） */
function watchLinks(src: string): WatchLink[] {
  const out: WatchLink[] = []
  for (const m of src.matchAll(HREF_WATCH)) {
    const at = m.index ?? 0
    const g = src.lastIndexOf(GATE_OPEN, at)
    if (g < 0) { out.push({ at, gated: false, gateSeg: '' }); continue }
    let depth = 1
    let closed = false
    for (let i = g + 1; i < at; i++) {
      const c = src[i]
      if (c === '{') depth++
      else if (c === '}' && --depth === 0) { closed = true; break }
    }
    out.push(closed ? { at, gated: false, gateSeg: '' } : { at, gated: true, gateSeg: src.slice(g + 1, at) })
  }
  return out
}
function gitOut(args: string[]): string {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : `(git ${args[0]} 失敗: ${r.error ? String(r.error) : (r.stderr ?? '').trim()})`
}

console.log(`SHOW_AI_WATCH = ${SHOW_AI_WATCH} → ${SHOW_AI_WATCH ? '「公開」' : '「全面非表示」'}の規則で見る（lib/features.ts）`)

// ── 共通 ───────────────────────────────────────────────
console.log('■ 共通: 二択の線（ログイン状態で出し分けない）')
const features = stripComments(read('lib/features.ts'))
check('A. lib/features.ts: SHOW_AI_WATCH を export している（boolean）', /export const SHOW_AI_WATCH: boolean = (?:true|false)/.test(features) && typeof SHOW_AI_WATCH === 'boolean')

const layoutRaw = read('app/layout.tsx')
const layout = stripComments(layoutRaw)
// <footer> の内側だけ見ると、<footer> ごと条件で包む形や、上のほうで cookies() を変数に受けてから使う形をすり抜ける（S1 レビュー W4）
const LAYOUT_GATES = ['cookies(', 'headers(', 'session', 'user']
const layoutGateHits = LAYOUT_GATES.filter(g => layout.includes(g))
check('B. app/layout.tsx 全体に cookies(・headers(・session・user が無い（フッターを条件で包めない）', layoutGateHits.length === 0, layoutGateHits.join(', ') || '無し')

// C. 4ファイルの /watch へのリンクについて、分岐の条件〜リンクまでの間にログインの語が無い。app/watch/page.tsx 全体にも無い
const loginHits: string[] = []
for (const f of ENTRY_FILES) {
  const src = stripComments(read(f))
  for (const l of watchLinks(src)) {
    // 分岐の外にあるリンクは「条件が無い」ので C では見ない（false のときは 2 で落ちる）。内側なら条件〜リンクの間を見る
    const m = l.gated ? LOGIN_WORDS.exec(l.gateSeg) : null
    if (m) loginHits.push(`${f}:${lineOf(src, l.at)} に「${m[0]}」`)
  }
}
{
  let watchPageSrc = stripComments(read('app/watch/page.tsx'))
  for (const id of ALLOWED_IDENTIFIERS) watchPageSrc = watchPageSrc.split(id).join('')
  const pageHit = LOGIN_WORDS.exec(watchPageSrc)
  if (pageHit) loginHits.push(`app/watch/page.tsx:${lineOf(watchPageSrc, pageHit.index)} に「${pageHit[0]}」`)
}
check('C.【最重要】/watch へのリンクの分岐と app/watch/page.tsx に session・user・cookie・header・auth・sign・logged・login・token・account・viewer・supabase が無い（ログイン状態で出し分けていない。許可は AISessionClient だけ）',
  loginHits.length === 0,
  `${loginHits.join(' / ')}。公開か全面非表示かの二択。ログイン必須にしない（監督指針 VII-3-1(2)②「会員登録等を行わないと投資情報等を購入・利用できない…場合には登録が必要」）`)

const nav = stripComments(read('components/SiteNav.tsx'))
const navBody = nav.slice(nav.indexOf('export const NAV = ['), nav.indexOf('] as const'))
check('D. components/SiteNav.tsx の NAV に /watch が無い（段に置かない）・app/watch/page.tsx と client.tsx が存在する',
  navBody.length > 0 && !navBody.includes("'/watch'") && exists('app/watch/page.tsx') && exists('app/watch/client.tsx'), navBody.replace(/\s+/g, ' ').slice(0, 200))

{
  // E. 画面専用の読み出し口は GET の先頭で同じ定数を見て 404。表示ではない口は定数を読まない
  const GATE_LINE = /export async function GET\([^)]*\)\s*\{\s*if \(!SHOW_AI_WATCH\) return NextResponse\.json\([^\n]*status: 404[^\n]*'Cache-Control': 'no-store'/
  const bad: string[] = []
  for (const f of GATED_ROUTES) {
    if (!exists(f)) { bad.push(`${f}: 無い`); continue }
    const src = stripComments(read(f))
    if (!src.includes("from '@/lib/features'")) bad.push(`${f}: @/lib/features を import していない`)
    if (!GATE_LINE.test(src)) bad.push(`${f}: GET の先頭に if (!SHOW_AI_WATCH) return …404・no-store が無い`)
  }
  for (const f of UNGATED_ROUTES) {
    if (!exists(f)) { bad.push(`${f}: 無い`); continue }
    if (stripComments(read(f)).includes('SHOW_AI_WATCH')) bad.push(`${f}: SHOW_AI_WATCH を読んでいる（AI の売買・トップの見本・保管庫は隠している間も動かす）`)
  }
  // /[id] は GET（読み出し）だけ閉じ、PATCH（自動運転の ON/OFF・運営者のみ・client.tsx が使う口）は定数を読まない
  {
    const idRoute = stripComments(read('app/api/ai-session/[id]/route.ts'))
    const patchAt = idRoute.indexOf('export async function PATCH(')
    const patchBody = patchAt < 0 ? '' : idRoute.slice(patchAt)
    if (patchAt < 0) bad.push('app/api/ai-session/[id]/route.ts: PATCH が無い')
    else if (patchBody.includes('SHOW_AI_WATCH')) bad.push('app/api/ai-session/[id]/route.ts: PATCH が SHOW_AI_WATCH を読んでいる（閉じるのは GET だけ）')
    if (count(idRoute, 'SHOW_AI_WATCH') !== 2) bad.push(`app/api/ai-session/[id]/route.ts: SHOW_AI_WATCH の出現は import と GET の分岐の2回のはず（実際 ${count(idRoute, 'SHOW_AI_WATCH')} 回）`)
  }
  check('E. 画面専用の読み出し口 5本（/api/ai-session・/latest・/[id]・/api/markets・/[id]/chart/[symbol]）は GET の先頭で SHOW_AI_WATCH を見て 404・no-store。/[id]/tick・/api/entry/examples・/api/ai-decisions と /[id] の PATCH は定数を読まない',
    bad.length === 0, bad.join(' / '))
}

{
  // F. 日本語の 404 ページ（レビュー W6）
  const nf = exists('app/not-found.tsx') ? stripComments(read('app/not-found.tsx')) : ''
  check('F. app/not-found.tsx がある: 日本語1文・<h1 は text-h1 text-ink・/ と /trade への文字リンク（text-brand）・主ボタン（bg-brand）無し・英語の既定文が無い',
    nf.length > 0 && nf.includes('このページは見つかりませんでした。') && /<h1 className="text-h1 text-ink">/.test(nf)
    && /<Link href="\/" className="[^"]*text-brand[^"]*">/.test(nf) && /<Link href="\/trade" className="[^"]*text-brand[^"]*">/.test(nf)
    && !nf.includes('bg-brand') && !nf.includes('could not be found'),
    nf.length === 0 ? '無い' : nf.replace(/\s+/g, ' ').slice(0, 200))
}

const watchPage = stripComments(read('app/watch/page.tsx'))
const sitemapHasWatch = sitemap().some(e => e.url.endsWith('/watch'))

if (SHOW_AI_WATCH) {
  // ── 公開 ─────────────────────────────────────────────
  console.log('■ 公開: app/layout.tsx のフッター（常設・無条件）')
  const footer = between(layout, '<footer', '</footer>')
  const watchAt = footer.indexOf('href="/watch"')
  // 許された分岐 `{SHOW_AI_WATCH && (` だけを落としてから、出し分けの語を探す
  const beforeLink = (watchAt < 0 ? '' : footer.slice(0, watchAt)).split(GATE_OPEN).join('')
  const GATES = ['&&', '? (', 'session', 'user', 'cookies', 'headers']
  const gateHits = GATES.filter(g => beforeLink.includes(g))
  check('1. <footer> 内に href="/watch" がちょうど1本、その行までに &&・? (・session・user・cookies・headers が無い（SHOW_AI_WATCH && 以外の分岐が無い）',
    footer.length > 0 && count(footer, 'href="/watch"') === 1 && watchAt > -1 && gateHits.length === 0,
    footer.length === 0 ? '<footer> が無い' : `href="/watch" ×${count(footer, 'href="/watch"')}／分岐の語: ${gateHits.join(', ') || '無し'}`)
  const linkText = between(footer, 'href="/watch"', '</Link>')
  check('2. リンクの文言に「ログイン不要」が含まれる', linkText.includes('ログイン不要'), linkText.replace(/\s+/g, ' ').slice(0, 120))

  console.log('■ 公開: 経路を遮るものが無い（middleware / proxy・noindex・sitemap）')
  // Next 16 は middleware.ts を proxy.ts に改名した（node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md）。両方見る
  const gateFiles = ['middleware.ts', 'proxy.ts', 'src/middleware.ts', 'src/proxy.ts'].filter(exists)
  const matcherHitsWatch = gateFiles.some(f => {
    const src = stripComments(read(f))
    const matcher = between(src, 'matcher', ']')
    return /\/watch/.test(matcher) || /['"]\/:path\*['"]|['"]\/\(\.\*\)['"]/.test(matcher)
  })
  check('3. リポジトリ直下に middleware.ts / proxy.ts が無い（あっても matcher が /watch に当たらない）', gateFiles.length === 0 || !matcherHitsWatch, gateFiles.join(', ') || '無し')
  check('4. app/watch/page.tsx に noindex / index: false が無い・notFound() は if (!SHOW_AI_WATCH) の枝にだけ',
    !/noindex|index:\s*false/.test(watchPage) && count(watchPage, 'notFound(') === 1 && /if \(!SHOW_AI_WATCH\) notFound\(\)/.test(watchPage))
  check('5. app/sitemap.ts を呼ぶと /watch が含まれる', sitemapHasWatch, sitemap().map(e => e.url).join(', '))

  console.log('■ 公開: app/watch/client.tsx の文言（記録があっても出る）')
  const client = stripComments(read('app/watch/client.tsx'))
  const SENTENCE = '読むのはログインなしで自由にできます'
  const noSessionAt = client.indexOf('if (!session) return (')
  const noSessionEnd = noSessionAt < 0 ? -1 : client.indexOf('\n  )\n', noSessionAt)
  const noSessionBranch = noSessionAt < 0 || noSessionEnd < 0 ? '' : client.slice(noSessionAt, noSessionEnd)
  check(`6. 「${SENTENCE}」が残り、かつ if (!session) の枝の内側に無い（記録がある本番でも表示される）`,
    client.includes(SENTENCE) && noSessionAt > -1 && noSessionEnd > -1 && !noSessionBranch.includes(SENTENCE),
    `sentence=${client.includes(SENTENCE)} branch=[${noSessionAt},${noSessionEnd}] inBranch=${noSessionBranch.includes(SENTENCE)}`)
  const headerAt = client.indexOf('function PageHeader(')
  const headerEnd = headerAt < 0 ? -1 : client.indexOf('\n}\n', headerAt)
  const headerBody = headerAt < 0 || headerEnd < 0 ? '' : client.slice(headerAt, headerEnd)
  const headerUses = count(client, '<PageHeader')
  check('6b. 文は PageHeader の中にあり、PageHeader は3経路（復元中・記録なし・記録あり）すべてで描かれる',
    headerBody.includes(SENTENCE) && headerUses === 3, `inPageHeader=${headerBody.includes(SENTENCE)} <PageHeader ×${headerUses}`)
  check('7. ナビの段に置かない・ページは存在する（共通 D と同じ）', navBody.length > 0 && !navBody.includes("'/watch'") && exists('app/watch/page.tsx'))
} else {
  // ── 全面非表示 ─────────────────────────────────────────
  console.log('■ 全面非表示: 画面は 404・入口は全部閉じる・sitemap から外す・中身は無改修で残す')
  check('1. app/watch/page.tsx に notFound() があり、SHOW_AI_WATCH で分岐している（if (!SHOW_AI_WATCH) notFound()・next/navigation から import）',
    /if \(!SHOW_AI_WATCH\) notFound\(\)/.test(watchPage) && watchPage.includes("from 'next/navigation'") && watchPage.includes("from '@/lib/features'"))
  {
    const outside: string[] = []
    const inside: string[] = []
    for (const f of ENTRY_FILES) {
      const src = stripComments(read(f))
      const links = watchLinks(src)
      for (const l of links) (l.gated ? inside : outside).push(`${f}:${lineOf(src, l.at)}`)
      if (links.length > 0 && !src.includes("from '@/lib/features'")) outside.push(`${f}: SHOW_AI_WATCH を @/lib/features から import していない`)
    }
    check('2. 4ファイルに、{SHOW_AI_WATCH && ( の分岐の外にある /watch へのリンクが1本も無い（内側に残っているのは戻すため。深さを数えて判定）',
      outside.length === 0, `分岐の外: ${outside.join(' / ')}`)
    console.log(`     分岐の内側に残っているリンク（戻せる）: ${inside.join(' / ') || '無し'}`)
  }
  const sitemapSrc = stripComments(read('app/sitemap.ts'))
  const publicPathsLine = between(sitemapSrc, 'const PUBLIC_PATHS', '\n')
  check('3. app/sitemap.ts を呼ぶと /watch が無い。源の PUBLIC_PATHS は SHOW_AI_WATCH で分岐している（定数を true に戻せば載る）',
    !sitemapHasWatch && publicPathsLine.includes('SHOW_AI_WATCH') && sitemapSrc.includes("from '@/lib/features'"),
    `${sitemap().map(e => e.url).join(', ')}／${publicPathsLine.trim()}`)
  const headBlob = gitOut(['rev-parse', 'HEAD:app/watch/client.tsx'])
  const treeBlob = gitOut(['hash-object', 'app/watch/client.tsx'])
  check(`4. app/watch/client.tsx が残っている（消していない＝戻せる）・隠した時点の blob ${HIDDEN_CLIENT_BLOB.slice(0, 12)}… と HEAD の版・作業ツリーの版が一致（コミットを跨いでも無改修）`,
    exists('app/watch/client.tsx') && headBlob === HIDDEN_CLIENT_BLOB && treeBlob === HIDDEN_CLIENT_BLOB,
    `HEAD=${headBlob} 作業ツリー=${treeBlob}`)
}

console.log('')
console.log(`PASS ${passed} 件 / FAIL ${failed} 件`)
if (failed) process.exit(1)
console.log('すべてPASS')
