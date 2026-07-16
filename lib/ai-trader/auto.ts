// 自律学習ループ（サーバー側の自動tick）のオーケストレーション。
// cron（GitHub Actions / Vercel cron）から叩かれ、auto.enabled=true のセッションを
// 日次上限つき・ロック付きで runTick する。runTick 本体・callClaude 経路には一切手を入れない。
import {
  getSession, listSessions, upsertSession,
  tryAcquireTickLock, releaseTickLock, DEGRADED_LOCK_TOKEN,
} from './store'
import { runTick, type AISession } from './engine'

const DAILY_LIMIT = 3
const LOCK_TTL_MS = 5 * 60_000 // 1tickの最大所要（データ取得+Claude）を包む短命リース

/** NY市場日付（YYYY-MM-DD）。取引日の境界に合わせて日次カウンタをリセットするため。 */
function nyDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
}

/** そのセッションの当日自動tick回数（date が今日でなければ0扱い）。 */
function countForToday(session: AISession, today: string): number {
  const a = session.auto
  if (!a) return 0
  return a.date === today ? a.count : 0
}

/**
 * 1セッションに対して自動tickを実行する。
 * disabled / daily_limit / locked / not_found の場合は ran:false を返し、runTick は呼ばない。
 *
 * 整合性の要点:
 * - 日次上限の権威的チェックは「ロック取得後に読み直したfreshセッション」で行う（TOCTOU回避）。
 *   事前の軽いチェックはロックの無駄取得を減らすためだけの最適化。
 * - count+1 は runTick を呼ぶ「前」に先行保存する。タイムアウト/失敗時も1回消費扱いにし、
 *   実行済みなのに未加算で上限超過する事故（過剰実行）を防ぐ（過少実行側に倒す）。
 */
export async function runAutoTick(
  sessionId: string
): Promise<{ ran: boolean; reason?: string; session?: AISession; lockDegraded?: boolean }> {
  const pre = await getSession(sessionId)
  if (!pre) return { ran: false, reason: 'not_found' }
  if (!pre.auto?.enabled) return { ran: false, reason: 'disabled' }

  const today = nyDate()
  // 事前チェック（ロック無駄取得回避の最適化。権威的判断はロック取得後に行う）。
  if (countForToday(pre, today) >= DAILY_LIMIT) return { ran: false, reason: 'daily_limit' }

  const token = await tryAcquireTickLock(sessionId, LOCK_TTL_MS)
  if (!token) return { ran: false, reason: 'locked' }
  const lockDegraded = token === DEGRADED_LOCK_TOKEN

  try {
    // ロック取得後に読み直し、freshなセッションで上限を権威的に再チェック（TOCTOU回避）。
    const fresh = await getSession(sessionId)
    if (!fresh) return { ran: false, reason: 'not_found', lockDegraded }
    if (!fresh.auto?.enabled) return { ran: false, reason: 'disabled', lockDegraded }
    const cnt = countForToday(fresh, today)
    if (cnt >= DAILY_LIMIT) return { ran: false, reason: 'daily_limit', lockDegraded }

    // count+1 を runTick の前に先行保存（失敗/タイムアウトでも1回消費扱い＝過少実行側）。
    fresh.auto = { enabled: true, date: today, count: cnt + 1 }
    await upsertSession(fresh)

    // runTick は auto を触らずセッション全体を upsert するので count は保持される。
    await runTick(sessionId)
    const latest = await getSession(sessionId)
    return { ran: true, session: latest, lockDegraded }
  } finally {
    await releaseTickLock(sessionId, token)
  }
}

/**
 * 自動tick対象を選ぶ。auto.enabled かつ 当日count<上限 のものを lastTickAt 昇順（古い順）で最大max件。
 * 古いセッションを優先することで、全セッションが均等に前進する。
 */
export async function listAutoTickTargets(max = 5): Promise<AISession[]> {
  const today = nyDate()
  const all = await listSessions()
  return all
    .filter(s => {
      if (!s.auto?.enabled) return false
      const todayCount = s.auto.date === today ? s.auto.count : 0
      return todayCount < DAILY_LIMIT
    })
    .sort((a, b) => (a.lastTickAt ?? '').localeCompare(b.lastTickAt ?? ''))
    .slice(0, max)
}
