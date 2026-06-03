import { getUsdBrlRate } from "./exchange-rate.js";
import { loadPricesData } from "./prices.js";

let cachedPriceMap = null;

function normalizePartNumber(partNumber) {
  return String(partNumber || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

async function catalogPrices() {
  if (cachedPriceMap) return cachedPriceMap;

  const data = await loadPricesData();
  const prices = new Map();

  for (const [partNumber, priceUsd] of Object.entries(data.prices || {})) {
    const key = normalizePartNumber(partNumber);
    const price = Number(priceUsd);
    if (key && Number.isFinite(price) && price >= 0) prices.set(key, price);
  }

  cachedPriceMap = prices;
  return cachedPriceMap;
}

export function formatBrl(value) {
  if (!Number.isFinite(Number(value))) return "A consultar";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value));
}

export async function enrichQuoteItemsWithPrices(items, { includePrices = true } = {}) {
  if (!includePrices) {
    return {
      items: items.map((item) => ({ ...item, priceStatus: "hidden" })),
      exchangeRate: null,
      totalBrl: null,
      hasConsult: false
    };
  }

  const [prices, exchangeRate] = await Promise.all([
    catalogPrices(),
    getUsdBrlRate({ force: true })
  ]);
  let totalBrl = 0;
  let hasConsult = false;

  const pricedItems = items.map((item) => {
    const quantity = Number(item.quantity || 1);
    const key = normalizePartNumber(item.partNumber);
    const priceUsd = prices.has(key) ? prices.get(key) : null;
    const unitPriceBrl = priceUsd === null ? null : priceUsd * exchangeRate.rate;
    const subtotalBrl = unitPriceBrl === null ? null : unitPriceBrl * quantity;
    if (subtotalBrl === null) hasConsult = true;
    else totalBrl += subtotalBrl;

    return {
      ...item,
      quantity,
      priceUsd,
      exchangeRate: exchangeRate.rate,
      unitPriceBrl,
      subtotalBrl,
      priceStatus: priceUsd === null ? "consult" : "available"
    };
  });

  return { items: pricedItems, exchangeRate, totalBrl, hasConsult };
}
