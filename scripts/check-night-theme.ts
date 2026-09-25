// 暗い見た目「夜」の土台（S1a・2026-09-25）の検査。
//   $env:PATH = "C:\Program Files\nodejs;$env:PATH"; npx tsx scripts/check-night-theme.ts
//
// 見るもの（正は DECISIONS.md 2026-09-24「画面を暗い地（#0A0C10）＋青緑（#2DD4BF）に転換」）:
//  - app/globals.css の :root が変わっていない（暗転で明るいテーマを壊していない証明。値の表で1つずつ照合）
//  - @theme inline が変わっていない（登録名 27 件と、--shadow-float の生値）
//  - [data-theme="night"] に DECISIONS の全トークンが過不足なくある（値も一致）。別名 5 件・--shadow-float・
//    color・color-scheme 以外の宣言が無い
//  - コントラストを実際に計算して閾値を満たす（文字 4.5／輪郭 3.0／区切り線 1.3）。
//    半透明は #0A0C10 に α合成した実効色に直してから比べる（designer と同じ手順。sRGB 8bit の単純α）。
//    手順の検算: #1A4787 on #FFFFFF = 9.15 ／ #2566B2 on #FFFFFF = 5.80 ／ #C03535 on #FFFFFF = 5.52 ／
//    #8A5300 on #FDF3E1 = 5.75。さらに DECISIONS の数字（却下値 4.12・1.23・2.90、採用値 5.64・1.54・3.79、
//    境界 1.31・1.33・3.54）を同じ手順で再現する
//  - SiteNav.tsx に text-emerald-700 が残っていない（注釈を除く）・night は `/` のときだけ・NAV の href・label・順序が変わっていない
//    （hint の文言は固定しない。原則12 が守るのは並び・呼び名・行き先の3つ。2026-09-25 S1b で名人の語を外した）
//  - 回り続ける動き（`infinite` と Tailwind の animate-spin / pulse / ping / bounce）が許可リスト（読み込み中・AIが書いている
//    最中の表示）以外に無い（DECISIONS R4）。ReplayStages の点滅は {thinking && …} の内側だけ（2026-09-25 S1b で広げた）
//  - ロゴの暗い地用ファイル（public/logo-night.svg / logo-mark-night.svg）: 幾何が元と同一・色が地の上 3:1 以上・
//    元ファイル（logo.svg / logo-mark.svg / app/icon.svg）は無傷
//  - ルートグループ app/(night)/: layout は Server Component（'use client' 無し）で themeColor #0A0C10、
//    地を --bg で塗る。page は移動済みで --surface の地の塗りを持たない

import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel))

let passed = 0
let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed++
    console.log(`  PASS ${name}`)
  } else {
    failed++
    console.log(`  FAIL ${name}${detail ? '  ' + detail : ''}`)
  }
}

// ── 色の計算（WCAG 2.1 相対輝度） ──────────────────────────────────────
type RGB = [number, number, number]
const NIGHT_BG: RGB = [10, 12, 16] // #0A0C10

