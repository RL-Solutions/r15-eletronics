/* =====================================================================
   Loja — app (vitrine, estoque ao vivo via Supabase, carrinho → WhatsApp)
   ===================================================================== */
(() => {
  "use strict";

  const CFG = window.STORE_CONFIG || {};
  const SUPABASE_SDK = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js";
  const CART_KEY = "loja.cart.v1";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const state = {
    products: [],
    category: "Todos",
    query: "",
    cart: loadCart(),
    live: false,
  };

  // ---------------------------------------------------------------- utils
  const brl = (n) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const finalPrice = (p) => (p.sale_price != null && Number(p.sale_price) < Number(p.price) ? Number(p.sale_price) : Number(p.price));
  const pixPrice = (v) => v * (1 - (CFG.pixDiscount || 0));
  const offPct = (p) => (finalPrice(p) < Number(p.price) ? Math.round((1 - finalPrice(p) / Number(p.price)) * 100) : 0);
  const byId = (id) => state.products.find((p) => String(p.id) === String(id));
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  function loadCart() {
    try { return JSON.parse(localStorage.getItem(CART_KEY)) || {}; } catch { return {}; }
  }
  function saveCart() {
    try { localStorage.setItem(CART_KEY, JSON.stringify(state.cart)); } catch { /* modo privado */ }
  }

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("is-on"), 2600);
  }

  // Ícones por categoria (usados quando o produto não tem foto)
  const ICONS = {
    "Áudio": '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="5" height="7" rx="2"/><rect x="16" y="14" width="5" height="7" rx="2"/>',
    "Carregadores": '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="m13 7-3 5h4l-3 5"/>',
    "Wearables": '<rect x="6" y="6" width="12" height="12" rx="3"/><path d="M9 6V2h6v4M9 18v4h6v-4M12 9v3l2 1"/>',
    "Cabos": '<path d="M8 3v5M16 3v5"/><rect x="6" y="8" width="12" height="5" rx="1"/><path d="M12 13v3a5 5 0 0 1-5 5"/>',
    "Gamer": '<path d="M6 9h12a4 4 0 0 1 4 4v1a3 3 0 0 1-5.4 1.8L15 14H9l-1.6 1.8A3 3 0 0 1 2 14v-1a4 4 0 0 1 4-4z"/><path d="M7 11.5v3M5.5 13h3"/><circle cx="16" cy="12" r=".6"/><circle cx="18" cy="14" r=".6"/>',
    "Acessórios": '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4"/>',
  };
  const icon = (cat) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[cat] || ICONS["Acessórios"]}</svg>`;
  const media = (p) => (p.image_url
    ? `<img src="${esc(p.image_url)}" alt="" loading="lazy" decoding="async">`
    : icon(p.category));

  // ---------------------------------------------------------------- estoque
  function stockInfo(p) {
    const s = Number(p.stock) || 0;
    if (s <= 0) return { cls: "card__stock card__stock--out", text: "Esgotado" };
    if (s <= (CFG.lowStockThreshold ?? 3)) return { cls: "card__stock card__stock--low", text: s === 1 ? "Resta 1 unidade" : `Restam ${s} unidades` };
    return { cls: "card__stock", text: `${s} em estoque` };
  }

  // ---------------------------------------------------------------- render
  function cardHTML(p, variant) {
    const s = Number(p.stock) || 0;
    const out = s <= 0;
    const fp = finalPrice(p);
    const off = offPct(p);
    const st = stockInfo(p);
    const inCart = state.cart[p.id] || 0;
    const canAdd = !out && inCart < s;
    const tags = [
      off ? `<span class="tag tag--off">-${off}% off</span>` : "",
      out ? '<span class="tag tag--out">Esgotado</span>' : (p.ships_today ? '<span class="tag tag--ship">Envio hoje</span>' : ""),
    ].join("");
    const flash = variant === "flash";
    const bar = flash && !out
      ? `<div class="stockbar" aria-hidden="true"><span style="width:${Math.max(8, Math.min(100, s * 10))}%"></span></div>`
      : "";
    const save = flash && off ? `<span class="save">Economize ${brl(Number(p.price) - fp)}</span>` : "";

    return `
      <article class="card${flash ? " card--flash" : ""}${out ? " is-out" : ""}" role="listitem" data-id="${esc(p.id)}" aria-label="${esc(p.name)}">
        <div class="card__media">${media(p)}<div class="card__tags">${tags}</div></div>
        <div class="card__body">
          ${p.brand ? `<span class="card__brand">${esc(p.brand)}</span>` : ""}
          <h3 class="card__name">${esc(p.name)}</h3>
          ${p.variant ? `<span class="card__variant">${esc(p.variant)}</span>` : ""}
          <div class="card__prices">
            ${off ? `<div class="price-old"><span class="visually-hidden">De </span>${brl(p.price)}</div>` : ""}
            <div class="price">${off ? '<span class="visually-hidden">Por </span>' : ""}${brl(fp)}</div>
            <div class="price-pix"><b>${brl(pixPrice(fp))}</b> no Pix</div>
            ${save}
          </div>
          <span class="${st.cls}">${st.text}</span>
          ${bar}
          <button class="btn btn--primary card__btn" type="button" data-add="${esc(p.id)}" ${canAdd ? "" : "disabled"}
            aria-label="${out ? "Esgotado" : inCart >= s ? "Limite do estoque no carrinho" : "Adicionar ao carrinho"}: ${esc(p.name)}">
            ${out ? "Esgotado" : inCart >= s ? "Limite atingido" : "Adicionar"}
          </button>
        </div>
      </article>`;
  }

  function filtered() {
    const q = norm(state.query);
    return state.products.filter((p) =>
      (state.category === "Todos" || p.category === state.category) &&
      (!q || norm(`${p.name} ${p.variant} ${p.brand} ${p.category}`).includes(q)));
  }

  function sortForSale(list) {
    // disponíveis primeiro, esgotados no fim
    return [...list].sort((a, b) => (b.stock > 0) - (a.stock > 0) || (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }

  function render(changedIds = []) {
    const focus = captureFocus();
    paint(changedIds);
    restoreFocus(focus);
  }

  // Mantém o foco do teclado/leitor de tela no mesmo botão após re-renderizar
  function captureFocus() {
    const a = document.activeElement;
    if (!a || !a.dataset) return null;
    const key = ["add", "cat", "inc", "dec"].find((k) => a.dataset[k] != null);
    if (!key) return null;
    const list = a.closest("[data-list]");
    return { list: list && list.dataset.list, key, val: a.dataset[key] };
  }
  function restoreFocus(f) {
    if (!f) return;
    const scope = f.list ? $(`[data-list="${f.list}"]`) : document;
    const el = scope && scope.querySelector(`[data-${f.key}="${CSS.escape(f.val)}"]`);
    if (el && !el.disabled) el.focus({ preventScroll: true });
  }

  function paint(changedIds) {
    const P = state.products;
    const lists = {
      featured: sortForSale(P.filter((p) => p.featured)),
      clearance: P.filter((p) => p.clearance && p.stock > 0),
      ships: P.filter((p) => p.ships_today && p.stock > 0),
      all: sortForSale(filtered()),
    };

    for (const [key, items] of Object.entries(lists)) {
      const el = $(`[data-list="${key}"]`);
      el.innerHTML = items.map((p) => cardHTML(p, key === "clearance" ? "flash" : "")).join("");
      const section = el.closest("section");
      if (key !== "all") section.hidden = items.length === 0;
    }

    $("#empty").hidden = lists.all.length > 0;
    $("#results-count").textContent = `${lists.all.length} produto${lists.all.length === 1 ? "" : "s"} encontrado${lists.all.length === 1 ? "" : "s"}`;

    for (const id of changedIds) $$(`.card[data-id="${CSS.escape(String(id))}"]`).forEach((c) => c.classList.add("is-updated"));
    renderChips();
    renderCart();
  }

  function renderChips() {
    const cats = ["Todos", ...new Set(state.products.map((p) => p.category).filter(Boolean))];
    if (!cats.includes(state.category)) state.category = "Todos";
    $("#chips").innerHTML = cats.map((c) =>
      `<button class="chip" type="button" data-cat="${esc(c)}" aria-pressed="${c === state.category}">${esc(c)}</button>`).join("");
  }

  // ---------------------------------------------------------------- carrinho
  function cartCount() { return Object.values(state.cart).reduce((a, b) => a + b, 0); }

  function clampCart() {
    // Garante que o carrinho nunca passe do estoque atual
    const changed = [];
    for (const [id, qty] of Object.entries(state.cart)) {
      const p = byId(id);
      if (!p) { if (state.products.length) delete state.cart[id]; continue; }
      const max = Math.max(0, Number(p.stock) || 0);
      if (qty > max) {
        if (max === 0) delete state.cart[id]; else state.cart[id] = max;
        changed.push(p);
      }
    }
    if (changed.length) saveCart();
    return changed;
  }

  function renderCart() {
    const n = cartCount();
    $$(".js-cart-count").forEach((b) => { b.textContent = n; b.hidden = n === 0; });
    $$('[data-action="cart"]').forEach((b) => b.setAttribute("aria-label", `${b.classList.contains("bottom-nav__cart") ? "Carrinho" : "Abrir carrinho"}, ${n} ${n === 1 ? "item" : "itens"}`));

    const entries = Object.entries(state.cart).map(([id, qty]) => ({ p: byId(id), qty })).filter((e) => e.p);
    $("#cart-empty").hidden = entries.length > 0;
    $("#cart-foot").hidden = entries.length === 0;

    let subtotal = 0;
    $("#cart-list").innerHTML = entries.map(({ p, qty }) => {
      const fp = finalPrice(p);
      subtotal += fp * qty;
      const max = Number(p.stock) || 0;
      return `
        <li class="cart-item">
          <div class="cart-item__img">${media(p)}</div>
          <div>
            <p class="cart-item__name">${esc(p.name)}</p>
            ${p.variant ? `<p class="cart-item__meta">${esc(p.variant)}</p>` : ""}
            <p class="cart-item__meta">${brl(fp)} cada</p>
            ${qty >= max ? `<p class="cart-item__warn">Máximo disponível: ${max}</p>` : ""}
            <div class="cart-item__row">
              <div class="stepper" role="group" aria-label="Quantidade de ${esc(p.name)}">
                <button type="button" data-dec="${esc(p.id)}" aria-label="Diminuir quantidade">−</button>
                <output aria-live="polite">${qty}</output>
                <button type="button" data-inc="${esc(p.id)}" aria-label="Aumentar quantidade" ${qty >= max ? "disabled" : ""}>+</button>
              </div>
              <button class="link-btn" type="button" data-remove="${esc(p.id)}" aria-label="Remover ${esc(p.name)}">Remover</button>
            </div>
          </div>
        </li>`;
    }).join("");

    $("#cart-subtotal").textContent = brl(subtotal);
    $("#cart-pix").textContent = brl(pixPrice(subtotal));
  }

  function addToCart(id) {
    const p = byId(id);
    if (!p) return;
    const cur = state.cart[id] || 0;
    if (cur >= p.stock) { toast("Você já tem todo o estoque disponível no carrinho."); return; }
    state.cart[id] = cur + 1;
    saveCart();
    render();
    toast(`${p.name} adicionado ao carrinho`);
  }

  function setQty(id, qty) {
    const p = byId(id);
    if (!p) return;
    if (qty <= 0) delete state.cart[id];
    else state.cart[id] = Math.min(qty, p.stock);
    saveCart();
    render();
  }

  async function checkout() {
    // Revalida o estoque antes de enviar o pedido
    if (state.live) await loadProducts();
    const fixed = clampCart();
    render();
    if (fixed.length) {
      toast("O estoque de alguns itens mudou. Confira o carrinho.");
      return;
    }
    const entries = Object.entries(state.cart).map(([id, qty]) => ({ p: byId(id), qty })).filter((e) => e.p);
    if (!entries.length) return;

    let subtotal = 0;
    const lines = entries.map(({ p, qty }) => {
      const v = finalPrice(p) * qty;
      subtotal += v;
      return `• ${qty}x ${p.name}${p.variant ? ` (${p.variant})` : ""}: ${brl(v)}`;
    });
    const msg = [
      `Olá! Quero fazer este pedido na ${CFG.brandName || "loja"}:`, "",
      ...lines, "",
      `Subtotal: ${brl(subtotal)}`,
      `No Pix: ${brl(pixPrice(subtotal))}`, "",
      "Pode confirmar a disponibilidade e o frete?",
    ].join("\n");
    window.open(`https://wa.me/${CFG.whatsapp}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
  }

  // ---------------------------------------------------------------- dados
  let sb = null;

  function setStatus(text, live) {
    const el = $("#stock-status");
    el.textContent = text;
    el.classList.toggle("is-live", !!live);
  }

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.async = true; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  async function loadProducts() {
    const { data, error } = await sb.from("products").select("*").eq("active", true).order("sort_order").order("id");
    if (error) throw error;
    state.products = data.map((p) => ({ ...p, price: Number(p.price), sale_price: p.sale_price == null ? null : Number(p.sale_price), stock: Number(p.stock) }));
  }

  function onRealtime(payload) {
    const row = payload.new && Object.keys(payload.new).length ? payload.new : null;
    const oldId = payload.old && payload.old.id;
    const idx = state.products.findIndex((p) => String(p.id) === String(row ? row.id : oldId));

    if (payload.eventType === "DELETE" || (row && row.active === false)) {
      if (idx >= 0) state.products.splice(idx, 1);
    } else if (row) {
      const p = { ...row, price: Number(row.price), sale_price: row.sale_price == null ? null : Number(row.sale_price), stock: Number(row.stock) };
      if (idx >= 0) state.products[idx] = { ...state.products[idx], ...p }; else state.products.push(p);
      state.products.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id);
    }

    const changed = clampCart();
    render(row ? [row.id] : []);
    if (changed.length) toast(`Estoque atualizado: ${changed.map((p) => p.name).join(", ")}`);
  }

  async function init() {
    if (CFG.supabaseUrl && CFG.supabaseAnonKey) {
      try {
        setStatus("Conectando ao estoque…");
        await loadScript(SUPABASE_SDK);
        sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
        await loadProducts();
        state.live = true;
        clampCart();
        render();
        setStatus("Estoque atualizado em tempo real", true);
        sb.channel("products-stock")
          .on("postgres_changes", { event: "*", schema: "public", table: "products" }, onRealtime)
          .subscribe((status) => {
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setStatus("Estoque carregado (sem atualização ao vivo)", false);
          });
        return;
      } catch (err) {
        console.error("Supabase:", err);
        setStatus("Não foi possível carregar o estoque ao vivo. Mostrando catálogo de demonstração.");
      }
    } else {
      setStatus("Modo demonstração. Conecte o Supabase em config.js para mostrar o estoque real.");
    }
    state.products = (window.DEMO_PRODUCTS || []).map((p, i) => ({ sort_order: i, ...p }));
    clampCart();
    render();
  }

  // ---------------------------------------------------------------- UI fixa
  function fillStatic() {
    const brand = CFG.brandName || "Loja";
    document.title = `${brand} | ${CFG.brandTagline || "Loja"}`;
    $$(".js-brand").forEach((e) => (e.textContent = brand));
    $$(".js-tagline").forEach((e) => (e.textContent = CFG.brandTagline || ""));
    $(".logo__mark").textContent = CFG.brandInitial || brand[0];
    $("#topbar").textContent = CFG.topBarText || "";
    $("#topbar").hidden = !CFG.topBarText;

    setupMarquee();

    $("#hero-title").innerHTML = (CFG.heroTitle || []).map((w) => `<span>${esc(w)}</span>`).join("");
    $(".js-hero-deal").textContent = CFG.heroDeal || "";
    $(".js-hero-text").textContent = CFG.heroText || "";
    $(".js-pix-label").textContent = `${((CFG.pixDiscount || 0) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% off pagando no Pix`;

    const wa = `https://wa.me/${CFG.whatsapp}?text=${encodeURIComponent(`Olá! Vim pelo site da ${brand}.`)}`;
    $("#wa-float").href = wa;

    const links = [
      ["#mais-procurados", "Mais procurados"], ["#queima", "Ofertas"], ["#catalogo", "Produtos"], [wa, "WhatsApp"],
      ...(CFG.instagram ? [[`https://instagram.com/${CFG.instagram}`, "Instagram"]] : []),
      ...(CFG.email ? [[`mailto:${CFG.email}`, CFG.email]] : []),
    ];
    $("#footer-links").innerHTML = links.map(([h, t]) =>
      `<li><a href="${esc(h)}"${h.startsWith("http") ? ' target="_blank" rel="noopener"' : ""}>${esc(t)}</a></li>`).join("");
    $("#year").textContent = new Date().getFullYear();
  }

  // Faixa de avisos: pausa pelo botão, e para sozinha fora da tela
  function setupMarquee() {
    const box = $("#marquee-box");
    const items = CFG.marquee || [];
    if (!items.length) { box.hidden = true; return; }
    const words = items.map((w) => `<span>${esc(w)}</span>`).join("");
    $("#marquee").innerHTML = words + words + words + words; // repetido p/ loop contínuo
    $("#marquee-text").textContent = items.join(". ") + ".";

    const btn = $("#marquee-toggle");
    const PAUSE = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12" rx="1"/><rect x="9.5" y="2" width="3.5" height="12" rx="1"/></svg>';
    const PLAY = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11a1 1 0 0 0 1.5.86l9-5.5a1 1 0 0 0 0-1.72l-9-5.5A1 1 0 0 0 4 2.5z"/></svg>';
    let userPaused = false, offscreen = false;
    const sync = () => {
      box.classList.toggle("is-paused", userPaused || offscreen);
      btn.setAttribute("aria-pressed", String(userPaused));
      btn.setAttribute("aria-label", userPaused ? "Retomar faixa de avisos" : "Pausar faixa de avisos");
      btn.innerHTML = userPaused ? PLAY : PAUSE;
    };
    btn.addEventListener("click", () => { userPaused = !userPaused; sync(); });
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(([e]) => { offscreen = !e.isIntersecting; sync(); }).observe(box);
    }
    sync();
  }

  function startCountdown() {
    const target = new Date(CFG.countdownTo).getTime();
    const box = $("#countdown");
    if (!target) { box.hidden = true; return; }
    const units = { d: 864e5, h: 36e5, m: 6e4, s: 1e3 };
    const pad = (n) => String(n).padStart(2, "0");
    const tick = () => {
      let diff = target - Date.now();
      if (diff <= 0) {
        $(".countdown__label", box).textContent = "A Black Friday começou!";
        $$("[data-unit]", box).forEach((e) => (e.textContent = "00"));
        return clearInterval(timer);
      }
      for (const [u, ms] of Object.entries(units)) {
        const v = Math.floor(diff / ms); diff -= v * ms;
        $(`[data-unit="${u}"]`, box).textContent = pad(v);
      }
    };
    const timer = setInterval(tick, 1000);
    tick();
  }

  function bindEvents() {
    const cart = $("#cart");

    document.addEventListener("click", (e) => {
      const t = e.target.closest("button, [data-action]");
      if (!t) return;
      const d = t.dataset;
      if (d.add) addToCart(d.add);
      else if (d.inc) setQty(d.inc, (state.cart[d.inc] || 0) + 1);
      else if (d.dec) setQty(d.dec, (state.cart[d.dec] || 0) - 1);
      else if (d.remove) setQty(d.remove, 0);
      else if (d.cat) { state.category = d.cat; render(); }
      else if (d.action === "cart") { renderCart(); cart.showModal(); }
      else if (d.action === "close-cart") cart.close();
      else if (d.action === "checkout") checkout();
      else if (d.action === "search") {
        $("#catalogo").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        setTimeout(() => $("#search-input").focus({ preventScroll: true }), 350);
      }
    });

    // fechar o carrinho tocando fora
    cart.addEventListener("click", (e) => { if (e.target === cart) cart.close(); });

    let debounce;
    $("#search-input").addEventListener("input", (e) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => { state.query = e.target.value; render(); }, 150);
    });

    // carrinho sincronizado entre abas
    window.addEventListener("storage", (e) => { if (e.key === CART_KEY) { state.cart = loadCart(); render(); } });
  }

  fillStatic();
  startCountdown();
  bindEvents();
  init();
})();
