// /watch（AIの判断）に「未ログインで・随時に」到達できる外形の検査（S1「3段の道」・2026-09-29 新設）。
//   $env:PATH = "C:\Program Files\nodejs;$env:PATH"; npx tsx scripts/check-watch-reachable.ts
//
// 正は DECISIONS.md 2026-09-29「4段階を3段（書く → くらべる → 読み返す）にし…」の不変条件:
//   /watch は未ログインで読める状態を維持し、noindex にせず sitemap に残し、フッターの常設リンクを
//   ログイン状態・流入元で出し分けない（監督指針 VII-3-1(2)②イ「随時に利用可能」の外形。機械検査を1本足す）。
// ナビの段（components/SiteNav.tsx の NAV）から /watch を外したぶん、到達の道が「無条件のフッターリンク」1本に
// 集約されるので、その1本が条件分岐の中に入っていないことを見る。
//
// 見るもの（7項目）:
//  1. app/layout.tsx の <footer> 内に href="/watch" が**ちょうど1本**あり、<footer> の先頭からその行までに
//     `&&`・`? (`・`session`・`user`・`cookies`・`headers` が無い（＝出し分けの分岐が無い。注釈は落として見る）
//  2. リンクの文言に「ログイン不要」が含まれる
//  3. リポジトリ直下に middleware.ts / proxy.ts（Next 16 での改名）が無い。あっても matcher が /watch に当たらない
//  4. app/watch/page.tsx に noindex / index: false が無い
//  5. app/sitemap.ts に /watch が含まれる
//  6. app/watch/client.tsx に「読むのはログインなしで自由にできます」が残り、かつ `if (!session) return (` の枝の内側に無い
//     （記録がある本番でも表示される場所にある）
//  7. components/SiteNav.tsx の NAV に /watch が**無い**（段に置かない）こと、かつ app/watch/page.tsx が存在すること
//
// 実ネットワーク不要。ファイルを読むだけ。

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

console.log('■ app/layout.tsx のフッター（常設・無条件）')
const layoutRaw = read('app/layout.tsx')
const layout = stripComments(layoutRaw)
const footer = between(layout, '<footer', '</footer>')
const watchAt = footer.indexOf('href="/watch"')
const beforeLink = watchAt < 0 ? '' : footer.slice(0, watchAt)
const GATES = ['&&', '? (', 'session', 'user', 'cookies', 'headers']
const gateHits = GATES.filter(g => beforeLink.includes(g))
check('1. <footer> 内に href="/watch" がちょうど1本、その行までに &&・? (・session・user・cookies・headers が無い（出し分けの分岐が無い）',
  footer.length > 0 && count(footer, 'href="/watch"') === 1 && watchAt > -1 && gateHits.length === 0,
  footer.length === 0 ? '<footer> が無い' : `href="/watch" ×${count(footer, 'href="/watch"')}／分岐の語: ${gateHits.join(', ') || '無し'}`)
// リンクの文言＝ <Link href="/watch" …> から </Link> まで
const linkText = between(footer, 'href="/watch"', '</Link>')
check('2. リンクの文言に「ログイン不要」が含まれる', linkText.includes('ログイン不要'), linkText.replace(/\s+/g, ' ').slice(0, 120))
// 1 の範囲は <footer> の内側だけなので、<footer> ごと条件で包む形や、上のほうで cookies() を
// 変数に受けてから使う形をすり抜ける（S1 レビュー W4）。ファイル全体でも出し分けの材料が無いことを見る。
const LAYOUT_GATES = ['cookies(', 'headers(', 'session', 'user']
const layoutGateHits = LAYOUT_GATES.filter(g => layout.includes(g))
check('2b. app/layout.tsx 全体に cookies(・headers(・session・user が無い（フッターを条件で包めない）',
  layoutGateHits.length === 0, layoutGateHits.join(', ') || '無し')

