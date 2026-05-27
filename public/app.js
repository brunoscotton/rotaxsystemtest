const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const CART_KEY = "rotaxQuoteCart";

const state = {
  catalog: null,
  cart: loadCart(),
  lastQuote: null,
  search: ""
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

function routeForEngine(engineId) {
  return `#/engine/${engineId}`;
}

const nestedCategories = [
  {
    id: "water-circuits",
    label: "Water Circuits",
    title: "Circuitos de agua",
    thumb: "/assets/rotax-water-pump-thumb.png"
  }
];

function nestedCategoryById(categoryId) {
  return nestedCategories.find((category) => category.id === categoryId);
}

function sectionsInCategory(engineId, categoryId) {
  return state.catalog.sections.filter((section) => section.categoryId === categoryId && section.engineIds.includes(engineId));
}

function itemCountForCategory(engineId, categoryId) {
  return sectionsInCategory(engineId, categoryId)
    .reduce((sum, section) => sum + itemsFor(engineId, section.id).length, 0);
}

function categoriesForEngine(engineId) {
  const templates = [
    { label: "Alternators" },
    { label: "Carburetors" },
    { label: "Crankcase" },
    { label: "Cylinder Head" },
    { label: "Double Ignition Assembly" },
    { label: "Exhaust" },
    { label: "Fuel Pump Assembly-Fuel Hose Assembly-Airbox Assembly" },
    { label: "Governors" },
    { label: "Intake Manifold" },
    { label: "Magnetic pickup Assy" },
    { label: "Oil Systems" },
    { label: "Overload Clutch" },
    { label: "Piston" },
    { label: "Propeller Gear" },
    { label: "Radiator" },
    { label: "Water Circuits", categoryId: "water-circuits" },
    { label: "Starters" },
    { label: "Suspension Frame" },
    { label: "Tools" }
  ];
  const sections = state.catalog.sections.filter((section) => section.engineIds.includes(engineId));

  return templates.map((template) => {
    if (template.categoryId) {
      const category = nestedCategoryById(template.categoryId);
      const categorySections = sectionsInCategory(engineId, template.categoryId);
      const count = itemCountForCategory(engineId, template.categoryId);
      return category && count > 0 ? {
        ...category,
        count,
        sections: categorySections,
        category: true,
        statusText: `${categorySections.length} subcategorias`
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
  });
}

function renderCatalogSidebar(engineId) {
  return `
    <nav class="catalog-sidebar" aria-label="Categorias">
      <button type="button" disabled>ON SPECIAL</button>
      <button type="button" disabled>ALL TOOLS</button>
      <button type="button" disabled>CONSUMABLE</button>
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
          <p class="lead">Clique em um motor para abrir as secoes disponiveis. As proximas secoes podem ser adicionadas no JSON conforme os capitulos forem chegando.</p>
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
          <h1>Dados para envio</h1>
          <p class="lead">Todos os campos precisam ser preenchidos para gerar o arquivo TXT da cotacao.</p>
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
          <h1>Solicitacao enviada</h1>
          <p class="lead">Cotacao enviada para ${escapeHtml(quote.emailTo || "apicotacao@cdsav.com.br")} com o anexo ${escapeHtml(quote.filename)}.</p>
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
      location.hash = route.dataset.route;
      return;
    }

    const add = event.target.closest("[data-add]");
    if (add) {
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

  });

  app.addEventListener("input", (event) => {
    if (event.target.matches("[data-search]")) {
      state.search = event.target.value;
      const query = state.search.trim().toLowerCase();
      document.querySelectorAll("[data-row-filter]").forEach((row) => {
        row.hidden = query ? !row.dataset.rowFilter.includes(query) : false;
      });
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
