import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth/current-user'
import { executeTrade } from '@/lib/portfolio/server'
import { MIN_REASON } from '@/lib/portfolio'

export const runtime = 'nodejs'

// POST /api/portfolio/trade — 売買を1回実行する。
//
// 残高・持ち株の判定は SQL関数 execute_trade（migration 0006）が行う。ここでやるのは
// 「ログインしているか」と「入力の形が正しいか」だけ。金額の計算をここに書くと、
// SQL側と二重にルールを持つことになり、いつか必ず食い違う。
//
// 価格をクライアントから受け取っている点について: いまは /trade が実データの現在値を
// 表示してから送っている。ここでサーバーが取り直さないのは、表示価格と約定価格が
// ずれると «見えていた値段で買えない» ことになり練習として不自然なため。
// 代わりに正の数であることだけ検証する（原則9: 架空データでの補完はしない）。
export async function POST(req: Request) {
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json(
      { error: 'unauthenticated', message: 'ログインすると売買の記録を残せます' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const symbol = typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase() : ''
  const name   = typeof body.name   === 'string' ? body.name.trim() : ''
  const action = body.action === 'buy' || body.action === 'sell' ? body.action : null
  const shares = typeof body.shares === 'number' ? body.shares : Number(body.shares)
  const price  = typeof body.price  === 'number' ? body.price  : Number(body.price)
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''

  if (!symbol || !action || !Number.isFinite(shares) || shares <= 0
      || !Number.isFinite(price) || price <= 0) {
    return NextResponse.json(
      { error: 'bad_input', message: '銘柄・売買・株数・価格を正しく指定してください' },
      { status: 400 },
    )
  }

  // 理由の必須化はUIだけに置かない。APIを直接叩けば理由なしで記録できてしまうと、
  // 「振り返る」で判断の質を見る材料に穴が空く（DECISIONS 2026-08-23 の不変条件）。
  if (reason.length < MIN_REASON) {
    return NextResponse.json(
      { error: 'reason_required', message: `なぜそう判断したかを${MIN_REASON}文字以上で書いてください` },
      { status: 400 },
    )
  }

  try {
    const result = await executeTrade(userId, {
      symbol, name: name || symbol, action, shares, price, reason,
    })
    if (!result.ok) {
      const message =
        result.code === 'insufficient_cash'   ? '残高が足りません' :
        result.code === 'insufficient_shares' ? '保有株数が足りません' :
                                                '入力を確認してください'
      return NextResponse.json({ error: result.code, message }, { status: 400 })
    }
    return NextResponse.json(
      { ok: true, tradeId: result.tradeId, portfolio: result.portfolio },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'trade failed'
    console.error('[portfolio] trade failed:', message)
    return NextResponse.json({ error: 'trade_failed', message: '記録できませんでした' }, { status: 500 })
  }
}
