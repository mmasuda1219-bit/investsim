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
      <div className="flex items-center gap-2">
        <button
          onClick={() => setModalAction('buy')}
          className="px-4 py-2 rounded-lg bg-success hover:bg-emerald-100 text-ink text-sm font-semibold transition-colors"
        >
          購入
        </button>
        <button
          onClick={() => setModalAction('sell')}
          className="px-4 py-2 rounded-lg bg-danger hover:bg-red-100 text-ink text-sm font-semibold transition-colors"
        >
          売却
        </button>
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
