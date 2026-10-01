/**
 * 米国株の一次情報: SEC EDGAR の `submissions` API（S3c・2026-10-01・DECISIONS 2026-09-30 3本目の追記）。
 *
 * 流れ: ティッカー → CIK（https://www.sec.gov/files/company_tickers.json）→ 提出書類の一覧
 * （https://data.sec.gov/submissions/CIK##########.json の filings.recent）→ 様式が許可リストに完全一致・提出日が窓の中のものを抽出。
 * recent（直近約 1,000 件）が窓より新しいところで切れているときは filings.files の分割ファイルも読む（古い買いでも出せるように）。
 *
 * 守っていること:
 *   - User-Agent は `investsim (<SEC_CONTACT_EMAIL>)`。SEC の公正利用の方針（連絡先を名乗る）。未設定なら **取りに行かず failed**
 *   - 1 秒に 10 リクエストを超えない（直列で 2〜4 本しか出さない）
 *   - 表示 URL は提出書類のトップページ `.../{accession}-index.htm`（primaryDocument に依存しない。ファイル名が無い・変わる提出があるため）
 *   - 見出しは SEC の表記（primaryDocDescription）をそのまま。無ければ様式名。要約しない・訳さない
 *   - 取得の失敗はリトライ 1 回、それでも駄目なら失敗として返す（空に化けさせない）
 *
 * 純関数（parse*・secItems・URL の組み立て）と取得（fetchSecSources）を分け、検査は純関数を実際に呼ぶ。
 */
import { isAllowedSecForm, isFetchSourceUrl } from './allowlist'
import { isFailedPayload, FAILED_CACHE_TTL_MS, type SourceCache } from './store'
import type { PrimarySourceItem } from './types'

export const SEC_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json'
export const SEC_SUBMISSIONS_BASE = 'https://data.sec.gov/submissions/'
export const SEC_PUBLISHER = 'SEC EDGAR' as const
/** 成功した控えを信じる時間（提出は毎日増えるので短め） */
export const SEC_CACHE_TTL_MS = 6 * 60 * 60 * 1000
/** ticker→CIK 表の控えを信じる時間（上場の出入りは日単位で動くが、1 週間で十分） */
export const SEC_TICKERS_TTL_MS = 7 * 24 * 60 * 60 * 1000

export type SecFiling = { form: string; filingDate: string; accessionNumber: string; description: string }
/** submissions JSON を必要な分だけに削った形（控えにはこれを入れる） */
export type SecSubmissionsSlim = {
  cik: string
  name: string
  filings: SecFiling[]
  /** 古い提出が入っている分割ファイル（recent の外側） */
  files: { name: string; filingFrom: string; filingTo: string }[]
}
export type SecTickerMap = Record<string, { cik: string; title: string }>

export type SecFetchResult =
  | { status: 'ok'; items: PrimarySourceItem[]; browseAllUrl: string; filerName: string }
  | { status: 'empty'; items: []; browseAllUrl: string | null }
  | { status: 'failed'; items: []; browseAllUrl: null; error: string }

/** CIK を 10 桁ゼロ埋めに */
export function padCik(cik: string | number): string {
  const digits = String(cik).replace(/\D/g, '')
  return digits.padStart(10, '0')
}

/** 提出書類のトップページ（primaryDocument に依存しない） */
export function secFilingUrl(cik: string | number, accessionNumber: string): string {
  const cikNum = String(Number.parseInt(String(cik), 10))
  const noDash = accessionNumber.replace(/-/g, '')
  return `https://www.sec.gov/Archives/edgar/data/${cikNum}/${noDash}/${accessionNumber}-index.htm`
}

