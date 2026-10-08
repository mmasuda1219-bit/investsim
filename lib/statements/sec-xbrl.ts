/**
 * 「1年ごとの決算」の取得口: SEC EDGAR の XBRL companyfacts API（/stocks/[symbol]・2026-10-07）。
 *
 * 流れ: ティッカー → CIK（https://www.sec.gov/files/company_tickers.json。lib/review/primary-sources/sec.ts と同じ表・同じ控え）
 *     → https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json（本体 3〜8 MB）
 *     → facts['us-gaap'][候補タグ].units[単位] の行から 10-K・期間 300 日超〜400 日未満の行だけを採り、期末日で統合 → 最後の 5 期。
 *
 * 守っていること（MC 2026-10-07 の実測手順。推測で変えない）:
 *   - データ源は SEC EDGAR だけ。Yahoo Finance の getStatements() は呼ばない（Yahoo の規約「表示された情報を再配布しない」）
 *   - User-Agent は `investsim (<SEC_CONTACT_EMAIL>)`。未設定なら **取りに行かず failed**（sec.ts と同じ作法）
 *   - 【罠1】`fy` は決算期ではなく提出書類の年。鍵・並び・年ラベルはすべて `end`（期末日）
 *   - 【罠2】同じ期末日が複数あれば `filed` が新しい行を採る（過年度の訂正を反映）
 *   - 【罠3】タグを1つ選ばない。候補タグを全部読んで期末日で統合する（会社は時期によって別のタグを使う）
 *   - 【罠4】項目ごとに欠けを許す。無い項目はその行だけ落とす（銀行には OperatingIncomeLoss が無い）
 *   - EBITDA は出さない（会計基準に定義が無く SEC のタグにも無い）
 *   - 控えには 8 MB の本体ではなく、解析後の小さな結果（ParsedCompanyFacts）だけを入れる
 *
 * 純関数（parseCompanyFacts・companyFactsUrl・ANNUAL_ITEMS）と取得（fetchAnnualStatements・getAnnualStatements）を分け、
 * 検査（scripts/check-annual-statements.ts）は純関数を実際に呼ぶ。通信を伴う検査は書かない。
 */
import { marketOf } from '@/lib/review/primary-sources'
import { isFetchSourceUrl } from '@/lib/review/primary-sources/allowlist'
import { normalizeTicker, padCik, parseTickerMap, SEC_TICKERS_TTL_MS, SEC_TICKERS_URL, type SecTickerMap } from '@/lib/review/primary-sources/sec'
import { defaultCache, FAILED_CACHE_TTL_MS, isFailedPayload, type SourceCache } from '@/lib/review/primary-sources/store'
import type { ValueKind } from './display'

export const SEC_COMPANYFACTS_BASE = 'https://data.sec.gov/api/xbrl/companyfacts/'
/** 解析後の控えを信じる時間。10-K は年に 1 回なので 1 日で十分（HTTP の控え 6 時間がこの手前にある） */
export const COMPANYFACTS_TTL_MS = 24 * 60 * 60 * 1000
/** 控えの鍵の版。ParsedCompanyFacts の形を変えたら上げる（古い控えが最長 24 時間出続けるのを防ぐ） */
export const COMPANYFACTS_CACHE_VERSION = 'v1'
/** 1 回の取得の待ち。表と companyfacts の 2 本 × リトライ 2 回で最悪 48 秒（route の maxDuration 60 の中に収める） */
export const FETCH_TIMEOUT_MS = 12_000
/** 画面に出す期の数 */
export const PERIOD_COUNT = 5
/** 年次の行とみなす期間（日）。四半期（約 90 日）と累計（約 180・270 日）を外し、53 週の年（371 日）は通す */
export const MIN_ANNUAL_DAYS = 300
export const MAX_ANNUAL_DAYS = 400
/** 採る様式（完全一致） */
export const ANNUAL_FORM = '10-K'

export type AnnualItemKey = 'revenue' | 'operatingIncome' | 'netIncome' | 'eps'

export interface AnnualItemDef {
  key: AnnualItemKey
  label: string
  kind: ValueKind
  /** companyfacts の units の鍵 */
  unit: 'USD' | 'USD/shares'
  /** us-gaap の候補タグ（この順で優先。同じ期末日・同じ提出日なら先のタグが勝つ） */
  tags: readonly string[]
}

