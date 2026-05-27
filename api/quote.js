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
    "",
    "ITENS SOLICITADOS",
    "Qtd | Item | PN | Descricao | Motor | Secao"
  ];

  for (const item of items) {
    lines.push(
      `${item.quantity || 1} | ${item.figure || ""} | ${item.partNumber || ""} | ${item.description || ""} | ${item.engine || ""} | ${item.section || ""}`
    );
  }

  lines.push("", "CODIGOS PARA COPIAR");
  for (const item of items) {
    lines.push(`${item.quantity || 1} ${formatPartNumberForCopy(item.partNumber)}`);
  }

  return `${lines.join("\n")}\n`;
}

async function sendQuoteEmail({ customer, filename, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.QUOTE_TO_EMAIL || "apicotacao@cdsav.com.br";
  const from = process.env.QUOTE_FROM_EMAIL || "Rotax System <apicotacao@cdsav.com.br>";

  if (!apiKey) {
    throw new Error("Envio de e-mail nao configurado. Defina RESEND_API_KEY na Vercel.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `Cotacao Rotax - ${customer.prefix.trim()} - ${customer.name.trim()}`,
      text,
      attachments: [
        {
          filename,
          content: Buffer.from(text, "utf8").toString("base64")
        }
      ]
    })
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.message || "Nao foi possivel enviar o e-mail.");
  }

  return { id: result.id, to };
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
  const customer = payload.customer || {};
  const items = Array.isArray(payload.items) ? payload.items : [];
  const missing = ["name", "prefix", "phone", "email"].filter((field) => !requiredText(customer[field]));

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
