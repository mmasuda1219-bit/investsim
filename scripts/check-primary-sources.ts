// 「あなたが書いていないことの、出どころ」（/review/[recordId]・S3c・2026-10-01・DECISIONS 2026-09-30 3本目の追記）の検査。
//   $env:PATH = "C:\Program Files\nodejs;$env:PATH"; npx tsx scripts/check-primary-sources.ts
//
// 見るもの:
//  1. 要約しない: lib/review/primary-sources/**・components/review/PrimarySources.tsx が @anthropic-ai/sdk・lib/report・lib/ai-trader を
//     import しない。title に slice(・substring(・…・truncate を当てていない
//  2. 許可ドメイン: 表示用の一覧が 3 ホストと完全一致・api.edinet-fsa.go.jp が表示用に無い・PrimarySources.tsx が isRenderableSourceUrl を
//     通した URL しか href に入れない・SEC の様式リストが完全一致（startsWith 無し）・EDINET の書類種別コードが固定リスト（出典・確認日の注釈）
//  3. 並び: index.ts に publishedAt → uid の昇順ソートがあり、PrimarySources.tsx に .sort(・.filter( が無い
//  4. 純関数を実際に呼ぶ: 非許可 URL の件が落ちる・0 件で empty・21 件で truncated===1・順序が決定的（入力をシャッフルしても同じ）・
//     窓の絞り込み・SEC/EDINET の整形・偽の fetch で取得口を通す（鍵なし→failed・通信失敗→failed（empty に化けない）・リトライ 1 回）
//  5. リンク属性と固定文（静的描画）: rel="nofollow noopener"・target="_blank"・「リンク先は当社と関係がありません。」・「取得 」・
//     status failed／empty で何も描かない・入力の順のまま描く
//  6. 禁止語: 節に「注目すべき・反対・逆の見方・おすすめ・予測」が無い。節名が固定文と一致。ページの差し込み位置（§5 の下）・POST は 1 回
//  7. 鍵の露出: edinet.ts に Subscription-Key をクエリに入れる経路があっても、PrimarySourceItem.url に api.edinet-fsa.go.jp が絶対に入らない。
//     route.ts・0010 の SQL・DESIGN.md・SKILL.md の行
//
// 実ネットワーク不要。偽の fetch と合成データは検査の中だけ（製品コードに入れない）。

import fs from 'fs'
import path from 'path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  DISPLAY_HOSTS, FETCH_HOSTS, SEC_FORMS, EDINET_DOC_TYPES, isRenderableSourceUrl, isFetchSourceUrl, isAllowedSecForm, edinetDocTypeName,
} from '../lib/review/primary-sources/allowlist'
import {
  finalizeSources, windowAround, marketOf, getPrimarySources, isoDay, MAX_ITEMS, DEFAULT_WINDOW_DAYS, failedResult,
} from '../lib/review/primary-sources'
import type { PrimarySourceItem, PrimarySourceResult } from '../lib/review/primary-sources/types'
import {
  secItems, secFilingUrl, secBrowseAllUrl, padCik, parseTickerMap, parseSubmissions, parseSubmissionsPage, normalizeTicker, SEC_TICKERS_URL,
} from '../lib/review/primary-sources/sec'
import {
  edinetItems, edinetPdfUrl, parseDailyList, isInvalidKeyBody, datesBetween, toSecCode, lastEdinetAuthMode, EDINET_BROWSE_ALL_URL, EDINET_MAX_DAYS,
  scrubKey,
  type EdinetDoc,
} from '../lib/review/primary-sources/edinet'
import { rowToResult, noopCache, type SourceCache, type CacheEntry } from '../lib/review/primary-sources/store'
import { PrimarySources, SECTION_TITLE, SECTION_LEAD, NOT_AFFILIATED } from '../components/review/PrimarySources'

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
/** 注釈を落とす（文字列の中の // は残す。check-review-record.ts と同じ） */
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

const LIB_DIR = 'lib/review/primary-sources'
const LIB_FILES = fs.readdirSync(path.join(ROOT, LIB_DIR)).filter(f => f.endsWith('.ts')).map(f => `${LIB_DIR}/${f}`)
const COMPONENT = 'components/review/PrimarySources.tsx'
const PAGE = 'app/review/[recordId]/page.tsx'
const ROUTE = 'app/api/review/[recordId]/primary-sources/route.ts'
const SQL = 'supabase/migrations/0010_primary_sources.sql'
const SCOPE = [...LIB_FILES, COMPONENT]

// ── 合成データ（検査の中だけ） ───────────────────────────────────────────────
const FETCHED_AT = '2026-10-01T12:34:56.000Z'
const WINDOW = { from: '2026-07-11', to: '2026-09-09' }
function secItem(n: number, date: string, over: Partial<PrimarySourceItem> = {}): PrimarySourceItem {
  const acc = `0000320193-26-${String(n).padStart(6, '0')}`
  return {
    source: 'sec', publisher: 'SEC EDGAR', filerName: 'Apple Inc.', docType: '8-K', title: '8-K', publishedAt: date,
    url: `https://www.sec.gov/Archives/edgar/data/320193/${acc.replace(/-/g, '')}/${acc}-index.htm`, uid: acc, ...over,
  }
}
function shuffled<T>(arr: T[], seed: number): T[] {
  const a = [...arr]
  let s = seed
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const k = s % (i + 1)
    ;[a[i], a[k]] = [a[k], a[i]]
  }
  return a
}
/** メモリの控え（取得口の検査用） */
function memoryCache(): SourceCache & { map: Map<string, CacheEntry> } {
  const map = new Map<string, CacheEntry>()
  return {
    map,
    async get(source, key) { return map.get(`${source}:${key}`) ?? null },
    async put(source, key, payload, fetchedAt) { map.set(`${source}:${key}`, { payload, fetchedAt }) },
  }
}
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

