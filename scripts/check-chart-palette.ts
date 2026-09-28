// チャートの系列色（components/chartTheme.ts の SERIES）の検査。
//   $env:PATH = "C:\Program Files\nodejs;$env:PATH"; npx tsx scripts/check-chart-palette.ts
//   npx tsx scripts/check-chart-palette.ts --mode dark     # 地を #0A0C10（DECISIONS 2026-09-24）に固定
//   npx tsx scripts/check-chart-palette.ts --mode light    # 地を #F6F8FB（DESIGN.md §5-1 明るい地の表）に固定
//   npx tsx scripts/check-chart-palette.ts --bg "#123456"  # 任意の地で検査
//   引数が無ければ app/globals.css の :root { --bg } を読む（:root が変わればそのまま追随する）。
//
// ■ なぜ作ったか
//   DESIGN.md §5-1 と chartTheme.ts はかつて「dataviz スキルの validate_palette.js（色覚多様性の検査）
//   5項目すべて合格」と記録していたが、その道具はリポジトリにもこの PC にも無かった（qa 2026-09-25 が
//   find と git log --all で確認）。合格の記録だけがあり誰も再実行できなかったので、同じ趣旨の検査を
//   自前の計算で再現し、以後はこのファイルを正にした（chartTheme.ts の該当箇所も check-chart-palette.ts を
//   指すよう直し済み）。外部ライブラリは足していない。
//
// ■ 何を検査するか（「5項目」の再現。閾値と根拠は各項目のコメントに）
//   1. 地とのコントラスト（図形）      … 各系列色・指標線 vs 地が 3:1 以上（WCAG 2.1 1.4.11）
//   2. 系列同士の色差                  … 4系列の全ペアで CIE76 ΔE ≥ 8。指標線は同じ図に出る組だけ
//   3. 色覚多様性                      … 1型/2型/3型のシミュレーション後も全ペアで ΔE ≥ 8
//   4. 明度の帯                        … L* が地から離れ、4色の L* の幅が 40 以内
//   5. 線の形での冗長性                … chartTheme.ts に系列ごとの線種の指定がある（§6-14）
//   さらに「検算」として、白 #FFFFFF の上の比が DESIGN.md §5-1 の記録（5.40 / 4.73 / 3.90 / 3.59）と
//   一致することを確かめる（手順そのものが正しい証拠。地の指定に関係なく毎回走る）。検算に使う色は
//   記録が取られた 2026-09-11 の4色を固定で持つ（SERIES の今の値ではない。you は SV1c で差し替えた）。
//   FAIL があっても最後まで走り切り、落ちた色には「情報:」行で置き換え候補（同じ色相で L* を
//   5 ずつ動かし、1〜4 を通る最初の値。ブランド色 #2DD4BF / #3FA96F / #F87171 は出さない）を出す。
//
// ■ 使った式と出典
//   - sRGB → 線形: IEC 61966-2-1 の伝達関数（c ≤ 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4）。
//     WCAG 2.1 の式は閾値が 0.03928 だが、8bit の値で 0.03928〜0.04045 に落ちるものは無い
//     （10/255 = 0.0392、11/255 = 0.0431）ので結果は同じ。check-night-theme.ts と同じ数字が出る。
//   - 線形 RGB → XYZ（D65）: sRGB の標準行列（Lindbloom "RGB/XYZ Matrices"、sRGB D65）。
//   - XYZ → CIE L*a*b*: CIE 1976 の式（Wikipedia "CIELAB color space"）。基準白は D65
//     (0.95047, 1.00000, 1.08883)。
//   - 色差: CIE76（Lab のユークリッド距離。Wikipedia "Color difference" §CIE76）。
//     CIEDE2000 は式が長いので使っていない（同じ ΔE 8 でも CIEDE2000 より CIE76 の方が大きく出やすい）。
//   - コントラスト比: WCAG 2.1 "relative luminance" と "contrast ratio"（(L1+0.05)/(L2+0.05)）。
//   - 色覚シミュレーション: Machado, Oliveira, Fernandes (2009) "A Physiologically-based Model for
//     Simulation of Color Vision Deficiency", IEEE TVCG 15(6)。補足資料の severity 1.0 の 3×3 行列を
//     線形 RGB に掛ける（colorspacious / DaltonLens と同じ値・同じ適用先）。
//   - 半透明の色（rgb(255 255 255 / .16) 等）は地に α合成した実効色に直してから使う
//     （check-night-theme.ts と同じ手順。sRGB 8bit の単純α、丸めは Math.round）。