console.log('■ 経路を遮るものが無い（middleware / proxy・noindex・sitemap）')
// Next 16 は middleware.ts を proxy.ts に改名した（node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md）。両方見る
const gateFiles = ['middleware.ts', 'proxy.ts', 'src/middleware.ts', 'src/proxy.ts'].filter(exists)
const matcherHitsWatch = gateFiles.some(f => {
  const src = stripComments(read(f))
  const matcher = between(src, 'matcher', ']')
  // matcher に '/watch' の直書き、または全パスに当たる '/:path*'・'/(.*)' があれば /watch に当たる
  return /\/watch/.test(matcher) || /['"]\/:path\*['"]|['"]\/\(\.\*\)['"]/.test(matcher)
})
check('3. リポジトリ直下に middleware.ts / proxy.ts が無い（あっても matcher が /watch に当たらない）', gateFiles.length === 0 || !matcherHitsWatch, gateFiles.join(', ') || '無し')
const watchPage = stripComments(read('app/watch/page.tsx'))
check('4. app/watch/page.tsx に noindex / index: false が無い', !/noindex|index:\s*false/.test(watchPage))
check('5. app/sitemap.ts があり /watch が含まれる', exists('app/sitemap.ts') && /['"`]\/watch['"`]/.test(stripComments(read('app/sitemap.ts'))))

console.log('■ app/watch/client.tsx の文言（記録があっても出る）')
const client = stripComments(read('app/watch/client.tsx'))
const SENTENCE = '読むのはログインなしで自由にできます'
// `if (!session) return (` の枝は、その直後で最初に現れる「2字下げの ) だけの行」で閉じる
const noSessionAt = client.indexOf('if (!session) return (')
const noSessionEnd = noSessionAt < 0 ? -1 : client.indexOf('\n  )\n', noSessionAt)
const noSessionBranch = noSessionAt < 0 || noSessionEnd < 0 ? '' : client.slice(noSessionAt, noSessionEnd)
check(`6. 「${SENTENCE}」が残り、かつ if (!session) の枝の内側に無い（記録がある本番でも表示される）`,
  client.includes(SENTENCE) && noSessionAt > -1 && noSessionEnd > -1 && !noSessionBranch.includes(SENTENCE),
  `sentence=${client.includes(SENTENCE)} branch=[${noSessionAt},${noSessionEnd}] inBranch=${noSessionBranch.includes(SENTENCE)}`)
// 6 だけだと「別の枝（復元中など）の中にだけ在る」形で素通りする（S1 レビュー W4）。
// 文が PageHeader の中にあり、その PageHeader が3経路（復元中・記録なし・記録あり）すべてで
// 描かれることを、置き場所と呼び出し回数の両方で固定する。
const headerAt = client.indexOf('function PageHeader(')
const headerEnd = headerAt < 0 ? -1 : client.indexOf('\n}\n', headerAt)
const headerBody = headerAt < 0 || headerEnd < 0 ? '' : client.slice(headerAt, headerEnd)
const headerUses = count(client, '<PageHeader')
check('6b. 文は PageHeader の中にあり、PageHeader は3経路（復元中・記録なし・記録あり）すべてで描かれる',
  headerBody.includes(SENTENCE) && headerUses === 3,
  `inPageHeader=${headerBody.includes(SENTENCE)} <PageHeader ×${headerUses}`)

console.log('■ ナビの段に置かない・ページは存在する')
const nav = stripComments(read('components/SiteNav.tsx'))
const navBody = nav.slice(nav.indexOf('export const NAV = ['), nav.indexOf('] as const'))
check('7. components/SiteNav.tsx の NAV に /watch が無い（段に置かない）・app/watch/page.tsx が存在する',
  navBody.length > 0 && !navBody.includes("'/watch'") && exists('app/watch/page.tsx'), navBody.replace(/\s+/g, ' ').slice(0, 200))

console.log('')
console.log(`PASS ${passed} 件 / FAIL ${failed} 件`)
if (failed) process.exit(1)
console.log('すべてPASS')
