import { hasCrossMarketLayers } from "./cross-market-series.js";

// One plain line for the chart in view, separate from source and methodology.
export function cardDetailDescription(card, state = {}) {
  const scale = state.scale || card?.defaults?.scale;
  const range = state.range || card?.defaults?.range;
  const requested = state.layers ?? card?.defaults?.layers ?? [];
  const layers = Array.isArray(requested) ? requested : String(requested).split(",").filter(Boolean);

  switch (card?.id) {
    case "gpu-index":
      if (scale === "spread") return "The gap between two GPU price changes.";
      if (layers.includes("TOKEN")) {
        return layers.every(layer => layer === "TOKEN")
          ? "Token price changes over time."
          : "GPU and token prices, compared from the same day.";
      }
      return scale === "index"
        ? "GPU price changes from the same starting day."
        : "GPU rental prices over time.";
    case "gpu-price-snapshot":
      return "Hourly rental prices by GPU.";
    case "gpu-market-depth":
      return scale === "history"
        ? "Rates for your capacity target over time."
        : "Available capacity at each hourly rate.";
    case "power-basis":
      if (scale === "energy") return "Power cost per H100 hour.";
      return scale === "basis"
        ? "Real-time minus day-ahead power prices."
        : "Day-ahead and real-time power prices.";
    case "equities":
      if (hasCrossMarketLayers(card, layers)) {
        return "Stocks and GPU rental prices, compared from the same day.";
      }
      return scale === "index"
        ? "Stock price changes from the same starting day."
        : "Stock prices over time.";
    case "quote-view":
      return "Buyer bids and seller asks.";
    case "deal-view":
      return "Quote changes and deal activity.";
    case "sandbox-cost":
      return range && range !== "now"
        ? "Job costs over time, by provider."
        : "Job costs across providers.";
    default:
      return "";
  }
}
