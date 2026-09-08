// 取引可能ユニバースの生成スクリプト。
//
// 実行: npx tsx scripts/build-universe.ts
// 出力: data/universe.json（gitにコミットする。本番はこのファイルを読むだけでDB不要）
//
// なぜ手元で生成してコミットするのか:
//   Yahoo は Vercel の IP を恒常的に 429 でブロックする（DECISIONS 2026-07-16）。
//   「上場しているか」「実際に値が付くか」の確認は本番では走らせられないので、
//   オーナーの居住 IP で作って結果を成果物として持ち込む。
//
// 原則9（過去データは必ず実データ）:
//   ここに載る銘柄は「Nasdaq Trader の公式上場リストに存在し」かつ
//   「Yahoo が実際に価格を返した」ものだけ。値が取れなかった銘柄は落とす。
//   モック・推測・手打ちの銘柄は1件も入れない。
//
// 一次情報:
//   - https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt （Nasdaq上場）
//   - https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt  （NYSE/NYSE American/Arca/Cboe）
//   時価総額・セクターは Nasdaq の screener API で補うが、これは非公式なので
//   «失敗しても中断しない»（あくまで付加情報。ユニバースの根拠は公式リストのほう）。
import fs from 'fs'
import path from 'path'
import type { UniverseStock } from '../lib/market/universe'

const NASDAQ_LISTED = 'https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt'
const OTHER_LISTED = 'https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt'
const SCREENER =
  'https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=25&offset=0&download=true'

/** Yahoo の quote() は配列を受ける。実測で1,500件/1リクエストまで通るが、
 *  1件でも壊れると塊ごと失うので保守的に刻む。 */
const QUOTE_CHUNK = 300
const CHUNK_SPACING_MS = 1200

/** 普通株以外を名前で落とすためのパターン。記号の形（末尾W/U/R等）で判定すると
 *  正当な普通株を巻き込むため、発行体が付けた証券名のほうを見る。 */
const NON_COMMON = [
  'warrant', 'right', 'unit', 'preferred', 'depositary', 'depository',
  'notes', 'debenture', 'trust preferred', '% due', 'subordinated',
  'convertible', 'when issued', 'when-issued', 'contingent value',
]

/** 取引所コード（otherlisted の Exchange 列）。
 *  A=NYSE American, N=NYSE, P=NYSE Arca, Z=Cboe BZX, V=IEX。
 *  Arca/BZX/IEX はほぼ ETF の上場先なので普通株ユニバースからは外す。 */
const OTHER_EXCHANGES: Record<string, string> = { N: 'NYSE', A: 'NYSE American' }

/** Nasdaq の Market Category。Q=Global Select, G=Global, S=Capital Market。 */
const NASDAQ_TIERS: Record<string, string> = {
  Q: 'Nasdaq Global Select',
  G: 'Nasdaq Global',
  S: 'Nasdaq Capital Market',
}

interface Row {
  symbol: string
  name: string
  exchange: string
  /** Financial Status が N 以外（上場維持基準に抵触）なら true。 */
  deficient: boolean
}

async function getText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'InvestSim universe builder (marco1219yoo@gmail.com)' },
  })
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)
  return res.text()
}

/** '|' 区切りのシンボルディレクトリを行オブジェクトに変換する（末尾の File Creation Time 行は捨てる）。 */
function parsePipe(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n').map(l => l.replace(/\r$/, ''))
  const header = lines[0].split('|')
  const out: Record<string, string>[] = []
  for (const line of lines.slice(1)) {
    if (line.startsWith('File Creation Time')) continue
    const cells = line.split('|')
    if (cells.length !== header.length) continue
    const row: Record<string, string> = {}
    header.forEach((h, i) => { row[h] = cells[i] })
    out.push(row)
  }
  return out
}

function isCommonStock(name: string): boolean {
  const n = name.toLowerCase()
  return !NON_COMMON.some(p => n.includes(p))
}

/** Nasdaq Trader の表記を Yahoo の表記へ寄せる。
 *  クラス株は '.'（BF.A）→ '-'（BF-A）。優先株の '$' は普通株ではないのでここには来ない。 */
function toYahooSymbol(raw: string): string | null {
  const s = raw.trim().toUpperCase()
  if (!s || s.includes('$')) return null
  const converted = s.replace(/\./g, '-')
  return /^[A-Z]{1,5}(-[A-Z])?$/.test(converted) ? converted : null
}

/** 証券名から会社名だけを残す（"Apple Inc. Common Stock" → "Apple Inc."）。 */
function cleanName(name: string): string {
  return name
    .replace(/\s*-?\s*(Class [A-Z] )?Common Stock.*$/i, '')
    .replace(/\s*-?\s*Ordinary Shares.*$/i, '')
    .replace(/\s*-?\s*American Depositary Shares.*$/i, '')
    .replace(/\s*,?\s*Inc\.?$/i, m => m)
    .trim() || name.trim()
}

