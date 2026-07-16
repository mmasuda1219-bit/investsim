// ⚠️ PARKED (R1, 2026-07-16): the Haiku interpret step was REMOVED from the
// /report pipeline — prepare now takes a structured CompositeCondition and no
// route imports this file. Kept on disk per owner/architect decision (may
// return in a later slice). Uses Legacy* types so it still compiles.
//
// Prepare step 1 (v1): interpret the user's free-form theory into ONE
// executable BacktestCondition using a cheap model (non-streaming).
//
// Slice 2 change: the interpreter picks from the FULL catalog of supported
// rules (8 as of now). The user's checked indicator families are passed only
// as a SOFT HINT in the prompt — never as a hard restriction (the old
// "allowed" constraint caused false 422s like "BB break + only MACD checked").
//
// Principle 9: if the theory truly contains no technical trigger, we THROW
// InterpretError (=> friendly 422 listing the supported rules) — we never
// silently fall back to a default condition. The chosen rule + reasoning note
// are always returned so the user can see HOW the theory was mapped.

import { callReportClaude, INTERPRET_MODEL } from './claude'
import type { TechnicalCondition } from '@/lib/backtest/types'
import type { LegacyReportRequest, InterpretedTheory, ReportIndicator } from './types'

/** Thrown when the theory cannot be mapped to a supported condition (=> 422). */
export class InterpretError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InterpretError'
  }
}

type IndicatorId = TechnicalCondition['indicator']

/** Full catalog — every supported rule, regardless of what the user checked. */
const ALL_RULE_IDS: IndicatorId[] = [
  'ma_cross',
  'ma_cross_dual',
  'rsi_reversal',
  'macd_cross',
  'bb_break',
  'hl_break',
  'stoch_cross',
  'roc_signal',
]

/** Rule spec + typical Japanese expressions, embedded in the prompt. */
const RULE_CATALOG: Record<IndicatorId, string> = {
  ma_cross:
    '終値がN日移動平均を上抜けたら買い・下抜けたら売り（period=N, 2〜200, 既定20）。' +
    '典型表現:「移動平均線を上抜けたら買う」「MAを割ったら売る」「25日線タッチで反発」',
  ma_cross_dual:
    '短期MAが長期MAを上抜け（ゴールデンクロス）で買い・下抜け（デッドクロス）で売り' +
    '（shortPeriod既定20 / longPeriod既定50・最大100）。' +
    '典型表現:「ゴールデンクロス」「デッドクロス」「短期線が長期線を抜く」「5日線と25日線のクロス」',
  rsi_reversal:
    'RSI(N)が30を下から上へ回復したら買い・70を上から下へ割ったら売り（period=N, 通常14）。' +
    '典型表現:「売られすぎで買う」「RSIが30を回復したら」「買われすぎからの反落で売る」「逆張り」',
  macd_cross:
    'MACD(12,26,9)がシグナル線を上抜けたら買い・下抜けたら売り（periodなし）。' +
    '典型表現:「MACDのゴールデンクロス」「MACDがシグナルを上抜け」「MACD好転」',
  bb_break:
    '終値がボリンジャーバンド(N日, ±2σ)上限を上抜けたら買い・下限を下抜けたら売り（period=N, 通常20）。' +
    '典型表現:「ボリンジャー上抜け」「バンド突破」「±2σを超えたら」「バンドウォーク開始で買う」',
  hl_break:
    '終値が直近N日高値（前日まで）を上抜けたら買い・直近N日安値を下抜けたら売り（period=N, 5〜100, 既定20）。' +
    '典型表現:「ブレイクアウト」「N日高値更新で買う」「新高値」「レンジ上抜け」「直近安値割れで損切り」',
  stoch_cross:
    'ストキャスティクス: %Kが%Dを上抜け かつ %K≤30（売られすぎ圏）で買い・' +
    '%Kが%Dを下抜け かつ %K≥70（買われすぎ圏）で売り（period=N, 通常14）。' +
    '典型表現:「ストキャス」「%Kと%Dのクロス」「ストキャスティクスの売られすぎ反転」',
  roc_signal:
    '変化率ROC(N)が0を上抜けたら買い・0を下抜けたら売り（period=N, 通常12）。' +
    '典型表現:「モメンタム」「勢いがプラスに転じたら買う」「上昇率がマイナスになったら売る」「変化率」',
}

