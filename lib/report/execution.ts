// /analyze S-C — 「あなたが選んだルールの過去5年の成績」カード（純関数・I/Oなし）。
//
// 旧称は「執行計画カード」だが、法務部門の判定により “AIが執行計画（いつ買う・
// いくら賭ける・どこで損切る）を提示する” 形は金商法2条8項11号ロの「投資判断」
// 6要素を埋めるため無登録では実装できない。そこで主語をユーザーへ移し、
// 「ユーザーが既に選んだ売買ルールが、過去5年の実データで実際にどう動いたか」の
// 実測値だけを出す設計に作り替えた。
//
// 数値の出所は必ず次のどちらかに限る:
//   (a) ユーザー自身が選んだ条件（bundle.request.condition）
//   (b) 過去の実データからの計算（bundle.backtest — 5年実データバックテスト）
// 当社やAIが決めた数値は1つも含めない。迷ったら「この数字は誰が決めたのか？」を
// 問うこと。AI/当社が決めた数字なら入れてはいけない。
//
// 法務由来の禁止事項（このファイルの構造で防いでいるもの）:
// - targetPrice / stopLossPrice / takeProfitPrice / probability / allocationPct /
//   expectedReturnPct に相当するフィールドを型に定義しない（型に無いものは埋められない）。
// - ReaderProfile をこのカードへ一切反映しない（引数にすら取らない）。
// - 「推奨」「おすすめ」「買い時」「売り時」等の語を出力文字列に使わない。
// - ボラティリティ等から「ストップ幅」を逆算しない（存在しないルールを発明しない）。
// - 52週高安に対する現在値の位置・AIトレーダー実績（bundle.aiEvidence）の再掲は
//   入れない（法務が弁護士確認待ちと判定）。
// - 実測値（例: 保有日数中央値）を「◯日で手仕舞う」と読める文脈に置かない —
//   必ず「過去の実績値」であるラベルを付ける。
//
// 勝敗判定の単一真実源: lib/backtest/metrics.ts の pairRoundTrips()（約定額ベース
// t.value 比較）。Tier1 の metrics.winRate と同じ関数から数え、勝率の表示値は
// bundle.backtest.metrics.winRate をそのまま流用する（二重定義しない — 同じ画面に
// 違う勝率が2つ並ぶ事故を構造的に防ぐ）。
//
// CompositeCondition に損切り・利確・保有期間上限のフィールドは存在しない
// （lib/backtest/types.ts）。よって「設定されていません」と無いことを正直に明示する
// のが正しい表示（COMPANY.md 原則9 — 存在しないルールを発明しない）。
//
// lib/report/transparency.ts と同じ位置づけ: PreparedBundle だけを食う純関数。
// 新しいAPI・新しいデータ源・prepare改修はゼロ（すべて bundle に既にある実データ）。
// 保有日数・期間はすべて【暦日】（取引日ベースの日数はクライアントに無いため出せない）。

import type { PreparedBundle } from './types'
import { describeCondition } from './prompt'
import { pairRoundTrips, type RoundTripPair } from '@/lib/backtest/metrics'

const DAY_SECONDS = 86_400
const YEAR_DAYS = 365.25

/** 1つの実測ファクト（label/value/sub）。UIはこれを並べるだけ。 */
export interface PlanFact {
  label: string
  value: string
  /** 母集団n・注記など（実測値には必ず出所/母集団を併記する）。 */
  sub?: string
}

export type ExecutionPlanStatus =
  /** ゲート不成立でバックテスト未実行（bundle.backtest === null）。 */
  | 'no_backtest'
  /** 5年間で売買シグナルが一度も発生しなかった（trades.length === 0）。 */
  | 'no_signals'
  /** 買いのみで完結した往復が0件（未決済1件のみ）。 */
  | 'open_only'
  /** 完結した往復が1〜2件 — 統計語（中央値・平均）を使わず生の一覧を出す。 */
  | 'few_round_trips'
  /** 完結した往復が3件以上 — 中央値・平均などの統計を表示できる。 */
  | 'ready'

/**
 * カードの表示モデル。表示文字列はすべてここで組み立てる（スモークテストが
 * 禁止語・統計語の混入を全文走査できるようにするため）。
 */