function collectRows(nasdaqText: string, otherText: string): Row[] {
  const rows: Row[] = []

  for (const r of parsePipe(nasdaqText)) {
    if (r['Test Issue'] === 'Y' || r['ETF'] === 'Y') continue
    if (!isCommonStock(r['Security Name'])) continue
    const symbol = toYahooSymbol(r['Symbol'])
    if (!symbol) continue
    rows.push({
      symbol,
      name: cleanName(r['Security Name']),
      exchange: NASDAQ_TIERS[r['Market Category']] ?? 'Nasdaq',
      deficient: r['Financial Status'] !== 'N',
    })
  }

  for (const r of parsePipe(otherText)) {
    if (r['Test Issue'] === 'Y' || r['ETF'] === 'Y') continue
    const exchange = OTHER_EXCHANGES[r['Exchange']]
    if (!exchange) continue
    if (!isCommonStock(r['Security Name'])) continue
    // NASDAQ Symbol 列のほうが Yahoo の表記に近い（BRK-B）。無ければ ACT Symbol。
    const symbol = toYahooSymbol(r['NASDAQ Symbol'] || r['ACT Symbol'])
    if (!symbol) continue
    rows.push({
      symbol,
      name: cleanName(r['Security Name']),
      exchange,
      // otherlisted には Financial Status 列が無い。無い情報を推測せず「不明＝正常扱い」にする。
      deficient: false,
    })
  }

  // 同じ銘柄が両ファイルに出ることがある（重複上場）。先勝ちで1件に寄せる。
  const seen = new Set<string>()
  return rows.filter(r => (seen.has(r.symbol) ? false : (seen.add(r.symbol), true)))
}

/** 非公式 screener API から時価総額・セクターを拾う。失敗しても null を返して続行する。 */
async function fetchScreener(): Promise<Map<string, { marketCap?: number; sector?: string; industry?: string }> | null> {
  try {
    const res = await fetch(SCREENER, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        Accept: 'application/json',
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    const map = new Map<string, { marketCap?: number; sector?: string; industry?: string }>()
    for (const r of json?.data?.rows ?? []) {
      const cap = parseFloat(r.marketCap)
      map.set(String(r.symbol).toUpperCase(), {
        marketCap: Number.isFinite(cap) && cap > 0 ? cap : undefined,
        sector: r.sector || undefined,
        industry: r.industry || undefined,
      })
    }
    return map
  } catch (e) {
    console.warn(`! screener API を取得できませんでした（時価総額・セクターは欠損のまま進めます）: ${e instanceof Error ? e.message : e}`)
    return null
  }
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

async function main() {
  console.log('公式の上場リストを取得中…')
  const [nasdaqText, otherText] = await Promise.all([getText(NASDAQ_LISTED), getText(OTHER_LISTED)])
  const listedAt =
    (nasdaqText.match(/File Creation Time:\s*([^|]+)/)?.[1] ?? '').trim() || '不明'

  const rows = collectRows(nasdaqText, otherText)
  console.log(`公式リストの普通株候補: ${rows.length}件（ファイル生成時刻 ${listedAt}）`)

  console.log('時価総額・セクターを取得中…')
  const enrich = await fetchScreener()

  console.log(`Yahoo で実際に値が付くかを検証中（${QUOTE_CHUNK}件ずつ）…`)
  const { default: YahooFinance } = await import('yahoo-finance2')
  const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] })

  const verified: UniverseStock[] = []
  let unpriced = 0
  for (let i = 0; i < rows.length; i += QUOTE_CHUNK) {
    const chunk = rows.slice(i, i + QUOTE_CHUNK)
    let quotes: any[] = []
    try {
      quotes = await yf.quote(chunk.map(r => r.symbol), { return: 'array' } as any) as any[]
    } catch (e) {
      console.warn(`  ! ${i}〜${i + chunk.length} の取得に失敗（この塊は落とします）: ${e instanceof Error ? e.message : e}`)
      unpriced += chunk.length
      await sleep(CHUNK_SPACING_MS)
      continue
    }
    const bySymbol = new Map(quotes.map(q => [String(q.symbol).toUpperCase(), q]))
    for (const r of chunk) {
      const q = bySymbol.get(r.symbol)
      // 原則9: 価格が実際に返ってきた銘柄だけを「取引できる」と認める。
      const price = q?.regularMarketPrice
      if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) { unpriced++; continue }
      const ex = enrich?.get(r.symbol)
      verified.push({
        symbol: r.symbol,
        // Yahoo の表示名のほうが人間に馴染むが、無ければ公式リストの証券名を使う。
        name: (q.shortName || q.longName || r.name).trim(),
        exchange: r.exchange,
        sector: ex?.sector,
        industry: ex?.industry,
        // 時価総額は Yahoo を優先（screener API より鮮度が高い）。
        marketCap: typeof q.marketCap === 'number' ? q.marketCap : ex?.marketCap,
        currency: q.currency ?? 'USD',
        deficient: r.deficient || undefined,
      })
    }
    process.stdout.write(`  ${Math.min(i + QUOTE_CHUNK, rows.length)}/${rows.length}\r`)
    await sleep(CHUNK_SPACING_MS)
  }

  verified.sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0) || a.symbol.localeCompare(b.symbol))

  const outPath = path.join(process.cwd(), 'data', 'universe.json')
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        // 出典と鮮度をデータ自身に持たせる。UI が「いつ時点か」を正直に出せるようにするため。
        source: 'Nasdaq Trader symbol directory (nasdaqlisted.txt / otherlisted.txt)',
        listedFileCreatedAt: listedAt,
        builtAt: new Date().toISOString(),
        priceVerifiedBy: 'yahoo-finance2 quote()',
        count: verified.length,
        stocks: verified,
      },
      null,
      0,
    ) + '\n',
  )

  const withCap = verified.filter(s => typeof s.marketCap === 'number')
  const tier = (min: number) => withCap.filter(s => (s.marketCap as number) >= min).length
  console.log(`\n完了: ${verified.length}件を data/universe.json に書き出しました`)
  console.log(`  価格が取れず除外: ${unpriced}件`)
  console.log(`  時価総額あり: ${withCap.length}件`)
  console.log(`    $100億以上: ${tier(1e10)} / $20億以上: ${tier(2e9)} / $3億以上: ${tier(3e8)}`)
  console.log(`  上場維持基準に抵触の表示あり: ${verified.filter(s => s.deficient).length}件`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
