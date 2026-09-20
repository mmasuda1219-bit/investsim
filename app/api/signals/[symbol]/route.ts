import { NextResponse } from 'next/server'
import { getQuote, getHistory, getFundamentals } from '@/lib/market'
import { findStock } from '@/lib/market/universe'
import { US_UNIVERSE } from '@/lib/market/us-universe'
import { RULEBOOK_INVESTOR_IDS, getRulebook, publishedRules, evaluate, type RulebookResult } from '@/lib/investors/rulebooks'

// GET /api/signals/:symbol — 名人のルールブックに、この銘柄の財務データを当てた結果（2026-09-17 S2）。
//
// 旧: lib/investors/*.ts の analyze() で5人の「▲買い／◇様子見」の札を返していた。いまは lib/investors/rulebooks/ の
// evaluate()（純関数）でルールごとの状態（目安を満たす／目安を満たさない／判定できない）を返す。analyze() は
// /simulate の売買判定専用として残す（DECISIONS.md 2026-09-17「投資家の定義を rulebooks に一本化」）。
// 出すのはルールブックがある投資家（当面バフェット）の、一次資料で照合済みの出典を持つルールだけ（publishedRules）。
//
// 応答: { symbol, rulebooks: { [id]: { version, checks } }, undecidable? }
//   - checks は RuleCheck[]（データルールだけ。言葉のルールは画面側がルールブックから読む）
//   - undecidable は「財務データがまったく取れなかった投資家 id → 理由の文」。画面はこの文を一覧の手前に1回出す
//   - 判定できないルールが1つでもあれば no-store（一時的な失敗を5分間 CDN に残さない。理由の詳細は旧版の注釈と同じ:
//     取得元のサーバー内キャッシュ（yahoo2 30分・yahoodirect 1時間）は別で、lib/ はスライス5の対象）
//
// allowMock:false は外さないこと（原則9）。既定の allowMock:true のままだと、実データ3経路が全滅したときに
// providers/mock の«架空の財務»で判定が作られる。取れないときは値を作らず 502 で止める。
// getQuote / getHistory は判定には使わないが、銘柄が実在しデータ源が生きていることの確認として残す
// （取れなければ catch → 502 ＋ listed）。scripts/check-previous-close.ts が3つの呼び出しの文字列を固定している。
//
// 単位: D/E は Yahoo 原値の%表記のまま evaluate() に渡す（換算は lib/investors/rulebooks/evaluate.ts だけ。ここで /100 しない）。

// 画面にそのまま出す文。「判定できない」の語は画面側が付けるので、ここは理由と態度を書く。
// 文の形は DESIGN.md §6-12 の三点（何が起きたか／データはどうなったか／どうすればいいか）。
const NO_FUNDAMENTALS_REASON =
  '財務データ（ROE・負債比率など）を取得できなかったため、判定できません。材料が無いときは、無理に判断せず保留にします。時間をおいて再読み込みしてください。'

// 業種はローカルの一覧から引く（外部 API を増やさない）。綴りは一覧ごとに違う（us-universe.ts 'Financials'、
// data/universe.json 'Finance'）が、ルールブックの excludeSectors が両方を持つ。どちらにも無ければ undefined
// （日本株・ETF など）→ 業種で除外するルール（B4）は 'unknown-sector' で判定できない、に倒す。
function sectorOf(symbol: string): string | undefined {
  return US_UNIVERSE.find(s => s.symbol === symbol)?.sector ?? findStock(symbol)?.sector
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol: rawSymbol } = await params
  const symbol = rawSymbol.toUpperCase()

  try {
    const [, , fundamentals] = await Promise.all([
      getQuote(symbol, { allowMock: false }),
      getHistory(symbol, '1y', { allowMock: false }),
      getFundamentals(symbol, { allowMock: false }),
    ])

    // 「取れた」＝値が1つでも入っている。`{}`（3経路の全滅・yahoo2 の schema gap）も、キーはあるが全項目
    // undefined のオブジェクト（yahoodirect が空の応答を写したもの）も「取れていない」とみなす。
    const hasFundamentals = Object.values(fundamentals).some(v => v != null)
    const sector = sectorOf(symbol)

    const rulebooks: Record<string, RulebookResult> = {}
    const undecidable: Record<string, string> = {}
    for (const id of RULEBOOK_INVESTOR_IDS) {
      const book = getRulebook(id)
      if (!book) continue
      const published = { ...book, rules: publishedRules(book) }
      rulebooks[id] = { version: book.version, checks: evaluate(published, fundamentals, { sector }) }
      if (!hasFundamentals) undecidable[id] = NO_FUNDAMENTALS_REASON
    }

    const anyUndecidable = Object.values(rulebooks).some(r => r.checks.some(c => c.state === 'undecidable'))
    const body = Object.keys(undecidable).length > 0 ? { symbol, rulebooks, undecidable } : { symbol, rulebooks }
    return NextResponse.json(body, {
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
