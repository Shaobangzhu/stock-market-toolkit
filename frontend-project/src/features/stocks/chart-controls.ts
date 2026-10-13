export interface ChartControls { type: 'candlestick' | 'line'; sma50: boolean; sma200: boolean; ema20: boolean; bollinger: boolean; rsi: boolean; macd: boolean; volume: boolean }
export const DEFAULT_CHART_CONTROLS: ChartControls = { type: 'candlestick', sma50: false, sma200: false, ema20: false, bollinger: false, rsi: false, macd: false, volume: true };
