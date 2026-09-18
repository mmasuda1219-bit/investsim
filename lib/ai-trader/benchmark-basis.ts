/**
 * ベンチマーク（S&P500＝SPY）と比べる起点の印（2026-09-17 スライス7a）。'real-v1' ＝ 運用開始時の SPY の株価
 * （AISession.benchmarkStart）を実データで取れた。付ける場所は engine.ts の startSession で SPY が取れた直後の
 * 1か所だけ。これより前のセッションには無く、起点が実データだったか模擬データ（乱数）だったかを後から区別
 * できない。保存済みの値は書き換えず、値の範囲でも判別しない（画面の注記は印の有無だけで決める）。
 * 純データ・副作用なし（画面側も同じ定義を読めるよう engine.ts から分けて置く。tick-record.ts の ChangeBasis と同じ形）。
 */
export type BenchmarkBasis = 'real-v1'
export const BENCHMARK_BASIS: BenchmarkBasis = 'real-v1'
