// /analyze S3 スモーク: 投資家モデル連動（バフェット/グレアム/リンチ）を検証する。
// ネットワーク・実API不要（合成データはこのスモーク限定 — COMPANY.md 原則9の範囲内）。
//
// 検証内容:
// 1. 各投資家プリセットが実在の FundamentalMetric / DerivedMetric / technical8種
//    のみを使用している（架空の指標・複合指標を発明していないことのホワイトリスト検証）。
// 2. CompositeCondition.technical が必須（欠落していない）・実在 evaluateTechnical に
//    例外なく写像できる（check-analyze-pro.tsのBASELINE_TRIGGERS検証と同じ手法）。
// 3. 各プリセットの CompositeCondition が /api/report/prepare の parseCompositeCondition
//    をそのまま（未加工で）通る（新しい条件を発明していないことの裏付け・check-analyze-s1.ts
//    と同じ手法）。
// 4. getInvestorPresetCondition / isInvestorModelId が正しく動作し、未知IDは弾かれる。
// 5. philosophy・rationale・conditionNotes・approximationNotes が全モデルで非空
//    （「信念を土台にする」「信念と実装のギャップを正直に注記する」というオーナー要望の
//    構造的な担保）。
// 6. 決算派生条件（derivedFilters）は各モデル2〜3個に絞られている（fail-closedで
//    大半が不成立になるのを避けるための保守的な絞り込み方針の検証）。
//
// 実行: npx tsx scripts/check-analyze-s3.ts

