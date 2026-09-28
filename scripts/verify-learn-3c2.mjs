// 切り分け 3c-2（/learn 結果部分の囲い撤去）の実画面検証（Playwright・Edge）。
// scripts/verify-learn-3c1.mjs を土台にしている。
//
// 使い方（先に本番ビルドを別ポートで起動しておく）:
//   npx next start -p 3132
//   node scripts/verify-learn-3c2.mjs <写真の保存先ディレクトリ>
//
// 確かめること:
//   - 390×844 / 1280×900 / 1920×1080 で横はみ出し0、ヘッダー下の左右端が地（#0A0C10・SV1a で暗い地に一本化）、
//     主ボタンが1つまで（§6-1）、console error 0
//   - 押す順番（390 と 1280）:
//     (1) 銘柄 AAPL ＋ クイック「安定重視」→ 無料プレビュー → 結果が表1つで出て、行と値が読める
//     (2) 条件の内訳（MetricStrip）の開閉と、詳細（DetailsSection）の開閉・aria-expanded。
//         詳細は prepare の結果にだけ出る。prepare（AI を使わない）があるのはプロと投資家モデルの2モード。
//         lib/features.ts の SHOW_INVESTOR_MODELS が true なら投資家モデル、false（S1b で名人を隠しているあいだ）なら
//         プロ「ハイブリッド」に条件を1つ足して「プレビュー実行（実データ・AIは使いません）」で出す
//         （SV1a・2026-09-25 で変更。クイックには prepare が無い＝無料プレビューの次はいきなり AI レポート生成）
//     (3) 銘柄指定なしでスクリーニング → 候補の一覧 → 候補を押すと銘柄欄に入る
//     (4) クイック「コツコツ配当」× AAPL（参加条件不成立）→「不成立」が注意の札で出る
//     (5) 読み込み中が中央揃えの大箱でない（API の応答をこのテストの中だけで 2.5 秒遅らせ、取得中に撮る）
//
// 「AIレポート生成」系のボタンは押さない（Opus の費用がかかるため）。
//
// SV1a（2026-09-25）で作り替えた点:
//   - 主ボタンの数え方を「塗りの色の文字列一致」から「class bg-brand か data-primary 属性」に（3c1 と同じ理由・同じ形）
//   - 囲い検出 enclosures() は「4辺に枠線＋角丸」のうち、4辺とも 1px で色が --border のもの（＝面の輪郭・DESIGN §6-6）を除く
//   - 札・文字の色の期待値は暗い地のトークン。getComputedStyle は指定どおりの rgba（合成前）を返すので、
//     半透明のトークンは rgba(…, α) の文字列で比べる（#0A0C10 に合成した実効色になるのは写真の画素を読むときだけ）

import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.BASE_URL ?? 'http://localhost:3132'
const OUT = process.argv[2] ?? path.join(process.cwd(), 'shots', '3c2')
fs.mkdirSync(OUT, { recursive: true })

/** ページの地（globals.css の --bg）。/learn ににじみは無いので一色 */
const BG = '#0A0C10'
/** --warning-tint rgb(192 138 46 / .14) の computed 値 */
const WARNING_TINT_RGB = 'rgba(192, 138, 46, 0.14)'
/** --warning-ink #C08A2E */
const WARNING_INK_RGB = 'rgb(192, 138, 46)'
/** --ink-2 rgb(238 241 245 / .66) の computed 値 */
const INK2_RGB = 'rgba(238, 241, 245, 0.66)'
/** 投資家モデルのタブがあるか。lib/features.ts を文字列で読む（tsx なしで動かすため import しない） */
const SHOW_INVESTOR_MODELS = /export const SHOW_INVESTOR_MODELS\s*(?::\s*boolean)?\s*=\s*true\b/.test(
  fs.readFileSync(path.join(process.cwd(), 'lib', 'features.ts'), 'utf8'),
)
const PREVIEW_BUTTON = '無料プレビューを実行（純計算・AIは使いません）'
const SCREEN_BUTTON = 'スクリーニング実行（キャッシュのみ・AIは使いません）'
const PREPARE_BUTTON = 'プレビュー実行（実データ・AIは使いません）'
const PREVIEW_HEADING = 'の無料プレビュー（現在値判定・純計算）'
const BUNDLE_HEADING = 'AIレポートの実行結果（実データ・過去5年日足）'
const RANKING_HEADING = 'の適合度ランキング（キャッシュ評価・現在値）'
// ExecutionPlanCard は 3c-3 の範囲なので、囲いの数から除く
const EPC_HEADING = 'あなたが選んだルールの過去5年の成績'
const DETAIL_TITLES = [
  '実行した条件・ゲート内訳の詳細版',
  'なぜこの銘柄・戦略が選ばれたか（透明性）',
  '教訓の使用状況（AI学習メモリ）',
  '引用元・参照リンク',
]

