'use client'

import { useState } from 'react'
import { TradeModal } from './TradeModal'

interface TradeButtonProps {
  symbol: string
  name: string
  price: number
}

export function TradeButton({ symbol, name, price }: TradeButtonProps) {
  const [modalAction, setModalAction] = useState<'buy' | 'sell' | null>(null)

  return (
    <>
      {/* 買う/売るは同じ重さの副ボタン（DESIGN.md §6-1）。緑/赤で塗らない＝どちらにも
          誘導しない（DECISIONS 2026-09-10）。方向は記号 ▲/▼ と文字で伝える。 */}
      <div className="flex items-center gap-2">
        {(['buy', 'sell'] as const).map(a => (
          <button
            key={a}
            type="button"
            onClick={() => setModalAction(a)}
            className="h-12 px-4 rounded-card bg-card text-ink border border-border-input hover:bg-surface text-base font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
          >
            {a === 'buy' ? '▲ 買う' : '▼ 売る'}
          </button>
        ))}
      </div>

      {modalAction && (
        <TradeModal
          symbol={symbol}
          name={name}
          price={price}
          defaultAction={modalAction}
          onClose={() => setModalAction(null)}
        />
      )}
    </>
  )
}
