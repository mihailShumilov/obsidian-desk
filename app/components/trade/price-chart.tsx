'use client';

/**
 * PriceChart — center column of /trade.
 *
 * Renders a BTC/USD candle chart via TradingView's lightweight-charts.
 * P9 swaps the synthetic data for a Pyth WebSocket feed; for P7 we seed
 * a deterministic random walk centered on $69,850 so the chart looks
 * alive even without the network.
 */

import { useEffect, useRef } from 'react';
import {
  createChart,
  CandlestickSeries,
  ColorType,
  type IChartApi,
  type CandlestickData,
  type Time,
} from 'lightweight-charts';

// Tokens mirrored from tailwind.config.ts so the chart matches the rest
// of the UI without needing to read CSS vars.
const COLORS = {
  bg: '#0B0B14',
  text: '#71717A',
  grid: '#1E1E2C',
  cipher: '#00F5D4',
  cipherDim: '#00B39A',
  ember: '#FF8A00',
  danger: '#FF3E6A',
};

function seedCandles(): CandlestickData<Time>[] {
  // 100 minutes back to now, 1-min candles. Deterministic walk so the
  // chart is identical between SSR and CSR (no hydration mismatch).
  const now = Math.floor(Date.now() / 60_000) * 60;
  const out: CandlestickData<Time>[] = [];
  let price = 69_850;
  for (let i = 99; i >= 0; i--) {
    // Small mean-reverting walk
    const drift = ((i % 7) - 3) * 12;
    const noise = (Math.sin(i * 1.31) + Math.cos(i * 0.71)) * 22;
    const open = price;
    const close = price + drift + noise;
    const high = Math.max(open, close) + Math.abs(Math.cos(i * 0.43)) * 18;
    const low = Math.min(open, close) - Math.abs(Math.sin(i * 0.91)) * 18;
    out.push({
      time: (now - i * 60) as Time,
      open: Math.round(open * 100) / 100,
      high: Math.round(high * 100) / 100,
      low: Math.round(low * 100) / 100,
      close: Math.round(close * 100) / 100,
    });
    price = close;
  }
  return out;
}

export function PriceChart(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: COLORS.bg },
        textColor: COLORS.text,
        fontFamily: 'var(--font-mono), ui-monospace, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: COLORS.grid, style: 1 },
        horzLines: { color: COLORS.grid, style: 1 },
      },
      timeScale: {
        borderColor: COLORS.grid,
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: { borderColor: COLORS.grid },
      crosshair: {
        vertLine: { color: COLORS.cipherDim, style: 3, width: 1 },
        horzLine: { color: COLORS.cipherDim, style: 3, width: 1 },
      },
    });
    chartRef.current = chart;

    const series = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.cipher,
      downColor: COLORS.danger,
      borderUpColor: COLORS.cipher,
      borderDownColor: COLORS.danger,
      wickUpColor: COLORS.cipherDim,
      wickDownColor: COLORS.danger,
    });
    series.setData(seedCandles());
    chart.timeScale().fitContent();

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  return (
    <div className="relative h-[420px] w-full overflow-hidden rounded-md">
      <div ref={containerRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted">
        <span className="size-1.5 rounded-full bg-cipher-cyan-dim" />
        Pyth feed wired in P9
      </div>
    </div>
  );
}
