import nodemailer from "nodemailer";

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
  const header = req.headers.authorization || req.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

async function supabaseFetch(path, { token, query = "", method = "GET", body } = {}) {
  const config = supabaseConfig();
  const response = await fetch(`${config.url}${path}${query}`, {
    method,
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Falha ao validar login.");
  }

  return response.json();
}

async function customerFromAuth(req) {
  if (!authIsConfigured()) return null;

  const token = bearerToken(req);
  if (!token) {
    const error = new Error("Faca login para enviar a solicitacao.");
    error.statusCode = 401;
    throw error;
  }

  const user = await supabaseFetch("/auth/v1/user", { token });
  const profiles = await supabaseFetch("/rest/v1/profiles", {
    token,
    query: `?id=eq.${encodeURIComponent(user.id)}&select=name,prefixo,phone,email,estado`
  });
  const profile = Array.isArray(profiles) ? profiles[0] : null;

  if (!profile) {
    const error = new Error("Complete seu cadastro antes de enviar a solicitacao.");
    error.statusCode = 403;
    throw error;
  }

  return {
    name: profile.name || "",
    prefix: profile.prefixo || "",
    phone: profile.phone || "",
    email: profile.email || user.email || "",
    state: profile.estado || ""
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

function buildQuoteText({ customer, items }) {
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
    "",
    "ITENS SOLICITADOS",
    "Qtd | Item | PN | Descricao | Motor | Secao"
  ];

  for (const item of items) {
    lines.push(
      `${item.quantity || 1} | ${item.figure || ""} | ${item.partNumber || ""} | ${item.description || ""} | ${item.engine || ""} | ${item.section || ""}`
    );
  }

  lines.push("", "CODIGOS PARA COPIAR (TSV)");
  for (const item of items) {
    lines.push(`${item.quantity || 1}\t${formatPartNumberForCopy(item.partNumber)}`);
  }

  return `${lines.join("\n")}\n`;
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
    throw new Error("Envio de e-mail nao configurado. Defina SMTP_HOST, SMTP_USER e SMTP_PASS na Vercel.");
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

  return { id: info.messageId, to };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Metodo nao permitido." });
    return;
  }

  let payload;
  try {
    payload = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  } catch {
    res.status(400).json({ ok: false, message: "JSON invalido." });
    return;
  }
  let customer = payload.customer || {};
  const items = Array.isArray(payload.items) ? payload.items : [];

  try {
    const authCustomer = await customerFromAuth(req);
    if (authCustomer) customer = authCustomer;
  } catch (error) {
    res.status(error.statusCode || 401).json({ ok: false, message: error.message || "Login invalido." });
    return;
  }

  const missing = ["name", "prefix", "phone", "email", "state"].filter((field) => !requiredText(customer[field]));

  if (missing.length || !items.length) {
    res.status(400).json({
      ok: false,
      message: "Preencha todos os campos e selecione pelo menos uma peca.",
      missing
    });
    return;
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  const filename = `${stamp}-${sanitizeFilePart(customer.prefix)}-${sanitizeFilePart(customer.name)}.txt`;
  const text = buildQuoteText({ customer, items });
  let email;

  try {
    email = await sendQuoteEmail({ customer, filename, text });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message || "Nao foi possivel enviar o e-mail." });
    return;
  }

  res.status(201).json({ ok: true, filename, text, emailTo: email.to, emailId: email.id });
}
