import { createServer } from "node:http";
import { readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
      const customer = payload.customer || {};
      const items = Array.isArray(payload.items) ? payload.items : [];

      const missing = ["name", "prefix", "phone", "email"].filter((field) => !requiredText(customer[field]));
      if (missing.length || !items.length) {
        sendJson(res, 400, {
          ok: false,
          message: "Preencha todos os campos e selecione pelo menos uma peca.",
          missing
        });
        return;
      }

      const now = new Date();
      const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
      const filename = `${stamp}-${sanitizeFilePart(customer.prefix)}-${sanitizeFilePart(customer.name)}.txt`;
      const text = buildQuoteText({ customer, items });
      let downloadUrl = null;

      try {
        await mkdir(requestsDir, { recursive: true });
        await writeFile(path.join(requestsDir, filename), text, "utf8");
        downloadUrl = `/api/requests/${filename}`;
      } catch {
        // Serverless hosts such as Vercel expose a read-only app directory.
        // The browser still receives the TXT content and downloads it locally.
      }

      sendJson(res, 201, {
        ok: true,
        filename,
        downloadUrl,
        text
      });
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
