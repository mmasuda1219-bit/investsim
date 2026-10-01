/**
 * 日本株の一次情報: 金融庁 EDINET API v2 の書類一覧（S3c・2026-10-01・DECISIONS 2026-09-30 3本目の追記）。
 *
 * 流れ: 窓の各日（最大 61 日）について https://api.edinet-fsa.go.jp/api/v2/documents.json?date=YYYY-MM-DD&type=2 を
 * **直列・1 秒に 1 本** で取り、secCode が `${コード4桁}0`・docTypeCode が固定リスト（./allowlist.ts の EDINET_DOC_TYPES）の
 * ものを抽出する。日次一覧は銘柄に依らないので日付ごとに控え（過去の日付は長く・今日に近い日付は短く信じる）。
 *
 * 鍵（EDINET_API_KEY）: 仕様書（ESE140206 3-1-1）はクエリ `Subscription-Key` を定めているが、実体は Azure API Management なので
 * ヘッダ `Ocp-Apim-Subscription-Key` も通ることが多い。**ヘッダを先に試し、鍵が無効と返ったらクエリに切り替える**。
 * どちらで通ったかは console.info に 1 行出す（lastAuthMode() でも読める）。鍵が未設定なら **取りに行かず failed**。
 *
 * 守っていること:
 *   - 鍵の載った取得用 URL（api.edinet-fsa.go.jp）は **PrimarySourceItem.url に絶対に入れない**。表示 URL は書類の PDF
 *     https://disclosure2dl.edinet-fsa.go.jp/searchdocument/pdf/{docID}.pdf だけ
 *   - 見出しは docDescription を原文のまま（切らない・訳さない・要約しない）
 *   - 取り下げられた書類（withdrawalStatus '2'）・不開示中（disclosureStatus '2'）・PDF の無い書類（pdfFlag != '1'）は URL が成立しないので出さない
 *     （出典 URL の無い件を 1 件も出さない＝不変条件。選別ではなく、開けないリンクを出さないため）
 *   - 仕様書 3-3: エラーは HTTP 200 のまま本文の metadata.status（400/404/500）や StatusCode（401）で返る。本文を見て判定する
 *   - 取得の失敗はリトライ 1 回、それでも駄目なら失敗として返す（空に化けさせない）
 *
 * 純関数（parseDailyList・edinetItems・URL の組み立て）と取得（fetchEdinetSources）を分け、検査は純関数を実際に呼ぶ。
 */
import { edinetDocTypeName, isFetchSourceUrl } from './allowlist'
import { isFailedPayload, FAILED_CACHE_TTL_MS, type SourceCache } from './store'
import type { PrimarySourceItem } from './types'

export const EDINET_API_BASE = 'https://api.edinet-fsa.go.jp/api/v2/documents.json'
export const EDINET_PDF_BASE = 'https://disclosure2dl.edinet-fsa.go.jp/searchdocument/pdf/'
/** 全件検索の入口（銘柄で直接引ける URL は公式に定まっていないので入口に送る） */
export const EDINET_BROWSE_ALL_URL = 'https://disclosure2.edinet-fsa.go.jp/'
export const EDINET_PUBLISHER = '金融庁 EDINET' as const
/** 1 秒に 1 本 */
export const EDINET_INTERVAL_MS = 1_000
/** 窓の最大日数（前後 30 暦日＋当日） */
export const EDINET_MAX_DAYS = 61
/** 過ぎた日付の一覧は長く信じる（提出は締まっている）。今日に近い日付は短く */
export const EDINET_PAST_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const EDINET_RECENT_TTL_MS = 6 * 60 * 60 * 1000

/** 日次一覧の 1 件を必要な分だけに削った形（控えにはこれを入れる） */
export type EdinetDoc = {
  docID: string
  secCode: string | null
  docTypeCode: string | null
  docDescription: string | null
  filerName: string | null
  submitDateTime: string | null
  withdrawalStatus: string | null
  disclosureStatus: string | null
  pdfFlag: string | null
}

export type EdinetFetchResult =
  | { status: 'ok'; items: PrimarySourceItem[]; browseAllUrl: string }
  | { status: 'empty'; items: []; browseAllUrl: string }
  | { status: 'failed'; items: []; browseAllUrl: null; error: string }

/** 4 桁の証券コード（7203）→ EDINET の secCode（72030） */
export function toSecCode(code4: string): string {
  return `${code4.toUpperCase()}0`
}

