import type { NextConfig } from "next";

/**
 * 旧URLの恒久リダイレクト。
 *
 * 2026-08-23 の情報設計再編で、サイトを学習の4段階（見る→まねる→やる→振り返る）
 * に整理した。旧パスは削除せず 308 で新パスへ送る。
 *
 * ここに載せるのは「改名しただけ」か「機能等価が確認済み」のものだけ。
 *   - /ai-session → /watch    （改名）
 *   - /analyze    → /learn    （改名）
 *   - /portfolio  → /review   （改名）
 *   - /lab        → /learn    /learn が上位互換（同じ /api/lab/backtest を内部で呼ぶ）
 *   - /report     → /learn    /learn プロモードと同一の prepare/generate API
 *
 * 意図的に載せていないもの（吸収が済むまでリダイレクトしない）:
 *   - /screener  … /api/analyze/screen が quick/investor のみ対応で、自由条件の
 *                  スクリーニングを /learn で代替できない。API拡張の完了後に追加する
 *   - /simulate  … 複数銘柄のポートフォリオ運用は /learn に受け皿がない
 *   - /markets   … 指数概況・バフェット指標の表示先が /watch にまだ無い
 * 上記3本はナビから外したが、リンクからは到達できる状態を保つ（機能を減らさない）。
 *
 * API（/api/*）のパスは対外契約なので変更しない。
 */
const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: '/ai-session', destination: '/watch', permanent: true },
      { source: '/ai-session/:path*', destination: '/watch/:path*', permanent: true },
      { source: '/analyze', destination: '/learn', permanent: true },
      { source: '/portfolio', destination: '/review', permanent: true },
      { source: '/lab', destination: '/learn', permanent: true },
      { source: '/report', destination: '/learn', permanent: true },
    ]
  },
};

export default nextConfig;
