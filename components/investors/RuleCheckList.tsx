// 「数字で確かめること」の表（2026-09-18 オーナー選択・案C）。データルールを1つの表にまとめる。
//
//  列: 見るところ（title ＋ 指標名）｜いまの値（実測値 24px ＋ 目安）｜目安との位置（数直線）｜状態
//  - 出すのは publishedRules（一次資料で照合済みの出典を持つルール）のデータルールだけ
//  - 状態の語は 目安を満たす／目安を満たさない／判定できない の3つ。判定できない は --muted ＋ 理由（UNDECIDABLE_REASON_LABEL）
//  - 緑・赤・紺青を状態に使わない。札・アイコン・丸バツの記号・点数・件数を出さない（DECISIONS 2026-09-17 不変条件）
//  - 390px では表を崩し、各行を縦積み（見るところ → 値と目安 → 数直線 → 状態）にする。横スクロールにしない
//    （数直線 160px と値 24px が縦に並ぶほうが、指で横に動かすより読みやすい。見本の案B スマホ版と同じ組み方）
//
// 値の書式: ROE「16.2%・目安 15%以上」／D/E は yahooPctToRatio で倍にして「0.78倍・目安 0〜0.5倍」／
// FCF は金額を出さず「プラス／マイナス・目安 プラス」（ADR などで決算の通貨と取引の通貨が食い違うため）。
// 数直線の軸は DataRule.scale（ルールブックのデータ）。画面で範囲を発明しない。

import {
  publishedRules,
  yahooPctToRatio,
  RULE_STATE_LABEL,
  UNDECIDABLE_REASON_LABEL,
  type DataRule,
  type MetricUnit,
  type RuleCheck,
  type RuleCheckSpec,
  type RuleOp,
  type RuleState,
  type Rulebook,
} from '@/lib/investors/rulebooks'
import { NumberLine } from '@/components/investors/NumberLine'

const SUFFIX: Record<MetricUnit, string> = { ratio: '%', yahooPct: '倍', x: '倍', amount: '' }
const OP_WORD: Record<RuleOp, string> = { gte: '以上', lte: '以下', gt: 'より大きい' }

/** マイナスは U+2212（DESIGN.md §5-2。ハイフンより幅が揃う） */
const minus = (s: string) => s.replace(/^-/, '−')

/** 目安の数字を表示の単位に直す（15 / 0.5 / 0）。浮動小数の端数（0.15 * 100 ＝ 15.000000000000002）を落とす */
function displayNumber(value: number, unit: MetricUnit): string {
  const v = unit === 'ratio' ? value * 100 : unit === 'yahooPct' ? yahooPctToRatio(value) : value
  return minus(String(Number(v.toFixed(4))))
}

/** 実測値の書式 */
export function formatObserved(observed: NonNullable<RuleCheck['observed']>): string {
  switch (observed.unit) {
    case 'ratio': return minus(`${(observed.value * 100).toFixed(1)}%`)
    case 'yahooPct': return minus(`${yahooPctToRatio(observed.value).toFixed(2)}倍`)
    case 'x': return minus(`${observed.value.toFixed(1)}倍`)
    case 'amount': return observed.value > 0 ? 'プラス' : observed.value < 0 ? 'マイナス' : 'ゼロ'
  }
}

function describeSpec(spec: RuleCheckSpec): string {
  if (spec.unit === 'amount') {
    // 金額は出さない。0 を境にした向きだけ
    if (spec.op === 'gt' && spec.value === 0) return 'プラス'
    if (spec.op === 'gte' && spec.value === 0) return 'ゼロ以上'
    if (spec.op === 'lte' && spec.value === 0) return 'ゼロ以下'
    return spec.value > 0 ? 'プラス' : 'マイナス'
  }
  return `${displayNumber(spec.value, spec.unit)}${SUFFIX[spec.unit]}${OP_WORD[spec.op]}`
}

/** 目安の書式。同じ項目の下限と上限が並ぶルールは「0〜0.5倍」の形 */
export function formatThreshold(rule: DataRule): string {
  if (rule.checks.length === 2) {
    const [a, b] = rule.checks
    if (a.metric === b.metric && a.unit === b.unit && a.unit !== 'amount') {
      const lo = rule.checks.find(c => c.op === 'gte')
      const hi = rule.checks.find(c => c.op === 'lte')
      if (lo && hi) return `${displayNumber(lo.value, lo.unit)}〜${displayNumber(hi.value, hi.unit)}${SUFFIX[hi.unit]}`
    }
  }
  return rule.checks.map(describeSpec).join('・')
}

/** 取得した日。「時点」だと「その日の値」と読まれる（ROE 等は直近決算の値で、日付は取得した日）ので「取得」（reviewer W2） */
export function stampOf(receivedAt: Date | null): string {
  return receivedAt ? `${receivedAt.getMonth() + 1}/${receivedAt.getDate()} 取得` : ''
}

