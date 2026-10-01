/**
 * 一次情報の一覧の **保存と読み出し**（S3c・2026-10-01）。表は supabase/migrations/0010_primary_sources.sql。
 *
 * 作法は lib/ai-trader/decision-store.ts と同じ:
 *   - '@/lib/supabase/admin' は `import 'server-only'` を含むので静的 import せず、`adminLoader` で実際に Supabase 経路へ入る時だけ動的 import
 *     （tsx の検査 scripts/check-primary-sources.ts から純関数部分を読めるようにするため）。hasServiceRole() は server-only を含まない env から読む
 *   - 投げない。表が無い（0010 未実行）ときは { ok:false, reason:'missing-table' } で静かに戻す（エラーコードは decision-store の MISSING_TABLE_CODES と同じ）
 *   - 失敗は console.error を1行だけ
 *
 * 2つの表:
 *   review_primary_sources ... 1記録1行。開いた最初の1回だけ解決して凍結（API ルートが「保存済みがあればそれを返す」で担保）
 *   primary_source_cache   ... 取得元の生データの控え（SEC は CIK ごと・EDINET は日付ごと）。失敗の控えは 24 時間で捨てる
 */
import { hasServiceRole } from '@/lib/supabase/env'
import type { PrimarySourceItem, PrimarySourceResult, PrimarySourceStatus } from './types'

export const PRIMARY_SOURCES_TABLE = 'review_primary_sources'
export const PRIMARY_SOURCE_CACHE_TABLE = 'primary_source_cache'
/** 「表が無い」のときに Supabase が返すコード（decision-store.ts の MISSING_TABLE_CODES と同じ2つ） */
export const MISSING_TABLE_CODES: ReadonlySet<string> = new Set(['42P01', 'PGRST205'])
/** 1回の読み書きに許す時間 */
export const STORE_TIMEOUT_MS = 8_000
/** 失敗の控えを信じる時間（これを過ぎたら取り直す） */
export const FAILED_CACHE_TTL_MS = 24 * 60 * 60 * 1000

/** admin クライアントの読み込み方（検査用の差し込み口。製品コードは既定のまま） */
export const adminLoader = { load: () => import('@/lib/supabase/admin') }

export type LoadResult =
  | { ok: true; result: PrimarySourceResult | null }
  | { ok: false; reason: 'no-service-role' | 'missing-table' | 'error'; error?: string }

export type SaveResult =
  | { ok: true }
  | { ok: false; reason: 'no-service-role' | 'missing-table' | 'error'; error?: string }

/** review_primary_sources の1行（列名は SQL と同じ snake_case） */
interface SourcesRow {
  user_id: string
  record_id: string
  status: PrimarySourceStatus
  items: PrimarySourceItem[]
  truncated: number
  fetched_at: string
  window_from: string
  window_to: string
  browse_all_url: string | null
}

const isStatus = (v: unknown): v is PrimarySourceStatus => v === 'ok' || v === 'empty' || v === 'failed'

/** 行 → 結果（純関数）。壊れた行は null（作り直さない） */
export function rowToResult(row: Partial<SourcesRow> | null | undefined): PrimarySourceResult | null {
  if (!row || !isStatus(row.status) || !Array.isArray(row.items)) return null
  if (typeof row.fetched_at !== 'string' || typeof row.window_from !== 'string' || typeof row.window_to !== 'string') return null
  return {
    status: row.status,
    items: row.items,
    truncated: typeof row.truncated === 'number' && Number.isFinite(row.truncated) ? row.truncated : 0,
    fetchedAt: row.fetched_at,
    windowFrom: row.window_from,
    windowTo: row.window_to,
    browseAllUrl: typeof row.browse_all_url === 'string' ? row.browse_all_url : null,
  }
}

function errorToReason(code: string | undefined, message: string): { reason: 'missing-table' | 'error'; error: string } {
  return { reason: code && MISSING_TABLE_CODES.has(code) ? 'missing-table' : 'error', error: message }
}

/** 保存済みの一覧を読む。無ければ result:null。表が無ければ missing-table */
export async function loadPrimarySources(userId: string, recordId: string): Promise<LoadResult> {
  if (!hasServiceRole()) return { ok: false, reason: 'no-service-role' }
  try {
    const { getAdminClient } = await adminLoader.load()
    const { data, error } = await getAdminClient()
      .from(PRIMARY_SOURCES_TABLE)
      .select('user_id, record_id, status, items, truncated, fetched_at, window_from, window_to, browse_all_url')
      .eq('user_id', userId)
      .eq('record_id', recordId)
      .abortSignal(AbortSignal.timeout(STORE_TIMEOUT_MS))
      .maybeSingle()
    if (error) {
      const r = errorToReason(error.code, error.message)
      if (r.reason !== 'missing-table') console.error(`[primary-sources] 読み出しに失敗: ${error.message}`)
      return { ok: false, ...r }
    }
    return { ok: true, result: rowToResult(data as Partial<SourcesRow> | null) }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error(`[primary-sources] 読み出しに失敗: ${message}`)
    return { ok: false, reason: 'error', error: message }
  }
}

