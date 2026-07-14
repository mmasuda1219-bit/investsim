// Prepare step 1: interpret the user's free-form theory into ONE executable
// BacktestCondition using Haiku (cheap, non-streaming).
//
// Principle 9: if the theory can't be interpreted into a supported condition,
// we THROW InterpretError — we never silently fall back to a default condition.

import { callReportClaude, INTERPRET_MODEL } from './claude'
import type { TechnicalCondition } from '@/lib/backtest/types'
import type { ReportRequest, InterpretedTheory, ReportIndicator } from './types'

/** Thrown when the theory cannot be mapped to a supported condition (=> 422). */
export class InterpretError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InterpretError'
  }
}

type IndicatorId = TechnicalCondition['indicator']

const INDICATOR_MAP: Record<ReportIndicator, IndicatorId> = {
  ma: 'ma_cross',
  rsi: 'rsi_reversal',
  macd: 'macd_cross',
  bb: 'bb_break',
}

const RULE_DESCRIPTIONS: Record<IndicatorId, string> = {
  ma_cross:     '終値がN日移動平均を上抜けたら買い・下抜けたら売り（period=N, 2〜200）',
  rsi_reversal: 'RSI(N)が30を下から上へ回復したら買い・70を上から下へ割ったら売り（period=N, 通常14）',
  macd_cross:   'MACD(12,26,9)がシグナルを上抜けたら買い・下抜けたら売り（periodなし）',
  bb_break:     '終値がボリンジャーバンド(N日, ±2σ)上限を上抜けたら買い・下限を下抜けたら売り（period=N, 通常20）',
}

function clampPeriod(indicator: IndicatorId, raw: unknown, fallback: number): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : fallback
  const range = indicator === 'rsi_reversal' ? [2, 50] : [2, 200]
  return Math.min(Math.max(n, range[0]), range[1])
}

/**
 * Ask Haiku to pick the single best-matching rule (among the user's checked
 * indicator families) and its period, then validate strictly.
 */
export async function interpretTheory(req: ReportRequest): Promise<InterpretedTheory> {
  const allowed = req.indicators.map(i => INDICATOR_MAP[i])
  if (allowed.length === 0) {
    throw new InterpretError('チェックされた指標がありません')
  }

  const rulesText = allowed
    .map(id => `- "${id}": ${RULE_DESCRIPTIONS[id]}`)
    .join('\n')

  const maHint = req.maPeriod ? `\nユーザーが指定したMA期間の希望: ${req.maPeriod}日` : ''

  const prompt = `あなたは投資理論の解釈エンジンです。ユーザーの自由記述の投資理論を、以下のバックテスト実行ルールのうち最も合致する1つに変換してください。

【ユーザーの理論】
${req.theoryText}

【選択可能なルール】（ユーザーがチェックした指標のみ）
${rulesText}${maHint}

【出力形式】以下のJSONのみを返してください:
\`\`\`json
{
  "indicator": "ルールID（上記リストのいずれか1つ）",
  "period": 数値またはnull,
  "note": "理論をどう解釈してこのルールにマッピングしたかの説明（日本語2文以内）"
}
\`\`\`

【厳守】
- 理論がどのルールにも合致しない・意味が読み取れない場合は {"indicator": null, "period": null, "note": "解釈できない理由"} を返す。無理にこじつけない。
- indicatorは選択可能なルールのIDのみ。リスト外のIDを返さない。`

  const text = await callReportClaude(prompt, { model: INTERPRET_MODEL, maxTokens: 500 })

  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) ?? text.match(/(\{[\s\S]*\})/)
  if (!jsonMatch) {
    throw new InterpretError('理論の解釈結果（JSON）を取得できませんでした')
  }

  let parsed: { indicator?: unknown; period?: unknown; note?: unknown }
  try {
    parsed = JSON.parse(jsonMatch[1])
  } catch {
    throw new InterpretError('理論の解釈結果のJSONを解析できませんでした')
  }

  const indicator = parsed.indicator
  if (indicator === null || indicator === undefined) {
    const reason = typeof parsed.note === 'string' ? parsed.note : '理論を実行可能な条件に変換できません'
    throw new InterpretError(`理論を解釈できませんでした: ${reason}`)
  }
  if (typeof indicator !== 'string' || !allowed.includes(indicator as IndicatorId)) {
    throw new InterpretError(`解釈結果が選択された指標に含まれていません: ${String(indicator)}`)
  }

  const id = indicator as IndicatorId
  const note = typeof parsed.note === 'string' && parsed.note.trim()
    ? parsed.note.trim()
    : '（解釈メモなし）'

  let condition: TechnicalCondition
  switch (id) {
    case 'ma_cross':
      condition = {
        type: 'technical',
        indicator: 'ma_cross',
        period: clampPeriod(id, parsed.period ?? req.maPeriod, 20),
      }
      break
    case 'rsi_reversal':
      condition = {
        type: 'technical',
        indicator: 'rsi_reversal',
        period: clampPeriod(id, parsed.period, 14),
      }
      break
    case 'macd_cross':
      condition = { type: 'technical', indicator: 'macd_cross' }
      break
    case 'bb_break':
      condition = {
        type: 'technical',
        indicator: 'bb_break',
        period: clampPeriod(id, parsed.period, 20),
      }
      break
  }

  return { condition, note }
}
