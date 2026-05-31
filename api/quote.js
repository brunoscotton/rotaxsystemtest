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
    `Endereco: ${customer.address?.trim() || ""}`,
    `Cidade: ${customer.city?.trim() || ""}`,
    `CEP: ${customer.cep?.trim() || ""}`,
    `Complemento: ${customer.complement?.trim() || ""}`,
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

async function saveQuoteHistory({ customer, filename, items }) {
  if (!authIsConfigured() || !customer._userId || !customer._token) return;
  const { _token, _userId, ...safeCustomer } = customer;
  await supabaseFetch("/rest/v1/quote_history", {
    token: _token,
    method: "POST",
    body: {
      user_id: _userId,
      control_number: filename,
      customer: safeCustomer,
      items
    }
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
    const authCustomer = await customerFromAuth(req, customer.prefix);
    if (authCustomer) customer = authCustomer;
  } catch (error) {
    res.status(error.statusCode || 401).json({ ok: false, message: error.message || "Login invalido." });
    return;
  }

  const requiredFields = authIsConfigured() ? ["name", "prefix", "phone", "email", "state", "address", "city", "cep"] : ["name", "prefix", "phone", "email", "state"];
  const missing = requiredFields.filter((field) => !requiredText(customer[field]));

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

  await saveQuoteHistory({ customer, filename, items });

  res.status(201).json({ ok: true, filename, text, emailTo: email.to, emailId: email.id, emailSkipped: Boolean(email.skipped) });
}