/** 一覧を保存する（同じ (user_id, record_id) があれば上書き。API ルート側が「保存済みなら解決しない」ので実質1回） */
export async function savePrimarySources(userId: string, recordId: string, result: PrimarySourceResult): Promise<SaveResult> {
  if (!hasServiceRole()) return { ok: false, reason: 'no-service-role' }
  try {
    const row: SourcesRow = {
      user_id: userId,
      record_id: recordId,
      status: result.status,
      items: result.items,
      truncated: result.truncated,
      fetched_at: result.fetchedAt,
      window_from: result.windowFrom,
      window_to: result.windowTo,
      browse_all_url: result.browseAllUrl,
    }
    const { getAdminClient } = await adminLoader.load()
    const { error } = await getAdminClient()
      .from(PRIMARY_SOURCES_TABLE)
      .upsert(row, { onConflict: 'user_id,record_id' })
      .abortSignal(AbortSignal.timeout(STORE_TIMEOUT_MS))
    if (error) {
      const r = errorToReason(error.code, error.message)
      if (r.reason !== 'missing-table') console.error(`[primary-sources] 保存に失敗: ${error.message}`)
      return { ok: false, ...r }
    }
    return { ok: true }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error(`[primary-sources] 保存に失敗: ${message}`)
    return { ok: false, reason: 'error', error: message }
  }
}

// ── 取得元の生データの控え（best-effort。読めなくても書けなくても取得は続ける） ───────────────────────────

export type CacheEntry = { payload: unknown; fetchedAt: string }

/** 取得口（index.ts）が使う控えの口。検査ではメモリ実装に差し替える */
export interface SourceCache {
  get(source: 'sec' | 'edinet', key: string): Promise<CacheEntry | null>
  put(source: 'sec' | 'edinet', key: string, payload: unknown, fetchedAt: string): Promise<void>
}

/** 失敗の控えの形。これを payload に入れて 24 時間だけ信じる */
export type FailedPayload = { failed: true; error: string }
export const isFailedPayload = (p: unknown): p is FailedPayload =>
  typeof p === 'object' && p !== null && (p as { failed?: unknown }).failed === true

/** 何も覚えない控え（service-role が無いとき・検査の既定） */
export const noopCache: SourceCache = {
  async get() { return null },
  async put() { /* 覚えない */ },
}

/** Supabase の primary_source_cache を使う控え。表が無い・通信に失敗したら黙って「無い」と答える */
export const supabaseCache: SourceCache = {
  async get(source, key) {
    if (!hasServiceRole()) return null
    try {
      const { getAdminClient } = await adminLoader.load()
      const { data, error } = await getAdminClient()
        .from(PRIMARY_SOURCE_CACHE_TABLE)
        .select('payload, fetched_at')
        .eq('source', source)
        .eq('key', key)
        .abortSignal(AbortSignal.timeout(STORE_TIMEOUT_MS))
        .maybeSingle()
      if (error || !data) return null
      const d = data as { payload: unknown; fetched_at: string }
      return typeof d.fetched_at === 'string' ? { payload: d.payload, fetchedAt: d.fetched_at } : null
    } catch {
      return null
    }
  },
  async put(source, key, payload, fetchedAt) {
    if (!hasServiceRole()) return
    try {
      const { getAdminClient } = await adminLoader.load()
      const { error } = await getAdminClient()
        .from(PRIMARY_SOURCE_CACHE_TABLE)
        .upsert({ source, key, payload, fetched_at: fetchedAt }, { onConflict: 'source,key' })
        .abortSignal(AbortSignal.timeout(STORE_TIMEOUT_MS))
      if (error && !(error.code && MISSING_TABLE_CODES.has(error.code))) {
        console.error(`[primary-sources] 控えの保存に失敗（取得は続行）: ${error.message}`)
      }
    } catch (e) {
      console.error(`[primary-sources] 控えの保存に失敗（取得は続行）: ${e instanceof Error ? e.message : String(e)}`)
    }
  },
}

/** 既定の控え: service-role があれば Supabase、無ければ何も覚えない */
export function defaultCache(): SourceCache {
  return hasServiceRole() ? supabaseCache : noopCache
}
