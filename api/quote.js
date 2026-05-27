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
    lines.push(`${item.partNumber || ""} - ${item.quantity || 1}x`);
  }

  return `${lines.join("\n")}\n`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Metodo nao permitido." });
    return;
  }

  const payload = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
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

  res.status(201).json({ ok: true, filename, text });
}
