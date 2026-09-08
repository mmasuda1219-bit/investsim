import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth/current-user'
import { recordPastTrade, removePastTrade, getPortfolio } from '@/lib/portfolio/server'
import { MIN_REASON } from '@/lib/portfolio'

export const runtime = 'nodejs'

// POST /api/portfolio/past-trade — 過去にやった取引を1件«記録»する。
// DELETE /api/portfolio/past-trade?id=… — 記録した過去の取引を1件消す。
//
// /api/portfolio/trade（練習場の売買）とは別の口にしてある。理由:
//  - 練習場の売買は仮想の現金・持ち株を動かす。過去の記録は動かさない。同じ口にすると
//    «現金を動かすかどうか» のフラグを外から渡すことになり、間違えたときの被害が大きい。
//  - 過去の記録には日付が要るが、練習場の売買に日付を外から渡せてはいけない
//    （好きな日付で «あとから» 練習の成績を作れてしまう）。
//
// 価格を検証し直さない点は /api/portfolio/trade と同じ考え方。ここでは本人の記憶・
// 明細に基づく自己申告を受け取る。過去の実勢価格をこちらで «正しい値» に書き換えると、
// 本人の記録ではなくなる（原則9: 無い数字を作らない、の裏返しで «勝手に直さない»）。

/** 画面から来る YYYY-MM-DD を、時差でズレない正午UTCのISO文字列にする。 */
function toIsoNoon(day: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const ts = Date.UTC(y, mo - 1, d, 12, 0, 0)
  const dt = new Date(ts)
  // 2026-02-31 のような «形式は合うが存在しない日» を弾く
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return dt.toISOString()
}

export async function POST(req: Request) {
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json(
      { error: 'unauthenticated', message: 'ログインすると過去の取引を記録できます' },
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
  const day    = typeof body.executedOn === 'string' ? body.executedOn.trim() : ''

  if (!symbol || !action || !Number.isFinite(shares) || shares <= 0
      || !Number.isFinite(price) || price <= 0) {
    return NextResponse.json(
      { error: 'bad_input', message: '銘柄・売買・株数・価格を正しく指定してください' },
      { status: 400 },
    )
  }

  const executedAt = toIsoNoon(day)
  if (!executedAt) {
    return NextResponse.json(
      { error: 'bad_date', message: '日付を YYYY-MM-DD の形式で指定してください' },
      { status: 400 },
    )
  }

  // 理由の必須はUIだけに置かない（/api/portfolio/trade と同じ規律）。
  // 記録の目的は «あとで突き合わせること» なので、理由の無い記録は材料にならない。
  if (reason.length < MIN_REASON) {
    return NextResponse.json(
      { error: 'reason_required', message: `そのとき何を考えていたかを${MIN_REASON}文字以上で書いてください` },
      { status: 400 },
    )
  }

  try {
    const result = await recordPastTrade(userId, {
      symbol, name: name || symbol, action, shares, price, reason, executedAt,
    })
    if (!result.ok) {
      const message = result.code === 'future_date'
        ? '未来の日付は記録できません。過去にやった取引を入れてください'
        : '入力を確認してください'
      return NextResponse.json({ error: result.code, message }, { status: 400 })
    }
    return NextResponse.json(
      { ok: true, tradeId: result.tradeId, portfolio: result.portfolio },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'record failed'
    console.error('[portfolio] record past trade failed:', message)
    return NextResponse.json({ error: 'record_failed', message: '記録できませんでした' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json(
      { error: 'unauthenticated', message: 'ログインが必要です' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const id = new URL(req.url).searchParams.get('id')?.trim()
  if (!id) return NextResponse.json({ error: 'bad_input', message: 'idを指定してください' }, { status: 400 })

  try {
    // 消せるのは source='past' の行だけ（SQL側で限定）。練習場の履歴は1件ずつ消せない。
    const deleted = await removePastTrade(userId, id)
    if (!deleted) {
      return NextResponse.json(
        { error: 'not_found', message: '見つかりませんでした（練習場の売買は1件ずつ消せません）' },
        { status: 404 },
      )
    }
    return NextResponse.json(
      { ok: true, portfolio: await getPortfolio(userId) },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'delete failed'
    console.error('[portfolio] delete past trade failed:', message)
    return NextResponse.json({ error: 'delete_failed', message: '消せませんでした' }, { status: 500 })
  }
}
