// S5c-1: ユニバース・ファンダメンタルのキャッシュI/O層（土台のみ）。
// lib/ai-trader/store.ts と同じ確立パターン: SUPABASE_SERVICE_ROLE_KEY があれば
// Supabase の universe_fundamentals テーブルが正。未設定（ローカル開発）は
// data/universe-fundamentals.json へのファイルstoreへフォールバック。
// screen API・cron・UIはこのスライスでは作らない（後続 S5a / S5c-2 / S5b）。
//
// store.tsとの唯一の差分: '@/lib/supabase/admin' は `import 'server-only'` を含み、
// 静的importするとtsx（プレーンNode実行・スモークテスト用）から読めなくなる
// （scripts/seed-sessions.tsのコメントと同じ既存制約）。そのためhasServiceRole()は
// server-onlyを含まない共有モジュール '@/lib/supabase/env' から読み、getAdminClient()は
// 実際にSupabase経路へ入る時だけ動的importする（Next.jsサーバー内では動的importでも
// 同じくバンドラがserver-onlyを正しく解決するため挙動は同一）。
import fs from 'fs'
import path from 'path'
import { hasServiceRole } from '@/lib/supabase/env'
import type { CachedFundamentalRow } from './types'

const TABLE = 'universe_fundamentals'
const STORE_PATH = path.join(process.cwd(), 'data', 'universe-fundamentals.json')

async function getClient() {
  const { getAdminClient } = await import('@/lib/supabase/admin')
  return getAdminClient()
}

// ── ファイルstore（ローカル開発フォールバック）───────────────────────────
function loadFileStore(): Map<string, CachedFundamentalRow> {
  try {
    if (!fs.existsSync(STORE_PATH)) return new Map()
    const raw = fs.readFileSync(STORE_PATH, 'utf8')
    const arr: CachedFundamentalRow[] = JSON.parse(raw)
    return new Map(arr.map(r => [r.symbol, r]))
  } catch {
    return new Map()
  }
}

function saveFileStore(map: Map<string, CachedFundamentalRow>) {
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true })
    fs.writeFileSync(STORE_PATH, JSON.stringify(Array.from(map.values()), null, 0))
  } catch { /* non-critical */ }
}

type DbRow = { symbol: string; metrics: unknown; source: string; fetched_at: string }

function rowFromDb(data: DbRow): CachedFundamentalRow {
  return {
    symbol:    data.symbol,
    metrics:   (data.metrics ?? {}) as CachedFundamentalRow['metrics'],
    source:    data.source,
    fetchedAt: data.fetched_at,
  }
}

// ── 公開API（全てasync。Supabaseが正、無ければファイル）─────────────────
export async function getCached(symbol: string): Promise<CachedFundamentalRow | undefined> {
  if (hasServiceRole()) {
    const client = await getClient()
    const { data, error } = await client
      .from(TABLE)
      .select('symbol, metrics, source, fetched_at')
      .eq('symbol', symbol)
      .maybeSingle()
    if (error) throw new Error(`universe_fundamentals read failed: ${error.message}`)
    return data ? rowFromDb(data as DbRow) : undefined
  }
  return loadFileStore().get(symbol)
}

export async function listCached(): Promise<CachedFundamentalRow[]> {
  if (hasServiceRole()) {
    const client = await getClient()
    const { data, error } = await client
      .from(TABLE)
      .select('symbol, metrics, source, fetched_at')
    if (error) throw new Error(`universe_fundamentals list failed: ${error.message}`)
    return (data ?? []).map(row => rowFromDb(row as DbRow))
  }
  return Array.from(loadFileStore().values())
}

/**
 * キャッシュ行をupsertする。no_data相当（metricsが空オブジェクト）は架空データ補完の
 * 温床になるため保存を拒否する（COMPANY.md 原則9）。呼び出し側（seedスクリプト等）は
 * 事前にスキップするのが基本だが、ここでも二重にガードする。
 */
export async function upsertCached(row: CachedFundamentalRow): Promise<void> {
  if (!row.metrics || Object.keys(row.metrics).length === 0) {
    throw new Error(`upsertCached refused: ${row.symbol} has no_data ({}) — 原則9で架空データ禁止`)
  }
  if (hasServiceRole()) {
    const client = await getClient()
    const { error } = await client
      .from(TABLE)
      .upsert({
        symbol:     row.symbol,
        metrics:    row.metrics,
        source:     row.source,
        fetched_at: row.fetchedAt,
      })
    if (error) throw new Error(`universe_fundamentals upsert failed: ${error.message}`)
    return
  }
  const map = loadFileStore()
  map.set(row.symbol, row)
  saveFileStore(map)
}

/** fetched_at昇順でn件（＝最も古い＝再取得すべき対象）を返す。S5c-2以降のcronが使う想定。 */
export async function listStaleTargets(n: number): Promise<CachedFundamentalRow[]> {
  if (hasServiceRole()) {
    const client = await getClient()
    const { data, error } = await client
      .from(TABLE)
      .select('symbol, metrics, source, fetched_at')
      .order('fetched_at', { ascending: true })
      .limit(n)
    if (error) throw new Error(`universe_fundamentals listStaleTargets failed: ${error.message}`)
    return (data ?? []).map(row => rowFromDb(row as DbRow))
  }
  return Array.from(loadFileStore().values())
    .sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt))
    .slice(0, n)
}
