// /lab S1 スモーク: ニーズ軸プリセット写像の妥当性（実在ルール・実在フィルタのみ）、
// リクエスト検証＋モード排他ガード（needsへのカスタム条件同梱→400相当の拒否）、
// ファンダゲートの fail-closed（fail時はバックテスト不実行の前提条件）を検証する。
// ネットワーク・実API不要（合成バーはテスト用途のみ — COMPANY.md原則9の範囲内）。
//
// 実行: npx tsx scripts/check-lab-presets.ts

import { NEEDS_PRESETS, NEEDS_PRESET_IDS, isNeedsPresetId, parseLabRequest } from '../lib/backtest/presets'
import { evaluateFundamentalGate, FUNDAMENTAL_METRICS } from '../lib/backtest/fundamental'
import { evaluateTechnical } from '../lib/backtest/rules'
import type { HistoricalBar, FundamentalsData } from '../types'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  PASS ${name}`)
  } else {
    failures++
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

// 合成日足バー（テスト専用）: サイン波＋緩やかな上昇トレンドで各ルールの
// クロス/ブレイクが発生しうる系列。300本 = ma_cross(200) の warm-up(202本) を満たす。
function syntheticBars(n: number): HistoricalBar[] {
  const bars: HistoricalBar[] = []
  const t0 = 1_600_000_000
  for (let i = 0; i < n; i++) {
    const base = 100 + i * 0.05 + 10 * Math.sin(i / 12)
    bars.push({
      time: t0 + i * 86_400,
      open: base - 0.5,
      high: base + 1.2,
      low: base - 1.2,
      close: base,
      volume: 1_000_000,
    })
  }
  return bars
}

// ── 1. プリセット写像: 実在ルール・実在フィルタのみ ─────────────────────────
console.log('NEEDS_PRESETS — 実在テクニカルルール・実在ファンダフィルタのみ使用')
{
  const bars = syntheticBars(300)
  const OPS = new Set(['gt', 'lt', 'gte', 'lte'])

  check('プリセットは3種（stable/income/aggressive）',
    NEEDS_PRESET_IDS.length === 3 &&
    NEEDS_PRESET_IDS.includes('stable') && NEEDS_PRESET_IDS.includes('income') && NEEDS_PRESET_IDS.includes('aggressive'))

  for (const id of NEEDS_PRESET_IDS) {
    const p = NEEDS_PRESETS[id]

    // テクニカル: 実装済み evaluator で例外なく評価できる（発明ルールなら throw / 型不整合）
    let signals: unknown[] | null = null
    try {
      signals = evaluateTechnical(bars, p.condition.technical)
    } catch (e) {
      signals = null
    }
    check(`${id}: テクニカル(${p.condition.technical.indicator})が実在evaluatorで実行可能`,
      Array.isArray(signals) && signals.length === bars.length)

    // ファンダ: 実在メトリック・実在演算子・有限値のみ
    const filtersOk = p.condition.fundamentalFilters.every(f =>
      (FUNDAMENTAL_METRICS as string[]).includes(f.metric) &&
      OPS.has(f.operator) &&
      Number.isFinite(f.value),
    )
    check(`${id}: ファンダフィルタが実在メトリックのみ`, filtersOk)
    check(`${id}: derivedFilters なし（S1スコープ外）`, p.condition.derivedFilters === undefined)

    // 表示用メタデータ
    check(`${id}: label/description/conditionNotes が非空`,
      p.label.length > 0 && p.description.length > 0 && p.conditionNotes.length > 0)
    check(`${id}: 期間は '1y' | '5y' の実在期間`, p.period === '1y' || p.period === '5y')
  }

  // 個別の閾値（単位が生値 = FundamentalsData と同じであること）
  check('stable: 時価総額 ≥ 1000億（生値 100e9・gte）',
    NEEDS_PRESETS.stable.condition.fundamentalFilters.some(f => f.metric === 'marketCap' && f.operator === 'gte' && f.value === 100e9))
  check('income: 配当利回り ≥ 3%（生値 0.03・gte）',
    NEEDS_PRESETS.income.condition.fundamentalFilters.some(f => f.metric === 'dividendYield' && f.operator === 'gte' && f.value === 0.03))
  check('aggressive: 時価総額 ≤ 100億（生値 10e9・lte）',
    NEEDS_PRESETS.aggressive.condition.fundamentalFilters.some(f => f.metric === 'marketCap' && f.operator === 'lte' && f.value === 10e9))
  check('aggressive: hl_break（Donchianブレイク）',
    NEEDS_PRESETS.aggressive.condition.technical.indicator === 'hl_break')

  check('isNeedsPresetId: 有効IDでtrue・未知IDでfalse',
    isNeedsPresetId('stable') && !isNeedsPresetId('daytrade') && !isNeedsPresetId(1) && !isNeedsPresetId(['stable']))
}

// ── 2. parseLabRequest — 検証＋モード排他ガード ──────────────────────────────
console.log('parseLabRequest — モード分岐と排他ガード（400相当の拒否）')
{
  // 正常系
  const tech = parseLabRequest({ symbol: 'aapl', condition: { period: 50 }, initialCapital: 200_000 })
  check('technical(mode省略=従来動作): ok・ma_cross・period=50・大文字化',
    tech.ok && tech.request.mode === 'technical' &&
    tech.request.condition.indicator === 'ma_cross' && tech.request.condition.period === 50 &&
    tech.request.symbol === 'AAPL' && tech.request.initialCapital === 200_000)

  const needs = parseLabRequest({ mode: 'needs', symbol: 'MSFT', presetId: 'income' })
  check('needs: ok・presetId=income・資金デフォルト100,000',
    needs.ok && needs.request.mode === 'needs' && needs.request.presetId === 'income' && needs.request.initialCapital === 100_000)

  const inv = parseLabRequest({ mode: 'investor', symbol: 'KO' })
  check('investor: parseはok（ルートが501を返す）', inv.ok && inv.request.mode === 'investor')

  // ── 排他ガード ──
  const needsWithCond = parseLabRequest({
    mode: 'needs', symbol: 'AAPL', presetId: 'stable',
    condition: { type: 'technical', indicator: 'ma_cross', period: 5 },
  })
  check('needs + カスタムcondition同梱 → 400拒否',
    !needsWithCond.ok && needsWithCond.status === 400)

  const invWithCond = parseLabRequest({
    mode: 'investor', symbol: 'AAPL',
    condition: { type: 'technical', indicator: 'ma_cross', period: 5 },
  })
  check('investor + カスタムcondition同梱 → 400拒否',
    !invWithCond.ok && invWithCond.status === 400)

  const arrayPreset = parseLabRequest({ mode: 'needs', symbol: 'AAPL', presetId: ['stable', 'income'] })
  check('presetIdが配列（複数指定）→ 400拒否', !arrayPreset.ok && arrayPreset.status === 400)

  const noPreset = parseLabRequest({ mode: 'needs', symbol: 'AAPL' })
  check('needsでpresetId欠落 → 400拒否', !noPreset.ok && noPreset.status === 400)

  const badPreset = parseLabRequest({ mode: 'needs', symbol: 'AAPL', presetId: 'daytrade' })
  check('未知presetId → 400拒否', !badPreset.ok && badPreset.status === 400)

  const badMode = parseLabRequest({ mode: 'hybrid', symbol: 'AAPL', presetId: 'stable' })
  check('未知mode → 400拒否', !badMode.ok && badMode.status === 400)

  // 入力バリデーション
  const noSymbol = parseLabRequest({ mode: 'needs', presetId: 'stable' })
  check('symbol欠落 → 400拒否', !noSymbol.ok && noSymbol.status === 400)
  const badSymbol = parseLabRequest({ mode: 'needs', symbol: 'AA PL;drop', presetId: 'stable' })
  check('不正symbol → 400拒否', !badSymbol.ok && badSymbol.status === 400)
  const notObject = parseLabRequest('needs')
  check('非オブジェクトbody → 400拒否', !notObject.ok && notObject.status === 400)
  const bigCapital = parseLabRequest({ mode: 'needs', symbol: 'AAPL', presetId: 'stable', initialCapital: 99_999_999_999 })
  check('過大な資金は10,000,000にクランプ',
    bigCapital.ok && bigCapital.request.initialCapital === 10_000_000)
}

// ── 3. ファンダゲート — fail時バックテスト不実行の前提（fail-closed） ───────
// ルート実装は gate.passed === true のときだけ runBacktest を呼ぶ
// （app/api/lab/backtest/route.ts — !gate.passed なら result:null で早期return）。
// ここではその判定入力である gate.passed が正しく倒れることを検証する。
console.log('evaluateFundamentalGate × プリセット — pass / fail(実測値つき) / no_data')
{
  // stable（時価総額 ≥ 1000億）: 大型株は成立
  const mega: FundamentalsData = { marketCap: 3e12 }
  const gPass = evaluateFundamentalGate(mega, NEEDS_PRESETS.stable.condition.fundamentalFilters)
  check('stable: 時価総額3兆でpass（バックテスト実行対象）',
    gPass.passed && gPass.evaluations[0].result === 'pass' && gPass.evaluations[0].actual === 3e12)

  // stable: 小型株は不成立（実測値が返る → ルートはバックテストせず理由を返す）
  const small: FundamentalsData = { marketCap: 5e9 }
  const gFail = evaluateFundamentalGate(small, NEEDS_PRESETS.stable.condition.fundamentalFilters)
  check('stable: 時価総額50億でfail・実測値つき（バックテスト不実行）',
    !gFail.passed && gFail.evaluations[0].result === 'fail' && gFail.evaluations[0].actual === 5e9)

  // income: 無配（データなし）は no_data → fail-closed（モック値で判定しない）
  const noDiv: FundamentalsData = { marketCap: 2e12 }
  const gNoData = evaluateFundamentalGate(noDiv, NEEDS_PRESETS.income.condition.fundamentalFilters)
  check('income: 配当データなしはno_dataでfail-closed（バックテスト不実行）',
    !gNoData.passed && gNoData.evaluations[0].result === 'no_data' && gNoData.evaluations[0].actual === undefined)

  // income: 配当4%は成立
  const highDiv: FundamentalsData = { dividendYield: 0.04 }
  const gDiv = evaluateFundamentalGate(highDiv, NEEDS_PRESETS.income.condition.fundamentalFilters)
  check('income: 配当利回り4%でpass', gDiv.passed && gDiv.evaluations[0].result === 'pass')

  // aggressive: 中小型のみ（メガキャップは不成立）
  const gAggFail = evaluateFundamentalGate(mega, NEEDS_PRESETS.aggressive.condition.fundamentalFilters)
  check('aggressive: 時価総額3兆はfail（中小型のみ参加）', !gAggFail.passed)
  const gAggPass = evaluateFundamentalGate(small, NEEDS_PRESETS.aggressive.condition.fundamentalFilters)
  check('aggressive: 時価総額50億はpass', gAggPass.passed)

  // ファンダ全欠落（getFundamentalsのallowMock:false失敗時は {}）→ 全プリセットでfail-closed
  for (const id of NEEDS_PRESET_IDS) {
    const g = evaluateFundamentalGate({}, NEEDS_PRESETS[id].condition.fundamentalFilters)
    check(`${id}: ファンダ取得不可({})でfail-closed`, !g.passed && g.evaluations.every(e => e.result === 'no_data'))
  }
}

// ── 結果 ─────────────────────────────────────────────────────────────────────
if (failures > 0) {
  console.error(`\n${failures} 件のチェックが失敗しました。`)
  process.exit(1)
}
console.log('\n全チェックPASS')
