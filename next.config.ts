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
 *   - /markets    → /watch    指数概況を MarketOverview として /watch に吸収済み
 *   - /report     → /learn    /learn プロモードと同一の prepare/generate API
 *   - /screener   → /learn    2026-09-01 追加。下記参照
 *
 * /screener を「機能等価の確認前に」載せた理由（2026-09-01・オーナー判断）:
 *   このページは lib/screener.ts が providers/mock を直接読む実装で、フォール
 *   バックですらなく常に架空の株価・PER を返していた（原則9違反）。ナビからは
 *   外れていたが直リンクでは HTTP 200 で開けた。「自由条件のスクリーニング」は
 *   /learn で代替できないままだが、代替できないのは*実在しない機能*なので、
 *   残すほうが機能を水増しして見せることになる。実データ版は別スライスで作る。
 *   削除したもの: app/screener/、app/api/screener/、lib/screener.ts
 *
 * 意図的に載せていないもの（吸収が済むまでリダイレクトしない）:
 *   - /simulate  … 複数銘柄のポートフォリオ運用は /learn に受け皿がない。実データ
 *                  で動いているためナビから外すだけに留める（機能を減らさない）。
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
      { source: '/markets', destination: '/watch', permanent: true },
      { source: '/screener', destination: '/learn', permanent: true },
    ]
  },
};

export default nextConfig;
