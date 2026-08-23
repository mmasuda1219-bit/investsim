import type { InvestorLogic, AnalysisInput, Signal, HistoricalBar } from '@/types'

function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50
  let gains = 0
  let losses = 0
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff > 0) gains += diff
    else losses += Math.abs(diff)
  }
  const avgGain = gains / period
  const avgLoss = losses / period
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

function calcSMA(data: HistoricalBar[], period: number): number | null {
  if (data.length < period) return null
  const slice = data.slice(-period)
  return slice.reduce((sum, d) => sum + d.close, 0) / period
}

const soros: InvestorLogic = {
  id: 'soros',
  name: 'George Soros',
  nameJa: 'ジョージ・ソロス',
  description: 'クォンタム・ファンド創設者。マクロ投資と再帰理論の巨匠。',
  philosophy: '市場は常に間違っている。その歪みを見つけ逆張りする。',
  avatarColor: '#A87CE8',

  analyze({ quote, history }: AnalysisInput): Signal {
    if (history.length < 20) {
      return { action: 'hold', strength: 1, reasons: ['チャートデータを取得中です'] }
    }

    const closes = history.map((h) => h.close)
    const rsi = calcRSI(closes, 14)
    const ma200 = calcSMA(history, 200)
    const ma50 = calcSMA(history, 50)

    const reasons: string[] = []
    let action: 'buy' | 'sell' | 'hold' = 'hold'
    let strength: 1 | 2 | 3 = 1

    if (rsi < 30) {
      reasons.push(`RSI ${rsi.toFixed(1)}は売られすぎ（30未満）。反発を狙う。`)
      action = 'buy'
      strength = 2
    } else if (rsi > 70) {
      reasons.push(`RSI ${rsi.toFixed(1)}は買われすぎ（70超）。利益確定を検討。`)
      action = 'sell'
      strength = 2
    } else {
      reasons.push(`RSI ${rsi.toFixed(1)}は中立ゾーン（30〜70）`)
    }

    if (ma200 !== null) {
      if (quote.price > ma200) {
        reasons.push(`株価は200日MA（${ma200.toFixed(2)}）を上回る。長期上昇トレンド。`)
        if (action === 'buy') strength = 3
        else if (action === 'hold') { action = 'buy'; strength = 1 }
      } else {
        reasons.push(`株価は200日MA（${ma200.toFixed(2)}）を下回る。長期下降トレンド。`)
        if (action === 'sell') strength = 3
        else if (action === 'hold') { action = 'sell'; strength = 1 }
      }
    }

    if (ma50 !== null && ma200 !== null) {
      if (ma50 > ma200) {
        reasons.push('50日MAが200日MAを上回るゴールデンクロス状態')
      } else {
        reasons.push('50日MAが200日MAを下回るデッドクロス状態')
      }
    }

    return { action, strength, reasons }
  },
}

export default soros
