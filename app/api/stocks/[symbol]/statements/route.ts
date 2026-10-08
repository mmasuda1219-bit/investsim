import { NextResponse } from 'next/server'
import { getAnnualStatements } from '@/lib/statements/sec-xbrl'

// /api/stocks/[symbol]/statements — 「1年ごとの決算」（/stocks/[symbol]・2026-10-07）が読むデータ。
//
// データ源は SEC EDGAR の XBRL companyfacts API だけ（lib/statements/sec-xbrl.ts）。Yahoo 由来の getStatements() は呼ばない。
//   成功            → 200 { statements }
//   取れない（米国株でない・SEC の表に無い・10-K の年次の行が無い）→ 200 { statements: null, reason }
//   例外（連絡先が未設定・通信に失敗・応答が壊れている）→ 502 { statements: null, error: 'fetch_failed' }
// 取得元のエラー本文は応答に載せない（サーバーのログにだけ残す。app/stocks/[symbol]/page.tsx の catch と同じ流儀）。
// 成功・取れないは公開の控え（6 時間・古いまま 7 日まで配ってよい）。10-K は年に 1 回しか動かない。
// 検査: scripts/check-annual-statements.ts。
export const runtime = 'nodejs'
// 表と companyfacts の 2 本 × リトライ 2 回 × 12 秒 = 最悪 48 秒。これより短いと失敗の控えが書かれないまま切られる（レビュー W2）
export const maxDuration = 60

const CACHE_OK = 'public, max-age=21600, stale-while-revalidate=604800'
const NO_STORE = 'no-store'

function json(body: unknown, status: number, cacheControl: string) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': cacheControl } })
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol: raw } = await params
  const symbol = raw.trim().toUpperCase()
  if (!symbol) return json({ statements: null, error: 'bad_symbol' }, 400, NO_STORE)

  const r = await getAnnualStatements(symbol)
  if (r.status === 'ok') return json({ statements: r.statements }, 200, CACHE_OK)
  if (r.status === 'empty') return json({ statements: null, reason: r.reason }, 200, CACHE_OK)
  console.error(`[stocks/statements] ${symbol} の年次決算を取得できませんでした: ${r.error}`)
  return json({ statements: null, error: 'fetch_failed' }, 502, NO_STORE)
}
