// AI自動売買エンジンの監視母集団（ユニバース）。
//
// `engine.ts` から切り出した純データモジュール。engine.ts は child_process を
// import しているためクライアントコンポーネントから読めず、画面側が「AIは何銘柄を
// 監視しているのか」を正直に書けなかった。ここは配列定義だけを置き、副作用のある
// import を一切持ち込まない（クライアント・サーバーの両方から安全に読めること）。
//
// 中身は engine.ts にあった定義をそのまま移したもので、挙動は変えていない。

/** 米国株ユニバース（大型テック・金融・ヘルスケア・エネルギー・生活必需品・ETF等）。 */
export const UNIVERSE_US = [
  'AAPL','NVDA','MSFT','GOOGL','AMZN','META','TSLA',
  'JPM','BAC','V','MA','GS',
  'JNJ','LLY','PFE','MRK',
  'XOM','CVX',
  'KO','PG','WMT','COST','MCD',
  'AMD','INTC','ORCL','CRM','NFLX','ADBE',
  'SPY','QQQ','COIN','PLTR',
]

/** 日本株ユニバース（Yahoo Financeの `.T` サフィックス）。 */
export const UNIVERSE_JP = ['7203.T','6758.T','9984.T','6861.T','8306.T','4063.T','9432.T']

/** 毎tickでクオートを取りに行く監視母集団の全体。 */
export const UNIVERSE = [...UNIVERSE_US, ...UNIVERSE_JP]

/** 画面表示用の内訳。「40銘柄を監視」を実データから書くために使う。 */
export const UNIVERSE_META = {
  total: UNIVERSE.length,
  us:    UNIVERSE_US.length,
  jp:    UNIVERSE_JP.length,
} as const

/** 1tickあたり、値動きの大きさで選ぶ候補数（engine.ts の runTick が渡す値と同じ）。 */
export const TICK_CANDIDATE_COUNT = 4
