// 「学ぶ」（/study）の検査。2026-10-09 に隠しページ /lab/9983 として作り（S-A）、2026-10-19 に /study で**公開**した（S-L1a）。
//   $env:PATH = "C:\Program Files\nodejs;$env:PATH"; npx tsx scripts/check-lab-9983.ts
//
// 正は DECISIONS.md 2026-10-09（添削プロトタイプの不変条件）＋ 2026-10-19（/study で公開・4段の1段目）。
// ファイル名と定数名 SHOW_LAB_9983 は当時のまま（改名は別スライス・NEXT-STEPS.md）。lib/lab/**・components/lab/** も改名しない。
//
// **2026-10-19 に (e)(f)(g) の前提が「隠す」から「公開」へ反転した**:
//   隠していたとき                          → いま
//   sitemap に /lab が無い                  → sitemap を実際に呼ぶと /study が**ある**（SHOW_LAB_9983 連動）
//   page.tsx に index: false が2つ          → noindex が**1つも無い**
//   どこからもリンクしない                   → /study へのリンクは「許した入口」だけ（S-L1a では0本・S-L1b で SiteNav の NAV）
//   既定 SHOW_LAB_9983 = false              → true
//   app/sitemap.ts は凍結                    → 凍結から外した（next.config.ts は凍結のまま＝308 を足さない）
// 反転しても**残す**のが次の2本（公開しても崩してはいけない線）: 到達条件に session/user/cookies/headers/auth を入れない／
// client.tsx に fetch(・localStorage・sessionStorage・document.cookie が無い。
//
// 見るもの（記号は builder への指示書のまま）:
//  (a) 画面の文字列に禁止語が無い（forbidden.ts の2一覧＋lib/lab/forbidden-extra.ts。Disclaimer の定型文と「将来を予測するものではありません」だけ例外）
//  (b) lib/lab/9983.ts の全数値に SourceRef があり、URL が www.fastretailing.com / www.jpx.co.jp / www.nikkei.com
//  (c) 解説文・固定文の本文に2桁以上の数字の直書きが無い（{var} で埋める。「30秒」だけ許可）
//  (d) components/lab/** に色の直値（--success／--danger／生の色）が無い
//  (e) 【公開】sitemap に /study がある・noindex が無い・notFound() の口は残る・/study へのリンクは許した入口だけ・到達条件に session 等が無い
//  (f) import 禁止（lib/report/claude.ts・lib/ai-trader/**・lib/investors/**（forbidden.ts を除く））・凍結ファイルが HEAD と無変更
//  (g) 3フラグ（SHOW_LAB_9983 = true・LAB_CRITIQUE_AI = false・LAB_SIGN_COLOR = true）
//  (h) 添削の見出しが7つ・固定順（データと描画の両方）・§3 の範囲を断る文が当たり0件でも描かれる
//  (t) 【公開】1社固定の断りが h1 の直下に無条件・数字の時点が data から出る・/trade へ銘柄を引き継がない・/stocks/ へ繋がない
//  (i) compose を実際に呼ぶ（結論が空／ROE と ROA／全欄埋め／営業利益と純利益の混同／PER の平均 ほか）
//  (j) MiniTrend の座標計算（lineGeometry）が正負で同じ倍率
//  (k) money.ts の整形（実データの値で）＋前期比の計算値が会社公表の % と一致
//  (u) 2026-10-22（測定1・2の後に足した catalogue の7項目・catalogue6-2026-10-22・reviewer の負例 review-negatives-2026-10-22）: fact-mismatch・momentum-as-reason・fame-as-safety・
//      forecast-as-reason・cf-profit-unchecked・segment-impression の正例と負例（似ているが出してはいけない文）・明細の行の文
//  ほか: 見出しの階層（check-headings.ts と同じ規則）・role="img"・出所の文が無条件に描かれる・U+2212
//  2026-10-12（オーナーの読みやすさの指示5点・DECISIONS 2026-10-09 の追記）:
//  (l) 描画結果の Sourced 由来の数字の直後に [N]（出典の番号）がある・解説文のかけらをつなぐと fill と同じ文
//  (m) 出典の節が <details> の中に無く、--muted より薄くなく、aria-hidden が無い・全出典が番号順・番号は初出順で固定
//  (n) 免責の文（Disclaimer・「当社の分析や評価は含まれていません」・「将来を予測するものではありません」・「良し悪しを判定しません」・「送信も保存もしていません」）が消えていない
//  (o) 「2通りの読み方」の囲み（Readings）に border-l-brand がある
//  (p) 用語の囲み（Term）が評価語（好調・注意・危険 など）を囲んでいない・囲むのは用語集の語だけ。
//      囲みは <button type="button" aria-expanded> で、押すと説明の箱が段落の直下に出る（aria-controls＝箱の id・同じ段落で1つだけ・Esc で閉じる・title は残す。2026-10-12 スマホ対応）
//  (q) Timeline に role="img"・aria-label があり「あと◯日」の文字が無い
//  (r) new Date を読むのは Timeline.tsx と client.tsx の useEffect の中だけ
//  (s) フェーズA（2026-10-18・添削の AI を手元で測る道具）: 門 lib/lab/critique/guard.ts（引用の実在・禁止語・kind）・返答の解析（anthropic.ts の parseFindings）・
//      テストデータ evals/critique/memos.ts（実物の原文がそのまま・expect の文が原文にある）・与える数字（evals/critique/figures.ts が 9983.ts 由来）・記録に鍵が無い。
//      (f)(g) の「S-B のファイルはまだ無い」「lib/lab に process.env が無い」は、anthropic.ts（SDK 直呼び・鍵が無ければ throw・CLI 無し）だけを例外にした
//
// 実ネットワーク不要。利用者のメモの見本は検査の中だけ（製品コードに入れない）。

import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LAB_9983, METRIC_ITEMS, EXPLAIN_CHAIN, SOURCES, fyLabel } from '../lib/lab/9983'
import { fill, labVars, labVarEntries, lineGeometry, segmentShare, yoyText, yoyComputedText, yoySentence, yoyPointDelta, signStyle } from '../lib/lab/display'
import { citationIndex, citationList, sourceKey, publisherOf } from '../lib/lab/citations'
import { termTokens, splitTerms, richParagraphs, piecesText } from '../lib/lab/rich'
import type { SourceRef, Sourced } from '../lib/lab/types'
import { MINUS, formatByUnit, formatMillionYen, formatPercent, formatSignedPercent, formatSignedPoint, formatSignedYen, formatTimes, formatYen } from '../lib/lab/money'
import { MEMO_FIELDS, EMPTY_MEMO, DECISION_OPTIONS, type LabMemo } from '../lib/lab/memo-fields'
import { GLOSSARY_EXTRA } from '../lib/lab/glossary-extra'
import { labForbiddenWordsIn, LAB_FORBIDDEN, LAB_FORBIDDEN_ALL } from '../lib/lab/forbidden-extra'
import { CRITIQUE_SECTIONS, NOTES_TEXT, CRITIQUE_TITLE } from '../lib/lab/critique/sections'
import { CATALOGUE, numbersNear, approxEqual, catalogueById, NOTHING_FOUND, CHECK_SCOPE_NOTE, detectAll, nearby, factMismatches, FACT_TEMPLATES, FACT_ALIAS_NOTE } from '../lib/lab/critique/catalogue'
import { LEARN_THEMES, pickTheme, THEME_FOR_MISSING } from '../lib/lab/critique/learn-themes'
import { composeCritique, CONNECT_TEMPLATES, mentionedMetrics, EXTRA_NAMES, NAMES_HEADING } from '../lib/lab/critique/compose'
import { SHOW_LAB_9983, LAB_CRITIQUE_AI, LAB_SIGN_COLOR } from '../lib/features'
import sitemapRoutes from '../app/sitemap'
import { metadata as studyMetadata } from '../app/study/page'
import { DISCLAIMER_TEXT } from '../components/ui/Disclaimer'
import { Lab9983Client, PAGE_KICKER, PAGE_LEAD, FIXED_COMPANY_NOTE, NO_AI_NOTE, WHEN_TITLE, GLOSSARY_TITLE, NEXT_NOTE } from '../app/study/client'
import { CritiqueView, CRITIQUE_LEAD, BADGE, NO_QUOTES, OPEN_LEARN, CLOSE_LEARN, KIND_LABEL } from '../components/lab/CritiqueView'
import { MetricRows, METRICS_TITLE, METRICS_LEAD, SOURCE_NOTE, EXPLAIN_BUTTON, EXPLAIN_CLOSE } from '../components/lab/MetricRows'
import { CausalMap, chainNodes, CHAIN_TITLE, CHAIN_LEAD, PRICE_NOTE, CHAIN_NOTE } from '../components/lab/CausalMap'
import { CitationList, CITATIONS_TITLE, CITATIONS_LEAD, LINK_NOTE } from '../components/lab/CitationList'
import { Readings, READINGS_LABEL } from '../components/lab/Readings'
import { Term, TermBox, TermGroup, TERM_BOX_CLASS, TERM_CLASS, TERM_OPEN_CLASS, isCloseKey, nextOpenName, termBoxId } from '../components/lab/Term'
import { Pieces } from '../components/lab/RichText'
import { Timeline, timelineAria, formatIsoDate, PREV_LABEL, TODAY_LABEL, NEXT_LABEL, TIMELINE_TITLE } from '../components/lab/Timeline'
import { MiniTrend, miniTrendAria } from '../components/lab/MiniTrend'
import { LearnPanel, LEARN_PANEL_NOTE } from '../components/lab/LearnPanel'
import { MEMO_TITLE, MEMO_LEAD, SUBMIT_LABEL, MODE_FREE_LABEL, MODE_FIELDS_LABEL, FREE_HELP, DECISION_LEGEND, DECISION_HELP } from '../components/lab/MemoForm'
// フェーズA（2026-10-18）
import type { CritiqueFinding } from '../lib/lab/critique/prompt'
import { guardFindings, GUARD_FORBIDDEN } from '../lib/lab/critique/guard'
import { parseFindings, extractJson, requireApiKey } from '../lib/lab/critique/anthropic'
import { EVAL_MEMOS, memoById } from '../evals/critique/memos'
import { buildEvalInput, evalFigures, knownNumbers, classifyNumbers } from '../evals/critique/figures'

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
const j = (v: unknown) => JSON.stringify(v)
/** 注釈を落とす（文字列の中は残す。check-primary-sources.ts と同じ） */
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
function walk(rel: string, re = /\.tsx?$/): string[] {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) return []
  const out: string[] = []
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const r = `${rel}/${e.name}`
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.next') out.push(...walk(r, re)) }
    else if (re.test(e.name)) out.push(r)
  }
  return out
}
/** 描画結果 → 文字だけ（innerText の近似）。エスケープを戻す */
const textOf = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
const render = (el: React.ReactElement) => renderToStaticMarkup(el)
const h = React.createElement
/**
 * 開始タグが re に当たる要素を中身ごと取り除く。同じタグ名の入れ子を数えて対応する閉じタグまで飛ばす。
 *   role="img"（図・時系列）… 中の文字は見た目用（aria-label が同じ内容を運ぶ）
 *   data-critique="flow"（添削 §1）… 利用者の原文（数字が書かれていても出典は付けない）
 */
function stripMatching(html: string, re: RegExp): string {
  let out = ''
  let i = 0
  while (i < html.length) {
    const open = html.indexOf('<', i)
    if (open < 0) { out += html.slice(i); break }
    out += html.slice(i, open)
    const close = html.indexOf('>', open)
    if (close < 0) { out += html.slice(open); break }
    const tag = html.slice(open, close + 1)
    const m = /^<([a-zA-Z][\w-]*)\b/.exec(tag)
    if (!m || !re.test(tag)) { out += tag; i = close + 1; continue }
    const name = m[1]
    const tagRe = new RegExp(`<(/?)${name}\\b[^>]*>`, 'g')
    tagRe.lastIndex = close + 1
    let depth = 1
    let end = html.length
    let mm: RegExpExecArray | null
    while ((mm = tagRe.exec(html))) {
      if (mm[1] === '/') depth--
      else if (!mm[0].endsWith('/>')) depth++
      if (depth === 0) { end = mm.index + mm[0].length; break }
    }
    i = end
  }
  return out
}
const stripRoleImg = (html: string) => stripMatching(html, /\brole="img"/)
/** 添削の 1 節（data-critique="…"）の HTML */
const critiqueSection = (html: string, key: string) => {
  const i = html.indexOf(`data-critique="${key}"`)
  if (i < 0) return ''
  const next = html.indexOf('data-critique="', i + 10)
  return html.slice(i, next < 0 ? undefined : next)
}

// ── 利用者のメモの見本（検査の中だけ） ───────────────────────────────────────
const memo = (over: Partial<LabMemo>): LabMemo => ({ ...EMPTY_MEMO, parts: {}, ...over })
const MEMO_EMPTY = memo({})
const MEMO_ROE_ROA = memo({ decision: 'hold', parts: { metrics: 'ROEは21.2%でROAは11.6%。差が大きい。', conclusion: '次の決算まで保留' } })
const MEMO_FULL = memo({
  decision: 'buy',
  parts: {
    market: '日経平均は決算シーズン。',
    sector: '小売は海外の景気次第。',
    pick: '海外ユニクロの伸びが気になった。',
    metrics: 'PER は加重平均より大きい。EPS と純利益は同じ率で伸びた。営業利益も増えた。ROE と ROA、自己資本比率、営業CF と手元資金、配当、セグメントの内訳を見た。',
    concerns: '来期予想の伸びが小さい理由を確かめていない。',
    conclusion: '利益は増えているが、株価は決算の翌日に下げた。来期の伸びが小さい。',
  },
})
const MEMO_OP_NET = memo({ decision: 'pass', parts: { metrics: '営業利益は5,425億円で前期比プラス。', conclusion: '様子見。' } })
const MEMO_PER_AVG = memo({ decision: 'buy', parts: { metrics: 'PERは小売業の平均より高い。', conclusion: '様子を見て買う。' } })
const MEMO_FREE = memo({ mode: 'free', decision: null, free: '海外の伸びが大きいので買う。' })
const MEMO_FREE_NO_DECISION = memo({ mode: 'free', decision: null, free: '海外の伸びが大きい。' })

