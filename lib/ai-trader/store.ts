// AIセッションの永続化レイヤー（スライス1: Supabase JSONB blob移行）。
// SUPABASE_SERVICE_ROLE_KEY があれば Supabase の ai_sessions テーブルが正。
// キー未設定（ローカル開発）は従来のファイルstore（data/sessions.json）へフォールバック。
// callClaude() のAPI/CLIハイブリッドと同じ確立パターン。両者の同期はしない。
import fs from 'fs'
import path from 'path'
import { getAdminClient, hasServiceRole } from '@/lib/supabase/admin'
import type { AISession } from './engine'

const TABLE = 'ai_sessions'
const STORE_PATH = path.join(process.cwd(), 'data', 'sessions.json')

// ── ファイルstore（ローカル開発フォールバック）───────────────────────────
function loadFileStore(): Map<string, AISession> {
  try {
    if (!fs.existsSync(STORE_PATH)) return new Map()
    const raw = fs.readFileSync(STORE_PATH, 'utf8')
    const arr: AISession[] = JSON.parse(raw)
    return new Map(arr.map(s => [s.id, s]))
  } catch {
    return new Map()
  }
}

function saveFileStore(map: Map<string, AISession>) {
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true })
    fs.writeFileSync(STORE_PATH, JSON.stringify(Array.from(map.values()), null, 0))
  } catch { /* non-critical */ }
}

// ── 公開API（全てasync。Supabaseが正、無ければファイル）─────────────────
export async function getSession(id: string): Promise<AISession | undefined> {
  if (hasServiceRole()) {
    const { data, error } = await getAdminClient()
      .from(TABLE)
      .select('data')
      .eq('id', id)
      .maybeSingle()
    if (error) throw new Error(`ai_sessions read failed: ${error.message}`)
    return (data?.data as AISession | undefined) ?? undefined
  }
  return loadFileStore().get(id)
}

export async function listSessions(): Promise<AISession[]> {
  if (hasServiceRole()) {
    const { data, error } = await getAdminClient()
      .from(TABLE)
      .select('data')
      .order('started_at', { ascending: false })
    if (error) throw new Error(`ai_sessions list failed: ${error.message}`)
    return (data ?? []).map(row => row.data as AISession)
  }
  return Array.from(loadFileStore().values()).sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt)
  )
}

export async function upsertSession(session: AISession): Promise<void> {
  if (hasServiceRole()) {
    const { error } = await getAdminClient()
      .from(TABLE)
      .upsert({
        id:         session.id,
        data:       session,
        started_at: session.startedAt,
        // 最小の競合ガード: last-write-winsだが、いつのtickの状態かは追跡できるようにする
        updated_at: session.lastTickAt,
      })
    if (error) throw new Error(`ai_sessions upsert failed: ${error.message}`)
    return
  }
  const map = loadFileStore()
  map.set(session.id, session)
  saveFileStore(map)
}