/** データルール1行分の文言（状態の語・値・目安・理由）。表とテストの両方がこれを使う */
export function describeCheck(
  rule: DataRule,
  check: RuleCheck | undefined,
  receivedAt: Date | null,
): { state: RuleState; label: string; detail: string; value: string; threshold: string; reason?: string } {
  const threshold = formatThreshold(rule)
  const tail = [`目安 ${threshold}`, stampOf(receivedAt)].filter(Boolean).join('・')
  if (!check || check.state === 'undecidable' || !check.observed) {
    const reason = UNDECIDABLE_REASON_LABEL[check?.reason ?? 'no-data']
    return { state: 'undecidable', label: RULE_STATE_LABEL.undecidable, detail: `${reason}・${tail}`, value: '—', threshold, reason }
  }
  const value = formatObserved(check.observed)
  return { state: check.state, label: RULE_STATE_LABEL[check.state], detail: `${value}・${tail}`, value, threshold }
}

/** 数直線に渡す値（軸の単位 ＝ checks の単位。表示だけ倍・% に直す） */
function scaleFormat(unit: MetricUnit) {
  return (v: number) => `${displayNumber(v, unit)}${SUFFIX[unit]}`
}

function Position({ rule, check }: { rule: DataRule; check: RuleCheck | undefined }) {
  const scale = rule.scale
  if (!scale) return <span className="text-small text-muted">—</span>
  const unit = rule.checks[0]?.unit ?? 'ratio'
  const fmt = scaleFormat(unit)
  const observed = check?.state !== 'undecidable' ? check?.observed : undefined
  const value = observed?.value
  if (value != null && (value < scale.min || value > scale.max)) {
    return <span className="text-small text-muted">軸の外（{formatObserved(observed!)}）</span>
  }
  const thresholds = rule.checks
    .filter(c => c.unit === unit)
    .map(c => ({ value: c.value, label: `目安 ${fmt(c.value)}` }))
  const aria = `${rule.title}。目安 ${formatThreshold(rule)}${observed ? `、実測 ${formatObserved(observed)}` : '、実測は無し'}`
  return <NumberLine min={scale.min} max={scale.max} thresholds={thresholds} value={value} format={fmt} ariaLabel={aria} />
}

const TD = 'px-2.5 py-3.5 border-b border-rule-line align-middle max-sm:block max-sm:border-0 max-sm:px-0 max-sm:py-1'

export function RuleCheckList({ book, checks }: { book: Rulebook; checks: readonly RuleCheck[] }) {
  const byId = new Map(checks.map(c => [c.ruleId, c]))
  const rules = publishedRules(book).filter((r): r is DataRule => r.kind === 'data')
  return (
    <table className="w-full border-collapse max-sm:block">
      <thead className="bg-surface max-sm:hidden">
        <tr>
          <th scope="col" className="px-2.5 py-2 text-left text-small font-normal text-muted">見るところ</th>
          <th scope="col" className="px-2.5 py-2 text-left text-small font-normal text-muted">いまの値</th>
          <th scope="col" className="px-2.5 py-2 text-left text-small font-normal text-muted">目安との位置</th>
          <th scope="col" className="px-2.5 py-2 text-right text-small font-normal text-muted">状態</th>
        </tr>
      </thead>
      <tbody className="max-sm:block">
        {rules.map(rule => {
          const check = byId.get(rule.id)
          const d = describeCheck(rule, check, null)
          return (
            <tr key={rule.id} data-rule={rule.id} data-state={d.state} className="max-sm:block max-sm:border-b max-sm:border-rule-line max-sm:py-3 max-sm:first:pt-0">
              <td className={TD}>
                <span className="text-body font-semibold text-ink">{rule.title}</span>
                <span className="ml-1.5 text-small text-muted">{rule.metricLabel}</span>
              </td>
              <td className={`${TD} whitespace-nowrap`}>
                <span className={`block text-h1 tabular-nums ${d.state === 'undecidable' ? 'text-muted' : 'text-ink'}`}>{d.value}</span>
                <span className="block text-small text-muted tabular-nums">目安 {d.threshold}</span>
              </td>
              {/* sm 以上で列幅が数直線（160px）を切ると SVG が縮んで 12px の文字が小さくなるので、最小幅を持たせる（reviewer W4） */}
              <td className={`${TD} sm:min-w-[168px]`}>
                <Position rule={rule} check={check} />
              </td>
              <td className={`${TD} text-right max-sm:text-left`}>
                <span className={`text-small font-semibold whitespace-nowrap ${d.state === 'undecidable' ? 'text-muted' : 'text-ink'}`}>{d.label}</span>
                {d.reason && <span className="block text-small text-muted">{d.reason}</span>}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
