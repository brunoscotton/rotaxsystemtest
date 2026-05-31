export default function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, message: "Metodo nao permitido." });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL || "";
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";

  res.status(200).json({
    ok: true,
    supabase: {
      enabled: Boolean(supabaseUrl && supabaseAnonKey),
      url: supabaseUrl,
      anonKey: supabaseAnonKey
    }
  });
}