// ═════════════════════════════════════════════════════════════════════════════
console.log('■ (b) lib/lab/9983.ts の全数値に SourceRef がある・URL のホストが3つだけ')
{
  const HOSTS = new Set(['www.fastretailing.com', 'www.jpx.co.jp', 'www.nikkei.com'])
  const bare: string[] = []
  const badSource: string[] = []
  let sourced = 0
  const isSourced = (o: unknown): o is { value: unknown; source: { url: string; label: string; asOf: string } } =>
    typeof o === 'object' && o !== null && 'value' in o && 'source' in o && typeof (o as { source: unknown }).source === 'object'
  const visit = (v: unknown, p: string) => {
    if (typeof v === 'number') { bare.push(`${p}=${v}`); return }
    if (Array.isArray(v)) { v.forEach((x, i) => visit(x, `${p}[${i}]`)); return }
    if (typeof v === 'object' && v !== null) {
      if (isSourced(v)) {
        const s = v.source
        let host = ''
        try { host = new URL(s.url).host } catch { host = '' }
        if (!HOSTS.has(host) || !s.label || !s.asOf) badSource.push(`${p}: ${j(s)}`)
        if (typeof v.value === 'number') sourced++
        return
      }
      for (const [k, x] of Object.entries(v)) visit(x, `${p}.${k}`)
    }
  }
  visit(LAB_9983, 'LAB_9983')
  check(`出典の無い number が 0 件（出典つきの number ${sourced} 件）`, bare.length === 0, bare.slice(0, 8).join(', '))
  check('すべての SourceRef の URL が www.fastretailing.com / www.jpx.co.jp / www.nikkei.com で、label・asOf が空でない', badSource.length === 0, badSource.slice(0, 5).join(' | '))
  check('SOURCES は8本（短信・過去5年・1株当たり・ROE/ROA・CF・決算発表・日経・JPX）', Object.keys(SOURCES).length === 8, Object.keys(SOURCES).join(','))
  check('出さないと決めたもの: 2026年8月期の ROA が null（会社未開示）', LAB_9983.roa.points[4].value === null && LAB_9983.roa.points[4].missing === '会社未開示')
  check('出さないと決めたもの: 10/08 の終値（74,800）がデータに無い', !read('lib/lab/9983.ts').includes('74_800') && !read('lib/lab/9983.ts').includes('74800'))
  check('出さないと決めたもの: 小売業の平均自己資本比率が無い（PER 以外に comparisons を持つ項目が無い）', METRIC_ITEMS.every(it => it.key === 'per' || !it.comparisons || it.comparisons.length === 0))
  check('次回の決算は「未定（例年1月上旬）」（日付を書かない）', LAB_9983.company.nextAnnouncement === '未定（例年1月上旬）')
  check('画面1の案内に「おすすめ」が無い・決められた文', LAB_9983.howToUse === '決算前に判断メモを書き、決算後に読み返す、という使い方ができます。')
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('■ (k) money.ts の整形（実データの値）・前期比の計算値が会社公表の % と一致')
{
  check('3,963,389百万円 → 3兆9,634億円', formatMillionYen(3_963_389) === '3兆9,634億円', formatMillionYen(3_963_389))
  check('743,128百万円 → 7,431億円', formatMillionYen(743_128) === '7,431億円', formatMillionYen(743_128))
  check('1,007,586百万円 → 1兆76億円', formatMillionYen(1_007_586) === '1兆76億円', formatMillionYen(1_007_586))
  check('128,500百万円 → 1,285億円／4,450,000百万円 → 4兆4,500億円', formatMillionYen(128_500) === '1,285億円' && formatMillionYen(4_450_000) === '4兆4,500億円')
  check('マイナスは U+2212（−1,285億円）・0 は 0円', formatMillionYen(-128_500) === `${MINUS}1,285億円` && formatMillionYen(0) === '0円' && MINUS.charCodeAt(0) === 0x2212)
  check('円: 1,768.08円／71,780円／891.8円／850円', formatYen(1_768.08) === '1,768.08円' && formatYen(71_780) === '71,780円' && formatYen(891.8) === '891.8円' && formatYen(850) === '850円')
  check('割合・倍率: 62.6%／1.25%／39.3倍／7.73倍', formatPercent(62.6) === '62.6%' && formatPercent(1.25) === '1.25%' && formatTimes(39.3) === '39.3倍' && formatTimes(7.73) === '7.73倍')
  check('符号付き: +25.3%／−2.3%／±0.0%／−3,020円', formatSignedPercent(25.3) === '+25.3%' && formatSignedPercent(-2.3) === `${MINUS}2.3%` && formatSignedPercent(0) === '±0.0%' && formatSignedYen(-3_020) === `${MINUS}3,020円`)
  // 前期比はデータの値から計算する。会社公表の %（fr-9983-verified.md）と一致すること
  const expectYoy: [string, string][] = [
    [yoyText(LAB_9983.sales) ?? '', '+16.6%'],
    [yoyText(LAB_9983.operatingProfit) ?? '', '+31.7%'],
    [yoyText(LAB_9983.netProfit) ?? '', '+25.3%'],
    [yoyText(LAB_9983.eps) ?? '', '+25.3%'],
    [yoyText(LAB_9983.businessProfit) ?? '', '+30.4%'],
    [yoyText(LAB_9983.pretaxProfit) ?? '', '+23.4%'],
  ]
  check('画面に出す前期比は会社公表の値: 売上 +16.6%・営業利益 +31.7%・純利益 +25.3%・EPS +25.3%・事業利益 +30.4%・税引前 +23.4%', expectYoy.every(([a, b]) => a === b), expectYoy.map(x => x.join('≠')).join(' / '))
  const consistency = [LAB_9983.sales, LAB_9983.operatingProfit, LAB_9983.netProfit, LAB_9983.eps, LAB_9983.businessProfit, LAB_9983.pretaxProfit].map(sr => {
    const computed = yoyComputedText(sr)
    const stated = sr.yoy?.value ?? NaN
    const c = computed ? Number.parseFloat(computed.replace(MINUS, '-').replace('%', '')) : NaN
    return [sr.key, c, stated, Math.abs(c - stated)] as const
  })
  check('値から計算した前期比が会社公表の値と 0.1pt 以内（事業利益は丸めで +30.3% vs +30.4%）', consistency.every(x => x[3] <= 0.1 + 1e-9), consistency.map(x => x[0] + ':' + x[1] + '/' + x[2]).join(' '))
  check('来期予想の前期比（会社公表）: 売上 +12.3%・事業利益 +15.5%・純利益 +3.2% が値からも再現できる（0.1pt 以内）',
    LAB_9983.forecasts.every(f => {
      const base = f.key === 'sales' ? LAB_9983.sales : f.key === 'businessProfit' ? LAB_9983.businessProfit : LAB_9983.netProfit
      const prev = base.points[4].value?.value ?? 0
      return Math.abs((f.value.value / prev - 1) * 100 - f.yoy.value) < 0.1
    }))
  check('海外ユニクロの構成比 ≒ 61%（会社の概数から計算）', segmentShare(LAB_9983, 'overseas') === 61, String(segmentShare(LAB_9983, 'overseas')))
  check('実績PER 40.6倍 = 終値 ÷ 基本的EPS（0.05 以内）', Math.abs(LAB_9983.price.close.value / (LAB_9983.eps.points[4].value?.value ?? 1) - LAB_9983.price.trailingPer.value) < 0.05)
  check(
    LAB_SIGN_COLOR
      ? 'signStyle: LAB_SIGN_COLOR=true なのでプラス・マイナスに色が返り、0 は色なし'
      : 'signStyle: LAB_SIGN_COLOR=false なので全部空（色を戻す口）',
    LAB_SIGN_COLOR
      ? signStyle(-1) !== '' && signStyle(1) !== '' && signStyle(0) === ''
      : signStyle(-1) === '' && signStyle(1) === '' && signStyle(0) === '')
  // レビュー W1（2026-10-09）: 比率（%）の前期比は比ではなく差（ポイント）
  const roeS = yoySentence(LAB_9983.roe)
  const eqS = yoySentence(LAB_9983.equityRatio)
  check('W1: yoySentence(ROE) が「ポイント」を含み「%です」を含まない／自己資本比率も同様', roeS.includes('ポイント') && !roeS.includes('%です') && eqS.includes('ポイント') && !eqS.includes('%です'), `${roeS} / ${eqS}`)
  check('W1: ROE 20.2% → 21.2% は「前の期は 20.2%。+1.0ポイントです。」／自己資本比率 58.9% → 62.6% は +3.7ポイント', roeS === '前の期は 20.2%。+1.0ポイントです。' && yoyText(LAB_9983.equityRatio) === '+3.7ポイント' && yoyPointDelta(LAB_9983.equityRatio) === 3.7, `${roeS} / ${yoyText(LAB_9983.equityRatio)}`)
  check('W1: formatSignedPoint: +3.7ポイント／−1.2ポイント（U+2212）／±0.0ポイント', formatSignedPoint(3.7) === '+3.7ポイント' && formatSignedPoint(-1.2) === `${MINUS}1.2ポイント` && formatSignedPoint(0) === '±0.0ポイント')
  check('W1: 金額の系列は従来どおり %（営業利益 +31.7%・会社公表の値）', yoySentence(LAB_9983.operatingProfit) === '前の期は 5,643億円。前期比 +31.7% です（会社公表の値）。', yoySentence(LAB_9983.operatingProfit))
  // レビュー S4: テンプレ内の比較の断定をデータで検証（データを差し替えたとき黙って偽にならないように）
  const last = (sr: { points: { value: { value: number } | null }[] }) => sr.points[sr.points.length - 1]?.value?.value ?? NaN
  const prev = (sr: { points: { value: { value: number } | null }[] }) => sr.points[sr.points.length - 2]?.value?.value ?? NaN
  const d = LAB_9983
  check('S4: 営業CF > 純利益（explain.cash「純利益より大きい額です」）', last(d.operatingCf) > last(d.netProfit))
  check('S4: 自己資本比率が毎期大きくなっている（explain.equityRatio「毎期大きくなっています」）', d.equityRatio.points.every((pt, i) => i === 0 || (pt.value?.value ?? -1) > (d.equityRatio.points[i - 1].value?.value ?? Infinity)))
  const overseas = d.segments.find(x => x.key === 'overseas')
  check('S4: 海外ユニクロの前期比 > 売上収益の前期比（explain.segments「全体の伸びを上回っている」）', (overseas?.yoy.value ?? -1) > (d.sales.yoy?.value ?? Infinity))
  check('S4: 営業利益の伸び > 純利益の伸び（explain.profit「より大きい」）・EPS の伸び ≒ 純利益の伸び（0.1pt 以内。「同じ率で伸びている」）', (d.operatingProfit.yoy?.value ?? -1) > (d.netProfit.yoy?.value ?? Infinity) && Math.abs((d.eps.yoy?.value ?? 0) - (d.netProfit.yoy?.value ?? 99)) <= 0.1)
  const nextNet = d.forecasts.find(f => f.key === 'netProfit')
  check('S4: 売上・営業利益・純利益・EPS がすべて前期より増えた（explainChain「すべて増えました」）・翌日の株価は前日比マイナス・来期予想の伸び < 今期の伸び（「それまでの伸びより小さく」）',
    [d.sales, d.operatingProfit, d.netProfit, d.eps].every(sr => last(sr) > prev(sr)) && d.price.changePct.value < 0 && (nextNet?.yoy.value ?? Infinity) < (d.netProfit.yoy?.value ?? -1))
  check('S4: 手元資金・配当は前の期より増え、配当性向は大きくなり、ROE は前期の ROA より大きい（explain.cash／dividend／roeRoa の記述）', last(d.cash) > prev(d.cash) && last(d.dividend) > prev(d.dividend) && d.payoutRatio.curr.value > d.payoutRatio.prev.value && last(d.roe) > prev(d.roa))
  check('S4: 「株数がほぼ変わらず」の断定が無い（推論の形に）', !read('lib/lab/9983.ts').includes('株数がほぼ変わらず'))
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('■ (j) lineGeometry（折れ線の座標）が正負で同じ倍率')
{
  const g = lineGeometry([-10, 20, null, 0], 60)
  check('k = plotH / (maxPos + maxNeg) = 2・ゼロ線 y = 40', g.k === 2 && g.zeroY === 40, j(g))
  check('プラスは上（y=0）・マイナスは下（y=60）・欠損は null・0 はゼロ線', g.ys[0] === 60 && g.ys[1] === 0 && g.ys[2] === null && g.ys[3] === 40)
  check('単位あたりの px が正負で等しい', (g.zeroY - (g.ys[1] as number)) / 20 === ((g.ys[0] as number) - g.zeroY) / 10)
  const z = lineGeometry([null, null], 60)
  check('全部欠損なら k=0・ゼロ線は下端', z.k === 0 && z.zeroY === 60)
  const aria = miniTrendAria('試験', 'millionYen', [{ fy: 'FY2025', value: -128_500 }, { fy: 'FY2026', value: null, missing: '会社未開示' }])
  check('aria-label: マイナスは「（マイナス）」・欠損は理由（会社未開示）', aria.includes(`${MINUS}1,285億円（マイナス）`) && aria.includes('2026年8月期 は会社未開示'), aria)
  const svg = render(h(MiniTrend, { label: '試験', unit: 'millionYen', points: [{ fy: 'FY2025', value: -1 }, { fy: 'FY2026', value: 2 }], initialWidth: 320 }))
  check('MiniTrend: role="img"・aria-label・SVG は aria-hidden・ゼロ線は var(--axis)・マイナスの点は塗り、プラスは中空', /role="img"/.test(svg) && /aria-label="/.test(svg) && svg.includes('aria-hidden="true"') && svg.includes('stroke="var(--axis)"') && svg.includes('fill="var(--ink)"') && /fill="var\(--card\)"/.test(svg) && /stroke="var\(--ink\)"/.test(svg))
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('■ (h) 添削の見出しが7つ・固定順（データと描画）')
{
  const titles = CRITIQUE_SECTIONS.map(s => s.title)
  // §3 は 2026-10-19（S-L1a・公開に合わせたオーナー決定）に「誤り・要確認」→「計算の確かめと、確認したいこと」（断定から問いの形へ）
  check('sections.ts: 7節・順番固定（§3 は「計算の確かめと、確認したいこと」）', j(titles) === j(['あなたの判断の流れ', '書けていたこと', '計算の確かめと、確認したいこと', '確認が抜けている項目', '情報のつなげ方の例', '次に学ぶとよいテーマ', '注意事項']), titles.join(' / '))
  check('sections.ts: §3 に断定の語「誤り」が残っていない・key と no は 3 のまま', !titles[2].includes('誤り') && CRITIQUE_SECTIONS[2].key === 'check' && CRITIQUE_SECTIONS[2].no === 3)
  check('sections.ts: 番号が 1..7', j(CRITIQUE_SECTIONS.map(s => s.no)) === j([1, 2, 3, 4, 5, 6, 7]))
  const html = render(h(CritiqueView, { critique: composeCritique(MEMO_FULL) }))
  const order = [...html.matchAll(/<h3 class="text-h3 text-ink">§(\d) ([^<]+)<\/h3>/g)].map(m => [Number(m[1]), m[2]])
  check('CritiqueView: h3 が §1〜§7 の順で7つ・見出し文が sections.ts と同じ', j(order) === j(CRITIQUE_SECTIONS.map(s => [s.no, s.title])), j(order))
  check('CritiqueView: h2 は「添削」・バッジ「このサイトは良し悪しを判定しません」', html.includes(`<h2 id="lab-critique-heading" class="text-h2 text-ink">${CRITIQUE_TITLE}</h2>`) && html.includes(BADGE))
  check('CritiqueView: 「役に立った」のボタンが無い（S-A では保存先が無い）', !html.includes('役に立'))
  check('CritiqueView: §7 に Disclaimer（part="general"）の定型文と固定文3本', html.includes(DISCLAIMER_TEXT) && NOTES_TEXT.every(t => html.includes(t)))
  // 新規（2026-10-19 S-L1a）: §3 の範囲を断る文は当たりが0件でも描く。
  // 「見つからなかったこと」を「問題なし」と読まれないため。公開したので、ここが条件に包まれたら法務の線が崩れる
  {
    const zero = composeCritique(MEMO_FULL) // 誤りの無い手本メモ → §3 の当たりは0件
    const many = composeCritique(MEMO_ROE_ROA) // 当たりがある
    const htmlZero = render(h(CritiqueView, { critique: zero }))
    const htmlMany = render(h(CritiqueView, { critique: many }))
    check('CritiqueView: §3 の範囲を断る文（CHECK_SCOPE_NOTE）が当たり0件のときも描かれる（当たりありのときも同じ1本）',
      zero.check.hits.length === 0 && many.check.hits.length > 0
      && textOf(htmlZero).includes(CHECK_SCOPE_NOTE) && textOf(htmlMany).includes(CHECK_SCOPE_NOTE),
      `hits0=${zero.check.hits.length} hitsN=${many.check.hits.length}`)
    check('CritiqueView.tsx: 範囲を断る文の <p> が §3 の三項演算子の外にある（条件で包まない・<details> で畳まない）', (() => {
      const src = stripComments(read('components/lab/CritiqueView.tsx'))
      const sec = src.slice(src.indexOf('data-critique="check"'), src.indexOf('data-critique="missing"'))
      const at = sec.indexOf('{critique.check.scopeNote}')
      if (at < 0) return false
      // 三項の閉じ（`)}`）より後ろにあり、その <p> まで && や ? の分岐が無い
      const closeAt = sec.lastIndexOf(')}', at)
      const tail = sec.slice(closeAt, at)
      return closeAt > 0 && !/&&|\?\s*\(|<details/.test(tail)
    })())
    check('CritiqueView: バッジ（良し悪しを判定しません）も当たり0件のときに出る', textOf(htmlZero).includes(BADGE))
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('■ (i) compose を実際に呼ぶ')
{
  const ids = (m: LabMemo) => composeCritique(m).check.hits.map(x => x.id)
  check('結論が空のメモ → §3 に conclusion-empty', ids(MEMO_EMPTY).includes('conclusion-empty'), ids(MEMO_EMPTY).join(','))
  check('ROE と ROA の差について書いたメモ → §3 に roe-roa-mix。開示値 11.6% は roa-unpublished にならない', ids(MEMO_ROE_ROA).includes('roe-roa-mix') && !ids(MEMO_ROE_ROA).includes('roa-unpublished'), ids(MEMO_ROE_ROA).join(','))
  const full = composeCritique(MEMO_FULL)
  check('全欄埋まったメモ → §2 に「6つの欄のうち 6つに記入」・結論: 買う', full.written.lines[0].startsWith(`${MEMO_FIELDS.length}つの欄のうち ${MEMO_FIELDS.length}つに記入がありました`) && full.written.lines.includes('結論: 買う。') && full.written.filledKeys.length === 6, full.written.lines.join(' / '))
  check('全欄埋まったメモ → §1 は原文の逐語引用（6本・順番は欄の順・書き換え無し）', full.flow.quotes.length === 6 && full.flow.quotes.every((q, i) => q.label === MEMO_FIELDS[i].label && q.text === MEMO_FULL.parts[MEMO_FIELDS[i].key]) && full.flow.decision === '買う')
  check('全欄埋まったメモ（8項目すべてに言及）→ §4 は「ありません」・§6 は chain', full.missing.items.length === 0 && full.missing.noneText !== null && full.learn.theme.key === 'chain', `${full.missing.items.map(m => m.key).join(',')} / ${full.learn.theme.key}`)
  check('全欄埋まったメモ → §3 に結論が空・理由が空は出ない', !ids(MEMO_FULL).includes('conclusion-empty') && !ids(MEMO_FULL).includes('conclusion-reason-empty'), ids(MEMO_FULL).join(','))
  const empty = composeCritique(MEMO_EMPTY)
  check('空のメモ → §1 は「書かれた文はありません」・§4 は8項目全部・§6 は perGrowth（規則の先頭）', empty.flow.quotes.length === 0 && empty.missing.items.length === METRIC_ITEMS.length && empty.learn.theme.key === 'perGrowth')
  check('営業利益に純利益の数字（5,425億円）を書いたメモ → §3 に op-net-mix', ids(MEMO_OP_NET).includes('op-net-mix'), ids(MEMO_OP_NET).join(','))
  check('「PER は小売業の平均より高い」→ §3 に per-average-kind と per-only', ids(MEMO_PER_AVG).includes('per-average-kind') && ids(MEMO_PER_AVG).includes('per-only'), ids(MEMO_PER_AVG).join(','))
  // per-average-kind は近さを要求する（2026-10-19・実物のメモでの誤発火の修正）
  const perAvg = (text: string) => ids(memo({ mode: 'free', decision: null, free: text })).includes('per-average-kind')
  check('per-average-kind: 実物1の原文（「PERの意味が分からなかった」と「業種別の値上がりランキング」が離れて存在）では発火しない', !perAvg(memoById('collected-undecided').text))
  check('per-average-kind: 「PERは小売業の加重平均より高い」→ 発火しない（加重と書いてある）', !perAvg('PERは小売業の加重平均より高い。'))
  check('per-average-kind: 「PERは小売業の平均より高い」→ 発火する', perAvg('PERは小売業の平均より高い。'))
  check('per-average-kind: 「PERの意味が分からなかった。業種別のランキングを見た。」→ 発火しない（今回の誤発火そのもの）', !perAvg('PERの意味が分からなかった。業種別のランキングを見た。'))
  check('per-average-kind: 文をまたいでも「平均」が 40 字以内なら発火する（「PERは39.3倍。小売業の平均より高い。」）・40 字より遠ければしない', perAvg('PERは39.3倍。小売業の平均より高い。') && !perAvg(`PERは39.3倍。${'海外の伸びが大きい。'.repeat(5)}小売業の平均より高い。`))
  check('nearby: 近い・遠い・重なり・g 無しの RegExp でも動く', nearby('PERは39.3倍。平均より高い', /PER/, /平均/, 40) && !nearby(`PER${'あ'.repeat(41)}平均`, /PER/, /平均/, 40) && nearby(`PER${'あ'.repeat(40)}平均`, /PER/, /平均/, 40) && nearby('平均PER', /PER/, /平均/, 0))
  check('自由記述で「買う」と書けば結論が空にならない／書かなければ空になる', !ids(MEMO_FREE).includes('conclusion-empty') && ids(MEMO_FREE_NO_DECISION).includes('conclusion-empty'))
  const free = composeCritique(MEMO_FREE)
  check('自由記述 → §1 は「自由記述」1本の逐語引用・§2 は文字数', free.flow.quotes.length === 1 && free.flow.quotes[0].label === '自由記述' && free.flow.quotes[0].text === MEMO_FREE.free && /自由記述で \d+ 文字/.test(free.written.lines[0]))
  // 本文の穴埋めが全部埋まっている（{…} が残らない）
  const all = [MEMO_EMPTY, MEMO_ROE_ROA, MEMO_FULL, MEMO_OP_NET, MEMO_PER_AVG, MEMO_FREE].map(m => composeCritique(m))
  const leftovers = all.flatMap(c => [...c.check.hits.flatMap(x => [x.body, ...x.details.map(d => d.text)]), ...c.connect.lines, ...c.written.lines]).filter(t => /\{[A-Za-z]+\}/.test(t))
  check('§3 の本文・§5 の併置文に {var} が残っていない', leftovers.length === 0, leftovers.slice(0, 3).join(' | '))
  check('§5 は固定の併置文4本（買う／買わないを言わない）', full.connect.lines.length === 4 && CONNECT_TEMPLATES.length === 4 && full.connect.lines.every(l => !/買う|買わない|売る|売らない/.test(l)))
  check('§3 の文に「間違っていた」「買うべき」が無い（カタログの本文）', CATALOGUE.every(e => !/間違っていた|買うべき|買わないべき/.test(e.title + e.body)))
  check('カタログ: id が一意・kind は calc/check・本文は {var} 以外に2桁以上の数字を直書きしない', new Set(CATALOGUE.map(e => e.id)).size === CATALOGUE.length && CATALOGUE.every(e => (e.kind === 'calc' || e.kind === 'check') && !/\d{2,}/.test(e.body.replace(/\{[A-Za-z]+\}/g, ''))))
  check('numbersNear: 「営業利益は5,425億円」→ 5425・approxEqual は 0.5% 以内', j(numbersNear('営業利益は5,425億円で', '営業利益')) === j([5425]) && approxEqual(5425, 5425.16) && !approxEqual(5425, 7431))
  check('mentionedMetrics: 「海外の景気」だけではセグメントに触れたことにならない', !mentionedMetrics('海外の景気次第').itemKeys.includes('segments') && mentionedMetrics('海外ユニクロの売上').itemKeys.includes('segments'))
  check('pickTheme: 規則の表は画面2の項目 key だけを指す・テーマは8本で key が一意', THEME_FOR_MISSING.every(r => METRIC_ITEMS.some(it => it.key === r.metricKey)) && LEARN_THEMES.length === 8 && new Set(LEARN_THEMES.map(t => t.key)).size === 8 && pickTheme(['dividend']).key === 'dividend')
  check('テーマの parts は画面2の項目 key か chain だけ', LEARN_THEMES.every(t => (t.parts.metricKeys ?? []).every(k => METRIC_ITEMS.some(it => it.key === k)) && ((t.parts.metricKeys?.length ?? 0) > 0 || t.parts.chain === true)))
  // レビュー W2（2026-10-09）: 共起だけで発火しない
  check('W2: 誤りの無い手本メモ（MEMO_FULL）→ §3 は「見つかりませんでした」（hits 0）', ids(MEMO_FULL).length === 0 && composeCritique(MEMO_FULL).check.nothingFound === NOTHING_FOUND, ids(MEMO_FULL).join(','))
  check('W2: 「ROEとROAを見た」（共起だけ）→ roe-roa-mix が出ない', !ids(memo({ decision: 'hold', parts: { metrics: 'ROEとROAを見た', conclusion: '保留' } })).includes('roe-roa-mix'))
  check('W2: 「ROEは21.2%でROAは11.6%。差が大きい。」（次の文に比較の語）→ roe-roa-mix が出る', ids(MEMO_ROE_ROA).includes('roe-roa-mix'))
  check('W2: roe-roa-mix は kind=check・題は「ROE と ROA を同じ期で比べているか」（計算の誤りを示唆しない）', catalogueById('roe-roa-mix').kind === 'check' && catalogueById('roe-roa-mix').title === 'ROE と ROA を同じ期で比べているか')
  check('W2: 「事業利益」1語 → business-vs-operating が出ない／「事業利益」と「営業利益」の両方 → 出る',
    !ids(memo({ decision: 'hold', parts: { metrics: '事業利益が増えた', conclusion: '保留' } })).includes('business-vs-operating')
    && ids(memo({ decision: 'hold', parts: { metrics: '事業利益と営業利益を見た', conclusion: '保留' } })).includes('business-vs-operating'))
  check('W2: 別の文の「加重平均」では equity-average が出ない（同じ文の中だけ）', !ids(memo({ decision: 'hold', parts: { metrics: 'PER は加重平均より大きい。自己資本比率を見た。', conclusion: '保留' } })).includes('equity-average'))
  // レビュー W3: §2 の「指標」からセグメント名と「株価」を外す
  const seg = mentionedMetrics('海外ユニクロの売上')
  check('W3: mentionedMetrics(「海外ユニクロの売上」) の names に「海外ユニクロ」を含まず、segments に含み、itemKeys に segments を含む', !seg.names.includes('海外ユニクロ') && seg.segments.includes('海外ユニクロ') && seg.itemKeys.includes('segments'), j(seg))
  check('W3: EXTRA_NAMES に「株価」が無い／「目標株価」「株価収益率」で「株価」が指標に数えられない', EXTRA_NAMES.every(n => n.name !== '株価') && !mentionedMetrics('目標株価と株価収益率').names.includes('株価'))
  check('W3: MEMO_FULL の §2 は「名前で書かれた指標:」と「触れていた内訳:」の2行・小見出しは「名前で書かれた項目」', full.written.nameLines.length === 2 && full.written.nameLines[0].startsWith('名前で書かれた指標: ') && !full.written.nameLines[0].includes('海外ユニクロ') && full.written.nameLines[1] === '触れていた内訳: セグメント、海外ユニクロ。' && full.written.namesHeading === NAMES_HEADING && NAMES_HEADING === '名前で書かれた項目', full.written.nameLines.join(' | '))
  check('W3: 内訳に触れていないメモは「触れていた内訳」の行が出ない', composeCritique(MEMO_ROE_ROA).written.nameLines.length === 1)
  // レビュー S3: 英字の語は単語境界
  check('S3: "approach"／"heroes"／"roads"（英字に埋まった PER／ROE／ROA）は指標に数えられず、"PER" "ROE" "ROA" は数えられる',
    !mentionedMetrics('approach と heroes と roads').names.some(n => n === 'PER' || n === 'ROE' || n === 'ROA') && ['PER', 'ROE', 'ROA'].every(n => mentionedMetrics('PER と ROE と ROA').names.includes(n)))
  check('S3: catalogue の PER も単語境界（"approach は平均より" で per-average-kind が出ない）', !ids(memo({ decision: 'buy', parts: { metrics: 'approach は平均より', conclusion: '買う' } })).includes('per-average-kind'))
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('■ (a) 画面の文字列に禁止語が無い')
{
  const vars = labVars(LAB_9983)
  const strings: string[] = []
  const collect = (v: unknown) => {
    if (typeof v === 'string') strings.push(v)
    else if (Array.isArray(v)) v.forEach(collect)
    else if (typeof v === 'object' && v !== null) Object.values(v).forEach(collect)
  }
  collect(LAB_9983)
  collect(MEMO_FIELDS)
  collect(DECISION_OPTIONS)
  collect(GLOSSARY_EXTRA)
  collect(CRITIQUE_SECTIONS)
  collect(NOTES_TEXT)
  collect(LEARN_THEMES)
  collect(CATALOGUE.map(e => ({ title: e.title, body: fill(e.body, vars) })))
  collect(CONNECT_TEMPLATES.map(t => fill(t, vars)))
  collect([PAGE_KICKER, PAGE_LEAD, FIXED_COMPANY_NOTE, NO_AI_NOTE, WHEN_TITLE, GLOSSARY_TITLE, CRITIQUE_LEAD, BADGE, NO_QUOTES, OPEN_LEARN, CLOSE_LEARN, ...Object.values(KIND_LABEL),
    METRICS_TITLE, METRICS_LEAD, SOURCE_NOTE, LINK_NOTE, EXPLAIN_BUTTON, EXPLAIN_CLOSE, READINGS_LABEL, CHAIN_TITLE, CHAIN_LEAD, PRICE_NOTE, CHAIN_NOTE,
    CITATIONS_TITLE, CITATIONS_LEAD, NEXT_NOTE, PREV_LABEL, TODAY_LABEL, NEXT_LABEL, TIMELINE_TITLE,
    LEARN_PANEL_NOTE, MEMO_TITLE, MEMO_LEAD, SUBMIT_LABEL, MODE_FREE_LABEL, MODE_FIELDS_LABEL, FREE_HELP, DECISION_LEGEND, DECISION_HELP, NOTHING_FOUND, CHECK_SCOPE_NOTE])
  // 描画結果（初期状態・解説を開いた状態・添削・学ぶの全テーマ・出典の節）
  const pages = [
    render(h(Lab9983Client)),
    render(h(MetricRows, { defaultOpen: true })),
    render(h(CausalMap)),
    render(h(CitationList)),
    ...[MEMO_EMPTY, MEMO_ROE_ROA, MEMO_FULL, MEMO_OP_NET, MEMO_PER_AVG, MEMO_FREE].map(m => render(h(CritiqueView, { critique: composeCritique(m) }))),
    ...LEARN_THEMES.map(t => render(h(LearnPanel, { theme: t }))),
  ].map(textOf)
  const stripDisclaimer = (t: string) => t.split(DISCLAIMER_TEXT).join('')
  const hits = [...strings, ...pages].flatMap(t => labForbiddenWordsIn(stripDisclaimer(t)).map(w => `「${w}」 in ${t.slice(0, 40)}…`))
  check(`データ・固定文・描画結果（${strings.length} 本＋${pages.length} 画面）に禁止語が無い（forbidden.ts＋LAB_FORBIDDEN ${LAB_FORBIDDEN.length} 語。免責の定型文と「将来を予測するものではありません」は除く）`, hits.length === 0, [...new Set(hits)].slice(0, 8).join(' | '))
  // 部品・画面のソース（注釈を除く）にも無い
  const srcHits: string[] = []
  for (const f of [...walk('components/lab'), ...walk('app/study')]) {
    const src = stripComments(read(f))
    for (const w of labForbiddenWordsIn(src)) srcHits.push(`${f}: ${w}`)
  }
  check('components/lab/**・app/study/** のソース（注釈を除く）に禁止語が無い', srcHits.length === 0, srcHits.join(' | '))
  check('EPS × PER の積を株価として描かない（描画結果に「÷ EPS ＝ PER」の注記があり、株価の箱は終値 71,780円）', pages[2].includes('PER は株価から計算した数字') && pages[2].includes('71,780円') && pages[2].includes(PRICE_NOTE))
  check('描画結果にハイフンの負号（-4.04 / -3,020 / -2.3）が無く U+2212 で出る', pages.every(p => !/-\d/.test(p.replace(/\d{4}-\d{2}-\d{2}/g, ''))) && pages[2].includes(`${MINUS}4.04%`) && pages[2].includes(`${MINUS}3,020円`))
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('■ (c) 解説文・固定文の本文に2桁以上の数字の直書きが無い（{var} で埋める）')
{
  const ALLOW = ['30秒']
  const templates: [string, string][] = []
  for (const it of METRIC_ITEMS) for (const t of [...it.explain.facts, ...it.explain.readings]) templates.push([`explain.${it.key}`, t])
  for (const t of [...EXPLAIN_CHAIN.facts, ...EXPLAIN_CHAIN.readings]) templates.push(['explainChain', t])
  for (const e of CATALOGUE) templates.push([`catalogue.${e.id}`, e.title], [`catalogue.${e.id}`, e.body])
  CONNECT_TEMPLATES.forEach((t, i) => templates.push([`connect[${i}]`, t]))
  for (const t of LEARN_THEMES) templates.push([`theme.${t.key}`, t.title], [`theme.${t.key}`, t.lead])
  NOTES_TEXT.forEach((t, i) => templates.push([`notes[${i}]`, t]))
  for (const g of GLOSSARY_EXTRA) templates.push([`glossary.${g.name}`, g.body])
  for (const f of MEMO_FIELDS) templates.push([`memo.${f.key}`, f.question], [`memo.${f.key}`, f.help], [`memo.${f.key}`, f.placeholder])
  for (const [k, t] of Object.entries({ PAGE_LEAD, METRICS_LEAD, SOURCE_NOTE, CHAIN_LEAD, PRICE_NOTE, CHAIN_NOTE, CITATIONS_LEAD, NEXT_NOTE, MEMO_LEAD, FREE_HELP, DECISION_HELP, CRITIQUE_LEAD, CHECK_SCOPE_NOTE, LEARN_PANEL_NOTE, EXPLAIN_BUTTON, howToUse: LAB_9983.howToUse })) templates.push([k, t])
  const bad = templates.filter(([, t]) => {
    let s = t.replace(/\{[A-Za-z][A-Za-z0-9]*\}/g, '')
    for (const a of ALLOW) s = s.split(a).join('')
    return /\d{2,}/.test(s)
  })
  check(`${templates.length} 本の本文に2桁以上の数字の直書きが無い（許可: ${ALLOW.join('・')}）`, bad.length === 0, bad.map(([k, t]) => `${k}: ${t.slice(0, 30)}`).slice(0, 5).join(' | '))
  // 変数が全部埋まる（未定義の {var} が無い）
  const vars = labVars(LAB_9983)
  const unfilled = templates.filter(([, t]) => { try { fill(t, vars); return false } catch { return true } })
  check('すべての {var} が labVars で埋まる（未定義が無い）', unfilled.length === 0, unfilled.map(([k]) => k).join(', '))
  check('labVars の値に {…} や undefined が無い', Object.values(vars).every(v => typeof v === 'string' && v.length > 0 && !v.includes('{') && v !== 'undefined'))
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('■ (d) components/lab/** に色の直値が無い・見出しの階層・role="img"・出所が無条件')
{
  const files = [...walk('components/lab'), ...walk('app/study')]
  check('components/lab/** は14ファイル（2026-10-12 に CitationMark・CitationList・Readings・RichText・Term・Timeline を追加）・app/study は page.tsx と client.tsx', walk('components/lab').length === 14 && exists('app/study/page.tsx') && exists('app/study/client.tsx'), files.join(','))
  const COLOR = /--success|--danger|--warning-ink|text-success|text-danger|text-warning-ink|bg-success|bg-danger|bg-warning|border-success|border-danger|text-red|text-green|bg-red|bg-green|#[0-9A-Fa-f]{3,8}\b|rgba?\(/
  for (const f of files) {
    const src = stripComments(read(f))
    check(`${f}: --success／--danger／--warning-ink／生の色（#… rgb(…）が無い`, !COLOR.test(src), (COLOR.exec(src) ?? [''])[0])
    check(`${f}: font-bold／font-extrabold が無い・12px 未満の class（text-[10px] 等）が無い`, !/font-bold|font-extrabold|text-\[(?:[0-9]|1[01])px\]/.test(src))
    const h2s = [...src.matchAll(/<h2(\s[^>]*)?>/g)].map(m => m[1] ?? '')
    const h1s = [...src.matchAll(/<h1(\s[^>]*)?>/g)].map(m => m[1] ?? '')
    const h3s = [...src.matchAll(/<h3(\s[^>]*)?>/g)].map(m => m[1] ?? '')
    check(`${f}: h1/h2/h3 の class が text-h1/h2/h3 text-ink（h1 ${h1s.length}・h2 ${h2s.length}・h3 ${h3s.length}）`,
      h1s.every(a => /className="text-h1 text-ink/.test(a)) && h2s.every(a => /className="text-h2 text-ink/.test(a)) && h3s.every(a => /className="text-h3 text-ink/.test(a)))
    check(`${f}: 回り続ける動き（infinite／animate-spin・pulse・ping・bounce）が無い`, !/\binfinite\b|animate-(?:spin|pulse|ping|bounce)/.test(src))
  }
  const mini = stripComments(read('components/lab/MiniTrend.tsx'))
  check('MiniTrend.tsx: role="img"・aria-label・ResizeObserver・viewBox', mini.includes('role="img"') && mini.includes('aria-label=') && mini.includes('ResizeObserver') && mini.includes('viewBox='))
  const rows = stripComments(read('components/lab/MetricRows.tsx'))
  check('MetricRows.tsx: figcaption（出所）は条件分岐の外・<details で畳まない・帯1本＋border-t の区切り', rows.includes('<figcaption') && !rows.includes('<details') && rows.includes("const ROW = 'mx-4 border-t border-border first:border-t-0") && (rows.match(/<figure/g) ?? []).length === 1)
  const page = textOf(render(h(Lab9983Client)))
  check('初期描画に 出所の固定文・リンクの注記・免責の定型文・画面1の案内文がある', page.includes(SOURCE_NOTE) && page.includes(LINK_NOTE) && page.includes(DISCLAIMER_TEXT) && page.includes(LAB_9983.howToUse))
  const pageHtml = render(h(Lab9983Client))
  check('初期描画: 画面2の8項目が固定の順で出る（データだけから描く）', (() => { let last = -1; for (const it of METRIC_ITEMS) { const i = pageHtml.indexOf(`data-metric="${it.key}"`); if (i <= last) return false; last = i } return true })())
  check('初期描画: 主ボタンは「添削を読む」1つ（bg-brand の button が1つ）', (pageHtml.match(/<button[^>]*bg-brand[^>]*>/g) ?? []).length === 1)
  check('初期描画: 添削は出ていない（送信前）・「残り日数」の行が無い（次回決算日が未定）', !page.includes(`§1 ${CRITIQUE_SECTIONS[0].title}`) && !/残り\s*日数|あと\s*\d+\s*日/.test(page) && page.includes(LAB_9983.company.nextAnnouncement))
  const nodes = chainNodes()
  check('CausalMap: 箱は 売上収益 → 営業利益 → 純利益 → EPS → 株価（終値）の5つ・つなぎは4本', j(nodes.map(n => n.key)) === j(['sales', 'operatingProfit', 'netProfit', 'eps', 'price']) && nodes.filter(n => n.link).length === 4 && nodes[4].valueText === '71,780円')
  check('CausalMap: 各箱に出典の番号（cite）があり、前期比・前日比の数字（会社公表・日経）にも番号がある', nodes.every(n => n.cite != null && (n.yoy == null || n.yoy.values.every(v => v.cite != null))), j(nodes.map(n => [n.key, n.cite, n.yoy?.values.map(v => v.cite)])))
  // レビュー S1: 期は値のラベル側（periodText）に置く。2026-10-12 からは出所が右肩の番号なので、出所の行そのものが無い
  check('S1: CausalMap の各箱は periodText を持つ（期は値のラベル側）', nodes.every(n => n.periodText.length > 0), nodes.map(n => n.periodText).join(' | '))
  check('S1→(a): MetricRows・SegmentBars・CausalMap・YearBarsLab・MiniTrend・client.tsx のソースに「出所:」の行・「出所（」の見出し・sourceLine が無い（出所は右肩の [N]）',
    ['components/lab/MetricRows.tsx', 'components/lab/SegmentBars.tsx', 'components/lab/CausalMap.tsx', 'components/lab/YearBarsLab.tsx', 'components/lab/MiniTrend.tsx', 'app/study/client.tsx'].every(f => { const s = stripComments(read(f)); return !s.includes('出所:') && !s.includes('出所（') && !s.includes('sourceLine') }))
  check('S1: 画面1は「2026-10-08 [N] 発表・2026年8月期（通期）」の形（日付の直後に出典の番号）', /2026-10-08 \[\d+\] 発表・2026年8月期（通期）/.test(page))
  // レビュー S6: 「連結・IFRS・円」は会社開示の出典だけに付け、JPX・日経には付けない（2026-10-12 からは「出典」の一覧の発行元の欄）
  const cites = citationList()
  check('S6: 出典の一覧で「連結・IFRS・円」が付くのは www.fastretailing.com の出典だけ。JPX・日経の発行元には付かない', cites.every(c => (c.url.includes('www.fastretailing.com') ? c.publisher.includes('連結・IFRS・円') : !c.publisher.includes('連結・IFRS・円'))) && cites.some(c => c.publisher.includes('JPX')) && cites.some(c => c.publisher.includes('日経')), cites.map(c => c.publisher).join(' | '))
  // レビュー S8: signStyle を接続（既定 false では何も変わらない）
  check('S8: signStyle が MetricRows（セグメントの前期比）と CausalMap（箱の前期比・内訳）に接続されている', rows.includes('signStyle(') && stripComments(read('components/lab/CausalMap.tsx')).includes('signStyle('))
  {
    const painted = render(h(CausalMap)) + render(h(MetricRows, { defaultOpen: true }))
    // 色は足すだけ。形（中空と塗り）・符号（U+2212）・語（マイナス）の手がかりが消えていないこと
    check('S8: 色が入っても符号 U+2212 と「マイナス」の語が残る（色だけに頼らない）',
      painted.includes('\u2212') && /マイナス/.test(painted))
    check(
      LAB_SIGN_COLOR
        ? 'S8: LAB_SIGN_COLOR=true なので --success／--danger が描画に出る'
        : 'S8: LAB_SIGN_COLOR=false なので --success／--danger が描画に出ない',
      LAB_SIGN_COLOR ? /--success|--danger/.test(painted) : !/--success|--danger/.test(painted))
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('■ (l) 描画結果の Sourced 由来の数字の直後に [N] がある（2026-10-12 読みやすさ (a)）')
{
  const d = LAB_9983
  // 期待する数字の文字列: データの全 Sourced<number> を画面と同じ整形で
  const expected = new Set<string>()
  const add = (s: Sourced<number> | null | undefined, f: (n: number) => string) => { if (s) expected.add(f(s.value)) }
  const allSeries = [d.sales, d.businessProfit, d.operatingProfit, d.pretaxProfit, d.netProfit, d.eps, d.bps, d.dividend, d.totalAssets, d.equity, d.equityRatio, d.roe, d.roa, d.operatingCf, d.cash]
  for (const sr of allSeries) { for (const p of sr.points) add(p.value, n => formatByUnit(n, sr.unit)); add(sr.yoy, formatSignedPercent) }
  for (const it of METRIC_ITEMS) { for (const hd of it.headlines ?? []) add(hd.value, n => formatByUnit(n, hd.unit)); for (const c of it.comparisons ?? []) add(c.value, n => formatByUnit(n, c.unit)) }
  for (const sg of d.segments) { add(sg.prev, formatMillionYen); add(sg.curr, formatMillionYen); add(sg.yoy, formatSignedPercent) }
  add(d.price.close, formatYen); add(d.price.changeYen, formatSignedYen); add(d.price.changePct, formatSignedPercent)
  add(d.price.forwardPer, formatTimes); add(d.price.trailingPer, formatTimes); add(d.price.pbr, formatTimes); add(d.price.dividendYield, formatPercent)
  for (const p of Object.values(d.perAverages)) add(p, formatTimes)
  add(d.payoutRatio.prev, formatPercent); add(d.payoutRatio.curr, formatPercent)
  for (const v of [d.dividendRevision.before, d.dividendRevision.after, d.dividendRevision.termEndBefore, d.dividendRevision.termEndAfter]) add(v, formatYen)
  add(d.dividendForecast.value, formatYen)
  for (const f of d.forecasts) { add(f.value, n => formatByUnit(n, f.unit)); add(f.yoy, formatSignedPercent) }
  check(`期待する数字の文字列を ${expected.size} 本集めた（30 本以上）`, expected.size >= 30)

  // 描画結果（role="img" の中＝図と時系列は見た目用で、aria-label が同じ内容を運ぶので除く）
  const CRITIQUE_MEMOS: [string, LabMemo][] = [['空', MEMO_EMPTY], ['ROE/ROA', MEMO_ROE_ROA], ['全欄', MEMO_FULL], ['営業/純', MEMO_OP_NET], ['PER平均', MEMO_PER_AVG], ['自由', MEMO_FREE]]
  const pagesHtml: [string, string][] = [
    ['初期描画', render(h(Lab9983Client))],
    ['画面2（解説を開いた状態）', render(h(MetricRows, { defaultOpen: true }))],
    ['画面3', render(h(CausalMap))],
    ...LEARN_THEMES.map(t => [`学ぶ:${t.key}`, render(h(LearnPanel, { theme: t }))] as [string, string]),
    // 添削（画面5）。§1 の利用者の原文は除く（本人の文に出典は付けない）
    ...CRITIQUE_MEMOS.map(([name, m]) => [`添削:${name}`, stripMatching(render(h(CritiqueView, { critique: composeCritique(m) })), /\bdata-critique="flow"/)] as [string, string]),
  ]
  const NUMCH = /[0-9,.]/
  const SIGN = /[+−±]/
  const uncited = (text: string): string[] => {
    const bad: string[] = []
    for (const v of expected) {
      let from = 0
      for (;;) {
        const i = text.indexOf(v, from)
        if (i < 0) break
        from = i + v.length
        const before = text[i - 1]
        // 数字の途中（1,768.08円 の中の 768.08円）・符号付きの一部（+16.6% の中の 16.6%）は別の数字
        if (before && (NUMCH.test(before) || (SIGN.test(before) && !SIGN.test(v[0])))) continue
        if (!/^\s*\[\d+\]/.test(text.slice(from))) bad.push(`${v} @ …${text.slice(Math.max(0, i - 12), from + 4)}…`)
      }
    }
    return bad
  }
  for (const [name, html] of pagesHtml) {
    const bad = uncited(textOf(stripRoleImg(html)))
    check(`${name}: 出典つきの数字の直後に必ず [N] がある`, bad.length === 0, bad.slice(0, 5).join(' | '))
    const loose = [...html.matchAll(/<span[^>]*data-sourced=""[^>]*>[^<]*<\/span>(?!<sup[^>]*data-cite=)/g)]
    const count = (html.match(/data-sourced=""/g) ?? []).length
    check(`${name}: data-sourced の span（${count} 個）の直後は必ず <sup data-cite>`, loose.length === 0 && count > 0, loose.slice(0, 3).map(m => m[0]).join(' | '))
  }
  // 解説文のかけらをつなぐと fill と同じ文（用語の囲み・番号で文を1字も変えない）
  const vars = labVarEntries(d)
  const index = citationIndex(d)
  const cite = (s: SourceRef | null) => (s ? index.get(sourceKey(s)) ?? null : null)
  const tokens = termTokens()
  const plainVars = labVars(d)
  const mismatches: string[] = []
  for (const it of METRIC_ITEMS) {
    const all = [...it.explain.facts, ...it.explain.readings]
    const paras = richParagraphs(all, vars, cite, tokens)
    all.forEach((t, i) => { if (piecesText(paras[i]) !== fill(t, plainVars)) mismatches.push(`${it.key}[${i}]`) })
  }
  check('richParagraphs のかけらをつなぐと fill と同じ文', mismatches.length === 0, mismatches.join(','))
  // 添削: §3 の bodyPieces・§5 の pieces をつなぐと body・lines と同じ文（文字の形は変えない。検査 (i) が文字で固定）
  const critiqueMismatch: string[] = []
  for (const [name, m] of CRITIQUE_MEMOS) {
    const c = composeCritique(m)
    c.check.hits.forEach(hit => { if (piecesText(hit.bodyPieces) !== hit.body) critiqueMismatch.push(`${name}:§3:${hit.id}`) })
    c.connect.lines.forEach((l, i) => { if (piecesText(c.connect.pieces[i] ?? []) !== l) critiqueMismatch.push(`${name}:§5[${i}]`) })
    if (c.connect.pieces.length !== c.connect.lines.length) critiqueMismatch.push(`${name}:§5:length`)
  }
  check('添削: §3 の bodyPieces と §5 の pieces をつなぐと body・lines と同じ文', critiqueMismatch.length === 0, critiqueMismatch.join(','))
  const roeHit = composeCritique(MEMO_ROE_ROA).check.hits.find(x => x.id === 'roe-roa-mix')
  check('添削 §3（roe-roa-mix）: 21.2%・11.6% のかけらに出典の番号がある／§5 の 4 本に出典つきの値が 10 個以上', !!roeHit && roeHit.bodyPieces.some(p => p.kind === 'value' && p.text === '21.2%' && p.cite != null) && roeHit.bodyPieces.some(p => p.kind === 'value' && p.text === '11.6%' && p.cite != null)
    && composeCritique(MEMO_FULL).connect.pieces.flat().filter(p => p.kind === 'value' && p.cite != null).length >= 10)
  check('labVars は labVarEntries の text と同じ（添削 compose が読む文字は変わらない）', Object.entries(plainVars).every(([k, v]) => vars[k]?.text === v) && Object.keys(plainVars).length === Object.keys(vars).length)
  check('出典のある変数（sales・roe・per・nextNetYoy・divBefore・opYoy）に source があり、期の名前（fy・fyNext）と構成比（計算値）には無い',
    !!vars.sales.source && !!vars.roe.source && !!vars.per.source && !!vars.nextNetYoy.source && !!vars.divBefore.source && !!vars.opYoy.source && vars.fy.source === null && vars.fyNext.source === null && vars.segOverseasShare.source === null)
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('■ (m) 出典の節: <details> の中に無い・--muted より薄くない・aria-hidden が無い・番号順・初出順で固定')
{
  const src = stripComments(read('components/lab/CitationList.tsx'))
  check('CitationList.tsx: <details> を使わない・aria-hidden を付けない・text-muted／text-caption を使わない・text-small text-ink-2', !src.includes('<details') && !src.includes('aria-hidden') && !src.includes('text-muted') && !src.includes('text-caption') && src.includes('text-small text-ink-2'))
  const html = render(h(Lab9983Client))
  const at = html.indexOf('data-section="lab-citations"')
  check('初期描画に「出典」の節（h2）があり、<details> の中に無い', at > 0 && html.includes(`<h2 id="lab-citations-heading" class="text-h2 text-ink">${CITATIONS_TITLE}</h2>`) && (html.slice(0, at).match(/<details/g) ?? []).length === (html.slice(0, at).match(/<\/details>/g) ?? []).length)
  check('「出典」はページ下部（最後の h2）', html.lastIndexOf('<h2') === html.lastIndexOf('<h2 id="lab-citations-heading"'))
  const list = citationList()
  const index = citationIndex()
  check(`一覧は ${list.length} 本・番号は 1..N の連番で昇順・index と同じ数`, list.length === index.size && list.every((c, i) => c.n === i + 1))
  check('描画の li#cite-N が 1..N の順', j([...html.matchAll(/<li id="cite-(\d+)"/g)].map(m => Number(m[1]))) === j(list.map(c => c.n)))
  check('同じ data で2回呼んでも同じ番号（乱数・時刻を入れない）', j(citationList()) === j(citationList()) && j([...citationIndex()]) === j([...citationIndex()]) && !/Math\.random|new Date|Date\.now/.test(stripComments(read('lib/lab/citations.ts'))))
  check('SourceRef の同一性は label・url・asOf・note（note が違えば別の番号）', sourceKey({ label: 'a', url: 'u', asOf: 'd' }) !== sourceKey({ label: 'a', url: 'u', asOf: 'd', note: 'n' }) && sourceKey({ label: 'a', url: 'u', asOf: 'd' }) === sourceKey({ label: 'a', url: 'u', asOf: 'd' }))
  check('一覧は data の全 SourceRef を網羅する（多くも少なくもない）', (() => {
    const keys = new Set<string>()
    const visit = (v: unknown) => {
      if (Array.isArray(v)) { v.forEach(visit); return }
      if (typeof v === 'object' && v !== null) {
        if ('value' in v && 'source' in v) { keys.add(sourceKey((v as Sourced<unknown>).source)); return }
        Object.values(v).forEach(visit)
      }
    }
    visit(LAB_9983)
    return [...keys].every(k => index.has(k)) && keys.size === index.size
  })())
  // 初出順: 初期描画（解説は閉じた状態）で [N] が初めて出る順が 1, 2, 3 … と増える
  const seq = [...textOf(html).matchAll(/\[(\d+)\]/g)].map(m => Number(m[1]))
  const firstSeen: number[] = []
  for (const n of seq) if (!firstSeen.includes(n)) firstSeen.push(n)
  check(`初出順: 初期描画で [N] が初めて出る順が 1, 2, 3 … の昇順（${firstSeen.length} 本）`, firstSeen.every((n, i) => n === i + 1), firstSeen.join(','))
  check('描画の [N] はすべて一覧の番号の範囲内・[N] の a は #cite-N で aria-label「出典 N」', seq.every(n => n >= 1 && n <= list.length) && [...html.matchAll(/<sup[^>]*data-cite="(\d+)"[^>]*><a href="#cite-(\d+)" aria-label="出典 (\d+)"/g)].every(m => m[1] === m[2] && m[2] === m[3]))
  check('一覧の各行に 資料名・発行元・取得日・URL（リンク）がある', list.every(c => c.label && c.publisher && c.asOf && /^https:\/\//.test(c.url)) && html.includes('href="https://www.fastretailing.com/') && html.includes('href="https://www.jpx.co.jp/') && html.includes('href="https://www.nikkei.com/'))
  check('注記（旧・括弧書き）が一覧に移っている: 会社公表の前期比・概数・PER の計算・加重／単純', list.some(c => c.note === '会社公表の前期比') && list.some(c => c.note?.includes('概数')) && list.some(c => c.note?.includes('会社予想利益で計算')) && list.some(c => c.note === '小売業・加重平均') && list.some(c => c.note === '小売業・単純平均'))
  check('発行元: publisherOf が3つのホストを呼び名にする', publisherOf('https://www.fastretailing.com/x').includes('ファーストリテイリング') && publisherOf('https://www.jpx.co.jp/x').includes('JPX') && publisherOf('https://www.nikkei.com/x').includes('日経'))
  check('画面の文字に「注記」の括弧書き（（2027年8月期の会社予想利益で計算）・（会社公表の前期比）・（2026年8月期は会社の億円表示からの概数））が無い（一覧以外）', (() => { const t = textOf(html.slice(0, at)); return !t.includes('（2027年8月期の会社予想利益で計算）') && !t.includes('（会社公表の前期比）') && !t.includes('（2026年8月期は会社の億円表示からの概数）') && !t.includes('2026-10-09 閲覧') })())
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('■ (n) 免責の文が消えていない（出所ではなく法務の注記）')
{
  const page = textOf(render(h(Lab9983Client)))
  const critique = textOf(render(h(CritiqueView, { critique: composeCritique(MEMO_FULL) })))
  check('初期描画: Disclaimer の定型文・「当社の分析や評価は含まれていません」・「将来を予測するものではありません」が残る（画面2 の注記・画面3 の figcaption・画面3 の直下）',
    page.includes(DISCLAIMER_TEXT) && (page.match(/当社の分析や評価は含まれていません/g) ?? []).length >= 2 && (page.match(/将来を予測するものではありません/g) ?? []).length >= 2 && page.includes(SOURCE_NOTE) && page.includes(CHAIN_NOTE))
  check('添削: 「このサイトは良し悪しを判定しません」・「送信も保存もしていません」・Disclaimer が残る', critique.includes(BADGE) && critique.includes('送信も保存もしていません') && critique.includes(DISCLAIMER_TEXT))
  check('CitationList.tsx に免責の文を移していない（出典の節は出典だけ）', !stripComments(read('components/lab/CitationList.tsx')).includes('Disclaimer') && !textOf(render(h(CitationList))).includes('将来を予測'))
  check('client.tsx: Disclaimer part="general" が画面3（CausalMap）の直下に残る', /<CausalMap data=\{data\} \/>\s*<Disclaimer part="general" \/>/.test(read('app/study/client.tsx')))
  check('MetricRows.tsx: figcaption は無条件・SOURCE_NOTE を描く／CausalMap.tsx: figcaption は CHAIN_NOTE', stripComments(read('components/lab/MetricRows.tsx')).includes('<p>{SOURCE_NOTE}</p>') && stripComments(read('components/lab/CausalMap.tsx')).includes('{CHAIN_NOTE}</figcaption>'))
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('■ (o) 「2通りの読み方」の囲み（Readings）')
{
  const html = render(h(Readings, { items: ['a', 'b'] }))
  check('Readings: bg-surface・border・border-l-2 border-l-brand・rounded-card・見出し text-small font-semibold text-ink・項目 text-body text-ink・番号付き',
    html.includes('bg-surface') && html.includes('border border-border border-l-2 border-l-brand') && html.includes('rounded-card') && html.includes(`<p class="text-small font-semibold text-ink">${READINGS_LABEL}</p>`) && (html.match(/<li class="text-body text-ink">/g) ?? []).length === 2 && html.includes('list-decimal'))
  check('Readings: 項目は text-ink（--ink-2 に下げない）・上下に間（my-3）', html.includes('my-3') && !html.includes('text-ink-2'))
  const rows = render(h(MetricRows, { defaultOpen: true }))
  const chain = render(h(CausalMap))
  check('画面2 の各項目の解説と画面3 の図の下が Readings（data-readings）になっている', (rows.match(/data-readings=""/g) ?? []).length === METRIC_ITEMS.length && (chain.match(/data-readings=""/g) ?? []).length === 1)
  check('「2通りの読み方」の見出しは Readings の中にだけ（MetricRows・CausalMap に直書きしない）', (rows.match(/2通りの読み方/g) ?? []).length === METRIC_ITEMS.length && !stripComments(read('components/lab/MetricRows.tsx')).includes('2通りの読み方') && !stripComments(read('components/lab/CausalMap.tsx')).includes('2通りの読み方'))
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('■ (p) 用語の囲み（Term）は用語だけ。評価・状態の札を作らない。囲みは <button> で、押すと説明の箱が段落の直下に出る')
{
  const EVAL = ['好調', '注意', '危険', '悪化', '改善', '健全', '優良', '割安', '割高', '堅調', '低迷', '増収', '増益', '減益', '買い', '売り']
  const critiqueHtml = (m: LabMemo) => render(h(CritiqueView, { critique: composeCritique(m) }))
  const pages = [render(h(Lab9983Client)), render(h(MetricRows, { defaultOpen: true })), render(h(CausalMap)), ...LEARN_THEMES.map(t => render(h(LearnPanel, { theme: t }))), ...[MEMO_EMPTY, MEMO_ROE_ROA, MEMO_FULL, MEMO_PER_AVG].map(critiqueHtml)]
  const boxed = pages.flatMap(p => [...p.matchAll(/<button[^>]*data-term="([^"]*)"[^>]*>([^<]*)<\/button>/g)].map(m => [m[1], m[2]] as const))
  const tokens = termTokens()
  check(`囲まれた語 ${boxed.length} 個はすべて用語集（GLOSSARY_EXTRA）の語（名前・「（」より前・別名）`, boxed.length > 0 && boxed.every(([name, text]) => GLOSSARY_EXTRA.some(t => t.name === name) && tokens.some(t => t.token === text && t.term.name === name)),
    boxed.filter(([name, text]) => !tokens.some(t => t.token === text && t.term.name === name)).slice(0, 5).map(x => x.join(':')).join(' | '))
  check('囲まれた語に評価・状態の語が無い', boxed.every(([, text]) => !EVAL.some(w => text.includes(w))), [...new Set(boxed.map(b => b[1]))].join('・'))
  // 囲みは <button type="button">（<abbr> ではない。スマホで触っても開く）。title は残す。開閉の規則は純関数
  const roe = GLOSSARY_EXTRA.find(t => t.name.startsWith('ROE'))!
  const roa = GLOSSARY_EXTRA.find(t => t.name.startsWith('ROA'))!
  const termHtml = render(h(Term, { term: GLOSSARY_EXTRA[0] }))
  check('Term.tsx: --card の面＋--border 1px＋rounded-field・text-small font-semibold text-ink・<button type="button"> ＋ aria-expanded ＋ aria-controls ＋ title・<abbr>／tabIndex を使わない・ピル（rounded-full）にしない',
    TERM_CLASS.includes('rounded-field') && / border /.test(TERM_CLASS) && TERM_CLASS.includes('border-border') && TERM_CLASS.includes('bg-card') && TERM_CLASS.includes('text-small font-semibold') && TERM_CLASS.includes('text-ink') && !TERM_CLASS.includes('rounded-full')
      && termHtml.startsWith('<button type="button"') && termHtml.includes('aria-expanded="false"') && termHtml.includes('aria-controls="') && termHtml.includes('title="') && !termHtml.includes('<abbr') && !termHtml.includes('tabindex'), termHtml.slice(0, 160))
  check('Term の title に用語の説明（算式を含む）が残っている（マウスの人の近道）', render(h(Term, { term: roe })).includes(`title="${roe.name}：`) && render(h(Term, { term: roe })).includes('算式: ROE ＝'))
  check('開いている囲みは枠が --brand（TERM_OPEN_CLASS）。閉じているときは --border', TERM_OPEN_CLASS.includes('border-brand') && !TERM_OPEN_CLASS.includes('border-border') && !TERM_CLASS.includes('border-brand'))
  check('説明の箱の class は bg-surface rounded-card border border-border px-3 py-2 mt-2 text-small text-ink-2', TERM_BOX_CLASS === 'bg-surface rounded-card border border-border px-3 py-2 mt-2 text-small text-ink-2')
  // 開閉の純関数: 押すと開く／もう一度押すと閉じる／同じ段落で別の用語を押すと前のが閉じる（開けるのは1つ）／Esc で閉じる
  check('nextOpenName: 閉じている→押すと開く・開いている用語をもう一度押すと閉じる・別の用語を押すと切り替わる（同じ段落で1つだけ）', nextOpenName(null, roe.name) === roe.name && nextOpenName(roe.name, roe.name) === null && nextOpenName(roe.name, roa.name) === roa.name)
  check('isCloseKey: Escape（と古い Esc）だけが閉じる。Enter・Space・Tab では閉じない', isCloseKey('Escape') && isCloseKey('Esc') && !isCloseKey('Enter') && !isCloseKey(' ') && !isCloseKey('Tab'))
  check('termBoxId: 段落の id ＋ 用語名（空白は _）', termBoxId('g', roe.name) === `g-term-${roe.name}` && !/\s/.test(termBoxId('g', 'a b')))
  // 静的描画: 段落（TermGroup）に ROE と ROA の2つの囲み。閉じているときは箱が無い／ROE を開くと箱が段落（</p>）の直下に出て aria-controls と id が一致／ROA は閉じたまま
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const btnTag = (html: string, name: string) => (html.match(new RegExp(`<button[^>]*data-term="${esc(name)}"[^>]*>`)) ?? [''])[0]
  const boxTag = (html: string) => (html.match(/<div[^>]*data-term-box="[^"]*"[^>]*>/) ?? [''])[0]
  const attr = (tag: string, a: string) => (tag.match(new RegExp(`\\b${a}="([^"]*)"`)) ?? [])[1] ?? null
  const para = (open: typeof roe | null) => render(h(TermGroup, { id: 'g', defaultOpen: open, children: h('p', null, h(Pieces, { pieces: splitTerms('ROE と ROA', tokens, new Set()) })) }))
  const closed = para(null)
  const openRoe = para(roe)
  const openRoa = para(roa)
  check('静的描画（閉）: 2つの囲みが <button type="button" aria-expanded="false">・説明の箱（data-term-box）は無い・aria-controls は開いたときの箱の id を指す', (closed.match(/<button type="button"/g) ?? []).length === 2 && attr(btnTag(closed, roe.name), 'aria-expanded') === 'false' && attr(btnTag(closed, roa.name), 'aria-expanded') === 'false' && !closed.includes('data-term-box') && attr(btnTag(closed, roe.name), 'aria-controls') === termBoxId('g', roe.name), closed)
  const roeBtn = btnTag(openRoe, roe.name)
  check('静的描画（ROE を押す）: ROE の囲みが aria-expanded="true"・枠が border-brand・aria-controls が箱の id と一致・箱は段落（</p>）の直下（浮かせない）', attr(roeBtn, 'aria-expanded') === 'true' && roeBtn.includes('border-brand') && !roeBtn.includes('border-border') && attr(roeBtn, 'aria-controls') === attr(boxTag(openRoe), 'id') && attr(boxTag(openRoe), 'id') === termBoxId('g', roe.name) && /<\/p><div id="[^"]*" class="bg-surface rounded-card border border-border px-3 py-2 mt-2 text-small text-ink-2" data-term-box="/.test(openRoe), openRoe)
  check('静的描画（ROE を押す）: 箱の先頭に用語名（font-semibold text-ink）、その下に body（算式を含む）。ROA は閉じたまま・箱は1つ', openRoe.includes(`<span class="block font-semibold text-ink">${roe.name}</span>`) && textOf(openRoe).includes(roe.body) && roe.body.includes('算式:') && attr(btnTag(openRoe, roa.name), 'aria-expanded') === 'false' && (openRoe.match(/data-term-box=/g) ?? []).length === 1)
  check('静的描画（ROE が開いた段落で ROA を押す＝nextOpenName）: ROA が開き ROE は閉じる・箱は1つだけ', nextOpenName(roe.name, roa.name) === roa.name && attr(btnTag(openRoa, roa.name), 'aria-expanded') === 'true' && attr(btnTag(openRoa, roe.name), 'aria-expanded') === 'false' && (openRoa.match(/data-term-box=/g) ?? []).length === 1 && attr(boxTag(openRoa), 'data-term-box') === roa.name)
  check('説明の箱（全用語）に禁止語が無い', GLOSSARY_EXTRA.every(t => labForbiddenWordsIn(textOf(render(h(TermBox, { id: 'x', term: t })))).length === 0), GLOSSARY_EXTRA.flatMap(t => labForbiddenWordsIn(textOf(render(h(TermBox, { id: 'x', term: t }))))).join('・'))
  check('Term.tsx: Esc の keydown で閉じる（isCloseKey を onKeyDown で使う）・開閉にアニメーション（transition／animate-）を付けない', (() => { const s = stripComments(read('components/lab/Term.tsx')); return s.includes('onKeyDown') && s.includes('isCloseKey(e.key)') && !/transition|animate-/.test(s) })())
  check('MetricRows・CausalMap・CritiqueView: 段落ごとに TermGroup で包む（MetricRows 3・CausalMap 3・CritiqueView 2＝§4 と §5。§3 の固定文は包まない）', (() => { const n = (f: string) => (stripComments(read(f)).match(/<TermGroup\b/g) ?? []).length; return n('components/lab/MetricRows.tsx') === 3 && n('components/lab/CausalMap.tsx') === 3 && n('components/lab/CritiqueView.tsx') === 2 })())
  check('初期描画（ページ全体）: 開いている囲みも説明の箱も無い（aria-expanded="true" の data-term が無い・data-term-box が無い）', !/<button[^>]*aria-expanded="true"[^>]*data-term="/.test(pages[0]) && !pages[0].includes('data-term-box'))
  const rowsHtml = render(h(MetricRows))
  const labelBoxes = (k: string) => { const i = rowsHtml.indexOf(`data-metric="${k}"`); return (rowsHtml.slice(i, rowsHtml.indexOf('</p>', i)).match(/<button[^>]*data-term="/g) ?? []).length }
  check('項目名（画面2）の用語が囲まれている（ROE と ROA → 2・営業利益と純利益 → 2・PER → 1・セグメント別売上 → 1・配当 → 1）', labelBoxes('roeRoa') === 2 && labelBoxes('profit') === 2 && labelBoxes('per') === 1 && labelBoxes('segments') === 1 && labelBoxes('dividend') === 1, METRIC_ITEMS.map(it => `${it.key}:${labelBoxes(it.key)}`).join(' '))
  check('同じ解説の中で同じ用語を2回囲まない（初出だけ）', splitTerms('ROE と ROE', tokens, new Set()).filter(p => p.kind === 'term').length === 1)
  check('英字の用語は前後が英数字なら拾わない（approach・heroes・roads）', splitTerms('approach と heroes と roads', tokens, new Set()).every(p => p.kind === 'text'))
  check('「予想PER」は PER の囲みとして丸ごと（「予想」＋「PER」に割れない）', (() => { const ps = splitTerms('予想PER は', tokens, new Set()); return ps[0]?.kind === 'term' && ps[0].text === '予想PER' && ps[0].term.name.startsWith('PER') })())
  check('用語の説明（glossary-extra）に算式がある: ROE・ROA・EPS・自己資本比率・PER・配当性向・配当利回り', ['ROE（自己資本利益率）', 'ROA（総資産利益率）', 'EPS（1株当たり利益）', '自己資本比率', 'PER（株価収益率）', '配当性向', '配当利回り'].every(n => GLOSSARY_EXTRA.find(t => t.name === n)?.body.includes('算式:')))
  const rowsSrc = stripComments(read('components/lab/MetricRows.tsx'))
  check('MetricRows.tsx: 算式の行（definition）を描かない・値を2度書く行が無い（見出しの数字に出ている系列は名前と値を繰り返さない）', !rowsSrc.includes('definition') && !rowsSrc.includes('＝') && rowsSrc.includes('const showHeading = !!main || si > 0'))
  check('画面2（ROE）: 見出しの数字 21.2% の後に「ROE: 21.2%」の行が無い（図の中の値ラベルは除いて 1 回だけ）', !textOf(rowsHtml).includes('ROE: 21.2%') && (textOf(stripRoleImg(rowsHtml)).match(/21\.2%/g) ?? []).length === 1)
  // 画面3: 箱のラベル（売上収益・営業利益・純利益・EPS・株価）は囲む。矢印の上のラベルは囲まない。下の文の用語は箱で囲んだ語をもう囲まない
  const chainHtml = render(h(CausalMap))
  const chainLabels = [...chainHtml.matchAll(/<p class="text-small font-semibold text-ink" data-chain-label="">([\s\S]*?)<\/p>/g)].map(m => (m[1].match(/<button[^>]*data-term="/g) ?? []).length)
  check('画面3: 5つの箱のラベルがそれぞれ用語の囲み（EPS（基本的1株当たり利益）は EPS だけ・株価（終値）は丸ごと）', j(chainLabels) === j([1, 1, 1, 1, 1]) && /<button[^>]*data-term="株価（終値）"[^>]*>株価（終値）<\/button>/.test(chainHtml) && /<button[^>]*data-term="EPS（1株当たり利益）"[^>]*>EPS<\/button>（基本的1株当たり利益）/.test(chainHtml), j(chainLabels))
  check('画面3: 矢印の上のラベル（data-flow-arrow）に囲みが無い', [...chainHtml.matchAll(/<div[^>]*data-flow-arrow=""[^>]*>[\s\S]*?<\/div>/g)].every(m => !m[0].includes('data-term="')))
  const chainBelow = chainHtml.slice(chainHtml.indexOf('</figure>'))
  check('画面3: 図の下の文に用語の囲みがあり、箱で囲んだ語（売上収益・営業利益・純利益・EPS・株価）は下でもう囲まない（初出だけ）', (chainBelow.match(/<button[^>]*data-term="/g) ?? []).length >= 1 && !/<button[^>]*data-term="(?:売上収益|営業利益|純利益（親会社の所有者に帰属する当期利益）|EPS（1株当たり利益）|株価（終値）)"/.test(chainBelow), [...chainBelow.matchAll(/data-term="([^"]*)"/g)].map(m => m[1]).join('・'))
  // 画面5: §4 の項目名と §5 の用語は囲む。§1 の原文と §3 の固定文は囲まない
  const full = critiqueHtml(MEMO_FULL)
  const empty = critiqueHtml(MEMO_EMPTY)
  const roeRoa = critiqueHtml(MEMO_ROE_ROA)
  check('画面5 §4: 8 項目の項目名に用語の囲み（PER・EPS・営業利益・純利益・ROE・ROA・自己資本比率・営業CF・手元資金・配当・セグメント別売上 = 11）', (critiqueSection(empty, 'missing').match(/<button[^>]*data-term="/g) ?? []).length === 11, String((critiqueSection(empty, 'missing').match(/<button[^>]*data-term="/g) ?? []).length))
  check('画面5 §5: 併置文に用語の囲みがあり（売上収益・営業利益・純利益・EPS・PER・ROE・ROA・自己資本比率 …）、同じ語は §5 の中で 1 回だけ', (() => { const names = [...critiqueSection(full, 'connect').matchAll(/data-term="([^"]*)"/g)].map(m => m[1]); return names.length >= 6 && new Set(names).size === names.length })(), [...critiqueSection(full, 'connect').matchAll(/data-term="([^"]*)"/g)].map(m => m[1]).join('・'))
  check('画面5 §1: 利用者の原文（PER・EPS・ROE…を含む）に囲みが無い／§3 の固定文（ROE と ROA を含む）に囲みが無い／§2・§6・§7 にも無い', !critiqueSection(full, 'flow').includes('data-term="') && !critiqueSection(roeRoa, 'check').includes('data-term="') && !critiqueSection(full, 'written').includes('data-term="') && !critiqueSection(full, 'learn').includes('data-term="') && !critiqueSection(full, 'notes').includes('data-term="'))
  check('画面5 §1: 原文は逐語（囲みも番号も付けず whitespace-pre-wrap のまま）', critiqueSection(full, 'flow').includes('whitespace-pre-wrap') && !critiqueSection(full, 'flow').includes('data-cite'))
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('■ (q) 画面1 の時系列（Timeline）')
{
  const props = { prev: { date: '2026-10-08', detail: '配当予想を 640円→850円 に修正' }, today: '2026-10-12', next: { date: '未定（例年1月上旬）' } }
  const html = render(h(Timeline, props))
  const aria = timelineAria(props)
  check('Timeline: role="img"・aria-label に 前回・今日・次回の内容と日付', html.includes('role="img"') && html.includes(`aria-label="${aria}"`) && aria.includes('2026-10-08') && aria.includes('2026-10-12') && aria.includes('未定（例年1月上旬）') && aria.includes(PREV_LABEL) && aria.includes(TODAY_LABEL) && aria.includes(NEXT_LABEL) && aria.includes(TIMELINE_TITLE))
  check('Timeline: 「あと◯日」「残り日数」の文字が無い（カウントダウンを出さない・R12）', !/あと\s*\d+\s*日|残り\s*\d+\s*日|残り日数|カウントダウン/.test(textOf(html) + aria))
  check('Timeline: 点の色は 前回＝bg-ink・今日＝bg-brand・次回＝中空（border-2 border-ink bg-card）・軸は bg-axis', html.includes('bg-ink"') && html.includes('bg-brand"') && html.includes('border-2 border-ink bg-card') && html.includes('bg-axis'))
  check('Timeline: 点の上に内容・下に日付（3列の grid・1行目に内容・4行目に日付）', html.includes('grid-cols-3') && html.includes('row-start-1') && html.includes('row-start-4') && textOf(html).includes('2026-10-08') && textOf(html).includes('2026-10-12') && textOf(html).includes('配当予想を 640円→850円 に修正'))
  const empty = render(h(Timeline, { ...props, today: null }))
  check('Timeline: today が null（描画の初回）なら今日の日付が空（水和のずれを避ける）', !textOf(empty).includes('2026-10-12') && empty.includes('role="img"') && timelineAria({ ...props, today: null }).includes(TODAY_LABEL))
  check('formatIsoDate: 2026-01-05 → "2026-01-05"（ゼロ埋め・端末の時間帯）', formatIsoDate(new Date(2026, 0, 5)) === '2026-01-05')
  const page = render(h(Lab9983Client))
  check('初期描画: 画面1 に Timeline（data-timeline）があり、前回の決算の内容は配当予想の修正（640円→850円）・次回は未定', page.includes('data-timeline=""') && textOf(page).includes('配当予想を 640円→850円 に修正') && (page.match(/未定（例年1月上旬）/g) ?? []).length >= 2)
  check('初期描画: Timeline の中に [N] のリンクを置かない（role="img" の中は読み上げの対象外。数字と番号は直下の文が運ぶ）', !/<div role="img" aria-label="決算の時系列[^"]*"[^>]*>(?:(?!<\/div>).)*data-cite/.test(page))
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('■ (r) new Date を読むのは Timeline.tsx と client.tsx の useEffect の中だけ')
{
  const files = [...walk('lib/lab'), ...walk('components/lab'), ...walk('app/study')]
  const offenders: string[] = []
  for (const f of files) {
    const src = stripComments(read(f))
    const hits = [...src.matchAll(/new Date\b|Date\.now\(/g)]
    if (hits.length === 0) continue
    if (f === 'components/lab/Timeline.tsx') continue
    if (f !== 'app/study/client.tsx') { offenders.push(f); continue }
    for (const m of hits) {
      const at = m.index ?? 0
      const start = src.lastIndexOf('useEffect(', at)
      if (start < 0) { offenders.push(`${f}@${at}`); continue }
      let depth = 0
      let inside = false
      for (let i = start; i < src.length; i++) {
        if (src[i] === '{') depth++
        else if (src[i] === '}') { depth--; if (depth === 0) { inside = i > at; break } }
      }
      if (!inside) offenders.push(`${f}@${at}`)
    }
  }
  check('new Date／Date.now は Timeline.tsx と client.tsx の useEffect の中以外に無い（lib/lab・components/lab・app/study）', offenders.length === 0, offenders.join(', '))
  const client = read('app/study/client.tsx')
  check('client.tsx: useState<string | null>(null) → useEffect の中で setToday(formatIsoDate(new Date())) → Timeline に today を渡す', /useState<string \| null>\(null\)/.test(client) && /useEffect\(\(\) => \{\s*(?:\/\/[^\n]*\n\s*)*setToday\(formatIsoDate\(new Date\(\)\)\)\s*\}, \[\]\)/.test(client) && client.includes('today={today}'))
  check('Timeline.tsx: new Date を読まない（呼び手から today を受け取る）', !/new Date\b|Date\.now/.test(stripComments(read('components/lab/Timeline.tsx'))))
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('■ (e) 【公開】sitemap に /study がある・noindex が無い・notFound の口は残る・入口は許した所だけ・到達条件に session 等が無い')
{
  // 2026-10-19 S-L1a で「隠す」から「公開」へ反転した枝。隠していたときの期待値（sitemap に無い・index: false が2つ・リンク0本）は捨てた
  const urls = sitemapRoutes().map(e => e.url)
  check(`app/sitemap.ts を実際に呼ぶと /study がある（SHOW_LAB_9983 = ${SHOW_LAB_9983} に連動。定数を false に戻すと消える）`,
    SHOW_LAB_9983 === urls.some(u => u.endsWith('/study')), urls.join(', '))
  const sitemapSrc = stripComments(read('app/sitemap.ts'))
  check('app/sitemap.ts: /study は SHOW_LAB_9983 と連動している（期待値をベタ書きせず定数から導く＝/watch と同じ作法）',
    sitemapSrc.includes("'/study'") && sitemapSrc.includes('SHOW_LAB_9983') && sitemapSrc.includes("from '@/lib/features'"))
  check('app/sitemap.ts に古い住所 /lab が残っていない・app/lab ごと消えている', !sitemapSrc.includes('/lab') && !exists('app/lab'))

  const page = stripComments(read('app/study/page.tsx'))
  check('page.tsx: noindex・index: false・follow: false が1つも無い（公開したので検索に載せる。metadata.robots を書かない＝Next の既定 index, follow）',
    !/noindex/.test(page) && !/index:\s*false/.test(page) && !/follow:\s*false/.test(page))
  // 題と説明文は data（lib/lab/9983.ts）から組む。手書きすると画面の本文（検査 (t) が data 由来を強制）と二重管理になる
  {
    const co = LAB_9983.company
    const title = String(studyMetadata.title ?? '')
    const desc = String(studyMetadata.description ?? '')
    const og = studyMetadata.openGraph as { title?: unknown; description?: unknown; url?: unknown; type?: unknown; locale?: unknown; siteName?: unknown; images?: unknown } | undefined
    check('page.tsx: metadata の題に社名を主役にしない（「決算の読み方を練習する」が先・社名は例題の括弧の中）・説明文に「売買を勧めるものではありません」',
      title.startsWith('決算の読み方を練習する（例題: ') && desc.includes('売買を勧めるものではありません'), `${title} / ${desc.slice(0, 30)}`)
    // 証券コードは import パス（@/lib/lab/9983）と定数名 LAB_9983 にも出る文字なので、社名の直書きの有無と
    // ${c.name} / ${c.code} で埋めているかの両方で見る（出来上がった文字列は runtime の metadata で確かめる）
    check('page.tsx: 題と説明文の社名・証券コードは data から組む（社名の直書きが無く、${c.name}・${c.code} で埋める）',
      title.includes(co.name) && title.includes(co.code) && desc.includes(co.name) && desc.includes(co.code)
      && !page.includes(co.name) && page.includes('${c.name}') && page.includes('${c.code}') && page.includes('LAB_9983.company'),
      `社名の直書き: ${page.includes(co.name) ? 'あり' : '無し'}／テンプレート: ${page.includes('${c.name}')}/${page.includes('${c.code}')}`)
    // openGraph は入れ子なので後の段が前の段を丸ごと上書きする（generate-metadata.md「Ordering」）。
    // 書かないと app/layout.tsx のホームの og:title / og:url('/') が継承される＝SNS にホームの顔で出る
    check('page.tsx: openGraph を自前で持つ（url は /study・題と説明文は metadata と同じ・親から継承される type・locale・siteName も書き直している）',
      og?.url === '/study' && og?.title === title && og?.description === desc
      && og?.type === 'website' && og?.locale === 'ja_JP' && og?.siteName === 'InvestSim', j(og))
    // openGraph を書くと app/opengraph-image.png のファイル規約由来の og:image も一緒に落ちるので images を明示する
    // （実測で確認。親の値が継承されると思い込むと SNS に画像なしで出る）
    const ogImages = (og?.images ?? []) as { url?: unknown; width?: unknown; height?: unknown }[]
    check('page.tsx: og:image を明示している（openGraph を書くとファイル規約の画像が落ちるため）。1枚・/opengraph-image.png・1200x630',
      ogImages.length === 1 && ogImages[0]?.url === '/opengraph-image.png' && ogImages[0]?.width === 1200 && ogImages[0]?.height === 630, j(ogImages))
    const tw = studyMetadata.twitter as { card?: unknown; title?: unknown; description?: unknown; images?: unknown } | undefined
    check('page.tsx: twitter も自前で持つ（親の twitter はホームの題のままなので、og と食い違わせない）',
      tw?.card === 'summary_large_image' && tw?.title === title && tw?.description === desc
      && Array.isArray(tw?.images) && (tw?.images as unknown[])[0] === '/opengraph-image.png', j(tw))
  }
  check('page.tsx: if (!SHOW_LAB_9983) notFound() の口は残る（公開か全面非表示かの二択。@/lib/features と next/navigation を import）',
    /if \(!SHOW_LAB_9983\) notFound\(\)/.test(page) && page.includes("from 'next/navigation'") && page.includes("from '@/lib/features'"))
  // ── 反転しても残す線（公開しても崩してはいけない） ──
  check('page.tsx・client.tsx: 到達・表示の条件に session / user / cookies / headers / auth / signedIn が無い（ログイン必須にしない）', !/\b(session|cookies|headers|auth|signedIn|user)\b/.test(page) && !/\b(session|cookies|headers|auth|signedIn)\b/.test(stripComments(read('app/study/client.tsx'))))
  check('client.tsx: fetch／localStorage／sessionStorage／document.cookie を使わない（ブラウザの中の state だけ・保存も送信も無い）', !/fetch\(|localStorage|sessionStorage|document\.cookie/.test(stripComments(read('app/study/client.tsx'))))

  /** /study へのリンクを置いてよいファイル（入口）。2026-10-19 S-L1b で**ナビの1段目**になった。
   *  app/sitemap.ts は「リンク」ではなく公開の一覧なので、上で別に見ている（ここでは数えない）。
   *  **両向きに見る**: 許していない所からリンクしていないこと（stray）と、許した入口が**実際に**リンクしていること
   *  （missing）。後者が無いと「入口を消したのに検査が気づかない」＝公開したのに誰も到達できない状態を通してしまう */
  const ALLOWED_LINKERS: readonly string[] = ['components/SiteNav.tsx']
  const linkers: string[] = []
  for (const f of [...walk('app'), ...walk('components')]) {
    if (f.startsWith('app/study/') || f === 'app/sitemap.ts') continue
    const src = stripComments(read(f))
    if (/["'`]\/study(?:\/|["'`])/.test(src)) linkers.push(f)
  }
  const stray = linkers.filter(f => !ALLOWED_LINKERS.includes(f))
  const missing = ALLOWED_LINKERS.filter(f => !linkers.includes(f))
  check(`/study へのリンクは許した入口だけ（${ALLOWED_LINKERS.join('・')}）`, stray.length === 0, `許していない所から: ${stray.join(', ')}`)
  check(`/study への入口が実際にある（${ALLOWED_LINKERS.join('・')} の ${linkers.length} 本）`,
    missing.length === 0 && linkers.length === ALLOWED_LINKERS.length, `リンクが無い: ${missing.join(', ')}／実際: ${linkers.join(', ')}`)
  check('/study はナビの NAV の1段目（4段「学ぶ → くらべる → 書く → 振り返り」の先頭。呼び名は「学ぶ」）', (() => {
    const nav = stripComments(read('components/SiteNav.tsx'))
    const body = nav.slice(nav.indexOf('export const NAV = ['), nav.indexOf('] as const'))
    const entries = [...body.matchAll(/\{ href: '([^']+)',\s+label: '([^']+)'/g)].map(m => [m[1], m[2]])
    return entries.length === 4 && entries[0][0] === '/study' && entries[0][1] === '学ぶ'
  })())
  const oldLinkers = [...walk('app'), ...walk('components')].filter(f => /["'`]\/lab(?:\/|["'`])/.test(stripComments(read(f))))
  check('app/・components/ のどこにも古い住所 /lab へのリンク・参照が無い（308 は足さない決定なので、残っていると 404 に送る）', oldLinkers.length === 0, oldLinkers.join(', '))
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('■ (t) 【公開】1社固定の断り・数字の時点・銘柄を引き継がない（2026-10-19 S-L1a のオーナー決定）')
{
  const src = stripComments(read('app/study/client.tsx'))
  const html = render(h(Lab9983Client))
  const text = textOf(html)

  // 1社固定の断り: h1 の直下・無条件・リードと同じ大きさ（畳まない・薄くしない）
  check('client.tsx: 1社固定の断り（FIXED_COMPANY_NOTE）の社名と証券コードは data から引く（手で書かない）',
    src.includes('${LAB_9983.company.name}') && src.includes('${LAB_9983.company.code}')
    && FIXED_COMPANY_NOTE.includes(LAB_9983.company.name) && FIXED_COMPANY_NOTE.includes(LAB_9983.company.code))
  check('描画結果に1社固定の断りがある（「この会社を勧めるものではありません」「他の銘柄を選ぶ機能はまだありません」を含む）',
    text.includes(FIXED_COMPANY_NOTE) && FIXED_COMPANY_NOTE.includes('この会社を勧めるものではありません') && FIXED_COMPANY_NOTE.includes('他の銘柄を選ぶ機能はまだありません'))
  // 判定は目印の属性 data-fixed-company / data-as-of で引く（文字位置で数えない＝並びを変えても文が嘘にならない）。
  // 属性はこの2本の検査のためだけに付いている。消すならこの検査も一緒に消すこと
  const attrTag = (hay: string, attr: string) => {
    const i = hay.indexOf(attr)
    if (i < 0) return null
    const open = hay.lastIndexOf('<', i)
    const close = hay.indexOf('>', i)
    if (open < 0 || close < 0) return null
    const name = (hay.slice(open + 1).match(/^[a-zA-Z0-9]+/) ?? [''])[0]
    const end = hay.indexOf(`</${name}>`, close)
    return { tag: hay.slice(open, close + 1), inner: end < 0 ? '' : hay.slice(close + 1, end), at: open }
  }
  check('client.tsx: 目印の属性 data-fixed-company・data-as-of がそれぞれ1つだけ付いている（検査がこれで引く）',
    (src.match(/data-fixed-company/g) ?? []).length === 1 && (src.match(/data-as-of/g) ?? []).length === 1)

  const noteEl = attrTag(html, 'data-fixed-company')
  const leadAt = html.indexOf(PAGE_LEAD)
  const leadTag = leadAt < 0 ? '' : html.slice(html.lastIndexOf('<', leadAt), leadAt)
  const sizeOf = (t: string) => (t.match(/text-h\d|text-body|text-small|text-caption/) ?? [''])[0]
  check('断りは h1 の直下（描画結果で </h1> の次の要素が data-fixed-company を持つ）', (() => {
    const h1Close = html.indexOf('</h1>')
    if (h1Close < 0 || !noteEl) return false
    const next = html.slice(h1Close + '</h1>'.length).match(/^\s*<[^>]+>/)
    return next != null && next[0].includes('data-fixed-company')
  })(), noteEl?.tag ?? '目印が無い')
  check('断りは無条件（ソースの </h1> から data-fixed-company までに分岐 &&・? ( も <details> も無い）', (() => {
    const at = src.indexOf('data-fixed-company')
    const h1Close = src.indexOf('</h1>')
    if (at < 0 || h1Close < 0 || at < h1Close) return false
    return !/&&|\?\s*\(|<details|<summary/.test(src.slice(h1Close, at))
  })())
  check('断りはリードと同じ大きさ・薄くしない（data-fixed-company の class が PAGE_LEAD の段落と同じ字幅トークン・text-ink で --muted ではない）',
    noteEl != null && leadTag.length > 0 && sizeOf(noteEl.tag) !== '' && sizeOf(noteEl.tag) === sizeOf(leadTag)
    && /text-ink\b/.test(noteEl.tag) && !/text-muted|text-ink-2/.test(noteEl.tag),
    `断り=${sizeOf(noteEl?.tag ?? '')} リード=${sizeOf(leadTag)}`)
  check('断りの本文が目印の要素の中にある（別の要素に付け替わっていない）', noteEl != null && noteEl.inner.includes(FIXED_COMPANY_NOTE))

  // 数字の時点（期と発表日）を見出しの近くに。手で日付を書かず data から引く。
  // 期は latestFyLabel（「…期（通期）」）を使う。fyLabel だけだと通期の実績を四半期と取り違えて読まれうる
  const asOfEl = attrTag(html, 'data-as-of')
  const co = LAB_9983.company
  const asOfText = textOf(asOfEl?.inner ?? '').replace(/\s/g, '')
  check('数字の時点の行が data 由来（期は latestFyLabel・発表日は latestAnnouncement。client.tsx に日付の直書きが無く fyLabel(c.latestFy) で代用していない）',
    asOfEl != null && asOfText.includes(co.latestFyLabel) && asOfText.includes(co.latestAnnouncement.value)
    && asOfText.includes('の実績です（') && asOfText.includes('発表）。')
    && src.includes('{c.latestFyLabel}') && src.includes('{c.latestAnnouncement.value}')
    && !/\d{4}-\d{2}-\d{2}/.test(src),
    `${asOfText.slice(0, 70)}／src の日付の直書き: ${(src.match(/\d{4}-\d{2}-\d{2}/g) ?? []).join(',') || '無し'}`)
  check('数字の時点の行は「通期」を落とさない（latestFyLabel には括弧の中の期間が入っている）', co.latestFyLabel.includes('通期') && asOfText.includes('通期'))
  check('数字の時点の行は h1 の近く（最初の節 data-section より前＝ヘッダーの中）',
    asOfEl != null && asOfEl.at < html.indexOf('data-section='), `as-of@${asOfEl?.at} 最初の節@${html.indexOf('data-section=')}`)
  check('AI を使っていないことの表示（NO_AI_NOTE）が本文に残る（公開後も消さない正直な表示）', text.includes(NO_AI_NOTE) && /AI/.test(NO_AI_NOTE))

  // 「書く」への導線に銘柄を引き継がない・銘柄詳細へ繋がない
  const all = [...walk('app/study')].map(f => stripComments(read(f))).join('\n')
  check('/trade への導線に ?symbol= が付かない（素の /trade だけ。「学ぶ」から「書く」へ銘柄を引き継がない）',
    !/\/trade\?/.test(all) && !/symbol=/.test(all) && !/\/trade\?/.test(html))
  check('/stocks/ へのリンクが無い（銘柄詳細に繋がない）', !/["'`]\/stocks/.test(all) && !/href="\/stocks/.test(html))
  // 2026-10-20 レビュー W3: 「書く」への導線の文言。`?symbol=` を付けない決定（1社を勧めた形に見せない）が
  // 文言の側から戻ってこないよう、**この会社を持ち出す誘導にしない**ことを機械で固定する
  {
    const nextEl = attrTag(html, 'data-next-step')
    const nextText = textOf(nextEl?.inner ?? '').replace(/\s+/g, ' ').trim()
    check('「書く」への導線の節が無条件に描かれる（分岐も <details> も無い）', (() => {
      const at = src.indexOf('data-next-step')
      if (at < 0 || nextEl == null) return false
      const formAt = src.indexOf('<MemoForm')
      return formAt >= 0 && at > formAt && !/&&|\?\s*\(|<details|<summary/.test(src.slice(formAt, at))
    })(), nextText.slice(0, 60))
    check('導線の文は「自分で選んだ銘柄で」を含む（この1社を持っていく読みにしない）', nextText.includes('自分で選んだ銘柄で'))
    check('導線の文は「書いたものは消える（保存も送信もしていない）」を先に言う', nextText.includes('このページを閉じると消えます') && nextText.includes('保存も送信もしていません'))
    check('導線に「この銘柄」「この会社を」で始まる誘導が無い', !/この銘柄|この会社を(?:買|持|記録|試)/.test(nextText), nextText)
    check('導線のリンクの呼び名は NAV から引いた「書く」（『』で囲む）', nextText.includes('「書く」へ進む') && src.includes("labelOf('/trade')"))
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('■ (f) import 禁止・凍結ファイルが HEAD と無変更')
{
  const BANNED = /from\s+['"](?:@\/|\.{1,2}\/(?:\.\.\/)*)(?:lib\/)?(?:report\/claude|ai-trader\/|investors\/)/
  const offenders: string[] = []
  for (const f of [...walk('lib/lab'), ...walk('app/study'), ...walk('components/lab')]) {
    const src = stripComments(read(f))
    for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1]
      const isForbiddenTs = /investors\/rulebooks\/forbidden$/.test(spec)
      if (isForbiddenTs && f.startsWith('lib/lab/')) continue
      if (BANNED.test(`from '${spec}'`) || /report\/claude|ai-trader\/|investors\//.test(spec)) offenders.push(`${f}: ${spec}`)
    }
  }
  check('lib/lab/**・app/study/**・components/lab/** は lib/report/claude.ts・lib/ai-trader/**・lib/investors/**（forbidden.ts を除く・lib/lab だけ）を import しない', offenders.length === 0, offenders.join(' | '))
  check('forbidden.ts を直接 import するのは lib/lab/forbidden-extra.ts だけ（app/・components/ からは読まない）', stripComments(read('lib/lab/forbidden-extra.ts')).includes("from '@/lib/investors/rulebooks/forbidden'") && [...walk('app/study'), ...walk('components/lab')].every(f => !read(f).includes('rulebooks/forbidden')))
  check('lib/lab/** に fetch／process.env／Anthropic／server-only が無い（S-A は純関数と定数だけ。例外は lib/lab/critique/anthropic.ts＝フェーズA の SDK 呼び出し1か所）', walk('lib/lab').filter(f => f !== 'lib/lab/critique/anthropic.ts').every(f => !/fetch\(|process\.env|anthropic|server-only/i.test(stripComments(read(f)))))
  {
    const src = stripComments(read('lib/lab/critique/anthropic.ts'))
    check('lib/lab/critique/anthropic.ts: SDK を直接 import・ANTHROPIC_API_KEY が無ければ throw・CLI へのフォールバック（child_process／spawn）と fetch／server-only が無い', src.includes("from '@anthropic-ai/sdk'") && /ANTHROPIC_API_KEY/.test(src) && /throw new Error/.test(src) && !/child_process|spawn|fetch\(|server-only|console\.log/.test(src))
  }
  // 2026-10-19 S-L1a: app/sitemap.ts を凍結一覧から外した（/study を載せるため）。next.config.ts は凍結のまま
  // ＝ /lab/9983 → /study の 308（恒久転送）を**足さない**というオーナー決定を、ここで機械的に守る。
  //
  // 2026-10-19 S-L1b → 2026-10-20 レビュー W1 で**絞った**。
  // 既定は今までどおり「1バイトでも違えば FAIL」（git diff --quiet）。注釈だけの差を許すのは
  // **COMMENT_ONLY_OK に明示した1ファイルだけ**。
  // なぜ例外が要るか: 段の呼び名を「03 読み返す」→「振り返り」に変えたとき、凍結対象の
  // app/api/entry/examples/route.ts の注釈がホームの旧ラベルを指していた。直せないと嘘が残り続ける。
  // なぜ全体には広げないか（W1）:
  //  (a) **注釈には、ふるまいを変えるものがある**（eslint-disable・@ts-expect-error・taste-skill-ignore・
  //      webpack のマジックコメント・prettier-ignore）。実際 app/watch/client.tsx には eslint-disable がある。
  //      許可したファイルでも、注釈の差分にこれらの語が出たら FAIL にする。
  //  (b) 空白のならしは**行頭・行末と空行だけ**にする。`\s+` を全文に当てると文字列リテラルの中の
  //      空白（画面に出る文）の違いまで消えてしまう。
  const FROZEN = ['lib/trade/reason.ts', 'lib/ai-trader/glossary.ts', 'lib/investors/rulebooks/forbidden.ts', 'lib/statements', 'components/stocks', 'components/review', 'components/ReasonFields.tsx', 'next.config.ts', 'app/watch', 'app/api']
  /** 注釈だけの差を許すファイル（明示。増やすときは理由を DECISIONS に残す） */
  const COMMENT_ONLY_OK: readonly string[] = ['app/api/entry/examples/route.ts']
  /** 注釈の形でふるまいを変える指示。許可したファイルでも、これが注釈の差に出たら FAIL */
  const DIRECTIVE = /eslint-|@ts-|taste-skill-ignore|webpack|prettier-/
  /** 行頭・行末の空白と空行だけをならす（文字列リテラルの中は触らない） */
  const normalize = (s: string) => s.split('\n').map(l => l.replace(/^[ \t]+|[ \t]+$/g, '')).filter(l => l !== '').join('\n')
  /** 注釈だけを取り出す（ふるまいを変える指示が増減していないかを見るため） */
  const commentsOf = (s: string) => s.split('\n').filter(l => /^\s*(?:\/\/|\/\*|\*)/.test(l) || l.includes('//') || l.includes('/*')).join('\n')
  for (const p of FROZEN) {
    const ls = spawnSync('git', ['ls-files', '--', `:(literal)${p}`], { cwd: ROOT, encoding: 'utf8' })
    const tracked = ls.status === 0 && (ls.stdout ?? '').trim() !== ''
    const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=all', '--', `:(literal)${p}`], { cwd: ROOT, encoding: 'utf8' })
    const dirty = (status.stdout ?? '').trim()
    // porcelain は「XY␣パス」の形。dirty は .trim() 済みで先頭の空白が落ちているので、**生の出力**から読む
    const codeChanged: string[] = []
    for (const line of (status.stdout ?? '').split('\n')) {
      const m = /^(..) (.+)$/.exec(line)
      if (!m) continue
      const [, xy, f] = m
      if (!COMMENT_ONLY_OK.includes(f)) { codeChanged.push(`${f}（${xy.trim() || '空'}・凍結）`); continue }
      // 変更（M）だけが注釈の差を許される。staged と unstaged が混ざる MM も含める（レビュー S7）。
      // 追加（A/??）・削除（D）・改名（R）は中身を比べる相手がいないので常に FAIL
      if (!/^.?M$|^M.?$/.test(xy.replace(/ /g, ''))) { codeChanged.push(`${f}（${xy.trim() || '空'}）`); continue }
      const headSrc = spawnSync('git', ['show', `HEAD:${f}`], { cwd: ROOT, encoding: 'utf8' })
      if (headSrc.status !== 0) { codeChanged.push(`${f}（HEAD に無い）`); continue }
      const now = read(f)
      const codeOf = (s: string) => normalize(stripComments(s))
      if (codeOf(headSrc.stdout) !== codeOf(now)) { codeChanged.push(`${f}（注釈以外が変わった）`); continue }
      // 注釈そのものに、ふるまいを変える指示が増減していないか
      const before = commentsOf(headSrc.stdout)
      const after = commentsOf(now)
      const count = (s: string) => (s.match(new RegExp(DIRECTIVE, 'g')) ?? []).length
      if (count(before) !== count(after)) codeChanged.push(`${f}（注釈の指示（eslint-／@ts-／taste-skill-ignore／webpack／prettier-）が ${count(before)} → ${count(after)} に変わった）`)
    }
    check(`${p}: git に追跡されていて HEAD と無変更（注釈だけの差を許すのは ${COMMENT_ONLY_OK.join('・')} だけ）・未追跡ファイルも無い`,
      tracked && codeChanged.length === 0, !tracked ? '追跡なし' : codeChanged.join(' | ') || dirty.replace(/\n/g, ' | '))
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('■ (g) 3フラグ（SHOW_LAB_9983 は公開なので true）・SHOW_AI_WATCH のすぐ下')
{
  const features = stripComments(read('lib/features.ts'))
  check('SHOW_LAB_9983・LAB_CRITIQUE_AI・LAB_SIGN_COLOR が boolean で export されている', typeof SHOW_LAB_9983 === 'boolean' && typeof LAB_CRITIQUE_AI === 'boolean' && typeof LAB_SIGN_COLOR === 'boolean'
    && /export const SHOW_LAB_9983: boolean = (?:true|false)/.test(features) && /export const LAB_CRITIQUE_AI: boolean = (?:true|false)/.test(features) && /export const LAB_SIGN_COLOR: boolean = (?:true|false)/.test(features))
  const order = ['SHOW_AI_WATCH', 'SHOW_LAB_9983', 'LAB_CRITIQUE_AI', 'LAB_SIGN_COLOR'].map(n => features.indexOf(`export const ${n}`))
  check('並び: SHOW_AI_WATCH → SHOW_LAB_9983 → LAB_CRITIQUE_AI → LAB_SIGN_COLOR', order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), order.join(','))
  check('SHOW_LAB_9983 = true（2026-10-19 S-L1a で /study を公開した。false に戻すと画面が 404・sitemap からも消える＝全面非表示に戻す口）', SHOW_LAB_9983 === true)
  {
    // SHOW_LAB_9983 の直前の注釈（/** … */）に、継承する不変条件が言葉で書かれているか。
    // 形だけ書くと「隠す」指示と衝突して止まるので、守りたい目的（二択・ログイン必須にしない）まで残す
    const raw = read('lib/features.ts')
    const declAt = raw.indexOf('export const SHOW_LAB_9983')
    const docStart = raw.lastIndexOf('/**', declAt)
    const doc = docStart < 0 || declAt < 0 ? '' : raw.slice(docStart, declAt)
    const needed = ['二択', '全面非表示', 'session', 'cookies', 'headers', 'auth']
    const missing = needed.filter(w => !doc.includes(w))
    check('lib/features.ts: SHOW_LAB_9983 の注釈に継承する不変条件が書いてある（公開か全面非表示かの二択／右辺や組み合わせる条件に session・cookies・headers・auth を入れない）',
      doc.length > 0 && missing.length === 0, missing.length > 0 ? `足りない語: ${missing.join('・')}` : '注釈が見つからない')
    check('lib/features.ts: SHOW_LAB_9983 の注釈が公開前提に書き換わっている（noindex を外した・sitemap に載せた・入口はナビ）',
      ['noindex', 'sitemap', 'ナビ', '/study'].every(w => doc.includes(w)))
  }
  check('LAB_CRITIQUE_AI = false（/privacy・/terms の公開前に true にしない。画面を公開してもこの線は動かない）', LAB_CRITIQUE_AI === false)
  check('既定: LAB_SIGN_COLOR = true（2026-10-09 オーナーの2度目の要望。false にすれば無彩色に戻せる口は残す）', LAB_SIGN_COLOR === true)
  check('生きた AI 経路 app/api/lab/9983 はまだ無い（app/api/lab/backtest は別物・既存）。フェーズA（2026-10-18）の lib/lab/critique/anthropic.ts・guard.ts は手元で測る道具で、app/**・components/** から import されない', !exists('app/api/lab/9983') && exists('lib/lab/critique/anthropic.ts') && exists('lib/lab/critique/guard.ts') && [...walk('app'), ...walk('components')].every(f => !/critique\/(?:anthropic|guard)/.test(read(f))))
  {
    // ページ表の「パス」の欄（2列目）だけを見る。本文に「旧 /lab/9983」と書くのは履歴なので許す
    const paths = read('.claude/skills/investsim-conventions/SKILL.md')
      .split('\n').filter(l => l.trim().startsWith('|'))
      .map(l => (l.split('|')[2] ?? '').trim())
    check('.claude/skills/investsim-conventions/SKILL.md のページ表に `/study` の行がある・パスの欄に古い `/lab/9983` の行が残っていない',
      paths.includes('`/study`') && !paths.includes('`/lab/9983`'), paths.filter(Boolean).join(' '))
  }
  check('scripts/check-features.ts が3フラグを見る', /SHOW_LAB_9983/.test(read('scripts/check-features.ts')) && /LAB_CRITIQUE_AI/.test(read('scripts/check-features.ts')) && /LAB_SIGN_COLOR/.test(read('scripts/check-features.ts')))
  check('fyLabel: FY2026 → 2026年8月期／短い形 26年8月期', fyLabel('FY2026') === '2026年8月期' && fyLabel('FY2026', true) === '26年8月期')
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('■ (s) フェーズA（2026-10-18）: 門 guard.ts・返答の解析・テストデータ・与える数字・記録に鍵が無い')
{
  const original = '### 判断メモ（自由記述・原文のまま）\n【判断の流れ】\n- ROAは11.92%、ROEは21%。差が約10%あるので負債が大きいと判断した。\n- 割高だと思う。\n【結論】（未記入）'
  const ok: CritiqueFinding = { kind: 'calc', title: 'ROE と ROA の差', quote: '差が約10%あるので負債が大きいと判断した', why: 'ROE と ROA は分母が違います。', how: '分母を確かめます。', catalogueId: 'roe-roa-mix' }
  const g1 = guardFindings([ok], original)
  check('guard: kind=calc・引用が原文にそのまま・禁止語なし → 残る（落とした件 0・全理由 0）', g1.kept.length === 1 && g1.dropped.length === 0 && Object.values(g1.counts).every(n => n === 0))
  const g2 = guardFindings([{ ...ok, quote: '差が約10%あるので負債が大きいと判断しました' }], original)
  check('guard: 言い換えた引用は落ちる（quote-not-in-original・nearMiss ではない）', g2.kept.length === 0 && g2.dropped[0]?.flags.reasons.join() === 'quote-not-in-original' && g2.dropped[0]?.flags.quoteNearMiss === false)
  const g3 = guardFindings([{ ...ok, quote: '差が約10%あるので 負債が大きい' }], original)
  check('guard: 空白だけ違う引用も落ちるが quoteNearMiss に印', g3.kept.length === 0 && g3.dropped[0]?.flags.quoteNearMiss === true && g3.dropped[0]?.detail.includes('空白'))
  check('guard: 引用が空は落ちる', guardFindings([{ ...ok, quote: '  ' }], original).counts['quote-not-in-original'] === 1)
  for (const [field, text] of [['how', '買うべきではありません'], ['why', 'この銘柄は割高です'], ['title', '勉強不足'], ['how', '計算が間違っています'], ['why', '株価は上がる'], ['how', '狙い目です'], ['why', '要注意です']] as const) {
    const g = guardFindings([{ ...ok, [field]: text }], original)
    check(`guard: ${field} に「${text}」→ 落ちる（禁止語 ${g.dropped[0]?.flags.forbidden.join('・') ?? '—'}）`, g.kept.length === 0 && g.counts['forbidden-word'] === 1)
  }
  check('guard: quote の中の禁止語は見ない（利用者の文「割高だと思う」を引用しても残る）', guardFindings([{ ...ok, quote: '割高だと思う' }], original).kept.length === 1)
  check('guard: kind が calc／missing 以外は落ちる（bad-kind）', guardFindings([{ ...ok, kind: 'advice' as CritiqueFinding['kind'] }], original).counts['bad-kind'] === 1 && guardFindings([{ ...ok, kind: 'missing' }], original).kept.length === 1)
  check('guard: 「将来を予測するものではありません」は例外（「予測」で落とさない）', guardFindings([{ ...ok, how: '将来を予測するものではありません。' }], original).kept.length === 1)
  check('guard: 1件が2つの理由に当たれば両方に数え、落とすのは1件', (() => { const g = guardFindings([{ ...ok, quote: 'x', how: 'おすすめ' }], original); return g.counts['quote-not-in-original'] === 1 && g.counts['forbidden-word'] === 1 && g.dropped.length === 1 && g.flags.length === 1 })())
  check('guard: 禁止語の一覧は forbidden-extra の全部を含み、prompt.ts の 「…」 の語も含む（割安・買うべき・勉強不足・狙い目・経験が浅い）。「○点」のような見本は含まない', LAB_FORBIDDEN_ALL.every(w => GUARD_FORBIDDEN.includes(w)) && ['割安', '買うべき', '勉強不足', '狙い目', '経験が浅い', '有望'].every(w => GUARD_FORBIDDEN.includes(w)) && !GUARD_FORBIDDEN.some(w => w.includes('○')))
  // 返答の解析
  const p1 = parseFindings('```json\n[{"kind":"calc","title":"t","quote":"q","why":"w","how":"h","catalogueId":null}]\n```')
  check('parseFindings: ```json の囲い付きの配列を読む・catalogueId null', p1.ok && p1.findings.length === 1 && p1.findings[0].catalogueId === null)
  const p2 = parseFindings('はい。[{"kind":"calc","title":"t","quote":"q","why":"w","how":"h"},{"kind":"calc","title":1}] 以上')
  check('parseFindings: 前後の文を無視し、形の違う要素は落として malformed に数える（catalogueId 省略は null）', p2.ok && p2.findings.length === 1 && p2.malformed === 1 && p2.findings[0].catalogueId === null)
  check('parseFindings: 配列が無ければ ok:false（no-json-array）', (() => { const p = parseFindings('{"kind":"calc"}'); return !p.ok && p.reason === 'no-json-array' })())
  check('parseFindings: 空の配列 [] は ok・0件', (() => { const p = parseFindings('[]'); return p.ok && p.findings.length === 0 && p.malformed === 0 })())
  check('parseFindings: 壊れた JSON は json-parse-error', (() => { const p = parseFindings('[{"kind":'); return !p.ok && p.reason === 'json-parse-error' })())
  check('extractJson: 文字列の中の括弧を数えない・オブジェクトも取れる', extractJson('x [{"a":"]"}] y') === '[{"a":"]"}]' && extractJson('前 {"A":[{"x":"}"}]} 後', '{') === '{"A":[{"x":"}"}]}')
  check('requireApiKey: 無い・空白なら投げる、あれば返す（値は印字しない）', (() => {
    let threw = 0
    try { requireApiKey({}) } catch { threw++ }
    try { requireApiKey({ ANTHROPIC_API_KEY: '  ' }) } catch { threw++ }
    return threw === 2 && requireApiKey({ ANTHROPIC_API_KEY: 'k' }) === 'k'
  })())
  // テストデータ
  check('memos: 3件（実物2件＋clean）・id と順が固定', EVAL_MEMOS.map(m => m.id).join() === 'collected-undecided,decided-uncollected,clean')
  check('memos: 実物2件は source=owner-real・expect 6件・expectNot 2件ずつ。clean は expect 0件・expectNot 1件', EVAL_MEMOS.filter(m => m.source === 'owner-real').length === 2 && EVAL_MEMOS.filter(m => m.source === 'owner-real').every(m => m.expect.length === 6 && m.expectNot.length === 2) && memoById('clean').expect.length === 0 && memoById('clean').expectNot.length === 1)
  check('memos: 公表値との食い違いの印（factMismatch）は3件（ROA・EPS・売上）', EVAL_MEMOS.flatMap(m => m.expect).filter(e => e.factMismatch).map(e => e.id).join() === 'roa-mismatch,eps-mismatch,sales-mismatch')
  check('memos: 実物の原文は「ESPが下がっている」「ROAは11.92%」「売上高は前期比で10%増えていた」をそのまま含む（修正しない）', memoById('collected-undecided').text.includes('ESPが下がっている') && memoById('collected-undecided').text.includes('ROAは11.92%') && memoById('decided-uncollected').text.includes('売上高は前期比で10%増えていた'))
  for (const m of EVAL_MEMOS) {
    const { input, original } = buildEvalInput(m.text)
    check(`memos/${m.id}: 原文がそのまま入力に入り、門に渡す原文はメモの節だけ、expect の plantedText は全部原文にそのまま含まれる`, original.includes(m.text) && !original.includes('## 会社が公表した数字') && input.includes('## 会社が公表した数字') && m.expect.every(e => m.text.includes(e.plantedText)), m.expect.filter(e => !m.text.includes(e.plantedText)).map(e => e.id).join(','))
  }
  // 与える数字
  const { figures, peers } = evalFigures()
  const figText = figures.map(f => `${f.label}: ${f.value}（${f.period}）`).join('\n') + '\n' + peers.map(p => `${p.label}: ${p.value}`).join('\n')
  check('figures: 売上 +16.6%・EPS 1,768.08円（前の期 1,411.44円）・ROA は 2026年8月期 未開示（25年8月期 11.6%）・配当予想の修正 640円 → 850円・加重 27.7倍／単純 22.5倍・決算発表日 2026-10-08 を含む', ['+16.6%', '1,768.08円', '1,411.44円', '会社が開示していません', '11.6%', '640円 → 850円', '27.7倍', '22.5倍', '2026-10-08'].every(s => figText.includes(s)))
  check('figures: 事業利益を渡さない（画面2の8項目に揃える）・ハイフンの負号が無い', !figText.includes('事業利益') && !/-\d/.test(figText.replace(/\d{4}-\d{2}-\d{2}/g, '')))
  const known = knownNumbers()
  const figNums = classifyNumbers(figText, known, '')
  check('figures: 渡す数字の数値は全部 9983.ts 由来（unknown が 0）', figNums.every(t => t.cls !== 'unknown'), figNums.filter(t => t.cls === 'unknown').map(t => t.token).join(','))
  const cleanNums = classifyNumbers(memoById('clean').text, known, '')
  check('clean: 本文の数値は全部 9983.ts 由来か、そこから出る値（unknown が 0）', cleanNums.every(t => t.cls !== 'unknown'), cleanNums.filter(t => t.cls === 'unknown').map(t => t.token).join(','))
  const f1 = Object.fromEntries(classifyNumbers('ROE 21.2% と ROA 11.6%。自己資本比率は +3.7ポイント。EPS は 1,768.08円。売上は 3兆9,634億円。', known, '').map(t => [t.token, t.cls]))
  check('classifyNumbers: 21.2／11.6／1,768.08／9,634 は direct、3.7 は derived（62.6 − 58.9）、3（兆の位）は direct か small', f1['21.2'] === 'direct' && f1['11.6'] === 'direct' && f1['1,768.08'] === 'direct' && f1['9,634'] === 'direct' && f1['3.7'] === 'derived' && (f1['3'] === 'direct' || f1['3'] === 'small'), JSON.stringify(f1))
  const f2 = Object.fromEntries(classifyNumbers('ROA は 11.92% ではなく 11.6%。差は 9.08ポイント。有利子負債は 1,234億円。2026年8月期。', known, memoById('collected-undecided').text).map(t => [t.token, t.cls]))
  check('classifyNumbers: 利用者の 11.92 は memo、21 − 11.92 = 9.08 は derived、1,234 は unknown、2026 は year', f2['11.92'] === 'memo' && f2['9.08'] === 'derived' && f2['1,234'] === 'unknown' && f2['2026'] === 'year', JSON.stringify(f2))
  // 規則版（catalogue）の検出（AI との比較用）
  const base = (id: string) => detectAll({ text: memoById(id).text, memo: { mode: 'free', decision: null, parts: {}, free: memoById(id).text }, data: LAB_9983 }).map(e => e.id)
  // 17 件のカタログを実物 2 件と clean に当てた結果を固定する（2026-10-22。測定1の後に6項目を足し、測定2の後に op-only-judgement を足した基準値。2026-10-19 は実物1が3件・実物2が0件）
  const want1 = ['conclusion-empty', 'roe-roa-mix', 'roa-unpublished', 'fact-mismatch', 'cf-profit-unchecked', 'segment-impression']
  const want2 = ['fact-mismatch', 'momentum-as-reason', 'fame-as-safety', 'forecast-as-reason', 'op-only-judgement']
  check(`規則版: 実物1（集めたが決められない）は ${want1.join('・')} の ${want1.length} 件だけ（per-average-kind は当たらない）`, base('collected-undecided').slice().sort().join() === want1.slice().sort().join(), base('collected-undecided').join(','))
  check(`規則版: 実物2（決めたが集めていない）は ${want2.join('・')} の ${want2.length} 件だけ（PER 40倍「くらい」は概数なので fact-mismatch の対象外・per-only は「割高」等の語が無いので当たらない）`, base('decided-uncollected').slice().sort().join() === want2.slice().sort().join(), base('decided-uncollected').join(','))
  check('規則版: clean には何も当たらない（不変条件。正しい数字・来期予想・前の期の数字・セグメントの % だけのメモ）', base('clean').length === 0, base('clean').join(','))
  console.log(`  （規則版の当たり — 実物1: ${base('collected-undecided').join('・') || '無し'}／実物2: ${base('decided-uncollected').join('・') || '無し'}／clean: ${base('clean').join('・') || '無し'}）`)
  // 記録・スクリプト
  const leak = walk('evals/critique', /\.(json|md)$/).filter(f => /sk-ant-[A-Za-z0-9_-]{8,}/.test(read(f)))
  check('evals/critique/** の記録（json・md）に鍵らしき文字列（sk-ant-…）が無い', leak.length === 0, leak.join(','))
  check('scripts/eval-critique.ts・eval-judge.ts・evals/critique/**・lib/lab/critique/anthropic.ts は lib/report/claude.ts・lib/ai-trader を import しない', ['scripts/eval-critique.ts', 'scripts/eval-judge.ts', 'lib/lab/critique/anthropic.ts', 'lib/lab/critique/guard.ts', ...walk('evals/critique')].every(f => !/report\/claude|ai-trader\//.test(stripComments(read(f)))))
  check('scripts/eval-judge.ts: C と F を判定 AI に数えさせない（machineParts で数え、system に「機械が数える」とある）', /function machineParts/.test(read('scripts/eval-judge.ts')) && read('scripts/eval-judge.ts').includes('数は機械が数える'))
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('■ (u) 測定1・2の後に足した7項目（2026-10-22）')
{
  const free = (text: string): LabMemo => memo({ mode: 'free', decision: null, free: text })
  const hit = (id: string, text: string, m: LabMemo = free(text)) => detectAll({ text, memo: m, data: LAB_9983 }).some(e => e.id === id)
  const NEW6 = ['fact-mismatch', 'momentum-as-reason', 'fame-as-safety', 'forecast-as-reason', 'cf-profit-unchecked', 'segment-impression', 'op-only-judgement']
  check('7項目がカタログにあり、題と kind が仕様どおり（fact-mismatch だけ calc、他の6つは check＝札が「計算方法」にならない。review S1）',
    catalogueById('fact-mismatch').title === '書かれた数字が、会社の公表値と違う' && catalogueById('fact-mismatch').kind === 'calc'
    && catalogueById('momentum-as-reason').title === '値動きそのものを理由にしている' && catalogueById('momentum-as-reason').kind === 'check'
    && catalogueById('fame-as-safety').title === '知名度を、財務の安全性の代わりにしている' && catalogueById('fame-as-safety').kind === 'check'
    && catalogueById('forecast-as-reason').title === '結論の理由が、将来の株価の予想になっている' && catalogueById('forecast-as-reason').kind === 'check'
    && catalogueById('cf-profit-unchecked').title === 'キャッシュフローを、利益と並べて見ていない' && catalogueById('cf-profit-unchecked').kind === 'check'
    && catalogueById('segment-impression').title === '内訳を、数字でなく印象で書いている' && catalogueById('segment-impression').kind === 'check'
    && catalogueById('op-only-judgement').title === '営業利益だけで業績を見て、純利益・EPS に触れていない' && catalogueById('op-only-judgement').kind === 'check')
  // 文面の線（legal-compliance 2026-10-07 C-2）: 本人の文と公表値だけ。判定・推奨・評価の語を使わない
  const lines6 = NEW6.map(id => catalogueById(id)).flatMap(e => [e.title, fill(e.body, labVars(LAB_9983))])
  check('7項目の題・本文に「間違っていた」「買うべき」「割高」「割安」「危険」「健全」が無く、禁止語（forbidden.ts＋LAB_FORBIDDEN）も無い',
    lines6.every(t => !/間違っていた|買うべき|割高|割安|危険|健全/.test(t) && labForbiddenWordsIn(t).length === 0), lines6.flatMap(t => labForbiddenWordsIn(t)).join(','))
  check('forecast-as-reason の本文は「当否に触れない」「このサイトも将来の株価は出しません」を含む（構造の指摘）', catalogueById('forecast-as-reason').body.includes('当たるかどうかには、この添削は触れません') && catalogueById('forecast-as-reason').body.includes('このサイトも将来の株価は出しません'))
  check('fact-mismatch の本文は「どちらが正しい」を書かない（「確かめます」で終わる・「誤り」「正しい」が無い）', !/誤り|正しい|間違/.test(catalogueById('fact-mismatch').body))
  // 明細の行のテンプレート: 数字の直書きが無い・禁止語が無い・全部埋まる
  const factT = [...Object.values(FACT_TEMPLATES), FACT_ALIAS_NOTE]
  check('fact-mismatch の明細のテンプレートに2桁以上の数字の直書きが無い', factT.every(t => !/\d{2,}/.test(t.replace(/\{[A-Za-z][A-Za-z0-9]*\}/g, ''))))
  const factVars = { ...labVars(LAB_9983), memoQuote: '', roePrev: '20.2%', eqPrev: '58.9%' }
  check('fact-mismatch の明細のテンプレートは labVars＋{memoQuote}{roePrev}{eqPrev} で全部埋まり、禁止語が無い', factT.every(t => { try { return labForbiddenWordsIn(fill(t, factVars)).length === 0 } catch { return false } }))

  // ── fact-mismatch ──
  const fm = (t: string) => factMismatches(t, LAB_9983)
  check('fact-mismatch 正例: 実物1の「ROAは11.92%」（開示 11.6%・当期は未開示）→ level', fm('ROAは11.92%、ROEは21%。').some(f => f.key === 'roa' && f.how === 'level' && f.quote === 'ROAは11.92%'))
  check('fact-mismatch 正例: 実物1の「ESPが下がっている」→ EPS の direction（綴り ESP）', fm('ESPが下がっている。').some(f => f.key === 'eps' && f.how === 'direction' && f.alias))
  check('fact-mismatch 正例: 実物2の「売上高は前期比で10%増えていた」→ yoy', fm('売上高は前期比で10%増えていた。').some(f => f.key === 'sales' && f.how === 'yoy'))
  check('fact-mismatch 正例: 「自己資本比率は45%」「PERは25倍」「営業利益は前期比20%増」「純利益が減った」', ['自己資本比率は45%。', 'PERは25倍。', '営業利益は前期比20%増。', '純利益が減った。'].every(t => fm(t).length === 1), ['自己資本比率は45%。', 'PERは25倍。', '営業利益は前期比20%増。', '純利益が減った。'].map(t => fm(t).length).join(','))
  const fmNeg = [
    'ROEは21%。',                                  // ±0.3 以内（21.2%）
    'ROAは11.6%。',                                // 前の期の開示値
    '自己資本比率は 58.9% から 62.6% で +3.7ポイント。', // 前の期の値から書いた
    'EPSが増えた。',                                // 向きが同じ
    'EPSが下がっているか、決算短信で確かめる。',     // 仮定・問い
    'PERは40倍くらい。',                            // 概数
    '来期の会社予想は売上収益 +12.3%、純利益 +3.2%。', // 会社予想の文
    '海外ユニクロの売上は前期比 26.2%増。',          // セグメントの売上
    '小売業の平均PERは27.7倍。',                    // 平均の PER
    '売上高営業利益率は18.8%。',                    // 利益率（売上でも営業利益でもない）
    '営業利益は5,425億円で前期比プラス。',           // 金額の水準は見ない（op-net-mix の担当）
  ]
  check('fact-mismatch 負例: 正しい数字・前の期の値・仮定・概数・会社予想・セグメント・平均・利益率・金額の水準 → 出ない', fmNeg.every(t => fm(t).length === 0), fmNeg.filter(t => fm(t).length > 0).join(' | '))
  const c1 = composeCritique(free(memoById('collected-undecided').text)).check.hits.find(x => x.id === 'fact-mismatch')
  check('fact-mismatch の明細: 実物1は2行（ESP・ROA）で、メモの引用と公表値（+25.3%・11.6%）を並べ、ESP の読み替えを断る・かけらをつなぐと文字と同じ・公表値に出典の番号',
    !!c1 && c1.details.length === 2
    && c1.details[0].text.includes('メモ「ESPが下がっている」') && c1.details[0].text.includes('+25.3%') && c1.details[0].text.includes(FACT_ALIAS_NOTE)
    && c1.details[1].text.includes('メモ「ROAは11.92%」') && c1.details[1].text.includes('11.6%') && c1.details[1].text.includes('開示していません')
    && c1.details.every(d => piecesText(d.pieces) === d.text)
    && c1.details.every(d => d.pieces.some(p => p.kind === 'value' && p.cite != null)),
    c1?.details.map(d => d.text).join(' | ') ?? 'no hit')
  const c2 = composeCritique(free(memoById('decided-uncollected').text)).check.hits.find(x => x.id === 'fact-mismatch')
  check('fact-mismatch の引用は「指標名から数字（または向きの語）まで」で、句の残り（利用者の評価の語）を写さない（review S3）',
    fm('売上高は前期比で10%増えていた。業績は問題ない。')[0]?.quote === '売上高は前期比で10%増' && fm('ROAは11.92%で高いと思う。')[0]?.quote === 'ROAは11.92%' && fm('ESPが下がっているので不安。')[0]?.quote === 'ESPが下がっている'
    && !!c2 && c2.details.length === 1 && c2.details[0].text.startsWith('メモ「売上高は前期比で10%増」／'),
    c2?.details.map(d => d.text).join(' | ') ?? 'no hit')
  const c1html = textOf(render(h(CritiqueView, { critique: composeCritique(free(memoById('collected-undecided').text)) })))
  check('fact-mismatch の明細は §3 に描かれる（「メモ「ROAは11.92%」」が描画結果にある）', c1html.replace(/\s+/g, '').includes('メモ「ROAは11.92%」／会社の公表値:'))

  // ── momentum-as-reason ──
  check('momentum-as-reason 正例: 実物2「最近ずっと株価が上がっているので、勢いがあると思った」', hit('momentum-as-reason', '最近ずっと株価が上がっているので、勢いがあると思った。'))
  check('momentum-as-reason 負例: 「利益が伸びているので」（主語が会社の数字）／「株価は上がっているが、利益も伸びているので」（句が違う）／「株価が下がったので PER が下がった」（計算のつながり）／「株価がまだ上がり続けそうだから」（見通し＝forecast の担当）',
    !hit('momentum-as-reason', '利益が伸びているので、業績は問題ない。') && !hit('momentum-as-reason', '株価は上がっているが、利益も伸びているので買う。') && !hit('momentum-as-reason', '株価が下がったので、PERも下がった。') && !hit('momentum-as-reason', '株価がまだ上がり続けそうだから。'))

  // ── fame-as-safety ──
  check('fame-as-safety 正例: 実物2「有名な会社なので潰れることはないと思う」／「大手だから安心」', hit('fame-as-safety', '有名な会社なので潰れることはないと思う。') && hit('fame-as-safety', '大手だから安心。'))
  check('fame-as-safety 負例: 「有名な会社なので、ニュースが多い」（安全の語が無い）／「海外の伸びが大きいので安心」（規模でなく伸び）', !hit('fame-as-safety', '有名な会社なので、ニュースが多い。') && !hit('fame-as-safety', '海外の伸びが大きいので安心。'))

  // ── forecast-as-reason ──
  check('forecast-as-reason 正例: 実物2の結論「買う。株価がまだ上がり続けそうだから」（自由記述）／欄で書いた結論「上がりそうだから」', hit('forecast-as-reason', '【結論】買う。株価がまだ上がり続けそうだから。') && hit('forecast-as-reason', '', memo({ decision: 'buy', parts: { conclusion: '上がりそうだから買う。' } })))
  check('forecast-as-reason 負例: 結論でない欄の「株価は上がりそうだから」／結論が「来期の利益が伸びそうだから」（会社の数字の見通し）／clean の結論',
    !hit('forecast-as-reason', '', memo({ decision: 'buy', parts: { metrics: '株価は上がりそうだから気になった。', conclusion: '利益の伸びを確かめたので買う。' } }))
    && !hit('forecast-as-reason', '', memo({ decision: 'buy', parts: { conclusion: '来期の利益が伸びそうだから買う。' } }))
    && !hit('forecast-as-reason', memoById('clean').text))

  // ── cf-profit-unchecked ──
  check('cf-profit-unchecked 正例: 実物1「キャッシュフローが増えていて、手元資金も確保されているので安心材料だと思う」', hit('cf-profit-unchecked', 'キャッシュフローが増えていて、手元資金も確保されているので安心材料だと思う。'))
  check('cf-profit-unchecked 負例: 「営業CF は 7,886億円で、純利益 5,425億円より大きい。手元資金も増えた。」（利益と並べている）／「営業CF と手元資金を見た」（判断の語が無い）',
    !hit('cf-profit-unchecked', '営業CF は 7,886億円で、純利益 5,425億円より大きい。手元資金も増えた。') && !hit('cf-profit-unchecked', '営業CF と手元資金を見た。'))

  // ── segment-impression ──
  check('segment-impression 正例: 実物1「セグメントを見ると海外の人気が高そう」', hit('segment-impression', 'セグメントを見ると海外の人気が高そう。'))
  check('segment-impression 負例: 「海外ユニクロが +26.2%（構成比 約61%）」（数字がある）／「海外ユニクロの伸びが気になった」（印象の語が無い）／「海外の景気が弱い」（外の話）',
    !hit('segment-impression', 'セグメントは海外ユニクロが +26.2%（構成比 約61%）で大きい。') && !hit('segment-impression', '海外ユニクロの伸びが気になった。') && !hit('segment-impression', '海外の景気が弱い。'))

  // ── op-only-judgement（測定2の後に追加） ──
  check('op-only-judgement 正例: 実物2「営業利益も増えていたので、業績は問題ない」／「営業利益が伸びていて業績は順調」', hit('op-only-judgement', '営業利益も増えていたので、業績は問題ない。') && hit('op-only-judgement', '営業利益が伸びていて業績は順調。'))
  check('op-only-judgement 負例: 実物1（営業利益と純利益の両方に触れる）／「営業利益も増えていたので、業績は問題ない。EPS も見た。」（同じメモに EPS）／「営業利益は5,425億円で前期比プラス」（業績の判断が無い）／clean',
    !hit('op-only-judgement', memoById('collected-undecided').text) && !hit('op-only-judgement', '営業利益も増えていたので、業績は問題ない。EPS も見た。') && !hit('op-only-judgement', '営業利益は5,425億円で前期比プラス。') && !hit('op-only-judgement', memoById('clean').text))
  check('op-only-judgement の本文は営業利益・純利益・EPS の前期比（+31.7%・+25.3%・+25.3%）を並べる', (() => { const b = fill(catalogueById('op-only-judgement').body, labVars(LAB_9983)); return b.includes('+31.7%') && (b.match(/\+25\.3%/g) ?? []).length === 2 })())

  // ── reviewer の負例（review-negatives-2026-10-22）: 当たってはいけない文。7項目のどれにも当たらない ──
  const NEW7 = NEW6
  const hitsNew = (text: string, m: LabMemo = free(text)) => detectAll({ text, memo: m, data: LAB_9983 }).map(e => e.id).filter(id => NEW7.includes(id))
  const REVIEW_NEG: string[] = [
    // W1 丸めた正しい数字
    '自己資本比率は63%。', '自己資本比率は62%。', '売上は前期比17%増。', '売上は前期比16%増。', 'ROAは12%。', 'PERは40倍。',
    'ROE 21.2%。', 'ROEは21%。', 'ROEは約21%。', 'ROEは2割を超える。', 'ROEは前期の20.2%から21.2%に上がった。', 'ROEは20.2%から21.2%に上がった。',
    '営業利益は前期比32%増。', 'EPSは前期比25%増。', 'EPSは1,768円。',
    // W2 を超え／上回る
    '自己資本比率は60%を超えている。',
    // W3 向きは完了形・進行形だけ・懸念の文は読まない
    'ROEが下がるリスクを確認したい。', '営業利益が減っているので、業績が順調とは言えない。',
    // W4 セグメント・地域・事業の数字
    '中国大陸の売上は前期比5%減。', 'Eコマースの売上高は前期比10%増。', 'ユニクロ事業全体の売上は前期比10%増。',
    // W5 型5つ
    '株価が上がっているのを見てから決算を読んだ。', '株価が上がったので、含み益が出ている。',
    '大手だから安心、とは言えないので自己資本比率を見た。', '有名な会社だから潰れない、と思い込まないようにする。',
    '株主への現金還元が増えた。', '現金配当が増えた。',
    '海外投資家の売買が多い。', '国内の同業他社と比べてPERが高そう。',
    '営業利益の推移が順調かどうか、次の決算で確かめる。',
    '円安で株価が上がりそうだから、買うかどうかは決算を見て決める。',
    // reviewer が「当たらない」を確かめていた文
    '純利益は前期から伸びた。売上総利益率は下がった。', 'ROEが上がった理由は、純利益が伸びたから。', '株価が下がったので、配当利回りは上がった。',
  ]
  const negHits = REVIEW_NEG.map(t => [t, hitsNew(t)] as const).filter(([, ids]) => ids.length > 0)
  check(`reviewer の負例 ${REVIEW_NEG.length} 文は、7項目のどれにも当たらない`, negHits.length === 0, negHits.map(([t, ids]) => `${t} → ${ids.join(',')}`).join(' | '))
  const negFields = [
    '保留。前回、株価が上がりそうだからと買って失敗したので、今回は数字を見る。',
    '買う。チャートが上がりそうだから、ではなく、利益の伸びを見た。',
  ].map(c => [c, hitsNew('', memo({ decision: 'hold', parts: { conclusion: c } }))] as const).filter(([, ids]) => ids.length > 0)
  check('reviewer の負例（結論の欄）: 「上がりそうだからと買って失敗した」「上がりそうだから、ではなく」は forecast-as-reason に当たらない', negFields.length === 0, negFields.map(([t, ids]) => `${t} → ${ids.join(',')}`).join(' | '))
  const REVIEW_POS: [string, string][] = [
    ['ROAは11.92%、ROEは21%。', 'fact-mismatch'], ['ESPが下がっている。', 'fact-mismatch'], ['売上高は前期比で10%増えていた。', 'fact-mismatch'],
    ['自己資本比率は45%。', 'fact-mismatch'], ['PERは25倍。', 'fact-mismatch'], ['営業利益は前期比20%増。', 'fact-mismatch'],
  ]
  check('W1 のあとも正例（11.92 対 11.6／ESP の向き／10% 対 16.6／45%／25倍／20%）は fact-mismatch に当たる', REVIEW_POS.every(([t, id]) => hitsNew(t).includes(id)), REVIEW_POS.filter(([t, id]) => !hitsNew(t).includes(id)).map(([t]) => t).join(' | '))

  // 手本メモ（MEMO_FULL）と clean は 0 件のまま
  check('7項目は手本メモ（MEMO_FULL）と clean のどちらにも当たらない', NEW6.every(id => !detectAll({ text: memoById('clean').text, memo: free(memoById('clean').text), data: LAB_9983 }).some(e => e.id === id)) && composeCritique(MEMO_FULL).check.hits.length === 0)
}

console.log('')
console.log(`PASS ${passed} 件 / FAIL ${failed} 件`)
if (failed) process.exit(1)
console.log('すべてPASS')
