import { hasCrossMarketLayers } from "./cross-market-series.js";

// Describe the selected measure; source attribution stays separate.
export function cardDetailDescription(card, state = {}) {
  const scale = state.scale || card?.defaults?.scale;
  const range = state.range || card?.defaults?.range;
  const primary = state[card?.primaryParam || "gpu"] ?? state.gpu;
  const requested = state.layers ?? (primary ? [primary] : card?.defaults?.layers) ?? [];
  const layers = [...new Set((Array.isArray(requested) ? requested : String(requested).split(","))
    .map(layer => String(layer).trim()).filter(Boolean))];
  const selectedLayer = layers.length === 1
    ? card?.layers?.find(layer => layer.id === layers[0])
    : null;

  switch (card?.id) {
    case "gpu-index":
      if (scale === "spread") return "The difference between two GPUs’ rental-rate changes, in percentage points.";
      if (layers.includes("TOKEN")) {
        return layers.every(layer => layer === "TOKEN")
          ? "Changes in the token-price benchmark from the selected starting date."
          : "GPU rental rates and the token-price benchmark, compared from a shared starting date.";
      }
      if (scale === "index") return "Percentage changes in GPU rental rates from a shared starting date.";
      return layers.length > 1
        ? "Rental rates for the selected GPUs, in USD per GPU-hour."
        : "GPU rental rates in USD per GPU-hour, with the median and middle 50% price band.";
    case "gpu-price-snapshot":
      return "The latest available rental rate for each selected GPU, in USD per GPU-hour.";
    case "gpu-market-depth":
      return scale === "history"
        ? "Daily US H100 rental rates in USD per GPU-hour for the selected capacity target. Each InfiniBand node has eight GPUs on 30-day terms."
        : "US H100 capacity for 30-day rentals, in eight-GPU InfiniBand nodes. The target marks the lowest rate covering the requested capacity.";
    case "power-basis": {
      const location = selectedLayer?.label || "the selected location";
      if (scale === "energy") {
        return "Estimated electricity cost per H100-hour, assuming a 10.2 kW eight-GPU system and 20% facility overhead.";
      }
      return scale === "basis"
        ? `Real-time minus day-ahead wholesale electricity prices at ${location}, in USD per MWh.`
        : `Hourly day-ahead and real-time wholesale electricity prices at ${location}, in USD per MWh.`;
    }
    case "equities":
      if (hasCrossMarketLayers(card, layers)) {
        return "Share prices and GPU rental rates compared as percentage changes over shared dates.";
      }
      if (scale === "index") return "Percentage changes in the selected share prices from a shared starting date.";
      return `Daily share-price series for ${selectedLayer?.companyName || "chipmakers and cloud providers"}, in USD per share.`;
    case "quote-view":
      return "Buyer bids and seller asks through a reserved-capacity negotiation, in USD per GPU-hour.";
    case "deal-view":
      return "Reserved-capacity negotiations, including quote revisions, capacity, contract terms and service dates.";
    case "sandbox-cost":
      return range && range !== "now"
        ? "Daily medians of CPU and memory cost estimates across benchmark batches. Each provider uses its own price scale."
        : "Estimated CPU and memory cost per benchmark job, calculated from measured runtime and provider rates.";
    default:
      return "";
  }
}
