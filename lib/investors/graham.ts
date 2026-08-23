import type { InvestorLogic, AnalysisInput, Signal } from '@/types'

const graham: InvestorLogic = {
  id: 'graham',
  name: 'Benjamin Graham',
  nameJa: 'ベンジャミン・グレアム',
  description: '「バリュー投資の父」。安全マージンと割安株への集中投資。',
  philosophy: 'Mr.Marketは感情的。数字が語る本当の価値を買え。',
  avatarColor: '#35D0A5',

  analyze({ fundamentals }: AnalysisInput): Signal {
    if (!fundamentals) {
      return { action: 'hold', strength: 1, reasons: ['財務データを取得中です'] }
    }

    const { pe, pb, debtToEquity } = fundamentals
    const reasons: string[] = []

    // 条件ごとに評価
    const condPE = pe !== undefined && pe > 0 && pe < 15
    const condPB = pb !== undefined && pb < 1.5
    const condDE = debtToEquity !== undefined && debtToEquity < 0.5

    if (condPE) {
      reasons.push(`PER ${pe!.toFixed(1)}倍は割安水準（基準: 15倍未満）`)
    }
    if (condPB) {
      reasons.push(`PBR ${pb!.toFixed(2)}倍は資産価値より割安（基準: 1.5倍未満）`)
    }
    if (condDE) {
      reasons.push(`負債資本比率 ${debtToEquity!.toFixed(2)}は低水準（基準: 0.5未満）`)
    }

    // 強買い: 3条件すべて満たす
    if (condPE && condPB && condDE) {
      return {
        action: 'buy',
        strength: 3,
        reasons: [...reasons, 'ネットネット株に近い超割安水準'],
      }
    }

    // 買い: 2条件満たす
    const condCount = [condPE, condPB, condDE].filter(Boolean).length
    if (condCount >= 2) {
      return { action: 'buy', strength: 2, reasons }
    }

    // 売り: PER > 25 かつ PBR > 3.0
    const isSell =
      pe !== undefined && pe > 25 && pb !== undefined && pb > 3.0
    if (isSell) {
      return {
        action: 'sell',
        strength: 2,
        reasons: [
          `PER ${pe.toFixed(1)}倍・PBR ${pb!.toFixed(2)}倍はグレアム基準を大幅超過、割高`,
        ],
      }
    }

    // ホールド: PBR < 2.5 または PER < 20
    const isHoldPositive =
      (pb !== undefined && pb < 2.5) || (pe !== undefined && pe > 0 && pe < 20)
    if (isHoldPositive && reasons.length > 0) {
      return { action: 'hold', strength: 1, reasons }
    }

    return {
      action: 'hold',
      strength: 1,
      reasons: reasons.length ? reasons : ['グレアム基準を満たす指標が不足'],
    }
  },
}

export default graham
