import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pricesPath = path.join(__dirname, "..", "data", "prices.json");

let cachedPrices = null;

function supabaseConfig() {
  return {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY
  };
}

function authIsConfigured() {
  const config = supabaseConfig();
  return Boolean(config.url && config.anonKey);
}

function bearerToken(req) {
  const header = req.headers?.authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

async function validateAuth(req) {
  if (!authIsConfigured()) return true;

  const token = bearerToken(req);
  if (!token) return false;

  const config = supabaseConfig();
  const response = await fetch(`${config.url}/auth/v1/user`, {
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  });

  return response.ok;
}

export async function loadPricesData() {
  if (cachedPrices) return cachedPrices;
  const data = JSON.parse(await readFile(pricesPath, "utf8"));
  cachedPrices = {
    currency: data.currency || "USD",
    source: data.source || "",
    updatedAt: data.updatedAt || "",
    prices: data.prices || {}
  };
  return cachedPrices;
}

export async function pricesPayload() {
  const data = await loadPricesData();
  return {
    ok: true,
    currency: data.currency,
    source: data.source,
    updatedAt: data.updatedAt,
    count: Object.keys(data.prices).length,
    prices: data.prices
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, message: "Metodo nao permitido." });
    return;
  }

  try {
    if (!(await validateAuth(req))) {
      res.status(401).json({ ok: false, message: "Login necessario para consultar precos." });
      return;
    }

    res.status(200).json(await pricesPayload());
  } catch (error) {
    res.status(503).json({ ok: false, message: error.message || "Nao foi possivel carregar precos." });
  }
}
