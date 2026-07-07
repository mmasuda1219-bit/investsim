'use client'
import Link from 'next/link'

const PERIODS = [
  // イントラデイグループ
  { value: '1m',  label: '1分',  group: 'intraday' },
  { value: '5m',  label: '5分',  group: 'intraday' },
  { value: '15m', label: '15分', group: 'intraday' },
  { value: '30m', label: '30分', group: 'intraday' },
  { value: '1h',  label: '1時間', group: 'intraday' },
  // 日足以上グループ
  { value: '1d',  label: '1日',  group: 'daily' },
  { value: '5d',  label: '5日',  group: 'daily' },
  { value: '1mo', label: '1ヶ月', group: 'daily' },
  { value: '3mo', label: '3ヶ月', group: 'daily' },
  { value: '6mo', label: '6ヶ月', group: 'daily' },
  { value: '1y',  label: '1年',  group: 'daily' },
  { value: '2y',  label: '2年',  group: 'daily' },
]

interface Props { current: string; symbol: string }

export function PeriodSelector({ current, symbol }: Props) {
  const intraday = PERIODS.filter(p => p.group === 'intraday')
  const daily    = PERIODS.filter(p => p.group === 'daily')

  const cls = (v: string) =>
    `px-3 py-1.5 rounded-lg text-xs transition-colors ${
      current === v
        ? 'bg-blue-600 text-white'
        : 'bg-panel border border-border text-muted hover:text-white'
    }`

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1 flex-wrap">
        {intraday.map(p => (
          <Link key={p.value} href={`/stocks/${symbol}?period=${p.value}`} className={cls(p.value)}>
            {p.label}
          </Link>
        ))}
      </div>
      <div className="w-px h-4 bg-border hidden sm:block" />
      <div className="flex gap-1 flex-wrap">
        {daily.map(p => (
          <Link key={p.value} href={`/stocks/${symbol}?period=${p.value}`} className={cls(p.value)}>
            {p.label}
          </Link>
        ))}
      </div>
    </div>
  )
}
