// ⑤-2 分析の過程の再生（/watch）の撮影と検証（Playwright・msedge チャンネル）。
//   $env:PATH = "C:\Program Files\nodejs;$env:PATH"; npx next start -p 3128   （別の窓で）
//   node scripts/shoot-replay.mjs [baseUrl] [outDir]
//
// 撮るもの: 390 / 768 / 1280px × 初回の静止・再生中（段2・段5）・飛ばした後・reduce-motion
// 測るもの: 横スクロールの有無、格子と線の端の名前が切れていないか、12px 未満の文字、aria-live の内容、
//           囲い（rounded-* ＋ border）が押せる塊以外に増えていないか、console error、再生の合計時間（ふつう・3倍）
// 本番には書き込まない（読むだけ）。
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const BASE = process.argv[2] ?? 'http://localhost:3128'
const OUT = process.argv[3] ?? path.join(
  'C:/Users/marco/AppData/Local/Temp/claude/c--Users-marco-Downloads-investsim/b72f423c-079e-4470-8d6e-8be381cd69a1/scratchpad', 'shots', 'replay')
fs.mkdirSync(OUT, { recursive: true })

const VIEWPORTS = [
  { name: '390', width: 390, height: 844 },
  { name: '768', width: 768, height: 1024 },
  { name: '1280', width: 1280, height: 900 },
]

const SECTION = 'section[aria-labelledby="replay-heading"]'
const results = []
let failures = 0
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`)
  if (!ok) failures++
}

async function waitReady(page) {
  await page.waitForFunction(sel => !!document.querySelector(sel), SECTION, { timeout: 90_000 })
  // 足の取得が終わるまで（「株価の足を取得しています」が消えるまで）待つ。最大 60 秒
  await page.waitForFunction(sel => {
    const s = document.querySelector(sel)
    return s && !s.innerText.includes('株価の足を取得しています')
  }, SECTION, { timeout: 60_000 }).catch(() => {})
  await page.waitForTimeout(400)
}

async function shot(page, file) {
  const sec = page.locator(SECTION)
  await sec.screenshot({ path: path.join(OUT, file) })
}

/** 段 key が active になるまで待つ */
async function waitStage(page, key, timeout = 20_000) {
  await page.waitForFunction(
    ([sel, k]) => document.querySelector(`${sel} li[data-stage="${k}"][data-state="active"]`) != null,
    [SECTION, key], { timeout },
  )
}

async function metrics(page) {
  return page.evaluate((sel) => {
    const s = document.querySelector(sel)
    const de = document.documentElement
    const visible = el => {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
    }
    // 12px 未満の文字（テキストを直接持つ要素だけ）
    const small = []
    for (const el of s.querySelectorAll('*')) {
      if (el.closest('.sr-only')) continue
      const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())
      if (!hasText) continue
      const fs = parseFloat(getComputedStyle(el).fontSize)
      if (fs < 12) small.push(`${el.tagName.toLowerCase()} ${fs}px "${el.textContent.trim().slice(0, 20)}"`)
    }
    // 囲い: 角丸 ＋ 枠線（押せる塊・入力欄以外）。20px 未満の丸印（C ノート型の段の印）は囲いではないので除く
    const boxes = []
    for (const el of s.querySelectorAll('*')) {
      if (!visible(el)) continue
      const rb = el.getBoundingClientRect()
      if (rb.width < 20 || rb.height < 20) continue
      const cs = getComputedStyle(el)
      const bw = ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'].map(k => parseFloat(cs[k]))
      const allSides = bw.every(w => w > 0)
      const radius = parseFloat(cs.borderTopLeftRadius)
      const interactive = ['BUTTON', 'SELECT', 'INPUT', 'A', 'OPTION'].includes(el.tagName)
      if (allSides && radius > 0 && !interactive) boxes.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 4).join('.')}`)
    }
    // 格子の札の文字が切れていないか
    const clipped = []
    for (const li of s.querySelectorAll('ul[aria-label="監視している銘柄"] li')) {
      if (li.scrollWidth > li.clientWidth + 1) clipped.push(li.textContent)
    }
    // SVG の端の名前が図の幅に収まっているか
    const svgOver = []
    for (const svg of s.querySelectorAll('svg[role="img"]')) {
      const w = svg.getBoundingClientRect().width
      for (const t of svg.querySelectorAll('text')) {
        const b = t.getBBox()
        if (b.x + b.width > w + 0.5 || b.x < -0.5) svgOver.push(`${t.textContent} right=${(b.x + b.width).toFixed(1)}/${w.toFixed(1)}`)
      }
    }
    const live = s.querySelector('[data-replay-live]')
    return {
      scrollWidth: de.scrollWidth, clientWidth: de.clientWidth,
      sectionRight: s.getBoundingClientRect().right,
      small, boxes, clipped, svgOver,
      live: live ? live.textContent : null,
      stageStates: [...s.querySelectorAll('li[data-stage]')].map(li => `${li.dataset.stage}:${li.dataset.state}`).join(' '),
      dotsFilled: [...s.querySelectorAll('li[data-stage] > div > span[aria-hidden]')].map(sp => getComputedStyle(sp).backgroundColor),
      buttonText: [...s.querySelectorAll('button')].map(b => b.textContent.trim()),
    }
  }, SECTION)
}