/**
 * 項目の定義（MC 2026-10-07 の候補タグ。売上高の順はレビュー W1 を受けて MC が実測して決めた:
 * US-GAAP の総収益 Revenues を先頭に、証券会社の純収益 RevenuesNetOfInterestExpense を追加。JPM/BAC/C は Revenues だけ、GS は
 * RevenuesNetOfInterestExpense だけを持つ。AAPL の Revenues は 2016 年度の 1 行だけで窓の外なので影響なし）
 */
export const ANNUAL_ITEMS: readonly AnnualItemDef[] = [
  {
    key: 'revenue', label: '売上高', kind: 'money', unit: 'USD',
    tags: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenuesNetOfInterestExpense', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'],
  },
  { key: 'operatingIncome', label: '営業利益', kind: 'money', unit: 'USD', tags: ['OperatingIncomeLoss'] },
  { key: 'netIncome', label: '純利益', kind: 'money', unit: 'USD', tags: ['NetIncomeLoss', 'ProfitLoss'] },
  { key: 'eps', label: '1株あたり利益', kind: 'perShare', unit: 'USD/shares', tags: ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted'] },
]

export interface AnnualStatementItem {
  key: AnnualItemKey
  label: string
  kind: ValueKind
  /** 実際に採った us-gaap のタグ（期末日の昇順で最初に現れた順・重複なし）。会社・時期で違うので出所に出す */
  tags: string[]
  /** periodEnds と同じ長さ。無い年は null */
  values: (number | null)[]
}

/** companyfacts を解析した小さな結果（控えにはこれを入れる） */
export interface ParsedCompanyFacts {
  cik: string
  entityName: string
  /** 期末日の昇順・最後の PERIOD_COUNT 期 */
  periodEnds: string[]
  /** 取れた項目だけ（ANNUAL_ITEMS の順） */
  items: AnnualStatementItem[]
}

/** 画面・API が受け取る形 */
export interface AnnualStatements extends ParsedCompanyFacts {
  symbol: string
  currency: 'USD'
  /** 取得した時刻（ISO 8601）。控えから返したときは控えを取った時刻 */
  fetchedAt: string
}

export type AnnualStatementsResult =
  | { status: 'ok'; statements: AnnualStatements }
  | { status: 'empty'; reason: 'not-us' | 'unknown-ticker' | 'no-data' }
  | { status: 'failed'; error: string }

export function companyFactsUrl(cik: string | number): string {
  return `${SEC_COMPANYFACTS_BASE}CIK${padCik(cik)}.json`
}

/** 控えの鍵（'sec' の下）。版を含める */
export function companyFactsCacheKey(cik: string | number): string {
  return `companyfacts:${COMPANYFACTS_CACHE_VERSION}:${padCik(cik)}`
}

// ── 純関数 ──────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function daysBetween(start: string, end: string): number {
  return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS
}

/** 1 行が「10-K の年次の行」か。start・end・filed が日付、val が有限、期間が 300 日超〜400 日未満 */
function isAnnualRow(r: unknown): r is { start: string; end: string; val: number; filed: string } {
  if (typeof r !== 'object' || r === null) return false
  const { start, end, val, form, filed } = r as { start?: unknown; end?: unknown; val?: unknown; form?: unknown; filed?: unknown }
  if (form !== ANNUAL_FORM) return false
  if (typeof start !== 'string' || !DATE_RE.test(start) || typeof end !== 'string' || !DATE_RE.test(end)) return false
  if (typeof filed !== 'string' || !DATE_RE.test(filed)) return false
  if (typeof val !== 'number' || !Number.isFinite(val)) return false
  const days = daysBetween(start, end)
  return days > MIN_ANNUAL_DAYS && days < MAX_ANNUAL_DAYS
}

/**
 * companyfacts JSON → 項目ごとの年次の値（純関数）。応答の形が違えば null。項目が 1 つも取れなければ items は空（呼び出し側が empty にする）。
 *   - 候補タグを全部読み、期末日（end）で統合。同じ end は filed の新しい行が勝つ。同じ filed なら先の候補タグが勝つ
 *   - 期末日の集合は全項目の和。昇順に並べて最後の periods 期
 *   - 1 つの年も取れない項目は落とす（他の項目は残す）。年ごとの欠けは null
 */
