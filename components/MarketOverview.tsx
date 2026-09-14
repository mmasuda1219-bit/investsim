'use client'

import { useEffect, useState } from 'react'
import type { IndexQuote, MarketsResponse } from '@/app/api/markets/route'

/**
 * 「いまの相場」— 主要指数の要約。
 *
 * 置き場所の経緯: これは `/markets` にあった内容で、4段階への再編で
 * どのページにも属さない孤児になっていた。オーナー定義の「見る＝AIや名人が、
 * **いまの相場を**どう見て…」に照らすと、AIと名人の判断を読む前に置く
 * 前提情報として `/watch` の冒頭が正しい住所。オーナー承認済み（吸収）。
 *
 * 元ページの縦長のゾーンバーは持ち込まず、1行の帯に要約する。判断の前に
 * 一瞥する情報であって、それ自体を読み込ませる面ではないため。
 *
 * 取れなかった指数は数字を出さず「取得できませんでした」と書く。固定値や 0 で
 * 埋めない（原則9。2026-09-14 オーナー決定「取れない時は『取得できず』と出す」）。
 * 以前帯の右端にあった「市場全体（バフェット指標）」は、本物の時価総額と GDP を
 * 取る仕組みが無いため、API とともに外した。
 */

const pad2 = (n: number) => String(n).padStart(2, '0')

/** 日本時間の月・日・時・分。日本は夏時間が無いので UTC+9 の固定で計算する。 */
function jst(d: Date) {
  const j = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return { month: j.getUTCMonth() + 1, day: j.getUTCDate(), hour: j.getUTCHours(), minute: j.getUTCMinutes() }
}

/**
 * 取れた指数に1回だけ添える時点（DESIGN.md §6-2「9/11 15:00 時点」＋遅れの注記）。
 * 指数ごとに取得元の時刻が違うので、いちばん古い時刻を出す（どの値も
 * 「この時点かそれより新しい」と言える側に倒す）。取得元に時刻が無ければ不明と書く。
 */
export function asOfCaption(indices: IndexQuote[]): string {
  const times = indices
    .flatMap(ix => (ix.ok && ix.asOf ? [Date.parse(ix.asOf)] : []))
    .filter(t => Number.isFinite(t))
  if (times.length === 0) return '時点不明・遅れている場合があります'
  const t = jst(new Date(Math.min(...times)))
  return `${t.month}/${t.day} ${pad2(t.hour)}:${pad2(t.minute)} 時点・遅れている場合があります`
}

/** 1つも取れなかったときの1行。いつ取りに行って取れなかったかを日本時間で書く。 */
export function allFailedLine(at: Date): string {
  const t = jst(at)
  return `株価指数を取得できませんでした（${t.hour}時${pad2(t.minute)}分・日本時間）`
}

export function MarketOverview() {
  const [data, setData] = useState<MarketsResponse | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  // 結果が返ってきた時刻（1つも取れなかったときの1行に出す）
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/markets')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: MarketsResponse) => {
        if (!alive) return
        if (!d || !Array.isArray(d.indices)) throw new Error('形式が不正')
        setData(d); setCheckedAt(new Date()); setState('ready')
      })
      .catch(() => { if (alive) { setCheckedAt(new Date()); setState('error') } })
    return () => { alive = false }
  }, [])

  // 形は A アプリ型の白い帯（DESIGN.md §6-6）。枠線＋角丸の枠で囲わない（切り分け3b-2）。
  if (state === 'loading' || !checkedAt) {
    return (
      <div className="bg-card rounded-card px-4 py-3 text-small text-muted">
        相場概況を読み込み中…
      </div>
    )
  }

  const shown = data?.indices.slice(0, 5) ?? []

  // API に届かなかったときも、指数が1つも取れなかったときも、黙って空にせず
  // 取れなかったと出す（原則9）。仮の数字は出さない（§6-12）。
  if (state === 'error' || !shown.some(ix => ix.ok)) {
    return (
      <div className="bg-card rounded-card px-4 py-3 text-small text-muted">
        {allFailedLine(checkedAt)}
      </div>
    )
  }

  return (
    // 白い帯（枠線なし・端だけ角丸）。1行の要約なので「いまの相場」は帯の中の先頭に置いたまま。
    <section className="bg-card rounded-card px-4 py-3">
      <div className="flex items-center gap-x-5 gap-y-2 flex-wrap">
        <span className="text-small font-semibold text-ink-2 shrink-0">いまの相場</span>

        {shown.map(ix => {
          if (!ix.ok) {
            // 取れなかった指数は数字も変化率も出さない（0 や前回値で埋めない）
            return (
              <span key={ix.symbol} className="flex items-baseline gap-1.5 text-small">
                <span className="text-muted">{ix.name}</span>
                <span className="text-muted">取得できませんでした</span>
              </span>
            )
          }
          // 騰落は損益なので緑/赤（DESIGN.md §6-4）。正＝+／負＝−／ゼロ＝± を必ず付ける
          const flat = ix.changePercent === 0
          const up = ix.changePercent > 0
          const color = flat ? 'text-muted' : up ? 'text-success' : 'text-danger'
          const sign = flat ? '±' : up ? '+' : '−'
          return (
            <span key={ix.symbol} className="flex items-baseline gap-1.5 text-small tabular-nums">
              <span className="text-muted">{ix.name}</span>
              <span className="text-ink tabular-nums font-medium">
                {ix.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}
              </span>
              <span className={`tabular-nums font-semibold ${color}`}>
                {sign}{Math.abs(ix.changePercent).toFixed(2)}%
              </span>
            </span>
          )
        })}

        {/* 取れた値の時点は帯に1回だけ（§6-2）。 */}
        <span className="ml-auto text-caption text-muted tabular-nums shrink-0">
          {asOfCaption(shown)}
        </span>
      </div>
    </section>
  )
}