/** Checked indicator family (UI checkbox) → catalog rule id(s), hint text only. */
const HINT_RULES: Record<ReportIndicator, string> = {
  ma:       'ma_cross / ma_cross_dual（移動平均系）',
  rsi:      'rsi_reversal（RSI）',
  macd:     'macd_cross（MACD）',
  bb:       'bb_break（ボリンジャーバンド）',
  stoch:    'stoch_cross（ストキャスティクス）',
  roc:      'roc_signal（モメンタム/変化率）',
  breakout: 'hl_break（高値/安値ブレイクアウト）',
}

/** Human-readable rule list for the friendly 422 message (principle 9). */
const SUPPORTED_RULES_JA =
  'MAクロス（価格×移動平均）／ゴールデンクロス（短期MA×長期MA）／RSI反転（売られすぎ・買われすぎ）／' +
  'MACDクロス／ボリンジャーバンド突破／高値・安値ブレイクアウト／ストキャスティクスクロス／ROC（モメンタム）'

function cannotInterpretMessage(reason: string): string {
  return (
    `理論を解釈できませんでした: ${reason}。` +
    `対応ルール: ${SUPPORTED_RULES_JA}。` +
    '「ゴールデンクロスで買う」「20日高値を更新したら買う」のような技術的な売買条件を理論に含めてください。'
  )
}

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : fallback
  return Math.min(Math.max(n, min), max)
}

interface ParsedInterpretation {
  indicator?: unknown
  period?: unknown
  shortPeriod?: unknown
  longPeriod?: unknown
  note?: unknown
}

/** Build a validated condition from the model's raw JSON (clamped periods). */
function buildCondition(id: IndicatorId, parsed: ParsedInterpretation, req: LegacyReportRequest): TechnicalCondition {
  switch (id) {
    case 'ma_cross':
      return {
        type: 'technical',
        indicator: 'ma_cross',
        period: clampInt(parsed.period ?? req.maPeriod, 2, 200, 20),
      }
    case 'ma_cross_dual': {
      // 1y daily data (~250 bars): cap the long MA at 100 for warm-up headroom.
      let short = clampInt(parsed.shortPeriod ?? parsed.period, 2, 99, 20)
      let long = clampInt(parsed.longPeriod, 3, 100, 50)
      if (short > long) [short, long] = [long, short]
      if (short === long) long = Math.min(100, short * 2)
      return { type: 'technical', indicator: 'ma_cross_dual', shortPeriod: short, longPeriod: long }
    }
    case 'rsi_reversal':
      return { type: 'technical', indicator: 'rsi_reversal', period: clampInt(parsed.period, 2, 50, 14) }
    case 'macd_cross':
      return { type: 'technical', indicator: 'macd_cross' }
    case 'bb_break':
      return { type: 'technical', indicator: 'bb_break', period: clampInt(parsed.period, 2, 200, 20) }
    case 'hl_break':
      return { type: 'technical', indicator: 'hl_break', period: clampInt(parsed.period, 5, 100, 20) }
    case 'stoch_cross':
      return { type: 'technical', indicator: 'stoch_cross', period: clampInt(parsed.period, 5, 50, 14) }
    case 'roc_signal':
      return { type: 'technical', indicator: 'roc_signal', period: clampInt(parsed.period, 2, 100, 12) }
    default: {
      const never: never = id
      throw new InterpretError(cannotInterpretMessage(`未対応のルールID ${JSON.stringify(never)}`))
    }
  }
}

