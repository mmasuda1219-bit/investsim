// S5a スモーク: lib/screen/rank.ts の純関数ロジックを検証する（I/Oなし・実ネットワーク不要）。
// 合成キャッシュ行はテスト用途のみ（COMPANY.md 原則9の範囲内）。実プリセットの
// CompositeCondition（lib/backtest/presets.ts / investor-presets.ts）をそのまま
// 再利用し、rank.ts 側で新しい条件を発明していないことも間接的に確認する。
//
// 実行: npx tsx scripts/check-screen-rank.ts
import { rankCandidates } from '../lib/screen/rank'
import { NEEDS_PRESETS } from '../lib/backtest/presets'
import { INVESTOR_PRESETS } from '../lib/backtest/investor-presets'
import type { CachedFundamentalRow } from '../lib/screen/types'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  PASS ${name}`)
  } else {
    failures++
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const NOW = new Date('2026-07-22T00:00:00.000Z')

function row(symbol: string, metrics: CachedFundamentalRow['metrics'], daysAgo: number, source = 'test'): CachedFundamentalRow {
  const fetchedAt = new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString()
  return { symbol, metrics, source, fetchedAt }
}

async function main() {
  // ── 1) aggressive（marketCap lte 10e9 → 第2キー昇順）: 通過2件＋不通過1件 ──
  {
    const rows: CachedFundamentalRow[] = [
      row('SMALL_A', { marketCap: 5e9 }, 1),  // pass, 5B
      row('SMALL_B', { marketCap: 2e9 }, 1),  // pass, 2B（最小＝昇順で先頭）
      row('BIG_C',   { marketCap: 20e9 }, 1), // fail（marketCap条件を満たさない）
    ]
    const { candidates, meta } = rankCandidates(rows, NEEDS_PRESETS.aggressive.condition, { staleDays: 14, limit: 10, now: NOW })

    check('aggressive: 3件とも評価対象（stale/no_data無し）', meta.evaluatedCount === 3, `got ${meta.evaluatedCount}`)
    check('aggressive: 第1キー=通過数 → BIG_C(0件)は最後', candidates[2]?.symbol === 'BIG_C', JSON.stringify(candidates.map(c => c.symbol)))
    check(
      'aggressive: 第2キー=marketCap昇順（通過組内でSMALL_Bが先頭）',
      candidates[0]?.symbol === 'SMALL_B' && candidates[1]?.symbol === 'SMALL_A',
      JSON.stringify(candidates.map(c => c.symbol)),
    )
    check('aggressive: passedCount/totalFiltersが正しい', candidates[0]?.passedCount === 1 && candidates[0]?.totalFilters === 1)
    check('aggressive: BIG_Cはpassedカウント0', candidates[2]?.passedCount === 0)
    check('aggressive: 順位理由が実測値を引用', /2\.0B|2\.00B|2\.0x|marketCap/.test(candidates[0].reason) || /時価総額/.test(candidates[0].reason))
  }

  // ── 2) stable（marketCap gte 100e9 → 第2キー降順） ──
  {
    const rows: CachedFundamentalRow[] = [
      row('MEGA_X', { marketCap: 500e9 }, 1),
      row('MEGA_Y', { marketCap: 1000e9 }, 1),
    ]
    const { candidates } = rankCandidates(rows, NEEDS_PRESETS.stable.condition, { staleDays: 14, limit: 10, now: NOW })
    check(
      'stable: 第2キー=marketCap降順（大きい方が先頭）',
      candidates[0]?.symbol === 'MEGA_Y' && candidates[1]?.symbol === 'MEGA_X',
      JSON.stringify(candidates.map(c => c.symbol)),
    )
  }

  // ── 3) income（dividendYield gte 0.03 → 第2キー降順） ──
  {
    const rows: CachedFundamentalRow[] = [
      row('DIV_LO', { dividendYield: 0.031 }, 1),
      row('DIV_HI', { dividendYield: 0.055 }, 1),
    ]
    const { candidates } = rankCandidates(rows, NEEDS_PRESETS.income.condition, { staleDays: 14, limit: 10, now: NOW })
    check(
      'income: 第2キー=dividendYield降順',
      candidates[0]?.symbol === 'DIV_HI' && candidates[1]?.symbol === 'DIV_LO',
      JSON.stringify(candidates.map(c => c.symbol)),
    )
  }

  // ── 4) investor: buffett(roe gte→降順) / graham(pe lte→昇順) / lynch(earningsGrowth gte→降順) ──
  {
    const rows: CachedFundamentalRow[] = [
      row('ROE_LO', { roe: 0.12, debtToEquity: 100, pe: 20 }, 1),
      row('ROE_HI', { roe: 0.30, debtToEquity: 100, pe: 20 }, 1),
    ]
    const { candidates } = rankCandidates(rows, INVESTOR_PRESETS.buffett.condition, { staleDays: 14, limit: 10, now: NOW })
    check(
      'buffett: 第2キー=roe降順（先頭フィルタがroe gte）',
      candidates[0]?.symbol === 'ROE_HI' && candidates[0]?.rankMetric === 'roe' && candidates[0]?.rankDirection === 'desc',
      JSON.stringify(candidates.map(c => ({ s: c.symbol, m: c.rankMetric, d: c.rankDirection }))),
    )
  }
  {
    const rows: CachedFundamentalRow[] = [
      row('PE_HI', { pe: 18, pb: 2, currentRatio: 1.5 }, 1),
      row('PE_LO', { pe: 9,  pb: 2, currentRatio: 1.5 }, 1),
    ]
    const { candidates } = rankCandidates(rows, INVESTOR_PRESETS.graham.condition, { staleDays: 14, limit: 10, now: NOW })
    check(
      'graham: 第2キー=pe昇順（先頭フィルタがpe lte）',
      candidates[0]?.symbol === 'PE_LO' && candidates[0]?.rankMetric === 'pe' && candidates[0]?.rankDirection === 'asc',
      JSON.stringify(candidates.map(c => ({ s: c.symbol, m: c.rankMetric, d: c.rankDirection }))),
    )
  }
  {
    const rows: CachedFundamentalRow[] = [
      row('EG_LO', { earningsGrowth: 0.11, revenueGrowth: 0.06, pe: 30 }, 1),
      row('EG_HI', { earningsGrowth: 0.40, revenueGrowth: 0.06, pe: 30 }, 1),
    ]
    const { candidates } = rankCandidates(rows, INVESTOR_PRESETS.lynch.condition, { staleDays: 14, limit: 10, now: NOW })
    check(
      'lynch: 第2キー=earningsGrowth降順（先頭フィルタがearningsGrowth gte）',
      candidates[0]?.symbol === 'EG_HI' && candidates[0]?.rankMetric === 'earningsGrowth' && candidates[0]?.rankDirection === 'desc',
      JSON.stringify(candidates.map(c => ({ s: c.symbol, m: c.rankMetric, d: c.rankDirection }))),
    )
  }

  // ── 5) 辞書式（合成スコアなし）: 通過数が少なくても常に上位。第2キーの値が
  //     どれだけ良くても、第1キー(通過数)を逆転できないことを確認する ──
  {
    const rows: CachedFundamentalRow[] = [
      // buffett: roe>=0.10, debtToEquity<=200, pe<=35 の3条件
      row('TWO_OF_THREE',  { roe: 0.50, debtToEquity: 100, pe: 999 }, 1),  // roe超高だがpe不通過 → 2/3
      row('ALL_THREE_LOW', { roe: 0.11, debtToEquity: 100, pe: 34 }, 1),   // roe控えめだが全通過 → 3/3
    ]
    const { candidates } = rankCandidates(rows, INVESTOR_PRESETS.buffett.condition, { staleDays: 14, limit: 10, now: NOW })
    check(
      '辞書式: 通過数(3/3)が第2キーの値より優先される（架空の重み付けをしない）',
      candidates[0]?.symbol === 'ALL_THREE_LOW' && candidates[0]?.passedCount === 3 && candidates[1]?.passedCount === 2,
      JSON.stringify(candidates.map(c => ({ s: c.symbol, passed: c.passedCount }))),
    )
  }

  // ── 6) 同値タイブレーク: symbol昇順で決定的 ──
  {
    const rows: CachedFundamentalRow[] = [
      row('ZZZ', { marketCap: 5e9 }, 1),
      row('AAA', { marketCap: 5e9 }, 1),
    ]
    const { candidates } = rankCandidates(rows, NEEDS_PRESETS.aggressive.condition, { staleDays: 14, limit: 10, now: NOW })
    check(
      '同値タイブレーク: symbol昇順（AAAが先頭）',
      candidates[0]?.symbol === 'AAA' && candidates[1]?.symbol === 'ZZZ',
      JSON.stringify(candidates.map(c => c.symbol)),
    )
  }

  // ── 7) 鮮度切れ除外（fail-closed） ──
  {
    const rows: CachedFundamentalRow[] = [
      row('FRESH', { marketCap: 5e9 }, 1),   // 1日前 → 評価対象
      row('STALE', { marketCap: 5e9 }, 30),  // 30日前 → 閾値14日を超過 → 除外
    ]
    const { candidates, meta } = rankCandidates(rows, NEEDS_PRESETS.aggressive.condition, { staleDays: 14, limit: 10, now: NOW })
    check('鮮度切れ: STALEはランキングから除外される', candidates.every(c => c.symbol !== 'STALE'), JSON.stringify(candidates.map(c => c.symbol)))
    check('鮮度切れ: excludedStaleCountが1', meta.excludedStaleCount === 1, `got ${meta.excludedStaleCount}`)
    check('鮮度切れ: evaluatedCountは1（FRESHのみ）', meta.evaluatedCount === 1, `got ${meta.evaluatedCount}`)
  }

  // ── 8) no_data除外（fail-closed・架空データで穴埋めしない） ──
  {
    const rows: CachedFundamentalRow[] = [
      row('HAS_DATA', { roe: 0.20, debtToEquity: 100, pe: 20 }, 1),
      row('MISSING_ROE', { debtToEquity: 100, pe: 20 }, 1), // roeが無い → buffett条件でno_data
    ]
    const { candidates, meta } = rankCandidates(rows, INVESTOR_PRESETS.buffett.condition, { staleDays: 14, limit: 10, now: NOW })
    check('no_data: MISSING_ROEはランキングから除外される', candidates.every(c => c.symbol !== 'MISSING_ROE'), JSON.stringify(candidates.map(c => c.symbol)))
    check('no_data: excludedNoDataCountが1', meta.excludedNoDataCount === 1, `got ${meta.excludedNoDataCount}`)
    check('no_data: HAS_DATAは評価される', candidates.some(c => c.symbol === 'HAS_DATA'))
  }

  // ── 9) TOP N上限（limit）: 内訳(meta)はlimit適用前の全体を反映 ──
  {
    const rows: CachedFundamentalRow[] = [
      row('T1', { marketCap: 1e9 }, 1),
      row('T2', { marketCap: 2e9 }, 1),
      row('T3', { marketCap: 3e9 }, 1),
    ]
    const { candidates, meta } = rankCandidates(rows, NEEDS_PRESETS.aggressive.condition, { staleDays: 14, limit: 2, now: NOW })
    check('limit: candidatesは2件に切られる', candidates.length === 2, `got ${candidates.length}`)
    check('limit: meta.evaluatedCountはlimit適用前の3件', meta.evaluatedCount === 3, `got ${meta.evaluatedCount}`)
    check('limit: 昇順の上位2件(T1,T2)が返る', candidates[0]?.symbol === 'T1' && candidates[1]?.symbol === 'T2', JSON.stringify(candidates.map(c => c.symbol)))
  }

  // ── 10) 空配列（キャッシュ0件）でも例外にならず0件応答 ──
  {
    const { candidates, meta } = rankCandidates([], NEEDS_PRESETS.stable.condition, { staleDays: 14, limit: 10, now: NOW })
    check('空キャッシュ: candidatesは空配列', candidates.length === 0)
    check('空キャッシュ: meta.totalCached/evaluatedCountともに0', meta.totalCached === 0 && meta.evaluatedCount === 0)
  }

  console.log(failures === 0 ? '\n全PASS' : `\n${failures}件FAIL`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
