// S5a: POST /api/analyze/screen — 銘柄指定なし（quick/investorプリセット）の
// スクリーニング。キャッシュ済みユニバース（lib/screen/cache.ts の
// universe_fundamentals）のみを読み、適合度ランキング TOP N を返す。
//
// 重要（原則9・60秒制約）: ライブ getFundamentals は一切呼ばない。事前計算
// キャッシュが空/薄くても、ここではフォールバックせず「評価0件」を正直に返す
// （fail-closed。架空データで埋めない）。pro（カスタム条件）は非対応 — 400。
import { NextResponse } from 'next/server'
import { listCached } from '@/lib/screen/cache'
import { rankCandidates } from '@/lib/screen/rank'
import { NEEDS_PRESETS, NEEDS_PRESET_IDS, isNeedsPresetId } from '@/lib/backtest/presets'
import { INVESTOR_PRESETS, INVESTOR_PRESET_IDS, isInvestorModelId } from '@/lib/backtest/investor-presets'
import { US_UNIVERSE } from '@/lib/market/us-universe'
import type { CompositeCondition, InvestorModelId, NeedsPresetId } from '@/lib/backtest/types'
import type { ScreenResponse } from '@/lib/screen/types'

export const runtime = 'nodejs'
// キャッシュ読み取り＋純計算のみ（ライブ取得なし）で軽量だが、他ルートと横並びで
// Vercel Hobby の関数上限に明示的に合わせておく。
export const maxDuration = 60

// S5c-2（cronによる自動再取得）がまだ無いため、鮮度閾値は暫定値。cron導入時に
// 実際の再取得間隔に合わせて見直す。
const DEFAULT_STALE_DAYS = 14
const MAX_STALE_DAYS = 90
const TOP_N = 10

function parseStaleDays(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return DEFAULT_STALE_DAYS
  return Math.min(v, MAX_STALE_DAYS)
}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'invalid request body' }, { status: 400 })
  }
  const b = body as Record<string, unknown>

  if (b.mode !== 'quick' && b.mode !== 'investor') {
    return NextResponse.json(
      {
        error:
          "mode は 'quick' | 'investor' のいずれかを指定してください。プロ（カスタム条件）はスクリーニング非対応です。",
      },
      { status: 400 },
    )
  }
  const mode = b.mode

  let condition: CompositeCondition
  let presetLabel: string
  let conditionNotes: string[]
  let presetId: NeedsPresetId | InvestorModelId

  if (mode === 'quick') {
    if (!isNeedsPresetId(b.presetId)) {
      return NextResponse.json(
        { error: `presetId は ${NEEDS_PRESET_IDS.join(' / ')} のいずれか1つを指定してください。` },
        { status: 400 },
      )
    }
    const preset = NEEDS_PRESETS[b.presetId]
    condition = preset.condition
    presetLabel = preset.label
    conditionNotes = preset.conditionNotes
    presetId = preset.id
  } else {
    if (!isInvestorModelId(b.presetId)) {
      return NextResponse.json(
        { error: `presetId は ${INVESTOR_PRESET_IDS.join(' / ')} のいずれか1つを指定してください。` },
        { status: 400 },
      )
    }
    const preset = INVESTOR_PRESETS[b.presetId]
    condition = preset.condition
    presetLabel = preset.label
    conditionNotes = preset.conditionNotes
    presetId = preset.id
  }

  const staleDays = parseStaleDays(b.staleDays)

  try {
    // ライブ取得は一切しない。空/薄いキャッシュでも例外にせず「評価0件」を返す。
    const rows = await listCached()
    const { candidates, meta } = rankCandidates(rows, condition, { staleDays, limit: TOP_N })

    const response: ScreenResponse = {
      mode,
      presetId,
      presetLabel,
      conditionNotes,
      staleDaysThreshold: staleDays,
      universeSize: US_UNIVERSE.length,
      excludedMissingCount: Math.max(0, US_UNIVERSE.length - meta.totalCached),
      meta,
      candidates,
    }
    return NextResponse.json(response)
  } catch (err) {
    // キャッシュ読み取り自体の障害（例: Supabase接続エラー）のみここに到達する。
    // 「データが少ない/無い」は上のパスで正直な0件応答になり、ここには来ない。
    const detail = err instanceof Error ? err.message : 'screen failed'
    console.error('[analyze/screen] unexpected failure:', detail)
    return NextResponse.json(
      {
        error: 'スクリーニング用キャッシュの読み取りに失敗しました。時間をおいて再試行してください。',
        detail,
      },
      { status: 500 },
    )
  }
}
