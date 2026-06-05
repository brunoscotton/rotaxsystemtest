import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pricesPath = path.join(__dirname, "..", "data", "prices.json");
const FIRST_MASTER_EMAIL = "bruno.scotton@cdsav.com.br";

let cachedPrices = null;

function supabaseConfig() {
  return {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
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

async function supabaseFetch(pathname, { token, service = false, query = "" } = {}) {
  const config = supabaseConfig();
  const key = service ? config.serviceRoleKey : config.anonKey;
  const response = await fetch(`${config.url}${pathname}${query}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${token || key}`,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Falha ao validar cadastro.");
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export async function userCanAccessPrices(req) {
  if (!authIsConfigured()) return true;

  const token = bearerToken(req);
  if (!token) return false;

  try {
    const user = await supabaseFetch("/auth/v1/user", { token });
    const email = String(user?.email || "").trim().toLowerCase();
    if (email === FIRST_MASTER_EMAIL) return true;

    const profiles = await supabaseFetch("/rest/v1/profiles", {
      token,
      query: `?id=eq.${encodeURIComponent(user.id)}&select=status,role`
    });
    const profile = Array.isArray(profiles) ? profiles[0] : null;
    const role = String(profile?.role || "").toLowerCase();
    const status = String(profile?.status || "").toLowerCase();

    return status === "approved" || role === "master" || role === "seller";
  } catch {
    return false;
  }
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

async function supabasePrices() {
  const config = supabaseConfig();
  if (!config.url || !config.serviceRoleKey) return {};

  const rows = await supabaseFetch("/rest/v1/part_prices", {
    service: true,
    query: "?select=part_number,price_usd"
  }).catch(() => []);

  if (!Array.isArray(rows)) return {};
  return Object.fromEntries(
    rows
      .map((row) => [String(row.part_number || "").toUpperCase(), Number(row.price_usd)])
      .filter(([partNumber, price]) => partNumber && Number.isFinite(price) && price >= 0)
  );
}

export async function pricesPayload() {
  const data = await effectivePricesData();
  return {
    ok: true,
    ...data,
    count: Object.keys(data.prices).length
  };
}

export async function effectivePricesData() {
  const data = await loadPricesData();
  const updatedPrices = await supabasePrices();
  const prices = { ...data.prices, ...updatedPrices };
  return {
    currency: data.currency,
    source: data.source,
    updatedAt: data.updatedAt,
    overrideCount: Object.keys(updatedPrices).length,
    prices
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, message: "Metodo nao permitido." });
    return;
  }

  try {
    if (!(await userCanAccessPrices(req))) {
      res.status(403).json({ ok: false, message: "Cadastro em analise para consultar precos." });
      return;
    }

    res.status(200).json(await pricesPayload());
  } catch (error) {
    res.status(503).json({ ok: false, message: error.message || "Nao foi possivel carregar precos." });
  }
}
