import type { InvestorLogic, AnalysisInput, Signal } from '@/types'

const buffett: InvestorLogic = {
  id: 'buffett',
  name: 'Warren Buffett',
  nameJa: 'ウォーレン・バフェット',
  description: 'バークシャー・ハサウェイ会長。バリュー投資の巨匠。',
  philosophy: '素晴らしい会社を適正価格で買い、永遠に保有する。',
  avatarColor: '#3B82F6',

  analyze({ fundamentals }: AnalysisInput): Signal {
    if (!fundamentals) {
      return { action: 'hold', strength: 1, reasons: ['財務データを取得中です'] }
    }

    const reasons: string[] = []
    let score = 0

    if (fundamentals.pe !== undefined && fundamentals.pe > 0 && fundamentals.pe < 15) {
      score++
      reasons.push(`PER ${fundamentals.pe.toFixed(1)}倍は割安水準（基準: 15倍未満）`)
    } else if (fundamentals.pe !== undefined && fundamentals.pe > 25) {
      reasons.push(`PER ${fundamentals.pe.toFixed(1)}倍は割高水準（基準: 15倍未満）`)
    }

    if (fundamentals.pb !== undefined && fundamentals.pb < 1.5) {
      score++
      reasons.push(`PBR ${fundamentals.pb.toFixed(2)}倍は資産価値より割安（基準: 1.5倍未満）`)
    }

    if (fundamentals.roe !== undefined && fundamentals.roe > 0.15) {
      score++
      reasons.push(`ROE ${(fundamentals.roe * 100).toFixed(1)}%は高収益経営（基準: 15%超）`)
    }

    if (fundamentals.debtToEquity !== undefined && fundamentals.debtToEquity < 0.5) {
      score++
      reasons.push('低負債で財務基盤が安定している')
    }

    if (fundamentals.earningsGrowth !== undefined && fundamentals.earningsGrowth > 0.1) {
      score++
      reasons.push(`利益成長率 ${(fundamentals.earningsGrowth * 100).toFixed(0)}%は堅調`)
    }

    if (score >= 4) return { action: 'buy', strength: 3, reasons }
    if (score >= 2) return { action: 'buy', strength: 2, reasons }

    const isSell =
      fundamentals.pe !== undefined &&
      fundamentals.pe > 25 &&
      fundamentals.earningsGrowth !== undefined &&
      fundamentals.earningsGrowth < 0.05

    if (isSell) {
      return { action: 'sell', strength: 2, reasons: ['PERが高く利益成長が鈍化している'] }
    }

    return { action: 'hold', strength: 1, reasons: reasons.length ? reasons : ['バフェット基準を満たす指標が不足'] }
  },
}

export default buffett
