import { NextResponse } from 'next/server'
import { runBacktest, BacktestDataError } from '@/lib/backtest/run'
import { getFundamentals } from '@/lib/market'
import {
  evaluateFundamentalGate,
  describeFundamentalFilter,
  formatMetricValue,
} from '@/lib/backtest/fundamental'
import { NEEDS_PRESETS, parseLabRequest } from '@/lib/backtest/presets'
import type { FundamentalGateResult } from '@/lib/backtest/fundamental'
import type { LabNeedsResponse } from '@/lib/backtest/presets'

export const runtime = 'nodejs'
export const maxDuration = 60 // Vercel Hobby 上限に整合（needs: ファンダ1回＋履歴1回のみ）

// ゲート不成立の人間可読な理由（実測値つき・/report prepare と同趣旨）。
function buildGateFailReason(gate: FundamentalGateResult): string {
  const parts = gate.evaluations
    .filter((e) => e.result !== 'pass')
    .map((e) => {
      const cond = describeFundamentalFilter(e.filter)
      return e.result === 'no_data'
        ? `「${cond}」→ 実データ取得不可のため判定不能（不成立扱い）`
        : `「${cond}」→ 実測 ${e.actual != null ? formatMetricValue(e.filter.metric, e.actual) : 'N/A'} で不成立`
    })
  return `参加条件が不成立: ${parts.join(' / ')}`
}

// POST /api/lab/backtest
// mode で分岐する薄いエンドポイント（検証＋排他ガードは lib/backtest/presets.ts の純関数）:
//   - technical: 従来動作（MAクロス・1年日足）そのまま
//   - needs:     presetId からサーバー側で条件導出 → 現在値ファンダの静的ゲート
//                （fail-closed）→ pass時のみ5年バックテスト。fail時は実測値つき
//                理由を返しバックテストしない
//   - investor:  501（S2で実装 — 近日対応）
// 排他ガード: needs/investor へのカスタム condition 同梱・presetId 複数指定は 400。
export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const parsed = parseLabRequest(body)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status })
  }
  const request = parsed.request

  if (request.mode === 'investor') {
    return NextResponse.json(
      { error: '投資家モデルは近日対応です（現在準備中）。テクニカルまたはニーズ軸をご利用ください。' },
      { status: 501 },
    )
  }

  try {
    if (request.mode === 'technical') {
      // 従来動作: 1年日足・MAクロス・レスポンス形も従来どおり BacktestResult。
      const result = await runBacktest({
        symbol: request.symbol,
        period: '1y',
        condition: request.condition,
        initialCapital: request.initialCapital,
      })
      return NextResponse.json(result)
    }

    // ── mode === 'needs' ──────────────────────────────────────────────────
    const preset = NEEDS_PRESETS[request.presetId]

    // ファンダ取得は単一銘柄1回のみ（レート・時間配慮）。allowMock:false —
    // モック値でゲートを判定しない（原則9）。取得不可 ⇒ {} ⇒ no_data ⇒ fail-closed。
    const fundamentals = await getFundamentals(request.symbol, { allowMock: false })
    const gate = evaluateFundamentalGate(fundamentals, preset.condition.fundamentalFilters)

    if (!gate.passed) {
      // ゲート不成立: バックテストは実行しない。判定結果＋実測値を返す。
      const response: LabNeedsResponse = {
        mode: 'needs',
        presetId: preset.id,
        presetLabel: preset.label,
        conditionNotes: preset.conditionNotes,
        gate,
        gatePassed: false,
        gateFailReason: buildGateFailReason(gate),
        result: null,
      }
      return NextResponse.json(response)
    }

    const result = await runBacktest({
      symbol: request.symbol,
      period: preset.period,
      condition: preset.condition.technical,
      initialCapital: request.initialCapital,
    })
    const response: LabNeedsResponse = {
      mode: 'needs',
      presetId: preset.id,
      presetLabel: preset.label,
      conditionNotes: preset.conditionNotes,
      gate,
      gatePassed: true,
      result,
    }
    return NextResponse.json(response)
  } catch (err) {
    if (err instanceof BacktestDataError) {
      // 不正ティッカー・履歴不足など入力起因 => 422
      return NextResponse.json({ error: err.message }, { status: 422 })
    }
    // データ源の障害など想定外の失敗: 生の内部エラー（英語・プロバイダ名）を
    // そのままUIに出さない。詳細は detail とサーバーログに残す。
    const detail = err instanceof Error ? err.message : 'Backtest failed'
    console.error('[lab/backtest] unexpected failure:', detail)
    return NextResponse.json(
      {
        error: '実データの取得に失敗しました。データ源が一時的に利用できない可能性があります。時間をおいて再試行してください。',
        detail,
      },
      { status: 500 },
    )
  }
}
