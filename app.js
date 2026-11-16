/* =====================================================================
   Loja — app (vitrine, estoque ao vivo via Supabase, carrinho → WhatsApp)
   ===================================================================== */
(() => {
  "use strict";

  const CFG = window.STORE_CONFIG || {};
  const SUPABASE_SDK = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js";
  const CART_KEY = "loja.cart.v2";
  const CEP_KEY = "loja.cep.v1";
  const ORDER_KEY = "loja.order.v1";
  const MP_SDK = "https://sdk.mercadopago.com/js/v2";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const state = {
    products: [],
    category: "Todos",
    query: "",
    cart: loadCart(),
    live: false,
    status: "ready",   // "loading" | "ready" | "error"
    // frete: "idle" | "loading" | "ready" | "error"
    ship: { status: "idle", cep: "", address: null, options: [], selected: null, sig: "", msg: "", quoteId: null },
    // pagamento: etapa do painel e pedido em andamento
    pay: { step: "cart", order: null, token: null, result: "", busy: false, resumed: false },
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
    "Sedas": '<path d="M5 4h11l3 3v13H5z"/><path d="M16 4v3h3"/><path d="M8 10h8M8 13.5h8M8 17h5"/>',
    "Piteiras": '<rect x="9" y="3" width="6" height="18" rx="3"/><path d="M9 8h6M9 16h6"/>',
    "Isqueiros": '<rect x="7" y="10" width="10" height="11" rx="2"/><path d="M9 10V7h6v3"/><path d="M12 2.5c1.5 1.4 2 2.5 1.2 3.6-.5.7-1.9.7-2.4 0-.8-1.1-.3-2.2 1.2-3.6z"/>',
    "Bags": '<path d="M5 8h14l-1 13H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/><path d="M8 12h8"/>',
    "Cases": '<rect x="3" y="7" width="18" height="12" rx="2"/><path d="M9 7V5h6v2M3 12h18"/>',
    "Dichavadores": '<ellipse cx="12" cy="6" rx="7" ry="2.5"/><path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6"/><path d="M5 11.5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"/>',
    "Acessórios": '<rect x="3" y="8" width="18" height="10" rx="3"/><path d="M7 8V6M17 8V6"/>',
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
    const tags = out
      ? '<span class="tag tag--out">Esgotado</span>'
      : (off ? `<span class="tag tag--off">-${off}% off</span>` : "");
    const ship = !out && p.ships_today
      ? '<span class="card__ship"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/></svg>Envio hoje</span>'
      : "";
    const button = out
      ? `<button class="btn btn--quiet card__btn" type="button" data-notify="${esc(p.id)}" aria-label="Avisar quando chegar: ${esc(p.name)}">Avisar quando chegar</button>`
      : `<button class="btn btn--outline card__btn" type="button" data-add="${esc(p.id)}" ${canAdd ? "" : "disabled"}
            aria-label="${inCart >= s ? "Limite do estoque no carrinho" : "Adicionar ao carrinho"}: ${esc(p.name)}">
            ${inCart >= s ? "Limite atingido" : "Adicionar"}
          </button>`;
    if (variant === "flash") {
      return `
      <article class="card card--flash${out ? " is-out" : ""}" role="listitem" data-id="${esc(p.id)}" aria-label="${esc(p.name)}">
        ${off ? `<span class="ribbon"><b>-${off}%</b> off</span>` : ""}
        <div class="card__media">${media(p)}</div>
        <div class="card__body">
          <h3 class="card__name">${esc(p.name)}</h3>
          ${p.variant ? `<span class="card__variant">${esc(p.variant)}</span>` : ""}
          <div class="card__prices">
            ${off ? `<div class="price-old"><span class="visually-hidden">De </span>${brl(p.price)}</div>` : ""}
            <div class="price">${off ? '<span class="visually-hidden">Por </span>' : ""}${brl(fp)}</div>
            ${off ? `<div class="save">Economize ${brl(Number(p.price) - fp)}</div>` : ""}
          </div>
          <span class="${st.cls}">${st.text}</span>
          ${button}
        </div>
      </article>`;
    }

    return `
      <article class="card${out ? " is-out" : ""}" role="listitem" data-id="${esc(p.id)}" aria-label="${esc(p.name)}">
        <div class="card__media">${media(p)}<div class="card__tags">${tags}</div></div>
        <div class="card__body">
          ${p.brand ? `<span class="card__brand">${esc(p.brand)}</span>` : ""}
          <h3 class="card__name">${esc(p.name)}</h3>
          ${p.variant ? `<span class="card__variant">${esc(p.variant)}</span>` : ""}
          <div class="card__prices">
            ${off ? `<div class="price-old"><span class="visually-hidden">De </span>${brl(p.price)}</div>` : ""}
            <div class="price">${off ? '<span class="visually-hidden">Por </span>' : ""}${brl(fp)}</div>
            <div class="price-pix"><b>${brl(pixPrice(fp))}</b> no Pix</div>
          </div>
          <span class="${st.cls}">${st.text}</span>
          ${ship}
          ${button}
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
    const key = ["add", "notify", "cat", "inc", "dec"].find((k) => a.dataset[k] != null);
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

  const skeleton = (n) => Array.from({ length: n }, () =>
    '<div class="card card--skeleton" role="listitem" aria-hidden="true"><div class="card__media"></div><div class="card__body"><span class="sk sk--sm"></span><span class="sk"></span><span class="sk sk--md"></span><span class="sk sk--btn"></span></div></div>').join("");

  function paintPending() {
    const loading = state.status === "loading";
    for (const key of ["featured", "clearance", "ships", "all"]) {
      const el = $(`[data-list="${key}"]`);
      el.innerHTML = loading && key !== "clearance" ? skeleton(4) : "";
      if (key !== "all") el.closest("section").hidden = !loading || key === "clearance";
    }
    $("#empty").hidden = true;
    $("#load-error").hidden = loading;
    $("#catalogo").setAttribute("aria-busy", String(loading));
  }

  function paint(changedIds) {
    if (state.status !== "ready") return paintPending();
    $("#load-error").hidden = true;
    $("#catalogo").setAttribute("aria-busy", "false");
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

    renderShip(entries);
    const ship = selectedShip();
    $("#cart-subtotal").textContent = brl(subtotal);
    $("#cart-ship-row").hidden = !ship;
    if (ship) $("#cart-ship").textContent = brl(ship.price);
    $("#cart-pix-label").textContent = ship ? "Total no Pix" : "No Pix";
    $("#cart-pix").textContent = brl(pixPrice(subtotal) + (ship ? ship.price : 0));

    // Com Mercado Pago configurado, paga no site; senão, segue pelo WhatsApp
    const pay = payOn();
    $("#pay-start").hidden = !pay;
    $("#wa-checkout").hidden = pay;
    $("#cart-note").textContent = pay
      ? "Pix ou cartão em até 12x, com pagamento seguro pelo Mercado Pago."
      : "Você confirma o pedido, o frete e o pagamento com a nossa equipe no WhatsApp.";
  }

  // ---------------------------------------------------------------- frete
  const freightOn = () => CFG.freight !== false && !!(CFG.supabaseUrl && CFG.supabaseAnonKey);
  const fmtCep = (d) => (d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5, 8)}` : d);
  const cartSig = (entries) => entries.map(({ p, qty }) => `${p.id}:${qty}`).sort().join(",");
  const selectedShip = () => (state.ship.status === "ready" && state.ship.options.find((o) => o.id === state.ship.selected)) || null;

  function etaText(o) {
    if (o.minutes) return `Hoje, em cerca de ${o.minutes} min`;
    if (o.sameDay) return "Entrega hoje";
    if (o.days) return o.days === 1 ? "Até 1 dia útil" : `Até ${o.days} dias úteis`;
    return "Prazo a confirmar";
  }
  const shipName = (o) => [o.carrier, o.service].filter(Boolean).join(" ");

  function renderShip(entries) {
    const box = $("#ship");
    const s = state.ship;
    box.hidden = !freightOn() || entries.length === 0;
    if (box.hidden) return;

    // Carrinho mudou depois da cotação: o valor não vale mais
    if (s.status === "ready" && s.sig !== cartSig(entries)) {
      Object.assign(s, { status: "idle", options: [], selected: null, msg: "Os itens mudaram. Calcule o frete de novo." });
    }

    const a = s.address;
    $("#ship-addr").hidden = !(a && s.status === "ready");
    if (a) $("#ship-addr").textContent = [a.street, a.district, a.city && `${a.city}/${a.uf}`].filter(Boolean).join(", ");
    $("#ship-msg").textContent = s.status === "loading" ? "Calculando…" : s.msg;
    $("#ship-msg").classList.toggle("is-error", s.status === "error");
    $("#ship-btn").disabled = s.status === "loading";
    $("#ship-form").setAttribute("aria-busy", String(s.status === "loading"));

    const show = s.status === "ready" && s.options.length > 0;
    $("#ship-opts").hidden = !show;
    if (!show) { $("#ship-list").innerHTML = ""; return; }
    const html = s.options.map((o) => `
      <label class="ship-opt${o.sameDay ? " ship-opt--fast" : ""}">
        <input type="radio" name="ship" value="${esc(o.id)}" ${o.id === s.selected ? "checked" : ""}>
        <span class="ship-opt__main">
          <span class="ship-opt__name">${esc(shipName(o))}</span>
          <span class="ship-opt__eta">${esc(etaText(o))}</span>
        </span>
        <span class="ship-opt__price">${brl(o.price)}</span>
      </label>`).join("");
    // só reescreve se mudou, para não perder o foco do teclado
    if ($("#ship-list").dataset.html !== html) {
      $("#ship-list").innerHTML = html;
      $("#ship-list").dataset.html = html;
    }
  }

  let quoteSeq = 0;
  async function quoteShipping() {
    const s = state.ship;
    const cep = $("#ship-cep").value.replace(/\D/g, "");
    const entries = Object.entries(state.cart).map(([id, qty]) => ({ p: byId(id), qty })).filter((e) => e.p);
    if (cep.length !== 8) {
      Object.assign(s, { status: "error", options: [], selected: null, msg: "Digite o CEP com 8 números." });
      renderCart();
      $("#ship-cep").focus();
      return;
    }
    if (!entries.length) return;

    const seq = ++quoteSeq;
    Object.assign(s, { status: "loading", cep, msg: "" });
    renderCart();

    let res, data;
    try {
      res = await fetch(`${CFG.supabaseUrl.replace(/\/+$/, "")}/functions/v1/${CFG.freightFunction || "frete"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: CFG.supabaseAnonKey, Authorization: `Bearer ${CFG.supabaseAnonKey}` },
        body: JSON.stringify({ cep, items: entries.map(({ p, qty }) => ({ id: p.id, qty })) }),
      });
      data = await res.json().catch(() => ({}));
    } catch (err) {
      console.error("Frete:", err);
    }
    if (seq !== quoteSeq) return; // chegou uma resposta mais nova

    if (res && res.ok && Array.isArray(data.options)) {
      const options = data.options;
      try { localStorage.setItem(CEP_KEY, cep); } catch { /* modo privado */ }
      Object.assign(s, {
        status: "ready", address: data.address || null, options, sig: cartSig(entries), quoteId: data.quote_id || null,
        selected: options.length ? options[0].id : null, // começa pela mais barata
        msg: options.length ? "" : "Não há entrega para esse CEP pelo site. Combine o frete no WhatsApp.",
      });
    } else {
      const msg = res && res.status === 404 ? "Não encontramos esse CEP. Confira os números."
        : res && res.status === 400 ? "Confira o CEP e tente de novo."
        : "Não deu para calcular agora. Tente de novo ou combine o frete no WhatsApp.";
      Object.assign(s, { status: "error", options: [], selected: null, address: null, msg });
    }
    renderCart();
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

  // ---------------------------------------------------------------- pagamento (Mercado Pago)
  const payOn = () => freightOn() && !!CFG.mercadoPagoPublicKey;
  const onlyDigits = (v) => String(v || "").replace(/\D/g, "");
  const cartEntries = () => Object.entries(state.cart).map(([id, qty]) => ({ p: byId(id), qty })).filter((e) => e.p);
  const addrText = (a) => (a ? [a.street, a.district, a.city && `${a.city}/${a.uf}`].filter(Boolean).join(", ") : "");

  const maskPhone = (v) => {
    const d = onlyDigits(v).slice(0, 11);
    if (d.length <= 2) return d.length ? `(${d}` : "";
    const rest = d.slice(2);
    const split = d.length > 10 ? 5 : 4;
    return `(${d.slice(0, 2)}) ${rest.slice(0, split)}${rest.length > split ? `-${rest.slice(split)}` : ""}`;
  };
  const maskCpf = (v) => {
    const d = onlyDigits(v).slice(0, 11);
    return d.replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
  };
  function validCpf(v) {
    const c = onlyDigits(v);
    if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
    const dv = (n) => { let s = 0; for (let i = 0; i < n; i++) s += Number(c[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
    return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
  }

  const STEP_TITLES = { cart: "Seu carrinho", checkout: "Finalizar compra", pix: "Pague com Pix", card: "Pague com cartão" };

  function showStep(step, title) {
    if (state.pay.step === "pix" && step !== "pix") stopPoll();
    if (state.pay.step === "card" && step !== "card") unmountBrick();
    state.pay.step = step;
    $$("#cart [data-step]").forEach((el) => { el.hidden = el.dataset.step !== step; });
    $("#cart-title").textContent = title || STEP_TITLES[step] || "";
    $("#sheet-back").hidden = !["checkout", "pix", "card"].includes(step);
    if ($("#cart").open) $("#cart-title").focus({ preventScroll: true });
  }

  async function api(body) {
    try {
      const res = await fetch(`${CFG.supabaseUrl.replace(/\/+$/, "")}/functions/v1/${CFG.paymentFunction || "pagamento"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: CFG.supabaseAnonKey, Authorization: `Bearer ${CFG.supabaseAnonKey}` },
        body: JSON.stringify(body),
      });
      return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
    } catch (err) {
      console.error("Pagamento:", err);
      return { ok: false, status: 0, body: {} };
    }
  }

  function saveOrder() {
    try { localStorage.setItem(ORDER_KEY, JSON.stringify({ id: state.pay.order.id, token: state.pay.token })); } catch { /* modo privado */ }
  }
  function forgetOrder() {
    try { localStorage.removeItem(ORDER_KEY); } catch { /* modo privado */ }
  }

  // Mensagem do WhatsApp já com o número do pedido
  function orderWhatsapp(kind) {
    const o = state.pay.order;
    const brand = CFG.brandName || "loja";
    const how = o.method === "pix" ? "Pix" : "cartão";
    const text = {
      paid: `Olá! Fiz o pedido ${o.code} no site da ${brand} e o pagamento foi aprovado (${how}, ${brl(o.total)}). Quero falar sobre o meu pedido.`,
      pending: `Olá! Tenho uma dúvida sobre o pedido ${o.code} no site da ${brand} (${how}, ${brl(o.total)}, ainda não pago).`,
      review: `Olá! O pagamento do pedido ${o.code} no site da ${brand} está em análise (${how}, ${brl(o.total)}). Pode me ajudar?`,
      expired: `Olá! O Pix do pedido ${o.code} no site da ${brand} venceu antes de eu pagar. Pode me ajudar?`,
    }[kind];
    const href = `https://wa.me/${CFG.whatsapp}?text=${encodeURIComponent(text)}`;
    $$("#cart .js-order-wa").forEach((a) => { a.href = href; });
  }

  function fillOrderInfo() {
    const o = state.pay.order;
    $$("#cart .js-order-code").forEach((e) => { e.textContent = o.code; });
    $$("#cart .js-order-total").forEach((e) => { e.textContent = brl(o.total); });
  }

  // Etapa 2: dados do cliente ------------------------------------------
  function startPayment() {
    const entries = cartEntries();
    const ship = selectedShip();
    if (!entries.length || !ship) showStep("cart");
    if (!entries.length) return;
    if (!ship) {
      if (state.ship.status === "ready") state.ship.msg = "Escolha a entrega para continuar.";
      else Object.assign(state.ship, { status: "error", msg: "Calcule o frete e escolha a entrega para continuar." });
      renderCart();
      $("#ship-cep").focus();
      $("#ship").scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    const subtotal = entries.reduce((s, { p, qty }) => s + finalPrice(p) * qty, 0);
    $("#pay-ship").textContent = `${entries.reduce((n, e) => n + e.qty, 0)} ${cartCount() === 1 ? "item" : "itens"} · ${shipName(ship)} · ${etaText(ship).toLowerCase()}`;
    $("#pay-addr").textContent = `${addrText(state.ship.address)} · CEP ${fmtCep(state.ship.cep)}`;
    $("#price-pix").textContent = brl(pixPrice(subtotal) + ship.price);
    $("#price-card").textContent = brl(subtotal + ship.price);
    const pct = ((CFG.pixDiscount || 0) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
    $(".js-pix-hint").textContent = CFG.pixDiscount ? `${pct}% de desconto, aprovação na hora` : "Aprovação na hora";
    $("#checkout-alert").hidden = true;
    updateSubmitLabel();
    showStep("checkout");
    $("#checkout-form .sheet__body").scrollTop = 0;
  }

  function updateSubmitLabel() {
    const method = $("#checkout-form").elements.method.value;
    $("#checkout-submit").textContent = method === "pix" ? `Gerar Pix de ${$("#price-pix").textContent}` : "Continuar para o cartão";
  }

  function readForm() {
    const f = $("#checkout-form").elements;
    return {
      method: f.method.value,
      age: f.age.checked,
      customer: {
        name: f.name.value.trim().replace(/\s+/g, " "), email: f.email.value.trim(), phone: f.phone.value,
        cpf: f.cpf.value, number: f.number.value.trim(), complement: f.complement.value.trim(),
      },
    };
  }

  function markInvalid(fields) {
    const all = ["name", "email", "phone", "cpf", "number", "age"];
    for (const k of all) {
      const input = k === "age" ? $("#f-age") : $(`#f-${k}`);
      const bad = fields.includes(k);
      input.setAttribute("aria-invalid", String(bad));
      (k === "age" ? $("#e-age") : input.closest(".field")).classList.toggle("is-invalid", bad);
    }
    const first = all.find((k) => fields.includes(k));
    if (first) (first === "age" ? $("#f-age") : $(`#f-${first}`)).focus();
  }

  function validate({ customer: c, age }) {
    const bad = [];
    if (c.name.length < 5 || !c.name.includes(" ")) bad.push("name");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.email)) bad.push("email");
    const ph = onlyDigits(c.phone);
    if (ph.length < 10 || ph.length > 11) bad.push("phone");
    if (!validCpf(c.cpf)) bad.push("cpf");
    if (!c.number) bad.push("number");
    if (!age) bad.push("age");
    return bad;
  }

  function setBusy(busy, label) {
    state.pay.busy = busy;
    const b = $("#checkout-submit");
    b.disabled = busy;
    b.setAttribute("aria-busy", String(busy));
    if (busy) b.textContent = label; else updateSubmitLabel();
  }

  function formAlert(msg) {
    const el = $("#checkout-alert");
    el.textContent = msg;
    el.hidden = !msg;
  }

  async function submitCheckout(e) {
    e.preventDefault();
    if (state.pay.busy) return;
    const form = readForm();
    const bad = validate(form);
    markInvalid(bad);
    if (bad.length) return;

    const ship = selectedShip();
    if (!ship) { showStep("cart"); startPayment(); return; }
    formAlert("");
    setBusy(true, form.method === "pix" ? "Gerando o Pix…" : "Criando o pedido…");
    const res = await api({
      action: "order", method: form.method, age_confirmed: true, customer: form.customer,
      items: cartEntries().map(({ p, qty }) => ({ id: p.id, qty })),
      quote_id: state.ship.quoteId, ship_id: ship.id,
    });
    setBusy(false);

    if (!res.ok) {
      const b = res.body || {};
      if (res.status === 422 && Array.isArray(b.fields)) { markInvalid(b.fields); return; }
      if (res.status === 409 && b.code === "stock") {
        if (state.live) { await loadProducts().catch(() => {}); clampCart(); }
        Object.assign(state.ship, { status: "idle", options: [], selected: null, msg: "" });
        render();
        showStep("cart");
        toast("O estoque de alguns itens mudou. Confira o carrinho.");
        return;
      }
      if (res.status === 409 && b.code === "quote") {
        Object.assign(state.ship, { status: "idle", options: [], selected: null, msg: "O frete precisa ser calculado de novo." });
        renderCart();
        showStep("cart");
        $("#ship-cep").focus();
        return;
      }
      formAlert(b.error || "Não foi possível criar o pedido agora. Confira sua conexão e tente de novo.");
      return;
    }

    state.pay.order = res.body.order;
    state.pay.token = res.body.token;
    state.pay.email = form.customer.email;
    saveOrder();
    if (state.pay.order.method === "pix") showPix(); else showCard();
  }

  // Etapa 3a: Pix ------------------------------------------------------
  let pollTimer = null;
  let clockTimer = null;

  function showPix() {
    const o = state.pay.order;
    fillOrderInfo();
    orderWhatsapp("pending");
    const img = $("#pix-qr");
    img.hidden = !o.pix?.qr_base64;
    if (o.pix?.qr_base64) img.src = `data:image/png;base64,${o.pix.qr_base64}`;
    $("#pix-code").value = o.pix?.qr_code || "";
    $("#pix-copy").textContent = "Copiar código Pix";
    showStep("pix");
    startPoll();
  }

  function pixClock() {
    const exp = Date.parse(state.pay.order?.pix?.expires_at || "");
    const el = $("#pix-status");
    if (!exp) { el.textContent = "Aguardando o pagamento…"; return; }
    const left = Math.max(0, Math.round((exp - Date.now()) / 1000));
    if (left === 0) { el.textContent = "O código venceu. Conferindo o pagamento…"; return; }
    const mm = String(Math.floor(left / 60)).padStart(2, "0");
    const ss = String(left % 60).padStart(2, "0");
    el.textContent = `Aguardando o pagamento. O código vence em ${mm}:${ss}.`;
  }

  function startPoll() {
    stopPoll();
    pixClock();
    clockTimer = setInterval(pixClock, 1000);
    const tick = async () => {
      const res = await api({ action: "status", id: state.pay.order.id, token: state.pay.token });
      if (state.pay.step !== "pix") return;
      if (res.ok) {
        state.pay.order = { ...state.pay.order, ...res.body.order, pix: res.body.order.pix || state.pay.order.pix };
        if (applyResult(res.body.order)) return;
      }
      pollTimer = setTimeout(tick, document.hidden ? 15000 : 4000);
    };
    pollTimer = setTimeout(tick, 4000);
  }
  function stopPoll() {
    clearTimeout(pollTimer); clearInterval(clockTimer);
    pollTimer = clockTimer = null;
  }

  async function copyPix() {
    const code = $("#pix-code").value;
    try { await navigator.clipboard.writeText(code); } catch {
      $("#pix-code").select(); document.execCommand("copy");
    }
    $("#pix-copy").textContent = "Código copiado";
    toast("Código Pix copiado. Cole no app do seu banco.");
    setTimeout(() => { if ($("#pix-copy")) $("#pix-copy").textContent = "Copiar código Pix"; }, 2500);
  }

  // Etapa 3b: cartão (Card Payment Brick do Mercado Pago) --------------
  let brick = null;

  async function showCard() {
    fillOrderInfo();
    orderWhatsapp("pending");
    $("#card-alert").hidden = true;
    $("#card-brick").innerHTML = '<p class="pay__loading">Carregando o formulário seguro…</p>';
    showStep("card");
    try {
      if (!window.MercadoPago) await loadScript(MP_SDK);
      const mp = new window.MercadoPago(CFG.mercadoPagoPublicKey, { locale: "pt-BR" });
      $("#card-brick").innerHTML = "";
      brick = await mp.bricks().create("cardPayment", "card-brick", {
        initialization: { amount: state.pay.order.total, payer: { email: state.pay.email || "" } },
        customization: {
          visual: { style: { theme: "dark", customVariables: { baseColor: "#7c3aed", formBackgroundColor: "#17191e", inputBackgroundColor: "#0c0d10" } } },
          paymentMethods: { maxInstallments: CFG.maxInstallments || 12 },
        },
        callbacks: {
          onReady: () => {},
          onSubmit: (formData) => payWithCard(formData),
          onError: (err) => console.error("Mercado Pago:", err),
        },
      });
    } catch (err) {
      console.error("Mercado Pago:", err);
      $("#card-brick").innerHTML = "";
      cardAlert("Não foi possível carregar o pagamento com cartão. Recarregue a página ou pague com Pix.");
    }
  }

  function unmountBrick() {
    if (brick) { try { brick.unmount(); } catch { /* já desmontado */ } }
    brick = null;
  }

  function cardAlert(msg) {
    const el = $("#card-alert");
    el.textContent = msg;
    el.hidden = !msg;
    if (msg) el.scrollIntoView({ block: "nearest" });
  }

  const CARD_ERRORS = {
    cc_rejected_bad_filled_card_number: "Confira o número do cartão.",
    cc_rejected_bad_filled_date: "Confira a data de validade.",
    cc_rejected_bad_filled_security_code: "Confira o código de segurança (CVV).",
    cc_rejected_bad_filled_other: "Confira os dados do cartão.",
    cc_rejected_insufficient_amount: "O cartão não tem limite suficiente. Tente outro cartão ou pague com Pix.",
    cc_rejected_call_for_authorize: "O banco pediu autorização. Ligue para o banco e tente de novo, ou use outro cartão.",
    cc_rejected_card_disabled: "O cartão está bloqueado. Fale com o banco ou use outro cartão.",
    cc_rejected_duplicated_payment: "Você já fez um pagamento com esse valor. Confira antes de tentar de novo.",
    cc_rejected_high_risk: "O pagamento foi recusado por segurança. Tente outro cartão ou pague com Pix.",
    cc_rejected_max_attempts: "Você atingiu o limite de tentativas. Use outro cartão ou pague com Pix.",
  };

  async function payWithCard(formData) {
    cardAlert("");
    const res = await api({ action: "card", id: state.pay.order.id, token: state.pay.token, card: formData });
    if (res.ok) {
      state.pay.order = res.body.order;
      if (applyResult(res.body.order, res.body.payment)) return;
      const detail = res.body.payment?.detail;
      cardAlert(CARD_ERRORS[detail] || "O pagamento foi recusado. Confira os dados ou tente outro cartão.");
      throw new Error(detail || "rejected");   // o formulário volta a ficar editável
    }
    if (res.status === 409 && res.body.order) {
      state.pay.order = res.body.order;
      if (applyResult(res.body.order)) return;
    }
    cardAlert(res.status === 402 ? (res.body.error || "Pagamento recusado.") : "Não foi possível concluir agora. Tente de novo em instantes.");
    throw new Error("card");
  }

  // Etapa 4: resultado -------------------------------------------------
  // Devolve true quando o pedido saiu de "aguardando pagamento"
  function applyResult(order, payment) {
    if (order.status === "paid" || order.status === "needs_review") { showDone("paid"); return true; }
    if (order.status === "expired" || order.status === "cancelled") { showDone("expired"); return true; }
    const st = payment?.status || order.payment_status;
    if (order.method === "card" && (st === "in_process" || st === "pending" || st === "authorized")) { showDone("review"); return true; }
    return false;
  }

  const DONE = {
    paid: {
      title: "Pagamento aprovado", icon: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
      text: "Recebemos seu pagamento. Agora é com a gente: vamos separar o pedido e avisar você pelo WhatsApp quando ele sair para entrega.",
      again: "Continuar comprando",
    },
    review: {
      title: "Pagamento em análise", icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
      text: "O Mercado Pago está analisando o pagamento. Costuma levar poucos minutos, e você recebe a resposta por e-mail.",
      again: "Fechar",
    },
    expired: {
      title: "O Pix venceu", icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12M12 15.5v.5"/></svg>',
      text: "Nenhum valor foi cobrado. Você pode voltar e gerar um novo Pix.",
      again: "Gerar novo Pix",
    },
  };

  function showDone(kind) {
    const o = state.pay.order;
    const d = DONE[kind];
    state.pay.result = kind;
    stopPoll();
    fillOrderInfo();
    orderWhatsapp(kind);
    $("#done-icon").className = `done__icon done__icon--${kind}`;
    $("#done-icon").innerHTML = d.icon;
    $("#done-title").textContent = d.title;
    $("#done-text").textContent = d.text;
    $("#done-again").textContent = d.again;
    $("#done-totals").innerHTML = [
      ["Subtotal", brl(o.subtotal)],
      ...(o.discount ? [["Desconto no Pix", `− ${brl(o.discount)}`]] : []),
      ["Frete", brl(o.shipping)],
      [kind === "paid" ? "Total pago" : "Total", brl(o.total)],
    ].map(([k, v], i, arr) => `<div${i === arr.length - 1 ? ' class="totals__pix"' : ""}><dt>${k}</dt><dd>${v}</dd></div>`).join("");
    showStep("done", "Seu pedido");

    if (kind === "paid") {
      // Pedido pago: esvazia o carrinho
      state.cart = {};
      saveCart();
      Object.assign(state.ship, { status: "idle", options: [], selected: null, msg: "", quoteId: null });
      forgetOrder();
      render();
    } else if (kind === "expired") {
      forgetOrder();
    }
  }

  function finishPayment() {
    const kind = state.pay.result;
    if (kind === "expired") { state.pay.order = null; startPayment(); return; }
    resetPayment();
    $("#cart").close();
  }

  function resetPayment() {
    stopPoll();
    unmountBrick();
    Object.assign(state.pay, { order: null, token: null, result: "", busy: false });
    showStep("cart");
  }

  function payBack() {
    if (state.pay.step === "checkout") { showStep("cart"); return; }
    // voltou do Pix ou do cartão: o pedido fica para trás (o Pix vence sozinho)
    forgetOrder();
    state.pay.order = null;
    startPayment();
  }

  // Ao abrir o carrinho: retoma um Pix em aberto ou mostra o pedido que já foi pago
  async function resumeOrder() {
    if (state.pay.resumed || !payOn()) return;
    state.pay.resumed = true;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(ORDER_KEY)); } catch { /* nada salvo */ }
    if (!saved?.id || !saved?.token) return;
    const res = await api({ action: "status", id: saved.id, token: saved.token });
    if (!res.ok) { if (res.status === 404) forgetOrder(); return; }
    if (state.pay.step !== "cart") return;
    state.pay.order = res.body.order;
    state.pay.token = saved.token;
    if (applyResult(res.body.order)) return;
    if (res.body.order.method === "pix" && res.body.order.pix) showPix();
    else { forgetOrder(); state.pay.order = null; }
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
    const ship = selectedShip();
    const a = state.ship.address;
    const shipLines = ship ? [
      `Entrega: ${shipName(ship)}, ${brl(ship.price)} (${etaText(ship).toLowerCase()})`,
      `CEP: ${fmtCep(state.ship.cep)}${a ? ` (${[a.street, a.district, a.city && `${a.city}/${a.uf}`].filter(Boolean).join(", ")})` : ""}`,
      "Número e complemento: ",
      "",
      `Total: ${brl(subtotal + ship.price)}`,
      `Total no Pix: ${brl(pixPrice(subtotal) + ship.price)}`,
    ] : [
      `Subtotal: ${brl(subtotal)}`,
      `No Pix: ${brl(pixPrice(subtotal))}`,
    ];
    const msg = [
      `Olá! Quero fazer este pedido na ${CFG.brandName || "loja"}:`, "",
      ...lines, "",
      ...(ship ? [`Subtotal: ${brl(subtotal)}`] : []),
      ...shipLines, "",
      ...(CFG.ageGate ? ["Confirmo que tenho 18 anos ou mais.", ""] : []),
      ship ? "Pode confirmar a disponibilidade?" : "Pode confirmar a disponibilidade e o frete?",
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

  let channelStarted = false;

  async function init() {
    if (!(CFG.supabaseUrl && CFG.supabaseAnonKey)) {
      // Sem Supabase: catálogo de demonstração (aviso só no console, não para o cliente)
      console.info("Loja em modo demonstração. Preencha supabaseUrl e supabaseAnonKey em config.js.");
      state.products = (window.DEMO_PRODUCTS || []).map((p, i) => ({ sort_order: i, ...p }));
      clampCart();
      render();
      return;
    }

    state.status = "loading";
    setStatus("");
    render();
    try {
      if (!window.supabase) await loadScript(SUPABASE_SDK);
      sb = sb || window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
      await loadProducts();
      state.live = true;
      state.status = "ready";
      clampCart();
      render();
      setStatus("Estoque atualizado em tempo real", true);
      if (!channelStarted) {
        channelStarted = true;
        sb.channel("products-stock")
          .on("postgres_changes", { event: "*", schema: "public", table: "products" }, onRealtime)
          .subscribe((status) => {
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setStatus("Estoque carregado. Recarregue a página para ver mudanças.", false);
          });
      }
    } catch (err) {
      // Nunca mostrar produtos de demonstração como se fossem reais
      console.error("Supabase:", err);
      state.status = "error";
      render();
    }
  }

  function notifyRestock(id) {
    const p = byId(id);
    if (!p) return;
    const msg = `Olá! Quero ser avisado quando o produto ${p.name}${p.variant ? ` (${p.variant})` : ""} voltar ao estoque.`;
    window.open(`https://wa.me/${CFG.whatsapp}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
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
    const deal = CFG.heroDeal || {};
    $(".js-deal-pre").textContent = deal.pre || "";
    $(".js-deal-value").textContent = deal.value || "";
    $(".js-deal-post").textContent = deal.post || "";
    $(".ticket").hidden = !deal.value;
    $(".js-hero-kicker").textContent = CFG.heroKicker || "";
    $(".hero__kicker").hidden = !CFG.heroKicker;
    $(".js-hero-text").textContent = CFG.heroText || "";
    $(".js-hero-strong").textContent = CFG.heroTextStrong || "";
    $(".js-flash-kicker").textContent = CFG.flashKicker || "";
    $(".js-flash-pill").hidden = !CFG.flashKicker;
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
      else if (d.notify) notifyRestock(d.notify);
      else if (d.action === "retry") init();
      else if (d.inc) setQty(d.inc, (state.cart[d.inc] || 0) + 1);
      else if (d.dec) setQty(d.dec, (state.cart[d.dec] || 0) - 1);
      else if (d.remove) setQty(d.remove, 0);
      else if (d.cat) { state.category = d.cat; render(); }
      else if (d.action === "cart") {
        renderCart();
        cart.showModal();
        if (state.pay.step === "pix") startPoll();
        resumeOrder();
      }
      else if (d.action === "close-cart") cart.close();
      else if (d.action === "checkout") checkout();
      else if (d.action === "pay-start") startPayment();
      else if (d.action === "pay-back") payBack();
      else if (d.action === "pay-finish") finishPayment();
      else if (d.action === "pix-copy") copyPix();
      else if (d.action === "search") {
        $("#catalogo").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        setTimeout(() => $("#search-input").focus({ preventScroll: true }), 350);
      }
    });

    // fechar o carrinho tocando fora
    cart.addEventListener("click", (e) => { if (e.target === cart) cart.close(); });
    cart.addEventListener("close", () => {
      stopPoll();
      // pedido pago: na próxima vez o carrinho abre do começo
      if (state.pay.step === "done" && state.pay.result === "paid") resetPayment();
    });

    // pagamento: máscaras, troca de forma de pagamento e envio
    const checkoutForm = $("#checkout-form");
    $("#f-phone").addEventListener("input", (e) => { e.target.value = maskPhone(e.target.value); });
    $("#f-cpf").addEventListener("input", (e) => { e.target.value = maskCpf(e.target.value); });
    checkoutForm.addEventListener("change", (e) => {
      if (e.target.name === "method") updateSubmitLabel();
      // tira o aviso de erro assim que o campo é corrigido
      if (e.target.getAttribute("aria-invalid") === "true" && !validate(readForm()).includes(e.target.name)) {
        e.target.setAttribute("aria-invalid", "false");
        (e.target.name === "age" ? $("#e-age") : e.target.closest(".field")).classList.remove("is-invalid");
      }
    });
    checkoutForm.addEventListener("submit", submitCheckout);

    let debounce;
    $("#search-input").addEventListener("input", (e) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => { state.query = e.target.value; render(); }, 150);
    });

    // frete: máscara 00000-000, calcular e escolher a opção
    const cepInput = $("#ship-cep");
    try { cepInput.value = fmtCep(localStorage.getItem(CEP_KEY) || ""); } catch { /* modo privado */ }
    cepInput.addEventListener("input", () => {
      cepInput.value = fmtCep(cepInput.value.replace(/\D/g, "").slice(0, 8));
    });
    $("#ship-form").addEventListener("submit", (e) => { e.preventDefault(); quoteShipping(); });
    $("#ship-list").addEventListener("change", (e) => {
      if (e.target.name !== "ship") return;
      state.ship.selected = e.target.value;
      renderCart();
    });

    // carrinho sincronizado entre abas
    window.addEventListener("storage", (e) => { if (e.key === CART_KEY) { state.cart = loadCart(); render(); } });
  }

  // Aviso de idade (18+) na entrada
  function setupAgeGate() {
    const AGE_KEY = "loja.age.ok.v1";
    const gate = $("#age-gate");
    let ok = false;
    try { ok = localStorage.getItem(AGE_KEY) === "1"; } catch { /* modo privado */ }
    if (!gate) return;
    if (!CFG.ageGate || ok) { gate.remove(); return; }

    $(".js-age-brand", gate).textContent = CFG.brandName || "Esta loja";
    gate.addEventListener("cancel", (e) => e.preventDefault()); // Esc não fecha
    $("#age-yes").addEventListener("click", () => {
      try { localStorage.setItem(AGE_KEY, "1"); } catch { /* modo privado */ }
      gate.close();
      gate.remove();
    });
    $("#age-no").addEventListener("click", () => {
      $("#age-ask").hidden = true;
      $("#age-denied").hidden = false;
      $("#age-denied").focus();
    });
    gate.showModal();
  }

  fillStatic();
  setupAgeGate();
  startCountdown();
  bindEvents();
  init();
})();
