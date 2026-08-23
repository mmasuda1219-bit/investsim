'use client'

import { useEffect, useState } from 'react'

/**
 * 「いまの相場」— 主要指数の要約と、市場全体の割高感（バフェット指標）。
 *
 * 置き場所の経緯: これは `/markets` にあった内容で、4段階への再編で
 * どのページにも属さない孤児になっていた。オーナー定義の「見る＝AIや名人が、
 * **いまの相場を**どう見て…」に照らすと、AIと名人の判断を読む前に置く
 * 前提情報として `/watch` の冒頭が正しい住所。オーナー承認済み（吸収）。
 *
 * 元ページの縦長のゾーンバーは持ち込まず、1行の帯に要約する。判断の前に
 * 一瞥する情報であって、それ自体を読み込ませる面ではないため。
 */

interface IndexData {
  symbol: string
  name: string
  price: number
  change: number
  changePercent: number
}
interface BuffettData {
  value: number
  label: string
  color: 'green' | 'yellow' | 'orange' | 'red'
}
interface MarketData {
  indices: IndexData[]
  buffettIndicator: BuffettData
}

const BUFFETT_COLOR: Record<BuffettData['color'], string> = {
  green:  '#35D0A5',
  yellow: '#E0C458',
  orange: '#E0A458',
  red:    '#F2617A',
}

export function MarketOverview() {
  const [data, setData] = useState<MarketData | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let alive = true
    fetch('/api/markets')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: MarketData) => {
        if (!alive) return
        if (!d || !Array.isArray(d.indices)) throw new Error('形式が不正')
        setData(d); setState('ready')
      })
      .catch(() => { if (alive) setState('error') })
    return () => { alive = false }
  }, [])

  // 取れないときは黙って空にせず、取れなかったと出す（原則9）。
  if (state === 'error') {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900 px-4 py-3 text-xs text-gray-500">
        相場概況を取得できませんでした。
      </div>
    )
  }

  if (state === 'loading' || !data) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900 px-4 py-3 text-xs text-gray-600">
        相場概況を読み込み中…
      </div>
    )
  }

  const b = data.buffettIndicator

  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900 px-4 py-3">
      <div className="flex items-center gap-x-5 gap-y-2 flex-wrap">
        <span className="text-xs font-semibold text-gray-400 shrink-0">いまの相場</span>

        {data.indices.slice(0, 5).map(ix => {
          const up = ix.changePercent >= 0
          return (
            <span key={ix.symbol} className="flex items-baseline gap-1.5 text-xs">
              <span className="text-gray-500">{ix.name}</span>
              <span className="text-gray-200 tabular-nums font-medium">
                {ix.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}
              </span>
              <span className={`tabular-nums font-semibold ${up ? 'text-emerald-400' : 'text-rose-400'}`}>
                {up ? '+' : ''}{ix.changePercent.toFixed(2)}%
              </span>
            </span>
          )
        })}

        {b && typeof b.value === 'number' && (
          <span
            className="ml-auto flex items-baseline gap-1.5 text-xs shrink-0"
            title="株式市場の時価総額をGDPで割った値。市場全体の割高感の目安として使われる"
          >
            <span className="text-gray-500">市場全体</span>
            <span className="tabular-nums font-semibold" style={{ color: BUFFETT_COLOR[b.color] }}>
              {b.value.toFixed(0)}%
            </span>
            <span className="text-gray-500">{b.label}</span>
          </span>
        )}
      </div>
    </section>
  )
}
