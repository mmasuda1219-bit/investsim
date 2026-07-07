'use client'

import { useState, useEffect } from 'react'
import type { StockQuote } from '@/types'

interface Props {
  symbol: string
  initialQuote: StockQuote
}

export function RealtimeQuote({ symbol, initialQuote }: Props) {
  const [quote, setQuote] = useState(initialQuote)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(`/api/stocks/${symbol}`)
        if (res.ok) {
          const data = await res.json()
          setQuote(data)
          setLastUpdated(new Date())
        }
      } catch {}
    }

    const interval = setInterval(poll, 60_000)
    return () => clearInterval(interval)
  }, [symbol])

  // Update relative time display every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 10_000)
    return () => clearInterval(interval)
  }, [])

  const secondsAgo = Math.floor((Date.now() - lastUpdated.getTime()) / 1000)
  const timeLabel = secondsAgo < 60 ? `${secondsAgo}秒前` : `${Math.floor(secondsAgo / 60)}分前`

  const isPositive = quote.change >= 0
  const currency = quote.currency === 'JPY' ? '¥' : '$'

  return (
    <div className="text-right">
      <div className="text-3xl font-bold text-white font-mono">
        {currency}{quote.price.toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
      <div className={`text-sm font-medium ${isPositive ? 'text-bull' : 'text-bear'}`}>
        {isPositive ? '▲' : '▼'} {Math.abs(quote.change).toFixed(2)} ({Math.abs(quote.changePercent).toFixed(2)}%)
      </div>
      <div className="text-muted text-xs mt-1">更新: {timeLabel} • 60秒ごとに自動更新</div>
    </div>
  )
}
