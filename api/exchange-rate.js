const CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_PROVIDER_URL = "https://economia.awesomeapi.com.br/json/last/USD-BRL";

let cachedRate = null;

export async function getUsdBrlRate({ force = false } = {}) {
  const now = Date.now();
  if (!force && cachedRate && now - cachedRate.fetchedAt < CACHE_TTL_MS) {
    return cachedRate;
  }

  const providerUrl = process.env.EXCHANGE_RATE_URL || DEFAULT_PROVIDER_URL;
  const response = await fetch(providerUrl, {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error("Nao foi possivel atualizar o dolar.");
  }

  const data = await response.json();
  const quote = data?.USDBRL || data?.["USD-BRL"] || data;
  const rate = Number(quote?.bid || quote?.ask || quote?.high || quote?.rate);

  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("Cotacao do dolar invalida.");
  }

  cachedRate = {
    pair: "USD-BRL",
    rate,
    provider: "AwesomeAPI",
    source: providerUrl,
    providerTimestamp: quote?.timestamp || "",
    providerDate: quote?.create_date || "",
    fetchedAt: now,
    ttlMs: CACHE_TTL_MS
  };

  return cachedRate;
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