function buildPrompt(req: LegacyReportRequest): string {
  const catalogText = ALL_RULE_IDS.map(id => `- "${id}": ${RULE_CATALOG[id]}`).join('\n')

  const hintText = req.indicators.length > 0
    ? `ユーザーは次の指標ファミリーをヒントとしてチェックしています（優先的に検討）: ${req.indicators.map(i => HINT_RULES[i]).join(', ')}
※ これはあくまでヒント。理論の文章がヒントと異なるルールを指している場合は、文章に最も合うルールを優先すること。`
    : 'ヒントなし（チェック未選択）。理論の文章だけから最も合うルールを選ぶこと。'

  const maHint = req.maPeriod ? `\nユーザーが指定したMA期間の希望: ${req.maPeriod}日（MA系ルールを選ぶ場合の参考）` : ''

  return `あなたは投資理論の解釈エンジンです。ユーザーの自由記述の投資理論を読み、以下のルールカタログの中から最も合致する1つのバックテスト実行ルールに変換してください。

【ユーザーの理論】
${req.theoryText}

【ルールカタログ（全${ALL_RULE_IDS.length}種）】
${catalogText}

【ユーザーのヒント（任意）】
${hintText}${maHint}

【解釈の方針】
- 表現が曖昧でも、クロス・ブレイク・水準・勢いなど技術的なトリガーが読み取れるなら、最も近いルールに柔軟にマッピングする（高い推察力で解釈する）。
- 理論に複数の条件が書かれている場合は、最も主要な1つの技術ルールを選び、拾えなかった条件は必ずnoteに明記する。
- 技術的な売買トリガーが本当に読み取れない場合（純粋なファンダメンタルズのみ・意味不明な文章）のみ indicator: null を返す。無理にこじつけない。

【例1】
理論:「ボリンジャーバンドを上に抜けたら勢いに乗って買う。利確のタイミングはMACDも見たい」
出力: {"indicator": "bb_break", "period": 20, "shortPeriod": null, "longPeriod": null, "note": "主要トリガーはボリンジャーバンド上限の上抜けと解釈しbb_breakを選択。『利確はMACDも見たい』の部分は単一ルールでは反映できないため未反映。"}

【例2】
理論:「25日線が75日線を上抜けるゴールデンクロスは強い買いシグナルだと思う」
出力: {"indicator": "ma_cross_dual", "period": null, "shortPeriod": 25, "longPeriod": 75, "note": "短期25日MAと長期75日MAのゴールデンクロス/デッドクロスとして解釈。"}

【出力形式】以下のJSONのみを返してください:
\`\`\`json
{
  "indicator": "ルールID（カタログのいずれか1つ）または null",
  "period": 数値またはnull,
  "shortPeriod": 数値またはnull（ma_cross_dualのみ）,
  "longPeriod": 数値またはnull（ma_cross_dualのみ）,
  "note": "理論をどう解釈してこのルールにマッピングしたか（日本語2〜3文。拾えなかった条件があれば明記）"
}
\`\`\``
}

/**
 * Ask the interpreter model to pick the single best-matching rule from the
 * FULL catalog (checked indicators are a soft hint only), then validate
 * strictly and clamp the periods.
 */
export async function interpretTheory(req: LegacyReportRequest): Promise<InterpretedTheory> {
  const text = await callReportClaude(buildPrompt(req), { model: INTERPRET_MODEL, maxTokens: 600 })

  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) ?? text.match(/(\{[\s\S]*\})/)
  if (!jsonMatch) {
    throw new InterpretError('理論の解釈結果（JSON）を取得できませんでした')
  }

  let parsed: ParsedInterpretation
  try {
    parsed = JSON.parse(jsonMatch[1])
  } catch {
    throw new InterpretError('理論の解釈結果のJSONを解析できませんでした')
  }

  const indicator = parsed.indicator
  if (indicator === null || indicator === undefined) {
    const reason = typeof parsed.note === 'string' && parsed.note.trim()
      ? parsed.note.trim()
      : '技術的な売買条件を読み取れませんでした'
    throw new InterpretError(cannotInterpretMessage(reason))
  }
  if (typeof indicator !== 'string' || !ALL_RULE_IDS.includes(indicator as IndicatorId)) {
    throw new InterpretError(cannotInterpretMessage(`解釈結果が未対応のルールでした（${String(indicator)}）`))
  }

  const note = typeof parsed.note === 'string' && parsed.note.trim()
    ? parsed.note.trim()
    : '（解釈メモなし）'

  return { condition: buildCondition(indicator as IndicatorId, parsed, req), note }
}
