// 切り分け 3c-1（/learn 設定部分の囲い撤去）の実画面検証（Playwright・Edge）。
//
// 使い方（先に本番ビルドを別ポートで起動しておく）:
//   npx next start -p 3131
//   node scripts/verify-learn-3c1.mjs <写真の保存先ディレクトリ>
//
// 確かめること:
//   - 390×844 / 1280×900 / 1920×1080 で横はみ出し0、ヘッダー下の左右端が灰の地（#EDF1F6）、
//     紺青の塗りのボタンが1つまで（§6-1）、console error 0
//   - 押す順番（390 と 1280）:
//     (1) 銘柄 AAPL → クイックの2つ目 → 無料プレビュー
//     (2) 条件の内訳を開閉 → 「条件を編集」で戻り、選択が残るか
//     (3) プロ「ハイブリッド」で条件を1つ追加 → 投資家モデルで2人目 → プロに戻り、条件が残るか
//     (4) 銘柄指定なしでスクリーニング → 候補を押すと銘柄欄に入るか
//
// 「AIレポート生成」系のボタンは押さない（Opus の費用がかかるため）。

import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.BASE_URL ?? 'http://localhost:3131'
const OUT = process.argv[2] ?? path.join(process.cwd(), 'shots', '3c1')
fs.mkdirSync(OUT, { recursive: true })

const SURFACE = '#EDF1F6'
const BRAND_RGB = 'rgb(26, 71, 135)'
const PREVIEW_BUTTON = '無料プレビューを実行（純計算・AIは使いません）'
const SCREEN_BUTTON = 'スクリーニング実行（キャッシュのみ・AIは使いません）'

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
  const m = await page.evaluate(brand => {
    const de = document.documentElement
    const main = document.querySelector('main')
    const top = main ? main.getBoundingClientRect().top : 64
    const primary = [...document.querySelectorAll('main button, main a')]
      .filter(el => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && getComputedStyle(el).backgroundColor === brand
      })
      .map(el => (el.textContent || '').trim().slice(0, 30))
    return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, y: Math.round(top + 8), primary }
  }, BRAND_RGB)
  record(vp.name, `${label}: 横はみ出し0`, m.scrollWidth <= m.clientWidth, {
    scrollWidth: m.scrollWidth,
    clientWidth: m.clientWidth,
  })
  const left = await pixel(page, helper, 2, m.y)
  const right = await pixel(page, helper, m.clientWidth - 3, m.y)
  record(vp.name, `${label}: ヘッダー下の左右端が ${SURFACE}`, left === SURFACE && right === SURFACE, {
    left,
    right,
    y: m.y,
  })
  record(vp.name, `${label}: 紺青の塗りのボタンは1つまで`, m.primary.length <= 1, { primary: m.primary })
}

// 3c-2 でエラーの表示が赤い箱（div.bg-red-50）から role="alert" の薄い帯に変わったため、役割で探す（検査の意味は同じ）
const errorBox = page => page.locator('main [role="alert"]')

async function runQuickPreview(page) {
  await page.getByRole('button', { name: PREVIEW_BUTTON, exact: true }).click()
  const heading = page.getByText('の無料プレビュー（現在値判定・純計算）')
  try {
    await heading.or(errorBox(page)).first().waitFor({ timeout: 90_000 })
  } catch {
    return { kind: 'timeout' }
  }
  if (await errorBox(page).count()) {
    return { kind: 'error', text: (await errorBox(page).first().textContent())?.trim().slice(0, 160) }
  }
  const collapsed = await page.getByRole('button', { name: '条件を編集 ▸' }).isVisible()
  return { kind: collapsed ? 'gate-passed-collapsed' : 'gate-failed-open' }
}

