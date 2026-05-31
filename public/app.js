const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const CART_KEY = "rotaxQuoteCart";

const state = {
  catalog: null,
  config: { supabase: { enabled: false } },
  supabase: null,
  session: null,
  profile: null,
  prefixes: [],
  addresses: [],
  history: [],
  authMessage: "",
  cart: loadCart(),
  lastQuote: null,
  search: "",
  globalSearch: ""
};

function loadCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveCart() {
  localStorage.setItem(CART_KEY, JSON.stringify(state.cart));
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2200);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function routeParts() {
  const clean = location.hash.replace(/^#\/?/, "");
  return clean ? clean.split("/") : [];
}

function engineById(engineId) {
  return state.catalog.engines.find((engine) => engine.id === engineId);
}

function sectionById(sectionId) {
  return state.catalog.sections.find((section) => section.id === sectionId);
}

function itemById(itemId) {
  return state.catalog.items.find((item) => item.id === itemId);
}

function itemsFor(engineId, sectionId) {
  return state.catalog.items
    .filter((item) => item.sectionId === sectionId && Number(item.qty?.[engineId] || 0) > 0)
    .sort((a, b) => Number(a.figure) - Number(b.figure));
}

function currentEngineId() {
  const [view, engineId] = routeParts();
  return ["engine", "category", "section"].includes(view) && engineById(engineId) ? engineId : "";
}

function authEnabled() {
  return Boolean(state.config?.supabase?.enabled && state.supabase);
}

function authUser() {
  return state.session?.user || null;
}

function fullName(profile = state.profile || {}) {
  const firstName = profile.first_name || profile.name || "";
  const lastName = profile.last_name || "";
  return [firstName, lastName].filter(Boolean).join(" ").trim();
}

function primaryPrefix() {
  return state.prefixes.find((prefix) => prefix.is_default) || state.prefixes[0] || null;
}

function profileToCustomer() {
  const profile = state.profile || {};
  const prefix = primaryPrefix();
  return {
    name: fullName(profile),
    prefix: prefix?.value || profile.prefixo || "",
    phone: profile.phone || "",
    email: profile.email || authUser()?.email || "",
    state: profile.estado || "",
    address: profile.address || "",
    city: profile.city || "",
    cep: profile.cep || "",
    complement: profile.complement || ""
  };
}

function profileIsComplete() {
  const customer = profileToCustomer();
  return ["name", "prefix", "phone", "email", "state", "address", "city", "cep"].every((field) => requiredProfileText(customer[field]));
}

function requiredProfileText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

async function loadProfile() {
  if (!authEnabled() || !authUser()) {
    state.profile = null;
    return null;
  }

  const { data, error } = await state.supabase
    .from("profiles")
    .select("name,first_name,last_name,prefixo,phone,email,estado,address,city,cep,complement")
    .eq("id", authUser().id)
    .maybeSingle();

  if (error) throw error;
  state.profile = data || null;

  const [prefixesResult, addressesResult, historyResult] = await Promise.all([
    state.supabase
      .from("user_prefixes")
      .select("id,type,value,is_default,created_at")
      .eq("user_id", authUser().id)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true }),
    state.supabase
      .from("delivery_addresses")
      .select("id,label,address,city,cep,complement,estado,is_default,created_at")
      .eq("user_id", authUser().id)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true }),
    state.supabase
      .from("quote_history")
      .select("id,control_number,created_at,items")
      .eq("user_id", authUser().id)
      .order("created_at", { ascending: false })
      .limit(30)
  ]);

  if (prefixesResult.error && prefixesResult.error.code !== "42P01") throw prefixesResult.error;
  if (addressesResult.error && addressesResult.error.code !== "42P01") throw addressesResult.error;
  if (historyResult.error && historyResult.error.code !== "42P01") throw historyResult.error;
  state.prefixes = prefixesResult.data || [];
  state.addresses = addressesResult.data || [];
  state.history = historyResult.data || [];
  return state.profile;
}

async function currentAccessToken() {
  if (!authEnabled()) return "";
  const { data, error } = await state.supabase.auth.getSession();
  if (error) throw error;
  state.session = data.session;
  return data.session?.access_token || "";
}

function searchEngines() {
  const engineId = currentEngineId();
  const current = engineId ? engineById(engineId) : null;
  return current ? [current] : state.catalog.engines.filter((engine) => engine.active);
}