const results = []
function record(vp, step, ok, detail) {
  results.push({ vp, step, ok, detail })
  const tag = ok === true ? 'PASS' : ok === false ? 'FAIL' : 'SKIP'
  console.log(`${tag} [${vp}] ${step}${detail === undefined ? '' : ' — ' + JSON.stringify(detail)}`)
}

async function shot(page, vp, name) {
  await page.screenshot({ path: path.join(OUT, `${vp.name}-${name}.png`), fullPage: true })
}

// 1px の写真を別ページの canvas で読み、色を #RRGGBB で返す（追加の依存なし）
async function pixel(page, helper, x, y) {
  const buf = await page.screenshot({ clip: { x, y, width: 1, height: 1 } })
  return helper.evaluate(async b64 => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const c = document.createElement('canvas')
    c.width = 1
    c.height = 1
    const g = c.getContext('2d')
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, 1, 1).data
    return '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()
  }, buf.toString('base64'))
}

async function checkLayout(page, helper, vp, label) {
  await page.evaluate(() => window.scrollTo(0, 0))
  const m = await page.evaluate(() => {
    const de = document.documentElement
    const main = document.querySelector('main')
    const top = main ? main.getBoundingClientRect().top : 64
    const visible = el => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }
    // 主ボタンは class（bg-brand）か data-primary 属性で数える（色の文字列一致にしない。冒頭の注釈）
    const primaryEls = [...document.querySelectorAll('main button, main a')].filter(
      el => visible(el) && (el.classList.contains('bg-brand') || el.hasAttribute('data-primary')),
    )
    // --brand / --brand-strong の実際の塗り（ブラウザが正規化した文字列）を探り針で取る。トークンの値が変わっても追随する。
    // 押した直後はマウスが乗ったまま（hover:bg-brand-strong）なので、ホバーの塗りも「主ボタンの塗り」として認める
    const paint = v => {
      const probe = document.createElement('div')
      probe.style.backgroundColor = v
      document.body.appendChild(probe)
      const c = getComputedStyle(probe).backgroundColor
      probe.remove()
      return c
    }
    const brandRgb = paint('var(--brand)')
    const brandStrongRgb = paint('var(--brand-strong)')
    const primary = primaryEls.map(el => ({
      text: (el.textContent || '').trim().slice(0, 30),
      painted: [brandRgb, brandStrongRgb].includes(getComputedStyle(el).backgroundColor),
    }))
    return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, y: Math.round(top + 8), primary, brandRgb }
  })
  record(vp.name, `${label}: 横はみ出し0`, m.scrollWidth <= m.clientWidth, {
    scrollWidth: m.scrollWidth,
    clientWidth: m.clientWidth,
  })
  const left = await pixel(page, helper, 2, m.y)
  const right = await pixel(page, helper, m.clientWidth - 3, m.y)
  record(vp.name, `${label}: ヘッダー下の左右端が地 ${BG}`, left === BG && right === BG, {
    left,
    right,
    y: m.y,
  })
  record(vp.name, `${label}: 主ボタン（bg-brand / data-primary）は1つまで・塗りは --brand`, m.primary.length <= 1 && m.primary.every(p => p.painted), {
    primary: m.primary,
    brand: m.brandRgb,
  })
}

