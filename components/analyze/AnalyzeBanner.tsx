'use client'

// /analyze S-B2 — ヘッダ（<h1>分析</h1>＋説明文）と恒久免責を横並びにする。
// デスクトップでは左にヘッダ・右に免責の2カラム、モバイルでは縦積み。
//
// 免責の文言は app/learn/page.tsx から移設したもので、内容は一切変更していない
// （消さない・弱めない — builder作業指示・法務由来の禁止事項）。表示ロジックのみで
// 状態は持たない。

export default function AnalyzeBanner() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      <div>
        <h1 className="text-2xl font-bold text-white">分析</h1>
        <p className="text-muted text-sm mt-1">
          クイックモードはニーズ軸プリセットで実データの数字プレビュー（無料・純計算）を確認し、
          同じ条件でAIレポート（現状分析・根拠つき未来予想）を生成します。
          プロモードはテクニカル・ファンダメンタル・決算トレンド条件を自分で組み合わせて検証できます。
        </p>
      </div>

      {/* 恒久ディスクレーマ（免責）— 設定中・プレビュー中・ストリーミング中も常に表示 */}
      <p className="text-xs text-amber-300/90 bg-amber-950/20 border border-amber-800/40 rounded-lg px-3 py-2 leading-relaxed">
        本ページのAIレポートは投資助言ではありません。プロの投資アナリストが実データをもとにどう分析プロセスを
        組み立てるかを、実データに基づき再現したものです。投資判断はご自身の責任で行ってください。
      </p>
    </div>
  )
}