function normalizeSearch(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function globalSearchResults(query) {
  const raw = query.trim().toLowerCase();
  const compact = normalizeSearch(query);
  if (compact.length < 2) return [];

  const results = [];
  const engines = searchEngines();
  for (const item of state.catalog.items) {
    const section = sectionById(item.sectionId);
    if (!section) continue;

    const partCompact = normalizeSearch(item.partNumber);
    const haystack = normalizeSearch(`${item.partNumber} ${item.description} ${item.note || ""} ${section.label}`);
    if (!haystack.includes(compact) && !String(item.description || "").toLowerCase().includes(raw)) continue;

    for (const engine of engines) {
      if (!section.engineIds.includes(engine.id) || Number(item.qty?.[engine.id] || 0) <= 0) continue;
      const exact = partCompact === compact ? 0 : 1;
      const starts = partCompact.startsWith(compact) ? 0 : 1;
      results.push({ item, section, engine, score: exact + starts });
    }
  }

  return results
    .sort((a, b) => a.score - b.score || a.item.partNumber.localeCompare(b.item.partNumber) || a.section.label.localeCompare(b.section.label))
    .slice(0, 12);
}

function routeForEngine(engineId) {
  return `#/engine/${engineId}`;
}

function isAccessoriesCatalog(engineId) {
  return engineId === "accessories";
}

const nestedCategories = [
  {
    id: "exhaust",
    label: "Exhaust",
    title: "Sistema de escapamento",
    thumb: "/assets/rotax-exhaust-system-thumb.png"
  },
  {
    id: "oil-systems",
    label: "Oil Systems",
    title: "Sistema de oleo",
    thumb: "/assets/rotax-oil-pump-912-thumb.png"
  },
  {
    id: "fuel-pump-912is",
    label: "Fuel Pump Assembly",
    title: "Bomba de combustivel",
    thumb: "/assets/rotax-912is-fuel-pump-assy-thumb.png"
  },
  {
    id: "fuel-system-legacy",
    label: "Fuel Pump Assembly-Fuel Hose Assembly-Airbox Assembly",
    title: "Sistema de combustivel",
    thumb: "/assets/rotax-fuel-system-1-12-thumb.png"
  },
  {
    id: "instruments-air-filter",
    label: "Instruments, Air filter",
    title: "Instrumentos e filtro de ar",
    thumb: "/assets/rotax-instruments-air-filter-thumb.png"
  },
  {
    id: "ignition-912is",
    label: "Ignition",
    title: "Ignicao",
    thumb: "/assets/rotax-912is-ignition-coils-faston-thumb.png"
  },
  {
    id: "intake-manifold-912is",
    label: "Intake Manifold",
    title: "Coletor de admissao",
    thumb: "/assets/rotax-912is-intake-manifold-standard-thumb.png"
  },
  {
    id: "radiator",
    label: "Radiators",
    title: "Radiadores",
    thumb: "/assets/rotax-oil-radiator-thumb.png"
  },
  {
    id: "starters",
    label: "Starters",
    title: "Partida",
    thumb: "/assets/rotax-starter-complete-sets-thumb.png"
  },
  {
    id: "water-circuits",
    label: "Water Circuits",
    title: "Circuitos de agua",
    thumb: "/assets/rotax-water-pump-thumb.png"
  },
  {
    id: "wiring-harness-912is",
    label: "Wiring Harness",
    title: "Chicote eletrico",
    thumb: "/assets/rotax-912is-wiring-harness-faston-thumb.png"
  }
];

const brazilStates = [
  ["AC", "Acre"],
  ["AL", "Alagoas"],
  ["AP", "Amapa"],
  ["AM", "Amazonas"],
  ["BA", "Bahia"],
  ["CE", "Ceara"],
  ["DF", "Distrito Federal"],
  ["ES", "Espirito Santo"],
  ["GO", "Goias"],
  ["MA", "Maranhao"],
  ["MT", "Mato Grosso"],
  ["MS", "Mato Grosso do Sul"],
  ["MG", "Minas Gerais"],
  ["PA", "Para"],
  ["PB", "Paraiba"],
  ["PR", "Parana"],
  ["PE", "Pernambuco"],
  ["PI", "Piaui"],
  ["RJ", "Rio de Janeiro"],
  ["RN", "Rio Grande do Norte"],
  ["RS", "Rio Grande do Sul"],
  ["RO", "Rondonia"],
  ["RR", "Roraima"],
  ["SC", "Santa Catarina"],
  ["SP", "Sao Paulo"],
  ["SE", "Sergipe"],
  ["TO", "Tocantins"]
];

function nestedCategoryById(categoryId) {
  return nestedCategories.find((category) => category.id === categoryId) || categoryFromCatalog(categoryId);
}

function categoryFromCatalog(categoryId, engineId = "") {
  if (!state.catalog) return null;
  const sections = state.catalog.sections.filter((section) =>
    section.categoryId === categoryId && (!engineId || section.engineIds.includes(engineId))
  );
  if (!sections.length) return null;
  const first = sections[0];
  return {
    id: categoryId,
    label: first.categoryLabel || first.label,
    title: first.categoryTitle || first.title,
    thumb: first.categoryThumb || first.thumb
  };
}

function sectionsInCategory(engineId, categoryId) {
  return state.catalog.sections.filter((section) => section.categoryId === categoryId && section.engineIds.includes(engineId));
}

function itemCountForCategory(engineId, categoryId) {
  return sectionsInCategory(engineId, categoryId)
    .reduce((sum, section) => sum + itemsFor(engineId, section.id).length, 0);
}

function categoriesForEngine(engineId) {
  const generatedEngines = ["915is", "916is", "582ul", "503ul", "accessories"];
  if (generatedEngines.includes(engineId)) {
    return categoriesFromCatalog(engineId);
  }

  const legacyEngines = ["912uls", "912ul", "914ul"];
  const templates = [
    { label: "Alternators" },
    { label: "Carburetors", engineIds: legacyEngines },
    { label: "Crankcase" },
    { label: "Cylinder Head" },
    { label: "Double Ignition Assembly", engineIds: legacyEngines },
    { label: "Engine Control Unit", engineIds: ["912is"] },
    { label: "Exhaust", categoryId: "exhaust" },
    { label: "Flydat, Sensor Set", engineIds: legacyEngines },
    { label: "Fuel Injector", engineIds: ["912is"] },
    { label: "Fuel Pump Assembly-Fuel Hose Assembly-Airbox Assembly", categoryId: "fuel-system-legacy", engineIds: legacyEngines },
    { label: "Fuel Pump Assembly", categoryId: "fuel-pump-912is", engineIds: ["912is"] },
    { label: "Governors" },
    { label: "Ignition", categoryId: "ignition-912is", engineIds: ["912is"] },
    { label: "Ignition Housing", engineIds: ["912is"] },
    { label: "Instruments, Air filter", categoryId: "instruments-air-filter" },
    { label: "Intake Manifold", engineIds: legacyEngines },
    { label: "Intake Manifold", categoryId: "intake-manifold-912is", engineIds: ["912is"] },
    { label: "Magnetic pickup Assy", engineIds: legacyEngines },
    { label: "Oil Systems", categoryId: "oil-systems" },
    { label: "Overload Clutch", engineIds: legacyEngines },
    { label: "Piston" },
    { label: "Propeller Gear" },
    { label: "Radiators", categoryId: "radiator" },
    { label: "Water Circuits", categoryId: "water-circuits" },
    { label: "Starters", categoryId: "starters", engineIds: legacyEngines },
    { label: "Starters", engineIds: ["912is"] },
    { label: "Engine Suspension Frame" },
    { label: "Turbocharger Control Unit", engineIds: ["914ul"] },
    { label: "Vacuum Pump", engineIds: ["912is"] },
    { label: "Wiring Harness", categoryId: "wiring-harness-912is", engineIds: ["912is"] },
    { label: "Tools" }
  ];
  const sections = state.catalog.sections.filter((section) => section.engineIds.includes(engineId));

  return templates.map((template) => {
    if (template.engineIds && !template.engineIds.includes(engineId)) return null;

    if (template.categoryId) {
      const category = nestedCategoryById(template.categoryId);
      const categorySections = sectionsInCategory(engineId, template.categoryId);
      const count = itemCountForCategory(engineId, template.categoryId);
      return category && count > 0 ? {
        ...category,
        count,
        sections: categorySections,
        category: true,
        statusText: categorySections.length === 1 ? "1 subcategoria" : `${categorySections.length} subcategorias`
      } : {
        id: `placeholder-${template.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        label: template.label,
        title: "Secao em preparacao",
        thumb: "/assets/rotax-ignition-thumb.png",
        placeholder: true
      };
    }

    const section = sections.find((entry) => entry.label.toLowerCase() === template.label.toLowerCase());
    return section || {
      id: `placeholder-${template.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      label: template.label,
      title: "Secao em preparacao",
      thumb: "/assets/rotax-ignition-thumb.png",
      placeholder: true
    };
  }).filter(Boolean);
}

function categoriesFromCatalog(engineId) {
  const sections = state.catalog.sections
    .filter((section) => section.engineIds.includes(engineId))
    .sort((a, b) =>
      Number(a.categoryOrder ?? 9999) - Number(b.categoryOrder ?? 9999) ||
      Number(a.sectionOrder ?? 9999) - Number(b.sectionOrder ?? 9999) ||
      a.label.localeCompare(b.label)
    );
  const groups = new Map();

  for (const section of sections) {
    const key = section.categoryId || section.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(section);
  }

  return [...groups.entries()].map(([categoryId, group]) => {
    if (group.length === 1 && !group[0].forceCategory) return group[0];

    const category = categoryFromCatalog(categoryId, engineId);
    const count = itemCountForCategory(engineId, categoryId);
    return {
      ...category,
      count,
      sections: group,
      category: true,
      statusText: group.length === 1 ? "1 subcategoria" : `${group.length} subcategorias`
    };
  });
}

function renderCatalogSidebar(engineId) {
  return `
    <nav class="catalog-sidebar" aria-label="Categorias">
      <button type="button" disabled>ALL TOOLS</button>
      ${state.catalog.engines.map((entry) => `
        <button type="button" class="${entry.id === engineId ? "active" : ""}" ${entry.active ? `data-route="#/engine/${entry.id}"` : "disabled"}>
          ${escapeHtml(entry.name)}
        </button>
      `).join("")}
    </nav>
  `;
}

function selectedCount() {
  return Object.values(state.cart).reduce((sum, entry) => sum + Number(entry.quantity || 0), 0);
}

function selectedItems() {
  return Object.entries(state.cart)
    .map(([itemId, entry]) => {
      const item = itemById(itemId);
      const engine = engineById(entry.engineId);
      const section = item ? sectionById(item.sectionId) : null;
      return item && engine && section ? { item, entry, engine, section } : null;
    })
    .filter(Boolean);
}

function renderGlobalSearchResults() {
  const query = state.globalSearch.trim();
  if (query.length < 2) return "";

  const results = globalSearchResults(query);
  if (!results.length) {
    return `<div class="global-search-empty">Nenhum PN encontrado.</div>`;
  }

  return results.map(({ item, section, engine }) => `
    <div class="global-search-result">
      <button class="global-result-main" type="button" data-route="#/section/${engine.id}/${section.id}">
        <strong>${escapeHtml(item.partNumber)}</strong>
        <span>${escapeHtml(item.description)}</span>
        <small>${escapeHtml(engine.name)} / ${escapeHtml(section.label)} / Item ${escapeHtml(item.figure)} / Qtd ${escapeHtml(item.qty[engine.id])}</small>
      </button>
      <button class="small-button add" type="button" data-add="${item.id}" data-engine="${engine.id}">ADD</button>
    </div>
  `).join("");
}

function updateGlobalSearchDropdown() {
  const panel = document.querySelector("[data-global-results]");
  if (!panel) return;
  panel.innerHTML = renderGlobalSearchResults();
  panel.hidden = state.globalSearch.trim().length < 2;
}

function addItem(itemId, engineId) {
  const item = itemById(itemId);
  if (!item) return;
  const quantity = Number(state.cart[itemId]?.quantity || 0) + 1;
  state.cart[itemId] = { quantity, engineId };
  saveCart();
  showToast(`${item.partNumber} adicionado a lista.`);
  render();
}

function removeItem(itemId) {
  delete state.cart[itemId];
  saveCart();
  render();
}

function changeQty(itemId, delta) {
  const current = Number(state.cart[itemId]?.quantity || 0);
  const next = current + delta;
  if (next <= 0) removeItem(itemId);
  else {
    state.cart[itemId].quantity = next;
    saveCart();
    render();
  }
}

function resolveHotspotItem(sectionId, engineId, figure) {
  return itemsFor(engineId, sectionId).find((item) => item.figure === figure);
}

function shell(content) {
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <a class="brand" href="#/">
          <span class="brand-mark">PN</span>
          <span>
            <span class="brand-title">Rotax Parts Quote</span>
            <span class="brand-subtitle">Selecao rapida para cotacao</span>
          </span>
        </a>
        <div class="global-search">
          <input type="search" placeholder="Buscar PN" value="${escapeHtml(state.globalSearch)}" data-global-search autocomplete="off">
          <div class="global-search-menu" data-global-results ${state.globalSearch.trim().length < 2 ? "hidden" : ""}>
            ${renderGlobalSearchResults()}
          </div>
        </div>
        ${authEnabled() ? `
          <div class="auth-actions">
            ${authUser() ? `
              <button class="secondary-button" type="button" data-route="#/profile/account">${escapeHtml(fullName() || authUser().email || "Perfil")}</button>
              <button class="secondary-button" type="button" data-logout>Sair</button>
            ` : `
              <button class="secondary-button" type="button" data-route="#/login">Entrar</button>
            `}
          </div>
        ` : ""}
        <button class="cart-button" type="button" data-route="#/proceed">Lista (${selectedCount()})</button>
      </header>
      ${content}
    </div>
  `;
}

function renderHome() {
  shell(`
    <main class="page">
      <section class="page-header">
        <div>
          <p class="eyebrow">Catalogo de pecas</p>
          <h1>Escolha o motor ou acessorios</h1>
          <p class="lead">Clique em um motor ou categoria para abrir as secoes disponiveis.</p>
        </div>
      </section>
      <section class="engine-grid">
        ${state.catalog.engines.map((engine) => `
          <button class="engine-card ${engine.active ? "" : "disabled"}" type="button" ${engine.active ? `data-route="${routeForEngine(engine.id)}"` : "disabled"}>
            <span class="card-ribbon">${escapeHtml(engine.name)}</span>
            <img class="card-media" src="${engine.image}" alt="${escapeHtml(engine.name)}">
            <span class="card-body">
              <span class="card-title">${escapeHtml(engine.name)}</span>
              <span class="card-copy">${escapeHtml(engine.subtitle)}</span>
              <span class="status-pill ${engine.active ? "" : "waiting"}">${engine.active ? "Disponivel" : "Em breve"}</span>
            </span>
          </button>
        `).join("")}
      </section>
    </main>
  `);
}

function renderEngine(engineId) {
  const engine = engineById(engineId);
  if (!engine) {
    location.hash = "#/";
    return;
  }
  const sections = state.catalog.sections.filter((section) => section.engineIds.includes(engineId));
  const categories = categoriesForEngine(engineId);
  const accessories = isAccessoriesCatalog(engineId);
  shell(`
    <main class="page">
      <section class="page-header">
        <div>
          <p class="eyebrow">${accessories ? "Categoria selecionada" : "Motor selecionado"}</p>
          <h1>${accessories ? "Categorias de Acessorios" : `Categories For ${escapeHtml(engine.name)}`}</h1>
          <p class="lead">${accessories ? "Escolha a categoria para abrir os produtos disponiveis." : "Escolha a secao do manual para abrir a figura e a tabela de PNs."}</p>
        </div>
        <button class="secondary-button" type="button" data-route="#/">Voltar</button>
      </section>
      <section class="catalog-layout">
        ${renderCatalogSidebar(engineId)}
        <div class="category-grid">
          ${categories.map((section) => {
            const available = !section.placeholder && (section.category ? section.count > 0 : itemsFor(engineId, section.id).length > 0);
            const route = section.category ? `#/category/${engineId}/${section.id}` : `#/section/${engineId}/${section.id}`;
            const status = section.statusText || `${itemsFor(engineId, section.id).length} PNs`;
            return `
              <button class="category-card ${available ? "" : "disabled"}" type="button" ${available ? `data-route="${route}"` : "disabled"}>
                <span class="category-title">${escapeHtml(section.label)}</span>
                <img class="category-media" src="${section.thumb}" alt="${escapeHtml(section.label)}">
                <span class="category-status">${available ? escapeHtml(status) : "Em breve"}</span>
              </button>
            `;
          }).join("")}
        </div>
      </section>
    </main>
  `);
}

function renderCategory(engineId, categoryId) {
  const engine = engineById(engineId);
  const category = nestedCategoryById(categoryId);
  if (!engine || !category) {
    location.hash = "#/";
    return;
  }

  const sections = sectionsInCategory(engineId, categoryId);
  if (!sections.length) {
    location.hash = `#/engine/${engineId}`;
    return;
  }
  const accessories = isAccessoriesCatalog(engineId);

  shell(`
    <main class="page">
      <section class="page-header">
        <div>
          <p class="eyebrow">${accessories ? "Acessorios" : "Motor selecionado"}</p>
          <h1>${accessories ? escapeHtml(category.label) : `${escapeHtml(category.label)} For ${escapeHtml(engine.name)}`}</h1>
          <p class="lead">${accessories ? "Escolha o produto para abrir a tabela de PNs." : "Escolha a subcategoria para abrir a figura e a tabela de PNs."}</p>
        </div>
        <button class="secondary-button" type="button" data-route="#/engine/${engineId}">Voltar</button>
      </section>
      <section class="catalog-layout">
        ${renderCatalogSidebar(engineId)}
        <div class="category-grid">
          ${sections.map((section) => `
            <button class="category-card" type="button" data-route="#/section/${engineId}/${section.id}">
              <span class="category-title">${escapeHtml(section.label)}</span>
              <img class="category-media" src="${section.thumb}" alt="${escapeHtml(section.label)}">
              <span class="category-status">${itemsFor(engineId, section.id).length} PNs</span>
            </button>
          `).join("")}
        </div>
      </section>
    </main>
  `);
}

function renderSelectedStrip() {
  const selected = selectedItems();
  if (!selected.length) {
    return `
      <div class="selected-strip">
        <div class="empty-state">Nenhuma peca selecionada.</div>
      </div>
    `;
  }

  return `
    <div class="selected-strip">
      <div class="selected-list">
        ${selected.map(({ item, entry }) => `
          <div class="selected-item">
            <span>
              <strong>${escapeHtml(item.partNumber)}</strong>
              <span class="selected-meta">Item ${escapeHtml(item.figure)} - ${escapeHtml(item.description)}</span>
            </span>
            <span class="qty-controls">
              <button type="button" data-qty="${item.id}" data-delta="-1">-</button>
              <strong>${entry.quantity}</strong>
              <button type="button" data-qty="${item.id}" data-delta="1">+</button>
            </span>
          </div>
        `).join("")}
      </div>
      <button class="primary-button" type="button" data-route="#/proceed">Prosseguir</button>
    </div>
  `;
}

function renderSection(engineId, sectionId) {
  const engine = engineById(engineId);
  const section = sectionById(sectionId);
  if (!engine || !section) {
    location.hash = "#/";
    return;
  }

  const parts = itemsFor(engineId, sectionId);
  const query = state.search.trim().toLowerCase();
  const filtered = query
    ? parts.filter((item) => `${item.figure} ${item.partNumber} ${item.description} ${item.note || ""}`.toLowerCase().includes(query))
    : parts;
  const hasItemImages = filtered.some((item) => item.image);
  const accessories = isAccessoriesCatalog(engineId);

  shell(`
    <main class="page">
      <section class="page-header">
        <div>
          <p class="eyebrow">${escapeHtml(engine.name)} / ${escapeHtml(section.chapter)}</p>
          <h1>${escapeHtml(section.label)}</h1>
          <p class="lead">${escapeHtml(section.title)}. ${accessories ? "Clique no ADD para incluir o produto na lista." : "Clique no numero da figura ou no ADD da tabela para incluir o PN na lista."}</p>
        </div>
        <button class="secondary-button" type="button" data-route="${section.categoryId ? `#/category/${engineId}/${section.categoryId}` : `#/engine/${engineId}`}">Voltar</button>
      </section>
      <section class="detail-layout">
        <article class="diagram-panel">
          <div class="diagram-toolbar">
            <strong>Figura ${escapeHtml(section.figure)}</strong>
            <span class="selected-meta">${escapeHtml(section.source)}</span>
          </div>
          <div class="diagram-wrap">
            <div class="diagram-stage">
              <img src="${section.image}" alt="${escapeHtml(section.title)}">
              ${section.hotspots.map((spot) => {
                const item = resolveHotspotItem(sectionId, engineId, spot.figure);
                const selected = item && state.cart[item.id];
                return item ? `
                  <button class="hotspot ${selected ? "selected" : ""}" type="button"
                    title="Adicionar PN ${escapeHtml(item.partNumber)}"
                    aria-label="Adicionar PN ${escapeHtml(item.partNumber)}"
                    style="left:${spot.x}%; top:${spot.y}%"
                    data-add="${item.id}"
                    data-engine="${engineId}">
                    ${escapeHtml(spot.figure.replace(/^0/, ""))}
                  </button>
                ` : "";
              }).join("")}
            </div>
          </div>
        </article>
        <aside class="parts-panel">
          <div class="parts-toolbar">
            <strong>Tabela de PNs</strong>
            <input class="search-field" type="search" placeholder="Buscar PN ou descricao" value="${escapeHtml(state.search)}" data-search>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  ${hasItemImages ? "<th>Foto</th>" : ""}
                  <th>Item</th>
                  <th>PN</th>
                  <th>Descricao</th>
                  <th>Qtd ref.</th>
                  <th>ADD</th>
                </tr>
              </thead>
              <tbody>
                ${filtered.map((item) => `
                  <tr data-row-filter="${escapeHtml(`${item.figure} ${item.partNumber} ${item.description} ${item.note || ""}`.toLowerCase())}">
                    ${hasItemImages ? `<td>${item.image ? `<img class="part-thumb" src="${item.image}" alt="${escapeHtml(item.description)}">` : ""}</td>` : ""}
                    <td>${escapeHtml(item.figure)}</td>
                    <td class="part-number">${escapeHtml(item.partNumber)}</td>
                    <td>
                      ${escapeHtml(item.description)}
                      ${item.note ? `<span class="part-note">${escapeHtml(item.note)}</span>` : ""}
                    </td>
                    <td>${escapeHtml(item.qty[engineId])}</td>
                    <td><button class="small-button add" type="button" data-add="${item.id}" data-engine="${engineId}">ADD</button></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
          ${renderSelectedStrip()}
        </aside>
      </section>
    </main>
  `);
}

function renderProceed() {
  const selected = selectedItems();
  const customer = profileToCustomer();

  if (authEnabled() && !authUser()) {
    shell(`
      <main class="page">
        <section class="result-panel">
          <div>
            <p class="eyebrow">Login necessario</p>
            <h1>Entre para enviar sua solicitacao</h1>
            <p class="lead">A cotacao usa os dados do seu cadastro para proteger o envio e evitar informacoes incorretas.</p>
          </div>
          <div class="form-actions">
            <button class="primary-button" type="button" data-route="#/login">Entrar ou cadastrar</button>
            <button class="secondary-button" type="button" data-route="#/">Adicionar mais pecas</button>
          </div>
        </section>
      </main>
    `);
    return;
  }

  if (authEnabled() && !profileIsComplete()) {
    shell(`
      <main class="page">
        <section class="result-panel">
          <div>
            <p class="eyebrow">Cadastro incompleto</p>
            <h1>Complete seu cadastro</h1>
            <p class="lead">Nome, sobrenome, prefixo, telefone, e-mail, estado e endereco sao obrigatorios para enviar a solicitacao.</p>
          </div>
          <div class="form-actions">
            <button class="primary-button" type="button" data-route="#/profile/account">Completar cadastro</button>
            <button class="secondary-button" type="button" data-route="#/">Adicionar mais pecas</button>
          </div>
        </section>
      </main>
    `);
    return;
  }

  shell(`
    <main class="page">
      <section class="page-header">
        <div>
          <p class="eyebrow">Finalizar solicitacao</p>
          <h1>Dados para solicitar sua cotação</h1>
          <p class="lead">Todos os Campos devem ser preenchidos para envio da solicitação.</p>
        </div>
        <button class="secondary-button" type="button" data-route="#/">Adicionar mais pecas</button>
      </section>
      <section class="checkout-layout">
        <form class="form-panel" data-form>
          <h2>Contato</h2>
          <div class="form-grid">
            <label class="field">
              <span>Nome</span>
              <input name="name" autocomplete="name" value="${escapeHtml(customer.name)}" ${authEnabled() ? "readonly" : ""} required>
            </label>
            <label class="field">
              <span>Prefixo</span>
              <input name="prefix" value="${escapeHtml(customer.prefix)}" ${authEnabled() ? "readonly" : ""} required>
            </label>
            <label class="field">
              <span>Telefone</span>
              <input name="phone" autocomplete="tel" value="${escapeHtml(customer.phone)}" ${authEnabled() ? "readonly" : ""} required>
            </label>
            <label class="field">
              <span>E-mail</span>
              <input name="email" type="email" autocomplete="email" value="${escapeHtml(customer.email)}" ${authEnabled() ? "readonly" : ""} required>
            </label>
            <label class="field">
              <span>Estado</span>
              <select name="state" ${authEnabled() ? "disabled" : ""} required>
                <option value="">Selecione</option>
                ${brazilStates.map(([abbr, name]) => `<option value="${abbr}" ${customer.state === abbr ? "selected" : ""}>${abbr} - ${escapeHtml(name)}</option>`).join("")}
              </select>
              ${authEnabled() ? `<input type="hidden" name="state" value="${escapeHtml(customer.state)}">` : ""}
            </label>
            ${authEnabled() ? `
              <label class="field">
                <span>Endereco</span>
                <input value="${escapeHtml(customer.address)}" readonly>
              </label>
              <label class="field">
                <span>Cidade</span>
                <input value="${escapeHtml(customer.city)}" readonly>
              </label>
              <label class="field">
                <span>CEP</span>
                <input value="${escapeHtml(customer.cep)}" readonly>
              </label>
              <label class="field">
                <span>Complemento</span>
                <input value="${escapeHtml(customer.complement)}" readonly>
              </label>
            ` : ""}
          </div>
          <div class="form-actions">
            <button class="secondary-button" type="button" data-route="#/">Cancelar</button>
            <button class="primary-button" type="submit" ${selected.length ? "" : "disabled"}>Enviar</button>
          </div>
        </form>
        <aside class="summary-panel">
          <h2>Itens selecionados</h2>
          <div class="quote-list">
            ${selected.length ? selected.map(({ item, entry, engine, section }) => `
              <div class="quote-item">
                <span>
                  <strong>${escapeHtml(item.partNumber)}</strong>
                  <span class="selected-meta">${entry.quantity}x / Item ${escapeHtml(item.figure)} / ${escapeHtml(engine.name)} / ${escapeHtml(section.label)}</span>
                </span>
                <button class="secondary-button" type="button" data-remove="${item.id}">Remover</button>
              </div>
            `).join("") : `<div class="empty-state">Sua lista ainda esta vazia.</div>`}
          </div>
        </aside>
      </section>
    </main>
  `);
}

function renderDone() {
  const quote = state.lastQuote;
  if (!quote) {
    location.hash = "#/";
    return;
  }

  shell(`
    <main class="page">
      <section class="result-panel">
        <div>
          <p class="eyebrow">E-mail enviado</p>
          <h1>Solicitação enviada!</h1>
          <p class="lead">Em breve, um de nossos consultores irá entrar em contato com sua cotação! Obrigado!</p>
          <p class="control-number">Número de controle: <strong>${escapeHtml(quote.filename)}</strong></p>
        </div>
        <pre class="quote-text">${escapeHtml(quote.text)}</pre>
        <div class="form-actions">
          <button class="primary-button" type="button" data-route="#/">Nova solicitacao</button>
        </div>
      </section>
    </main>
  `);
}

function renderLogin() {
  if (!authEnabled()) {
    location.hash = "#/";
    return;
  }

  shell(`
    <main class="page auth-page">
      <section class="page-header">
        <div>
          <p class="eyebrow">Area do cliente</p>
          <h1>Login e cadastro</h1>
          <p class="lead">Entre para usar os dados do seu cadastro no envio da solicitacao.</p>
        </div>
        <button class="secondary-button" type="button" data-route="#/">Voltar</button>
      </section>
      ${state.authMessage ? `<div class="auth-message">${escapeHtml(state.authMessage)}</div>` : ""}
      <section class="auth-grid">
        <form class="form-panel" data-login-form>
          <h2>Entrar</h2>
          <label class="field">
            <span>E-mail</span>
            <input name="email" type="email" autocomplete="email" required>
          </label>
          <label class="field">
            <span>Senha</span>
            <input name="password" type="password" autocomplete="current-password" required minlength="6">
          </label>
          <div class="form-actions">
            <button class="primary-button" type="submit">Entrar</button>
          </div>
        </form>
        <form class="form-panel" data-register-form>
          <h2>Criar cadastro</h2>
          <div class="form-grid">
            <label class="field">
              <span>Nome</span>
              <input name="first_name" autocomplete="given-name" required>
            </label>
            <label class="field">
              <span>Sobrenome</span>
              <input name="last_name" autocomplete="family-name" required>
            </label>
            <label class="field">
              <span>Tipo</span>
              <select name="prefix_type" required>
                <option value="">Selecione</option>
                <option value="COM">COM</option>
                <option value="PREFIXO">Prefixo</option>
              </select>
            </label>
            <label class="field">
              <span>Prefixo</span>
              <input name="prefixo" required>
            </label>
            <label class="field">
              <span>Telefone</span>
              <input name="phone" autocomplete="tel" required>
            </label>
            <label class="field">
              <span>E-mail</span>
              <input name="email" type="email" autocomplete="email" required>
            </label>
            <label class="field">
              <span>Confirmar e-mail</span>
              <input name="confirm_email" type="email" autocomplete="email" required>
            </label>
            <label class="field">
              <span>Estado</span>
              <select name="estado" required>
                <option value="">Selecione</option>
                ${brazilStates.map(([abbr, name]) => `<option value="${abbr}">${abbr} - ${escapeHtml(name)}</option>`).join("")}
              </select>
            </label>
            <label class="field">
              <span>Endereco</span>
              <input name="address" autocomplete="street-address" required>
            </label>
            <label class="field">
              <span>Cidade</span>
              <input name="city" autocomplete="address-level2" required>
            </label>
            <label class="field">
              <span>CEP</span>
              <input name="cep" autocomplete="postal-code" required>
            </label>
            <label class="field">
              <span>Complemento</span>
              <input name="complement">
            </label>
            <label class="field">
              <span>Senha</span>
              <input name="password" type="password" autocomplete="new-password" required minlength="6">
            </label>
            <label class="field">
              <span>Confirmar senha</span>
              <input name="confirm_password" type="password" autocomplete="new-password" required minlength="6">
            </label>
          </div>
          <div class="form-actions">
            <button class="primary-button" type="submit">Cadastrar</button>
          </div>
        </form>
      </section>
    </main>
  `);
}

function renderProfile(tab = "account") {
  if (!authEnabled()) {
    location.hash = "#/";
    return;
  }

  if (!authUser()) {
    location.hash = "#/login";
    return;
  }

  const profile = state.profile || {};
  const customer = profileToCustomer();
  const activeTab = ["account", "address", "delivery", "prefixes", "history"].includes(tab) ? tab : "account";
  const menuItems = [
    ["account", "Dados pessoais"],
    ["address", "Endereco"],
    ["delivery", "Enderecos de entrega"],
    ["prefixes", "Prefixos"],
    ["history", "Historico"]
  ];

  const accountPanel = `
    <form class="form-panel auth-single" data-profile-form>
      <div class="form-grid">
        <label class="field">
          <span>Nome</span>
          <input name="first_name" value="${escapeHtml(profile.first_name || profile.name || "")}" autocomplete="given-name" required>
        </label>
        <label class="field">
          <span>Sobrenome</span>
          <input name="last_name" value="${escapeHtml(profile.last_name || "")}" autocomplete="family-name" required>
        </label>
        <label class="field">
          <span>Telefone</span>
          <input name="phone" value="${escapeHtml(customer.phone)}" autocomplete="tel" required>
        </label>
        <label class="field">
          <span>E-mail</span>
          <input name="email" type="email" value="${escapeHtml(customer.email)}" autocomplete="email" required>
        </label>
        <label class="field">
          <span>Estado</span>
          <select name="estado" required>
            <option value="">Selecione</option>
            ${brazilStates.map(([abbr, name]) => `<option value="${abbr}" ${customer.state === abbr ? "selected" : ""}>${abbr} - ${escapeHtml(name)}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="form-actions">
        <button class="primary-button" type="submit">Salvar dados</button>
      </div>
    </form>
  `;

  const addressPanel = `
    <form class="form-panel auth-single" data-profile-address-form>
      <div class="form-grid">
        <label class="field">
          <span>Endereco</span>
          <input name="address" value="${escapeHtml(customer.address)}" autocomplete="street-address" required>
        </label>
        <label class="field">
          <span>Cidade</span>
          <input name="city" value="${escapeHtml(customer.city)}" autocomplete="address-level2" required>
        </label>
        <label class="field">
          <span>CEP</span>
          <input name="cep" value="${escapeHtml(customer.cep)}" autocomplete="postal-code" required>
        </label>
        <label class="field">
          <span>Complemento</span>
          <input name="complement" value="${escapeHtml(customer.complement)}">
        </label>
      </div>
      <div class="form-actions">
        <button class="primary-button" type="submit">Salvar endereco</button>
      </div>
    </form>
  `;

  const deliveryPanel = `
    <section class="profile-stack">
      <div class="form-panel">
        <h2>Enderecos cadastrados</h2>
        <div class="quote-list">
          ${state.addresses.length ? state.addresses.map((address) => `
            <div class="quote-item">
              <span>
                <strong>${escapeHtml(address.label || "Entrega")}${address.is_default ? " - Padrao" : ""}</strong>
                <span class="selected-meta">${escapeHtml(address.address)}, ${escapeHtml(address.city)} - ${escapeHtml(address.estado)} / CEP ${escapeHtml(address.cep)}${address.complement ? ` / ${escapeHtml(address.complement)}` : ""}</span>
              </span>
              <button class="secondary-button" type="button" data-address-delete="${address.id}">Remover</button>
            </div>
          `).join("") : `<div class="empty-state">Nenhum endereco de entrega cadastrado.</div>`}
        </div>
      </div>
      <form class="form-panel" data-delivery-address-form>
        <h2>Adicionar endereco de entrega</h2>
        <div class="form-grid">
          <label class="field">
            <span>Identificacao</span>
            <input name="label" placeholder="Ex.: Hangar, Oficina, Residencial" required>
          </label>
          <label class="field">
            <span>Endereco</span>
            <input name="address" required>
          </label>
          <label class="field">
            <span>Cidade</span>
            <input name="city" required>
          </label>
          <label class="field">
            <span>Estado</span>
            <select name="estado" required>
              <option value="">Selecione</option>
              ${brazilStates.map(([abbr, name]) => `<option value="${abbr}">${abbr} - ${escapeHtml(name)}</option>`).join("")}
            </select>
          </label>
          <label class="field">
            <span>CEP</span>
            <input name="cep" required>
          </label>
          <label class="field">
            <span>Complemento</span>
            <input name="complement">
          </label>
          <label class="field check-field">
            <span>Padrao</span>
            <input name="is_default" type="checkbox" value="true">
          </label>
        </div>
        <div class="form-actions">
          <button class="primary-button" type="submit">Adicionar endereco</button>
        </div>
      </form>
    </section>
  `;

  const prefixesPanel = `
    <section class="profile-stack">
      <div class="form-panel">
        <h2>Prefixos cadastrados</h2>
        <div class="quote-list">
          ${state.prefixes.length ? state.prefixes.map((prefix) => `
            <div class="quote-item">
              <span>
                <strong>${escapeHtml(prefix.type)} - ${escapeHtml(prefix.value)}${prefix.is_default ? " - Padrao" : ""}</strong>
              </span>
              <button class="secondary-button" type="button" data-prefix-delete="${prefix.id}">Remover</button>
            </div>
          `).join("") : `<div class="empty-state">Nenhum prefixo cadastrado.</div>`}
        </div>
      </div>
      <form class="form-panel" data-prefix-form>
        <h2>Adicionar prefixo</h2>
        <div class="form-grid">
          <label class="field">
            <span>Tipo</span>
            <select name="type" required>
              <option value="">Selecione</option>
              <option value="COM">COM</option>
              <option value="PREFIXO">Prefixo</option>
            </select>
          </label>
          <label class="field">
            <span>Prefixo</span>
            <input name="value" required>
          </label>
          <label class="field check-field">
            <span>Padrao</span>
            <input name="is_default" type="checkbox" value="true">
          </label>
        </div>
        <div class="form-actions">
          <button class="primary-button" type="submit">Adicionar prefixo</button>
        </div>
      </form>
    </section>
  `;

  const historyPanel = `
    <section class="form-panel auth-single">
      <h2>Historico de solicitacoes</h2>
      <div class="quote-list history-list">
        ${state.history.length ? state.history.map((entry) => `
          <div class="quote-item">
            <span>
              <strong>${escapeHtml(entry.control_number)}</strong>
              <span class="selected-meta">${new Date(entry.created_at).toLocaleString("pt-BR")} / ${Array.isArray(entry.items) ? entry.items.length : 0} itens</span>
            </span>
          </div>
        `).join("") : `<div class="empty-state">Nenhuma solicitacao enviada ainda.</div>`}
      </div>
    </section>
  `;

  const panels = { account: accountPanel, address: addressPanel, delivery: deliveryPanel, prefixes: prefixesPanel, history: historyPanel };
  shell(`
    <main class="page auth-page">
      <section class="page-header">
        <div>
          <p class="eyebrow">Area do cliente</p>
          <h1>Meu cadastro</h1>
          <p class="lead">Esses dados serao usados automaticamente no envio da cotacao.</p>
        </div>
        <button class="secondary-button" type="button" data-route="#/">Voltar</button>
      </section>
      ${state.authMessage ? `<div class="auth-message">${escapeHtml(state.authMessage)}</div>` : ""}
      <section class="profile-layout">
        <nav class="profile-sidebar" aria-label="Menu do usuario">
          ${menuItems.map(([id, label]) => `
            <button type="button" class="${activeTab === id ? "active" : ""}" data-route="#/profile/${id}">${escapeHtml(label)}</button>
          `).join("")}
        </nav>
        <div class="profile-content">
          ${panels[activeTab]}
        </div>
      </section>
    </main>
  `);
}

async function submitQuote(form) {
  const selected = selectedItems();
  if (!selected.length) {
    showToast("Selecione pelo menos uma peca antes de enviar.");
    return;
  }

  const data = new FormData(form);
  const customer = authEnabled() ? profileToCustomer() : Object.fromEntries(data.entries());
  const items = selected.map(({ item, entry, engine, section }) => ({
    quantity: entry.quantity,
    figure: item.figure,
    partNumber: item.partNumber,
    description: item.description,
    engine: engine.name,
    section: section.label
  }));

  const headers = { "Content-Type": "application/json" };
  if (authEnabled()) {
    const token = await currentAccessToken();
    if (!token) {
      showToast("Faca login para enviar a solicitacao.");
      location.hash = "#/login";
      return;
    }
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch("/api/quote", {
    method: "POST",
    headers,
    body: JSON.stringify({ customer, items })
  });
  const result = await response.json();
  if (!response.ok) {
    showToast(result.message || "Nao foi possivel enviar.");
    return;
  }

  state.lastQuote = result;
  state.cart = {};
  saveCart();
  location.hash = "#/done";
}

async function saveProfileFromForm(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const user = authUser();
  if (!user) throw new Error("Faca login para salvar o cadastro.");

  const current = state.profile || {};
  const firstName = String(data.first_name ?? current.first_name ?? current.name ?? "").trim();
  const lastName = String(data.last_name ?? current.last_name ?? "").trim();
  const profile = {
    id: user.id,
    name: [firstName, lastName].filter(Boolean).join(" ").trim(),
    first_name: firstName,
    last_name: lastName,
    prefixo: String(data.prefixo ?? current.prefixo ?? primaryPrefix()?.value ?? "").trim(),
    phone: String(data.phone ?? current.phone ?? "").trim(),
    email: String(data.email ?? current.email ?? user.email ?? "").trim(),
    estado: String(data.estado ?? current.estado ?? "").trim(),
    address: String(data.address ?? current.address ?? "").trim(),
    city: String(data.city ?? current.city ?? "").trim(),
    cep: String(data.cep ?? current.cep ?? "").trim(),
    complement: String(data.complement ?? current.complement ?? "").trim(),
    updated_at: new Date().toISOString()
  };

  const missing = ["name", "phone", "email", "estado"].filter((field) => !requiredProfileText(profile[field]));
  if (missing.length) throw new Error("Preencha todos os campos do cadastro.");

  const { error } = await state.supabase.from("profiles").upsert(profile, { onConflict: "id" });
  if (error) throw error;
  state.profile = profile;
  return profile;
}

async function savePrefixFromForm(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const user = authUser();
  if (!user) throw new Error("Faca login para adicionar prefixo.");

  const prefix = {
    user_id: user.id,
    type: String(data.type || data.prefix_type || "").trim(),
    value: String(data.value || data.prefixo || "").trim().toUpperCase(),
    is_default: data.is_default === "true" || state.prefixes.length === 0
  };

  if (!prefix.type || !prefix.value) throw new Error("Informe tipo e prefixo.");
  if (prefix.is_default) {
    await state.supabase.from("user_prefixes").update({ is_default: false }).eq("user_id", user.id);
  }

  const { error } = await state.supabase.from("user_prefixes").insert(prefix);
  if (error) throw error;
  await loadProfile();
}

async function deletePrefix(prefixId) {
  const { error } = await state.supabase.from("user_prefixes").delete().eq("id", prefixId);
  if (error) throw error;
  await loadProfile();
  renderProfile("prefixes");
}

async function saveDeliveryAddressFromForm(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const user = authUser();
  if (!user) throw new Error("Faca login para adicionar endereco.");

  const address = {
    user_id: user.id,
    label: String(data.label || "").trim(),
    address: String(data.address || "").trim(),
    city: String(data.city || "").trim(),
    cep: String(data.cep || "").trim(),
    complement: String(data.complement || "").trim(),
    estado: String(data.estado || "").trim(),
    is_default: data.is_default === "true" || state.addresses.length === 0
  };

  const missing = ["label", "address", "city", "cep", "estado"].filter((field) => !requiredProfileText(address[field]));
  if (missing.length) throw new Error("Preencha todos os campos obrigatorios do endereco.");
  if (address.is_default) {
    await state.supabase.from("delivery_addresses").update({ is_default: false }).eq("user_id", user.id);
  }

  const { error } = await state.supabase.from("delivery_addresses").insert(address);
  if (error) throw error;
  await loadProfile();
}

async function deleteDeliveryAddress(addressId) {
  const { error } = await state.supabase.from("delivery_addresses").delete().eq("id", addressId);
  if (error) throw error;
  await loadProfile();
  renderProfile("delivery");
}

async function submitLogin(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const { data: result, error } = await state.supabase.auth.signInWithPassword({
    email: String(data.email || "").trim(),
    password: String(data.password || "")
  });
  if (error) throw error;

  state.session = result.session;
  await loadProfile();
  state.authMessage = "";
  location.hash = profileIsComplete() ? "#/proceed" : "#/profile/account";
  render();
}

async function submitRegister(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const email = String(data.email || "").trim();
  const confirmEmail = String(data.confirm_email || "").trim();
  const password = String(data.password || "");
  const confirmPassword = String(data.confirm_password || "");
  if (email.toLowerCase() !== confirmEmail.toLowerCase()) throw new Error("Os e-mails nao conferem.");
  if (password !== confirmPassword) throw new Error("As senhas nao conferem.");

  const { data: result, error } = await state.supabase.auth.signUp({ email, password });
  if (error) throw error;

  state.session = result.session;
  if (!state.session) {
    state.authMessage = "Cadastro criado. Confirme seu e-mail antes de entrar.";
    renderLogin();
    return;
  }

  await saveProfileFromForm(form);
  await savePrefixFromForm(form);
  state.authMessage = "Cadastro criado com sucesso.";
  location.hash = "#/proceed";
  render();
}

async function submitProfile(form) {
  await saveProfileFromForm(form);
  state.authMessage = "Cadastro salvo com sucesso.";
  await loadProfile();
  renderProfile("account");
}

async function submitProfileAddress(form) {
  await saveProfileFromForm(form);
  state.authMessage = "Endereco salvo com sucesso.";
  await loadProfile();
  renderProfile("address");
}

async function submitPrefix(form) {
  await savePrefixFromForm(form);
  state.authMessage = "Prefixo adicionado com sucesso.";
  renderProfile("prefixes");
}

async function submitDeliveryAddress(form) {
  await saveDeliveryAddressFromForm(form);
  state.authMessage = "Endereco de entrega adicionado com sucesso.";
  renderProfile("delivery");
}

async function logout() {
  if (authEnabled()) await state.supabase.auth.signOut();
  state.session = null;
  state.profile = null;
  state.prefixes = [];
  state.addresses = [];
  state.history = [];
  state.authMessage = "";
  location.hash = "#/";
  render();
}

function bindEvents() {
  app.addEventListener("click", (event) => {
    const route = event.target.closest("[data-route]");
    if (route) {
      state.globalSearch = "";
      const search = document.querySelector("[data-global-search]");
      if (search) search.value = "";
      updateGlobalSearchDropdown();
      location.hash = route.dataset.route;
      return;
    }

    const add = event.target.closest("[data-add]");
    if (add) {
      state.globalSearch = "";
      addItem(add.dataset.add, add.dataset.engine);
      return;
    }

    const qty = event.target.closest("[data-qty]");
    if (qty) {
      changeQty(qty.dataset.qty, Number(qty.dataset.delta));
      return;
    }

    const remove = event.target.closest("[data-remove]");
    if (remove) {
      removeItem(remove.dataset.remove);
      return;
    }

    const prefixDelete = event.target.closest("[data-prefix-delete]");
    if (prefixDelete) {
      deletePrefix(prefixDelete.dataset.prefixDelete).catch((error) => showToast(error.message));
      return;
    }

    const addressDelete = event.target.closest("[data-address-delete]");
    if (addressDelete) {
      deleteDeliveryAddress(addressDelete.dataset.addressDelete).catch((error) => showToast(error.message));
      return;
    }

    const logoutButton = event.target.closest("[data-logout]");
    if (logoutButton) {
      logout().catch((error) => showToast(error.message));
      return;
    }

    if (!event.target.closest(".global-search")) {
      const panel = document.querySelector("[data-global-results]");
      if (panel) panel.hidden = true;
    }
  });

  app.addEventListener("input", (event) => {
    if (event.target.matches("[data-global-search]")) {
      state.globalSearch = event.target.value;
      updateGlobalSearchDropdown();
      return;
    }

    if (event.target.matches("[data-search]")) {
      state.search = event.target.value;
      const query = state.search.trim().toLowerCase();
      document.querySelectorAll("[data-row-filter]").forEach((row) => {
        row.hidden = query ? !row.dataset.rowFilter.includes(query) : false;
      });
    }
  });

  app.addEventListener("focusin", (event) => {
    if (event.target.matches("[data-global-search]")) {
      updateGlobalSearchDropdown();
    }
  });

  app.addEventListener("keydown", (event) => {
    if (event.target.matches("[data-global-search]") && event.key === "Escape") {
      state.globalSearch = "";
      event.target.value = "";
      updateGlobalSearchDropdown();
    }
  });

  app.addEventListener("submit", (event) => {
    if (event.target.matches("[data-form]")) {
      event.preventDefault();
      submitQuote(event.target).catch((error) => showToast(error.message));
      return;
    }

    if (event.target.matches("[data-login-form]")) {
      event.preventDefault();
      submitLogin(event.target).catch((error) => showToast(error.message));
      return;
    }

    if (event.target.matches("[data-register-form]")) {
      event.preventDefault();
      submitRegister(event.target).catch((error) => showToast(error.message));
      return;
    }

    if (event.target.matches("[data-profile-form]")) {
      event.preventDefault();
      submitProfile(event.target).catch((error) => showToast(error.message));
      return;
    }

    if (event.target.matches("[data-profile-address-form]")) {
      event.preventDefault();
      submitProfileAddress(event.target).catch((error) => showToast(error.message));
      return;
    }

    if (event.target.matches("[data-prefix-form]")) {
      event.preventDefault();
      submitPrefix(event.target).catch((error) => showToast(error.message));
      return;
    }

    if (event.target.matches("[data-delivery-address-form]")) {
      event.preventDefault();
      submitDeliveryAddress(event.target).catch((error) => showToast(error.message));
    }
  });
}

function render() {
  const [view, engineId, sectionId] = routeParts();
  if (view !== "section") state.search = "";

  if (!view) renderHome();
  else if (view === "engine") renderEngine(engineId);
  else if (view === "category") renderCategory(engineId, sectionId);
  else if (view === "section") renderSection(engineId, sectionId);
  else if (view === "proceed") renderProceed();
  else if (view === "login") renderLogin();
  else if (view === "profile") renderProfile(engineId);
  else if (view === "done") renderDone();
  else renderHome();
}

async function init() {
  const [configResponse, catalogResponse] = await Promise.all([
    fetch("/api/config").catch(() => null),
    fetch("/api/catalog")
  ]);
  if (configResponse?.ok) state.config = await configResponse.json();
  state.catalog = await catalogResponse.json();

  if (state.config?.supabase?.enabled) {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    state.supabase = createClient(state.config.supabase.url, state.config.supabase.anonKey);
    const { data, error } = await state.supabase.auth.getSession();
    if (error) throw error;
    state.session = data.session;
    if (state.session) await loadProfile();
    state.supabase.auth.onAuthStateChange(async (_event, session) => {
      state.session = session;
      if (session) await loadProfile();
      else {
        state.profile = null;
        state.prefixes = [];
        state.addresses = [];
        state.history = [];
      }
      render();
    });
  }

  bindEvents();
  window.addEventListener("hashchange", render);
  render();
}

init().catch((error) => {
  app.innerHTML = `<main class="page"><div class="empty-state">${escapeHtml(error.message)}</div></main>`;
});