import {
  INVESTOR_PRESETS,
  INVESTOR_PRESET_IDS,
  getInvestorPresetCondition,
  isInvestorModelId,
} from '../lib/backtest/investor-presets'
import { FUNDAMENTAL_METRICS, DERIVED_METRICS } from '../lib/backtest/fundamental'
import { evaluateTechnical } from '../lib/backtest/rules'
import { parseCompositeCondition } from '../lib/report/validate'
import type { HistoricalBar } from '../types'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  PASS ${name}`)
  } else {
    failures++
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

// 実サポート対象indicatorのホワイトリスト（lib/backtest/rules.tsのswitchで実装済みのもの・
// check-analyze-pro.tsと同一リスト）。
const SUPPORTED_INDICATORS = [
  'ma_cross', 'ma_cross_dual', 'rsi_reversal', 'macd_cross',
  'bb_break', 'hl_break', 'stoch_cross', 'roc_signal',
]

console.log('INVESTOR_PRESETS — 3モデル(バフェット/グレアム/リンチ)が定義されている')
{
  check('INVESTOR_PRESET_IDS に3種類定義されている', INVESTOR_PRESET_IDS.length === 3)
  check('buffett/graham/lynch が全て存在する',
    ['buffett', 'graham', 'lynch'].every(id => INVESTOR_PRESET_IDS.includes(id as never)))
}

// ── 1. 実在指標のみ使用（架空指標の発明禁止・原則9） ────────────────────────
console.log('各投資家プリセット — 実在する FundamentalMetric / DerivedMetric / technical のみを使用する')
{
  for (const id of INVESTOR_PRESET_IDS) {
    const preset = INVESTOR_PRESETS[id]

    check(`${id}: technical が必須フィールドとして存在する`, preset.condition.technical !== undefined)
    check(`${id}: technical.indicator が実サポート対象（8種のいずれか）`,
      SUPPORTED_INDICATORS.includes(preset.condition.technical.indicator))

    for (const f of preset.condition.fundamentalFilters) {
      check(`${id}: fundamentalFilter「${f.metric}」が実在の FundamentalMetric`,
        FUNDAMENTAL_METRICS.includes(f.metric))
    }

    const derivedFilters = preset.condition.derivedFilters ?? []
    for (const f of derivedFilters) {
      check(`${id}: derivedFilter「${f.metric}」が実在の DerivedMetric`,
        DERIVED_METRICS.includes(f.metric))
    }
  }
}

// ── 6. 決算派生条件は2〜3個に絞られている（保守的な閾値方針の構造チェック） ──
console.log('各投資家プリセット — decisionsの決算派生条件(derivedFilters)は2〜3個に絞られている')
{
  for (const id of INVESTOR_PRESET_IDS) {
    const n = (INVESTOR_PRESETS[id].condition.derivedFilters ?? []).length
    check(`${id}: derivedFilters件数(${n})が2〜3個の範囲内`, n >= 2 && n <= 3)
  }
}

// ── 2. technical が実在 evaluateTechnical に例外なく写像できる ──────────────
console.log('各投資家プリセットの technical — 実在の evaluateTechnical に例外なく写像できる')
{
  // 250本の合成バー（MA200・ゴールデンクロス50x200 の warm-up を満たす長さ）。
  const DAY = 86_400
  const bars: HistoricalBar[] = Array.from({ length: 250 }, (_, i) => {
    const close = 100 + i * 0.3 + Math.sin(i / 7) * 3
    return { time: 1_700_000_000 + i * DAY, open: close, high: close + 0.5, low: close - 0.5, close, volume: 1000 }
  })

  for (const id of INVESTOR_PRESET_IDS) {
    const preset = INVESTOR_PRESETS[id]
    let signals: ReturnType<typeof evaluateTechnical> | null = null
    let threw: unknown = null
    try {
      signals = evaluateTechnical(bars, preset.condition.technical)
    } catch (e) {
      threw = e
    }
    check(`${id} (${preset.condition.technical.indicator}): 実在evaluatorが例外なく実行できる`,
      threw === null, threw instanceof Error ? threw.message : String(threw))
    check(`${id}: シグナル配列がバー数と一致する`, signals !== null && signals.length === bars.length)
  }
}

// ── 3. parseCompositeCondition を未加工で通る ───────────────────────────────
console.log('parseCompositeCondition(getInvestorPresetCondition(id)) — 未加工で正常に通る')
{
  for (const id of INVESTOR_PRESET_IDS) {
    const condition = getInvestorPresetCondition(id)
    check(`${id}: getInvestorPresetCondition が INVESTOR_PRESETS[${id}].condition と同一（参照）`,
      condition === INVESTOR_PRESETS[id].condition)

    let parsed: ReturnType<typeof parseCompositeCondition> | null = null
    let threw: unknown = null
    try {
      parsed = parseCompositeCondition(condition)
    } catch (e) {
      threw = e
    }
    check(`${id}: ValidationErrorを投げずに通る`, threw === null, threw instanceof Error ? threw.message : String(threw))
    check(`${id}: technical.indicator が変化しない`,
      parsed !== null && parsed.technical.indicator === condition.technical.indicator)
    check(`${id}: fundamentalFilters の件数・内容が変化しない`,
      parsed !== null &&
      parsed.fundamentalFilters.length === condition.fundamentalFilters.length &&
      condition.fundamentalFilters.every((f, i) =>
        parsed!.fundamentalFilters[i].metric === f.metric &&
        parsed!.fundamentalFilters[i].operator === f.operator &&
        parsed!.fundamentalFilters[i].value === f.value))
    check(`${id}: derivedFilters の件数・内容が変化しない`,
      parsed !== null &&
      (parsed.derivedFilters ?? []).length === (condition.derivedFilters ?? []).length &&
      (condition.derivedFilters ?? []).every((f, i) =>
        (parsed!.derivedFilters ?? [])[i]?.metric === f.metric &&
        (parsed!.derivedFilters ?? [])[i]?.operator === f.operator &&
        (parsed!.derivedFilters ?? [])[i]?.value === f.value))
  }
}

// ── 4. isInvestorModelId — 不正IDは弾かれる ─────────────────────────────────
console.log('isInvestorModelId — 実在IDのみ true・不正IDは弾かれる')
{
  for (const id of INVESTOR_PRESET_IDS) {
    check(`${id}: isInvestorModelId(${id}) === true`, isInvestorModelId(id))
  }
  check('未知の文字列ID → false', !isInvestorModelId('soros'))
  check('空文字 → false', !isInvestorModelId(''))
  check('数値 → false', !isInvestorModelId(42))
  check('undefined → false', !isInvestorModelId(undefined))
  check('null → false', !isInvestorModelId(null))
  check('配列 → false（複数指定は不可）', !isInvestorModelId(['buffett']))
}

// ── 5. 信念を土台にする構造の担保（philosophy/rationale/conditionNotes/近似注記） ──
console.log('各投資家プリセット — philosophy(信念)・rationale・conditionNotes・approximationNotesが全て非空')
{
  for (const id of INVESTOR_PRESET_IDS) {
    const preset = INVESTOR_PRESETS[id]
    check(`${id}: philosophy（信念）が非空`, preset.philosophy.trim().length > 0)
    check(`${id}: rationale（信念からの導出根拠）が1件以上`, preset.rationale.length > 0)
    check(`${id}: conditionNotes（条件の説明）が1件以上`, preset.conditionNotes.length > 0)
    check(`${id}: approximationNotes（信念と実装のギャップの正直な注記）が1件以上`,
      preset.approximationNotes.length > 0)
    check(`${id}: approximationNotesに「本人の実際の投資判断ではない」旨の注記が含まれる`,
      preset.approximationNotes.some(n => n.includes('実際の投資判断ではな')))
  }

  // 「買い持ち（常時保有）」に相当する未サポート売買基準を、実装済みのように偽装していないこと
  // （check-analyze-pro.tsのBASELINE_TRIGGERS検証と同じ原則9チェック）。
  check('どのプリセットも「買い持ち（常時保有）」をtechnicalの売買基準として偽装していない',
    INVESTOR_PRESET_IDS.every(id => SUPPORTED_INDICATORS.includes(INVESTOR_PRESETS[id].condition.technical.indicator)))
}

// ── 結果 ─────────────────────────────────────────────────────────────────────
console.log('')
if (failures > 0) {
  console.error(`NG: ${failures}件のチェックが失敗しました`)
  process.exit(1)
}
console.log('OK: 全チェック合格（/analyze S3 — 投資家モデル連動）')
