import { getQuote } from '@/lib/market'
import { ChartWithControls } from '@/components/ChartWithControls'
import { InvestorPanel } from '@/components/InvestorPanel'
import { EarningsPanel } from '@/components/EarningsPanel'
import { PeriodSelector } from '@/components/PeriodSelector'
import { RealtimeQuote } from '@/components/RealtimeQuote'
import { TradeButton } from '@/components/TradeButton'

interface Props {
  params: Promise<{ symbol: string }>
  searchParams: Promise<{ period?: string }>
}

const VALID_PERIODS = ['1m', '5m', '15m', '30m', '1h', '1d', '5d', '1mo', '3mo', '6mo', '1y', '2y']

export default async function StockPage({ params, searchParams }: Props) {
  const { symbol: rawSymbol } = await params
  const symbol = rawSymbol.toUpperCase()
  const { period: rawPeriod } = await searchParams
  const period = VALID_PERIODS.includes(rawPeriod ?? '') ? rawPeriod! : '3mo'

  try {
    // allowMock:false は外さないこと（原則9）。ここで取れた quote.price は TradeButton → TradeModal を
    // 経て利用者の売買記録に約定価格として残る。既定の allowMock:true のままだと、実データ3経路
    // （yahoo2 → yahoodirect → twelvedata）が全滅したときに providers/mock の«乱数の架空価格»が黙って
    // 入り、利用者はそれを実勢だと思って売買してしまう。取れないときは値を作らず下の catch で止める。
    const quote = await getQuote(symbol, { allowMock: false })

    return (
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-bold text-ink">{symbol}</h1>
              <span className={`text-xs px-2 py-0.5 rounded ${quote.market === 'JP' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
                {quote.market === 'JP' ? '東証' : 'NYSE/NASDAQ'}
              </span>
              {!quote.isMarketOpen && (
                <span className="text-xs px-2 py-0.5 rounded bg-surface text-muted">市場休場中</span>
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
    // 取得できなかった原因（«Real quote unavailable for AAPL — yahoo2: …»）は画面に出さず、サーバーのログにだけ残す
    // （app/api/markets/route.ts の failed() と同じ流儀）。yahoo2 の部分には Yahoo が返した応答本文がそのまま入り、
    // HTML のエラーページ全文になりうる。取得元の構成（3経路と失敗の順）も利用者に見せる必然性がない。
    console.error(`[stocks/[symbol]] ${symbol} の株価を取得できませんでした: ${err instanceof Error ? err.message : String(err)}`)
    // 文言は DESIGN.md §6-12 の三点形式（何が起きたか／データはどうなったか／どうすればいいか）。仮の数字は出さない。
    return (
      <div className="space-y-5">
        <h1 className="text-h1 text-ink">{symbol}</h1>
        {/* 取得できなかったことは --warning-ink で書く（§5-1 色のルール）。枠で囲わず白い帯に、文字は左揃え
            （§2 の「全部中央揃え」の禁止・§6-12）。components/MasterSignals.tsx の「シグナルを取得できませんでした」と同じ型 */}
        <div className="bg-card rounded-card px-4 py-5 space-y-1">
          <p className="text-body text-warning-ink">{symbol} の株価を取得できませんでした</p>
          <p className="text-body text-ink-2 max-w-[42rem]">
            株価のデータ源（Yahoo Finance など）から、この銘柄の値を受け取れませんでした。実データが取れないときは、代わりの数字を作らずここで止めます。このページからの売買もできません。
          </p>
          <p className="text-body text-ink-2 max-w-[42rem]">
            時間をおいて再読み込みしてください。銘柄コードの綴りが違う場合は、正しいコードで開き直してください。
          </p>
        </div>
        {/* 補助的な移動は文字ボタン（§6-1: 枠なし・--brand の文字・ホバーで下線） */}
        <a href="/" className="inline-block text-small text-brand hover:underline">トップに戻る</a>
      </div>
    )
  }
}

export async function generateMetadata({ params }: Props) {
  const { symbol } = await params
  return {
    title: `${symbol.toUpperCase()} — InvestSim`,
  }
}