async function steps1and2(page, helper, vp) {
  const symbolInput = page.getByPlaceholder('AAPL / MSFT')
  const needs = page.locator('input[name="needs-preset"]')
  const needLabels = page.locator('label:has(input[name="needs-preset"])')

  await symbolInput.fill('AAPL')
  await needLabels.nth(1).click()
  record(vp.name, '(1) 銘柄 AAPL・クイックの2つ目を選ぶ', (await needs.nth(1).isChecked()) && (await symbolInput.inputValue()) === 'AAPL')

  let preset = 1
  let outcome = await runQuickPreview(page)
  record(vp.name, '(1) 無料プレビュー（2つ目）', outcome.kind.startsWith('gate-'), outcome)
  await shot(page, vp, '1-preview-2nd')
  await checkLayout(page, helper, vp, '(1) プレビュー後')

  // (2) 条件の内訳の開閉（結果の中の部品＝3c-2 の範囲。押す順番の確認として触るだけ）
  const gateToggle = page.getByRole('button', { name: /条件の内訳を見る/ })
  if (await gateToggle.count()) {
    await gateToggle.first().click()
    const opened = await gateToggle.first().getAttribute('aria-expanded')
    await shot(page, vp, '2-gate-open')
    await gateToggle.first().click()
    const closed = await gateToggle.first().getAttribute('aria-expanded')
    record(vp.name, '(2) 条件の内訳を開閉', opened === 'true' && closed === 'false', { opened, closed })
  } else {
    record(vp.name, '(2) 条件の内訳を開閉', null, '内訳の行が表示されなかった')
  }

  // 2つ目が参加条件不成立なら設定は畳まれない（S6 の仕様）。「条件を編集」の経路も確かめるため、
  // そのときだけ1つ目でもプレビューする（純計算・AI は使わない）。
  if (outcome.kind === 'gate-failed-open') {
    await needLabels.nth(0).click()
    preset = 0
    outcome = await runQuickPreview(page)
    record(vp.name, '(1) 無料プレビュー（畳まれる経路の確認に1つ目でも実行）', outcome.kind.startsWith('gate-'), outcome)
    await shot(page, vp, '1-preview-1st')
  }

  const edit = page.getByRole('button', { name: '条件を編集 ▸' })
  if (await edit.isVisible()) {
    await shot(page, vp, '2-summary-bar')
    await checkLayout(page, helper, vp, '(2) 条件の帯')
    await edit.click()
    await needs.nth(preset).waitFor({ state: 'visible' })
    const kept = await needs.nth(preset).isChecked()
    const sym = await symbolInput.inputValue()
    record(vp.name, '(2) 「条件を編集」で戻り、選択が残る', kept && sym === 'AAPL', { preset: preset + 1, kept, sym })
    await shot(page, vp, '2-edit-reopened')
  } else {
    record(vp.name, '(2) 「条件を編集」で戻り、選択が残る', null, {
      reason: '設定が畳まれなかった（参加条件不成立）',
      keptSelection: await needs.nth(preset).isChecked(),
    })
  }
}

async function step3(page, helper, vp) {
  const valueInput = () => page.locator('input[type="number"][step="any"]:visible').first()
  const removeButtons = () => page.getByRole('button', { name: '削除', exact: true })
  const hybrid = () => page.getByRole('button', { name: 'ハイブリッド', exact: true })

  await page.getByRole('tab', { name: 'プロ', exact: true }).click()
  await hybrid().click()
  await page.getByRole('button', { name: '＋ 条件を追加', exact: true }).click()
  await valueInput().fill('30')
  const before = { rows: await removeButtons().count(), hybrid: await hybrid().getAttribute('aria-pressed') }
  record(vp.name, '(3) プロ「ハイブリッド」で条件を1つ追加', before.rows === 1 && before.hybrid === 'true', before)
  await shot(page, vp, '3-pro-added')
  await checkLayout(page, helper, vp, '(3) プロで条件追加')

  await page.getByRole('tab', { name: '投資家モデル', exact: true }).click()
  await page.locator('label:has(input[name="investor-model"])').nth(1).click()
  record(vp.name, '(3) 投資家モデルで2人目を選ぶ', await page.locator('input[name="investor-model"]').nth(1).isChecked())
  await shot(page, vp, '3-investor-2nd')
  await checkLayout(page, helper, vp, '(3) 投資家モデル')

  await page.getByRole('tab', { name: 'プロ', exact: true }).click()
  const after = {
    rows: await removeButtons().count(),
    hybrid: await hybrid().getAttribute('aria-pressed'),
    value: await valueInput().inputValue(),
  }
  record(vp.name, '(3) プロに戻ると追加した条件が残る', after.rows === 1 && after.hybrid === 'true' && after.value === '30', after)
  await shot(page, vp, '3-pro-back')
}

async function step4(page, helper, vp) {
  await page.getByRole('button', { name: '銘柄指定なし（自動スクリーニング）', exact: true }).click()
  await page.getByRole('tab', { name: 'クイック', exact: true }).click()
  await shot(page, vp, '4-no-symbol')
  await checkLayout(page, helper, vp, '(4) 銘柄指定なし')

  await page.getByRole('button', { name: SCREEN_BUTTON, exact: true }).click()
  const done = page.getByText('の適合度ランキング（キャッシュ評価・現在値）')
  try {
    await done.or(errorBox(page)).first().waitFor({ timeout: 90_000 })
  } catch {
    record(vp.name, '(4) スクリーニング実行', false, 'timeout')
    return
  }
  if (await errorBox(page).count()) {
    record(vp.name, '(4) スクリーニング実行', null, { error: (await errorBox(page).first().textContent())?.trim().slice(0, 160) })
    await shot(page, vp, '4-screen-error')
    return
  }
  const cands = page.getByRole('button').filter({ hasText: '件成立' })
  const n = await cands.count()
  record(vp.name, '(4) スクリーニング実行', true, { candidates: n })
  await shot(page, vp, '4-screen-result')
  await checkLayout(page, helper, vp, '(4) スクリーニング結果')
  if (n === 0) {
    record(vp.name, '(4) 候補を押すと銘柄欄に入る', null, '候補0件')
    return
  }
  const sym = (await cands.first().locator('span.font-mono.font-semibold').textContent())?.trim()
  await cands.first().click()
  const scopeOn = await page.getByRole('button', { name: '銘柄指定あり', exact: true }).getAttribute('aria-pressed')
  const value = await page.getByPlaceholder('AAPL / MSFT').inputValue()
  record(vp.name, '(4) 候補を押すと銘柄欄に入る', scopeOn === 'true' && value === sym, { sym, value, scopeOn })
  await shot(page, vp, '4-candidate-picked')
}

