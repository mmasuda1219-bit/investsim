'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Signal } from '@/types'
import { INVESTOR_META } from '@/lib/investors/registry'

/**
 * 「名人はいまどう見ているか」— 選んだ銘柄に対する5人の現在シグナルと、その理由。
 *
 * 置き場所の経緯: これは旧トップページにあった「投資家別リアルタイム判断」で、
 * トップをLP化した際に行き場を失っていた。オーナー定義の「見る＝AIや名人が、
 * いまの相場をどう見て、なぜそう判断したかを読む」に照らすと、ここが正しい住所。
 *
 * 表示名・色・並び順は `lib/investors/registry` が単一の出所（画面ごとの
 * 独自定義を作らない）。色はTailwindの動的クラス名だとビルド時に消えるため、
 * hexをインラインスタイルで当てる。
 */

const PRESET_SYMBOLS = ['AAPL', 'NVDA', 'MSFT', 'GOOGL', 'AMZN', 'TSLA']

const ACTION_LABEL: Record<Signal['action'], string> = {
  buy: '買い', sell: '売り', hold: '様子見',
}
const ACTION_STYLE: Record<Signal['action'], string> = {
  buy:  'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  sell: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
  hold: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
}

export function MasterSignals({ initialSymbol = 'AAPL' }: { initialSymbol?: string }) {
  const [symbol, setSymbol] = useState(initialSymbol)
  const [signals, setSignals] = useState<Record<string, Signal> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true); setError(null); setSignals(null)
    fetch(`/api/signals/${encodeURIComponent(symbol)}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(d => { if (alive) setSignals(d) })
      .catch((e: Error) => { if (alive) setError(e.message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [symbol])

  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-white">名人はいまどう見ているか</h2>
        <span className="text-xs text-gray-500">同じ銘柄を、5人の考え方で判定した結果です</span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {PRESET_SYMBOLS.map(s => (
          <button
            key={s}
            type="button"
            onClick={() => setSymbol(s)}
            aria-pressed={symbol === s}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
              symbol === s ? 'bg-emerald-500 text-gray-950' : 'bg-gray-800 text-gray-400 hover:text-white'
            }`}
          >
            {s}
          </button>
        ))}
        <Link
          href={`/stocks/${symbol}`}
          className="px-2.5 py-1 rounded-lg text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          {symbol} の詳細
        </Link>
        <Link
          href={`/trade?symbol=${encodeURIComponent(symbol)}`}
          className="px-2.5 py-1 rounded-lg text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-colors"
        >
          この銘柄で自分も判断してみる →
        </Link>
      </div>

      {loading && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 px-5 py-8 text-center text-sm text-gray-500">
          判定中…
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 px-5 py-6 space-y-1">
          <p className="text-sm text-rose-400">シグナルを取得できませんでした</p>
          <p className="text-xs text-gray-500">{error} — 実データが取れないときは、代わりの数字を作らずここで止めます。</p>
        </div>
      )}

      {!loading && !error && signals && (
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {INVESTOR_META.map(m => {
            const sig = signals[m.id]
            return (
              <article key={m.id} className="rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="w-6 h-6 rounded-lg grid place-items-center text-[11px] font-bold text-gray-950"
                    style={{ backgroundColor: m.color }}
                  >
                    {m.initial}
                  </span>
                  <span className="text-sm font-semibold text-white">{m.label}</span>
                  {sig ? (
                    <span className={`ml-auto text-[11px] font-semibold px-2 py-0.5 rounded border ${ACTION_STYLE[sig.action]}`}>
                      {ACTION_LABEL[sig.action]}
                    </span>
                  ) : (
                    <span className="ml-auto text-[11px] text-gray-600">判定なし</span>
                  )}
                </div>

                {sig && sig.reasons.length > 0 ? (
                  <ul className="space-y-1">
                    {sig.reasons.slice(0, 3).map((r, i) => (
                      <li key={i} className="text-xs text-gray-400 leading-relaxed">・{r}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-gray-600 leading-relaxed">{m.philosophy}</p>
                )}
              </article>
            )
          })}
        </div>
      )}

      <p className="text-[11px] text-gray-600 leading-relaxed">
        これは各投資家の公開された考え方をルール化して現在の数値に当てた計算結果であり、本人の見解でも、売買の推奨でもありません。
      </p>
    </section>
  )
}