export function parseCompanyFacts(json: unknown, defs: readonly AnnualItemDef[] = ANNUAL_ITEMS, periods = PERIOD_COUNT): ParsedCompanyFacts | null {
  if (typeof json !== 'object' || json === null) return null
  const j = json as { cik?: unknown; entityName?: unknown; facts?: { 'us-gaap'?: Record<string, { units?: Record<string, unknown[]> }> } }
  const gaap = j.facts?.['us-gaap']
  if (typeof gaap !== 'object' || gaap === null) return null

  type Picked = { value: number; filed: string; tag: string }
  const perItem: { def: AnnualItemDef; byEnd: Map<string, Picked> }[] = []
  for (const def of defs) {
    const byEnd = new Map<string, Picked>()
    for (const tag of def.tags) {
      const rows = gaap[tag]?.units?.[def.unit]
      if (!Array.isArray(rows)) continue
      for (const r of rows) {
        if (!isAnnualRow(r)) continue
        const cur = byEnd.get(r.end)
        if (!cur || r.filed > cur.filed) byEnd.set(r.end, { value: r.val, filed: r.filed, tag })
      }
    }
    perItem.push({ def, byEnd })
  }

  const allEnds = new Set<string>()
  for (const { byEnd } of perItem) for (const end of byEnd.keys()) allEnds.add(end)
  const periodEnds = [...allEnds].sort().slice(-periods)

  const items: AnnualStatementItem[] = []
  for (const { def, byEnd } of perItem) {
    const values = periodEnds.map(end => byEnd.get(end)?.value ?? null)
    if (values.every(v => v === null)) continue
    // 採ったタグを期末日の昇順で（重複なく）。出所の行に「売上高=SalesRevenueNet + RevenueFromContract…」と出す
    const tags: string[] = []
    for (const end of periodEnds) {
      const t = byEnd.get(end)?.tag
      if (t !== undefined && !tags.includes(t)) tags.push(t)
    }
    items.push({ key: def.key, label: def.label, kind: def.kind, tags, values })
  }

  return {
    cik: padCik(typeof j.cik === 'string' || typeof j.cik === 'number' ? j.cik : ''),
    entityName: typeof j.entityName === 'string' ? j.entityName.trim() : '',
    periodEnds: items.length > 0 ? periodEnds : [],
    items,
  }
}

// ── 取得 ────────────────────────────────────────────────────────────────────

export interface SecXbrlDeps {
  fetch: typeof fetch
  /** 控え。ティッカー表は sec.ts と同じ鍵（'sec'/'company_tickers'）を共有する */
  cache: SourceCache
  now: () => number
  /** SEC_CONTACT_EMAIL。未設定なら取りに行かない */
  contactEmail: string | undefined
}

class SecXbrlError extends Error {}

type CacheRead<T> = { hit: true; value: T; fetchedAt: string } | { hit: true; failed: string } | { hit: false }

/** 控えを読み、新しければ返す。失敗の控えは 24 時間だけ信じる（sec.ts の readCache と同じ約束） */
async function readCache<T>(deps: SecXbrlDeps, key: string, ttlMs: number): Promise<CacheRead<T>> {
  const entry = await deps.cache.get('sec', key)
  if (!entry) return { hit: false }
  const age = deps.now() - Date.parse(entry.fetchedAt)
  if (!Number.isFinite(age)) return { hit: false }
  if (isFailedPayload(entry.payload)) return age < FAILED_CACHE_TTL_MS ? { hit: true, failed: entry.payload.error } : { hit: false }
  return age < ttlMs ? { hit: true, value: entry.payload as T, fetchedAt: entry.fetchedAt } : { hit: false }
}