async function main() {
// ─────────────────────────────────────────────────────────────────────────────
console.log('■ 1. 要約しない（AI・レポート・自動売買を import しない／見出しを切らない）')
for (const f of SCOPE) {
  const src = stripComments(read(f))
  check(`${f}: @anthropic-ai/sdk・lib/report・lib/ai-trader・lib/investors を import しない`, !/from ['"](?:@anthropic-ai\/sdk|@\/lib\/report|\.\.\/report|@\/lib\/ai-trader|@\/lib\/investors)/.test(src) && !/lib\/(?:report|ai-trader|investors)/.test(src))
  const raw = read(f)
  const titleLine = raw.split('\n').find(l => /title/.test(l) && /\.(?:slice|substring|substr)\(/.test(l))
  check(`${f}: title に slice(・substring(・…・truncate( を当てていない（… と truncate( は注釈にも無い）`, !titleLine && !raw.includes('…') && !/\btruncate\s*\(/i.test(raw) && !/\.(?:slice|substring|substr)\([^\n]*title/.test(src), titleLine)
}
{
  const edinet = stripComments(read(`${LIB_DIR}/edinet.ts`))
  check('edinet.ts: 見出しは docDescription を原文のまま（無いときだけ書類種別の名称）', edinet.includes("title: d.docDescription && d.docDescription !== '' ? d.docDescription : docType"))
  const sec = stripComments(read(`${LIB_DIR}/sec.ts`))
  check('sec.ts: 見出しは SEC の primaryDocDescription を原文のまま（無いときだけ様式名）・URL は primaryDocument に依存しない', sec.includes("title: f.description !== '' ? f.description : f.form") && !/primaryDocument\b/.test(sec))
  const comp = stripComments(read(COMPONENT))
  check('PrimarySources.tsx: fetch・Date.now・slice・substring を持たない（並びと中身は取得側で確定）', !comp.includes('fetch(') && !comp.includes('Date.now') && !/\.(?:slice|substring|substr)\(/.test(comp))
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('■ 2. 許可ドメイン・様式・書類種別')
{
  check('表示用ホストは 3 つと完全一致', j(DISPLAY_HOSTS) === j(['www.sec.gov', 'disclosure2dl.edinet-fsa.go.jp', 'disclosure2.edinet-fsa.go.jp']), j(DISPLAY_HOSTS))
  check('取得用ホストは 3 つと完全一致（表示用とは別の配列）', j(FETCH_HOSTS) === j(['data.sec.gov', 'www.sec.gov', 'api.edinet-fsa.go.jp']) && DISPLAY_HOSTS !== FETCH_HOSTS)
  check('api.edinet-fsa.go.jp と data.sec.gov は表示用に無い', !DISPLAY_HOSTS.includes('api.edinet-fsa.go.jp') && !DISPLAY_HOSTS.includes('data.sec.gov'))
  const okUrls = ['https://www.sec.gov/Archives/edgar/data/320193/000032019326000020/0000320193-26-000020-index.htm', 'https://disclosure2dl.edinet-fsa.go.jp/searchdocument/pdf/S100TEST.pdf', 'https://disclosure2.edinet-fsa.go.jp/']
  check('isRenderableSourceUrl: 表示用ホストの https は通る', okUrls.every(isRenderableSourceUrl))
  const ngUrls = ['http://www.sec.gov/x', 'https://api.edinet-fsa.go.jp/api/v2/documents.json?Subscription-Key=abc', 'https://data.sec.gov/submissions/CIK0000320193.json', 'https://evil.www.sec.gov/', 'https://www.sec.gov.evil.com/', '/relative', 'javascript:alert(1)', 'https://sec.gov/', '']
  check('isRenderableSourceUrl: http・取得用ホスト・サブドメイン・前方一致・相対・javascript: は通らない', ngUrls.every(u => !isRenderableSourceUrl(u)), ngUrls.filter(isRenderableSourceUrl).join(' '))
  check('isFetchSourceUrl: 取得用ホストだけ', isFetchSourceUrl('https://data.sec.gov/submissions/x.json') && isFetchSourceUrl(SEC_TICKERS_URL) && isFetchSourceUrl('https://api.edinet-fsa.go.jp/api/v2/documents.json') && !isFetchSourceUrl('https://disclosure2.edinet-fsa.go.jp/') && !isFetchSourceUrl('http://data.sec.gov/'))
  const comp = stripComments(read(COMPONENT))
  const hrefs = [...comp.matchAll(/href=\{([^}]+)\}/g)].map(m => m[1].trim())
  check('PrimarySources.tsx: href は it.url（isRenderableSourceUrl で守る）と browseAll（同じく守る）の 2 つだけ', j(hrefs) === j(['it.url', 'browseAll']) && comp.includes('isRenderableSourceUrl(it.url) ? (') && comp.includes('isRenderableSourceUrl(result.browseAllUrl) ? result.browseAllUrl : null'), j(hrefs))
  check('PrimarySources.tsx: 文字列の URL を直接 href に書かない', !/href="https?:/.test(comp))
  check('SEC の様式リストは完全一致', j(SEC_FORMS) === j(['10-K', '10-Q', '8-K', '10-K/A', '10-Q/A', '8-K/A', '20-F', '6-K', '40-F']), j(SEC_FORMS))
  check('allowlist.ts に startsWith が無い（前方一致で広げない）', !stripComments(read(`${LIB_DIR}/allowlist.ts`)).includes('startsWith'))
  check("isAllowedSecForm: '10-K' は通り '10-K405'・'10-k'・'10-KT'・'S-8'・'4' は通らない", isAllowedSecForm('10-K') && isAllowedSecForm('8-K/A') && !isAllowedSecForm('10-K405') && !isAllowedSecForm('10-k') && !isAllowedSecForm('10-KT') && !isAllowedSecForm('S-8') && !isAllowedSecForm('4'))
  check('EDINET の書類種別コードは 120/130/140/150/160/170/180/190 の固定リスト（名称は仕様書どおり）', j(EDINET_DOC_TYPES) === j({ '120': '有価証券報告書', '130': '訂正有価証券報告書', '140': '四半期報告書', '150': '訂正四半期報告書', '160': '半期報告書', '170': '訂正半期報告書', '180': '臨時報告書', '190': '訂正臨時報告書' }), j(EDINET_DOC_TYPES))
  check("edinetDocTypeName: '120' → 有価証券報告書・'030'（有価証券届出書）・'350'（大量保有）・'toString' は null", edinetDocTypeName('120') === '有価証券報告書' && edinetDocTypeName('030') === null && edinetDocTypeName('350') === null && edinetDocTypeName('toString') === null)
  const allow = read(`${LIB_DIR}/allowlist.ts`)
  check('allowlist.ts の注釈に出典（ESE140206.pdf）と確認日', allow.includes('ESE140206.pdf') && /確認日: \d{4}-\d{2}-\d{2}/.test(allow))
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('■ 3. 並び（取得側で確定・画面側は並べ替えない）')
{
  const idx = stripComments(read(`${LIB_DIR}/index.ts`))
  const sortAt = idx.indexOf('kept.sort(')
  const body = sortAt >= 0 ? idx.slice(sortAt, sortAt + 260) : ''
  check('index.ts: publishedAt → uid の昇順ソート（文字列比較・locale に依らない）', sortAt >= 0 && body.includes('a.publishedAt < b.publishedAt ? -1 : 1') && body.includes('a.uid < b.uid ? -1 : 1') && body.indexOf('publishedAt') < body.indexOf('uid') && !body.includes('localeCompare'))
  const comp = stripComments(read(COMPONENT))
  check('PrimarySources.tsx に .sort(・.filter(・.reverse( が無い', !comp.includes('.sort(') && !comp.includes('.filter(') && !comp.includes('.reverse('))
  check(`index.ts: 上限 ${MAX_ITEMS} 件・窓は前後 ${DEFAULT_WINDOW_DAYS} 暦日`, MAX_ITEMS === 20 && DEFAULT_WINDOW_DAYS === 30)
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('■ 4. 純関数を実際に呼ぶ（整形・並べ替え・窓・上限・取得口）')
{
  const base = { windowFrom: WINDOW.from, windowTo: WINDOW.to, fetchedAt: FETCHED_AT, browseAllUrl: secBrowseAllUrl(320193) }
  const bad = [
    secItem(1, '2026-08-01', { url: 'https://api.edinet-fsa.go.jp/api/v2/documents/S100X?type=2&Subscription-Key=abc' }),
    secItem(2, '2026-08-01', { url: 'http://www.sec.gov/Archives/x-index.htm' }),
    secItem(3, '2026-08-01', { url: 'javascript:alert(1)' }),
    secItem(4, '2026-08-01', { url: '' }),
    secItem(5, '2026-08-01', { uid: '' }),
  ]
  const r0 = finalizeSources(bad, base)
  check('finalizeSources: URL が表示用ホストでない件・URL や uid の無い件は落ち、0 件なら empty', r0.status === 'empty' && r0.items.length === 0 && r0.truncated === 0, j(r0))
  const one = finalizeSources([...bad, secItem(6, '2026-08-02')], base)
  check('finalizeSources: 許可 URL の 1 件だけ残る（ok）', one.status === 'ok' && one.items.length === 1 && one.items[0].uid === '0000320193-26-000006')
  const r21 = finalizeSources(Array.from({ length: 21 }, (_, i) => secItem(i + 1, '2026-08-01')), base)
  check('finalizeSources: 21 件 → 20 件・truncated === 1', r21.status === 'ok' && r21.items.length === 20 && r21.truncated === 1, `${r21.items.length} / ${r21.truncated}`)
  const r20 = finalizeSources(Array.from({ length: 20 }, (_, i) => secItem(i + 1, '2026-08-01')), base)
  check('finalizeSources: 20 件 → 20 件・truncated === 0', r20.items.length === 20 && r20.truncated === 0)
  const dates = ['2026-07-11', '2026-09-09', '2026-08-01', '2026-07-30', '2026-08-15', '2026-08-01', '2026-07-31']
  const many = Array.from({ length: 14 }, (_, i) => secItem(14 - i, dates[i % dates.length]))
  const first = finalizeSources(many, base)
  const same = [1, 2, 3, 4, 5].every(seed => j(finalizeSources(shuffled(many, seed * 7919), base)) === j(first))
  const ascending = first.items.every((it, i) => i === 0 || first.items[i - 1].publishedAt < it.publishedAt || (first.items[i - 1].publishedAt === it.publishedAt && first.items[i - 1].uid < it.uid))
  check('finalizeSources: 入力をシャッフルしても同じ結果・公開日昇順・同日は uid 昇順', same && ascending && first.items.length === 14 && first.items[0].publishedAt === '2026-07-11' && first.items[13].publishedAt === '2026-09-09')
  const out = finalizeSources([secItem(1, '2026-07-10'), secItem(2, '2026-09-10'), secItem(3, '2026-07-11'), secItem(4, '2026-09-09')], base)
  check('finalizeSources: 窓の外（前日・翌日）は落ち、両端は入る', out.items.map(x => x.publishedAt).join(',') === '2026-07-11,2026-09-09')
  const dup = finalizeSources([secItem(1, '2026-08-01'), secItem(1, '2026-08-01'), { ...secItem(1, '2026-08-01'), source: 'edinet', publisher: '金融庁 EDINET', url: edinetPdfUrl('S100AAAA') }], base)
  check('finalizeSources: 同じ source+uid は 1 件（source が違えば別）', dup.items.length === 2)
  check('finalizeSources: browseAllUrl が表示用ホストでなければ null', finalizeSources([], { ...base, browseAllUrl: 'https://data.sec.gov/x' }).browseAllUrl === null && finalizeSources([], base).browseAllUrl === base.browseAllUrl && finalizeSources([], { ...base, browseAllUrl: null }).browseAllUrl === null)
  check('finalizeSources: fetchedAt・windowFrom・windowTo をそのまま持つ', first.fetchedAt === FETCHED_AT && first.windowFrom === WINDOW.from && first.windowTo === WINDOW.to)
  check('failedResult: status failed・items 空（empty に化けない）', failedResult(WINDOW, FETCHED_AT).status === 'failed' && failedResult(WINDOW, FETCHED_AT).items.length === 0)

  check('windowAround: 2026-08-10 の前後 30 暦日 = 2026-07-11〜2026-09-09（今日が後なら）', j(windowAround('2026-08-10', 30, '2026-10-01')) === j(WINDOW))
  check('windowAround: 未来側は今日で打ち切り', j(windowAround('2026-08-10', 30, '2026-08-20')) === j({ from: '2026-07-11', to: '2026-08-20' }))
  check('windowAround: 年またぎ・うるう日', j(windowAround('2024-03-15', 30, '2026-10-01')) === j({ from: '2024-02-14', to: '2024-04-14' }) && j(windowAround('2026-01-05', 30, '2026-10-01')) === j({ from: '2025-12-06', to: '2026-02-04' }))
  check('isoDay: UTC の YYYY-MM-DD', isoDay(Date.parse('2026-08-10T23:59:59Z')) === '2026-08-10')
  check("marketOf: 7203.T → jp／AAPL・BRK-B・BF.B → us／7203・^GSPC・''・'../x' → none", j(marketOf('7203.T')) === j({ kind: 'jp', code4: '7203' }) && j(marketOf('aapl')) === j({ kind: 'us', ticker: 'AAPL' }) && marketOf('BRK-B').kind === 'us' && marketOf('BF.B').kind === 'us' && marketOf('7203').kind === 'none' && marketOf('^GSPC').kind === 'none' && marketOf('').kind === 'none' && marketOf('../x').kind === 'none')

  // SEC の整形
  const subsJson = {
    cik: '320193', name: 'Apple Inc.',
    filings: {
      recent: {
        accessionNumber: ['0000320193-26-000020', '0001140361-26-038028', '0000320193-26-000018', '0000320193-26-000010', '0000320193-26-000001'],
        filingDate: ['2026-07-31', '2026-08-05', '2026-07-30', '2026-06-01', '2026-08-01'],
        form: ['10-Q', '4', '8-K', '8-K', '10-K405'],
        primaryDocDescription: ['10-Q', '', 'FORM 8-K', '8-K', '10-K405'],
        primaryDocument: ['aapl-20260627.htm', 'x.xml', 'y.htm', 'z.htm', 'w.htm'],
      },
      files: [{ name: 'CIK0000320193-submissions-001.json', filingCount: 1256, filingFrom: '1994-01-26', filingTo: '2015-08-23' }],
    },
  }
  const subs = parseSubmissions(subsJson)!
  check('parseSubmissions: 列ごとの配列を行に（5 件）・cik は 10 桁・分割ファイルの一覧', subs !== null && subs.filings.length === 5 && subs.cik === '0000320193' && subs.files.length === 1 && subs.files[0].name === 'CIK0000320193-submissions-001.json')
  check('parseSubmissions: 形が違えば null', parseSubmissions({}) === null && parseSubmissions(null) === null && parseSubmissions({ filings: { recent: { form: 'x' } } }) === null)
  const items = secItems(subs, 'Apple Inc.', WINDOW)
  check('secItems: 様式の完全一致（4・10-K405 は落ちる）・窓の外（06-01）は落ちる → 2 件', items.length === 2 && items.every(i => ['10-Q', '8-K'].includes(i.docType)), j(items.map(i => `${i.docType}@${i.publishedAt}`)))
  check('secItems: URL は …/Archives/edgar/data/{cik}/{accession ハイフン無し}/{accession}-index.htm（primaryDocument を使わない）', items.find(i => i.docType === '10-Q')?.url === 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000020/0000320193-26-000020-index.htm' && !items.some(i => i.url.includes('.htm/') || i.url.includes('aapl-2026')))
  check('secItems: 見出しは SEC の表記のまま（FORM 8-K）・uid は accessionNumber・発行元 SEC EDGAR', items.find(i => i.docType === '8-K')?.title === 'FORM 8-K' && items.every(i => i.uid === i.url.split('/').pop()!.replace('-index.htm', '') && i.publisher === 'SEC EDGAR' && i.source === 'sec'))
  check('secFilingUrl / secBrowseAllUrl / padCik', secFilingUrl('0000320193', '0000320193-26-000020') === 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000020/0000320193-26-000020-index.htm' && secBrowseAllUrl(320193) === 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000320193&type=&dateb=&owner=include&count=40' && padCik(320193) === '0000320193' && isRenderableSourceUrl(secBrowseAllUrl(1)))
  const map = parseTickerMap({ '0': { cik_str: 1045810, ticker: 'NVDA', title: 'NVIDIA CORP' }, '1': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' }, '2': { broken: true }, '3': { cik_str: 'x', ticker: '' } })
  check('parseTickerMap: ticker → { cik 10 桁, title }・壊れた項目は飛ばす', j(map.AAPL) === j({ cik: '0000320193', title: 'Apple Inc.' }) && Object.keys(map).length === 2)
  check('normalizeTicker: brk.b → BRK-B', normalizeTicker(' brk.b ') === 'BRK-B')
  check('parseSubmissionsPage: 包みの無い列の形', parseSubmissionsPage({ accessionNumber: ['a-1'], filingDate: ['2015-01-01'], form: ['10-K'] }).length === 1 && parseSubmissionsPage({}).length === 0)

  // EDINET の整形
  const LONG = '有価証券報告書－第56期(2025/04/01－2026/03/31)　／　長い見出しをそのまま＜切らない＞ & "引用符" も原文どおり'
  const docs: EdinetDoc[] = [
    { docID: 'S100AAA2', secCode: '72030', docTypeCode: '120', docDescription: LONG, filerName: 'トヨタ自動車株式会社', submitDateTime: '2026-06-20 15:30', withdrawalStatus: '0', disclosureStatus: '0', pdfFlag: '1' },
    { docID: 'S100AAA1', secCode: '72030', docTypeCode: '180', docDescription: '臨時報告書', filerName: 'トヨタ自動車株式会社', submitDateTime: '2026-06-20 09:00', withdrawalStatus: '0', disclosureStatus: '0', pdfFlag: '1' },
    { docID: 'S100AAA3', secCode: '72030', docTypeCode: '030', docDescription: '有価証券届出書', filerName: 'トヨタ自動車株式会社', submitDateTime: '2026-06-20 10:00', withdrawalStatus: '0', disclosureStatus: '0', pdfFlag: '1' },
    { docID: 'S100AAA4', secCode: '72030', docTypeCode: '120', docDescription: '取り下げ済み', filerName: 'トヨタ自動車株式会社', submitDateTime: '2026-06-20 10:00', withdrawalStatus: '2', disclosureStatus: '0', pdfFlag: '1' },
    { docID: 'S100AAA5', secCode: '72030', docTypeCode: '120', docDescription: 'PDF 無し', filerName: 'トヨタ自動車株式会社', submitDateTime: '2026-06-20 10:00', withdrawalStatus: '0', disclosureStatus: '0', pdfFlag: '0' },
    { docID: 'S100AAA6', secCode: '72030', docTypeCode: '120', docDescription: '不開示', filerName: 'トヨタ自動車株式会社', submitDateTime: '2026-06-20 10:00', withdrawalStatus: '0', disclosureStatus: '2', pdfFlag: '1' },
    { docID: 'S100AAA7', secCode: '67580', docTypeCode: '120', docDescription: '他社', filerName: 'ソニーグループ株式会社', submitDateTime: '2026-06-20 10:00', withdrawalStatus: '0', disclosureStatus: '0', pdfFlag: '1' },
    { docID: 'S100AAA8', secCode: null, docTypeCode: '120', docDescription: '非上場', filerName: 'X', submitDateTime: '2026-06-20 10:00', withdrawalStatus: '0', disclosureStatus: '0', pdfFlag: '1' },
  ]
  const ed = edinetItems(docs, toSecCode('7203'), '2026-06-20')
  check('edinetItems: secCode 一致・固定リストの種別・取下げ/不開示/PDF 無しを除く → 2 件', ed.length === 2 && ed.every(i => i.source === 'edinet' && i.publisher === '金融庁 EDINET'), j(ed.map(i => i.uid)))
  check('edinetItems: 見出しは docDescription を原文のまま（切らない）・種別はコード名称', ed.find(i => i.uid === 'S100AAA2')?.title === LONG && ed.find(i => i.uid === 'S100AAA2')?.docType === '有価証券報告書' && ed.find(i => i.uid === 'S100AAA1')?.docType === '臨時報告書')
  check('edinetItems: URL は https://disclosure2dl.edinet-fsa.go.jp/searchdocument/pdf/{docID}.pdf・公開日は submitDateTime の日付', ed.every(i => i.url === `https://disclosure2dl.edinet-fsa.go.jp/searchdocument/pdf/${i.uid}.pdf` && i.publishedAt === '2026-06-20'))
  check("toSecCode: 7203 → 72030", toSecCode('7203') === '72030')
  check('parseDailyList: StatusCode 401（HTTP 200 のまま）・metadata.status 404/400/500 は失敗（null）・status 200 で results 空は []', parseDailyList({ StatusCode: 401, message: 'Access denied' }) === null && parseDailyList({ metadata: { status: '404' } }) === null && parseDailyList({ metadata: { status: '400' } }) === null && parseDailyList({ metadata: { status: '500' } }) === null && j(parseDailyList({ metadata: { status: '200', resultset: { count: 0 } }, results: [] })) === '[]' && parseDailyList('x') === null)
  check('parseDailyList: results を必要な項目だけに削る', (() => { const p = parseDailyList({ metadata: { status: '200' }, results: [{ docID: 'S1', secCode: '72030', docTypeCode: '120', docDescription: 'd', filerName: 'f', submitDateTime: '2026-06-20 10:00', withdrawalStatus: '0', disclosureStatus: '0', pdfFlag: '1', xbrlFlag: '1', extra: 'x' }, { noDocId: true }] }); return p !== null && p.length === 1 && !('xbrlFlag' in p[0]) && p[0].docID === 'S1' })())
  check('isInvalidKeyBody: StatusCode 401 だけ true', isInvalidKeyBody({ StatusCode: 401 }) && !isInvalidKeyBody({ metadata: { status: '200' } }) && !isInvalidKeyBody(null))
  // S3c レビュー W2: クエリ方式では鍵が URL に載るので、例外文に URL が含まれても鍵が控え・ログに残らないよう伏せる
  check('scrubKey: 文中の鍵を [鍵] に置き換える（複数回・鍵が空なら何もしない）',
    scrubKey('fetch failed: https://api.edinet-fsa.go.jp/api/v2/documents.json?date=2026-08-01&type=2&Subscription-Key=SECRET123 (SECRET123)', 'SECRET123') === 'fetch failed: https://api.edinet-fsa.go.jp/api/v2/documents.json?date=2026-08-01&type=2&Subscription-Key=[鍵] ([鍵])'
    && scrubKey('plain', '') === 'plain' && !scrubKey('x SECRET123 y', 'SECRET123').includes('SECRET123'))
  // S3c レビュー W1: クエリ方式に切り替わった後の HTTP 401 は「鍵が無効」として扱い、24 時間の失敗控えに入れない
  check('edinet.ts: クエリ方式の HTTP 401 を鍵無効として投げる（控えに残さない）', read('lib/review/primary-sources/edinet.ts').includes("if (res.status === 401) throw new EdinetFetchError('EDINET_API_KEY が無効（HTTP 401）')"))
  // S3c レビュー W3: 固定の 1 秒待ちではなく、前回の送信からの残りだけ待つ
  check('edinet.ts: 待ちは前回の送信からの残り（EDINET_INTERVAL_MS - (now - lastAt)）', /EDINET_INTERVAL_MS - \(deps\.now\(\) - state\.lastAt\)/.test(read('lib/review/primary-sources/edinet.ts')))
  check(`datesBetween: 2026-07-11〜2026-09-09 は 61 日・上限 ${EDINET_MAX_DAYS}`, datesBetween('2026-07-11', '2026-09-09').length === 61 && datesBetween('2026-07-11', '2026-09-09')[0] === '2026-07-11' && datesBetween('2026-07-11', '2026-09-09')[60] === '2026-09-09' && datesBetween('2020-01-01', '2020-12-31').length === EDINET_MAX_DAYS && datesBetween('x', 'y').length === 0)

  // 取得口を偽の fetch で通す（米国株）
  const NOW = Date.parse('2026-10-01T12:00:00Z')
  const tickersBody = { '0': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' } }
  const calls: { url: string; ua: string | undefined }[] = []
  const fakeFetch = (bodies: Record<string, unknown | (() => Response)>): typeof fetch => (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const h = new Headers(init?.headers)
    calls.push({ url, ua: h.get('user-agent') ?? undefined })
    const b = bodies[url]
    if (b === undefined) return new Response('not found', { status: 404 })
    return typeof b === 'function' ? (b as () => Response)() : jsonResponse(b)
  }) as typeof fetch
  const usBodies = { [SEC_TICKERS_URL]: tickersBody, 'https://data.sec.gov/submissions/CIK0000320193.json': subsJson }
  const usCache = memoryCache()
  const us = await getPrimarySources({ symbol: 'AAPL', tradeDate: '2026-08-10' }, { fetch: fakeFetch(usBodies), cache: usCache, now: () => NOW, env: { SEC_CONTACT_EMAIL: 'ops@example.com' } })
  check('getPrimarySources(AAPL): ok・2 件・公開日昇順（8-K 07-30 → 10-Q 07-31）・窓 07-11〜09-09・全件ページ', us.status === 'ok' && us.items.map(i => `${i.docType}@${i.publishedAt}`).join(',') === '8-K@2026-07-30,10-Q@2026-07-31' && us.windowFrom === '2026-07-11' && us.windowTo === '2026-09-09' && us.browseAllUrl === secBrowseAllUrl(320193) && us.fetchedAt === new Date(NOW).toISOString(), j(us))
  check('getPrimarySources(AAPL): User-Agent は investsim (<SEC_CONTACT_EMAIL>)・取得は 2 本（tickers・submissions）', calls.length === 2 && calls.every(c => c.ua === 'investsim (ops@example.com)'), j(calls))
  check('getPrimarySources(AAPL): 控えに company_tickers と CIK の submissions が入る', usCache.map.has('sec:company_tickers') && usCache.map.has('sec:0000320193'))
  calls.length = 0
  const us2 = await getPrimarySources({ symbol: 'AAPL', tradeDate: '2026-08-10' }, { fetch: fakeFetch(usBodies), cache: usCache, now: () => NOW + 1000, env: { SEC_CONTACT_EMAIL: 'ops@example.com' } })
  check('getPrimarySources(AAPL) 2 回目: 控えから（fetch 0 本）・同じ結果', calls.length === 0 && j(us2.items) === j(us.items))
  calls.length = 0
  const noMail = await getPrimarySources({ symbol: 'AAPL', tradeDate: '2026-08-10' }, { fetch: fakeFetch(usBodies), cache: memoryCache(), now: () => NOW, env: {} })
  check('getPrimarySources(AAPL): SEC_CONTACT_EMAIL 未設定 → 取りに行かず failed（fetch 0 本）', noMail.status === 'failed' && noMail.items.length === 0 && calls.length === 0)
  calls.length = 0
  const down = await getPrimarySources({ symbol: 'AAPL', tradeDate: '2026-08-10' }, { fetch: fakeFetch({ [SEC_TICKERS_URL]: () => new Response('x', { status: 503 }) }), cache: memoryCache(), now: () => NOW, env: { SEC_CONTACT_EMAIL: 'ops@example.com' } })
  check('getPrimarySources(AAPL): 5xx → リトライ 1 回（計 2 本）→ failed（empty に化けない）', down.status === 'failed' && calls.length === 2, `${down.status} / ${calls.length}`)
  calls.length = 0
  const unknown = await getPrimarySources({ symbol: 'ZZZZ', tradeDate: '2026-08-10' }, { fetch: fakeFetch(usBodies), cache: memoryCache(), now: () => NOW, env: { SEC_CONTACT_EMAIL: 'ops@example.com' } })
  check('getPrimarySources(SEC に無いティッカー): empty（取得はできた）', unknown.status === 'empty' && unknown.items.length === 0)
  calls.length = 0
  const none = await getPrimarySources({ symbol: '^GSPC', tradeDate: '2026-08-10' }, { fetch: fakeFetch({}), cache: memoryCache(), now: () => NOW, env: { SEC_CONTACT_EMAIL: 'ops@example.com', EDINET_API_KEY: 'k' } })
  check('getPrimarySources(どちらでもない記法): empty・fetch 0 本', none.status === 'empty' && calls.length === 0)
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('■ 5. リンク属性と固定文（静的描画）')
const okResult: PrimarySourceResult = {
  status: 'ok', truncated: 0, fetchedAt: FETCHED_AT, windowFrom: WINDOW.from, windowTo: WINDOW.to, browseAllUrl: secBrowseAllUrl(320193),
  items: [
    secItem(2, '2026-07-31', { docType: '10-Q', title: '10-Q' }),
    secItem(1, '2026-07-30', { docType: '8-K', title: 'FORM 8-K' }),
  ],
}
{
  const html = renderToStaticMarkup(React.createElement(PrimarySources, { result: okResult }))
  check('節名「あなたが書いていないことの、出どころ」と本文 1 行', html.includes(`>${SECTION_TITLE}</h2>`) && html.includes(SECTION_LEAD) && SECTION_LEAD === '買った日の前後30日に、発行会社が公式に出した書類の一覧です。中身の要約はしていません。')
  check('リンクは rel="nofollow noopener" target="_blank"（全部）', count(html, '<a ') === 2 && count(html, 'rel="nofollow noopener"') === 2 && count(html, 'target="_blank"') === 2)
  check('href は許可ホストの URL そのまま', html.includes('href="https://www.sec.gov/Archives/edgar/data/320193/000032019326000002/0000320193-26-000002-index.htm"'))
  check('公開日・発行元・書類の種類・表題（原文）', html.includes('2026-07-31') && html.includes('SEC EDGAR') && html.includes('10-Q') && html.includes('>FORM 8-K</a>') && html.includes('Apple Inc.'))
  check('末尾に「取得 YYYY-MM-DD」と「リンク先は当社と関係がありません。」', html.includes('取得 2026-10-01') && html.includes(NOT_AFFILIATED) && NOT_AFFILIATED === 'リンク先は当社と関係がありません。')
  check('入力の順のまま描く（07-31 が 07-30 より先＝並べ替えない）', html.indexOf('2026-07-31') < html.indexOf('2026-07-30'))
  check('truncated 0 なら「他に…件」を出さない', !html.includes('件あります'))
  check('一覧は border-t の一列（格子にしない＝<table 無し）', html.includes('border-t border-border first:border-t-0') && !html.includes('<table'))
  check('--danger／text-danger／text-success を使わない', !/--danger|text-danger|--success|text-success/.test(html))
  const tr = renderToStaticMarkup(React.createElement(PrimarySources, { result: { ...okResult, truncated: 3 } }))
  check('truncated 3 →「この期間には他に3件あります。」＋発行元の全件ページへのリンク（nofollow noopener）', tr.includes('この期間には他に3件あります。') && tr.includes(`href="${secBrowseAllUrl(320193).replace(/&/g, '&amp;')}"`) && count(tr, 'rel="nofollow noopener"') === 3)
  const trNoBrowse = renderToStaticMarkup(React.createElement(PrimarySources, { result: { ...okResult, truncated: 3, browseAllUrl: null } }))
  check('全件ページが無ければ件数だけ', trNoBrowse.includes('この期間には他に3件あります。') && count(trNoBrowse, '<a ') === 2)
  const badLink = renderToStaticMarkup(React.createElement(PrimarySources, { result: { ...okResult, browseAllUrl: 'https://api.edinet-fsa.go.jp/x?Subscription-Key=k', truncated: 1, items: [...okResult.items, secItem(9, '2026-08-01', { url: 'https://api.edinet-fsa.go.jp/api/v2/documents/S1?Subscription-Key=k' })] } }))
  check('許可ホスト以外の件・全件ページは描かない（第 2 の砦）', !badLink.includes('api.edinet-fsa.go.jp') && count(badLink, '<a ') === 2 && !badLink.includes('Subscription-Key'))
  check("status 'failed' → 何も描かない（見出しも無し）", renderToStaticMarkup(React.createElement(PrimarySources, { result: { ...okResult, status: 'failed', items: [] } })) === '')
  check("status 'empty' → 何も描かない", renderToStaticMarkup(React.createElement(PrimarySources, { result: { ...okResult, status: 'empty', items: [] } })) === '')
  check('null → 何も描かない', renderToStaticMarkup(React.createElement(PrimarySources, { result: null })) === '')
  const LONG = '有価証券報告書－第56期(2025/04/01－2026/03/31)　／　長い見出しをそのまま＜切らない＞ & "引用符" も原文どおり'
  const jp = renderToStaticMarkup(React.createElement(PrimarySources, { result: { ...okResult, browseAllUrl: EDINET_BROWSE_ALL_URL, items: [{ source: 'edinet', publisher: '金融庁 EDINET', filerName: 'トヨタ自動車株式会社', docType: '有価証券報告書', title: LONG, publishedAt: '2026-06-20', url: edinetPdfUrl('S100AAA2'), uid: 'S100AAA2' }] } }))
  check('EDINET の件: 長い見出しをそのまま（HTML エスケープ以外は変えない）・PDF の URL', jp.includes(LONG.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')) && jp.includes('href="https://disclosure2dl.edinet-fsa.go.jp/searchdocument/pdf/S100AAA2.pdf"') && jp.includes('金融庁 EDINET') && jp.includes('有価証券報告書'))
  const src = read(COMPONENT)
  check("PrimarySources.tsx: 'use client'・status !== 'ok' で null", /^'use client'/.test(src) && src.includes("if (!result || result.status !== 'ok') return null"))
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('■ 6. 禁止語・節名・ページの差し込み')
{
  const BAN = /注目すべき|反対|逆の見方|おすすめ|予測/
  const comp = stripComments(read(COMPONENT))
  check('PrimarySources.tsx に 注目すべき／反対／逆の見方／おすすめ／予測 が無い', !BAN.test(comp), BAN.exec(comp)?.[0])
  const html = renderToStaticMarkup(React.createElement(PrimarySources, { result: { ...okResult, truncated: 2 } }))
  check('描いた HTML にも無い', !BAN.test(html), BAN.exec(html)?.[0])
  check('評価の語（よくある・珍しい・意外・重要・注意・警告・判定）が無い', !/よくある|珍しい|意外|重要|注意|警告|判定/.test(comp))
  check("節名は固定文 'あなたが書いていないことの、出どころ'", SECTION_TITLE === 'あなたが書いていないことの、出どころ')
  const page = stripComments(read(PAGE))
  const at = page.indexOf('<PrimarySources result={sources} />')
  check('ページ: §5（起きたことの頻度）の下・数字の上に差し込む', at > 0 && page.indexOf('>起きたことの頻度<') < at && at < page.indexOf('>あなたの記録の数字<'))
  check("ページ: GET → 'unresolved' のときだけ POST を 1 回（promise を ref に持つ）", count(page, "method: 'POST'") === 1 && page.includes("if (r !== 'unresolved')") && page.includes('posted.current.promise') && page.includes("posted.current.id !== recordId"))
  check('ページ: ok 以外は何も出さない（readSources は ok か unresolved か null）', page.includes("body?.status === 'ok' ? (body as PrimarySourceResult) : null") && page.includes("body?.status === 'unresolved'"))
  check('ページ: 記録が描けてから（recordKey）・/api/review/${recordId}/primary-sources', page.includes('if (!recordKey) return') && page.includes('/api/review/${recordId}/primary-sources'))
  check('ページ: lib/ai-trader・lib/investors・AI SDK を import しない（変わらず）', !/from ['"]@\/lib\/(?:ai-trader|investors)|@anthropic-ai\/sdk/.test(page))
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('■ 7. 鍵の露出・ルート・SQL・文書')
{
  const edinetSrc = stripComments(read(`${LIB_DIR}/edinet.ts`))
  check("edinet.ts: 鍵はヘッダ Ocp-Apim-Subscription-Key を先に、通らなければクエリ Subscription-Key", edinetSrc.includes("'Ocp-Apim-Subscription-Key'") && edinetSrc.includes("'Subscription-Key'") && edinetSrc.indexOf("'Ocp-Apim-Subscription-Key'") < edinetSrc.indexOf("'Subscription-Key'"))
  check('edinet.ts: EDINET_API_KEY が無ければ取りに行かず failed', edinetSrc.includes("if (!apiKey) return { status: 'failed'"))
  check('edinet.ts: 1 秒に 1 本（EDINET_INTERVAL_MS = 1000）・直列', edinetSrc.includes('EDINET_INTERVAL_MS = 1_000') && !edinetSrc.includes('Promise.all'))
  check('sec.ts: SEC_CONTACT_EMAIL が無ければ取りに行かず failed・User-Agent は investsim (<メール>)', stripComments(read(`${LIB_DIR}/sec.ts`)).includes("if (!deps.contactEmail) return { status: 'failed'") && read(`${LIB_DIR}/sec.ts`).includes('`investsim (${deps.contactEmail})`'))

  // 偽の fetch で日本株を通し、鍵が URL（item.url・JSON 全体）に出ないこと
  const KEY = 'SECRET-KEY-1234'
  const NOW = Date.parse('2026-10-01T12:00:00Z')
  const seen: { url: string; header: string | null }[] = []
  let sleeps = 0
  const daily = (date: string) => ({
    metadata: { status: '200', resultset: { count: 1 } },
    results: date === '2026-06-20'
      ? [{ docID: 'S100AAA2', secCode: '72030', docTypeCode: '120', docDescription: '有価証券報告書－第56期', filerName: 'トヨタ自動車株式会社', submitDateTime: '2026-06-20 15:30', withdrawalStatus: '0', disclosureStatus: '0', pdfFlag: '1' }]
      : [],
  })
  const jpFetch = (rejectHeader: boolean): typeof fetch => (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const h = new Headers(init?.headers)
    seen.push({ url, header: h.get('Ocp-Apim-Subscription-Key') })
    const u = new URL(url)
    const keyOk = (!rejectHeader && h.get('Ocp-Apim-Subscription-Key') === KEY) || u.searchParams.get('Subscription-Key') === KEY
    if (!keyOk) return jsonResponse({ StatusCode: 401, message: 'Access denied due to invalid subscription key.' })
    return jsonResponse(daily(u.searchParams.get('date') ?? ''))
  }) as typeof fetch
  const jpDeps = { cache: memoryCache(), now: () => NOW, sleep: async () => { sleeps++ }, env: { EDINET_API_KEY: KEY } }
  const jp = await getPrimarySources({ symbol: '7203.T', tradeDate: '2026-06-25' }, { ...jpDeps, fetch: jpFetch(false) })
  check('getPrimarySources(7203.T・ヘッダで通る): ok・1 件・窓の 61 日を直列で取る・1 秒待ちは 60 回', jp.status === 'ok' && jp.items.length === 1 && jp.items[0].uid === 'S100AAA2' && seen.length === 61 && sleeps === 60 && lastEdinetAuthMode() === 'header', `${jp.status} ${seen.length} ${sleeps} ${lastEdinetAuthMode()}`)
  check('PrimarySourceItem.url に api.edinet-fsa.go.jp も鍵も入らない（JSON 全体にも）', !j(jp).includes('api.edinet-fsa.go.jp') && !j(jp).includes(KEY) && jp.items[0].url === 'https://disclosure2dl.edinet-fsa.go.jp/searchdocument/pdf/S100AAA2.pdf' && jp.browseAllUrl === EDINET_BROWSE_ALL_URL)
  check('取得用 URL は api.edinet-fsa.go.jp・ヘッダに鍵・クエリには鍵が無い', seen.every(s => s.url.startsWith('https://api.edinet-fsa.go.jp/api/v2/documents.json?date=') && s.header === KEY && !s.url.includes('Subscription-Key')))
  const jp2 = await getPrimarySources({ symbol: '7203.T', tradeDate: '2026-06-25' }, { ...jpDeps, fetch: jpFetch(false) })
  check('2 回目は控えから（fetch が増えない）・同じ結果', seen.length === 61 && j(jp2.items) === j(jp.items))
  seen.length = 0; sleeps = 0
  const jpQ = await getPrimarySources({ symbol: '7203.T', tradeDate: '2026-06-25' }, { ...jpDeps, cache: memoryCache(), fetch: jpFetch(true) })
  check('ヘッダが拒否されたらクエリ Subscription-Key に切り替えて通る（切り替えは 1 回・以後クエリ）', jpQ.status === 'ok' && jpQ.items.length === 1 && lastEdinetAuthMode() === 'query' && seen[0].header === KEY && seen[1].url.includes('Subscription-Key=') && seen.length === 62, `${jpQ.status} ${seen.length} ${lastEdinetAuthMode()}`)
  check('クエリで通ったときも item.url に鍵が入らない', !j(jpQ).includes(KEY) && !j(jpQ).includes('api.edinet-fsa.go.jp'))
  seen.length = 0
  const noKey = await getPrimarySources({ symbol: '7203.T', tradeDate: '2026-06-25' }, { ...jpDeps, cache: memoryCache(), fetch: jpFetch(false), env: {} })
  check('EDINET_API_KEY 未設定 → 取りに行かず failed（fetch 0 本）', noKey.status === 'failed' && seen.length === 0)
  seen.length = 0
  const jpDown = await getPrimarySources({ symbol: '7203.T', tradeDate: '2026-06-25' }, { ...jpDeps, cache: memoryCache(), fetch: (async () => new Response('down', { status: 503 })) as typeof fetch })
  check('EDINET が 5xx → failed（empty に化けない）・同じ日をもう 1 回だけ', jpDown.status === 'failed' && jpDown.items.length === 0)
  const empty = await getPrimarySources({ symbol: '6758.T', tradeDate: '2026-06-25' }, { ...jpDeps, cache: memoryCache(), fetch: jpFetch(false) })
  check('該当 0 件の銘柄 → empty（failed ではない）', empty.status === 'empty' && empty.items.length === 0 && empty.browseAllUrl === EDINET_BROWSE_ALL_URL)

  // ルート
  const route = stripComments(read(ROUTE))
  check('route.ts: export const maxDuration = 120・runtime nodejs', route.includes('export const maxDuration = 120') && route.includes("export const runtime = 'nodejs'"))
  check("route.ts: Cache-Control: private, no-store（GET・POST とも json() 経由）", route.includes("'Cache-Control': 'private, no-store'") && route.includes('NextResponse.json(body, { status, headers: NO_STORE })'))
  check('route.ts: 本人確認は getCurrentUserId → 401・uuid でなければ 404・自分の記録に無ければ 404（findRecord）', route.includes('getCurrentUserId()') && route.includes("'unauthenticated'") && route.includes('UUID_RE.test(recordId)') && route.includes('findRecord(portfolio.trades, recordId)') && count(route, "{ error: 'not_found' }, 404") === 2)
  check("route.ts: GET は保存済みを返し、無ければ { status: 'unresolved' }", route.includes("saved.result ?? { status: 'unresolved' }"))
  check('route.ts: POST は保存済みがあればそれを返す（同じ記録を 2 回解決しない）', route.indexOf('if (saved.result) return json(saved.result)') < route.indexOf('getPrimarySources('))
  check("route.ts: failed は保存せず返す・表が無ければ解決しない", route.includes("if (result.status === 'failed') return json({ ...result, reason: 'fetch_failed' })") && route.indexOf("if (result.status === 'failed')") < route.indexOf('savePrimarySources(') && route.indexOf("if (!saved.ok) return json({ status: 'failed', reason: saved.reason })") < route.indexOf('getPrimarySources('))
  check('route.ts: AI・lib/ai-trader・lib/investors を import しない', !/@anthropic-ai\/sdk|lib\/ai-trader|lib\/investors|lib\/report/.test(route))
  check('rowToResult: 壊れた行は null・正しい行は結果', rowToResult(null) === null && rowToResult({ status: 'ok', items: 'x' as unknown as PrimarySourceItem[] }) === null && rowToResult({ status: 'ok', items: [], truncated: 0, fetched_at: FETCHED_AT, window_from: WINDOW.from, window_to: WINDOW.to, browse_all_url: null })?.status === 'ok')
  check('noopCache: 何も覚えない', (await noopCache.get('sec', 'x')) === null)

  // SQL・文書
  const sql = read(SQL)
  check('0010_primary_sources.sql: 2 つの表（review_primary_sources・primary_source_cache）・if not exists・主キー', sql.includes('create table if not exists public.review_primary_sources') && sql.includes('create table if not exists public.primary_source_cache') && sql.includes('primary key (user_id, record_id)') && sql.includes('primary key (source, key)'))
  check("0010: status の check（ok/empty/failed）・RLS 有効・ポリシー無し・0008/0009 と独立の注釈", sql.includes("check (status in ('ok', 'empty', 'failed'))") && count(sql, 'enable row level security') === 2 && !sql.includes('create policy') && sql.includes('独立') && sql.includes('0009'))
  check('0010: 列（items jsonb・truncated int・fetched_at・window_from・window_to・browse_all_url・payload jsonb）', ['items          jsonb', 'truncated      int', 'fetched_at     timestamptz', 'window_from    date', 'window_to      date', 'browse_all_url text', 'payload    jsonb'].every(s => sql.includes(s)))
  const design = read('DESIGN.md')
  check('DESIGN.md §6-15 に節の規則（要約しない・許可ドメイン・昇順・取得日）', design.includes('あなたが書いていないことの、出どころ') && design.includes('要約しない・選ばない・評価しない') && design.includes('`www.sec.gov`・`disclosure2dl.edinet-fsa.go.jp`・`disclosure2.edinet-fsa.go.jp`') && design.includes('公開日昇順・同日は uid') && design.includes('取得 YYYY-MM-DD'))
  const skill = read('.claude/skills/investsim-conventions/SKILL.md')
  check('SKILL.md の環境変数の表に SEC_CONTACT_EMAIL・EDINET_API_KEY', skill.includes('| `SEC_CONTACT_EMAIL` |') && skill.includes('| `EDINET_API_KEY` |'))
  check('禁止ファイルに触れていない目印（judgement.ts・PriceSincePanel.tsx・exit-rule.ts・patterns.ts・record.ts・reason.ts・features.ts・next.config.ts・sitemap.ts）', read('components/review/PriceSincePanel.tsx').includes('const H = 96') && read('lib/review/exit-rule.ts').includes('export function isNoRule') && read('lib/trade/reason.ts').includes('export function parseReason') && read('lib/review/record.ts').includes('export function findRecord') && exists('lib/review/patterns.ts') && exists('lib/review/judgement.ts') && exists('lib/features.ts') && exists('next.config.ts') && exists('app/sitemap.ts'))
  check('.env.local に鍵を入れる前提（.gitignore が .env* を除外）', read('.gitignore').includes('.env*'))
}

}

await_main()

function await_main() {
  main().then(() => {
    console.log('')
    console.log(`PASS ${passed} 件 / FAIL ${failed} 件`)
    if (failed) process.exit(1)
    console.log('すべてPASS')
  }).catch(e => { console.error(e); process.exit(1) })
}
