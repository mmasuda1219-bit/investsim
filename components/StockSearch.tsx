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

  return (
    <div ref={wrapperRef} className="relative w-full max-w-lg">
      <div className="flex items-center gap-2 bg-panel border border-border rounded-lg px-4 py-2">
        <svg className="w-4 h-4 text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          className="flex-1 bg-transparent text-white placeholder-muted outline-none text-sm"
          placeholder="銘柄を検索... (例: Apple, NVIDIA, AAPL)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
        />
        {loading && (
          <div className="w-4 h-4 border-2 border-muted border-t-white rounded-full animate-spin" />
        )}
      </div>

      {open && results.length > 0 && (
        <ul className="absolute top-full mt-1 w-full bg-panel border border-border rounded-lg overflow-hidden z-50 shadow-xl">
          {results.map((r) => (
            <li key={r.symbol}>
              <button
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-border transition-colors text-left"
                onClick={() => select(r.symbol)}
              >
                <div>
                  <span className="text-white font-medium text-sm">{r.symbol}</span>
                  <span className="text-muted text-xs ml-2">{r.name}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded ${r.market === 'JP' ? 'bg-red-900 text-red-300' : 'bg-blue-900 text-blue-300'}`}>
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
