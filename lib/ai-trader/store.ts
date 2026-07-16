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

// ── tickロック（二重実行防止）────────────────────────────────────────────
// 自動tick（cron）と手動tickが同一セッションで同時に走ると、last-write-winsで
// 学習・売買状態が巻き戻る事故になる。短命リース（TTL）でクリティカルセクションを守る。
// Supabase経路: ai_sessions.lock_until timestamptz を条件付き更新でリース取得。
// ローカル（ファイルstore）経路: data/locks/<id>.lock に until ISO を書きTTL＋所有者判定に使う。
//
// リーストークン方式: 取得成功時は「そのリースの lock_until ISO文字列」をトークンとして返す。
// release は自分のトークンと一致する行/ファイルだけを解放する（他者リースを消さない）。
// カラム未追加のdegraded時は特別トークン 'degraded' を返す（実行はするがロックは無効）。
const LOCK_DIR = path.join(process.cwd(), 'data', 'locks')
export const DEGRADED_LOCK_TOKEN = 'degraded'

/**
 * ロック取得を試みる。
 * @returns 取得成功: リーストークン(lock_untilのISO文字列) / 既ロックで失敗: null /
 *          カラム未追加のdegraded: 'degraded'（truthyなので実行はする、ロックは無効）。
 */
export async function tryAcquireTickLock(id: string, ttlMs: number): Promise<string | null> {
  if (hasServiceRole()) {
    const nowMs = Date.now()
    const nowISO = new Date(nowMs).toISOString()
    const untilISO = new Date(nowMs + ttlMs).toISOString()
    try {
      const { data, error } = await getAdminClient()
        .from(TABLE)
        .update({ lock_until: untilISO })
        .eq('id', id)
        .or(`lock_until.is.null,lock_until.lt.${nowISO}`)
        .select('id')
      if (error) {
        // カラム未追加など: ロック機能を無効化し、tick自体は通す（degraded）
        console.warn(`[tickLock] acquire degraded (lock disabled): ${error.message}`)
        return DEGRADED_LOCK_TOKEN
      }
      return (data?.length ?? 0) > 0 ? untilISO : null
    } catch (e) {
      console.warn(`[tickLock] acquire threw (lock disabled): ${e instanceof Error ? e.message : String(e)}`)
      return DEGRADED_LOCK_TOKEN
    }
  }
  // ファイルstore（ローカル）
  try {
    fs.mkdirSync(LOCK_DIR, { recursive: true })
    const lockPath = path.join(LOCK_DIR, `${id}.lock`)
    if (fs.existsSync(lockPath)) {
      const age = Date.now() - fs.statSync(lockPath).mtimeMs
      if (age < ttlMs) return null // 有効なロックが存在 → 取得失敗
    }
    const untilISO = new Date(Date.now() + ttlMs).toISOString()
    fs.writeFileSync(lockPath, untilISO)
    return untilISO
  } catch (e) {
    console.warn(`[tickLock] file acquire failed (lock disabled): ${e instanceof Error ? e.message : String(e)}`)
    return DEGRADED_LOCK_TOKEN
  }
}

/**
 * ロックを解放する。取得時に受け取ったトークンを渡し、自分のリースだけを解放する。
 * token が 'degraded' の場合は何もしない（そもそもロックを取っていない）。
 */
export async function releaseTickLock(id: string, token: string): Promise<void> {
  if (token === DEGRADED_LOCK_TOKEN) return
  if (hasServiceRole()) {
    try {
      // 自分のリース(lock_until===token)だけを解放。他者が既に奪ったリースは消さない。
      const { error } = await getAdminClient()
        .from(TABLE)
        .update({ lock_until: null })
        .eq('id', id)
        .eq('lock_until', token)
      if (error) console.warn(`[tickLock] release degraded: ${error.message}`)
    } catch (e) {
      console.warn(`[tickLock] release threw: ${e instanceof Error ? e.message : String(e)}`)
    }
    return
  }
  try {
    const lockPath = path.join(LOCK_DIR, `${id}.lock`)
    // 自分のトークンが書かれている時だけ削除（他者が上書き取得したロックは消さない）。
    if (fs.existsSync(lockPath) && fs.readFileSync(lockPath, 'utf8') === token) {
      fs.unlinkSync(lockPath)
    }
  } catch { /* non-critical */ }
}
