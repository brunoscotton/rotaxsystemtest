const CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_PROVIDER_URLS = [
  "https://economia.awesomeapi.com.br/json/last/USD-BRL",
  "https://open.er-api.com/v6/latest/USD",
  "https://api.frankfurter.app/latest?from=USD&to=BRL"
];

let cachedRate = null;

function providerUrls() {
  const custom = process.env.EXCHANGE_RATE_URL;
  return [...new Set([custom, ...DEFAULT_PROVIDER_URLS].filter(Boolean))];
}

function parseUsdBrlRate(data) {
  const quote = data?.USDBRL || data?.["USD-BRL"] || data;
  const rate = Number(
    quote?.bid ||
    quote?.ask ||
    quote?.high ||
    quote?.rate ||
    data?.rates?.BRL
  );

  if (!Number.isFinite(rate) || rate <= 0) return null;

  return {
    rate,
    providerTimestamp: quote?.timestamp || data?.time_last_update_unix || "",
    providerDate: quote?.create_date || data?.time_last_update_utc || data?.date || ""
  };
}

function providerName(providerUrl) {
  if (providerUrl.includes("awesomeapi.com.br")) return "AwesomeAPI";
  if (providerUrl.includes("open.er-api.com")) return "ExchangeRate-API";
  if (providerUrl.includes("frankfurter.app")) return "Frankfurter";
  return "Custom";
}

export async function getUsdBrlRate({ force = false } = {}) {
  const now = Date.now();
  if (!force && cachedRate && now - cachedRate.fetchedAt < CACHE_TTL_MS) {
    return cachedRate;
  }

  const errors = [];
  for (const providerUrl of providerUrls()) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(providerUrl, {
        headers: { Accept: "application/json" },
        signal: controller.signal
      }).finally(() => clearTimeout(timeout));

      if (!response.ok) {
        errors.push(`${providerName(providerUrl)} HTTP ${response.status}`);
        continue;
      }

      const data = await response.json();
      const parsed = parseUsdBrlRate(data);
      if (!parsed) {
        errors.push(`${providerName(providerUrl)} sem cotacao USD-BRL`);
        continue;
      }

      cachedRate = {
        pair: "USD-BRL",
        rate: parsed.rate,
        provider: providerName(providerUrl),
        source: providerUrl,
        providerTimestamp: parsed.providerTimestamp,
        providerDate: parsed.providerDate,
        fetchedAt: now,
        ttlMs: CACHE_TTL_MS
      };

      return cachedRate;
    } catch (error) {
      errors.push(`${providerName(providerUrl)} ${error.name === "AbortError" ? "timeout" : error.message}`);
    }
  }

  throw new Error(`Nao foi possivel atualizar o dolar. ${errors.join(" | ")}`);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, message: "Metodo nao permitido." });
    return;
  }

  try {
    const force = req.query?.force === "1" || req.url?.includes("force=1");
    const rate = await getUsdBrlRate({ force });
    res.status(200).json({ ok: true, ...rate });
  } catch (error) {
    res.status(503).json({ ok: false, message: error.message || "Nao foi possivel atualizar o dolar." });
  }
}
