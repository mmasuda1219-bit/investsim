import type { InvestorLogic, AnalysisInput, Signal } from '@/types'

const lynch: InvestorLogic = {
  id: 'lynch',
  name: 'Peter Lynch',
  nameJa: 'ピーター・リンチ',
  description: 'フィデリティ・マゼランファンド伝説のマネージャー。',
  philosophy: '身近なところに10倍株がある。PEG比率で成長株を割安に買う。',
  avatarColor: '#10B981',

  analyze({ fundamentals }: AnalysisInput): Signal {
    if (!fundamentals) {
      return { action: 'hold', strength: 1, reasons: ['財務データを取得中です'] }
    }

    const reasons: string[] = []
    let score = 0

    const { pegRatio, revenueGrowth, earningsGrowth, debtToEquity } = fundamentals

    if (pegRatio !== undefined) {
      if (pegRatio < 1.0) {
        score += 2
        reasons.push(`PEG比率 ${pegRatio.toFixed(2)}は割安成長株の基準（1.0未満）を満たす`)
      } else if (pegRatio < 1.5) {
        score++
        reasons.push(`PEG比率 ${pegRatio.toFixed(2)}は許容範囲（1.5未満）`)
      } else if (pegRatio > 2.0) {
        reasons.push(`PEG比率 ${pegRatio.toFixed(2)}は割高（2.0超）`)
      }
    } else {
      reasons.push('PEG比率のデータなし（成長率データが不足）')
    }

    if (revenueGrowth !== undefined) {
      if (revenueGrowth > 0.2) {
        score++
        reasons.push(`売上成長率 ${(revenueGrowth * 100).toFixed(1)}%は高成長（20%超）`)
      } else if (revenueGrowth > 0.1) {
        reasons.push(`売上成長率 ${(revenueGrowth * 100).toFixed(1)}%は安定成長`)
      }
    }

    if (earningsGrowth !== undefined) {
      if (earningsGrowth > 0.15) {
        score++
        reasons.push(`利益成長率 ${(earningsGrowth * 100).toFixed(1)}%は健全（15%超）`)
      } else if (earningsGrowth < 0) {
        reasons.push(`利益が前年比 ${(earningsGrowth * 100).toFixed(1)}%で減少中`)
      }
    }

    if (debtToEquity !== undefined && debtToEquity < 0.3) {
      score++
      reasons.push('低負債で成長投資余力がある')
    }

    if (score >= 4) return { action: 'buy', strength: 3, reasons }
    if (score >= 2) return { action: 'buy', strength: 2, reasons }

    const isSell =
      pegRatio !== undefined &&
      pegRatio > 2 &&
      earningsGrowth !== undefined &&
      earningsGrowth < 0.05

    if (isSell) {
      return { action: 'sell', strength: 2, reasons: reasons.length ? reasons : ['成長が鈍化し割高と判断'] }
    }

    return { action: 'hold', strength: 1, reasons: reasons.length ? reasons : ['リンチ基準を満たす指標が不足'] }
  },
}

export default lynch
