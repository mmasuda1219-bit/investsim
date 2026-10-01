import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth/current-user'
import { getPortfolio } from '@/lib/portfolio/server'
import { findRecord } from '@/lib/review/record'
import { getPrimarySources, isoDay, DEFAULT_WINDOW_DAYS as PRIMARY_WINDOW_DAYS } from '@/lib/review/primary-sources'

const DAY_MS = 86_400_000
import { loadPrimarySources, savePrimarySources } from '@/lib/review/primary-sources/store'

export const runtime = 'nodejs'
// EDINET は窓の各日を 1 秒に 1 本で取る（最大 61 本）ので、解決には最長 1〜2 分かかる
export const maxDuration = 120

// /api/review/[recordId]/primary-sources — 「あなたが書いていないことの、出どころ」（S3c・2026-10-01）。
//
// 1 件の記録（買いの Trade.id）について、発行会社の一次情報（米: SEC EDGAR／日: EDINET）の一覧を **開いた最初の 1 回だけ解決して凍結** する。
// AI を使わない。利用者の文章を外に送らない。要約しない。
//
// 本人確認: getCurrentUserId()（Cookie の JWT を Supabase に問い合わせて検証）→ 未ログインは 401。
//   記録 ID が自分の売買に無ければ 404（他人の記録 ID を指定されても 404。存在の有無を漏らさない）。
//
// GET : 保存済みがあればそれを返す。無ければ { status: 'unresolved' }。表が無い・service-role が無い → { status: 'failed', reason }
// POST: 保存済みがあればそれを返す（同じ記録を 2 回解決しない）。無ければ解決して保存して返す。
//       表が無い・鍵が無い・取得に失敗 → status 'failed' を **保存せず** 返す（次に開いたときに再試行できる。画面は節を出さない）。
// どちらも Cache-Control: private, no-store（本人の記録。CDN・ブラウザに残さない）。
// 検査: scripts/check-primary-sources.ts。

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const

type Ctx = { params: Promise<{ recordId: string }> }

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

/** 本人の記録を引く。401／404 のときは応答をそのまま返す */
async function resolveRecord(ctx: Ctx) {
  const userId = await getCurrentUserId()
  if (!userId) return { response: json({ error: 'unauthenticated', message: 'ログインすると記録を読み返せます' }, 401) }
  const { recordId } = await ctx.params
  if (!UUID_RE.test(recordId)) return { response: json({ error: 'not_found' }, 404) }
  try {
    const portfolio = await getPortfolio(userId)
    const record = findRecord(portfolio.trades, recordId)
    if (!record) return { response: json({ error: 'not_found' }, 404) }
    return { userId, recordId, record }
  } catch (err) {
    console.error('[primary-sources] 記録の読み込みに失敗:', err instanceof Error ? err.message : err)
    return { response: json({ error: 'read_failed' }, 500) }
  }
}

export async function GET(_req: Request, ctx: Ctx) {
  const r = await resolveRecord(ctx)
  if ('response' in r) return r.response
  const saved = await loadPrimarySources(r.userId, r.recordId)
  if (!saved.ok) return json({ status: 'failed', reason: saved.reason })
  return json(saved.result ?? { status: 'unresolved' })
}

export async function POST(_req: Request, ctx: Ctx) {
  const r = await resolveRecord(ctx)
  if ('response' in r) return r.response
  // 保存済みがあればそれを返す（同じ記録を 2 回解決しない）。表が無ければ解決せずに failed（保存できない）
  const saved = await loadPrimarySources(r.userId, r.recordId)
  if (!saved.ok) return json({ status: 'failed', reason: saved.reason })
  if (saved.result) return json(saved.result)

  const result = await getPrimarySources({ symbol: r.record.symbol, tradeDate: isoDay(r.record.entryAt) })
  if (result.status === 'failed') return json({ ...result, reason: 'fetch_failed' })

  // 窓（買った日の前後 30 日）が今日まで届いていない＝買った直後に開いたときは、結果は返すが **保存（凍結）しない**
  // （S3c レビュー W4）。凍結すると、その後 30 日に出る書類が二度と載らない。窓が揃った最初の 1 回で凍結する。
  // 再解決は日ごとの控えが効くので安い。
  const fullTo = isoDay(r.record.entryAt + PRIMARY_WINDOW_DAYS * DAY_MS)
  if (result.windowTo < fullTo) return json(result)

  const stored = await savePrimarySources(r.userId, r.recordId, result)
  if (!stored.ok) console.error(`[primary-sources] 保存できなかった（結果は返す）: ${stored.reason}${stored.error ? ` ${stored.error}` : ''}`)
  return json(result)
}