import fs from 'fs'
import path from 'path'
import * as chartTheme from '../components/chartTheme'

const { SERIES } = chartTheme

const ROOT = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

let passed = 0
let failed = 0
/** 数値も見せたいので、PASS でも detail を出す（他の check-*.ts は FAIL のときだけ） */
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed++
    console.log(`  PASS ${name}${detail ? '  ' + detail : ''}`)
  } else {
    failed++
    console.log(`  FAIL ${name}${detail ? '  ' + detail : ''}`)
  }
}
const info = (s: string) => console.log(`  情報: ${s}`)
const r2 = (x: number) => Math.round(x * 100) / 100
const r1 = (x: number) => Math.round(x * 10) / 10

// ── 引数 ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
function argValue(flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}
/** --mode の固定値。light は DESIGN.md §5-1「明るい地の表」の --bg、dark は DECISIONS.md 2026-09-24 の --bg */
const MODE_BG: Record<string, string> = { light: '#F6F8FB', dark: '#0A0C10' }

// ── 色の型と解析（check-night-theme.ts と同じ流儀） ──────────────────────
type RGB = [number, number, number] // 0..255 の sRGB
type Lin = [number, number, number] // 0..1 の線形 RGB
type Lab = { L: number; a: number; b: number }

function parseColor(v: string): { rgb: RGB; a: number } {
  const t = v.trim()
  const hex6 = /^#([0-9a-f]{6})$/i.exec(t)
  if (hex6) {
    const n = parseInt(hex6[1], 16)
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], a: 1 }
  }
  const hex8 = /^#([0-9a-f]{8})$/i.exec(t)
  if (hex8) {
    const n = parseInt(hex8[1].slice(0, 6), 16)
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], a: parseInt(hex8[1].slice(6), 16) / 255 }
  }
  const fn = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[/,]\s*([0-9.]+%?))?\s*\)$/.exec(t)
  if (fn) {
    const a = fn[4] == null ? 1 : fn[4].endsWith('%') ? parseFloat(fn[4]) / 100 : +fn[4]
    return { rgb: [+fn[1], +fn[2], +fn[3]], a }
  }
  throw new Error(`色として読めない: ${v}`)
}
/** 半透明を base に α合成した実効色（8bit に丸める） */
function effective(v: string, base: RGB): RGB {
  const { rgb, a } = parseColor(v)
  return rgb.map((c, i) => Math.round(a * c + (1 - a) * base[i])) as RGB
}
const hex = ([r, g, b]: RGB) => '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase()

// ── 色空間の変換 ─────────────────────────────────────────────────────────
/** sRGB 伝達関数の逆（IEC 61966-2-1） */
const lin1 = (c: number) => {
  c /= 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
/** 線形 → sRGB（0..1 → 0..1） */
const unlin1 = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
const toLinear = (rgb: RGB): Lin => rgb.map(lin1) as Lin
/** 線形 → 8bit sRGB。範囲外なら null（色域の外＝表示できない） */
function fromLinear(l: Lin): RGB | null {
  const eps = 1e-6
  if (l.some(c => c < -eps || c > 1 + eps)) return null
  return l.map(c => Math.round(unlin1(Math.min(1, Math.max(0, c))) * 255)) as RGB
}

type Mat3 = [[number, number, number], [number, number, number], [number, number, number]]
const mul = (m: Mat3, v: Lin): Lin => m.map(row => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]) as Lin

/** 線形 sRGB → XYZ（D65）。Lindbloom "RGB/XYZ Matrices" の sRGB 行 */
const M_RGB2XYZ: Mat3 = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.072175],
  [0.0193339, 0.119192, 0.9503041],
]
/** XYZ → 線形 sRGB（上の逆行列） */
const M_XYZ2RGB: Mat3 = [
  [3.2404542, -1.5371385, -0.4985314],
  [-0.969266, 1.8760108, 0.041556],
  [0.0556434, -0.2040259, 1.0572252],
]
const WHITE: Lin = [0.95047, 1.0, 1.08883] // D65

/** XYZ → L*a*b*（CIE 1976。Wikipedia "CIELAB color space" の f(t) を使う） */
function xyzToLab([X, Y, Z]: Lin): Lab {
  const d = 6 / 29
  const f = (t: number) => (t > d ** 3 ? Math.cbrt(t) : t / (3 * d * d) + 4 / 29)
  const fx = f(X / WHITE[0]), fy = f(Y / WHITE[1]), fz = f(Z / WHITE[2])
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) }
}
function labToXyz({ L, a, b }: Lab): Lin {
  const d = 6 / 29
  const finv = (t: number) => (t > d ? t ** 3 : 3 * d * d * (t - 4 / 29))
  const fy = (L + 16) / 116
  return [WHITE[0] * finv(fy + a / 500), WHITE[1] * finv(fy), WHITE[2] * finv(fy - b / 200)]
}
const labOfLinear = (l: Lin) => xyzToLab(mul(M_RGB2XYZ, l))
const lab = (rgb: RGB) => labOfLinear(toLinear(rgb))
/** CIE76: Lab のユークリッド距離 */
const deltaE = (p: Lab, q: Lab) => Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b)

