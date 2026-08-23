import type { InvestorLogic, AnalysisInput, Signal } from '@/types'

const dalio: InvestorLogic = {
  id: 'dalio',
  name: 'Ray Dalio',
  nameJa: 'レイ・ダリオ',
  description: 'ブリッジウォーター創業者。リスクパリティと景気サイクル重視。',
  philosophy: '負債サイクルを理解し、分散でリスクを均等化せよ。',
  avatarColor: '#E87CA8',

  analyze({ fundamentals }: AnalysisInput): Signal {
    if (!fundamentals) {
      return { action: 'hold', strength: 1, reasons: ['財務データを取得中です'] }
    }

    const { roe, debtToEquity, revenueGrowth } = fundamentals
    const reasons: string[] = []

    // 売り条件を先に評価
    const isSell =
      (debtToEquity !== undefined && debtToEquity > 2.0) ||
      (revenueGrowth !== undefined && revenueGrowth < 0)

    if (isSell) {
      const sellReasons: string[] = []
      if (debtToEquity !== undefined && debtToEquity > 2.0) {
        sellReasons.push(`負債資本比率 ${debtToEquity.toFixed(2)}は過剰（基準: 2.0以下）`)
      }
      if (revenueGrowth !== undefined && revenueGrowth < 0) {
        sellReasons.push(`売上成長率 ${(revenueGrowth * 100).toFixed(1)}%はマイナス成長`)
      }
      return { action: 'sell', strength: 2, reasons: sellReasons }
    }

    // 指標ごとに理由を収集
    if (roe !== undefined && roe > 0.15) {
      reasons.push(`ROE ${(roe * 100).toFixed(1)}%は高収益経営（基準: 15%超）`)
    } else if (roe !== undefined && roe > 0.10) {
      reasons.push(`ROE ${(roe * 100).toFixed(1)}%は安定水準（基準: 10%超）`)
    }

    if (debtToEquity !== undefined && debtToEquity < 1.0) {
      reasons.push(`負債資本比率 ${debtToEquity.toFixed(2)}は健全（基準: 1.0未満）`)
    } else if (debtToEquity !== undefined) {
      reasons.push(`負債資本比率 ${debtToEquity.toFixed(2)}はやや高め`)
    }

    if (revenueGrowth !== undefined && revenueGrowth > 0.10) {
      reasons.push(`売上成長率 ${(revenueGrowth * 100).toFixed(1)}%は高成長（基準: 10%超）`)
    } else if (revenueGrowth !== undefined && revenueGrowth > 0.05) {
      reasons.push(`売上成長率 ${(revenueGrowth * 100).toFixed(1)}%は安定成長（基準: 5%超）`)
    }

    // 強買い: ROE > 15% かつ D/E < 1.0 かつ 売上成長 > 10%
    const condROEHigh = roe !== undefined && roe > 0.15
    const condDELow = debtToEquity !== undefined && debtToEquity < 1.0
    const condGrowthHigh = revenueGrowth !== undefined && revenueGrowth > 0.10

    if (condROEHigh && condDELow && condGrowthHigh) {
      return { action: 'buy', strength: 3, reasons }
    }

    // 買い: ROE > 10% かつ 売上成長 > 5%
    const condROEMid = roe !== undefined && roe > 0.10
    const condGrowthMid = revenueGrowth !== undefined && revenueGrowth > 0.05

    if (condROEMid && condGrowthMid) {
      return { action: 'buy', strength: 2, reasons }
    }

    // ホールド
    return {
      action: 'hold',
      strength: 1,
      reasons: reasons.length ? reasons : ['ダリオ基準を満たす指標が不足'],
    }
  },
}

export default dalio
