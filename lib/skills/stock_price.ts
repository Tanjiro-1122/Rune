import { tool } from "ai";
import { z } from "zod";

const stockSkill = {
  name: "get_stock_price",
  tool: tool({
    description:
      "Get real-time stock price and stats for any ticker symbol. " +
      "WIX is $WIX on NASDAQ. Use when Javier asks about stocks or market data.",
    parameters: z.object({
      ticker: z.string().describe("Stock ticker, e.g. WIX, AAPL, TSLA"),
    }),
    execute: async ({ ticker }) => {
      try {
        const symbol = ticker.toUpperCase();
        const res = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`,
          { headers: { "User-Agent": "Mozilla/5.0" } }
        );
        const data = await res.json() as {
          chart?: {
            result?: Array<{
              meta?: {
                regularMarketPrice: number; previousClose: number;
                currency: string; exchangeName: string; longName: string;
                regularMarketVolume: number; marketCap: number;
              };
            }>;
            error?: { description: string };
          };
        };
        const err = data.chart?.error;
        if (err) return { error: err.description ?? "Unknown error" };
        const meta = data.chart?.result?.[0]?.meta;
        if (!meta) return { error: `No data for ${symbol}` };
        const change = meta.regularMarketPrice - meta.previousClose;
        const changePct = (change / meta.previousClose) * 100;
        return {
          ticker: symbol,
          name: meta.longName ?? symbol,
          exchange: meta.exchangeName,
          price: `${meta.currency} ${meta.regularMarketPrice.toFixed(2)}`,
          change: `${change >= 0 ? "+" : ""}${change.toFixed(2)} (${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%)`,
          previous_close: meta.previousClose.toFixed(2),
          market_cap: meta.marketCap ? `$${(meta.marketCap / 1e9).toFixed(2)}B` : "N/A",
          as_of: new Date().toISOString(),
        };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Stock lookup failed" };
      }
    },
  }),
};

export default stockSkill;