export interface ExecutionPlan {
  status: ExecutionPlanStatus
  /** あなたが選んだ売買ルールの言語化（入口＋出口・describeCondition再利用）。 */
  ruleDescription: string
  /** 出口ルールの再掲＋「損切り・利確・保有期限は設定されていません」の明示。 */
  exitLines: string[]
  /** 状態・注意の正直な説明行（fail-closed — 無い数字は無いと書く）。 */
  notes: string[]
  /** 実測ファクト。no_backtest / no_signals では空配列（0や「—」を並べない）。 */
  facts: PlanFact[]
  /** 完結往復が3件未満のときの生一覧（統計語なし）。それ以外は空配列。 */
  rawRoundTrips: string[]
}

/**
 * カード下部に常時表示する注記（折りたたみ禁止・法務由来の必須文言）。
 * ExecutionPlanCard と スモークテストが同じ実体を参照する（単一真実源）。
 * ※この注記自体には「推奨するものではありません」という否定形で「推奨」の字が
 *   含まれる — 禁止語チェックの対象は buildExecutionPlan の出力文字列であり、
 *   この必須注記は対象外（そのまま全文を変更せず表示すること）。
 */
export const EXECUTION_PLAN_NOTE_LINES = [
  'ここに表示されているのは、あなたが選んだ売買ルールを、過去5年の実データにあてはめて機械的に計算した結果です。',
  '当社が特定の売買価格・数量・時期を推奨するものではありません。',
  '数値はあなたの選んだ条件と過去の実データのみから計算しており、当社やAIが独自に決めた数値は含まれていません。',
  '過去に機能したルールが将来も機能することを示すものではありません。',
]

function fmtDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10)
}

/**
 * 符号つき%（+1.23% / -4.56% / 0.00%）。
 * S3: 丸め後が0のときは符号を付けない（「+0.00%」が勝敗表示と矛盾して見えるため）。
 */
function pct2(v: number): string {
  const r = Number(v.toFixed(2))
  if (r > 0) return `+${r.toFixed(2)}%`
  if (r < 0) return `${r.toFixed(2)}%`
  return '0.00%'
}

/** 往復損益%（約定額ベース — 勝敗判定と同じ土俵で計算し、符号のねじれを防ぐ）。 */
function pnlPctOf(p: RoundTripPair): number {
  return p.entry.value > 0 ? ((p.exit.value - p.entry.value) / p.entry.value) * 100 : 0
}

/** 保有日数（暦日・四捨五入）。 */
function holdingDaysOf(p: RoundTripPair): number {
  return Math.round((p.exit.time - p.entry.time) / DAY_SECONDS)
}

/** 整数ならそのまま、半端なら小数1桁（中央値が◯.5日になる場合）。 */
function fmtDays(d: number): string {
  return Number.isInteger(d) ? `${d}` : d.toFixed(1)
}

function medianOf(sortedAsc: number[]): number {
  const mid = Math.floor(sortedAsc.length / 2)
  return sortedAsc.length % 2 === 1 ? sortedAsc[mid] : (sortedAsc[mid - 1] + sortedAsc[mid]) / 2
}