// 押す順番の外で、この切り分けで形を変えた残りの部品も確かめて撮る
// （読者プロファイルを開いた状態・銘柄指定なし×投資家モデルのチップ・銘柄指定なし×プロの知らせ）
async function extras(page, helper, vp) {
  await page.evaluate(() => window.scrollTo(0, 0))
  const withSymbol = page.getByRole('button', { name: '銘柄指定あり', exact: true })
  if ((await withSymbol.getAttribute('aria-pressed')) !== 'true') await withSymbol.click()
  const toggle = page.getByRole('button', { name: /読者プロファイル/ })
  await toggle.click()
  await page.locator('label:has(input[name="profile-horizon"])').nth(1).click()
  const horizonChecked = await page.locator('input[name="profile-horizon"]').nth(1).isChecked()
  const expanded = await toggle.getAttribute('aria-expanded')
  record(vp.name, '読者プロファイルを開き、チップで1問答える', horizonChecked && expanded === 'true', { expanded, horizonChecked })
  await shot(page, vp, '5-profile-open')
  await checkLayout(page, helper, vp, '読者プロファイルを開いた状態')

  await page.getByRole('button', { name: '銘柄指定なし（自動スクリーニング）', exact: true }).click()
  await page.getByRole('tab', { name: '投資家モデル', exact: true }).click()
  await page.locator('label:has(input[name="screen-investor-preset"])').nth(1).click()
  record(vp.name, '銘柄指定なし×投資家モデルでチップの2人目を選ぶ', await page.locator('input[name="screen-investor-preset"]').nth(1).isChecked())
  await shot(page, vp, '6-no-symbol-investor')
  await checkLayout(page, helper, vp, '銘柄指定なし×投資家モデル')

  await page.getByRole('tab', { name: 'プロ', exact: true }).click()
  const notice = await page.getByText('銘柄指定なし（自動スクリーニング）はプロ（カスタム条件）に対応していません。').isVisible()
  record(vp.name, '銘柄指定なし×プロの知らせが出る', notice)
  await shot(page, vp, '7-no-symbol-pro')
  await checkLayout(page, helper, vp, '銘柄指定なし×プロ')
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
  await page.getByRole('heading', { level: 1, name: '名人の条件を過去に当てる' }).waitFor()
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
  await guarded(vp, '初期表示', async () => {
    await checkLayout(page, helper, vp, '0 初期表示')
    await shot(page, vp, '0-initial')
  })
  if (vp.flow) {
    await guarded(vp, '(1)(2)', () => steps1and2(page, helper, vp))
    await guarded(vp, '(3)', () => step3(page, helper, vp))
    await guarded(vp, '(4)', () => step4(page, helper, vp))
  } else {
    // 大画面では設定の各モードの見た目だけ撮る（押す順番は 390 / 1280 で確認済み）
    await guarded(vp, 'モード切替の写真', async () => {
      await page.getByRole('tab', { name: 'プロ', exact: true }).click()
      await page.getByRole('button', { name: 'ハイブリッド', exact: true }).click()
      await shot(page, vp, '1-pro-hybrid')
      await checkLayout(page, helper, vp, 'プロ（ハイブリッド）')
      await page.getByRole('tab', { name: '投資家モデル', exact: true }).click()
      await shot(page, vp, '2-investor')
      await checkLayout(page, helper, vp, '投資家モデル')
    })
  }
  await guarded(vp, '追加の部品', () => extras(page, helper, vp))
  record(vp.name, 'console error 0', errors.length === 0, errors.length ? errors.slice(0, 5) : undefined)
  await ctx.close()
}

await browser.close()
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(results, null, 2))
const fails = results.filter(r => r.ok === false).length
const skips = results.filter(r => r.ok === null).length
console.log(`\n${results.length - fails - skips} PASS / ${fails} FAIL / ${skips} SKIP`)
process.exit(fails ? 1 : 0)
