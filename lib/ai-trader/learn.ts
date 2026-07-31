// 学習ループ（サーバー側の内省・学習生成）のオーケストレーション。
// cron（GitHub Actions）から叩かれ、tickが積んだ売買結果をもとにClaudeで学習を生成し
// session.learning に蓄積する。runTick・callClaude 本体には一切手を入れない。
//
// なぜtickから分離したか(2026-07-31): 学習はtick内で2回目のClaude呼び出しになり、
// (a)売買判断が終わった後にcron/tickのTIME_BUDGET_MS(50秒)を食い潰して応答が
// `reason:"timeout"`と誤報される、(b)runTickの最終upsertSessionが学習の後ろにあるため
// 学習の遅延が売買結果の保存まで道連れにする、という2つの問題を起こしていた。
// tickは「売買判断1回だけ」に保ち、学習は独立した60秒枠で回す。
import {
  getSession, listSessions, upsertSession,
  tryAcquireTickLock, releaseTickLock, DEGRADED_LOCK_TOKEN,
} from './store'
import { generateFullLearning, type AISession } from './engine'
import { normalizeLearningMemory, shouldLearnNow } from './memory'

// 1回の学習の最大所要（Claude 1呼び出し）を包む短命リース。tick側と同じ長さに揃える。
const LOCK_TTL_MS = 5 * 60_000

export type LearnResult = {
  learned: boolean
  reason?: string
  session?: AISession
  lockDegraded?: boolean
}

/**
 * 1セッションに対して学習を実行する。
 * disabled / nothing_to_learn / locked / not_found / empty の場合は learned:false を返す。
 *
 * 整合性の要点:
 * - **tickと同じロック(tryAcquireTickLock)を取る**。upsertSessionはセッション全体を
 *   last-write-winsで置換するため、学習中（Claudeで数十秒）にtickが走ると、tickが実行した
 *   売買結果を学習側の古いスナップショットで上書きして消してしまう。このロックはその
 *   相互排他のためにあり、「学習は別テーブルだから不要」ではない（同一 ai_sessions 行を書く）。
 * - 権威的な判定は「ロック取得後に読み直したfreshセッション」で行う（TOCTOU回避）。
 *   事前チェックはロックの無駄取得を減らすためだけの最適化。
 * - 生成が空だった場合は lastLearnTickCount を進めず、次回cronで再挑戦する
 *   （tick内にあった頃と同じ意味論を維持）。
 */
export async function runLearnTick(sessionId: string): Promise<LearnResult> {
  const pre = await getSession(sessionId)
  if (!pre) return { learned: false, reason: 'not_found' }
  if (!pre.auto?.enabled) return { learned: false, reason: 'disabled' }
  if (!shouldLearnNow(normalizeLearningMemory(pre.learning), pre.tickCount)) {
    return { learned: false, reason: 'nothing_to_learn' }
  }

  const token = await tryAcquireTickLock(sessionId, LOCK_TTL_MS)
  if (!token) return { learned: false, reason: 'locked' }
  const lockDegraded = token === DEGRADED_LOCK_TOKEN

  try {
    const fresh = await getSession(sessionId)
    if (!fresh) return { learned: false, reason: 'not_found', lockDegraded }
    if (!fresh.auto?.enabled) return { learned: false, reason: 'disabled', lockDegraded }
    // 旧フォーマット（入れ子配列の欠損）でも落ちないよう、runTickと同じ正規化を通す。
    fresh.learning = normalizeLearningMemory(fresh.learning)
    if (!shouldLearnNow(fresh.learning, fresh.tickCount)) {
      return { learned: false, reason: 'nothing_to_learn', lockDegraded }
    }

    const fl = await generateFullLearning(fresh.learning, fresh)
    if (fl.lessons.length === 0 && fl.fundamentalInsights.length === 0) {
      return { learned: false, reason: 'empty', lockDegraded }
    }

    // 新しい洞察を先頭に、既存とマージして上限で切る（tick内にあった頃と同じ配分）。
    fresh.learning.lessons             = [...fl.lessons,             ...fresh.learning.lessons].slice(0, 15)
    fresh.learning.fundamentalInsights = [...fl.fundamentalInsights, ...fresh.learning.fundamentalInsights].slice(0, 10)
    fresh.learning.newsInsights        = [...fl.newsInsights,        ...fresh.learning.newsInsights].slice(0, 10)
    fresh.learning.causalChains        = [...fl.causalChains,        ...fresh.learning.causalChains].slice(0, 10)
    fresh.learning.tradingBiases       = [...fl.tradingBiases,       ...fresh.learning.tradingBiases].slice(0, 8)
    fresh.learning.strategyNotes       = fl.strategyNotes  // 最新の戦略で置き換える
    fresh.learning.lastLearnTickCount  = fresh.tickCount

    await upsertSession(fresh)
    return { learned: true, session: fresh, lockDegraded }
  } finally {
    await releaseTickLock(sessionId, token)
  }
}

/**
 * 学習対象を選ぶ。auto.enabled かつ shouldLearnNow を満たすものを、
 * 学習が最も遅れている順（tickCount と lastLearnTickCount の差が大きい順）で最大max件。
 */
export async function listLearnTargets(max = 3): Promise<AISession[]> {
  const all = await listSessions()
  const lag = (s: AISession) =>
    s.tickCount - normalizeLearningMemory(s.learning).lastLearnTickCount
  return all
    .filter(s => s.auto?.enabled && shouldLearnNow(normalizeLearningMemory(s.learning), s.tickCount))
    .sort((a, b) => lag(b) - lag(a))
    .slice(0, max)
}