/** その会社の提出書類の全件ページ */
export function secBrowseAllUrl(cik: string | number): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${padCik(cik)}&type=&dateb=&owner=include&count=40`
}

/** Yahoo の記法（BRK-B・BF.B）を SEC の記法（BRK-B・BF-B）に寄せる。大文字 */
export function normalizeTicker(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\./g, '-')
}

/** company_tickers.json → { TICKER: { cik, title } }（純関数。壊れた項目は飛ばす） */
export function parseTickerMap(json: unknown): SecTickerMap {
  const out: SecTickerMap = {}
  if (typeof json !== 'object' || json === null) return out
  for (const v of Object.values(json as Record<string, unknown>)) {
    if (typeof v !== 'object' || v === null) continue
    const { cik_str, ticker, title } = v as { cik_str?: unknown; ticker?: unknown; title?: unknown }
    if (typeof ticker !== 'string' || ticker === '') continue
    if (typeof cik_str !== 'number' && typeof cik_str !== 'string') continue
    out[ticker.toUpperCase()] = { cik: padCik(cik_str), title: typeof title === 'string' ? title : '' }
  }
  return out
}

/** submissions JSON（filings.recent の列ごとの配列）→ 行ごとの一覧（純関数） */
export function parseSubmissions(json: unknown): SecSubmissionsSlim | null {
  if (typeof json !== 'object' || json === null) return null
  const j = json as { cik?: unknown; name?: unknown; filings?: { recent?: Record<string, unknown[]>; files?: unknown[] } }
  const recent = j.filings?.recent
  if (!recent || !Array.isArray(recent.form) || !Array.isArray(recent.filingDate) || !Array.isArray(recent.accessionNumber)) return null
  const filings = zipFilings(recent)
  const files = Array.isArray(j.filings?.files)
    ? j.filings!.files!
        .map(f => f as { name?: unknown; filingFrom?: unknown; filingTo?: unknown })
        .filter(f => typeof f.name === 'string' && typeof f.filingFrom === 'string' && typeof f.filingTo === 'string')
        .map(f => ({ name: f.name as string, filingFrom: f.filingFrom as string, filingTo: f.filingTo as string }))
    : []
  return {
    cik: padCik(typeof j.cik === 'string' || typeof j.cik === 'number' ? j.cik : ''),
    name: typeof j.name === 'string' ? j.name : '',
    filings,
    files,
  }
}

/** 分割ファイル（CIK##########-submissions-001.json）は recent と同じ列の形で、filings の包みが無い */
export function parseSubmissionsPage(json: unknown): SecFiling[] {
  if (typeof json !== 'object' || json === null) return []
  const r = json as Record<string, unknown[]>
  if (!Array.isArray(r.form) || !Array.isArray(r.filingDate) || !Array.isArray(r.accessionNumber)) return []
  return zipFilings(r)
}

function zipFilings(recent: Record<string, unknown[]>): SecFiling[] {
  const n = Math.min(recent.form.length, recent.filingDate.length, recent.accessionNumber.length)
  const desc = Array.isArray(recent.primaryDocDescription) ? recent.primaryDocDescription : []
  const out: SecFiling[] = []
  for (let i = 0; i < n; i++) {
    const form = recent.form[i]
    const filingDate = recent.filingDate[i]
    const accessionNumber = recent.accessionNumber[i]
    if (typeof form !== 'string' || typeof filingDate !== 'string' || typeof accessionNumber !== 'string') continue
    const d = desc[i]
    out.push({ form, filingDate, accessionNumber, description: typeof d === 'string' ? d.trim() : '' })
  }
  return out
}

/**
 * 提出書類の一覧 → 窓の中・許可様式だけの一次情報（純関数）。並び・上限は index.ts の finalizeSources が決める。
 * 見出しは SEC の表記（primaryDocDescription）をそのまま。無ければ様式名（作文しない）。
 */
export function secItems(subs: SecSubmissionsSlim, filerName: string, window: { from: string; to: string }): PrimarySourceItem[] {
  const out: PrimarySourceItem[] = []
  for (const f of subs.filings) {
    if (!isAllowedSecForm(f.form)) continue
    if (f.filingDate < window.from || f.filingDate > window.to) continue
    out.push({
      source: 'sec',
      publisher: SEC_PUBLISHER,
      filerName,
      docType: f.form,
      title: f.description !== '' ? f.description : f.form,
      publishedAt: f.filingDate,
      url: secFilingUrl(subs.cik, f.accessionNumber),
      uid: f.accessionNumber,
    })
  }
  return out
}

// ── 取得 ─────────────────────────────────────────────────────────────────────

export interface SecDeps {
  fetch: typeof fetch
  cache: SourceCache
  now: () => number
  /** SEC_CONTACT_EMAIL。未設定なら取りに行かない */
  contactEmail: string | undefined
}

class SecFetchError extends Error {}

/** 控えを読み、新しければそれを返す。失敗の控えは 24 時間だけ信じる */
async function readCache<T>(deps: SecDeps, key: string, ttlMs: number, failedTtlMs: number): Promise<{ hit: true; value: T } | { hit: true; failed: string } | { hit: false }> {
  const entry = await deps.cache.get('sec', key)
  if (!entry) return { hit: false }
  const age = deps.now() - Date.parse(entry.fetchedAt)
  if (!Number.isFinite(age)) return { hit: false }
  if (isFailedPayload(entry.payload)) return age < failedTtlMs ? { hit: true, failed: entry.payload.error } : { hit: false }
  return age < ttlMs ? { hit: true, value: entry.payload as T } : { hit: false }
}

/** JSON を 1 回取り、駄目ならもう 1 回（計 2 回）。User-Agent は必ず付ける */
async function fetchJsonWithRetry(deps: SecDeps, url: string): Promise<unknown> {
  if (!isFetchSourceUrl(url)) throw new SecFetchError(`取得用ホストでない URL: ${url}`)
  if (!deps.contactEmail) throw new SecFetchError('SEC_CONTACT_EMAIL が未設定')
  const headers = { 'User-Agent': `investsim (${deps.contactEmail})`, Accept: 'application/json' }
  let lastError = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await deps.fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(15_000) })
      if (!res.ok) { lastError = `HTTP ${res.status}`; continue }
      return await res.json()
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
    }
  }
  throw new SecFetchError(lastError || '取得に失敗')
}

/** 取る → 控えに入れる（失敗も控える）。失敗は投げる */
async function fetchCached<T>(deps: SecDeps, key: string, url: string, parse: (json: unknown) => T | null, ttlMs: number): Promise<T> {
  const cached = await readCache<T>(deps, key, ttlMs, FAILED_CACHE_TTL_MS)
  if (cached.hit) {
    if ('failed' in cached) throw new SecFetchError(`直近の取得に失敗した控え: ${cached.failed}`)
    return cached.value
  }
  const fetchedAt = new Date(deps.now()).toISOString()
  try {
    const parsed = parse(await fetchJsonWithRetry(deps, url))
    if (parsed === null) throw new SecFetchError('応答の形が想定と違う')
    await deps.cache.put('sec', key, parsed, fetchedAt)
    return parsed
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    // 鍵（連絡先）が無い失敗は控えない（設定した直後に取れるように）
    if (!/SEC_CONTACT_EMAIL/.test(message)) await deps.cache.put('sec', key, { failed: true, error: message }, fetchedAt)
    throw new SecFetchError(message)
  }
}

/**
 * ティッカーの一次情報を取る。ティッカーが SEC の表に無ければ empty（SEC に提出しない発行体＝取得はできた）。
 * 連絡先が無い・通信に失敗・応答が壊れている → failed。
 */
export async function fetchSecSources(symbol: string, window: { from: string; to: string }, deps: SecDeps): Promise<SecFetchResult> {
  if (!deps.contactEmail) return { status: 'failed', items: [], browseAllUrl: null, error: 'SEC_CONTACT_EMAIL が未設定' }
  try {
    const map = await fetchCached<SecTickerMap>(deps, 'company_tickers', SEC_TICKERS_URL, j => {
      const m = parseTickerMap(j)
      return Object.keys(m).length > 0 ? m : null
    }, SEC_TICKERS_TTL_MS)
    const hit = map[normalizeTicker(symbol)]
    if (!hit) return { status: 'empty', items: [], browseAllUrl: null }

    const cik = hit.cik
    const subs = await fetchCached<SecSubmissionsSlim>(deps, cik, `${SEC_SUBMISSIONS_BASE}CIK${cik}.json`, parseSubmissions, SEC_CACHE_TTL_MS)
    const filings = [...subs.filings]
    // recent が窓の始まりより新しいところで切れていれば、窓にかかる分割ファイルも読む（1 本ずつ・直列）
    const oldestRecent = subs.filings.reduce((m, f) => (f.filingDate < m ? f.filingDate : m), '9999-12-31')
    if (window.from < oldestRecent) {
      for (const file of subs.files) {
        if (file.filingTo < window.from || file.filingFrom > window.to) continue
        if (!/^CIK\d{10}-submissions-\d{3}\.json$/.test(file.name)) continue
        const page = await fetchCached<SecFiling[]>(deps, file.name, `${SEC_SUBMISSIONS_BASE}${file.name}`, j => {
          const p = parseSubmissionsPage(j)
          return p.length > 0 ? p : null
        }, SEC_CACHE_TTL_MS)
        filings.push(...page)
      }
    }
    const filerName = subs.name !== '' ? subs.name : hit.title
    const items = secItems({ ...subs, filings }, filerName, window)
    const browseAllUrl = secBrowseAllUrl(cik)
    if (items.length === 0) return { status: 'empty', items: [], browseAllUrl }
    return { status: 'ok', items, browseAllUrl, filerName }
  } catch (e) {
    return { status: 'failed', items: [], browseAllUrl: null, error: e instanceof Error ? e.message : String(e) }
  }
}