function parseColor(v: string): { rgb: RGB; a: number } {
  const hex = /^#([0-9a-f]{6})$/i.exec(v.trim())
  if (hex) {
    const n = parseInt(hex[1], 16)
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], a: 1 }
  }
  const fn = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([0-9.]+))?\s*\)$/.exec(v.trim())
  if (fn) return { rgb: [+fn[1], +fn[2], +fn[3]], a: fn[4] == null ? 1 : +fn[4] }
  throw new Error(`色として読めない: ${v}`)
}
/** 半透明を base（既定 #0A0C10）に α合成した実効色（8bit に丸める＝designer と同じ前提） */
function effective(v: string, base: RGB = NIGHT_BG): RGB {
  const { rgb, a } = parseColor(v)
  return rgb.map((c, i) => Math.round(a * c + (1 - a) * base[i])) as RGB
}
function luminance([r, g, b]: RGB): number {
  const lin = (c: number) => {
    c /= 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const r2 = (x: number) => Math.round(x * 100) / 100
/** 2色とも #0A0C10 の上の実効色に直してから比べる */
const ratio = (fg: string, bg: string) => r2(contrast(effective(fg), effective(bg)))
/** 不透明どうしをそのまま比べる（検算用） */
const ratioRaw = (fg: string, bg: string) => r2(contrast(parseColor(fg).rgb, parseColor(bg).rgb))

// ── CSS の読み取り ───────────────────────────────────────────────────────
const stripCssComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')
/** .tsx の注釈（ブロック・行頭または空白のあとの //）を落とす。注釈に書いた旧名を「残っている」と誤検知しないため */
const stripTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1')
/** `selector {` から、行頭の `}` までの中身 */
function cssBlock(css: string, selector: string): string | null {
  const i = css.indexOf(`${selector} {`)
  if (i < 0) return null
  const j = css.indexOf('\n}', i)
  return j < 0 ? null : css.slice(i + selector.length + 2, j)
}
function declarations(body: string): Map<string, string> {
  const m = new Map<string, string>()
  for (const line of stripCssComments(body).split('\n')) {
    const t = line.trim()
    if (!t) continue
    const mm = /^([a-zA-Z-][a-zA-Z0-9-]*)\s*:\s*(.+?)\s*;$/.exec(t)
    if (mm) m.set(mm[1], mm[2].replace(/\s+/g, ' '))
  }
  return m
}
function sameMap(actual: Map<string, string>, expected: Record<string, string>): string[] {
  const problems: string[] = []
  for (const [k, v] of Object.entries(expected)) {
    if (!actual.has(k)) problems.push(`欠け ${k}`)
    else if (actual.get(k) !== v) problems.push(`${k}: 期待「${v}」 実際「${actual.get(k)}」`)
  }
  for (const k of actual.keys()) if (!(k in expected)) problems.push(`余分 ${k}`)
  return problems
}

// 明るいテーマ（:root）。DESIGN.md §5-1 の表と同じ値。ここが変わったら「暗転が明るいテーマを壊した」
const LIGHT_ROOT: Record<string, string> = {
  '--bg': '#F6F8FB', '--card': '#FFFFFF', '--surface': '#EDF1F6', '--brand-tint': '#E8EEF7',
  '--ink': '#0D1725', '--ink-2': '#3A4658', '--muted': '#5B677A',
  '--brand': '#1A4787', '--brand-strong': '#143A6E', '--on-brand': '#FFFFFF', '--focus': '#2566B2',
  '--success': '#177A4F', '--success-tint': '#E9F5EF', '--danger': '#C03535', '--danger-tint': '#FBECEC',
  '--warning-ink': '#8A5300', '--warning-tint': '#FDF3E1',
  '--border': '#C3CCD8', '--border-input': '#7C889B', '--axis': '#8D9FB8', '--rule-line': '#C9D3E0',
  '--scrim': 'rgb(13 23 37 / 0.32)',
  '--panel': 'var(--card)', '--accent': 'var(--brand)', '--accent-strong': 'var(--brand-strong)',
  '--accent-ink': 'var(--brand)', '--on-accent': 'var(--on-brand)',
  '--font-jp': "'Noto Sans JP Variable'",
  'color-scheme': 'light',
}
// 暗いテーマ（DECISIONS.md 2026-09-24 の値。★3件はコントラスト実測で承認値から調整済み）
const NIGHT_TOKENS: Record<string, string> = {
  '--bg': '#0A0C10', '--card': 'rgb(255 255 255 / .035)', '--surface': 'rgb(255 255 255 / .07)', '--brand-tint': 'rgb(45 212 191 / .16)',
  '--ink': '#EEF1F5', '--ink-2': 'rgb(238 241 245 / .66)', '--muted': 'rgb(238 241 245 / .55)',
  '--brand': '#2DD4BF', '--brand-strong': '#5EEAD4', '--on-brand': '#04201C', '--focus': '#EEF1F5',
  '--success': '#3FA96F', '--success-tint': 'rgb(63 169 111 / .14)', '--danger': '#F87171', '--danger-tint': 'rgb(248 113 113 / .14)',
  '--warning-ink': '#C08A2E', '--warning-tint': 'rgb(192 138 46 / .14)',
  '--border': 'rgb(255 255 255 / .16)', '--border-input': 'rgb(255 255 255 / .40)', '--axis': 'rgb(255 255 255 / .30)', '--rule-line': 'rgb(255 255 255 / .13)',
  '--scrim': 'rgb(2 3 5 / .72)',
}
// トークン以外に night に置いてよいもの（別名は :root と同じ対応。影・文字色・color-scheme）
const NIGHT_SHADOW = '0 24px 60px -20px rgb(0 0 0 / .80), 0 0 0 1px rgb(255 255 255 / .06)'
const NIGHT_EXTRA: Record<string, string> = {
  '--shadow-float': NIGHT_SHADOW,
  '--panel': 'var(--card)', '--accent': 'var(--brand)', '--accent-strong': 'var(--brand-strong)',
  '--accent-ink': 'var(--brand)', '--on-accent': 'var(--on-brand)',
  'color': 'var(--ink)',
  'color-scheme': 'dark',
}

function cssChecks() {
  console.log('■ app/globals.css')
  const css = read('app/globals.css')

  const rootBody = cssBlock(css, ':root')
  check('globals.css: :root ブロックがある', rootBody != null)
  const rootProblems = rootBody == null ? ['無い'] : sameMap(declarations(rootBody), LIGHT_ROOT)
  check(`globals.css: :root は明るい値のまま（${Object.keys(LIGHT_ROOT).length} 宣言が1つも変わっていない・増えていない）`, rootProblems.length === 0, rootProblems.join(' / '))

  const nightBody = cssBlock(css, '[data-theme="night"]')
  check('globals.css: [data-theme="night"] ブロックがある', nightBody != null)
  const night = nightBody == null ? new Map<string, string>() : declarations(nightBody)
  const nightProblems = sameMap(night, { ...NIGHT_TOKENS, ...NIGHT_EXTRA })
  check(`globals.css: night に DECISIONS の ${Object.keys(NIGHT_TOKENS).length} トークンが過不足なく・値も一致（別名5・影・color・color-scheme 以外は無い）`, nightProblems.length === 0, nightProblems.join(' / '))
  const lightTokenNames = Object.keys(LIGHT_ROOT).filter(k => k.startsWith('--') && !(k in NIGHT_EXTRA) && k !== '--font-jp')
  check('globals.css: night のトークン名の集合は :root と同じ（個数を増やしていない。--font-jp は文字なので対象外）',
    lightTokenNames.length === Object.keys(NIGHT_TOKENS).length && lightTokenNames.every(k => k in NIGHT_TOKENS))
  check('globals.css: 並びは :root → night → @theme inline（:root が先・night は範囲付き）',
    css.indexOf(':root {') < css.indexOf('[data-theme="night"] {') && css.indexOf('[data-theme="night"] {') < css.indexOf('@theme inline {'))

  const theme = cssBlock(css, '@theme inline')
  check('globals.css: @theme inline がある', theme != null)
  const themeDecl = theme == null ? new Map<string, string>() : declarations(theme)
  const colorNames = [...lightTokenNames, '--panel', '--accent', '--accent-strong', '--accent-ink', '--on-accent']
  // 登録名は原則「--color-」＋トークン名。--bg だけは bg-background として登録されている（Tailwind の bg- 接頭辞と重なるため）
  const registered = (k: string) => (k === '--bg' ? '--color-background' : `--color-${k.slice(2)}`)
  const missingReg = colorNames.filter(k => themeDecl.get(registered(k)) !== `var(${k})`)
  check('globals.css: @theme inline は無変更（27 色の登録名が同じ対応のまま）', [...themeDecl.keys()].filter(k => k.startsWith('--color-')).length === 27 && missingReg.length === 0, missingReg.join(', '))
  check('globals.css: @theme inline の --shadow-float は明るい地の生値のまま', themeDecl.get('--shadow-float') === '0 8px 24px rgb(13 23 37 / 0.12)')

  const utilities = css.slice(css.lastIndexOf('@layer utilities'))
  check('globals.css: .bg-accent:hover の規則は残っている（night では --brand-strong が明るい方向なのでそのまま）', utilities.includes('.bg-accent:hover { background-color: var(--accent-strong); }'))
  check('globals.css: night の .shadow-float は utilities 層で --tw-shadow を差し替える（@theme inline は生値を埋め込むため変数の上書きでは届かない）',
    utilities.includes('[data-theme="night"] .shadow-float {') && utilities.includes(`--tw-shadow: ${NIGHT_SHADOW};`))
  // 2026-09-25 S1c: 入場アニメ（DESIGN §5-6）の @keyframes rise を1つだけ足した。night ブロックの中には置かない。infinite は無い（R4）
  const cssCode = stripCssComments(css)
  check('globals.css: @keyframes は入場の rise 1つだけ（night ブロックの外）・infinite は無い（R4）',
    (cssCode.match(/@keyframes/g) ?? []).length === 1 && cssCode.includes('@keyframes rise') && !/infinite/.test(cssCode) && !(nightBody ?? '').includes('@keyframes'))
  check('globals.css: animate-rise は .85s・cubic-bezier(.2,.75,.2,1)・backwards（遅延中のちらつき防止）で @theme inline に登録',
    themeDecl.get('--animate-rise') === 'rise .85s cubic-bezier(.2,.75,.2,1) backwards')
  check('globals.css: display は 52px / 1.26 / 900 / 字間 -0.035em（DESIGN §5-2 の大見出し。1画面に1つ）',
    themeDecl.get('--text-display') === '52px' && themeDecl.get('--text-display--line-height') === '1.26'
      && themeDecl.get('--text-display--font-weight') === '900' && themeDecl.get('--text-display--letter-spacing') === '-0.035em')
}

function contrastChecks() {
  console.log('■ コントラスト（半透明は #0A0C10 に α合成した実効色で比較）')
  // 手順の検算（DESIGN.md §5-1 の明るい地の実測値と一致すること）
  check('検算: #1A4787 on #FFFFFF = 9.15', ratioRaw('#1A4787', '#FFFFFF') === 9.15, String(ratioRaw('#1A4787', '#FFFFFF')))
  check('検算: #2566B2 on #FFFFFF = 5.80', ratioRaw('#2566B2', '#FFFFFF') === 5.8, String(ratioRaw('#2566B2', '#FFFFFF')))
  check('検算: #C03535 on #FFFFFF = 5.52', ratioRaw('#C03535', '#FFFFFF') === 5.52, String(ratioRaw('#C03535', '#FFFFFF')))
  check('検算: #8A5300 on #FDF3E1 = 5.75', ratioRaw('#8A5300', '#FDF3E1') === 5.75, String(ratioRaw('#8A5300', '#FDF3E1')))
  // DECISIONS 2026-09-24 の数字を同じ手順で再現（却下値・採用値・境界の4件）
  const T = NIGHT_TOKENS
  const repro: [string, number, number][] = [
    ['--muted 承認値 .45 は 4.12（却下）', ratio('rgb(238 241 245 / .45)', T['--bg']), 4.12],
    ['--muted .55 は 5.64（採用）', ratio(T['--muted'], T['--bg']), 5.64],
    ['カード枠 .09 は 1.23（却下）', ratio('rgb(255 255 255 / .09)', T['--bg']), 1.23],
    ['--border .16 は 1.54（採用）', ratio(T['--border'], T['--bg']), 1.54],
    ['選択中カードの枠 .45 は 2.90（却下）', ratio('rgb(45 212 191 / .45)', T['--bg']), 2.9],
    ['選択中カードの枠 .55 は 3.79（採用）', ratio('rgb(45 212 191 / .55)', T['--bg']), 3.79],
    ['境界: --rule-line vs card 1.31', ratio(T['--rule-line'], T['--card']), 1.31],
    ['境界: --border vs surface 1.33', ratio(T['--border'], T['--surface']), 1.33],
    ['境界: --border-input vs card 3.54', ratio(T['--border-input'], T['--card']), 3.54],
  ]
  for (const [name, got, want] of repro) check(`再現: ${name}`, got === want, `実際 ${got}`)

  const TEXT = 4.5, OUTLINE = 3.0, LINE = 1.3
  type Pair = [string, string]
  const onSurfaces = (fg: string, bgs: string[]): Pair[] => bgs.map(b => [fg, b])
  const text: Pair[] = [
    ...onSurfaces('--ink', ['--bg', '--card', '--surface', '--brand-tint']),
    ...onSurfaces('--ink-2', ['--bg', '--card', '--surface', '--brand-tint']),
    ...onSurfaces('--muted', ['--bg', '--card', '--surface']),
    ...onSurfaces('--brand', ['--bg', '--card', '--surface', '--brand-tint']),
    ...onSurfaces('--brand-strong', ['--bg', '--card']),
    ['--on-brand', '--brand'], ['--on-brand', '--brand-strong'],
    ...onSurfaces('--success', ['--bg', '--card', '--success-tint']),
    ...onSurfaces('--danger', ['--bg', '--card', '--danger-tint']),
    ...onSurfaces('--warning-ink', ['--bg', '--card', '--warning-tint']),
  ]
  const outline: Pair[] = [
    ...onSurfaces('--border-input', ['--bg', '--card', '--surface']),
    ...onSurfaces('--focus', ['--bg', '--card', '--surface']),
    ['--brand', '--bg'],
  ]
  const line: Pair[] = [
    ...onSurfaces('--border', ['--bg', '--card', '--surface']),
    ...onSurfaces('--rule-line', ['--bg', '--card']),
    // --axis は図形の線（数直線の軸）。明るい地でも 2.70 で 3:1 に届かず、オーナー選択で
    // 「文字を併記するので WCAG 1.4.11 の必須対象にしない」とした（DESIGN §5-1）。night も同じ扱い。
    ...onSurfaces('--axis', ['--bg', '--card']),
  ]
  const run = (label: string, pairs: Pair[], min: number) => {
    const rows: string[] = []
    for (const [fg, bg] of pairs) {
      const r = ratio(T[fg], T[bg])
      check(`${label} ${min}: ${fg} on ${bg} = ${r.toFixed(2)}`, r >= min)
      rows.push(`${fg} on ${bg} ${r.toFixed(2)}`)
    }
    // 2026-09-25 S1c: 測った値の一覧（次の DESIGN.md §5-1 改訂で「検査が毎回計算」の欄を埋めるため）。閾値は上の check が課す
    console.log(`  情報: 実測一覧（${label.replace(' ≥', '')}・${min} 以上）: ${rows.join(' / ')}`)
  }
  run('文字 ≥', text, TEXT)
  run('輪郭 ≥', outline, OUTLINE)
  run('区切り線 ≥', line, LINE)

  // 向きの規則（DECISIONS）: ホバーは明るい方向、注意は青緑より暗い
  const lum = (k: string) => luminance(effective(T[k]))
  check('向き: --brand-strong は --brand より明るい（暗い地のホバーは「明るく」）', lum('--brand-strong') > lum('--brand'))
  check('向き: --warning-ink は --brand より暗い（注意が画面で一番光らない）', lum('--warning-ink') < lum('--brand'))

  // 参考値（閾値は課さない。使い方の制約として DECISIONS に書かれている数字）
  console.log('  情報: --card vs --bg', ratio(T['--card'], T['--bg']), '（単独では見分けられない → 必ず --border と対で使う）')
  console.log('  情報: --surface vs --bg', ratio(T['--surface'], T['--bg']), '／ --brand-tint vs --bg', ratio(T['--brand-tint'], T['--bg']))
  console.log('  情報: --rule-line vs --surface', ratio(T['--rule-line'], T['--surface']), '（1.3 未満 → --rule-line は --bg と --card の上だけ）')
  console.log('  情報: --muted on --brand-tint', ratio(T['--muted'], T['--brand-tint']), '（4.5 未満 → 選択中の下地の上の文字は --brand か --ink にする）')
  console.log('  情報: --axis on --bg', ratio(T['--axis'], T['--bg']), '（明るい地 2.70 と同じく 3:1 には届かない・図形の線だけ）')
}

function navChecks() {
  console.log('■ components/SiteNav.tsx・StockSearch.tsx')
  const nav = read('components/SiteNav.tsx')
  // 注釈を落として見る（下部ナビの注釈に「旧 emerald は…」と書いてあるので、生ファイルでは誤検知する。2026-09-25 S1b レビュー指摘）
  check('SiteNav: text-emerald-700 が残っていない（旧ブランド色の残り・DESIGN §10 P1。注釈を除く）', !stripTsComments(nav).includes('text-emerald'))
  check('SiteNav: 現在地の下部ナビは text-brand', nav.includes("active ? 'text-brand font-semibold' : 'text-muted'"))
  check("SiteNav: night は usePathname() が '/' のときだけ", nav.includes("const night = path === '/'") && nav.includes("const theme = night ? 'night' : undefined"))
  check('SiteNav: ヘッダーと下部ナビの2か所に data-theme={theme}', (nav.match(/data-theme=\{theme\}/g) ?? []).length === 2)
  check('SiteNav: ロゴは `/` のときだけ暗い地用ファイル', nav.includes("src={night ? '/logo-night.svg' : '/logo.svg'}") && nav.includes("src={night ? '/logo-mark-night.svg' : '/logo-mark.svg'}"))
  // 2026-09-25 S1b（レビュー指摘）: hint の文言は固定しない。原則12 が守るのは href・label・順序の3つ
  // （hint は S1b で「名人」の語を外し、S2 でまた変わる）。NAV の配列本体だけを読み、注釈の中の旧文言は見ない
  const navSrc = stripTsComments(nav)
  const navBody = navSrc.slice(navSrc.indexOf('export const NAV = ['), navSrc.indexOf('] as const'))
  const navEntries = [...navBody.matchAll(/\{ href: '([^']+)',\s+label: '([^']+)',\s+hint: '[^']*' \}/g)].map(m => [m[1], m[2]])
  const NAV_FIXED = [['/watch', '見る'], ['/learn', 'まねる'], ['/trade', 'やる'], ['/review', '振り返る']]
  check('SiteNav: NAV の href・label・順序が変わっていない（原則12。hint の文言は固定しない）', JSON.stringify(navEntries) === JSON.stringify(NAV_FIXED) && nav.includes('] as const'), JSON.stringify(navEntries))

  const search = stripTsComments(read('components/StockSearch.tsx'))
  check('StockSearch: 既製色の札（bg-red-50/text-red-700/bg-blue-50/text-blue-700）が無い', !/bg-red-50|text-red-700|bg-blue-50|text-blue-700/.test(search))
  check('StockSearch: 市場の札は無彩色のトークン（bg-surface text-ink-2）', search.includes('rounded bg-surface text-ink-2'))
  check('StockSearch: 回る輪の切れ目は border-t-ink（border-t-white を使わない）', search.includes('border-t-ink') && !search.includes('border-t-white'))
  check('StockSearch: 候補の面は bg-background（唯一の不透明面）＋行 bg-card・ホバー bg-surface（hover:bg-border を使わない）',
    search.includes('bg-background border border-border rounded-lg overflow-hidden z-50 shadow-float') && search.includes('bg-card hover:bg-surface') && !search.includes('hover:bg-border'))
  check('StockSearch: 影は shadow-float（Tailwind 既定の shadow-xl を使わない）', !search.includes('shadow-xl'))
}

function routeChecks() {
  console.log('■ app/(night)/')
  check('app/page.tsx は無い（app/(night)/page.tsx へ移動済み。両方あると / が衝突する）', !exists('app/page.tsx') && exists('app/(night)/page.tsx'))
  const layout = exists('app/(night)/layout.tsx') ? read('app/(night)/layout.tsx') : ''
  check('app/(night)/layout.tsx がある', layout.length > 0)
  check("layout: 'use client' を付けていない（viewport は Server Component からしか書き出せない）", !/['"]use client['"]/.test(stripTsComments(layout)))
  check("layout: viewport.themeColor を '#0A0C10' に上書き", /export const viewport: Viewport = \{[\s\S]*?themeColor: '#0A0C10'/.test(layout))
  check('layout: data-theme="night" を子に当てる', layout.includes('data-theme="night"'))
  check('layout: 地は --bg を 100vmax の box-shadow で画面の外まで塗る（night の --surface / --card は半透明で地にならない）', layout.includes('bg-background shadow-[0_0_0_100vmax_var(--bg)]'))
  const page = exists('app/(night)/page.tsx') ? read('app/(night)/page.tsx') : ''
  check("page: 'use client' のまま", /^'use client'/.test(page))
  // S1c で選択中カードが `bg-surface shadow-[0_22px…]` を持つようになったので、旧の地の塗りそのものを名指しで見る
  check('page: 旧の --surface の地の塗り（shadow-[0_0_0_100vmax_var(--surface)]）を持たない', !page.includes('var(--surface)]') && !page.includes('shadow-[0_0_0_100vmax_var(--surface)]'))
  // 2026-09-25 S1c: 中身を承認済みの見た目（Night.dc.html）で作り直した。目印は新しい見出しと共通部品の免責（詳細は scripts/check-entry.ts）
  check('page: 中身の目印（52px の見出し・3つの選択・4段階の一列・AIの見本・共通部品の免責）',
    page.includes('買う理由を書いて残し、あとで株価と読み返す。') && page.includes('できることは3つです。どれから始めますか')
      && page.includes('このサイトは4つの段階でできています') && page.includes('AIも、同じ形式で理由を書いています') && page.includes('<Disclaimer part="general" />'))
  const rootLayout = read('app/layout.tsx')
  check("app/layout.tsx: root の viewport は明るいまま（themeColor '#F6F8FB'・colorScheme 'light'）", rootLayout.includes("themeColor: '#F6F8FB'") && rootLayout.includes("colorScheme: 'light'"))
}

function logoChecks() {
  console.log('■ ロゴ（暗い地用）')
  const svgColors = (svg: string) => [...svg.matchAll(/(?:fill|stop-color)="(#[0-9A-Fa-f]{6})"/g)].map(m => m[1])
  const geometry = (svg: string) => [...svg.matchAll(/<(?:path|circle|rect)\b[^>]*?(?:\sd="[^"]*"|\scx="[^"]*"\scy="[^"]*"\sr="[^"]*")/g)].map(m => m[0].replace(/\s(?:fill|stop-color)="[^"]*"/g, ''))
  for (const [orig, night] of [['public/logo.svg', 'public/logo-night.svg'], ['public/logo-mark.svg', 'public/logo-mark-night.svg']]) {
    check(`${night} がある`, exists(night))
    if (!exists(night)) continue
    const o = read(orig), n = read(night)
    check(`${night}: 幾何（path / circle）が ${orig} と同一`, JSON.stringify(geometry(o)) === JSON.stringify(geometry(n)) && geometry(n).length > 0, `${geometry(o).length} vs ${geometry(n).length}`)
    const dark = svgColors(n).filter(c => ratioRaw(c, '#0A0C10') < 3.0)
    check(`${night}: すべての塗り・グラデーションの色が地 #0A0C10 の上で 3:1 以上（図形）`, dark.length === 0, dark.map(c => `${c}=${ratioRaw(c, '#0A0C10')}`).join(', '))
    check(`${night}: 沈む色（#0D1725 / #172F55 / #1A4787 / #2447A0）を属性に使っていない`, !/(?:fill|stop-color)="#(?:0D1725|172F55|1A4787|2447A0)"/.test(n))
  }
  check('public/logo.svg は無傷（文字 #0D1725 ×2・mk 始点 #172F55）', (read('public/logo.svg').match(/fill="#0D1725"/g) ?? []).length === 2 && read('public/logo.svg').includes('stop-color="#172F55"'))
  check('public/logo-mark.svg は無傷（mk 始点 #172F55）', read('public/logo-mark.svg').includes('stop-color="#172F55"') && !read('public/logo-mark.svg').includes('#EEF1F5'))
  check('app/icon.svg は今回触っていない（白い角丸タイルのまま。判断は別スライス）', read('app/icon.svg').includes('rx="88" fill="#FFFFFF"'))
  check('ログイン画面は明るい地の logo.svg のまま', read('app/auth/login/page.tsx').includes('/logo.svg') && !read('app/auth/login/page.tsx').includes('logo-night'))
}

function motionChecks() {
  console.log('■ 動き（DECISIONS R4）')
  const files: string[] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.next') continue
        walk(p)
      } else if (/\.(tsx?|css|mjs)$/.test(e.name)) files.push(p)
    }
  }
  for (const d of ['app', 'components', 'lib']) walk(path.join(ROOT, d))
  // 2026-09-25 S1b（レビュー指摘）: 旧は `infinite` の grep だけで、Tailwind の回り続ける既製クラス
  // （animate-spin / pulse / ping / bounce）を見ていなかった。正規表現を広げ、許可リスト（ファイル → 理由）を持つ。
  // 注釈は行数を保ったまま落とす（注釈に書いた「animate-pulse を使わない」を誤検知しないため）
  const MOTION = /\binfinite\b|\banimate-(?:spin|pulse|ping|bounce)\b/
  const stripKeepLines = (s: string, css: boolean) => {
    const noBlock = s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
    return css ? noBlock : noBlock.replace(/(^|\s)\/\/[^\n]*/g, '$1')
  }
  const rel = (f: string) => path.relative(ROOT, f).replace(/\\/g, '/')
  const hits = new Map<string, number[]>()
  for (const f of files) {
    const lines = stripKeepLines(fs.readFileSync(f, 'utf8'), f.endsWith('.css')).split('\n')
    const nums = lines.map((l, i) => (MOTION.test(l) ? i + 1 : 0)).filter(n => n > 0)
    if (nums.length) hits.set(rel(f), nums)
  }
  // 許可リスト: 読み込み中・AIが書いている最中の表示だけ（DECISIONS R4「読み込み表示」）。装飾の動きはここに足さない
  const ALLOWED: Record<string, string> = {
    'app/(night)/page.tsx': 'AIの判断の読み込み中の骨組み（aria-busy）',
    'app/learn/page.tsx': '結果の読み込み中の骨組み（data-skeleton）と、AIレポートが流れてくる間だけ点滅する書き込み位置の印',
    'app/review/page.tsx': '読み込み中の骨組み（aria-busy）',
    'app/watch/client.tsx': 'セッション復元中の骨組み（aria-busy）',
    'app/simulate/page.tsx': '実行中の回る輪',
    'app/lab/page.tsx': '読み込み中の回る輪（ナビから外した旧ページ。S7 で削除予定）',
    'app/markets/page.tsx': '読み込み中の骨組み（ナビから外した旧ページ。S7 で削除予定）',
    'app/report/page.tsx': '読み込み中の回る輪と、AIレポートが流れてくる間の書き込み位置の印（ナビから外した旧ページ。S7 で削除予定）',
    'components/ChartWithControls.tsx': 'チャートの読み込み中の回る輪',
    'components/EarningsPanel.tsx': '決算の読み込み中の骨組み',
    'components/StockSearch.tsx': '検索の読み込み中の回る輪',
    'components/watch/replay/ReplayStages.tsx': '「AI が判断を書いています」の間だけ点滅する3つの点（thinking のときだけ描画）',
  }
  const offenders = [...hits.keys()].filter(f => !(f in ALLOWED))
  check(`R4: 回り続ける動き（infinite / animate-spin・pulse・ping・bounce）が許可リスト（読み込み中・AIが書いている最中の表示）以外に無い（走査 ${files.length} ファイル・該当 ${hits.size}）`,
    offenders.length === 0, offenders.map(f => `${f}:${hits.get(f)!.join(',')}`).join(' / '))
  const stale = Object.keys(ALLOWED).filter(f => !hits.has(f))
  check('R4: 許可リストに、もう動きを持たないファイルが残っていない（リストを現実に合わせて保つ）', stale.length === 0, stale.join(', '))
  for (const f of Object.keys(ALLOWED).filter(f => hits.has(f))) console.log(`  情報: ${f}:${hits.get(f)!.join(',')} — ${ALLOWED[f]}`)
  // ReplayStages の点滅は装飾ではなく「AIが考えている最中」の表示であること: animate-pulse は {thinking && ( … )} の内側にだけある
  const replay = read('components/watch/replay/ReplayStages.tsx')
  const thinkingStart = replay.indexOf('{thinking && (')
  const thinkingEnd = thinkingStart > -1 ? replay.indexOf(')}', thinkingStart) : -1
  const inside = thinkingStart > -1 && thinkingEnd > thinkingStart ? replay.slice(thinkingStart, thinkingEnd) : ''
  const pulsesAll = (replay.match(/animate-pulse/g) ?? []).length
  const pulsesInside = (inside.match(/animate-pulse/g) ?? []).length
  check('ReplayStages: 点滅する点は {thinking && ( … )} の内側にだけ（AIが判断を書いている最中の表示であって装飾ではない）', pulsesAll > 0 && pulsesAll === pulsesInside, `all=${pulsesAll} inside=${pulsesInside}`)
}

cssChecks()
contrastChecks()
navChecks()
routeChecks()
logoChecks()
motionChecks()

console.log('')
console.log(`PASS ${passed} 件 / FAIL ${failed} 件`)
if (failed) process.exit(1)
console.log('すべてPASS')