/** WCAG 2.1 相対輝度（= XYZ の Y。係数は WCAG の 0.2126 / 0.7152 / 0.0722） */
function luminance(rgb: RGB): number {
  const [r, g, b] = toLinear(rgb)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// ── 色覚シミュレーション（Machado et al. 2009, severity 1.0, 線形 RGB に適用） ─
const CVD: Record<string, { label: string; m: Mat3 }> = {
  protan: {
    label: '1型（P型・赤の感度が無い）',
    m: [
      [0.152286, 1.052583, -0.204868],
      [0.114503, 0.786281, 0.099216],
      [-0.003882, -0.048116, 1.051998],
    ],
  },
  deutan: {
    label: '2型（D型・緑の感度が無い）',
    m: [
      [0.367322, 0.860646, -0.227968],
      [0.280085, 0.672501, 0.047413],
      [-0.01182, 0.04294, 0.968881],
    ],
  },
  tritan: {
    label: '3型（T型・青の感度が無い）',
    m: [
      [1.255528, -0.076749, -0.178779],
      [-0.078411, 0.930809, 0.147602],
      [0.004733, 0.691367, 0.3039],
    ],
  },
}
/** シミュレーション後の Lab。行列の出力は色域をはみ出すことがあるので 0..1 に切る */
function simulatedLab(rgb: RGB, type: keyof typeof CVD): Lab {
  const out = mul(CVD[type].m, toLinear(rgb)).map(c => Math.min(1, Math.max(0, c))) as Lin
  return labOfLinear(out)
}

// ── 地の色の決定 ─────────────────────────────────────────────────────────
const stripCssComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')
function cssBlock(css: string, selector: string): string | null {
  const i = css.indexOf(`${selector} {`)
  if (i < 0) return null
  const j = css.indexOf('\n}', i)
  return j < 0 ? null : css.slice(i + selector.length + 2, j)
}
function declaration(body: string, name: string): string | null {
  for (const line of stripCssComments(body).split('\n')) {
    const mm = /^\s*([a-zA-Z-][a-zA-Z0-9-]*)\s*:\s*(.+?)\s*;/.exec(line)
    if (mm && mm[1] === name) return mm[2].replace(/\s+/g, ' ')
  }
  return null
}

function resolveBackground(): { value: string; source: string; card: string | null } {
  const bgArg = argValue('--bg')
  const mode = argValue('--mode')
  const css = read('app/globals.css')
  const root = cssBlock(css, ':root') ?? ''
  const card = declaration(root, '--card')
  if (bgArg) return { value: bgArg, source: '--bg 引数', card: null }
  if (mode) {
    if (!(mode in MODE_BG)) {
      console.error(`--mode は light か dark（受け取った値: ${mode}）`)
      process.exit(2)
    }
    return { value: MODE_BG[mode], source: `--mode ${mode}`, card: null }
  }
  const bg = declaration(root, '--bg')
  if (!bg) {
    console.error('app/globals.css の :root に --bg が無い')
    process.exit(2)
  }
  return { value: bg, source: 'app/globals.css :root --bg', card }
}

const BG_SRC = resolveBackground()
const bgParsed = parseColor(BG_SRC.value)
if (bgParsed.a < 1) {
  console.error(`地の色 --bg は不透明でなければならない: ${BG_SRC.value}`)
  process.exit(2)
}
const BG: RGB = bgParsed.rgb
const BG_LAB = lab(BG)
/** 地の L* が 50 未満なら暗い地（閾値は仮）。項目4の判定向き・候補の探索方向に使う */
const IS_DARK = BG_LAB.L < 50

// ── 検査対象 ─────────────────────────────────────────────────────────────
const FOUR = ['you', 'ai', 'master', 'baseline'] as const
type SeriesKey = (typeof FOUR)[number]
const LABEL: Record<SeriesKey, string> = { you: 'あなた', ai: 'AI', master: '著名投資家', baseline: '基準' }
/** 指標線。同じ図に同時に出る組（主図: ma20 / ma50 / ma200 / band、MACD 図: macd / signal）だけ色差を見る。
 *  rsi は band と同値だが別の図（RSI パネル）に単独で出るので、地とのコントラストは別枠で検査する
 *  （2026-09-28 SV1c レビュー指摘 W4: これまで漏れていて band と同値のまま偶然 PASS していた）。 */
const INDICATORS = ['ma20', 'ma50', 'ma200', 'band', 'rsi', 'macd', 'signal', 'earnings'] as const
const INDICATOR_PAIRS: [string, string][] = [
  ['ma20', 'ma50'], ['ma20', 'ma200'], ['ma20', 'band'], ['ma50', 'ma200'], ['ma50', 'band'], ['ma200', 'band'],
  ['macd', 'signal'],
]
/** 候補に出してはいけない色（DESIGN.md §5-1: 青緑・利益・損失はチャートの線に使わない） */
const BRAND_FORBIDDEN = ['#2DD4BF', '#3FA96F', '#F87171']

type Palette = Record<SeriesKey, RGB>
/**
 * SERIES[key] の色。SV1c（2026-09-28）で値が色の文字列から { color, dash, width } になったので両方を受ける
 * （文字列なら旧形式）。無ければ止める（存在しない鍵を黙って通さない）。
 */
function colorOf(key: string): string {
  const raw = (SERIES as Record<string, unknown>)[key]
  if (typeof raw === 'string') return raw
  if (raw && typeof raw === 'object' && typeof (raw as { color?: unknown }).color === 'string') return (raw as { color: string }).color
  throw new Error(`chartTheme.SERIES.${key} に色が無い`)
}
/** SERIES の値は不透明 hex だが、将来 rgb(… / α) が来ても地に合成してから使う */
const seriesRgb = (key: string): RGB => effective(colorOf(key), BG)
const ORIGINAL: Palette = { you: seriesRgb('you'), ai: seriesRgb('ai'), master: seriesRgb('master'), baseline: seriesRgb('baseline') }

// ── 各項目の判定（検査と候補探索の両方で同じ関数を使う） ──────────────────
// 1. 図形のコントラスト 3:1（WCAG 2.1 1.4.11 Non-text Contrast）。
//    baseline は細い補助線なので DESIGN.md の --axis と同じ扱い＝3:1 未満でも FAIL にしない
//    （2.5 以上は警告、2.5 未満は情報行）。値・目安の語が文字で併記されるのが前提。
const MIN_CONTRAST = 3.0
const BASELINE_WARN = 2.5
const contrastOk = (key: SeriesKey, rgb: RGB) => key === 'baseline' || contrast(rgb, BG) >= MIN_CONTRAST

// 2. 系列同士の色差 CIE76 ΔE ≥ 8（dataviz スキルの「隣接 ΔE ≥ 8」。DECISIONS.md 2026-09-24 に記録）
const MIN_DE = 8
const pairs = <T,>(xs: readonly T[]): [T, T][] => xs.flatMap((a, i) => xs.slice(i + 1).map(b => [a, b] as [T, T]))
const pairsOk = (p: Palette) => pairs(FOUR).every(([a, b]) => deltaE(lab(p[a]), lab(p[b])) >= MIN_DE)

// 3. 色覚シミュレーション後も全ペア ΔE ≥ 8（同じ閾値。DECISIONS.md 2026-09-11 の
//    「2型で ΔE 6.9 は 6〜8 帯＝色以外の手がかり併用時のみ可」という帯の記録に合わせ、6〜8 は帯名を添える）
const cvdOk = (p: Palette) =>
  (Object.keys(CVD) as (keyof typeof CVD)[]).every(t =>
    pairs(FOUR).every(([a, b]) => deltaE(simulatedLab(p[a], t), simulatedLab(p[b], t)) >= MIN_DE))

// 4. 明度の帯（閾値は仮置き）: 暗い地なら L* ≥ 45、明るい地なら L* ≤ 70。4色の L* の幅は 40 以内
//    （1色だけ飛び抜けて目立たない）。
const L_MIN_ON_DARK = 45
const L_MAX_ON_LIGHT = 70
const L_SPREAD_MAX = 40
const lightnessOk = (rgb: RGB) => (IS_DARK ? lab(rgb).L >= L_MIN_ON_DARK : lab(rgb).L <= L_MAX_ON_LIGHT)
const spreadOk = (p: Palette) => {
  const Ls = FOUR.map(k => lab(p[k]).L)
  return Math.max(...Ls) - Math.min(...Ls) <= L_SPREAD_MAX
}

/** 1〜4 を全部通るか（5 は色に依らないので候補探索から外す） */
const colorItemsOk = (p: Palette) =>
  FOUR.every(k => contrastOk(k, p[k]) && lightnessOk(p[k])) && pairsOk(p) && cvdOk(p) && spreadOk(p)

// ── 検算: 手順が DESIGN.md §5-1 の記録（白の上）を再現するか ──────────────
function verifyAgainstRecord() {
  console.log('\n[検算] 白 #FFFFFF の上の比が DESIGN.md §5-1 の記録（2026-09-11 の4色）と一致するか（地の指定に関係なく毎回）')
  const WHITE_RGB: RGB = [255, 255, 255]
  // 検算は「計算の手順が正しいか」を見るものなので、記録が取られた当時の色を固定で使う
  // （SERIES の今の値ではない。you は SV1c（2026-09-28）で #3468C0 → #5681DC に差し替えたため、今の値では 5.40 にならない）
  const RECORD_HEX: Record<SeriesKey, string> = { you: '#3468C0', ai: '#8E5BC4', master: '#C26A2A', baseline: '#7C889B' }
  const RECORD: Record<SeriesKey, number> = { you: 5.4, ai: 4.73, master: 3.9, baseline: 3.59 }
  for (const k of FOUR) {
    const got = r2(contrast(effective(RECORD_HEX[k], WHITE_RGB), WHITE_RGB))
    check(`検算 ${k} ${RECORD_HEX[k]}（2026-09-11 の値）on #FFFFFF = ${RECORD[k]}`, got === RECORD[k], `実測 ${got}`)
  }
  // ΔE の照合も RECORD_HEX（2026-09-11 の固定4色）で計算する。ここは「今の SERIES がいくつか」ではなく
  // 「手順が過去の記録を再現できるか」を見る検算なので、SERIES の今の値（ORIGINAL）を混ぜない
  // （SV1c で you を差し替えたため ORIGINAL で計算すると記録と合わない数字になり、検算の意味が崩れる）。
  const RECORD_PALETTE: Palette = {
    you: parseColor(RECORD_HEX.you).rgb, ai: parseColor(RECORD_HEX.ai).rgb,
    master: parseColor(RECORD_HEX.master).rgb, baseline: parseColor(RECORD_HEX.baseline).rgb,
  }
  const three = pairs(['you', 'ai', 'master'] as const).map(([a, b]) => ({ a, b, de: deltaE(lab(RECORD_PALETTE[a]), lab(RECORD_PALETTE[b])) }))
  const four = pairs(FOUR).map(([a, b]) => ({ a, b, de: deltaE(lab(RECORD_PALETTE[a]), lab(RECORD_PALETTE[b])) }))
  const min3 = three.reduce((m, x) => (x.de < m.de ? x : m))
  const min4 = four.reduce((m, x) => (x.de < m.de ? x : m))
  info(`記録「最小 ΔE 14.8」との照合（2026-09-11 の固定4色で計算。SERIES の今の値ではない）: CIE76 の最小は ` +
    `3色で ${r1(min3.de)}（${min3.a}–${min3.b}）／4色で ${r1(min4.de)}（${min4.a}–${min4.b}）。` +
    `合わなければ元の道具が CIEDE2000 か別の組で計っていた可能性`)
}

// ── 1. 地とのコントラスト ──────────────────────────────────────────────────
function contrastChecks() {
  console.log(`\n[1] 地とのコントラスト（図形 ${MIN_CONTRAST}:1 以上。WCAG 2.1 1.4.11）  地 = ${hex(BG)}（${BG_SRC.source}）`)
  for (const k of FOUR) {
    const c = r2(contrast(ORIGINAL[k], BG))
    const name = `${LABEL[k]} ${k} ${hex(ORIGINAL[k])} on ${hex(BG)}`
    if (k === 'baseline') {
      // 細い補助線: DESIGN.md の --axis と同じく 1.4.11 の必須対象にしない
      if (c >= MIN_CONTRAST) check(name, true, `${c}`)
      else if (c >= BASELINE_WARN) check(name, true, `${c} 警告: 3:1 未満（細い補助線なので FAIL にしない。2.5 以上）`)
      else info(`${name} = ${c}（3:1 未満・2.5 未満。細い補助線なので FAIL にしないが、値のラベルを必ず併記すること）`)
    } else {
      check(name, c >= MIN_CONTRAST, `${c}`)
    }
  }
  for (const k of INDICATORS) {
    const rgb = seriesRgb(k)
    const c = r2(contrast(rgb, BG))
    check(`指標線 ${k} ${hex(rgb)} on ${hex(BG)}`, c >= MIN_CONTRAST, `${c}`)
  }
  if (BG_SRC.card) {
    // チャートの面は readChartTheme() が --card を読むので、その合成色の上での比も参考に出す
    try {
      const face = effective(BG_SRC.card, BG)
      const rows = FOUR.map(k => `${k} ${r2(contrast(ORIGINAL[k], face))}`).join(' / ')
      info(`参考: チャートの面は --card（${BG_SRC.card} → 合成 ${hex(face)}）。その上の比: ${rows}`)
    } catch {
      info(`参考: --card（${BG_SRC.card}）は色として読めないので面の上の比は省略`)
    }
  }
}

// ── 2. 系列同士の色差 ──────────────────────────────────────────────────────
function pairChecks() {
  console.log(`\n[2] 系列同士の色差（CIE76 ΔE ≥ ${MIN_DE}。dataviz の「隣接 ΔE ≥ 8」）`)
  for (const [a, b] of pairs(FOUR)) {
    const de = deltaE(lab(ORIGINAL[a]), lab(ORIGINAL[b]))
    check(`${a}–${b}`, de >= MIN_DE, `ΔE ${r1(de)}`)
  }
  for (const [a, b] of INDICATOR_PAIRS) {
    const de = deltaE(lab(seriesRgb(a)), lab(seriesRgb(b)))
    check(`指標線 ${a}–${b}（同じ図に出る組）`, de >= MIN_DE, `ΔE ${r1(de)}`)
  }
}

// ── 3. 色覚多様性 ──────────────────────────────────────────────────────────
function cvdChecks() {
  console.log(`\n[3] 色覚多様性（Machado 2009 severity 1.0 で変換後も全ペア ΔE ≥ ${MIN_DE}）`)
  const types = Object.keys(CVD) as (keyof typeof CVD)[]
  for (const [a, b] of pairs(FOUR)) {
    const parts: string[] = []
    const fell: string[] = []
    for (const t of types) {
      const de = deltaE(simulatedLab(ORIGINAL[a], t), simulatedLab(ORIGINAL[b], t))
      const band = de >= MIN_DE ? '' : de >= 6 ? '（6〜8 帯＝線種の併用が必須）' : '（6 未満＝色では見分けられない）'
      parts.push(`${t} ${r1(de)}${band}`)
      if (de < MIN_DE) fell.push(CVD[t].label)
    }
    check(`${a}–${b}`, fell.length === 0, `${parts.join(' / ')}${fell.length ? ` → 落ちた型: ${fell.join('、')}` : ''}`)
  }
}

// ── 4. 明度の帯 ────────────────────────────────────────────────────────────
function lightnessChecks() {
  const rule = IS_DARK ? `暗い地なので L* ≥ ${L_MIN_ON_DARK}` : `明るい地なので L* ≤ ${L_MAX_ON_LIGHT}`
  console.log(`\n[4] 明度の帯（地の L* = ${r1(BG_LAB.L)} → ${rule}。4色の L* の幅 ≤ ${L_SPREAD_MAX}。閾値は仮）`)
  const Ls: number[] = []
  for (const k of FOUR) {
    const L = lab(ORIGINAL[k]).L
    Ls.push(L)
    check(`${k} ${hex(ORIGINAL[k])}`, lightnessOk(ORIGINAL[k]), `L* ${r1(L)}`)
  }
  const spread = Math.max(...Ls) - Math.min(...Ls)
  check(`4色の L* の幅 ≤ ${L_SPREAD_MAX}`, spread <= L_SPREAD_MAX, `幅 ${r1(spread)}（${r1(Math.min(...Ls))}〜${r1(Math.max(...Ls))}）`)
}

// ── 5. 線の形での冗長性 ────────────────────────────────────────────────────
// 色だけに頼らない（DESIGN.md §6-14「系列は色に加えて線の形でも区別する」）。
// 受け付ける形: (a) SERIES[key] が { color, dash|style|lineStyle } のオブジェクト
//                  （dash は SVG の stroke-dasharray と同じ数の並び。空の配列＝実線。SV1c 2026-09-28 で採用した形）、
//              (b) chartTheme.ts の別の export（例 SERIES_LINE）が you/ai/master/baseline を鍵に持ち、
//                  値が文字列か { dash|style|lineStyle, width? } のオブジェクト。
// 2026-09-25 時点の SERIES は色の文字列だけで FAIL だった。SV1c で (a) の形にして通した。
type LineSpec = { style: string; width?: number }
function lineSpecOf(v: unknown): LineSpec | null {
  if (typeof v === 'string') return { style: v }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    let style = o.dash ?? o.style ?? o.lineStyle
    // 配列の dash は SVG の書き方（"6 4"）にそろえる。空なら実線
    if (Array.isArray(style)) style = style.length ? style.map(String).join(' ') : 'solid'
    if (typeof style === 'string' || typeof style === 'number') {
      const width = typeof o.width === 'number' ? o.width : typeof o.lineWidth === 'number' ? o.lineWidth : undefined
      return { style: String(style), width }
    }
  }
  return null
}
function findLineSpecs(): { source: string; specs: Record<SeriesKey, LineSpec> } | null {
  const mod = chartTheme as unknown as Record<string, unknown>
  for (const [name, value] of Object.entries(mod)) {
    if (!value || typeof value !== 'object') continue
    const obj = value as Record<string, unknown>
    if (!FOUR.every(k => k in obj)) continue
    const specs = {} as Record<SeriesKey, LineSpec>
    let ok = true
    for (const k of FOUR) {
      const raw = obj[k]
      // SERIES 自身は値が色の文字列なので、文字列は線種と見なさない
      const spec = name === 'SERIES' && typeof raw === 'string' ? null : lineSpecOf(raw)
      if (!spec) { ok = false; break }
      specs[k] = spec
    }
    if (ok) return { source: name, specs }
  }
  return null
}
function lineShapeChecks() {
  console.log('\n[5] 線の形での冗長性（chartTheme.ts に系列ごとの線種の指定がある。§6-14）')
  const found = findLineSpecs()
  if (!found) {
    const src = read('components/chartTheme.ts').split('\n')
    const noteLine = src.findIndex(l => /実線|破線|点線/.test(l)) + 1
    check('SERIES に線種の指定がある', false,
      `chartTheme.ts に機械で読める線種が無い（注釈 ${noteLine || '?'} 行目に「あなた=実線 / AI=破線 / 著名投資家=点線 / 基準=細い実線」とあるだけ）。` +
      'SERIES を { color, dash } にするか、SERIES_LINE のような export を足す（SV1c）')
    return
  }
  const rows = FOUR.map(k => `${k}=${found.specs[k].style}${found.specs[k].width != null ? ` ${found.specs[k].width}px` : ''}`)
  check(`線種の指定がある（${found.source}）`, true, rows.join(' / '))
  const sig = (s: LineSpec) => `${s.style}|${s.width ?? ''}`
  const distinct = new Set(FOUR.map(k => sig(found.specs[k]))).size === FOUR.length
  check('4系列の線の形が互いに異なる', distinct, distinct ? '' : rows.join(' / '))
}

