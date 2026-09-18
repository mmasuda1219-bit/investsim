import { NextResponse } from 'next/server'
import { listSessions, type AIDecision } from '@/lib/ai-trader/engine'
import type { InvestorId } from '@/types'

// GET /api/ai-session/latest — トップページの「直近の AI の判断3件」のためだけの軽い応答（2026-09-18）。
//
// 旧: トップページは GET /api/ai-session（全セッション・全判断・圧縮前 約520KB）を毎回読み、その中の最新セッションの
// decisions.slice(0, 3) だけを表示していた。スマホの遅い回線で取得しきれず、しかも失敗を「まだ記録が無い」と
// 偽って見せていた（DESIGN.md §6-12 違反）。この経路は «表示に使う分だけ» を返し、失敗は 502 で正直に返す。
//
// 応答（3つの形）:
//   記録あり（200）: { lastTickAt, tickCount, persona, decisions: [{ symbol, name, action, reasoning }] }  ← decisions は最大3件・4項目だけ
//   記録なし（200）: { lastTickAt: null, tickCount: 0, persona: null, decisions: [] }  ← セッションが無い／最新セッションの判断が0件。正常な状態
//   失敗（502）:     { error: <和文> }  ← listSessions() が投げた。原因の英語はサーバーのログにだけ残す（画面には出さない）
//
// 最新の選び方はトップページと同じ（lastTickAt が最も新しい1件。listSessions() の並び＝startedAt 降順には依らない）。
// persona は AISession.persona（InvestorId | undefined）を null に寄せて常に返す。読む側は null なら「特定の投資家の考え方は
// 使っていません」と出せる（app/watch/client.tsx の見出し行と同じ判断）。
//
// キャッシュ: 成功（記録あり・記録なし）は 60 秒の CDN キャッシュ＋5 分の stale-while-revalidate。判断が増えるのは自動 tick
// （1日3回）か運営者の手動 tick のときだけなので、60 秒の遅れは表示上の問題にならず、ほとんどの訪問者はサーバーの計算
// （実測 1.8 秒）を待たずに済む。失敗（502）だけは no-store（一時的な障害を CDN に残さない。app/api/signals/[symbol]/route.ts と同じ）。
//
// 既存の GET /api/ai-session（/watch が使う全件の経路）は変えない。検査: scripts/check-ai-session-latest.ts

const DECISION_LIMIT = 3
const CACHE_1MIN = 'public, s-maxage=60, stale-while-revalidate=300'
// 画面にそのまま出せる文（DESIGN.md §6-12: 何が起きたかを正直に。仮の記録を作らない）
const READ_FAILED_MESSAGE = 'AIの判断記録を読み込めませんでした'

type LatestDecision = Pick<AIDecision, 'symbol' | 'name' | 'action' | 'reasoning'>
type LatestBody = {
  lastTickAt: string | null
  tickCount: number
  persona: InvestorId | null
  decisions: LatestDecision[]
}

const EMPTY: LatestBody = { lastTickAt: null, tickCount: 0, persona: null, decisions: [] }

export async function GET() {
  try {
    const sessions = await listSessions()
    // 最後に動いたセッションを1件だけ（app/page.tsx の選び方と同じ。配列の順序には依らない）
    const latest = sessions.length
      ? [...sessions].sort((a, b) => Date.parse(b.lastTickAt) - Date.parse(a.lastTickAt))[0]
      : undefined
    const decisions = Array.isArray(latest?.decisions) ? latest.decisions : []
    if (!latest || decisions.length === 0) {
      return NextResponse.json(EMPTY, { headers: { 'Cache-Control': CACHE_1MIN } })
    }
    const body: LatestBody = {
      lastTickAt: latest.lastTickAt,
      tickCount: latest.tickCount,
      persona: latest.persona ?? null,
      // 表示に使う4項目だけに絞る（price・technicals・fundamentals・news などは載せない）。順序は元の decisions のまま
      decisions: decisions.slice(0, DECISION_LIMIT).map(({ symbol, name, action, reasoning }) => ({ symbol, name, action, reasoning })),
    }
    return NextResponse.json(body, { headers: { 'Cache-Control': CACHE_1MIN } })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // 原因（«ai_sessions list failed: …» など）は画面に出さないので、サーバーのログにだけ残す
    // （app/stocks/[symbol]/page.tsx・app/api/signals/[symbol]/route.ts の catch と同じ流儀）
    console.error(`[api/ai-session/latest] ${READ_FAILED_MESSAGE}: ${message}`)
    // 502 = 記録の置き場（Supabase／ファイル）が返せなかった。「記録が無い」（200 の空）とは区別する
    return NextResponse.json(
      { error: READ_FAILED_MESSAGE },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
