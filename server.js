import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import { handleAdminRequest } from "./api/admin.js";
import { getUsdBrlRate } from "./api/exchange-rate.js";
import { pricesPayload, userCanAccessPrices } from "./api/prices.js";
import { enrichQuoteItemsWithPrices, formatBrl } from "./api/quote-pricing.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const dataFile = path.join(__dirname, "data", "catalog.json");
const requestsDir = path.join(__dirname, "requests");
const port = Number(process.env.PORT || 4173);

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"]
]);

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

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

function serviceIsConfigured() {
  const config = supabaseConfig();
  return Boolean(config.url && config.serviceRoleKey);
}

function bearerToken(req) {
  const header = req.headers.authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

async function supabaseFetch(pathname, { token, service = false, query = "", method = "GET", body } = {}) {
  const config = supabaseConfig();
  const key = service ? config.serviceRoleKey : config.anonKey;
  const response = await fetch(`${config.url}${pathname}${query}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token || key}`,
      "Content-Type": "application/json",
      Prefer: method === "POST" ? "return=representation" : ""
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Falha ao validar login.");
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function customerFromAuth(req, requestedPrefix = "") {
  if (!authIsConfigured()) return null;

  const token = bearerToken(req);
  if (!token) return null;

  const user = await supabaseFetch("/auth/v1/user", { token });
  const profiles = await supabaseFetch("/rest/v1/profiles", {
    token,
    query: `?id=eq.${encodeURIComponent(user.id)}&select=name,first_name,last_name,prefixo,phone,email,estado,address,city,cep,complement`
  });
  const profile = Array.isArray(profiles) ? profiles[0] : null;

  if (!profile) {
    const error = new Error("Complete seu cadastro antes de enviar a solicitacao.");
    error.statusCode = 403;
    throw error;
  }

  const prefixes = await supabaseFetch("/rest/v1/user_prefixes", {
    token,
    query: `?user_id=eq.${encodeURIComponent(user.id)}&select=type,value,is_default,created_at&order=is_default.desc,created_at.asc`
  }).catch(() => []);
  const primaryPrefix = Array.isArray(prefixes)
    ? prefixes.find((entry) => entry.value === requestedPrefix) || prefixes.find((entry) => entry.is_default) || prefixes[0]
    : null;
  const name = [profile.first_name || profile.name || "", profile.last_name || ""].filter(Boolean).join(" ").trim();

  return {
    _userId: user.id,
    _token: token,
    name,
    prefix: primaryPrefix?.value || profile.prefixo || "",
    phone: profile.phone || "",
    email: profile.email || user.email || "",
    state: profile.estado || "",
    address: profile.address || "",
    city: profile.city || "",
    cep: profile.cep || "",
    complement: profile.complement || ""
  };
}

function sanitizeFilePart(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "cliente";
}

function requiredText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function formatPartNumberForCopy(partNumber) {
  const digits = String(partNumber || "").replace(/\D/g, "");
  if (digits.length === 6) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
  return String(partNumber || "");
}

function buildQuoteText({ customer, items, pricing }) {
  const createdAt = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const lines = [
    "SOLICITACAO DE COTACAO ROTAX",
    `Criado em: ${createdAt}`,
    "",
    "DADOS DO CLIENTE",
    `Nome: ${customer.name.trim()}`,
    `Prefixo: ${customer.prefix.trim()}`,
    `Telefone: ${customer.phone.trim()}`,
    `E-mail: ${customer.email.trim()}`,
    `Estado: ${customer.state.trim()}`,
    `Endereco: ${customer.address?.trim() || ""}`,
    `Cidade: ${customer.city?.trim() || ""}`,
    `CEP: ${customer.cep?.trim() || ""}`,
    `Complemento: ${customer.complement?.trim() || ""}`,
    "",
    "VALORES",
    `Dolar USD-BRL: ${pricing.exchangeRate ? pricing.exchangeRate.rate.toFixed(4) : "Nao exibido"}`,
    `Total: ${pricing.totalBrl === null ? "Nao exibido" : formatBrl(pricing.totalBrl)}${pricing.hasConsult ? " (ha itens a consultar)" : ""}`,
    "",
    "ITENS SOLICITADOS",
    "Qtd | Item | PN | Descricao | Motor | Secao | Preco unitario | Subtotal"
  ];

  for (const item of items) {
    lines.push(
      `${item.quantity || 1} | ${item.figure || ""} | ${item.partNumber || ""} | ${item.description || ""} | ${item.engine || ""} | ${item.section || ""} | ${formatBrl(item.unitPriceBrl)} | ${formatBrl(item.subtotalBrl)}`
    );
  }

  lines.push("", "CODIGOS PARA COPIAR (TSV)");
  for (const item of items) {
    lines.push(`${item.quantity || 1}\t${formatPartNumberForCopy(item.partNumber)}`);
  }

  return `${lines.join("\n")}\n`;
}

async function saveQuoteHistory({ customer, filename, items }) {
  if (!authIsConfigured()) return;
  const { _token, _userId, ...safeCustomer } = customer;
  const body = {
    user_id: _userId || null,
    control_number: filename,
    customer: safeCustomer,
    items,
    status: "new"
  };

  if (serviceIsConfigured()) {
    await supabaseFetch("/rest/v1/quote_history", {
      service: true,
      method: "POST",
      body
    }).catch(() => null);
    return;
  }

  if (!_userId || !_token) return;
  await supabaseFetch("/rest/v1/quote_history", {
    token: _token,
    method: "POST",
    body
  }).catch(() => null);
}

async function sendQuoteEmail({ customer, filename, text }) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const to = process.env.QUOTE_TO_EMAIL || "apicotacao@cdsav.com.br";
  const from = process.env.SMTP_FROM || user;

  if (!host || !user || !pass) {
    return { id: "email-skipped", to, skipped: true };
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });

  const info = await transporter.sendMail({
    from,
    to,
    replyTo: customer.email.trim(),
    subject: `Cotacao Rotax - ${customer.prefix.trim()} - ${customer.name.trim()}`,
    text,
    attachments: [{ filename, content: text, contentType: "text/plain; charset=utf-8" }]
  });

  return { id: info.messageId, to, skipped: false };
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const decodedPath = decodeURIComponent(url.pathname);
  const requestedPath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^[/\\]+/, "");
  let filePath = path.resolve(publicDir, requestedPath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) filePath = path.join(publicDir, "index.html");
  } catch {
    filePath = path.join(publicDir, "index.html");
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": mimeTypes.get(ext) || "application/octet-stream" });
  const stream = createReadStream(filePath);
  stream.on("error", () => {
    if (!res.headersSent) res.writeHead(404);
    res.end("Not found");
  });
  stream.pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/config") {
      const config = supabaseConfig();
      sendJson(res, 200, {
        ok: true,
        supabase: {
          enabled: authIsConfigured(),
          url: config.url || "",
          anonKey: config.anonKey || ""
        }
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/exchange-rate") {
      try {
        const rate = await getUsdBrlRate({ force: url.searchParams.get("force") === "1" });
        sendJson(res, 200, { ok: true, ...rate });
      } catch (error) {
        sendJson(res, 503, { ok: false, message: error.message || "Nao foi possivel atualizar o dolar." });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/prices") {
      if (!(await userCanAccessPrices(req))) {
        sendJson(res, 403, { ok: false, message: "Cadastro em analise para consultar precos." });
        return;
      }

      try {
        sendJson(res, 200, await pricesPayload());
      } catch (error) {
        sendJson(res, 503, { ok: false, message: error.message || "Nao foi possivel carregar precos." });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/catalog") {
      const data = await readFile(dataFile, "utf8");
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(data);
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/requests/")) {
      const filename = path.basename(url.pathname);
      const filePath = path.join(requestsDir, filename);
      if (!filePath.startsWith(requestsDir) || !filename.endsWith(".txt")) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`
      });
      createReadStream(filePath).pipe(res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/quote") {
      let payload;
      try {
        payload = await readRequestBody(req);
      } catch {
        sendJson(res, 400, { ok: false, message: "JSON invalido." });
        return;
      }
      let customer = payload.customer || {};
      let items = Array.isArray(payload.items) ? payload.items : [];

      try {
        const authCustomer = await customerFromAuth(req, customer.prefix);
        if (authCustomer) customer = authCustomer;
      } catch (error) {
        sendJson(res, error.statusCode || 401, { ok: false, message: error.message || "Login invalido." });
        return;
      }

      const requiredFields = authIsConfigured() ? ["name", "prefix", "phone", "email", "state", "address", "city", "cep"] : ["name", "prefix", "phone", "email", "state"];
      const missing = requiredFields.filter((field) => !requiredText(customer[field]));
      if (missing.length || !items.length) {
        sendJson(res, 400, {
          ok: false,
          message: "Preencha todos os campos e selecione pelo menos uma peca.",
          missing
        });
        return;
      }

      let pricing;
      try {
        const includePrices = Boolean(bearerToken(req)) && await userCanAccessPrices(req);
        pricing = await enrichQuoteItemsWithPrices(items, { includePrices });
        items = pricing.items;
      } catch (error) {
        sendJson(res, 503, { ok: false, message: error.message || "Nao foi possivel atualizar os valores." });
        return;
      }

      const now = new Date();
      const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
      const filename = `${stamp}-${sanitizeFilePart(customer.prefix)}-${sanitizeFilePart(customer.name)}.txt`;
      const text = buildQuoteText({ customer, items, pricing });
      const email = await sendQuoteEmail({ customer, filename, text });
      await saveQuoteHistory({ customer, filename, items });

      sendJson(res, 201, {
        ok: true,
        filename,
        text,
        emailTo: email.to,
        emailId: email.id,
        emailSkipped: Boolean(email.skipped),
        pricing
      });
      return;
    }

    if (url.pathname === "/api/admin") {
      let payload = {};
      if (req.method === "POST") {
        try {
          payload = await readRequestBody(req);
        } catch {
          sendJson(res, 400, { ok: false, message: "JSON invalido." });
          return;
        }
      }
      try {
        const result = await handleAdminRequest({
          method: req.method,
          headers: req.headers,
          url: req.url,
          body: payload
        });
        sendJson(res, result.status, result.body);
      } catch (error) {
        sendJson(res, error.statusCode || 500, { ok: false, message: error.message || "Erro administrativo." });
      }
      return;
    }

    if (req.method === "GET") {
      await serveStatic(req, res);
      return;
    }

    sendJson(res, 405, { ok: false, message: "Metodo nao permitido." });
  } catch (error) {
    sendJson(res, 500, { ok: false, message: error.message || "Erro interno." });
  }
});

server.listen(port, () => {
  console.log(`Rotax quote catalog running at http://localhost:${port}`);
});