// ── 置き換え候補（情報行） ─────────────────────────────────────────────────
// 同じ色相（Lab の hue angle）を保ち、暗い地なら L* を +5 ずつ、明るい地なら −5 ずつ動かして、
// 1〜4 を通る最初の値。色域の外に出たら彩度（C*）を 1 ずつ落として色相を保ったまま中に戻す。
// 複数の色が落ちた場合は順に確定し、後の探索は前の候補を含めた組で判定する。
function labToRgb(l: Lab): RGB | null {
  return fromLinear(mul(M_XYZ2RGB, labToXyz(l)))
}
function inGamutWithHue(L: number, C: number, hRad: number): RGB | null {
  for (let c = C; c >= 0; c -= 1) {
    const rgb = labToRgb({ L, a: c * Math.cos(hRad), b: c * Math.sin(hRad) })
    if (rgb) return rgb
  }
  return null
}
const isBrandLike = (rgb: RGB) =>
  BRAND_FORBIDDEN.some(h => hex(rgb) === h || deltaE(lab(rgb), lab(parseColor(h).rgb)) < MIN_DE)

function failingKeys(p: Palette): SeriesKey[] {
  const bad = new Set<SeriesKey>()
  for (const k of FOUR) if (!contrastOk(k, p[k]) || !lightnessOk(p[k])) bad.add(k)
  for (const [a, b] of pairs(FOUR)) {
    const plain = deltaE(lab(p[a]), lab(p[b])) < MIN_DE
    const cvd = (Object.keys(CVD) as (keyof typeof CVD)[]).some(t => deltaE(simulatedLab(p[a], t), simulatedLab(p[b], t)) < MIN_DE)
    if (plain || cvd) { bad.add(a); bad.add(b) }
  }
  if (!spreadOk(p)) {
    // 幅が広すぎるときは地から最も遠い（明るい地なら最も暗い／暗い地なら最も明るい）色ではなく、
    // 地に最も近い色を動かす方が他の項目を壊しにくい
    const Ls = FOUR.map(k => ({ k, L: lab(p[k]).L }))
    const nearest = Ls.reduce((m, x) => (Math.abs(x.L - BG_LAB.L) < Math.abs(m.L - BG_LAB.L) ? x : m))
    bad.add(nearest.k)
  }
  return FOUR.filter(k => bad.has(k))
}