/** 書類の PDF（表示用ホスト。鍵は載らない） */
export function edinetPdfUrl(docID: string): string {
  return `${EDINET_PDF_BASE}${encodeURIComponent(docID)}.pdf`
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

/**
 * documents.json の本文 → 1 日分の一覧（純関数）。
 * 鍵が無効（StatusCode 401）・パラメータ誤り・無い日付・サーバーエラー（metadata.status 400/404/500）は null（失敗）。
 */
export function parseDailyList(json: unknown): EdinetDoc[] | null {
  if (typeof json !== 'object' || json === null) return null
  const j = json as { StatusCode?: unknown; metadata?: { status?: unknown }; results?: unknown }
  if (j.StatusCode !== undefined && j.StatusCode !== 200) return null
  const status = j.metadata?.status
  if (status !== undefined && String(status) !== '200') return null
  if (!Array.isArray(j.results)) return status === undefined ? null : []
  const out: EdinetDoc[] = []
  for (const r of j.results) {
    if (typeof r !== 'object' || r === null) continue
    const d = r as Record<string, unknown>
    const docID = str(d.docID)
    if (!docID) continue
    out.push({
      docID,
      secCode: str(d.secCode),
      docTypeCode: str(d.docTypeCode),
      docDescription: str(d.docDescription),
      filerName: str(d.filerName),
      submitDateTime: str(d.submitDateTime),
      withdrawalStatus: str(d.withdrawalStatus),
      disclosureStatus: str(d.disclosureStatus),
      pdfFlag: str(d.pdfFlag),
    })
  }
  return out
}

/** 鍵が無効と言われた本文か（ヘッダ → クエリ の切り替えに使う） */
export function isInvalidKeyBody(json: unknown): boolean {
  if (typeof json !== 'object' || json === null) return false
  const j = json as { StatusCode?: unknown; metadata?: { status?: unknown } }
  return j.StatusCode === 401 || String(j.metadata?.status ?? '') === '401'
}

/**
 * 1 日分の一覧 → その銘柄・許可種別の一次情報（純関数）。並び・上限は index.ts の finalizeSources が決める。
 * date は一覧を取った日付（submitDateTime が読めないときの公開日）。
 */
export function edinetItems(docs: EdinetDoc[], secCode: string, date: string): PrimarySourceItem[] {
  const out: PrimarySourceItem[] = []
  for (const d of docs) {
    if (d.secCode !== secCode) continue
    const docType = d.docTypeCode ? edinetDocTypeName(d.docTypeCode) : null
    if (!docType) continue
    if (d.withdrawalStatus === '2' || d.disclosureStatus === '2' || d.pdfFlag !== '1') continue
    const submitted = d.submitDateTime ? d.submitDateTime.split(' ')[0] : ''
    const publishedAt = /^\d{4}-\d{2}-\d{2}$/.test(submitted) ? submitted : date
    out.push({
      source: 'edinet',
      publisher: EDINET_PUBLISHER,
      filerName: d.filerName ?? '',
      docType,
      title: d.docDescription && d.docDescription !== '' ? d.docDescription : docType,
      publishedAt,
      url: edinetPdfUrl(d.docID),
      uid: d.docID,
    })
  }
  return out
}

/** from〜to（両端含む・YYYY-MM-DD）の日付を順に。上限を超える分は切る（純関数） */
export function datesBetween(from: string, to: string, max = EDINET_MAX_DAYS): string[] {
  const out: string[] = []
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return out
  for (let t = start; t <= end && out.length < max; t += 86_400_000) out.push(new Date(t).toISOString().split('T')[0])
  return out
}

// ── 取得 ─────────────────────────────────────────────────────────────────────

export interface EdinetDeps {
  fetch: typeof fetch
  cache: SourceCache
  now: () => number
  sleep: (ms: number) => Promise<void>
  /** EDINET_API_KEY。未設定なら取りに行かない */
  apiKey: string | undefined
}

export type EdinetAuthMode = 'header' | 'query'
let authMode: EdinetAuthMode = 'header'
/** 直近の取得で通った鍵の渡し方（報告用） */
export function lastEdinetAuthMode(): EdinetAuthMode {
  return authMode
}

class EdinetFetchError extends Error {}

/** 文中の鍵を伏せる（控え・ログ・例外文に鍵を残さない。S3c レビュー W2） */
export function scrubKey(text: string, apiKey: string): string {
  return apiKey ? text.split(apiKey).join('[鍵]') : text
}

function buildRequest(date: string, apiKey: string, mode: EdinetAuthMode): { url: string; headers: Record<string, string> } {
  const u = new URL(EDINET_API_BASE)
  u.searchParams.set('date', date)
  u.searchParams.set('type', '2')
  const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': 'investsim' }
  if (mode === 'header') headers['Ocp-Apim-Subscription-Key'] = apiKey
  else u.searchParams.set('Subscription-Key', apiKey)
  return { url: u.toString(), headers }
}

/** 1 日分を取る。鍵がヘッダで通らなければクエリに切り替えて同じ日をもう一度。通信の失敗は 1 回だけやり直す */
async function fetchDay(deps: EdinetDeps, date: string, apiKey: string): Promise<EdinetDoc[]> {
  let lastError = ''
  let switched = false
  for (let attempt = 0; attempt < 3; attempt++) {
    const { url, headers } = buildRequest(date, apiKey, authMode)
    if (!isFetchSourceUrl(url)) throw new EdinetFetchError(`取得用ホストでない URL`)
    let json: unknown
    try {
      const res = await deps.fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(20_000) })
      if (res.status === 401 && authMode === 'header' && !switched) { authMode = 'query'; switched = true; continue }
      // クエリ方式に切り替わった後の 401 は鍵が無効。控えに残さない失敗として扱う（S3c レビュー W1。
      // ここで continue すると「HTTP 401」の一般の失敗になり、24 時間の失敗控えに入って鍵を直した直後に取れない）
      if (res.status === 401) throw new EdinetFetchError('EDINET_API_KEY が無効（HTTP 401）')
      if (!res.ok) { lastError = `HTTP ${res.status}`; continue }
      json = await res.json()
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
      continue
    }
    if (isInvalidKeyBody(json)) {
      if (authMode === 'header' && !switched) { authMode = 'query'; switched = true; continue }
      throw new EdinetFetchError('EDINET_API_KEY が無効（ヘッダ・クエリの両方で拒否）')
    }
    const parsed = parseDailyList(json)
    if (parsed === null) {
      const m = (json as { metadata?: { status?: unknown; message?: unknown } })?.metadata
      lastError = `EDINET status ${String(m?.status ?? '?')} ${String(m?.message ?? '')}`.trim()
      continue
    }
    return parsed
  }
  throw new EdinetFetchError(lastError || '取得に失敗')
}

