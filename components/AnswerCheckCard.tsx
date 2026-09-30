'use client'

import { SERIES, svgDash, type SeriesStyle } from '@/components/chartTheme'
import { firstSentence } from '@/lib/entry/samples'

/**
 * このサイトのAIの判断1件を「AIはこう書いた／株価はこう動いた」の並置で見せるカード（S2「プレゼン型ホーム」・2026-09-29）。
 * ホーム（app/(night)/page.tsx）の「03 読み返す」で、値上がりした例と値下がりした例を1件ずつ置く。
 *
 * 縦3段: ①理由の冒頭1文（firstSentence）→ ②小さな折れ線（inline SVG・1系列 SERIES.ai＝紫の破線 2px・凡例なし・
 *        判断日の縦破線 --muted 1本・軸の文字は実値2つ＝高値と安値だけ）→
 *        ③「AIは◯月◯日にこう書きました。◯月◯日の終値から◯月◯日までで ±◯% でした。」
 * その直下に出所と時点（DESIGN.md §4-2 R8）。判断日と株価の取得時点の両方を書く（法務 2026-09-29 論点5）。
 *
 * 守っていること（DECISIONS.md 2026-09-29・2026-09-30 の不変条件）:
 *  - 騰落率は **図に描くのと同じ日足の系列** から（判断日以降で最初の足の終値 → 最終足の終値）。
 *    記録側の DecisionRecord.price は使わない（実際の株価と食い違うことを 2026-09-30 に確認）。
 *    どの日から数えたかを文に書くので、読み手が線と数字を突き合わせられる
 *  - 騰落率を見出しにしない（③の文の中と出所の行だけ。カードの見出しは「値上がりした例／値下がりした例」の語）
 *  - 「やめる条件」の水平線を描かない（AI の判断に対応する項目が無い＝描けば架空データ・原則9）
 *  - example が null なら **null を返す**（ダミー線・薄い枠・「準備中」を描かない。無いときは節ごと出さない）
 *  - /stocks/[symbol] へリンクしない（法務条件）。銘柄コードは文字として置くだけ。社名は持たない
 *  - 影を付けない（R1 の色付きの影は主ボタンだけ）。面は地の上（R11: 出所を半透明の面の上に置かない）
 *  - 「当たった・外れた・的中」の語を使わない（並置だけ。正解を出すのはこのサイトではない）
 *  - 図は role="img"＋aria-label（同じ内容の文）。線の色は文字に使わない（§5-1）
 * 検査: scripts/check-answer-examples.ts・scripts/check-entry.ts
 */

export interface AnswerExample {
  symbol: string
  /** 判断した時刻（ISO） */
  decidedAt: string
  /** AI が書いた理由の全文（禁止語検査は選ぶ側 lib/entry/answer-examples.ts が全文で済ませている） */
  reasoning: string
  /** (最終足の終値 − 判断日の終値) / 判断日の終値 × 100。**記録側の価格からは出さない**
   *  （2026-09-29 に本番の blob で実際の株価と食い違うことを確認。app/api/entry/examples/route.ts の baseIndex の注釈） */
  changePct: number
  bars: { t: string; close: number }[]
  /** 騰落率の起点にした足の日付（YYYY-MM-DD）＝図の縦破線と同じ日 */
  baseAsOf: string
  /** 最終足の日付（YYYY-MM-DD） */
  priceAsOf: string
  /** 株価の出所 */
  source: string
  /** 判断日からたった営業日数。無ければ書かない */
  elapsedBusinessDays?: number
}

export type AnswerKind = 'up' | 'down'

/** 見出しの語。成績の数字ではなく向きの語（騰落率を見出しにしない） */
export const KIND_LABEL: Record<AnswerKind, string> = { up: '値上がりした例', down: '値下がりした例' }

/** 符号付きの割合（DESIGN.md §5-2: マイナスは U+2212・小数1桁・ゼロは ±） */
export function fmtSignedPct(n: number): string {
  const abs = Math.abs(n).toFixed(1)
  return n > 0 ? `+${abs}%` : n < 0 ? `−${abs}%` : `±${abs}%`
}

/** 'YYYY-MM-DD…'（ISO）の日付の部分を「9月1日」に。UTC の暦日（判断の記録と日足の日付が同じ基準になる） */
export function fmtMonthDay(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-')
  return `${Number(m)}月${Number(d)}日`
}

/** 'YYYY-MM-DD…' → '9/1' */
export function fmtSlashDate(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-')
  return `${Number(m)}/${Number(d)}`
}