/** JSON を 1 回取り、駄目ならもう 1 回（計 2 回）。User-Agent は必ず付ける。待ちは FETCH_TIMEOUT_MS（route の上限の中に収める） */
async function fetchJsonWithRetry(deps: SecXbrlDeps, url: string): Promise<unknown> {
  if (!isFetchSourceUrl(url)) throw new SecXbrlError(`取得用ホストでない URL: ${url}`)
  if (!deps.contactEmail) throw new SecXbrlError('SEC_CONTACT_EMAIL が未設定')
  const headers = { 'User-Agent': `investsim (${deps.contactEmail})`, Accept: 'application/json' }
  let lastError = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await deps.fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      if (!res.ok) { lastError = `HTTP ${res.status}`; continue }
      return await res.json()
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
    }
  }
  throw new SecXbrlError(lastError || '取得に失敗')
}

/** 取る → 解析 → 控えに入れる（失敗も控える。連絡先が無い失敗は控えない）。失敗は投げる */
async function fetchCached<T>(deps: SecXbrlDeps, key: string, url: string, parse: (json: unknown) => T | null, ttlMs: number): Promise<{ value: T; fetchedAt: string }> {
  const cached = await readCache<T>(deps, key, ttlMs)
  if (cached.hit) {
    if ('failed' in cached) throw new SecXbrlError(`直近の取得に失敗した控え: ${cached.failed}`)
    return { value: cached.value, fetchedAt: cached.fetchedAt }
  }
  const fetchedAt = new Date(deps.now()).toISOString()
  try {
    const parsed = parse(await fetchJsonWithRetry(deps, url))
    if (parsed === null) throw new SecXbrlError('応答の形が想定と違う')
    await deps.cache.put('sec', key, parsed, fetchedAt)
    return { value: parsed, fetchedAt }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (!/SEC_CONTACT_EMAIL/.test(message)) await deps.cache.put('sec', key, { failed: true, error: message }, fetchedAt)
    throw new SecXbrlError(message)
  }
}

/**
 * ティッカーの年次決算を取る。
 *   - 米国株でない（.T など）→ empty 'not-us'／SEC の表に無い → empty 'unknown-ticker'／10-K の年次の行が 1 つも無い → empty 'no-data'
 *   - 連絡先が無い・通信に失敗・応答が壊れている → failed（empty に化けさせない）
 */
export async function fetchAnnualStatements(symbol: string, deps: SecXbrlDeps): Promise<AnnualStatementsResult> {
  if (!deps.contactEmail) return { status: 'failed', error: 'SEC_CONTACT_EMAIL が未設定' }
  const market = marketOf(symbol)
  if (market.kind !== 'us') return { status: 'empty', reason: 'not-us' }
  try {
    const { value: map } = await fetchCached<SecTickerMap>(deps, 'company_tickers', SEC_TICKERS_URL, j => {
      const m = parseTickerMap(j)
      return Object.keys(m).length > 0 ? m : null
    }, SEC_TICKERS_TTL_MS)
    const hit = map[normalizeTicker(market.ticker)]
    if (!hit) return { status: 'empty', reason: 'unknown-ticker' }

    const { value: parsed, fetchedAt } = await fetchCached<ParsedCompanyFacts>(
      deps, companyFactsCacheKey(hit.cik), companyFactsUrl(hit.cik), j => parseCompanyFacts(j), COMPANYFACTS_TTL_MS,
    )
    if (parsed.items.length === 0 || parsed.periodEnds.length === 0) return { status: 'empty', reason: 'no-data' }
    return {
      status: 'ok',
      statements: {
        ...parsed,
        cik: parsed.cik || hit.cik,
        entityName: parsed.entityName !== '' ? parsed.entityName : hit.title,
        symbol: market.ticker,
        currency: 'USD',
        fetchedAt,
      },
    }
  } catch (e) {
    return { status: 'failed', error: e instanceof Error ? e.message : String(e) }
  }
}

/** 製品コードの入口（既定の fetch・控え・時計・環境変数） */
export async function getAnnualStatements(symbol: string, deps: Partial<SecXbrlDeps> = {}): Promise<AnnualStatementsResult> {
  return fetchAnnualStatements(symbol, {
    fetch: deps.fetch ?? fetch,
    cache: deps.cache ?? defaultCache(),
    now: deps.now ?? (() => Date.now()),
    contactEmail: 'contactEmail' in deps ? deps.contactEmail : process.env.SEC_CONTACT_EMAIL,
  })
}
