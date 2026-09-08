// ユニバースの純ロジック。データ源（data/universe.json）にもNext.jsにも依存しない。
//
// lib/screen/refresh.ts と同じ方針で «純ロジックを分離» している。理由:
// 実体の lib/market/universe.ts は `import 'server-only'` を持つため tsx から import できず、
// そのままではスモークテスト（scripts/check-universe.ts）が書けない。
// 検索や絞り込みの規約はここに置き、データの読み込みだけを server-only 側に残す。

export interface UniverseStock {
  symbol: string
  name: string
  /** 'Nasdaq Global Select' | 'NYSE' など、公式リストの上場区分。 */
  exchange: string
  sector?: string
  industry?: string
  marketCap?: number
  currency: string
  /** 上場維持基準への抵触が公式リストに表示されている銘柄（Financial Status ≠ N）。 */
  deficient?: boolean
}

export interface UniverseFile {
  source: string
  listedFileCreatedAt: string
  builtAt: string
  priceVerifiedBy: string
  count: number
  stocks: UniverseStock[]
}

export interface UniverseFilter {
  /** 時価総額の下限（USD）。 */
  minMarketCap?: number
  /** 上場維持基準に抵触している銘柄を除くか。 */
  excludeDeficient?: boolean
  sector?: string
}

export interface Universe {
  readonly stocks: readonly UniverseStock[]
  readonly size: number
  find(symbol: string): UniverseStock | undefined
  isTradeable(symbol: string): boolean
  topByMarketCap(n: number): UniverseStock[]
  search(query: string, limit?: number): UniverseStock[]
  filter(f?: UniverseFilter): UniverseStock[]
}

/** 表記ゆれを1本に寄せる。'brk-b' も ' BRK-B ' も同じ銘柄として引ける。 */
export function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase()
}

export function createUniverse(stocks: readonly UniverseStock[]): Universe {
  // 時価総額の降順を «既定の並び» として固定する。検索結果の同ランク内の順序が
  // これに従うので、呼ぶ側が毎回ソートし直さなくても «大きい会社が上» になる。
  // 時価総額が無い銘柄（screener/Yahooどちらにも無かったもの）は末尾に置く。
  // 0 を代入して «時価総額ゼロの会社» を作らない（原則9: 欠損は欠損のまま）。
  const ordered = [...stocks].sort((a, b) => {
    const av = a.marketCap, bv = b.marketCap
    if (av == null && bv == null) return a.symbol.localeCompare(b.symbol)
    if (av == null) return 1
    if (bv == null) return -1
    return bv - av || a.symbol.localeCompare(b.symbol)
  })

  const bySymbol = new Map(ordered.map(s => [s.symbol, s]))

  const find = (symbol: string) => bySymbol.get(normalizeSymbol(symbol))

  return {
    stocks: ordered,
    size: ordered.length,
    find,
    /**
     * 「このアプリで売買してよい銘柄か」の判定。
     * 載っている ＝ 一覧の生成時点で公式リストに存在し実価格が取れた、という意味。
     * 載っていない銘柄が «存在しない» とは限らない（新規上場・生成後の変更）ので、
     * 呼び出し側は «知らない銘柄» として扱い «無効» と断定しないこと。
     */
    isTradeable: (symbol: string) => bySymbol.has(normalizeSymbol(symbol)),

    topByMarketCap: (n: number) => ordered.slice(0, Math.max(0, n)),

    /**
     * ティッカー完全一致 → 前方一致 → 社名前方一致 → 社名部分一致 の順に強い。
     * 同ランク内は既定の並び（時価総額降順）のまま。よく知られた会社が上に来るための
     * 並びであって «おすすめ» ではない（アプリは推奨しない）。
     */
    search(query: string, limit = 20): UniverseStock[] {
      const q = normalizeSymbol(query)
      if (!q) return []
      const qLower = q.toLowerCase()

      const scored: { s: UniverseStock; rank: number }[] = []
      for (const s of ordered) {
        let rank: number
        if (s.symbol === q) rank = 0
        else if (s.symbol.startsWith(q)) rank = 1
        else if (s.name.toLowerCase().startsWith(qLower)) rank = 2
        else if (s.name.toLowerCase().includes(qLower)) rank = 3
        else continue
        scored.push({ s, rank })
      }
      // Array.prototype.sort は安定なので、rank だけで並べれば同ランク内は元の並び順が残る。
      scored.sort((a, b) => a.rank - b.rank)
      return scored.slice(0, Math.max(0, limit)).map(x => x.s)
    },

    filter(f: UniverseFilter = {}): UniverseStock[] {
      return ordered.filter(s => {
        // 時価総額が欠損している銘柄は «下限を満たすか判らない» ので通さない
        // （lib/screen/rank.ts の fail-closed と同じ扱い）。
        if (f.minMarketCap != null && !(typeof s.marketCap === 'number' && s.marketCap >= f.minMarketCap)) return false
        if (f.excludeDeficient && s.deficient) return false
        if (f.sector && s.sector !== f.sector) return false
        return true
      })
    },
  }
}
