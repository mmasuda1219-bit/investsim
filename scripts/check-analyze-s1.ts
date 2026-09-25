// /analyze S1 スモーク: /lab（無料プレビュー）と /report（AIレポート）を単一の
// CompositeCondition で橋渡しする背骨が壊れていないことを検証する。
// - ニーズ軸プリセットから取り出した CompositeCondition が /api/report/prepare の
//   parseCompositeCondition（既存の検証関数）をそのまま通ること（未加工で通る＝
//   新しい条件を発明していないことの裏付け）。
// - クイック→レポートの入力整合（symbol/initialCapital の形が report prepare の
//   受け入れ条件を満たすこと）。
// - モードガード: /analyze のモード/範囲タブ設定でプロ・投資家モデル・銘柄指定なし
//   が disabled のまま（未配線）であること。
// ネットワーク・実API不要（合成データはこのスモーク限定 — COMPANY.md 原則9の範囲内）。
//
// 実行: npx tsx scripts/check-analyze-s1.ts

import { NEEDS_PRESETS, NEEDS_PRESET_IDS, getNeedsPresetCondition } from '../lib/backtest/presets'
import { parseCompositeCondition, ValidationError } from '../lib/report/validate'
import { ANALYZE_MODE_TABS, ANALYZE_SCOPE_OPTIONS } from '../app/learn/page'
import { SHOW_INVESTOR_MODELS } from '../lib/features'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  PASS ${name}`)
  } else {
    failures++
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

// ── 1. getNeedsPresetCondition — 変換なしでプリセットのconditionをそのまま返す ──
console.log('getNeedsPresetCondition — プリセットの CompositeCondition をそのまま取り出す')
{
  for (const id of NEEDS_PRESET_IDS) {
    const got = getNeedsPresetCondition(id)
    check(`${id}: NEEDS_PRESETS[${id}].condition と同一（参照）`, got === NEEDS_PRESETS[id].condition)
  }
}

// ── 2. /api/report/prepare の parseCompositeCondition をそのまま通る ─────────
console.log('parseCompositeCondition(getNeedsPresetCondition(id)) — 未加工で正常に通る')
{
  for (const id of NEEDS_PRESET_IDS) {
    const condition = getNeedsPresetCondition(id)
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
    check(`${id}: derivedFilters は空（S1スコープ外のまま）`,
      parsed !== null && (parsed.derivedFilters ?? []).length === 0)
  }

  // 未加工の技術条件パラメータもclampされずそのまま通ることを個別確認
  // （プリセットの値が既にvalidateの許容範囲内であることの裏付け）。
  const dual = getNeedsPresetCondition('stable').technical
  const parsedDual = parseCompositeCondition(getNeedsPresetCondition('stable'))
  if (dual.indicator === 'ma_cross_dual' && parsedDual.technical.indicator === 'ma_cross_dual') {
    check('stable: ma_cross_dual の shortPeriod/longPeriod がclampで変わらない',
      parsedDual.technical.shortPeriod === dual.shortPeriod && parsedDual.technical.longPeriod === dual.longPeriod)
  }
}

// ── 3. クイック→レポートの入力整合（symbol/initialCapital の形） ─────────────
// app/learn/page.tsx の runReport() が組み立てるリクエスト形と同じ形を、
// app/api/report/prepare/route.ts が受け入れる symbol 正規表現で検証する
// （ルート側の正規表現をこのスモークにも複製 — ルート自体はS1で変更しない）。
console.log('クイック→レポート入力整合 — symbol/initialCapital が prepare の受け入れ条件を満たす')
{
  const SYMBOL_RE = /^[A-Z0-9.\-]{1,15}$/
  const sampleSymbols = ['AAPL', 'msft', 'nvda', '7203.T']
  for (const raw of sampleSymbols) {
    const symbol = raw.trim().toUpperCase()
    check(`symbol "${raw}" → "${symbol}" は prepare の正規表現に一致`, SYMBOL_RE.test(symbol))
  }

  for (const id of NEEDS_PRESET_IDS) {
    const capital = Number('100000') || undefined
    const request = { symbol: 'AAPL', condition: getNeedsPresetCondition(id), initialCapital: capital }
    check(`${id}: initialCapital は正の有限数`,
      typeof request.initialCapital === 'number' && Number.isFinite(request.initialCapital) && request.initialCapital > 0)
    // prepare route 自身のバリデーションを最終確認として通す
    let ok = true
    try {
      parseCompositeCondition(request.condition)
    } catch (e) {
      ok = e instanceof ValidationError ? false : (() => { throw e })()
    }
    check(`${id}: レポート組み立てリクエストの condition が prepare の検証を通る`, ok)
  }
}

// ── 4. モードガード — S5aで銘柄指定なし(スクリーニング)も配線済み ──────────────
// S2でプロモード、S3で投資家モデル、S5aで銘柄指定なし(quick/investorのスクリーニング)
// が有効化されたため、disabled 期待値は全て更新済み（S1時点の期待値は逆に
// 「未配線」だったが、これはS2/S3/S5aの承認済みスコープ変更）。
// 2026-09-25 S1b: 投資家モデルのタブは lib/features.ts の SHOW_INVESTOR_MODELS で出し分ける（DECISIONS 2026-09-24 決定(2)）。
// 期待値はベタ書きせず同じ定数から導く（true なら3タブ・false なら2タブで investor は「無い」。disabled で残すのではない）。
const expectedModes = SHOW_INVESTOR_MODELS ? ['quick', 'pro', 'investor'] : ['quick', 'pro']
console.log(`ANALYZE_MODE_TABS / ANALYZE_SCOPE_OPTIONS — 機能するのは ${expectedModes.join('/')} × 銘柄指定あり/なし（SHOW_INVESTOR_MODELS=${SHOW_INVESTOR_MODELS}）`)
{
  check(`モードは${expectedModes.length}種（${expectedModes.join('/')}）で並びもそのまま`, JSON.stringify(ANALYZE_MODE_TABS.map(t => t.id)) === JSON.stringify(expectedModes), ANALYZE_MODE_TABS.map(t => t.id).join(','))
  const quick = ANALYZE_MODE_TABS.find(t => t.id === 'quick')
  const pro = ANALYZE_MODE_TABS.find(t => t.id === 'pro')
  const investor = ANALYZE_MODE_TABS.find(t => t.id === 'investor')
  check('quick は disabled でない（S1で機能する）', quick !== undefined && !quick.disabled)
  check('pro は disabled でない（S2で機能する）', pro !== undefined && !pro.disabled)
  check(SHOW_INVESTOR_MODELS ? 'investor は disabled でない（S3で機能する）' : 'investor はタブに無い（SHOW_INVESTOR_MODELS=false。disabled で残すのではなく外す）',
    SHOW_INVESTOR_MODELS ? investor !== undefined && !investor.disabled : investor === undefined)

  check('範囲は2種（with-symbol/no-symbol）', ANALYZE_SCOPE_OPTIONS.length === 2)
  const withSymbol = ANALYZE_SCOPE_OPTIONS.find(o => o.id === 'with-symbol')
  const noSymbol = ANALYZE_SCOPE_OPTIONS.find(o => o.id === 'no-symbol')
  check('with-symbol は disabled でない（S1で機能する）', withSymbol !== undefined && !withSymbol.disabled)
  check('no-symbol は disabled でない（S5aでquick/investorのスクリーニングが機能する。proは非対応でUI内メッセージ表示）', noSymbol !== undefined && !noSymbol.disabled)
}

// ── 結果 ─────────────────────────────────────────────────────────────────────
console.log('')
if (failures > 0) {
  console.error(`NG: ${failures}件のチェックが失敗しました`)
  process.exit(1)
}
console.log('OK: 全チェック合格（/analyze S1）')