function suggestReplacements() {
  console.log('\n[情報] 落ちた色の置き換え候補（同じ色相で L* を 5 ずつ動かし、1〜4 を通る最初の値。項目5は色に依らないので除外）')
  const failing = failingKeys(ORIGINAL)
  if (failing.length === 0) {
    info('1〜4 で落ちた色は無い（候補は不要）')
    return
  }
  const working: Palette = { ...ORIGINAL }
  const dir = IS_DARK ? +1 : -1
  for (const k of failing) {
    const orig = lab(ORIGINAL[k])
    const C = Math.hypot(orig.a, orig.b)
    const h = Math.atan2(orig.b, orig.a)
    let found: RGB | null = null
    let steps = 0
    // step 0 = 元の色のまま。前の色の置き換えで自分の問題が解消していれば動かさない
    for (let step = 0; step <= 20; step++) {
      const L = orig.L + dir * 5 * step
      if (L < 0 || L > 100) break
      const rgb = step === 0 ? ORIGINAL[k] : inGamutWithHue(L, C, h)
      if (!rgb || isBrandLike(rgb)) continue
      const trial: Palette = { ...working, [k]: rgb }
      // この色に関わる項目だけでなく、確定済みの候補を含めた組で 1〜4 を判定する
      const stillBad = failingKeys(trial)
      if (!stillBad.includes(k) && colorItemsOkExcept(trial, k)) { found = rgb; steps = step; break }
    }
    if (found && steps === 0) {
      info(`${LABEL[k]} ${k} ${hex(ORIGINAL[k])} → 置き換え不要（前の色の置き換えで、この色に関わる項目は通る）`)
    } else if (found) {
      const nl = lab(found)
      info(`${LABEL[k]} ${k} ${hex(ORIGINAL[k])}（L* ${r1(orig.L)}）→ 候補 ${hex(found)}（L* ${r1(nl.L)}、${dir > 0 ? '+' : '−'}${5 * steps}。` +
        `地との比 ${r2(contrast(found, BG))}、他3色との最小 ΔE ${r1(minDeTo(found, working, k))}）`)
      working[k] = found
    } else {
      info(`${LABEL[k]} ${k} ${hex(ORIGINAL[k])} → 候補なし（同じ色相で L* を動かすだけでは 1〜4 を通らない。色相の変更が必要）`)
    }
  }
  const all = colorItemsOk(working)
  const rows = FOUR.map(k => `${k} ${hex(working[k])}`).join(' / ')
  info(`候補をすべて当てた組: ${rows} → 1〜4 ${all ? 'すべて通る' : '通らない項目が残る（候補どうしの組み合わせは未解決）'}`)
}
/** key 以外の色が元から抱えている問題は候補探索の責任ではないので、key に関わる判定だけを見る */
function colorItemsOkExcept(p: Palette, key: SeriesKey): boolean {
  if (!contrastOk(key, p[key]) || !lightnessOk(p[key])) return false
  for (const other of FOUR) {
    if (other === key) continue
    if (deltaE(lab(p[key]), lab(p[other])) < MIN_DE) return false
    for (const t of Object.keys(CVD) as (keyof typeof CVD)[]) {
      if (deltaE(simulatedLab(p[key], t), simulatedLab(p[other], t)) < MIN_DE) return false
    }
  }
  return spreadOk(p)
}
function minDeTo(rgb: RGB, p: Palette, self: SeriesKey): number {
  return Math.min(...FOUR.filter(k => k !== self).map(k => deltaE(lab(rgb), lab(p[k]))))
}

// ── 実行 ─────────────────────────────────────────────────────────────────
console.log(`チャートの系列色の検査  地 = ${hex(BG)}（${BG_SRC.source}）  ${IS_DARK ? '暗い地' : '明るい地'}として判定`)
console.log(`  対象: ${FOUR.map(k => `${k} ${colorOf(k)}`).join(' / ')}`)
verifyAgainstRecord()
contrastChecks()
pairChecks()
cvdChecks()
lightnessChecks()
lineShapeChecks()
suggestReplacements()

console.log('')
console.log(`PASS ${passed} 件 / FAIL ${failed} 件`)
if (failed) process.exit(1)
console.log('すべてPASS')