/** 軸の実値。.T は円（整数）、それ以外はドル（小数2桁）。仮想資金でも単位は偽らない（原則10） */
export function fmtAxis(symbol: string, n: number): string {
  return /\.T$/i.test(symbol)
    ? `¥${Math.round(n).toLocaleString('en-US')}`
    : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** ③の文。カードの外（ホームの aria-label 等）でも同じ文を使えるよう切り出す。
 *  騰落率は「判断日の終値（baseAsOf）から最終足（priceAsOf）まで」で、図に描く線と同じ系列から出す。
 *  どの日から数えたかを文に書くのは、線と数字が同じものを指していることを読み手が確かめられるようにするため。 */
export function answerSentence(e: Pick<AnswerExample, 'decidedAt' | 'changePct' | 'baseAsOf' | 'priceAsOf'>): string {
  return `AIは${fmtMonthDay(e.decidedAt)}にこう書きました。${fmtMonthDay(e.baseAsOf)}の終値から${fmtMonthDay(e.priceAsOf)}までで ${fmtSignedPct(e.changePct)} でした。`
}

/**
 * 小さな折れ線（inline SVG）。1系列・凡例なし・判断日の縦破線1本・軸の文字は高値と安値の実値2つだけ。
 * viewBox を 0〜100 に固定し preserveAspectRatio="none" で箱いっぱいに伸ばす。線の太さと破線の間隔は
 * vector-effect="non-scaling-stroke" で画面の px のまま（伸ばしても太くならない）。文字は SVG の中に置かず
 * 右の列に HTML で置く（伸縮で歪ませない）。
 * bars が2本未満なら何も描かない（1点で線は引けない。ダミーを描かない）。
 */
export function MiniLine({
  bars, decidedAt, symbol, series = SERIES.ai, label, className = '',
}: {
  bars: AnswerExample['bars']
  decidedAt: string
  symbol: string
  series?: SeriesStyle
  /** role="img" の説明文 */
  label: string
  className?: string
}) {
  if (bars.length < 2) return null
  const closes = bars.map(b => b.close)
  const max = Math.max(...closes)
  const min = Math.min(...closes)
  const span = max - min || 1
  // 上下に 6% の余白（線が箱の縁に触れない）
  const y = (v: number) => 94 - ((v - min) / span) * 88
  const x = (i: number) => (i / (bars.length - 1)) * 100
  const d = closes.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)} ${y(v).toFixed(2)}`).join(' ')
  const day = decidedAt.slice(0, 10)
  const di = bars.findIndex(b => b.t.slice(0, 10) >= day)
  return (
    <figure role="img" aria-label={label} className={`flex items-stretch gap-2 ${className}`.trim()}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-24 min-w-0 flex-1" aria-hidden="true" focusable="false">
        {di >= 0 && (
          <line
            x1={x(di)} x2={x(di)} y1={0} y2={100}
            style={{ stroke: 'var(--muted)' }} strokeWidth={1} strokeDasharray="4 4" vectorEffect="non-scaling-stroke"
          />
        )}
        <path
          d={d} fill="none" stroke={series.color} strokeWidth={series.width} strokeDasharray={svgDash(series)}
          strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"
        />
      </svg>
      <figcaption className="flex shrink-0 flex-col justify-between text-caption text-muted tabular-nums">
        <span>{fmtAxis(symbol, max)}</span>
        <span>{fmtAxis(symbol, min)}</span>
      </figcaption>
    </figure>
  )
}

export function AnswerCheckCard({ example, kind }: { example: AnswerExample | null; kind: AnswerKind }) {
  if (example === null) return null
  const sentence = answerSentence(example)
  const asOf = `${example.source}・${fmtSlashDate(example.priceAsOf)} の終値まで`
  const elapsed = example.elapsedBusinessDays != null ? `・判断日から${example.elapsedBusinessDays}営業日` : ''
  return (
    <article aria-label={`${KIND_LABEL[kind]}: ${example.symbol}`} className="space-y-3 rounded-card border border-border p-4">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-small text-muted">
        <span>{KIND_LABEL[kind]}</span>
        <span className="font-semibold text-ink">{example.symbol}</span>
      </p>
      {/* ① 理由の冒頭1文 */}
      <p className="text-body text-ink">{firstSentence(example.reasoning)}</p>
      {/* ② 折れ線（1系列・凡例なし・判断日の縦破線） */}
      <MiniLine
        bars={example.bars}
        decidedAt={example.decidedAt}
        symbol={example.symbol}
        label={`${example.symbol} の終値の折れ線。縦の破線は判断日 ${fmtSlashDate(example.decidedAt)}。${sentence}`}
      />
      {/* ③ 並置の1文。数字はここが初出（見出しにしない） */}
      <p className="text-small text-ink-2 tabular-nums">{sentence}</p>
      {/* 出所と時点（R8）。判断日の縦線の説明も文字で添える（凡例は出さない） */}
      <p className="text-caption text-muted tabular-nums">{asOf}{elapsed}。縦の破線は判断日。</p>
    </article>
  )
}
