import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/ai-trader/engine'
import { getHistory } from '@/lib/market'

// A trade is drawn on the chart only if a real bar exists within this window.
// Trades older than the fetched range would otherwise snap onto the oldest bar
// at a false position (review W2).
const MAX_SNAP_SEC = 3 * 24 * 60 * 60

// 画面にそのまま出す文（2026-09-18・DECISIONS.md 2026-09-17 の決定(4)）。読む側はこの error を括弧に入れて出す:
//   app/watch/client.tsx                  「価格データを取得できませんでした（{error}）」
//   components/watch/replay/ProcessReplay → ReplayStages 「株価の足を取得できませんでした（{error}）。線と平均線は再計算できません。」
// 括弧の外が「取得できませんでした」なので、中は原因だけを短く（「取得できませんでした」を重ねない）。
// 原因の英語（getHistory の «Real market data unavailable for AAPL — yahoo2: …»）は画面に出さず、サーバーのログにだけ残す。
const HISTORY_FAILED_MESSAGE = '取得元から応答がありません'
const SESSION_NOT_FOUND_MESSAGE = 'セッションが見つかりません'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; symbol: string }> }
) {
  const { id, symbol } = await params
  const session = await getSession(id)
  if (!session) return NextResponse.json({ error: SESSION_NOT_FOUND_MESSAGE }, { status: 404 })

  try {
    // 原則9: never draw markers / P&L on top of synthetic bars. If every real
    // provider fails, surface a 5xx so the client shows its error state.
    const history = await getHistory(symbol, '6mo', { allowMock: false })

    let outOfRangeTrades = 0
    const trades: Array<{
      time: number
      action: string
      price: number
      shares: number
      total: number
      reason: string
      timestamp: string
    }> = []

    for (const t of session.trades) {
      if (t.symbol !== symbol) continue
      const tSec = Math.floor(new Date(t.timestamp).getTime() / 1000)
      let closest = history[0]
      let minDiff = Infinity
      for (const bar of history) {
        const diff = Math.abs(bar.time - tSec)
        if (diff < minDiff) { minDiff = diff; closest = bar }
      }
      if (!closest || minDiff > MAX_SNAP_SEC) {
        outOfRangeTrades++
        continue
      }
      trades.push({
        time:      closest.time,
        action:    t.action,
        price:     t.price,
        shares:    t.shares,
        total:     t.total,
        reason:    t.reason,
        timestamp: t.timestamp,
      })
    }

    return NextResponse.json({ history, trades, outOfRangeTrades })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // 原因は画面に出さないので、サーバーのログにだけ残す
    // （app/api/signals/[symbol]/route.ts・app/api/ai-session/latest/route.ts の catch と同じ流儀）
    console.error(`[api/ai-session/[id]/chart/[symbol]] ${id}/${symbol} の価格データを取得できませんでした: ${message}`)
    // 502 = 上流のデータ源（実データ3経路）が返せなかった。no-store = 一時的な障害を CDN に残さない。
    // 成功時の応答（history / trades / outOfRangeTrades・ヘッダ無し）は変えていない
    return NextResponse.json(
      { error: HISTORY_FAILED_MESSAGE },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
