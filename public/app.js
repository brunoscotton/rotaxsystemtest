const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const CART_KEY = "rotaxQuoteCart";

const state = {
  catalog: null,
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
  const generatedEngines = ["915is", "916is", "582ul"];
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
          <h1>Escolha o motor</h1>
          <p class="lead">Clique em um motor para abrir as secoes disponiveis.</p>
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
  shell(`
    <main class="page">
      <section class="page-header">
        <div>
          <p class="eyebrow">Motor selecionado</p>
          <h1>Categories For ${escapeHtml(engine.name)}</h1>
          <p class="lead">Escolha a secao do manual para abrir a figura e a tabela de PNs.</p>
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

  shell(`
    <main class="page">
      <section class="page-header">
        <div>
          <p class="eyebrow">Motor selecionado</p>
          <h1>${escapeHtml(category.label)} For ${escapeHtml(engine.name)}</h1>
          <p class="lead">Escolha a subcategoria para abrir a figura e a tabela de PNs.</p>
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

  shell(`
    <main class="page">
      <section class="page-header">
        <div>
          <p class="eyebrow">${escapeHtml(engine.name)} / ${escapeHtml(section.chapter)}</p>
          <h1>${escapeHtml(section.label)}</h1>
          <p class="lead">${escapeHtml(section.title)}. Clique no numero da figura ou no ADD da tabela para incluir o PN na lista.</p>
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
              <input name="name" autocomplete="name" required>
            </label>
            <label class="field">
              <span>Prefixo</span>
              <input name="prefix" required>
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
              <span>Estado</span>
              <select name="state" required>
                <option value="">Selecione</option>
                ${brazilStates.map(([abbr, name]) => `<option value="${abbr}">${abbr} - ${escapeHtml(name)}</option>`).join("")}
              </select>
            </label>
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

async function submitQuote(form) {
  const selected = selectedItems();
  if (!selected.length) {
    showToast("Selecione pelo menos uma peca antes de enviar.");
    return;
  }

  const data = new FormData(form);
  const customer = Object.fromEntries(data.entries());
  const items = selected.map(({ item, entry, engine, section }) => ({
    quantity: entry.quantity,
    figure: item.figure,
    partNumber: item.partNumber,
    description: item.description,
    engine: engine.name,
    section: section.label
  }));

  const response = await fetch("/api/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  else if (view === "done") renderDone();
  else renderHome();
}

async function init() {
  const response = await fetch("/api/catalog");
  state.catalog = await response.json();
  bindEvents();
  window.addEventListener("hashchange", render);
  render();
}

init().catch((error) => {
  app.innerHTML = `<main class="page"><div class="empty-state">${escapeHtml(error.message)}</div></main>`;
});
