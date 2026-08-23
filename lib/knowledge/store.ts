// S1: 知識ストアのI/O層。
// lib/ai-trader/store.ts / lib/screen/cache.ts と同じ確立パターン:
// SUPABASE_SERVICE_ROLE_KEY があれば Supabase の knowledge_items テーブルが正。
// 未設定（ローカル開発）は data/knowledge.json へのファイルstoreへフォールバック。
//
// '@/lib/supabase/admin' は `import 'server-only'` を含み静的importするとtsx
// （scripts/sync-knowledge.ts のようなプレーンNode実行）から読めなくなるため、
// hasServiceRole() は server-only を含まない '@/lib/supabase/env' から読み、
// getAdminClient() は実際にSupabase経路へ入る時だけ動的importする（cache.tsと同じ制約）。
import fs from 'fs'
import path from 'path'
import { hasServiceRole } from '@/lib/supabase/env'
import type { KnowledgeItem, KnowledgeQuery } from './types'

const TABLE = 'knowledge_items'
const STORE_PATH = path.join(process.cwd(), 'data', 'knowledge.json')

async function getClient() {
  const { getAdminClient } = await import('@/lib/supabase/admin')
  return getAdminClient()
}

// ── ファイルstore（ローカル開発フォールバック）───────────────────────────
function loadFileStore(): Map<string, KnowledgeItem> {
  try {
    if (!fs.existsSync(STORE_PATH)) return new Map()
    const arr: KnowledgeItem[] = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'))
    return new Map(arr.map(r => [r.id, r]))
  } catch {
    return new Map()
  }
}

function saveFileStore(map: Map<string, KnowledgeItem>) {
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true })
    fs.writeFileSync(STORE_PATH, JSON.stringify(Array.from(map.values()), null, 0))
  } catch { /* non-critical */ }
}

type DbRow = {
  id: string
  scope: string
  session_id: string | null
  kind: string
  title: string
  summary: string
  detail: string | null
  source: string | null
  tags: string[] | null
  use_count: number
  last_used_at: string | null
  created_at: string
  updated_at: string
}

const COLS =
  'id, scope, session_id, kind, title, summary, detail, source, tags, use_count, last_used_at, created_at, updated_at'

function rowFromDb(d: DbRow): KnowledgeItem {
  return {
    id:         d.id,
    scope:      d.scope as KnowledgeItem['scope'],
    sessionId:  d.session_id,
    kind:       d.kind as KnowledgeItem['kind'],
    title:      d.title,
    summary:    d.summary,
    detail:     d.detail,
    source:     d.source,
    tags:       d.tags ?? [],
    useCount:   d.use_count,
    lastUsedAt: d.last_used_at,
    createdAt:  d.created_at,
    updatedAt:  d.updated_at,
  }
}

function rowToDb(i: KnowledgeItem) {
  return {
    id:           i.id,
    scope:        i.scope,
    session_id:   i.sessionId ?? null,
    kind:         i.kind,
    title:        i.title,
    summary:      i.summary,
    detail:       i.detail ?? null,
    source:       i.source ?? null,
    tags:         i.tags,
    use_count:    i.useCount,
    last_used_at: i.lastUsedAt ?? null,
    created_at:   i.createdAt,
    updated_at:   i.updatedAt,
  }
}

// ── 公開API（全てasync。Supabaseが正、無ければファイル）─────────────────

/** 条件に合う知識を新しい順で返す。プロンプト注入・UI表示の共通入口。 */
export async function listKnowledge(q: KnowledgeQuery = {}): Promise<KnowledgeItem[]> {
  if (hasServiceRole()) {
    const client = await getClient()
    let query = client.from(TABLE).select(COLS)
    if (q.scope)     query = query.eq('scope', q.scope)
    if (q.sessionId) query = query.eq('session_id', q.sessionId)
    if (q.kind)      query = query.eq('kind', q.kind)
    query = query.order('updated_at', { ascending: false })
    if (q.limit)     query = query.limit(q.limit)
    const { data, error } = await query
    if (error) throw new Error(`knowledge_items list failed: ${error.message}`)
    return ((data ?? []) as unknown as DbRow[]).map(rowFromDb)
  }
  let items = Array.from(loadFileStore().values())
  if (q.scope)     items = items.filter(i => i.scope === q.scope)
  if (q.sessionId) items = items.filter(i => i.sessionId === q.sessionId)
  if (q.kind)      items = items.filter(i => i.kind === q.kind)
  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return q.limit ? items.slice(0, q.limit) : items
}

export async function getKnowledge(id: string): Promise<KnowledgeItem | undefined> {
  if (hasServiceRole()) {
    const client = await getClient()
    const { data, error } = await client.from(TABLE).select(COLS).eq('id', id).maybeSingle()
    if (error) throw new Error(`knowledge_items read failed: ${error.message}`)
    return data ? rowFromDb(data as unknown as DbRow) : undefined
  }
  return loadFileStore().get(id)
}

/** IDで冪等にupsertする。同期スクリプト・自動蓄積の共通の書き込み口。 */
export async function upsertKnowledge(items: KnowledgeItem[]): Promise<void> {
  if (items.length === 0) return
  if (hasServiceRole()) {
    const client = await getClient()
    const { error } = await client.from(TABLE).upsert(items.map(rowToDb))
    if (error) throw new Error(`knowledge_items upsert failed: ${error.message}`)
    return
  }
  const map = loadFileStore()
  for (const i of items) map.set(i.id, i)
  saveFileStore(map)
}

/**
 * 使われた知識の利用回数を加算する（帰属記録の集計・S5の圧縮で退避判断に使う）。
 * 判断のhot pathから呼ばれるため、失敗しても呼び出し側を壊さない（warnして続行）。
 */
export async function recordKnowledgeUsage(ids: string[]): Promise<void> {
  const uniq = Array.from(new Set(ids)).filter(Boolean)
  if (uniq.length === 0) return
  const nowISO = new Date().toISOString()
  try {
    if (hasServiceRole()) {
      const client = await getClient()
      // 件数が小さい（1判断で数件）ため、素直に読み→加算→upsertで済ませる。
      const { data, error } = await client.from(TABLE).select(COLS).in('id', uniq)
      if (error) throw new Error(error.message)
      const rows = ((data ?? []) as unknown as DbRow[]).map(rowFromDb)
      if (rows.length === 0) return
      const bumped = rows.map(r => ({ ...r, useCount: r.useCount + 1, lastUsedAt: nowISO }))
      const { error: upErr } = await client.from(TABLE).upsert(bumped.map(rowToDb))
      if (upErr) throw new Error(upErr.message)
      return
    }
    const map = loadFileStore()
    for (const id of uniq) {
      const cur = map.get(id)
      if (cur) map.set(id, { ...cur, useCount: cur.useCount + 1, lastUsedAt: nowISO })
    }
    saveFileStore(map)
  } catch (e) {
    console.warn(`[knowledge] usage record failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}
