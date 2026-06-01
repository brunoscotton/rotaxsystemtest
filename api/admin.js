const FIRST_MASTER_EMAIL = "bruno.scotton@cdsav.com.br";

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

function bearerToken(headers = {}) {
  const header = headers.authorization || headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

async function supabaseFetch(path, { token, service = false, query = "", method = "GET", body } = {}) {
  const config = supabaseConfig();
  const key = service ? config.serviceRoleKey : config.anonKey;
  const prefer = method === "POST" && query.includes("on_conflict")
    ? "resolution=merge-duplicates,return=representation"
    : (method === "POST" || method === "PATCH" ? "return=representation" : "");
  const response = await fetch(`${config.url}${path}${query}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token || key}`,
      "Content-Type": "application/json",
      Prefer: prefer
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Falha na API administrativa.");
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function currentUser(headers) {
  if (!authIsConfigured()) throw Object.assign(new Error("Supabase nao configurado."), { statusCode: 503 });
  const token = bearerToken(headers);
  if (!token) throw Object.assign(new Error("Login necessario."), { statusCode: 401 });
  const user = await supabaseFetch("/auth/v1/user", { token });
  return { user, token };
}

async function profileForUser(userId) {
  const rows = await supabaseFetch("/rest/v1/profiles", {
    service: true,
    query: `?id=eq.${encodeURIComponent(userId)}&select=*`
  });
  return Array.isArray(rows) ? rows[0] : null;
}

async function ensureFirstMasterProfile(user) {
  if (String(user.email || "").toLowerCase() !== FIRST_MASTER_EMAIL) return null;
  const existing = await profileForUser(user.id);
  const body = {
    id: user.id,
    email: user.email,
    name: existing?.name || "Bruno Scotton",
    first_name: existing?.first_name || "Bruno",
    last_name: existing?.last_name || "Scotton",
    role: "master",
    status: "approved",
    updated_at: new Date().toISOString()
  };
  const rows = await supabaseFetch("/rest/v1/profiles", {
    service: true,
    method: "POST",
    query: "?on_conflict=id",
    body
  });
  return Array.isArray(rows) ? rows[0] : body;
}

async function requireStaff(headers, roles = ["master", "seller"]) {
  if (!serviceIsConfigured()) throw Object.assign(new Error("Painel administrativo nao configurado. Defina SUPABASE_SERVICE_ROLE_KEY."), { statusCode: 503 });
  const { user, token } = await currentUser(headers);
  const firstMaster = await ensureFirstMasterProfile(user);
  const profile = firstMaster || await profileForUser(user.id);
  const role = profile?.role || "usuario";
  const status = profile?.status || "pending";

  if (!roles.includes(role) || (status !== "approved" && role !== "master")) {
    throw Object.assign(new Error("Acesso nao autorizado."), { statusCode: 403 });
  }

  return { user, token, profile, role };
}

async function listUsers() {
  const rows = await supabaseFetch("/rest/v1/profiles", {
    service: true,
    query: "?select=id,name,first_name,last_name,email,phone,estado,address,city,cep,complement,role,status,updated_at&order=updated_at.desc.nullslast"
  });
  return Array.isArray(rows) ? rows : [];
}

async function listQuotes() {
  const rows = await supabaseFetch("/rest/v1/quote_history", {
    service: true,
    query: "?select=id,user_id,control_number,customer,items,status,created_at,accepted_at,accepted_by,finalized_at&order=created_at.desc"
  });
  return Array.isArray(rows) ? rows : [];
}

async function updateUser(body) {
  const role = ["master", "seller", "usuario"].includes(body.role) ? body.role : "usuario";
  const status = ["pending", "approved", "blocked"].includes(body.status) ? body.status : "pending";
  const rows = await supabaseFetch("/rest/v1/profiles", {
    service: true,
    method: "PATCH",
    query: `?id=eq.${encodeURIComponent(body.userId)}&select=id,name,email,role,status`,
    body: { role, status, updated_at: new Date().toISOString() }
  });
  return Array.isArray(rows) ? rows[0] : null;
}

async function updateQuote(body, staff) {
  const status = ["new", "accepted", "finalized"].includes(body.status) ? body.status : "new";
  const patch = { status };
  if (status === "accepted") {
    patch.accepted_by = staff.user.id;
    patch.accepted_at = new Date().toISOString();
  }
  if (status === "finalized") {
    patch.finalized_at = new Date().toISOString();
    if (!body.keepAcceptedBy) patch.accepted_by = staff.user.id;
  }
  const rows = await supabaseFetch("/rest/v1/quote_history", {
    service: true,
    method: "PATCH",
    query: `?id=eq.${encodeURIComponent(body.quoteId)}&select=id,status,accepted_by,accepted_at,finalized_at`,
    body: patch
  });
  return Array.isArray(rows) ? rows[0] : null;
}

export async function handleAdminRequest({ method, headers, url, body }) {
  const requestUrl = new URL(url, "http://local");
  const action = requestUrl.searchParams.get("action") || body?.action || "";

  if (method === "GET" && action === "me") {
    const staff = await requireStaff(headers, ["master", "seller"]);
    return { status: 200, body: { ok: true, role: staff.role, profile: staff.profile } };
  }

  if (method === "GET" && action === "users") {
    await requireStaff(headers, ["master", "seller"]);
    return { status: 200, body: { ok: true, users: await listUsers() } };
  }

  if (method === "GET" && action === "quotes") {
    await requireStaff(headers, ["master", "seller"]);
    return { status: 200, body: { ok: true, quotes: await listQuotes() } };
  }

  if (method === "POST" && action === "user") {
    await requireStaff(headers, ["master"]);
    return { status: 200, body: { ok: true, user: await updateUser(body) } };
  }

  if (method === "POST" && action === "quote") {
    const staff = await requireStaff(headers, ["master", "seller"]);
    return { status: 200, body: { ok: true, quote: await updateQuote(body, staff) } };
  }

  return { status: 404, body: { ok: false, message: "Acao administrativa nao encontrada." } };
}

export default async function handler(req, res) {
  try {
    const result = await handleAdminRequest({
      method: req.method,
      headers: req.headers,
      url: req.url,
      body: typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {}
    });
    res.status(result.status).json(result.body);
  } catch (error) {
    res.status(error.statusCode || 500).json({ ok: false, message: error.message || "Erro administrativo." });
  }
}
