import { getQuote } from '@/lib/market'
import { ChartWithControls } from '@/components/ChartWithControls'
import { InvestorPanel } from '@/components/InvestorPanel'
import { EarningsPanel } from '@/components/EarningsPanel'
import { PeriodSelector } from '@/components/PeriodSelector'
import { RealtimeQuote } from '@/components/RealtimeQuote'
import { TradeButton } from '@/components/TradeButton'

interface Props {
  params: { symbol: string }
  searchParams: { period?: string }
}

const VALID_PERIODS = ['1m', '5m', '15m', '30m', '1h', '1d', '5d', '1mo', '3mo', '6mo', '1y', '2y']

export default async function StockPage({ params, searchParams }: Props) {
  const symbol = params.symbol.toUpperCase()
  const period = VALID_PERIODS.includes(searchParams.period ?? '') ? searchParams.period! : '3mo'

  try {
    const quote = await getQuote(symbol)

    return (
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-bold text-white">{symbol}</h1>
              <span className={`text-xs px-2 py-0.5 rounded ${quote.market === 'JP' ? 'bg-red-900 text-red-300' : 'bg-blue-900 text-blue-300'}`}>
                {quote.market === 'JP' ? '東証' : 'NYSE/NASDAQ'}
              </span>
              {!quote.isMarketOpen && (
                <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-muted">市場休場中</span>
              )}
            </div>
            <div className="text-muted text-sm">{quote.name}</div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <RealtimeQuote symbol={symbol} initialQuote={quote} />
            <TradeButton symbol={symbol} name={quote.name} price={quote.price} />
          </div>
        </div>

        {/* Period Selector */}
        <PeriodSelector current={period} symbol={symbol} />

        {/* Chart — client-side async load */}
        <ChartWithControls symbol={symbol} period={period} />

        {/* Investor Panel */}
        <InvestorPanel symbol={symbol} />

        {/* Earnings Panel */}
        <EarningsPanel symbol={symbol} />
      </div>
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'データを取得できませんでした'
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4 text-center">
        <h1 className="text-2xl font-bold text-white">{symbol}</h1>
        <p className="text-muted text-sm">{msg}</p>
        <a href="/" className="text-blue-400 hover:text-blue-300 text-sm underline">トップに戻る</a>
      </div>
    )
  }
}

export async function generateMetadata({ params }: Props) {
  return {
    title: `${params.symbol.toUpperCase()} — InvestSim`,
  }
}
