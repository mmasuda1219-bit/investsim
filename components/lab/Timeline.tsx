/**
 * 画面1「いつ見るか」の横軸の時系列（/lab/9983・2026-10-12・オーナーの読みやすさの指示 (e)・DECISIONS 2026-10-09 の追記）。
 * 横一本の軸（--axis）に3つの点: 左から 前回の決算（実績）→ 今日 → 次回の決算（未定）。各点の上に内容、下に日付。
 *
 *  - 点の色: 前回＝--ink の塗り、今日＝--brand の塗り、次回＝中空（日付が未定なので）
 *  - role="img"＋同じ内容の aria-label（中の文字は見た目用。読み上げは aria-label が運ぶ）
 *  - **残り日数のカウントダウンは出さない**（次回が未定・DESIGN.md R12「急かさない」）
 *  - 時刻はここでは読まない。today は呼び手（app/lab/9983/client.tsx）が useEffect の中で new Date() から作って渡す。
 *    描画の初回は null（空）にして、サーバーとブラウザの日付のずれ（水和のずれ）を避ける
 *  - 390px でも3列のまま。文字は列の中で折り返す（横軸であることを保つ）
 *  - 成績の色（--success／--danger）は使わない。文字の矢印も使わない
 */

export interface TimelineProps {
  /** 前回の決算: 日付（YYYY-MM-DD）と内容 */
  prev: { date: string; detail: string }
  /** 今日の日付（YYYY-MM-DD）。描画の初回は null */
  today: string | null
  /** 次回の決算: 日付の文（未定なら「未定（例年1月上旬）」のような文） */
  next: { date: string }
}

export const PREV_LABEL = '前回の決算（実績）'
export const TODAY_LABEL = '今日'
export const NEXT_LABEL = '次回の決算'
export const TIMELINE_TITLE = '決算の時系列'

/** Date → YYYY-MM-DD（端末の時間帯で。時刻は使わない） */
export function formatIsoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** aria-label の文（検査が同じ文を期待する） */
export function timelineAria({ prev, today, next }: TimelineProps): string {
  return (
    `${TIMELINE_TITLE}。${PREV_LABEL}: ${prev.date}、${prev.detail}。` +
    `${TODAY_LABEL}: ${today ?? '（日付はブラウザで表示します）'}。` +
    `${NEXT_LABEL}: ${next.date}。`
  )
}

const DOT = 'row-start-3 justify-self-center z-10 h-3 w-3 rounded-full'

export function Timeline(props: TimelineProps) {
  const { prev, today, next } = props
  return (
    <div role="img" aria-label={timelineAria(props)} data-timeline="" className="grid grid-cols-3 gap-x-2 gap-y-1">
      {/* 1行目: 内容（点の上） */}
      <p className="row-start-1 col-start-1 text-center text-small font-semibold text-ink">{PREV_LABEL}</p>
      <p className="row-start-1 col-start-2 text-center text-small font-semibold text-ink">{TODAY_LABEL}</p>
      <p className="row-start-1 col-start-3 text-center text-small font-semibold text-ink">{NEXT_LABEL}</p>
      {/* 2行目: 補足（前回だけ） */}
      <p className="row-start-2 col-start-1 text-center text-caption text-ink-2 break-words tabular-nums">{prev.detail}</p>
      {/* 3行目: 軸と点。軸は点の中心から中心まで（列幅の 1/6 ずつ内側） */}
      <div className="row-start-3 col-start-1 col-end-4 self-center h-px bg-axis mx-[16.67%]" />
      <span className={`${DOT} col-start-1 bg-ink`} />
      <span className={`${DOT} col-start-2 bg-brand`} />
      <span className={`${DOT} col-start-3 border-2 border-ink bg-card`} />
      {/* 4行目: 日付（点の下） */}
      <p className="row-start-4 col-start-1 text-center text-caption text-muted tabular-nums">{prev.date}</p>
      <p className="row-start-4 col-start-2 text-center text-caption text-muted tabular-nums min-h-[1.2rem]">{today ?? ''}</p>
      <p className="row-start-4 col-start-3 text-center text-caption text-muted">{next.date}</p>
    </div>
  )
}
