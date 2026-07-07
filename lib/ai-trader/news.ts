const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Accept': 'application/json',
}

export interface NewsArticle {
  title: string
  publisher: string
  link: string
  publishedAt: number
}

export async function fetchNews(symbol: string, count = 5): Promise<NewsArticle[]> {
  try {
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=0&newsCount=${count}&enableFuzzyQuery=false`
    const res = await fetch(url, { headers: HEADERS, next: { revalidate: 300 } })
    if (!res.ok) return []
    const json = await res.json()
    const news: any[] = json?.finance?.result?.[0]?.news ?? json?.news ?? []
    return news.slice(0, count).map((n: any) => ({
      title:       n.title ?? '',
      publisher:   n.publisher ?? '',
      link:        n.link ?? '',
      publishedAt: n.providerPublishTime ?? 0,
    }))
  } catch {
    return []
  }
}