export function buildExecutionPlan(bundle: PreparedBundle): ExecutionPlan {
  const ruleDescription = describeCondition(bundle.request.condition.technical)
  // describeCondition は全テクニカルルールを「〜で買い・〜で売り」の1文で言語化して
  // いる。売り側（出口）は「で買い・」の後ろ（分割できない形式が来たら全文を出す）。
  const buySellSep = 'で買い・'
  const sepIdx = ruleDescription.indexOf(buySellSep)
  const sellSide = sepIdx >= 0 ? ruleDescription.slice(sepIdx + buySellSep.length) : ruleDescription
  const exitLines = [
    `出口（売り）はこのルールの売りシグナルのみです: 「${sellSide}」`,
    'このルールに損切り・利確・保有期限（時間による手仕舞い）は設定されていません。出口条件は上記の売りシグナルだけです。',
  ]

  const bt = bundle.backtest

  // ── 分岐1: バックテスト未実行（ゲート不成立） — 数字を1つも並べない ──────
  if (!bt) {
    return {
      status: 'no_backtest',
      ruleDescription,
      exitLines,
      notes: [
        '参加条件（ファンダメンタル等）が現在値で不成立だったため、バックテストは実行されていません。',
        'このルールの過去の成績は計算されておらず、存在しない数字は表示しません（バックテスト未実行のため検証期間もありません）。',
      ],
      facts: [],
      rawRoundTrips: [],
    }
  }

  // ── 分岐2: シグナル未発火 — 「発生しなかった」という事実だけを出す ────────
  if (bt.trades.length === 0) {
    return {
      status: 'no_signals',
      ruleDescription,
      exitLines,
      notes: [
        `検証期間（${fmtDate(bt.startDate)}〜${fmtDate(bt.endDate)}）の実データでは、このルールの売買シグナルは一度も発生しませんでした。`,
        '成績を構成する売買が存在しないため、保有日数・往復損益などの実測値はありません。',
      ],
      facts: [],
      rawRoundTrips: [],
    }
  }

  // ── 以降: 約定が1件以上ある。往復ペアリングは metrics.ts と同一関数を使う ──
  const pairs = pairRoundTrips(bt.trades)
  const n = pairs.length
  const buys = bt.trades.filter(t => t.action === 'buy').length
  const sells = bt.trades.length - buys
  const last = bt.trades[bt.trades.length - 1]
  // roundTrips() は末尾の未決済 buy を無視する仕様 — 黙って落とすと約定件数と
  // 往復件数の辻褄が合わなくなるため「未決済1件」として必ず別掲する。
  const openPosition = last.action === 'buy'

  const totalSeconds = Math.max(bt.endDate - bt.startDate, 1)
  const periodYears = totalSeconds / (YEAR_DAYS * DAY_SECONDS)
  const heldSeconds =
    pairs.reduce((s, p) => s + (p.exit.time - p.entry.time), 0) +
    (openPosition ? bt.endDate - last.time : 0)
  const heldDays = Math.round(heldSeconds / DAY_SECONDS)
  const totalDays = Math.round(totalSeconds / DAY_SECONDS)
  const exposurePct = (heldSeconds / totalSeconds) * 100

  const facts: PlanFact[] = [
    {
      label: '検証期間（実データ）',
      value: `${fmtDate(bt.startDate)}〜${fmtDate(bt.endDate)}`,
      sub: `日足${bt.barCount}本・約${periodYears.toFixed(1)}年（暦日${totalDays}日）`,
    },
    {
      label: '売買シグナルの発生実績',
      value: `買い${buys}回・売り${sells}回`,
      sub: `完結した往復（買い→売り）${n}件${openPosition ? '・ほかに未決済1件（保有日数・損益は確定していません）' : ''}`,
    },
    {
      // S1: 「直近シグナル」は“今のシグナル”と誤読されうるため「検証期間末の状態」とする。
      label: '検証期間末の状態',
      value: openPosition
        ? '最後の約定は買い（期間終了時点でポジションを保有した状態）'
        : '最後の約定は売り（期間終了時点でポジションなし）',
      sub: `最終約定日 ${fmtDate(last.time)}（過去の実績値）`,
    },
    {
      label: '資金拘束率（保有していた期間の割合）',
      value: `${exposurePct.toFixed(1)}%`,
      sub: `期間${totalDays}暦日のうち${heldDays}暦日をポジション保有で経過（実測）`,
    },
    {
      label: '最大ドローダウン（資産の一時的な目減り）',
      // S2: DD=0 のときは「-0.00%」ではなく符号なしで表示する。
      value: bt.metrics.maxDrawdownPct > 0 ? `-${bt.metrics.maxDrawdownPct.toFixed(2)}%` : '0.00%',
      sub: '検証期間中に一時的に耐える必要があった含み損の深さ（実測）',
    },
  ]

  // ── 分岐3: 買いのみで完結した往復が0件 — 統計も一覧も出せない ─────────────
  if (n === 0) {
    return {
      status: 'open_only',
      ruleDescription,
      exitLines,
      notes: [
        '買いシグナルのみが発生し、完結した往復（買い→売り）が0件のため、保有日数・往復損益の実測値はまだ存在しません。',
        '未決済1件の途中経過（含み損益）は確定した成績ではないため表示しません。',
        '表示している値はすべて過去の実績値であり、将来の値動きを示すものではありません。',
      ],
      facts,
      rawRoundTrips: [],
    }
  }

  // ── 分岐4: 完結往復が1〜2件 — 統計語（中央値・平均）を使わず生の全件を出す ──
  if (n < 3) {
    const rawRoundTrips = pairs.map((p, i) => {
      const days = holdingDaysOf(p)
      const pnl = pnlPctOf(p)
      // 勝敗は metrics.ts の win（約定額の厳密な大小比較）が単一真実源。丸め後±0の
      // 往復は勝率上「負け」側に数えられるため、表示はその事実を正確に注記する（S3）。
      const outcome = p.win ? '勝ち' : Number(pnl.toFixed(2)) === 0 ? '負け扱い・損益ほぼ0' : '負け'
      return `${i + 1}件目: ${fmtDate(p.entry.time)} 買い → ${fmtDate(p.exit.time)} 売り｜保有${days}暦日・往復損益${pct2(pnl)}（${outcome}）`
    })
    return {
      status: 'few_round_trips',
      ruleDescription,
      exitLines,
      notes: [
        `完結した往復が${n}件と少ないため、統計値ではなく全件をそのまま表示します。件数が少ない成績は偶然に左右されます。`,
        '表示している値はすべて過去の実績値であり、将来の保有期間・損益を示すものではありません。',
      ],
      facts,
      rawRoundTrips,
    }
  }

  // ── 分岐5: 完結往復が3件以上 — 統計を表示できる（必ず母集団nを併記） ────────
  const holdingDays = pairs.map(holdingDaysOf).sort((a, b) => a - b)
  const winPcts = pairs.filter(p => p.win).map(pnlPctOf)
  const lossPcts = pairs.filter(p => !p.win).map(pnlPctOf)
  const wins = winPcts.length
  const losses = lossPcts.length
  const avgWin = wins > 0 ? winPcts.reduce((s, v) => s + v, 0) / wins : null
  const avgLoss = losses > 0 ? lossPcts.reduce((s, v) => s + v, 0) / losses : null
  const maxWin = wins > 0 ? Math.max(...winPcts) : null
  const maxLoss = losses > 0 ? Math.min(...lossPcts) : null
  const payoff =
    avgWin != null && avgLoss != null && Math.abs(avgLoss) > 1e-9 ? avgWin / Math.abs(avgLoss) : null

  facts.push(
    {
      // 勝率の値は metrics.winRate をそのまま流用（単一真実源 — Tier1と同じ数字）。
      label: '勝率（完結した往復ベース・実測）',
      value: `${bt.metrics.winRate.toFixed(0)}%`,
      sub: `勝ち${wins}件・負け${losses}件（n=${n}）`,
    },
    {
      label: '保有日数の実測（暦日）',
      value: `中央値${fmtDays(medianOf(holdingDays))}日`,
      sub: `最短${fmtDays(holdingDays[0])}日〜最長${fmtDays(holdingDays[holdingDays.length - 1])}日（n=${n}・過去の実績値であり将来の保有期間ではありません）`,
    },
    {
      label: '勝ちトレードの実測（往復損益）',
      value: avgWin != null ? `平均${pct2(avgWin)}` : '勝ち0件',
      sub:
        avgWin != null && maxWin != null
          ? `最大${pct2(maxWin)}（勝ち${wins}件/n=${n}）`
          : `n=${n}のうち勝ちはありませんでした`,
    },
    {
      label: '負けトレードの実測（往復損益）',
      value: avgLoss != null ? `平均${pct2(avgLoss)}` : '負け0件',
      sub:
        avgLoss != null && maxLoss != null
          ? `最大${pct2(maxLoss)}（負け${losses}件/n=${n}）`
          : `n=${n}のうち負けはありませんでした`,
    },
    {
      label: 'ペイオフ比（平均勝ち幅÷平均負け幅）',
      value: payoff != null ? payoff.toFixed(2) : '算出不可',
      // S3: 算出不可の理由は実態に合わせて出し分ける（負けはあるが平均負け幅≈0の場合がある）。
      sub:
        payoff != null
          ? `n=${n}の実測から算出`
          : wins === 0 || losses === 0
            ? '勝ちまたは負けが0件のため比を計算できません'
            : '平均負け幅がほぼ0のため比を計算できません',
    },
  )

  // CAGR（年率換算・実測）— 往復件数を必ず併記する（n が小さい年率換算は誇張されるため）。
  if (periodYears > 0 && bt.initialCapital > 0 && bt.finalValue > 0) {
    const cagr = (Math.pow(bt.finalValue / bt.initialCapital, 1 / periodYears) - 1) * 100
    // W2: finalValue は期間末の口座評価額で、現金で待機していた期間や未決済ポジション
    // の期間末評価額（含み損益）も含む。よって「往復n件の実測」ではなく「口座全体の
    // 年率」であることを添え書きで明示する（数値自体は実データのまま変えない）。
    facts.push({
      label: '年率換算リターン（CAGR・実測）',
      value: pct2(cagr),
      sub: `口座全体（現金待機期間${openPosition ? 'と未決済1件の期間末評価額' : ''}を含む）の年率換算・完結した往復${n}件・約${periodYears.toFixed(1)}年間の実測（件数が少ないほど年率換算は誇張されます）`,
    })
  }

  return {
    status: 'ready',
    ruleDescription,
    exitLines,
    notes: [
      '表示している値はすべて過去の実績値であり、将来の保有期間・損益・成績を示すものではありません。',
    ],
    facts,
    rawRoundTrips: [],
  }
}
