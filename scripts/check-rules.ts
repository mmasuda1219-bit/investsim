// 合成バーで lib/backtest/rules.ts の全8テクニカル評価器の発火を検証するスモーク。
// ネットワーク・実API不要（合成データはテスト用途 — COMPANY.md原則9の範囲内）。
//
// 実行: npx tsx scripts/check-rules.ts
//
// 検証内容:
// 1. ma_cross / ma_cross_dual / hl_break / roc_signal: 手計算の期待シグナル列と完全一致
//    - 特に hl_break は「前日までのN日高値」（当日バー除外＝ルックアヘッド回避）の境界を検証
// 2. rsi_reversal / macd_cross / bb_break / stoch_cross: 合成波形で1回以上発火し、
//    かつ全発火バーが指標値（calc関数で再計算）の定義条件を満たすこと（不変条件チェック）

import { evaluateTechnical } from '../lib/backtest/rules'
import { calcRSI, calcMACD, calcBB, calcStochastic } from '../lib/technicals'
import type { HistoricalBar } from '../types'
import type { TechnicalCondition } from '../lib/backtest/types'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  PASS ${name}`)
  } else {
    failures++
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const DAY = 86_400
function mkBars(closes: number[], highs?: number[], lows?: number[]): HistoricalBar[] {
  return closes.map((c, i) => ({
    time: 1_700_000_000 + i * DAY,
    open: c,
    high: highs?.[i] ?? c + 0.5,
    low: lows?.[i] ?? c - 0.5,
    close: c,
    volume: 1000,
  }))
}

function signalsOf(bars: HistoricalBar[], condition: TechnicalCondition): string[] {
  return evaluateTechnical(bars, condition).map(s => s.signal)
}

// ── 1. ma_cross（既存挙動の回帰確認・手計算期待値）──────────────────────
console.log('ma_cross (period=3) — 既存挙動の回帰')
{
  // closes: [10,10,10,9,15]
  // MA3: i2=10, i3=9.67, i4=11.33
  // i3: prev.close(10)>=maPrev(10) かつ close(9)<maNow(9.67) → sell
  // i4: prev.close(9)<=maPrev(9.67) かつ close(15)>maNow(11.33) → buy
  const sig = signalsOf(mkBars([10, 10, 10, 9, 15]), {
    type: 'technical', indicator: 'ma_cross', period: 3,
  })
  check('期待シグナル列と一致', JSON.stringify(sig) === JSON.stringify(['hold', 'hold', 'hold', 'sell', 'buy']),
    `actual=${JSON.stringify(sig)}`)
}

// ── 2. ma_cross_dual（手計算期待値）─────────────────────────────────────
console.log('ma_cross_dual (short=2, long=3)')
{
  // closes: [10,10,10,14,20]
  // MA2: i1=10, i2=10, i3=12, i4=17 / MA3: i2=10, i3=11.33, i4=14.67
  // i3: sPrev(10)<=lPrev(10) かつ sNow(12)>lNow(11.33) → buy（ゴールデンクロス）
  // i4: クロスなし → hold
  const sig = signalsOf(mkBars([10, 10, 10, 14, 20]), {
    type: 'technical', indicator: 'ma_cross_dual', shortPeriod: 2, longPeriod: 3,
  })
  check('ゴールデンクロスでbuy発火', JSON.stringify(sig) === JSON.stringify(['hold', 'hold', 'hold', 'buy', 'hold']),
    `actual=${JSON.stringify(sig)}`)

  // 下落側: closes [20,20,20,14,10] で i3 にデッドクロス → sell
  const sigDown = signalsOf(mkBars([20, 20, 20, 14, 10]), {
    type: 'technical', indicator: 'ma_cross_dual', shortPeriod: 2, longPeriod: 3,
  })
  check('デッドクロスでsell発火', sigDown[3] === 'sell', `actual=${JSON.stringify(sigDown)}`)
}

// ── 3. hl_break（ルックアヘッド回避の境界検証が本丸）───────────────────
console.log('hl_break (period=3) — 前日までのN日高値/安値（当日除外）')
{
  // 上抜け: highs [10,10,10,10,12] closes [10,10,10,10,10.5]
  // Donchian(i4) = max(high[i1..i3]) = 10（当日high=12は含めない）
  // i4: prev.close(10)<=upper(i3)=10 かつ close(10.5)>upper(i4)=10 → buy
  // もし当日バーを含むバグがあれば upper(i4)=12 となり 10.5>12 は偽 → 発火しない
  const up = signalsOf(
    mkBars([10, 10, 10, 10, 10.5], [10, 10, 10, 10, 12], [9, 9, 9, 9, 10]),
    { type: 'technical', indicator: 'hl_break', period: 3 },
  )
  check('前日まで高値の上抜けでbuy（当日の高値12に阻害されない）', up[4] === 'buy', `actual=${JSON.stringify(up)}`)

  // 等値では発火しない（strictly greater）
  const eq = signalsOf(
    mkBars([10, 10, 10, 10, 10], [10, 10, 10, 10, 10], [9, 9, 9, 9, 9]),
    { type: 'technical', indicator: 'hl_break', period: 3 },
  )
  check('高値と等値では発火しない', eq.every(s => s === 'hold'), `actual=${JSON.stringify(eq)}`)

  // 下抜け: lows [9,9,9,9,8] closes [10,10,10,10,8.5]
  // lower(i4) = min(low[i1..i3]) = 9; prev.close(10)>=9 かつ close(8.5)<9 → sell
  const down = signalsOf(
    mkBars([10, 10, 10, 10, 8.5], [10, 10, 10, 10, 10], [9, 9, 9, 9, 8]),
    { type: 'technical', indicator: 'hl_break', period: 3 },
  )
  check('前日まで安値の下抜けでsell', down[4] === 'sell', `actual=${JSON.stringify(down)}`)

  // warm-up: 最初の period+1 バーは必ず hold
  check('warm-up中はhold', up.slice(0, 4).every(s => s === 'hold'), `actual=${JSON.stringify(up.slice(0, 4))}`)
}

// ── 4. roc_signal（手計算期待値）────────────────────────────────────────
console.log('roc_signal (period=2)')
{
  // closes [10,10,9,10,11] → ROC2: i2=-10%, i3=0%, i4=+22.2%
  // i3: before(-10)<=0 かつ now(0)>0 は偽 → hold / i4: before(0)<=0 かつ now(22.2)>0 → buy
  const sig = signalsOf(mkBars([10, 10, 9, 10, 11]), {
    type: 'technical', indicator: 'roc_signal', period: 2,
  })
  check('0上抜けでbuy（0ちょうどでは発火しない）',
    JSON.stringify(sig) === JSON.stringify(['hold', 'hold', 'hold', 'hold', 'buy']),
    `actual=${JSON.stringify(sig)}`)

  // 下抜け: closes [10,10,11,10,9] → ROC2: i2=+10%, i3=0%, i4=-18.2% → i4 sell
  const sigDown = signalsOf(mkBars([10, 10, 11, 10, 9]), {
    type: 'technical', indicator: 'roc_signal', period: 2,
  })
  check('0下抜けでsell', sigDown[4] === 'sell', `actual=${JSON.stringify(sigDown)}`)
}

// ── 5〜8. 波形データで発火＋不変条件チェック ────────────────────────────
// V字・山型を含む決定的な合成波形（下落→反発→上昇→反落）
function waveBars(): HistoricalBar[] {
  const closes: number[] = []
  for (let i = 0; i < 120; i++) {
    const base = 100 + 20 * Math.sin(i / 12) + 4 * Math.sin(i / 3.1)
    closes.push(parseFloat(base.toFixed(2)))
  }
  return mkBars(closes)
}
const wave = waveBars()

console.log('rsi_reversal (period=14) — 波形で発火＋不変条件')
{
  const sig = evaluateTechnical(wave, { type: 'technical', indicator: 'rsi_reversal', period: 14 })
  const rsiByTime = new Map<number, number>()
  for (const p of calcRSI(wave, 14)) rsiByTime.set(p.time, p.value)
  const fired = sig.filter(s => s.signal !== 'hold')
  check('1回以上発火', fired.length > 0)
  const ok = sig.every((s, i) => {
    if (s.signal === 'hold') return true
    const now = rsiByTime.get(s.time)
    const before = i > 0 ? rsiByTime.get(wave[i - 1].time) : undefined
    if (now === undefined || before === undefined) return false
    return s.signal === 'buy' ? before <= 30 && now > 30 : before >= 70 && now < 70
  })
  check('全発火バーがRSI30/70クロス条件を満たす', ok)
}

console.log('macd_cross — 波形で発火＋不変条件')
{
  const sig = evaluateTechnical(wave, { type: 'technical', indicator: 'macd_cross' })
  const histByTime = new Map<number, number>()
  for (const p of calcMACD(wave)) histByTime.set(p.time, p.histogram)
  const fired = sig.filter(s => s.signal !== 'hold')
  check('1回以上発火', fired.length > 0)
  const ok = sig.every((s, i) => {
    if (s.signal === 'hold') return true
    const now = histByTime.get(s.time)
    const before = i > 0 ? histByTime.get(wave[i - 1].time) : undefined
    if (now === undefined || before === undefined) return false
    return s.signal === 'buy' ? before <= 0 && now > 0 : before >= 0 && now < 0
  })
  check('全発火バーがヒストグラム0クロス条件を満たす', ok)
}

console.log('bb_break (period=20) — スパイク波形で発火＋不変条件')
{
  // BBはスムーズな波では±2σを抜けにくいため、フラット＋急騰急落の専用系列
  const closes = [
    ...Array.from({ length: 30 }, (_, i) => 100 + 0.3 * Math.sin(i)), // ほぼフラット
    110, 111, 112, // 急騰 → 上限突破
    ...Array.from({ length: 10 }, () => 111),
    95, 94, 93, // 急落 → 下限割れ
    ...Array.from({ length: 10 }, () => 94),
  ].map(v => parseFloat(v.toFixed(2)))
  const bars = mkBars(closes)
  const sig = evaluateTechnical(bars, { type: 'technical', indicator: 'bb_break', period: 20 })
  const bandByTime = new Map<number, { upper: number; lower: number }>()
  for (const p of calcBB(bars, 20)) bandByTime.set(p.time, { upper: p.upper, lower: p.lower })
  check('buyとsellが両方発火', sig.some(s => s.signal === 'buy') && sig.some(s => s.signal === 'sell'))
  const ok = sig.every((s, i) => {
    if (s.signal === 'hold') return true
    const now = bandByTime.get(s.time)
    const before = i > 0 ? bandByTime.get(bars[i - 1].time) : undefined
    if (!now || !before || i === 0) return false
    return s.signal === 'buy'
      ? bars[i - 1].close <= before.upper && bars[i].close > now.upper
      : bars[i - 1].close >= before.lower && bars[i].close < now.lower
  })
  check('全発火バーがバンド突破条件を満たす', ok)
}

console.log('stoch_cross (period=14) — 波形で発火＋不変条件')
{
  const sig = evaluateTechnical(wave, { type: 'technical', indicator: 'stoch_cross', period: 14 })
  const stochByTime = new Map<number, { k: number; d: number }>()
  for (const p of calcStochastic(wave, 14)) stochByTime.set(p.time, { k: p.k, d: p.d })
  const fired = sig.filter(s => s.signal !== 'hold')
  check('1回以上発火', fired.length > 0)
  const ok = sig.every((s, i) => {
    if (s.signal === 'hold') return true
    const now = stochByTime.get(s.time)
    const before = i > 0 ? stochByTime.get(wave[i - 1].time) : undefined
    if (!now || !before) return false
    return s.signal === 'buy'
      ? before.k <= before.d && now.k > now.d && now.k <= 30
      : before.k >= before.d && now.k < now.d && now.k >= 70
  })
  check('全発火バーが%K/%Dクロス＋30/70ゾーン条件を満たす', ok)
}

// ── 結果 ─────────────────────────────────────────────────────────────────
console.log('')
if (failures > 0) {
  console.error(`NG: ${failures}件のチェックが失敗しました`)
  process.exit(1)
}
console.log('OK: 全チェック合格（8評価器）')
