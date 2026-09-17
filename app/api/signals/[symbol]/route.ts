import { NextResponse } from 'next/server'
import { getQuote, getHistory, getFundamentals } from '@/lib/market'
import { findStock } from '@/lib/market/universe'
import investors from '@/lib/investors'
import type { Signal } from '@/types'

// GET /api/signals/:symbol — 名人5人（バフェット／ソロス／リンチ／グレアム／ダリオ）の判定。
//
// allowMock:false は外さないこと（原則9）。/watch の名人の区画（MasterSignals）と銘柄詳細の
// InvestorPanel がここを読む。既定の allowMock:true のままだと、実データ3経路が全滅したときに
// providers/mock の«乱数の株価・架空の財務»で判定が作られ、利用者はそれを名人の判断だと思って読む。
// 取れないときは値を作らず 502 で止める。画面側（MasterSignals.tsx／InvestorPanel.tsx）は
// 「シグナルを取得できませんでした」を出す前提で書かれている。
//
// 財務データだけ取れないとき（2026-09-17 スライス2）: lib/market の getFundamentals は allowMock:false でも
// throw せず空 `{}` を返す（yahoodirect は全項目 undefined の `{ pe: undefined, … }` を返すこともある）。
// 各モデルの `if (!fundamentals)` は `{}` を真値として素通りし、hold／「○○基準を満たす指標が不足」を返す。
// これは画面で「◇ 様子見」＝本物の判断に見える。そこで、財務を材料にする名人には analyze() を呼ばず、
// `undecidable` に理由を入れて「判定できません」と返す（オーナー決定: 4人を消すのではなく、材料が無い
// ときに判断を保留する態度そのものを利用者に見せる。原則11）。応答の形は既存の { symbol, signals } に
// `undecidable` を足すだけ（既存のキーの意味は変えない）。

// 財務データを材料にする名人。lib/investors/*.ts の analyze() の引数で裏取りした（2026-09-17）:
//   buffett.ts:11 / lynch.ts:11 / graham.ts:11 / dalio.ts:11 … analyze({ fundamentals })  → 財務だけを読む
//   soros.ts:33                                              … analyze({ quote, history }) → 株価だけを読む
// モデルを増やす・引数を変えるときはここも直す。scripts/check-signals-undecidable.ts が、この一覧と
// 各モデルの analyze() の引数の食い違いを検査する。
const FUNDAMENTALS_INVESTOR_IDS: ReadonlySet<string> = new Set(['buffett', 'lynch', 'graham', 'dalio'])

// 画面にそのまま出す文。「判定できません」の札は画面側が付けるので、ここは理由と態度を書く。
// 文の形は DESIGN.md §6-12 の三点（何が起きたか／データはどうなったか／どうすればいいか）。
const NO_FUNDAMENTALS_REASON =
  '財務データ（PER・ROE など）を取得できなかったため、判定できません。材料が無いときは、無理に判断せず保留にします。時間をおいて再読み込みしてください。'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol: rawSymbol } = await params
  const symbol = rawSymbol.toUpperCase()

  try {
    const [quote, history, fundamentals] = await Promise.all([
      getQuote(symbol, { allowMock: false }),
      getHistory(symbol, '1y', { allowMock: false }),
      getFundamentals(symbol, { allowMock: false }),
    ])

    // 「取れた」＝値が1つでも入っている。`{}`（3経路の全滅・yahoo2 の schema gap）も、キーはあるが全項目
    // undefined のオブジェクト（yahoodirect が空の応答を写したもの）も「取れていない」とみなす。
    const hasFundamentals = Object.values(fundamentals).some(v => v != null)

    // 単位の変換（2026-09-11）: `FundamentalsData.debtToEquity` は Yahoo 原値の%表記（78.4 ＝ 0.78倍。
    // 規約は types/index.ts に明記）。一方 lib/investors/*.ts の5モデルの閾値は倍率で書かれている
    // （dalio `> 2.0`／graham `< 0.5`／lynch `< 0.3` など）ので、渡す手前で /100 して倍率に直したコピーを渡す。
    // 元オブジェクトは変えない（スクリーニング側 lib/backtest は%前提のまま正しい）。
    const fundamentalsForModels =
      fundamentals.debtToEquity == null
        ? fundamentals
        : { ...fundamentals, debtToEquity: fundamentals.debtToEquity / 100 }

    const signals: Record<string, Signal> = {}
    const undecidable: Record<string, string> = {}
    for (const investor of investors) {
      if (!hasFundamentals && FUNDAMENTALS_INVESTOR_IDS.has(investor.id)) {
        undecidable[investor.id] = NO_FUNDAMENTALS_REASON
        continue
      }
      // 財務が無いときは `{}` ではなく undefined を渡す（株価だけで判定する名人には関係ないが、
      // 「無い」を「空の表」に見せかけない）。財務があるときは従来どおり。
      signals[investor.id] = investor.analyze({
        quote, history, fundamentals: hasFundamentals ? fundamentalsForModels : undefined,
      })
    }

    const anyUndecidable = Object.keys(undecidable).length > 0
    return NextResponse.json(anyUndecidable ? { symbol, signals, undecidable } : { symbol, signals }, {
      // 判定できない名人が1人でもいる応答は CDN に残さない（no-store）。5分の s-maxage のままだと、
      // 財務の取得が一時的に失敗しただけの状態が5分間「判定できません」として全利用者に配られる。
      // 5人とも判定できた応答は従来どおり5分。
      // ただし no-store が効くのは CDN（Vercel の手前の共有キャッシュ）だけで、取得元のサーバー内キャッシュは別
      // （reviewer W2・2026-09-17）: lib/market/providers/yahoo2.ts の yf2GetFundamentals は空の `{}` もそのまま
      // writeCache し、readCache は `{}` を真値として返す（FUNDAMENTALS_TTL_MS＝30分）。yahoodirect.ts の fetch も
      // `next: { revalidate: 3600 }` で、空の応答が最大1時間残りうる。つまり取得元が復旧しても、同じサーバー
      // （プロセス）からは最大30分〜1時間「判定できません」が返り続けうる。ここでは直さない（lib/ はスライス5の対象）。
      headers: {
        'Cache-Control': anyUndecidable ? 'no-store' : 'public, s-maxage=300, stale-while-revalidate=60',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to compute signals'
    // 原因（«Real quote unavailable for AAPL — yahoo2: …»）は画面に出さないので、サーバーのログにだけ残す
    // （app/stocks/[symbol]/page.tsx の catch と同じ流儀。reviewer S5・2026-09-17）。応答の中身は変えない。
    console.error(`[api/signals/[symbol]] ${symbol} のシグナルを計算できませんでした: ${message}`)
    // 502 = 上流のデータ源が返せなかった（app/api/stocks/[symbol]/route.ts と同じ形）。
    // 入力ミス（存在しない銘柄）とデータ源の障害を画面側が区別できるよう、判っている範囲を添える。
    return NextResponse.json(
      { error: message, symbol, listed: Boolean(findStock(symbol)) },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