// 画面に見えている「囲い」＝全周の枠線＋角丸の塊（押せる部品・入力欄・3c-3 の ExecutionPlanCard を除く）。
// SV1a（2026-09-25）: 4辺とも 1px で色が --border のものは「面の輪郭」（DESIGN §6-6。暗い地では面の色で区切れないため、
// 半透明カードの境目を示す唯一の手段）なので囲いに数えない。2px 以上・--border 以外の色・辺ごとに違う色は引き続き囲い
async function enclosures(page) {
  return page.evaluate(epcHeading => {
    const epcH2 = [...document.querySelectorAll('main h2')].find(h => (h.textContent || '').includes(epcHeading))
    const epc = epcH2?.parentElement?.parentElement ?? null
    const skip = 'button, a, input, select, textarea, label, [role="tab"]'
    // --border の実際の色（ブラウザが正規化した文字列）を探り針で取る
    const probe = document.createElement('div')
    probe.style.borderTop = '1px solid var(--border)'
    document.body.appendChild(probe)
    const borderColor = getComputedStyle(probe).borderTopColor
    probe.remove()
    const found = []
    for (const el of document.querySelectorAll('main *')) {
      if (el.closest(skip)) continue
      if (epc && epc.contains(el)) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const cs = getComputedStyle(el)
      const sides = [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map(parseFloat)
      if (sides.every(w => w >= 1) && parseFloat(cs.borderTopLeftRadius) > 0) {
        const colors = [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor]
        const isOutline = sides.every(w => w === 1) && colors.every(c => c === borderColor)
        if (isOutline) continue
        found.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`)
      }
    }
    return found
  }, EPC_HEADING)
}

async function centeredOrSpinning(page) {
  return page.evaluate(() => {
    const vis = el => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }
    return {
      textCenter: [...document.querySelectorAll('main .text-center')].filter(vis).length,
      spin: [...document.querySelectorAll('main .animate-spin')].filter(vis).length,
    }
  })
}

const errorBox = page => page.locator('main [role="alert"]')

// API の応答をこのテストの中だけで遅らせる（読み込み中の表示を確実に撮るため）
async function withSlowApi(page, glob, fn) {
  const handler = async route => {
    await new Promise(r => setTimeout(r, 2500))
    await route.continue().catch(() => {})
  }
  await page.route(glob, handler)
  try {
    return await fn()
  } finally {
    await page.unroute(glob, handler).catch(() => {})
  }
}

async function checkLoading(page, vp, label, shotName) {
  const sk = page.locator('main [data-skeleton="result"]')
  try {
    await sk.first().waitFor({ state: 'visible', timeout: 2000 })
  } catch {
    record(vp.name, `(5) 読み込み中（${label}）`, false, '薄い帯が出なかった')
    return
  }
  const m = await page.evaluate(() => {
    const ul = document.querySelector('main [data-skeleton="result"]')
    const status = ul?.parentElement?.querySelector('[role="status"]')
    const sr = status?.getBoundingClientRect()
    const ur = ul?.getBoundingClientRect()
    return {
      statusText: status?.textContent?.trim() ?? null,
      statusAlign: status ? getComputedStyle(status).textAlign : null,
      statusLeft: sr ? Math.round(sr.left) : null,
      bandLeft: ur ? Math.round(ur.left) : null,
      rows: ul ? ul.querySelectorAll('li').length : 0,
    }
  })
  const cs = await centeredOrSpinning(page)
  await shot(page, vp, shotName)
  const ok =
    Boolean(m.statusText) &&
    ['left', 'start'].includes(m.statusAlign) &&
    m.statusLeft === m.bandLeft &&
    m.rows > 0 &&
    cs.textCenter === 0 &&
    cs.spin === 0
  record(vp.name, `(5) 読み込み中（${label}）: 左揃えの文＋完成時と同じ形の薄い帯・中央揃え/回る輪なし`, ok, { ...m, ...cs })
}

async function waitResult(page, locator) {
  try {
    await locator.or(errorBox(page)).first().waitFor({ timeout: 90_000 })
  } catch {
    return { kind: 'timeout' }
  }
  if (await errorBox(page).count()) {
    return { kind: 'error', text: (await errorBox(page).first().textContent())?.trim().slice(0, 160) }
  }
  return { kind: 'ok' }
}

// MetricStrip（見出しを含む section）の中身を読む
async function readStrip(page, headingText) {
  return page.evaluate(ht => {
    const h2 = [...document.querySelectorAll('main h2')].find(h => (h.textContent || '').includes(ht))
    const section = h2?.closest('section')
    if (!section) return { found: false }
    const table = section.querySelector('table')
    const rows = table
      ? [...table.querySelectorAll('tbody tr')].map(tr => ({
          label: tr.querySelector('th')?.textContent?.trim() ?? '',
          value: tr.querySelector('td')?.textContent?.trim() ?? '',
          align: tr.querySelector('td') ? getComputedStyle(tr.querySelector('td')).textAlign : null,
        }))
      : []
    const scroller = table?.parentElement
    const pill = section.querySelector('span.rounded-full')
    const pcs = pill ? getComputedStyle(pill) : null
    const band = section.querySelector('.rounded-card')
    return {
      found: true,
      rows,
      tableOverflow: scroller ? scroller.scrollWidth - scroller.clientWidth : null,
      tiles: section.querySelectorAll('.grid').length,
      bandBorder: band ? getComputedStyle(band).borderTopWidth : null,
      sectionBg: getComputedStyle(section).backgroundColor,
      pill: pill
        ? { text: pill.textContent.trim(), bg: pcs.backgroundColor, color: pcs.color, radius: parseFloat(pcs.borderTopLeftRadius) }
        : null,
    }
  }, headingText)
}

async function ensureConfigOpen(page) {
  const edit = page.getByRole('button', { name: '条件を編集 ▸' })
  if (await edit.isVisible()) await edit.click()
}

async function step1(page, helper, vp, { slow }) {
  const symbolInput = page.getByPlaceholder('AAPL / MSFT')
  const label = page.locator('label:has(input[name="needs-preset"])').filter({ hasText: '安定重視' })
  await symbolInput.fill('AAPL')
  await label.first().click()
  const checked = await label.first().locator('input').isChecked()
  record(vp.name, '(1) 銘柄 AAPL・クイック「安定重視」を選ぶ', checked && (await symbolInput.inputValue()) === 'AAPL')

  const run = async () => {
    await page.getByRole('button', { name: PREVIEW_BUTTON, exact: true }).click()
    if (slow) await checkLoading(page, vp, '無料プレビュー', '5-loading-preview')
    return waitResult(page, page.getByText(PREVIEW_HEADING))
  }
  const outcome = slow ? await withSlowApi(page, '**/api/lab/backtest', run) : await run()
  if (outcome.kind !== 'ok') {
    record(vp.name, '(1) 無料プレビュー', false, outcome)
    await shot(page, vp, '1-preview-error')
    return false
  }
  const s = await readStrip(page, PREVIEW_HEADING)
  const readable = s.found && s.rows.length > 0 && s.rows.every(r => r.label && r.value && ['right', 'end'].includes(r.align))
  record(vp.name, '(1) 結果が表1つで出て、行と値が読める（値は右揃え）', readable, { rows: s.rows, pill: s.pill?.text })
  record(vp.name, '(1) 数字タイルの格子なし・帯に枠線なし・表の横はみ出し0', s.tiles === 0 && s.bandBorder === '0px' && (s.tableOverflow ?? 0) <= 0, {
    tiles: s.tiles,
    bandBorder: s.bandBorder,
    tableOverflow: s.tableOverflow,
    sectionBg: s.sectionBg,
  })
  const enc = await enclosures(page)
  const cs = await centeredOrSpinning(page)
  record(vp.name, '(1) 結果の画面に囲い（全周の枠線＋角丸）・text-center なし', enc.length === 0 && cs.textCenter === 0, { enc, ...cs })
  await shot(page, vp, '1-preview-table')
  await checkLayout(page, helper, vp, '(1) プレビュー後')
  return true
}

async function toggleCheck(page, button) {
  const before = await button.getAttribute('aria-expanded')
  await button.click()
  const opened = await button.getAttribute('aria-expanded')
  const regionId = await button.getAttribute('aria-controls')
  const regionVisible = regionId ? await page.locator(`[id="${regionId}"]`).isVisible() : false
  return { before, opened, regionVisible }
}

async function step2(page, helper, vp) {
  // (2a) MetricStrip の「条件の内訳を見る」
  const gateToggle = page.getByRole('button', { name: /条件の内訳を見る/ }).first()
  if (await gateToggle.count()) {
    const t = await toggleCheck(page, gateToggle)
    await shot(page, vp, '2a-gate-open')
    await gateToggle.click()
    const closed = await gateToggle.getAttribute('aria-expanded')
    record(vp.name, '(2) 条件の内訳の開閉（aria-expanded）', t.before === 'false' && t.opened === 'true' && t.regionVisible && closed === 'false', { ...t, closed })
  } else {
    record(vp.name, '(2) 条件の内訳の開閉（aria-expanded）', null, '内訳の行が表示されなかった')
  }

  // (2b) prepare（AI は使わない）→ 詳細（DetailsSection）の開閉。
  //      投資家モデルのタブがあればそこで、無ければ（S1b で名人を隠しているあいだ）プロ「ハイブリッド」に条件を1つ足して
  await ensureConfigOpen(page)
  const prepareMode = SHOW_INVESTOR_MODELS ? '投資家モデル' : 'プロ'
  await page.getByRole('tab', { name: prepareMode, exact: true }).click()
  if (!SHOW_INVESTOR_MODELS) {
    // 3c1 の (3) と同じ手順（ハイブリッド → 条件を追加 → 値 30）。条件が無いと prepare は走らない
    await page.getByRole('button', { name: 'ハイブリッド', exact: true }).click()
    await page.getByRole('button', { name: '＋ 条件を追加', exact: true }).click()
    await page.locator('input[type="number"][step="any"]:visible').first().fill('30')
  }
  const outcome = await withSlowApi(page, '**/api/report/prepare', async () => {
    await page.getByRole('button', { name: PREPARE_BUTTON, exact: true }).click()
    await checkLoading(page, vp, 'prepare', '5-loading-prepare')
    return waitResult(page, page.getByRole('heading', { name: BUNDLE_HEADING }))
  })
  if (outcome.kind !== 'ok') {
    record(vp.name, `(2) ${prepareMode}のプレビュー（詳細を出すため）`, null, outcome)
    await shot(page, vp, '2b-prepare-error')
    return
  }
  const s = await readStrip(page, BUNDLE_HEADING)
  record(vp.name, '(2) 実行結果も表1つで出る', s.found && (s.rows.length > 0 || s.pill !== null) && s.tiles === 0, { rows: s.rows.length, pill: s.pill?.text })

  const present = []
  for (const title of DETAIL_TITLES) {
    const b = page.getByRole('button', { name: title })
    if (!(await b.count())) continue
    const t = await toggleCheck(page, b.first())
    present.push({ title, button: b.first(), t })
  }
  record(vp.name, '(2) 詳細の帯が1つ以上ある', present.length > 0, { titles: present.map(p => p.title) })
  if (!present.length) return
  const enc = await enclosures(page)
  const cs = await centeredOrSpinning(page)
  record(vp.name, '(2) 詳細を全部開いた状態で囲い・text-center なし（3c-3 の実測カードを除く）', enc.length === 0 && cs.textCenter === 0, { enc, ...cs })
  await shot(page, vp, '2b-details-open')
  await checkLayout(page, helper, vp, '(2) 詳細を開いた状態')
  for (const p of present) {
    await p.button.click()
    const closed = await p.button.getAttribute('aria-expanded')
    record(vp.name, `(2) 詳細「${p.title}」の開閉（aria-expanded）`, p.t.before === 'false' && p.t.opened === 'true' && p.t.regionVisible && closed === 'false', { ...p.t, closed })
  }
  await shot(page, vp, '2b-details-closed')
}

async function step3(page, helper, vp) {
  await ensureConfigOpen(page)
  await page.getByRole('button', { name: '銘柄指定なし（自動スクリーニング）', exact: true }).click()
  await page.getByRole('tab', { name: 'クイック', exact: true }).click()

  const outcome = await withSlowApi(page, '**/api/analyze/screen', async () => {
    await page.getByRole('button', { name: SCREEN_BUTTON, exact: true }).click()
    await checkLoading(page, vp, 'スクリーニング', '5-loading-screen')
    return waitResult(page, page.getByText(RANKING_HEADING))
  })
  if (outcome.kind !== 'ok') {
    record(vp.name, '(3) スクリーニング実行', outcome.kind === 'error' ? null : false, outcome)
    await shot(page, vp, '3-screen-error')
    return
  }
  const cands = page.getByRole('button').filter({ hasText: '件成立' })
  const n = await cands.count()
  const look = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('main button')].filter(b => (b.textContent || '').includes('件成立'))
    const first = btns[0]
    const count = first ? [...first.querySelectorAll('span')].find(s => /件成立$/.test((s.textContent || '').trim())) : null
    const r = first?.getBoundingClientRect()
    const band = first?.closest('ul')
    const br = band?.getBoundingClientRect()
    return {
      inOneBand: btns.length > 0 && btns.every(b => b.closest('ul') === band),
      rowBorder: first ? getComputedStyle(first).borderTopWidth : null,
      rowHeight: r ? Math.round(r.height) : null,
      rowSpansBand: r && br ? Math.abs(r.left - br.left) < 1 && Math.abs(r.right - br.right) < 1 : null,
      countColor: count ? getComputedStyle(count).color : null,
      countBg: count ? getComputedStyle(count).backgroundColor : null,
    }
  })
  record(vp.name, '(3) 候補の一覧が出る', n > 0, { candidates: n })
  record(
    vp.name,
    '(3) 候補は1つの帯の中の押せる行（枠線なし・行は帯の端から端・高さ56px以上）、成立件数は無彩色の文字',
    look.inOneBand && look.rowBorder === '0px' && look.rowSpansBand === true && look.rowHeight >= 56 && look.countColor === INK2_RGB && look.countBg === 'rgba(0, 0, 0, 0)',
    look,
  )
  const enc = await enclosures(page)
  const cs = await centeredOrSpinning(page)
  record(vp.name, '(3) スクリーニング結果に囲い・text-center なし', enc.length === 0 && cs.textCenter === 0, { enc, ...cs })
  await shot(page, vp, '3-screen-result')
  await checkLayout(page, helper, vp, '(3) スクリーニング結果')
  if (n === 0) return
  const sym = (await cands.first().locator('span.font-mono.font-semibold').textContent())?.trim()
  await cands.first().click()
  const scopeOn = await page.getByRole('button', { name: '銘柄指定あり', exact: true }).getAttribute('aria-pressed')
  const value = await page.getByPlaceholder('AAPL / MSFT').inputValue()
  record(vp.name, '(3) 候補を押すと銘柄欄に入る', scopeOn === 'true' && value === sym, { sym, value, scopeOn })
  await shot(page, vp, '3-candidate-picked')
}

async function step4(page, helper, vp) {
  await ensureConfigOpen(page)
  const withSymbol = page.getByRole('button', { name: '銘柄指定あり', exact: true })
  if ((await withSymbol.getAttribute('aria-pressed')) !== 'true') await withSymbol.click()
  await page.getByRole('tab', { name: 'クイック', exact: true }).click()
  const symbolInput = page.getByPlaceholder('AAPL / MSFT')
  await symbolInput.fill('AAPL')
  const label = page.locator('label:has(input[name="needs-preset"])').filter({ hasText: 'コツコツ配当' })
  await label.first().click()
  await page.getByRole('button', { name: PREVIEW_BUTTON, exact: true }).click()
  const outcome = await waitResult(page, page.getByText(PREVIEW_HEADING))
  if (outcome.kind !== 'ok') {
    record(vp.name, '(4) 「コツコツ配当」× AAPL の無料プレビュー', false, outcome)
    return
  }
  const s = await readStrip(page, PREVIEW_HEADING)
  if (!s.pill || s.pill.text !== '参加条件 不成立') {
    record(vp.name, '(4) 「不成立」が注意の札で出る', null, { reason: '参加条件が不成立にならなかった', pill: s.pill })
    await shot(page, vp, '4-not-failed')
    return
  }
  record(
    vp.name,
    '(4) 「参加条件 不成立」が注意の札（--warning-tint の面＋--warning-ink の文字・ピル型）',
    s.pill.bg === WARNING_TINT_RGB && s.pill.color === WARNING_INK_RGB && s.pill.radius >= 100,
    s.pill,
  )
  const gateToggle = page.getByRole('button', { name: /条件の内訳を見る/ }).first()
  if (await gateToggle.count()) {
    await gateToggle.click()
    const rowPills = await page.evaluate(() => {
      const region = document.getElementById(document.querySelector('main button[aria-expanded="true"][aria-controls]')?.getAttribute('aria-controls') ?? '')
      return region
        ? [...region.querySelectorAll('span.rounded-full')].map(p => ({ text: p.textContent.trim(), bg: getComputedStyle(p).backgroundColor, color: getComputedStyle(p).color }))
        : null
    })
    const ok = Array.isArray(rowPills) && rowPills.length > 0 && rowPills.every(p => p.text === '不成立' && p.bg === WARNING_TINT_RGB && p.color === WARNING_INK_RGB)
    record(vp.name, '(4) 内訳の行の「不成立」も注意の札', ok, rowPills)
  }
  const enc = await enclosures(page)
  record(vp.name, '(4) 不成立の結果に囲い（橙の面の箱など）なし', enc.length === 0 && s.sectionBg === 'rgba(0, 0, 0, 0)', { enc, sectionBg: s.sectionBg })
  await shot(page, vp, '4-gate-failed')
  await checkLayout(page, helper, vp, '(4) 参加条件不成立')
}

async function guarded(vp, name, fn) {
  try {
    await fn()
  } catch (e) {
    record(vp.name, `${name}（例外）`, false, String(e).split('\n')[0].slice(0, 200))
  }
}

const browser = await chromium.launch({ channel: 'msedge' })
const helper = await browser.newPage()
const viewports = [
  { name: '390', width: 390, height: 844, flow: true },
  { name: '1280', width: 1280, height: 900, flow: true },
  { name: '1920', width: 1920, height: 1080, flow: false },
]

for (const vp of viewports) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))

  await page.goto(`${BASE}/learn`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { level: 1, name: '条件を決めて、過去のデータに当てる' }).waitFor()
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
  await guarded(vp, '初期表示', async () => {
    await checkLayout(page, helper, vp, '0 初期表示')
    await shot(page, vp, '0-initial')
  })
  if (vp.flow) {
    await guarded(vp, '(1)(5)', () => step1(page, helper, vp, { slow: true }))
    await guarded(vp, '(2)', () => step2(page, helper, vp))
    await guarded(vp, '(3)', () => step3(page, helper, vp))
    await guarded(vp, '(4)', () => step4(page, helper, vp))
  } else {
    // 大画面では結果の表の見た目だけ撮る（押す順番は 390 / 1280 で確認する）
    await guarded(vp, '(1) 大画面', () => step1(page, helper, vp, { slow: false }))
  }
  record(vp.name, 'console error 0', errors.length === 0, errors.length ? errors.slice(0, 5) : undefined)
  await ctx.close()
}

await browser.close()
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(results, null, 2))
const fails = results.filter(r => r.ok === false).length
const skips = results.filter(r => r.ok === null).length
console.log(`\n${results.length - fails - skips} PASS / ${fails} FAIL / ${skips} SKIP`)
process.exit(fails ? 1 : 0)
