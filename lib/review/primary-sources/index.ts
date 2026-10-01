/**
 * 「あなたが書いていないことの、出どころ」の取得口（S3c・2026-10-01・DECISIONS 2026-09-30 3本目の追記）。
 *
 * getPrimarySources({ symbol, tradeDate }):
 *   - `.T` で終わる → 日本株（EDINET）。それ以外の英字 → 米国株（SEC EDGAR）。どちらでもない → empty
 *   - 窓は買った日の前後 30 暦日（未来側は今日で打ち切り）
 *   - 並びは **公開日昇順・同日は uid 昇順**。上限 20 件（切った件数を truncated に）。URL が表示用ホストでない件は落とす
 *   - 0 件なら empty。取得の失敗は failed（**empty に化けさせない**）
 *
 * AI を使わない・利用者の文章を送らない・要約しない。並びと中身はここ（finalizeSources）で確定し、画面側は並べ替えも絞り込みもしない。
 * 純関数（windowAround・finalizeSources・marketOf）と取得（getPrimarySources）を分け、検査は純関数を実際に呼ぶ。
 */
import { isRenderableSourceUrl } from './allowlist'
import { fetchEdinetSources } from './edinet'
import { fetchSecSources } from './sec'
import { defaultCache, type SourceCache } from './store'
import type { PrimarySourceItem, PrimarySourceResult } from './types'

export type { PrimarySourceItem, PrimarySourceResult, PrimarySourceStatus } from './types'

/** 窓の片側の日数（暦日） */
export const DEFAULT_WINDOW_DAYS = 30
/** 一覧の上限 */
export const MAX_ITEMS = 20

export type Market = { kind: 'jp'; code4: string } | { kind: 'us'; ticker: string } | { kind: 'none' }

/** 銘柄の記法から市場を決める（純関数）。7203.T → jp／AAPL・BRK-B・BF.B → us／それ以外 → none */
export function marketOf(symbol: string): Market {
  const s = symbol.trim().toUpperCase()
  const jp = /^([0-9][0-9A-Z]{3})\.T$/.exec(s)
  if (jp) return { kind: 'jp', code4: jp[1] }
  if (/^[A-Z][A-Z0-9.-]{0,9}$/.test(s) && !s.includes('.T')) return { kind: 'us', ticker: s }
  return { kind: 'none' }
}

const DAY_MS = 86_400_000

/** ミリ秒 → YYYY-MM-DD（UTC） */
export function isoDay(ms: number): string {
  return new Date(ms).toISOString().split('T')[0]
}

function shiftDay(day: string, days: number): string {
  return isoDay(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS)
}

/** 買った日の前後 windowDays 暦日。未来側は today で打ち切り（純関数） */
export function windowAround(tradeDate: string, windowDays: number, today: string): { from: string; to: string } {
  const from = shiftDay(tradeDate, -windowDays)
  const toRaw = shiftDay(tradeDate, windowDays)
  return { from, to: toRaw < today ? toRaw : today }
}

/**
 * 集めた件を **決定的な順** に並べ、窓の外・表示できない URL・uid の無い件・重複を落とし、上限で切る（純関数）。
 * 入力の順序に依らず同じ結果になる（並びは publishedAt → uid の文字列比較。locale に依らない）。
 */
export function finalizeSources(
  raw: PrimarySourceItem[],
  opts: { windowFrom: string; windowTo: string; fetchedAt: string; browseAllUrl: string | null; limit?: number },
): PrimarySourceResult {
  const limit = opts.limit ?? MAX_ITEMS
  const seen = new Set<string>()
  const kept: PrimarySourceItem[] = []
  for (const it of raw) {
    if (!it || typeof it.uid !== 'string' || it.uid === '') continue
    if (typeof it.url !== 'string' || !isRenderableSourceUrl(it.url)) continue
    if (typeof it.publishedAt !== 'string' || it.publishedAt < opts.windowFrom || it.publishedAt > opts.windowTo) continue
    const key = `${it.source}:${it.uid}`
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(it)
  }
  kept.sort((a, b) => {
    if (a.publishedAt !== b.publishedAt) return a.publishedAt < b.publishedAt ? -1 : 1
    if (a.uid !== b.uid) return a.uid < b.uid ? -1 : 1
    return 0
  })
  const items: PrimarySourceItem[] = []
  for (const it of kept) {
    if (items.length >= limit) break
    items.push(it)
  }
  const browseAllUrl = opts.browseAllUrl && isRenderableSourceUrl(opts.browseAllUrl) ? opts.browseAllUrl : null
  return {
    status: items.length > 0 ? 'ok' : 'empty',
    items,
    truncated: Math.max(0, kept.length - items.length),
    fetchedAt: opts.fetchedAt,
    windowFrom: opts.windowFrom,
    windowTo: opts.windowTo,
    browseAllUrl,
  }
}

/** 失敗の結果（空に化けさせない。items は空のまま・status は failed） */
export function failedResult(window: { from: string; to: string }, fetchedAt: string): PrimarySourceResult {
  return { status: 'failed', items: [], truncated: 0, fetchedAt, windowFrom: window.from, windowTo: window.to, browseAllUrl: null }
}

export interface GetPrimarySourcesOptions {
  symbol: string
  /** 買った日 YYYY-MM-DD */
  tradeDate: string
  windowDays?: number
}

/** 取得の差し込み口（検査・手元の確認用）。製品コードは既定のまま */
export interface GetPrimarySourcesDeps {
  fetch?: typeof fetch
  cache?: SourceCache
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  env?: { SEC_CONTACT_EMAIL?: string; EDINET_API_KEY?: string }
}

const realSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** 発行会社の一次情報の一覧を取る。失敗したときの理由はサーバーのログ（console.error）にだけ出す */
export async function getPrimarySources(opts: GetPrimarySourcesOptions, deps: GetPrimarySourcesDeps = {}): Promise<PrimarySourceResult> {
  const now = deps.now ?? (() => Date.now())
  const fetchedAt = new Date(now()).toISOString()
  const today = isoDay(now())
  const window = windowAround(opts.tradeDate, opts.windowDays ?? DEFAULT_WINDOW_DAYS, today)
  const market = marketOf(opts.symbol)
  if (market.kind === 'none') return finalizeSources([], { windowFrom: window.from, windowTo: window.to, fetchedAt, browseAllUrl: null })

  const env = deps.env ?? process.env
  const common = { fetch: deps.fetch ?? fetch, cache: deps.cache ?? defaultCache(), now }

  const r = market.kind === 'us'
    ? await fetchSecSources(market.ticker, window, { ...common, contactEmail: env.SEC_CONTACT_EMAIL })
    : await fetchEdinetSources(market.code4, window, today, { ...common, sleep: deps.sleep ?? realSleep, apiKey: env.EDINET_API_KEY })

  if (r.status === 'failed') {
    console.error(`[primary-sources] ${opts.symbol} の一次情報を取得できなかった: ${r.error}`)
    return failedResult(window, fetchedAt)
  }
  return finalizeSources(r.items, { windowFrom: window.from, windowTo: window.to, fetchedAt, browseAllUrl: r.browseAllUrl })
}
