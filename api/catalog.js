import { readFile } from "node:fs/promises";
import path from "node:path";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, message: "Metodo nao permitido." });
    return;
  }

  const catalogPath = path.join(process.cwd(), "data", "catalog.json");
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  res.status(200).json(catalog);
}
