import { tool } from "ai";
import { z } from "zod";
import type { SkillDefinition } from "../skills";

const stockSkill: SkillDefinition = {
  name: "get_stock_price",
  description:
    "Get real-time or latest stock price, market cap, and key stats for any ticker symbol. " +
    "Use when Javier asks about stocks, crypto prices, or market data. " +
    "WIX is $WIX on NASDAQ. Default exchange is US.",
  tool: tool({
    description: "Get stock price and stats for a ticker symbol.",
    parameters: z.object({
      ticker: z.string().describe("Stock ticker symbol, e.g. WIX, AAPL, TSLA"),
      exchange: z.string().optional().describe("Exchange, e.g. NASDAQ, NYSE (optional)"),
    }),
    execute: async ({ ticker, exchange }) => {
      try {
        // Use Yahoo Finance API (no key needed)
        const symbol = ticker.toUpperCase();
        const res = await fetch(
          \`https://query1.finance.yahoo.com/v8/finance/chart/\${symbol}?interval=1d&range=1d\`,
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
        if (!meta) return { error: \`No data for \${symbol}\` };
        const change = meta.regularMarketPrice - meta.previousClose;
        const changePct = (change / meta.previousClose) * 100;
        return {
          ticker: symbol,
          name: meta.longName ?? symbol,
          exchange: meta.exchangeName ?? exchange ?? "US",
          price: \`\${meta.currency} \${meta.regularMarketPrice.toFixed(2)}\`,
          change: \`\${change >= 0 ? "+" : ""}\${change.toFixed(2)} (\${changePct >= 0 ? "+" : ""}\${changePct.toFixed(2)}%)\`,
          previous_close: meta.previousClose.toFixed(2),
          volume: meta.regularMarketVolume?.toLocaleString() ?? "N/A",
          market_cap: meta.marketCap ? \`$\${(meta.marketCap / 1e9).toFixed(2)}B\` : "N/A",
          as_of: new Date().toISOString(),
        };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Stock lookup failed" };
      }
    },
  }),
};

export default stockSkill;
