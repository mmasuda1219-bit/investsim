'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { SearchResult } from '@/types'

export function StockSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      setOpen(false)
      return
    }

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`)
        const data = await res.json()
        setResults(Array.isArray(data) ? data : [])
        setOpen(true)
      } finally {
        setLoading(false)
      }
    }, 300)
  }, [query])

  const select = (symbol: string) => {
    setQuery('')
    setOpen(false)
    router.push(`/stocks/${symbol}`)
  }

  // min-w-0 が無いと、input の既定の最小幅とプレースホルダの長さで幅が下限に張り付き、
  // 狭い画面でヘッダごと右にはみ出す（全ページに横スクロールが出る原因になる）。
  return (
    <div ref={wrapperRef} className="relative w-full min-w-0 max-w-lg">
      <div className="flex min-w-0 items-center gap-2 bg-panel border border-border rounded-lg px-3 sm:px-4 py-2">
        <svg className="w-4 h-4 text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          className="w-full min-w-0 flex-1 bg-transparent text-ink placeholder-muted outline-none text-sm"
          placeholder="銘柄を検索... (例: Apple, NVIDIA, AAPL)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
        />
        {loading && (
          // 回る輪。旧 border-t-white は明るい地の白い面に溶けて、回っているのが見えなかった
          // （暗い地で初めて見えた）。面に依らず見えるよう、切れ目は --ink にする
          // （明るい地では墨色・暗い地ではほぼ白。読み込み表示なので回り続けてよい: DECISIONS R4）。
          <div className="w-4 h-4 border-2 border-muted border-t-ink rounded-full animate-spin" />
        )}
      </div>

      {open && results.length > 0 && (
        // 浮いているもの（検索候補。DESIGN.md §6-6 で囲いを許す3つのうちの1つ）。
        // 面は唯一の不透明な --bg にし、行を --card で載せる（night の --card は白 3.5% の半透明なので、
        // それだけでは下の文字が透けて読めない。明るい地では --card が白で行が面を覆うので見た目は従来どおり）。
        // 影は Tailwind 既定の shadow-xl（黒。暗い地で見えない）ではなく shadow-float（DESIGN §5-5。
        // night では影＋1px の白い縁の2枚重ね）。行のホバーは他の部品と同じ --surface（旧 hover:bg-border は
        // 線の色を面に流用していた）。
        <ul className="absolute top-full mt-1 w-full bg-background border border-border rounded-lg overflow-hidden z-50 shadow-float">
          {results.map((r) => (
            <li key={r.symbol}>
              <button
                className="w-full flex items-center justify-between px-4 py-3 bg-card hover:bg-surface transition-colors text-left"
                onClick={() => select(r.symbol)}
              >
                <div>
                  <span className="text-ink font-medium text-sm">{r.symbol}</span>
                  <span className="text-ink-2 text-sm ml-2">{r.name}</span>
                </div>
                {/* 市場の札は無彩色（DESIGN.md §6-5）。旧の既製色（東証＝赤・US＝青）は暗い地で明るく光るのでやめた。
                    東証／US の区別は文字で伝わる（色だけに頼らない）。 */}
                <span className="text-xs px-2 py-0.5 rounded bg-surface text-ink-2">
                  {r.market === 'JP' ? '東証' : 'US'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