/** 日付の一覧を控えから、無ければ取って控える。失敗は投げる（失敗も 24 時間だけ控える） */
async function dayDocs(deps: EdinetDeps, date: string, apiKey: string, today: string, state: { requested: number; lastAt: number }): Promise<EdinetDoc[]> {
  const entry = await deps.cache.get('edinet', date)
  if (entry) {
    const age = deps.now() - Date.parse(entry.fetchedAt)
    const ttl = date < today ? EDINET_PAST_TTL_MS : EDINET_RECENT_TTL_MS
    if (Number.isFinite(age)) {
      if (isFailedPayload(entry.payload)) {
        if (age < FAILED_CACHE_TTL_MS) throw new EdinetFetchError(`直近の取得に失敗した控え（${date}）: ${entry.payload.error}`)
      } else if (age < ttl && Array.isArray(entry.payload)) {
        return entry.payload as EdinetDoc[]
      }
    }
  }
  // 1 秒に 1 本（控えが当たった日は待たない）。固定で 1 秒眠るのではなく「前回の送信から 1 秒経っていなければ
  // 残りだけ待つ」（S3c レビュー W3）。取得と控えの往復が待ち時間に吸収され、61 日でも 70 秒前後に収まる
  if (state.lastAt > 0) {
    const wait = EDINET_INTERVAL_MS - (deps.now() - state.lastAt)
    if (wait > 0) await deps.sleep(wait)
  }
  state.requested++
  state.lastAt = deps.now()
  const fetchedAt = new Date(deps.now()).toISOString()
  try {
    const docs = await fetchDay(deps, date, apiKey)
    await deps.cache.put('edinet', date, docs, fetchedAt)
    return docs
  } catch (e) {
    // 鍵の文字列を機械的に伏せてから控え・ログに回す（S3c レビュー W2）。クエリ方式では鍵が URL に載るので、
    // ランタイムの例外文に URL が含まれたときに鍵が残らないよう、経路に依らずここで消す
    const message = scrubKey(e instanceof Error ? e.message : String(e), apiKey)
    // 鍵が無効な失敗は控えない（鍵を直した直後に取れるように）
    if (!/EDINET_API_KEY/.test(message)) await deps.cache.put('edinet', date, { failed: true, error: message }, fetchedAt)
    throw new EdinetFetchError(message)
  }
}

/**
 * 4 桁コードの一次情報を窓の各日から集める。鍵が無い → failed。どこかの日が取れない → failed（部分的な一覧を ok と言わない）。
 * today は「今日」の YYYY-MM-DD（控えの寿命の判定に使う）。
 */
export async function fetchEdinetSources(code4: string, window: { from: string; to: string }, today: string, deps: EdinetDeps): Promise<EdinetFetchResult> {
  const apiKey = deps.apiKey?.trim()
  if (!apiKey) return { status: 'failed', items: [], browseAllUrl: null, error: 'EDINET_API_KEY が未設定' }
  const secCode = toSecCode(code4)
  const items: PrimarySourceItem[] = []
  const state = { requested: 0, lastAt: 0 }
  try {
    for (const date of datesBetween(window.from, window.to)) {
      const docs = await dayDocs(deps, date, apiKey, today, state)
      items.push(...edinetItems(docs, secCode, date))
    }
  } catch (e) {
    return { status: 'failed', items: [], browseAllUrl: null, error: e instanceof Error ? e.message : String(e) }
  }
  if (state.requested > 0) console.info(`[primary-sources] edinet auth=${authMode} requests=${state.requested}`)
  if (items.length === 0) return { status: 'empty', items: [], browseAllUrl: EDINET_BROWSE_ALL_URL }
  return { status: 'ok', items, browseAllUrl: EDINET_BROWSE_ALL_URL }
}
