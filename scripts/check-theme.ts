// 見た目の土台（トークン・ロゴ・動き）の検査（旧 check-night-theme.ts。S1a・2026-09-25 新設 → SV1a で「:root 一本化」に
// 反転 → L1・2026-10-12 で「明るい地」に再反転し、名前から night を外した）。
//   $env:PATH = "C:\Program Files\nodejs;$env:PATH"; npx tsx scripts/check-theme.ts
//
// 見るもの（正は DECISIONS.md 2026-10-12「地を明るい（#F6F8FB）に戻し、2026-09-24 の暗転と 2026-09-25 の SV1a を覆す」と
// DESIGN.md §5-1・§9）:
//  - app/globals.css の :root が明るい地の値である（22 トークンが過不足なく・値も一致。別名 5 件・--font-jp・
//    color-scheme: light 以外の宣言が無い＝トークンの個数を増やしていない。2026-09-24 の不変条件を維持）
//  - 範囲付きの仕掛けが残っていない: [data-theme="night"] ブロック・`.shadow-float` の上書き・
//    app/(night)/layout.tsx の data-theme と 100vmax の地の塗り・SiteNav の `/` だけの出し分け（SV1a で撤去したまま）
//  - @theme inline の登録名 27 件が同じ対応のまま。--shadow-float の生値は明るい地の1枚（黒い影が機能するので白い縁は要らない）
//  - 暗い地の値（#0A0C10・#EEF1F5・#2DD4BF）が globals.css の注釈の外に残っていない
//    （#2DD4BF は図の強調点では許す。文字には使わない＝不変条件。L2 でにじみを撤去したので layout にも無い）
//  - コントラストを実際に計算して閾値を満たす（文字 4.5／輪郭 3.0／区切り線 1.3）。
//    半透明は #F6F8FB に α合成した実効色に直してから比べる（designer と同じ手順。sRGB 8bit の単純α）。
//    手順の検算: #1A4787 on #FFFFFF = 9.15 ／ #2566B2 on #FFFFFF = 5.80 ／ #C03535 on #FFFFFF = 5.52 ／
//    #8A5300 on #FDF3E1 = 5.75（2026-09-11 の記録。地の向きに関係なく毎回走る）。さらに DECISIONS 2026-10-12 の数字
//    （却下値 2.55・1.11〜1.20・1.75・2.85、採用値 5.26・1.52・5.14・7.13・3.74・5.95、境界 4.59）を同じ手順で再現する
//  - 向き: --brand-strong は --brand より濃い（明るい地のホバーは「濃く」）／--warning-ink は --brand より濃い
//    （注意を光らせず、濃い文字として沈める）
//  - SiteNav.tsx に text-emerald-700 が残っていない（注釈を除く）・全ページで元のロゴ（logo.svg / logo-mark.svg）・
//    NAV の href・label・順序が変わっていない（hint の文言は固定しない。原則12 が守るのは並び・呼び名・行き先の3つ）
//  - 回り続ける動き（`infinite` と Tailwind の animate-spin / pulse / ping / bounce）が許可リスト（読み込み中・AIが書いている
//    最中の表示）以外に無い（DECISIONS R4）。ReplayStages の点滅は {thinking && …} の内側だけ
//  - ロゴ: public/logo.svg / logo-mark.svg が正（無傷）。暗い地用の *-night.svg は削除せず残す（戻すときのため。幾何が元と同一）。
//    ログイン画面も元のロゴ
//  - ルートグループ app/(night)/: layout は Server Component（'use client' 無し）で、にじみ（radial-gradient）は持たない
//    （L2・2026-10-14 決定(2)④で撤去。children をそのまま返すだけ）。ホームの目印（27px の見出し・順序の語）は scripts/check-entry.ts が見る。
//    app/layout.tsx の root の viewport は themeColor #F6F8FB・colorScheme light で、フッターの枠（R10）を全ページに持つ（境目は線ではなく空白）。
//    SiteNav の帯は線（border）と背景のぼかしを持たず、スティッキーバーとして影で境目を作る（L2 決定(2)③⑤）
//  - チャート: components/chartTheme.ts の FALLBACK が白地に合成した実効色と一致（二重管理のずれを防ぐ）。
//    SERIES.earnings は #A8761F（明るい地 3.74。旧 #C08A2E は 2.85）。StockChart のローソク足は
//    上げ＝中空（面 --card・輪郭 --ink）／下げ＝--ink-2 の塗り（--ink だと下げ相場で黒い壁になる）

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
const LIGHT_BG: RGB = [246, 248, 251] // #F6F8FB
const WHITE: RGB = [255, 255, 255]

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
/** 半透明を base（既定 #F6F8FB）に α合成した実効色（8bit に丸める＝designer と同じ前提） */
function effective(v: string, base: RGB = LIGHT_BG): RGB {
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
/** 2色とも #F6F8FB の上の実効色に直してから比べる */
const ratio = (fg: string, bg: string) => r2(contrast(effective(fg), effective(bg)))
/** 不透明どうしをそのまま比べる（検算用） */
const ratioRaw = (fg: string, bg: string) => r2(contrast(parseColor(fg).rgb, parseColor(bg).rgb))
const hex = ([r, g, b]: RGB) => '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase()

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

// 明るい地（DECISIONS.md 2026-10-12 の値を出発点に、コントラスト実測で3件を調整＝★。globals.css の各行に理由）
//   ★ --success-tint / --danger-tint: 半透明 .12 では上の文字が 4.27 / 4.36 で 4.5 未達 → 2026-09-11 の不透明な値に戻す
//   ★ --warning-tint: 同じく 2026-09-11 の値（検算 #8A5300 on #FDF3E1 = 5.75 と同じ組）
const TOKENS: Record<string, string> = {
  '--bg': '#F6F8FB', '--card': '#FFFFFF', '--surface': 'rgb(0 0 0 / .04)', '--brand-tint': 'rgb(13 148 136 / .10)',
  '--ink': '#111111', '--ink-2': '#4A4D55', '--muted': '#64686F',
  '--brand': '#0F766E', '--brand-strong': '#115E59', '--on-brand': '#FFFFFF', '--focus': '#111111',
  '--success': '#177A4F', '--success-tint': '#E9F5EF', '--danger': '#C03535', '--danger-tint': '#FBECEC',
  '--warning-ink': '#8A5300', '--warning-tint': '#FDF3E1',
  '--border': 'rgb(0 0 0 / .18)', '--border-input': 'rgb(0 0 0 / .45)', '--axis': 'rgb(0 0 0 / .38)', '--rule-line': 'rgb(0 0 0 / .14)',
  '--scrim': 'rgb(17 19 23 / .55)',
}
// トークン以外に :root に置いてよいもの（別名 5 件は S1a 以前と同じ対応・日本語フォント・color-scheme）。
// --shadow-float は :root に置かない（@theme inline 側に生値。同名にすると自己参照になる）
const LIGHT_SHADOW = '0 24px 60px -20px rgb(0 0 0 / .25)'
const ROOT_EXTRA: Record<string, string> = {
  '--panel': 'var(--card)', '--accent': 'var(--brand)', '--accent-strong': 'var(--brand-strong)',
  '--accent-ink': 'var(--brand)', '--on-accent': 'var(--on-brand)',
  '--font-jp': "'Noto Sans JP Variable'",
  'color-scheme': 'light',
}
// S1a 以前（2026-09-11）からの :root のトークン名。個数の不変条件（22）はこの一覧との比較で担保する
const TOKEN_NAMES_S1A = [
  '--bg', '--card', '--surface', '--brand-tint', '--ink', '--ink-2', '--muted', '--brand', '--brand-strong', '--on-brand', '--focus',
  '--success', '--success-tint', '--danger', '--danger-tint', '--warning-ink', '--warning-tint',
  '--border', '--border-input', '--axis', '--rule-line', '--scrim',
]

function cssChecks() {
  console.log('■ app/globals.css')
  const css = read('app/globals.css')
  const cssCode = stripCssComments(css)

  const rootBody = cssBlock(css, ':root')
  check('globals.css: :root ブロックがある', rootBody != null)
  const root = rootBody == null ? new Map<string, string>() : declarations(rootBody)
  const rootProblems = sameMap(root, { ...TOKENS, ...ROOT_EXTRA })
  check(`globals.css: :root は明るい地の値（${Object.keys(TOKENS).length} トークンが過不足なく・値も一致。別名5・--font-jp・color-scheme 以外は無い）`, rootProblems.length === 0, rootProblems.join(' / '))
  check('globals.css: トークン名の集合は 2026-09-11 以来の :root と同じ（個数 22 を増やしていない・減らしていない）',
    TOKEN_NAMES_S1A.length === Object.keys(TOKENS).length && TOKEN_NAMES_S1A.every(k => k in TOKENS) && TOKEN_NAMES_S1A.every(k => root.has(k)))
  check('globals.css: :root の color-scheme は light（app/layout.tsx の viewport.colorScheme と同じ値）', root.get('color-scheme') === 'light')
  check('globals.css: :root に --shadow-float を置いていない（@theme inline と同名にすると自己参照）', !root.has('--shadow-float'))

  // 範囲付きの仕掛けは撤去済みのまま（明暗2本を持たない・DESIGN §9）
  check('globals.css: [data-theme="night"] ブロックが無い（明暗2本を持たない）', cssBlock(cssCode, '[data-theme="night"]') == null && !cssCode.includes('data-theme'))
  check('globals.css: 並びは :root → @theme inline', cssCode.indexOf(':root {') > -1 && cssCode.indexOf(':root {') < cssCode.indexOf('@theme inline {'))

  const theme = cssBlock(css, '@theme inline')
  check('globals.css: @theme inline がある', theme != null)
  const themeDecl = theme == null ? new Map<string, string>() : declarations(theme)
  const colorNames = [...TOKEN_NAMES_S1A, '--panel', '--accent', '--accent-strong', '--accent-ink', '--on-accent']
  // 登録名は原則「--color-」＋トークン名。--bg だけは bg-background として登録されている（Tailwind の bg- 接頭辞と重なるため）
  const registered = (k: string) => (k === '--bg' ? '--color-background' : `--color-${k.slice(2)}`)
  const missingReg = colorNames.filter(k => themeDecl.get(registered(k)) !== `var(${k})`)
  check('globals.css: @theme inline は無変更（27 色の登録名が同じ対応のまま）', [...themeDecl.keys()].filter(k => k.startsWith('--color-')).length === 27 && missingReg.length === 0, missingReg.join(', '))
  check('globals.css: @theme inline の --shadow-float は明るい地の1枚（黒い影だけ。白い縁の2枚目は無い）', themeDecl.get('--shadow-float') === LIGHT_SHADOW && !(themeDecl.get('--shadow-float') ?? '').includes(','), themeDecl.get('--shadow-float'))
  check('globals.css: 暗い地の2枚重ね（0 0 0 1px rgb(255 255 255 / .06)）が残っていない', !cssCode.includes('rgb(255 255 255 / .06)'))

  const utilities = cssCode.slice(cssCode.lastIndexOf('@layer utilities'))
  check('globals.css: .bg-accent:hover の規則は残っている（--brand-strong が濃い方向＝通常のホバー）', utilities.includes('.bg-accent:hover { background-color: var(--accent-strong); }'))
  check('globals.css: `.shadow-float` の上書きが無い（@theme inline の生値だけ）', !utilities.includes('.shadow-float {'))
  // 2026-09-25 S1c: 入場アニメ（DESIGN §5-6）の @keyframes rise を1つだけ足した。infinite は無い（R4）
  check('globals.css: @keyframes は入場の rise 1つだけ・infinite は無い（R4）',
    (cssCode.match(/@keyframes/g) ?? []).length === 1 && cssCode.includes('@keyframes rise') && !/infinite/.test(cssCode))
  check('globals.css: animate-rise は .85s・cubic-bezier(.2,.75,.2,1)・backwards（遅延中のちらつき防止）で @theme inline に登録',
    themeDecl.get('--animate-rise') === 'rise .85s cubic-bezier(.2,.75,.2,1) backwards')
  check('globals.css: display は 52px / 1.26 / 900 / 字間 -0.035em（DESIGN §5-2 の大見出し。1画面に1つ）',
    themeDecl.get('--text-display') === '52px' && themeDecl.get('--text-display--line-height') === '1.26'
      && themeDecl.get('--text-display--font-weight') === '900' && themeDecl.get('--text-display--letter-spacing') === '-0.035em')
  // L1（2026-10-12）: 暗い地の値が注釈の外に残っていない。#2DD4BF は文字に使わない（不変条件）。にじみは app/(night)/layout.tsx 側
  check('globals.css: 暗い地の値（#0A0C10 / #EEF1F5 / #2DD4BF / #5EEAD4 / #04201C）が注釈の外に残っていない', !/#0A0C10|#EEF1F5|#2DD4BF|#5EEAD4|#04201C/i.test(cssCode))
  check('globals.css: 純黒 #000000 を文字に使っていない（--ink #111111 が下限。rgb(0 0 0 / α) は線と面の膜だけ）', !/#000000|#000\b/i.test(cssCode))
}

function contrastChecks() {
  console.log('■ コントラスト（半透明は #F6F8FB に α合成した実効色で比較）')
  // 手順の検算（DESIGN.md §5-1 の 2026-09-11 の実測値と一致すること）
  check('検算: #1A4787 on #FFFFFF = 9.15', ratioRaw('#1A4787', '#FFFFFF') === 9.15, String(ratioRaw('#1A4787', '#FFFFFF')))
  check('検算: #2566B2 on #FFFFFF = 5.80', ratioRaw('#2566B2', '#FFFFFF') === 5.8, String(ratioRaw('#2566B2', '#FFFFFF')))
  check('検算: #C03535 on #FFFFFF = 5.52', ratioRaw('#C03535', '#FFFFFF') === 5.52, String(ratioRaw('#C03535', '#FFFFFF')))
  check('検算: #8A5300 on #FDF3E1 = 5.75', ratioRaw('#8A5300', '#FDF3E1') === 5.75, String(ratioRaw('#8A5300', '#FDF3E1')))
  // DECISIONS 2026-10-12 の数字を同じ手順で再現（却下値・採用値・境界）。
  // DECISIONS の本文は 5.15 / 1.55 / 4.60 と書いているが、この手順（8bit に丸めた α合成）では 5.14 / 1.52 / 4.59。正はこの出力
  const T = TOKENS
  const repro: [string, number, number][] = [
    ['手法の参考値 --muted #9A9DA5 は 2.55（却下・R7）', ratio('#9A9DA5', T['--bg']), 2.55],
    ['--muted #64686F は 5.26（採用）', ratio(T['--muted'], T['--bg']), 5.26],
    ['手法の参考値 枠線 黒 5% は 1.11（却下・区切り線 1.3 未達）', ratio('rgb(0 0 0 / .05)', T['--bg']), 1.11],
    ['手法の参考値 枠線 黒 8% は 1.20（却下）', ratio('rgb(0 0 0 / .08)', T['--bg']), 1.2],
    ['--border .18 は 1.52（採用）', ratio(T['--border'], T['--bg']), 1.52],
    ['--brand #0F766E は 5.14（採用）', ratio(T['--brand'], T['--bg']), 5.14],
    ['--brand-strong #115E59 は 7.13（採用）', ratio(T['--brand-strong'], T['--bg']), 7.13],
    ['旧 --brand #2DD4BF は 1.75（文字に使えない）', ratio('#2DD4BF', T['--bg']), 1.75],
    ['旧 earnings #C08A2E は 2.85（却下・図形 3:1 未達）', ratio('#C08A2E', T['--bg']), 2.85],
    ['earnings #A8761F は 3.74（採用）', ratio('#A8761F', T['--bg']), 3.74],
    ['--warning-ink #8A5300 は 5.95（採用）', ratio(T['--warning-ink'], T['--bg']), 5.95],
    ['境界: --brand on --brand-tint 4.59（ぎりぎり・L2 の未決）', ratio(T['--brand'], T['--brand-tint']), 4.59],
    ['★ --success-tint 半透明 .12 の上の --success は 4.27（却下 → 不透明 #E9F5EF）', ratio(T['--success'], 'rgb(23 122 79 / .12)'), 4.27],
    ['★ --danger-tint 半透明 .12 の上の --danger は 4.36（却下 → 不透明 #FBECEC）', ratio(T['--danger'], 'rgb(192 53 53 / .12)'), 4.36],
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
    // --axis は図形の線（数直線の軸）。2.65 で 3:1 に届かず、オーナー選択で
    // 「文字を併記するので WCAG 1.4.11 の必須対象にしない」とした（DESIGN §5-1・2026-09-18）。区切り線 1.3 だけ課す
    ...onSurfaces('--axis', ['--bg', '--card']),
  ]
  const run = (label: string, pairs: Pair[], min: number) => {
    const rows: string[] = []
    for (const [fg, bg] of pairs) {
      const r = ratio(T[fg], T[bg])
      check(`${label} ${min}: ${fg} on ${bg} = ${r.toFixed(2)}`, r >= min)
      rows.push(`${fg} on ${bg} ${r.toFixed(2)}`)
    }
    // 測った値の一覧（DESIGN.md §5-1 の「検査が毎回計算」の欄の正）。閾値は上の check が課す
    console.log(`  情報: 実測一覧（${label.replace(' ≥', '')}・${min} 以上）: ${rows.join(' / ')}`)
  }
  run('文字 ≥', text, TEXT)
  run('輪郭 ≥', outline, OUTLINE)
  run('区切り線 ≥', line, LINE)

  // 向きの規則（DECISIONS 2026-10-12）: ホバーは濃い方向、注意は青緑より濃い（光らせない）
  const lum = (k: string) => luminance(effective(T[k]))
  check('向き: --brand-strong は --brand より濃い（明るい地のホバーは「濃く」。暗い地の「明るく」から反転）', lum('--brand-strong') < lum('--brand'))
  check('向き: --warning-ink は --brand より濃い（注意を光らせず、濃い文字として沈める＝画面で一番濃い有彩色）', lum('--warning-ink') < lum('--brand'))

  // 参考値（閾値は課さない。使い方の制約として DESIGN に書かれている数字）
  console.log('  情報: --card vs --bg', ratio(T['--card'], T['--bg']), '（単独では見分けにくい → 必ず --border と対で使う）')
  console.log('  情報: --surface vs --bg', ratio(T['--surface'], T['--bg']), '／ --brand-tint vs --bg', ratio(T['--brand-tint'], T['--bg']))
  console.log('  情報: --rule-line vs --surface', ratio(T['--rule-line'], T['--surface']), '（1.3 未満 → --rule-line は --bg と --card の上だけ）')
  console.log('  情報: --muted on --brand-tint', ratio(T['--muted'], T['--brand-tint']), '（選択中の下地の上の注記）')
  console.log('  情報: --axis on --bg', ratio(T['--axis'], T['--bg']), '（3:1 には届かない・図形の線だけ）')
  // R5: にじみの中心（青緑 .22 を地に重ねた色）の上の --muted。12px の注記・免責をにじみの上に置かない根拠
  const bloom = hex(effective('rgb(45 212 191 / .22)'))
  console.log('  情報: にじみの中心', bloom, 'の上の --muted', ratio(T['--muted'], bloom), '／ --ink-2', ratio(T['--ink-2'], bloom), '（R5: 注記・免責はにじみの上に置かない）')
}

function navChecks() {
  console.log('■ components/SiteNav.tsx・StockSearch.tsx')
  const nav = read('components/SiteNav.tsx')
  // 注釈を落として見る（注釈に「旧 emerald は…」「暗い地用の logo-night.svg」と書いてあるので、生ファイルでは誤検知する）
  const navSrc = stripTsComments(nav)
  check('SiteNav: text-emerald-700 が残っていない（旧ブランド色の残り・DESIGN §10 P1。注釈を除く）', !navSrc.includes('text-emerald'))
  check('SiteNav: 現在地の下部ナビは text-brand', nav.includes("active ? 'text-brand font-semibold' : 'text-muted'"))
  // `/` だけの出し分け（const night = path === '/'・data-theme={theme}）は無いまま。usePathname は現在地の判定にだけ使う
  check("SiteNav: `/` だけの出し分けが無い（const night / theme / data-theme を持たない）",
    !navSrc.includes("path === '/'") && !navSrc.includes('data-theme') && !/\bconst (?:night|theme)\b|\{night\b|\btheme\}/.test(navSrc))
  check('SiteNav: ロゴは全ページで元のファイル（logo.svg / logo-mark.svg）・暗い地用の *-night.svg を src に使っていない',
    navSrc.includes('src="/logo.svg"') && navSrc.includes('src="/logo-mark.svg"') && !navSrc.includes('-night.svg'))
  // L2（2026-10-14 決定(2)③⑤）: 帯の境目は 1px の線ではなく影。ヘッダーはスクロールされているときだけ、下部ナビは常に（内容の上に浮いている）。backdrop-blur は撤去
  check('SiteNav: ヘッダー・下部ナビの帯は bg-panel（= --card）。線（border-b／border-t border-border）と backdrop-blur を持たず、境目は影（ヘッダーは scrolled のときだけ・下部ナビは上向き）',
    !/border-[bt] border-border|backdrop-blur/.test(navSrc) && navSrc.includes("const HEADER_SHADOW = 'shadow-[0_1px_3px_-1px_rgb(0_0_0_/_.12)]'") && navSrc.includes("${scrolled ? HEADER_SHADOW : ''}")
      && navSrc.includes("const BOTTOM_SHADOW = 'shadow-[0_-1px_3px_-1px_rgb(0_0_0_/_.12)]'") && navSrc.includes('bg-panel ${BOTTOM_SHADOW}') && (navSrc.match(/bg-panel/g) ?? []).length === 2)
  // 2026-09-25 S1b（レビュー指摘）: hint の文言は固定しない。原則12 が守るのは href・label・順序の3つ
  const navBody = navSrc.slice(navSrc.indexOf('export const NAV = ['), navSrc.indexOf('] as const'))
  const navEntries = [...navBody.matchAll(/\{ href: '([^']+)',\s+label: '([^']+)',\s+hint: '[^']*' \}/g)].map(m => [m[1], m[2]])
  // 2026-10-19 オーナー決定（S-L1b）: 3段から**4段**へ（1段目に「学ぶ」・「読み返す」の段の呼び名を「振り返り」に）。
  // /watch は段に置かない（フッターの常設リンク。scripts/check-watch-reachable.ts）
  const NAV_FIXED = [['/study', '学ぶ'], ['/learn', 'くらべる'], ['/trade', '書く'], ['/review', '振り返り']]
  check('SiteNav: NAV の href・label・順序が変わっていない（原則12・4段。hint の文言は固定しない）', JSON.stringify(navEntries) === JSON.stringify(NAV_FIXED) && nav.includes('] as const'), JSON.stringify(navEntries))
  // 段の番号は 2026-10-19 に全廃（DESIGN.md §6-7・§10-00）。下部ナビは4列で、番号の span を描かない
  check('SiteNav: 下部ナビは grid-cols-4・段の番号（{i + 1}）を描かない', navSrc.includes('grid grid-cols-4') && !navSrc.includes('grid-cols-3') && !/\{i \+ 1\}/.test(navSrc))

  const search = stripTsComments(read('components/StockSearch.tsx'))
  check('StockSearch: 既製色の札（bg-red-50/text-red-700/bg-blue-50/text-blue-700）が無い', !/bg-red-50|text-red-700|bg-blue-50|text-blue-700/.test(search))
  check('StockSearch: 市場の札は無彩色のトークン（bg-surface text-ink-2＝くぼみの札）', search.includes('rounded bg-surface text-ink-2'))
  check('StockSearch: 回る輪の切れ目は border-t-ink（border-t-white を使わない）', search.includes('border-t-ink') && !search.includes('border-t-white'))
  check('StockSearch: 候補の面は bg-background＋行 bg-card・ホバー bg-surface（hover:bg-border を使わない）',
    search.includes('bg-background border border-border rounded-lg overflow-hidden z-50 shadow-float') && search.includes('bg-card hover:bg-surface') && !search.includes('hover:bg-border'))
  check('StockSearch: 影は shadow-float（Tailwind 既定の shadow-xl を使わない）', !search.includes('shadow-xl'))
}

function routeChecks() {
  console.log('■ app/(night)/・app/layout.tsx')
  check('app/page.tsx は無い（app/(night)/page.tsx へ移動済み。両方あると / が衝突する）', !exists('app/page.tsx') && exists('app/(night)/page.tsx'))
  const layoutRaw = exists('app/(night)/layout.tsx') ? read('app/(night)/layout.tsx') : ''
  const layout = stripTsComments(layoutRaw)
  check('app/(night)/layout.tsx がある（にじみを page の外に置く器。フォルダ名は履歴のまま）', layoutRaw.length > 0)
  check("layout: 'use client' を付けていない（Server Component のまま）", !/['"]use client['"]/.test(layout))
  check('layout: data-theme を持たない（明暗2本を持たない）', !layout.includes('data-theme'))
  check('layout: 地を 100vmax の box-shadow で塗る仕掛けが無い（<body> の bg-background が地）', !layout.includes('100vmax'))
  check('layout: viewport の上書きが無い（root の themeColor と同値になるため撤去）', !layout.includes('export const viewport'))
  check('layout: フッターの枠を持たない（app/layout.tsx へ移して全ページに）', !layout.includes('<footer'))
  // L2（2026-10-14 決定(2)④）: にじみ（radial-gradient の2つ）は撤去した。ホームにグラデーションを置かない（design-taste-frontend の規則）。
  // L1 で残していた明るい #2DD4BF の「淡い刷毛」もここには無い（図の強調点だけに残る）
  check('layout: にじみが無い（radial-gradient・aria-hidden・-z-10 が 0 件）・children をそのまま返す', (layout.match(/radial-gradient|gradient\(/g) ?? []).length === 0 && !layout.includes('-z-10') && layout.includes('return <>{children}</>'))
  check('layout: 明るい青緑 rgb(45 212 191 と藍 rgb(129 140 248 の直値が無い（にじみごと撤去）', !layout.includes('rgb(45_212_191') && !layout.includes('rgb(129_140_248'))
  const page = exists('app/(night)/page.tsx') ? read('app/(night)/page.tsx') : ''
  check("page: 'use client' のまま", /^'use client'/.test(page))
  check('page: 旧の --surface の地の塗り（shadow-[0_0_0_100vmax_var(--surface)]）を持たない', !page.includes('var(--surface)]') && !page.includes('shadow-[0_0_0_100vmax_var(--surface)]'))
  // 2026-09-29 S2「プレゼン型ホーム」の目印（詳細は scripts/check-entry.ts・check-answer-examples.ts）。L1 では page.tsx に触らない（構成の作り直しは L2）
  // 2026-10-25（Steep の様式で作る investsim 版）の目印。構成の詳細は scripts/check-entry.ts（明朝の2行の見出し・4段・見た目の値・法務）
  check('page: 中身の目印（見出し「買う理由を書いて、残す。」・主ボタン /trade「1件目のメモを書く」・4段の data-stage（study／compare／write／review）と見出し labelOf・AIの実例の選び方・共通部品の免責）',
    page.includes('買う理由を書いて、残す。') && page.includes('1件目のメモを書く') && page.includes('href="/trade"')
      && ['study', 'compare', 'write', 'review'].every(k => page.includes(`data-stage="${k}"`))
      && ['/study', '/learn', '/trade', '/review'].every(h => page.includes(`{labelOf('${h}')}</h2>`))
      && page.includes('判断日が古い順に、値上がりした例と値下がりした例を1件ずつ。') && page.includes('<Disclaimer part="general" />')
      && !page.includes('与えて、返ってくる') && !page.includes('同じ1件が、こう変わる')
      && !page.includes('株を売り買いする前に、その理由を書いて残す場所です。') && !page.includes('このサイトは、3つの画面でできています'))
  const rootLayout = stripTsComments(read('app/layout.tsx'))
  check("app/layout.tsx: root の viewport は明るい地（themeColor '#F6F8FB'・colorScheme 'light'）", rootLayout.includes("themeColor: '#F6F8FB'") && rootLayout.includes("colorScheme: 'light'"))
  check("app/layout.tsx: 暗い地の値（'#0A0C10'・colorScheme 'dark'）が残っていない", !rootLayout.includes('#0A0C10') && !rootLayout.includes("colorScheme: 'dark'"))
  check('app/layout.tsx: <body> は bg-background text-ink（トークン経由。直値の色を書かない）', rootLayout.includes('<body className="min-h-full flex flex-col bg-background text-ink">'))
  const footer = rootLayout.slice(rootLayout.indexOf('<footer'), rootLayout.indexOf('</footer>'))
  // L2（2026-10-14 決定(2)③）: フッターと本文の境目は線（border-t）ではなく空白（mt-16）
  check('app/layout.tsx: フッターの枠（R10）を全ページに＝<main> の外・線ではなく空白（mt-16・border-t 無し）・small/--muted・<a> にしない（行き先が未整備）',
    footer.length > 0 && rootLayout.indexOf('</main>') < rootLayout.indexOf('<footer') && !footer.includes('border-t') && footer.includes('mt-16') && footer.includes('text-small text-muted') && !footer.includes('<a')
      && ['InvestSim', '運営者情報', 'お問い合わせ', 'プライバシーポリシー', '利用規約', '準備中'].every(w => footer.includes(w)))
  check('app/layout.tsx: スマホの下部ナビに隠れない余白（pb-20 md:pb-5）はフッターが持つ（<main> からは外した）', footer.includes('pb-20 md:pb-5') && !/<main className="[^"]*pb-20/.test(rootLayout))
  // 範囲印がどこにも残っていないこと（app・components の .tsx）
  const files: string[] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.next') walk(p) }
      else if (/\.tsx$/.test(e.name)) files.push(p)
    }
  }
  for (const d of ['app', 'components']) walk(path.join(ROOT, d))
  const withTheme = files.filter(f => stripTsComments(fs.readFileSync(f, 'utf8')).includes('data-theme')).map(f => path.relative(ROOT, f).replace(/\\/g, '/'))
  check(`data-theme 属性が app/・components/ のどこにも無い（走査 ${files.length} ファイル）`, withTheme.length === 0, withTheme.join(', '))
  // #2DD4BF（明るい青緑）を文字に使っていない（不変条件）。text-[#2DD4BF] / color: '#2DD4BF' の形を見る。にじみ・影の rgb(45 212 191 は対象外
  const tealText = files.filter(f => /text-\[#2DD4BF\]|color:\s*['"]#2DD4BF['"]/i.test(stripTsComments(fs.readFileSync(f, 'utf8')))).map(f => path.relative(ROOT, f).replace(/\\/g, '/'))
  check('#2DD4BF を文字色に使っていない（明るい地で 1.75。にじみと図の強調点だけ＝DECISIONS 2026-10-12 不変条件）', tealText.length === 0, tealText.join(', '))
}

function logoChecks() {
  console.log('■ ロゴ（明るい地＝元のファイルが正。暗い地用は残す）')
  const svgColors = (svg: string) => [...svg.matchAll(/(?:fill|stop-color)="(#[0-9A-Fa-f]{6})"/g)].map(m => m[1])
  const geometry = (svg: string) => [...svg.matchAll(/<(?:path|circle|rect)\b[^>]*?(?:\sd="[^"]*"|\scx="[^"]*"\scy="[^"]*"\sr="[^"]*")/g)].map(m => m[0].replace(/\s(?:fill|stop-color)="[^"]*"/g, ''))
  check('public/logo.svg は無傷（文字 #0D1725 ×2・mk 始点 #172F55。2026-09-11 オーナー提供の幾何）', (read('public/logo.svg').match(/fill="#0D1725"/g) ?? []).length === 2 && read('public/logo.svg').includes('stop-color="#172F55"'))
  check('public/logo-mark.svg は無傷（mk 始点 #172F55・暗い地用の白 #EEF1F5 を含まない）', read('public/logo-mark.svg').includes('stop-color="#172F55"') && !read('public/logo-mark.svg').includes('#EEF1F5'))
  check(`public/logo.svg: 文字の色 #0D1725 は地 #F6F8FB の上で 4.5 以上（${ratioRaw('#0D1725', '#F6F8FB')}）`, ratioRaw('#0D1725', '#F6F8FB') >= 4.5)
  for (const [orig, night] of [['public/logo.svg', 'public/logo-night.svg'], ['public/logo-mark.svg', 'public/logo-mark-night.svg']]) {
    check(`${night} は削除していない（暗い地に戻すときのために残す）`, exists(night))
    if (!exists(night)) continue
    const o = read(orig), n = read(night)
    check(`${night}: 幾何（path / circle）が ${orig} と同一のまま`, JSON.stringify(geometry(o)) === JSON.stringify(geometry(n)) && geometry(n).length > 0, `${geometry(o).length} vs ${geometry(n).length}`)
    const dark = svgColors(n).filter(c => ratioRaw(c, '#0A0C10') < 3.0)
    check(`${night}: 暗い地 #0A0C10 の上で 3:1 以上のまま（記録。いまは使っていない）`, dark.length === 0, dark.map(c => `${c}=${ratioRaw(c, '#0A0C10')}`).join(', '))
  }
  check('app/icon.svg は今回触っていない（白い角丸タイルのまま。判断は S7 の残り）', read('app/icon.svg').includes('rx="88" fill="#FFFFFF"'))
  const login = stripTsComments(read('app/auth/login/page.tsx'))
  check('ログイン画面: ロゴは元の logo.svg・暗い地用の logo-night.svg を src に使っていない', login.includes('src="/logo.svg"') && !login.includes('-night.svg'))
  check('ログイン画面: 既製色（text-red-* / bg-red-* / border-red-*）が無い。エラー帯は role="alert"＋text-danger bg-danger-tint', !/text-red-|bg-red-|border-red-/.test(login) && login.includes('role="alert" className="mb-4 text-caption text-danger bg-danger-tint'))
  check('ログイン画面: Google ロゴの公式色（#4285F4 / #34A853 / #FBBC05 / #EA4335）は変えない', ['#4285F4', '#34A853', '#FBBC05', '#EA4335'].every(c => login.includes(`fill="${c}"`)))
}

function chartChecks() {
  console.log('■ チャート（components/chartTheme.ts・StockChart.tsx）')
  const theme = read('components/chartTheme.ts')
  const fallbackBody = theme.slice(theme.indexOf('const FALLBACK: ChartTheme = {'), theme.indexOf('}', theme.indexOf('const FALLBACK: ChartTheme = {')))
  const fb = (k: string) => (new RegExp(`\\b${k}:\\s*'(#[0-9A-Fa-f]{6})'`).exec(fallbackBody) ?? [])[1]
  // FALLBACK は :root のトークンを白 #FFFFFF（チャートの面 --card）に合成した実効色（SSR・取得失敗時の保険）
  const onWhite = (k: string) => hex(effective(TOKENS[k], WHITE))
  const expectFb: Record<string, string> = {
    background: onWhite('--card'), text: onWhite('--muted'), grid: onWhite('--border'), border: onWhite('--border'),
    ink: onWhite('--ink'), ink2: onWhite('--ink-2'), muted: onWhite('--muted'), accent: onWhite('--brand'),
  }
  const fbProblems = Object.entries(expectFb).filter(([k, v]) => (fb(k) ?? '').toUpperCase() !== v).map(([k, v]) => `${k}: 期待 ${v} 実際 ${fb(k)}`)
  check('chartTheme.ts: FALLBACK は :root を白に合成した実効色（background #FFFFFF・text #64686F・grid/border #D1D1D1・ink #111111・ink2 #4A4D55・accent #0F766E）', fbProblems.length === 0, fbProblems.join(' / '))
  check('chartTheme.ts: 暗い地の実効色（#131518 / #878A8E / #313336 / #EEF1F5 / #A0A3A7 / #2DD4BF）が残っていない', !/#131518|#878A8E|#313336|#EEF1F5|#A0A3A7|#2DD4BF/i.test(stripTsComments(theme)))
  check('chartTheme.ts: SERIES.earnings は #A8761F（明るい地 3.74。旧 #C08A2E は 2.85）', /earnings:\s*\{\s*color:\s*'#A8761F'/.test(theme) && !/color:\s*'#C08A2E'/.test(theme))
  check('chartTheme.ts: 他の4系列は変えていない（you #5681DC / ai #8E5BC4 / master #C26A2A / baseline #7C889B）',
    /you:\s*\{\s*color:\s*'#5681DC'/.test(theme) && /ai:\s*\{\s*color:\s*'#8E5BC4'/.test(theme) && /master:\s*\{\s*color:\s*'#C26A2A'/.test(theme) && /baseline:\s*\{\s*color:\s*'#7C889B'/.test(theme))
  const stock = stripTsComments(read('components/StockChart.tsx'))
  check('StockChart: ローソク足は上げ＝中空（面 th.background＝--card 白・不透明）／下げ＝th.ink2 の塗り（--ink だと黒い壁）・輪郭と芯は th.ink',
    /upColor:\s*th\.background,\s*downColor:\s*th\.ink2/.test(stock) && stock.includes('borderUpColor: th.ink, borderDownColor: th.ink') && stock.includes('wickUpColor: th.ink, wickDownColor: th.ink'))
  check('StockChart: ローソク足を緑・赤で塗り分けていない（--success / --danger を使わない）', !/upColor:\s*th\.(?:success|danger)|downColor:\s*th\.(?:success|danger)|#(?:16A34A|22C55E|DC2626|EF4444|3FA96F|F87171)/i.test(stock))
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
  // 2026-09-29 S1「3段の道」: app/(night)/page.tsx はプレビュー②（読み込み中の骨組み）を右列ごと撤去したので外した。
  // S2「プレゼン型ホーム」（同日）の読み込み表示は動かない薄い枠（aria-busy）にしたので、戻していない
  const ALLOWED: Record<string, string> = {
    'app/learn/page.tsx': '結果の読み込み中の骨組み（data-skeleton）と、AIレポートが流れてくる間だけ点滅する書き込み位置の印',
    'app/review/page.tsx': '読み込み中の骨組み（aria-busy）',
    'app/watch/client.tsx': 'セッション復元中の骨組み（aria-busy）',
    'app/simulate/page.tsx': '実行中の回る輪',
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
chartChecks()
motionChecks()

console.log('')
console.log(`PASS ${passed} 件 / FAIL ${failed} 件`)
if (failed) process.exit(1)
console.log('すべてPASS')