const browser = await chromium.launch({ channel: 'msedge' })
const summary = {}

for (const vp of VIEWPORTS) {
  console.log(`\n■ ${vp.name}px`)
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const consoleErrors = []
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message))
  const liveLog = []

  await page.goto(BASE + '/watch', { waitUntil: 'networkidle', timeout: 90_000 })
  await waitReady(page)
  // aria-live の変化を記録
  await page.evaluate(() => {
    const el = document.querySelector('[data-replay-live]')
    window.__live = []
    if (!el) return
    new MutationObserver(() => window.__live.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true })
  })
  await page.locator(SECTION).scrollIntoViewIfNeeded()

  // 1) 初回の静止
  const m0 = await metrics(page)
  await shot(page, `${vp.name}-1-static.png`)
  check(`${vp.name} 横スクロールなし（初回）`, m0.scrollWidth <= m0.clientWidth, `${m0.scrollWidth}/${m0.clientWidth}`)
  check(`${vp.name} 初回は全段 done（静止した完成状態）`, !m0.stageStates.includes(':active') && !m0.stageStates.includes(':pending'), m0.stageStates)
  check(`${vp.name} 12px 未満の文字なし`, m0.small.length === 0, m0.small.slice(0, 5).join(' | '))
  check(`${vp.name} 格子の札の文字が切れていない`, m0.clipped.length === 0, m0.clipped.join(','))
  check(`${vp.name} 線の端の名前が図に収まる`, m0.svgOver.length === 0, m0.svgOver.join(' | '))
  check(`${vp.name} 囲い（角丸＋枠線）は押せる塊・入力欄以外に 0`, m0.boxes.length === 0, m0.boxes.join(' | '))
  check(`${vp.name} ボタンは「過程を再生する」＋速さ2択`, m0.buttonText.includes('過程を再生する') && m0.buttonText.includes('ふつう') && m0.buttonText.includes('3倍'), m0.buttonText.join('/'))

  // 2) 再生（ふつう）: 段2・段5 で撮り、合計時間を測る
  const sec = page.locator(SECTION)
  const t0 = Date.now()
  await sec.getByRole('button', { name: '過程を再生する' }).click()
  await waitStage(page, 'materials')
  await page.waitForTimeout(600)
  const m2 = await metrics(page)
  await shot(page, `${vp.name}-2-playing-stage2.png`)
  check(`${vp.name} 再生中: 横スクロールなし（段2）`, m2.scrollWidth <= m2.clientWidth, `${m2.scrollWidth}/${m2.clientWidth}`)
  check(`${vp.name} 再生中: 「結果まで飛ばす」に切り替わる`, m2.buttonText.includes('結果まで飛ばす'), m2.buttonText.join('/'))
  await waitStage(page, 'ai')
  await page.waitForTimeout(900)
  await shot(page, `${vp.name}-3-playing-stage5.png`)
  await page.waitForFunction(sel => {
    const s = document.querySelector(sel)
    return [...s.querySelectorAll('button')].some(b => b.textContent.trim() === 'もう一度再生する')
  }, SECTION, { timeout: 40_000 })
  const normalMs = Date.now() - t0
  // 段4（知識0件）のように所要 0 の段は待たないので、6段なら 15.0 − 0.8 = 14.2 秒が正
  check(`${vp.name} ふつうの再生時間 ≈ 15 秒（0件の段ぶん短い）`, normalMs >= 13_800 && normalMs <= 17_500, `${(normalMs / 1000).toFixed(1)}s`)
  await page.waitForTimeout(300)
  const liveAfter = await page.evaluate(() => window.__live.slice())
  liveLog.push(...liveAfter)
  check(`${vp.name} aria-live は再生開始・各段の開始・終了要約だけ`, liveAfter.length > 0 && liveAfter.every(t => /^過程の再生を始めます|^段\d |^再生を終えました/.test(t)), liveAfter.join(' // '))

  // 3) 3倍
  await page.evaluate(() => { window.__live = [] })
  await sec.getByRole('button', { name: '3倍' }).click()
  const t1 = Date.now()
  await sec.getByRole('button', { name: 'もう一度再生する' }).click()
  await page.waitForFunction(sel => {
    const s = document.querySelector(sel)
    return [...s.querySelectorAll('button')].some(b => b.textContent.trim() === 'もう一度再生する')
  }, SECTION, { timeout: 40_000 })
  const fastMs = Date.now() - t1
  check(`${vp.name} 3倍の再生時間 ≈ 5 秒`, fastMs >= 4_300 && fastMs <= 6_800, `${(fastMs / 1000).toFixed(1)}s`)
  await page.waitForTimeout(300)
  const liveFast = await page.evaluate(() => window.__live.slice())
  check(`${vp.name} 3倍の aria-live は開始と終了だけ`, liveFast.length === 2, liveFast.join(' // '))
  await sec.getByRole('button', { name: 'ふつう' }).click()

  // 4) 飛ばした後: 再生を始めてすぐ飛ばす
  await sec.getByRole('button', { name: 'もう一度再生する' }).click()
  await page.waitForTimeout(700)
  await sec.getByRole('button', { name: '結果まで飛ばす' }).click()
  await page.waitForTimeout(400)
  const m4 = await metrics(page)
  await shot(page, `${vp.name}-4-skipped.png`)
  check(`${vp.name} 飛ばした後は全段 done`, !m4.stageStates.includes(':active') && !m4.stageStates.includes(':pending'), m4.stageStates)
  check(`${vp.name} 飛ばした後の丸印はすべて同じ塗り`, new Set(m4.dotsFilled).size === 1, [...new Set(m4.dotsFilled)].join(','))
  check(`${vp.name} 飛ばした後: 横スクロールなし`, m4.scrollWidth <= m4.clientWidth)

  // 5) Esc で飛ばす
  await sec.getByRole('button', { name: 'もう一度再生する' }).click()
  await page.waitForTimeout(500)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  const m5 = await metrics(page)
  check(`${vp.name} Esc で飛ばせる`, m5.buttonText.includes('もう一度再生する') && !m5.stageStates.includes(':active'))

  check(`${vp.name} console error 0`, consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
  summary[vp.name] = { normalMs, fastMs, live: liveLog, consoleErrors: consoleErrors.length, boxes: m0.boxes.length }
  await context.close()

  // 6) reduce-motion
  const ctx2 = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
  const page2 = await ctx2.newPage()
  await page2.emulateMedia({ reducedMotion: 'reduce' })
  await page2.goto(BASE + '/watch', { waitUntil: 'networkidle', timeout: 90_000 })
  await waitReady(page2)
  await page2.locator(SECTION).scrollIntoViewIfNeeded()
  const mr = await metrics(page2)
  const rText = await page2.locator(SECTION).innerText()
  await shot(page2, `${vp.name}-5-reduced.png`)
  check(`${vp.name} reduce-motion: 操作を出さず注記を出す`, !mr.buttonText.includes('過程を再生する') && rText.includes('動きを減らす'), mr.buttonText.join('/'))
  check(`${vp.name} reduce-motion: 全段 done`, !mr.stageStates.includes(':active') && !mr.stageStates.includes(':pending'))
  await ctx2.close()
}

await browser.close()
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ summary, results }, null, 2))
console.log(`\n${results.length - failures} PASS / ${failures} FAIL  → ${OUT}`)
process.exit(failures ? 1 : 0)
