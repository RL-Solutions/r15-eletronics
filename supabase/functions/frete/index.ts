// =====================================================================
//  Edge Function "frete": cotação de entrega para o carrinho da loja
// ---------------------------------------------------------------------
//  O site manda { cep, items: [{ id, qty }] } e recebe as opções de
//  entrega de todos os provedores ligados, da mais barata para a mais cara.
//  As chaves ficam só aqui (secrets do Supabase), nunca no site.
//
//  Cada provedor é ligado preenchendo os secrets dele (veja o README):
//    Correios (contrato) CORREIOS_USUARIO, CORREIOS_CODIGO_ACESSO, CORREIOS_CARTAO
//                        opcionais: CORREIOS_CONTRATO, CORREIOS_DR, CORREIOS_SERVICOS
//    Melhor Envio        MELHOR_ENVIO_TOKEN  (cota Correios, Jadlog, Loggi, J&T…)
//                        opcional: MELHOR_ENVIO_SANDBOX=true
//    Uber Direct         UBER_CLIENT_ID, UBER_CLIENT_SECRET, UBER_CUSTOMER_ID
//    Lalamove            LALAMOVE_KEY, LALAMOVE_SECRET
//                        opcionais: LALAMOVE_SANDBOX=true, LALAMOVE_SERVICE, LALAMOVE_MARKET
//  Obrigatórios:         ORIGEM_CEP, APP_CONTATO (e-mail técnico)
//  Para entrega rápida:  ORIGEM_ENDERECO (rua e número), ORIGEM_LAT, ORIGEM_LNG
//  Opcional:             ALLOWED_ORIGINS (ex.: https://seu-usuario.github.io)
// =====================================================================

const env = (k, d = "") => ((globalThis.Deno?.env.get(k)) ?? d).trim();
const isTrue = (v) => /^(1|true|sim|yes)$/i.test(v);
const digits = (v) => String(v ?? "").replace(/\D/g, "");
const fmtCep = (c) => `${c.slice(0, 5)}-${c.slice(5)}`;
const round2 = (n) => Math.round(n * 100) / 100;
const TIMEOUT_MS = 9000;

const DEFAULTS = { weight: 0.2, width: 12, height: 4, length: 17 };

function userAgent() {
  return `${env("APP_NOME", "Loja")} (${env("APP_CONTATO", "contato@exemplo.com")})`;
}

// Número no formato brasileiro ("1.234,56") ou internacional ("1234.56")
function toNumber(v) {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim();
  return Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
}

async function getJson(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} em ${new URL(url).host}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------- entrada
function parseItems(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 30) return null;
  const qty = new Map();
  for (const it of raw) {
    const id = String(it?.id ?? "");
    const q = Number(it?.qty);
    if (!/^[\w-]{1,40}$/.test(id) || !Number.isInteger(q) || q < 1 || q > 50) return null;
    qty.set(id, (qty.get(id) || 0) + q);
  }
  return qty;
}

// Preço e medidas vêm do banco, nunca do navegador
async function loadProducts(qty) {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_ANON_KEY");
  const ids = [...qty.keys()].join(",");
  const rows = await getJson(
    `${url}/rest/v1/products?select=id,price,sale_price,weight_kg,width_cm,height_cm,length_cm&active=eq.true&id=in.(${ids})`,
    { headers: key.startsWith("sb_") ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` } },
  );
  return (rows || []).map((r) => {
    const price = Number(r.price);
    const sale = r.sale_price == null ? null : Number(r.sale_price);
    return {
      id: String(r.id),
      qty: qty.get(String(r.id)),
      unit: sale != null && sale < price ? sale : price,
      weight: Number(r.weight_kg) || DEFAULTS.weight,
      width: Number(r.width_cm) || DEFAULTS.width,
      height: Number(r.height_cm) || DEFAULTS.height,
      length: Number(r.length_cm) || DEFAULTS.length,
    };
  });
}

// Junta tudo numa caixa: empilha as alturas e respeita o mínimo dos Correios
function pack(products) {
  const box = { weight: 0, width: 0, height: 0, length: 0 };
  for (const p of products) {
    box.weight += p.weight * p.qty;
    box.width = Math.max(box.width, p.width);
    box.length = Math.max(box.length, p.length);
    box.height += p.height * p.qty;
  }
  return {
    weight: round2(Math.max(box.weight, 0.05)),
    width: Math.ceil(Math.max(box.width, 11)),
    height: Math.ceil(Math.max(box.height, 2)),
    length: Math.ceil(Math.max(box.length, 16)),
  };
}

// ---------------------------------------------------------------- endereço
async function lookupCep(cep) {
  try {
    const a = await getJson(`https://brasilapi.com.br/api/cep/v2/${cep}`);
    const c = a.location?.coordinates || {};
    return {
      street: a.street || "", district: a.neighborhood || "", city: a.city || "", uf: a.state || "",
      lat: c.latitude ? Number(c.latitude) : null, lng: c.longitude ? Number(c.longitude) : null,
    };
  } catch {
    const v = await getJson(`https://viacep.com.br/ws/${cep}/json/`).catch(() => null);
    if (!v || v.erro) return null;
    return { street: v.logradouro || "", district: v.bairro || "", city: v.localidade || "", uf: v.uf || "", lat: null, lng: null };
  }
}

const fullAddress = (a, cep) =>
  [a.street, a.district, `${a.city}/${a.uf}`, fmtCep(cep), "Brasil"].filter(Boolean).join(", ");

// Coordenadas do destino (entrega rápida): BrasilAPI ou OpenStreetMap
async function destCoords(ctx) {
  if (ctx.coords !== undefined) return ctx.coords;
  const a = ctx.address;
  if (a.lat != null && a.lng != null) return (ctx.coords = { lat: a.lat, lng: a.lng });
  const qs = new URLSearchParams({
    format: "jsonv2", limit: "1", countrycodes: "br",
    street: a.street, city: a.city, state: a.uf, postalcode: fmtCep(ctx.cep),
  });
  const hits = await getJson(`https://nominatim.openstreetmap.org/search?${qs}`, { headers: { "User-Agent": userAgent() } })
    .catch(() => []);
  const h = hits && hits[0];
  return (ctx.coords = h ? { lat: Number(h.lat), lng: Number(h.lon) } : null);
}

let originCache = null;
async function originInfo() {
  if (originCache) return originCache;
  const cep = digits(env("ORIGEM_CEP"));
  const a = (await lookupCep(cep)) || { street: "", district: "", city: "", uf: "" };
  const street = env("ORIGEM_ENDERECO") || a.street;
  originCache = {
    cep, street, city: a.city, uf: a.uf,
    lat: env("ORIGEM_LAT") ? Number(env("ORIGEM_LAT")) : a.lat,
    lng: env("ORIGEM_LNG") ? Number(env("ORIGEM_LNG")) : a.lng,
    full: fullAddress({ ...a, street }, cep),
  };
  return originCache;
}

// ---------------------------------------------------------------- Correios (API oficial, com contrato)
const CORREIOS = "https://api.correios.com.br";
let correiosAuth = { token: "", exp: 0 };

async function correiosToken() {
  if (correiosAuth.token && Date.now() < correiosAuth.exp) return correiosAuth.token;
  const basic = btoa(`${env("CORREIOS_USUARIO")}:${env("CORREIOS_CODIGO_ACESSO")}`);
  const r = await getJson(`${CORREIOS}/token/v1/autentica/cartaopostagem`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ numero: env("CORREIOS_CARTAO") }),
  });
  const exp = Date.parse(r.expiraEm || "");
  correiosAuth = { token: r.token, exp: (Number.isFinite(exp) ? exp : Date.now() + 20 * 60e3) - 60e3 };
  return r.token;
}

const correios = {
  name: "correios",
  enabled: () => !!(env("CORREIOS_USUARIO") && env("CORREIOS_CODIGO_ACESSO") && env("CORREIOS_CARTAO")),
  async quote(ctx) {
    const token = await correiosToken();
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    // "código:nome" separados por vírgula. 03220 = SEDEX e 03298 = PAC (contrato)
    const services = env("CORREIOS_SERVICOS", "03220:SEDEX,03298:PAC").split(",")
      .map((s) => s.split(":").map((x) => x.trim())).filter(([code]) => code);
    const box = ctx.box;
    const out = await Promise.all(services.map(async ([code, label]) => {
      const preco = new URLSearchParams({
        cepOrigem: ctx.origin, cepDestino: ctx.cep, psObjeto: String(Math.round(box.weight * 1000)), tpObjeto: "2",
        comprimento: String(box.length), largura: String(box.width), altura: String(box.height),
      });
      if (env("CORREIOS_CONTRATO")) preco.set("nuContrato", env("CORREIOS_CONTRATO"));
      if (env("CORREIOS_DR")) preco.set("nuDR", env("CORREIOS_DR"));
      const prazo = new URLSearchParams({ cepOrigem: ctx.origin, cepDestino: ctx.cep });
      const [p, z] = await Promise.all([
        getJson(`${CORREIOS}/preco/v1/nacional/${code}?${preco}`, { headers }),
        getJson(`${CORREIOS}/prazo/v1/nacional/${code}?${prazo}`, { headers }).catch(() => ({})),
      ]);
      const price = toNumber(p.pcFinal);
      if (!(price > 0)) return null;
      return { id: `correios-${code}`, provider: "correios", carrier: "Correios", service: label || code, price: round2(price), days: Number(z.prazoEntrega) || null };
    }));
    return out.filter(Boolean);
  },
};

// ---------------------------------------------------------------- Melhor Envio (agregador)
const melhorEnvio = {
  name: "melhorenvio",
  enabled: () => !!env("MELHOR_ENVIO_TOKEN"),
  async quote(ctx) {
    const base = isTrue(env("MELHOR_ENVIO_SANDBOX")) ? "https://sandbox.melhorenvio.com.br" : "https://melhorenvio.com.br";
    const list = await getJson(`${base}/api/v2/me/shipment/calculate`, {
      method: "POST",
      headers: {
        Accept: "application/json", "Content-Type": "application/json",
        Authorization: `Bearer ${env("MELHOR_ENVIO_TOKEN")}`, "User-Agent": userAgent(),
      },
      body: JSON.stringify({
        from: { postal_code: ctx.origin },
        to: { postal_code: ctx.cep },
        products: ctx.products.map((p) => ({
          id: p.id, width: p.width, height: p.height, length: p.length, weight: p.weight,
          insurance_value: round2(p.unit), quantity: p.qty,
        })),
        options: { receipt: false, own_hand: false },
      }),
    });
    return (Array.isArray(list) ? list : [])
      .filter((s) => !s.error && toNumber(s.custom_price ?? s.price) > 0)
      .map((s) => ({
        id: `me-${s.id}`, provider: "melhorenvio",
        carrier: s.company?.name || "Transportadora", service: s.name || "",
        price: round2(toNumber(s.custom_price ?? s.price)),
        days: Number(s.custom_delivery_time ?? s.delivery_time) || null,
      }));
  },
};

// ---------------------------------------------------------------- Uber Direct (entrega no mesmo dia)
let uberAuth = { token: "", exp: 0 };

async function uberToken() {
  if (uberAuth.token && Date.now() < uberAuth.exp) return uberAuth.token;
  const r = await getJson("https://auth.uber.com/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("UBER_CLIENT_ID"), client_secret: env("UBER_CLIENT_SECRET"),
      grant_type: "client_credentials", scope: "eats.deliveries",
    }).toString(),
  });
  uberAuth = { token: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 - 60e3 };
  return r.access_token;
}

const uberDirect = {
  name: "uber",
  enabled: () => !!(env("UBER_CLIENT_ID") && env("UBER_CLIENT_SECRET") && env("UBER_CUSTOMER_ID")),
  async quote(ctx) {
    const [o, dest, token] = await Promise.all([originInfo(), destCoords(ctx), uberToken()]);
    const addr = (street, city, uf, cep) =>
      JSON.stringify({ street_address: [street || city], city, state: uf, zip_code: fmtCep(cep), country: "BR" });
    const a = ctx.address;
    const body = {
      pickup_address: addr(o.street, o.city, o.uf, o.cep),
      dropoff_address: addr(a.street, a.city, a.uf, ctx.cep),
      manifest_total_value: Math.round(ctx.value * 100),
    };
    if (o.lat != null && o.lng != null) Object.assign(body, { pickup_latitude: o.lat, pickup_longitude: o.lng });
    if (dest) Object.assign(body, { dropoff_latitude: dest.lat, dropoff_longitude: dest.lng });
    const q = await getJson(`https://api.uber.com/v1/customers/${encodeURIComponent(env("UBER_CUSTOMER_ID"))}/delivery_quotes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const price = Number(q.fee) / 100; // a Uber devolve em centavos
    if (!(price > 0)) return [];
    return [{ id: `uber-${q.id}`, provider: "uber", carrier: "Uber", service: "Entrega rápida", price: round2(price), minutes: Number(q.duration) || null, sameDay: true }];
  },
};

// ---------------------------------------------------------------- Lalamove (entrega no mesmo dia)
const lalamove = {
  name: "lalamove",
  enabled: () => !!(env("LALAMOVE_KEY") && env("LALAMOVE_SECRET")),
  async quote(ctx) {
    const [o, dest] = await Promise.all([originInfo(), destCoords(ctx)]);
    if (o.lat == null || o.lng == null) throw new Error("ORIGEM_LAT/ORIGEM_LNG não configurados");
    if (!dest) throw new Error("sem coordenadas para o CEP de destino");
    const base = isTrue(env("LALAMOVE_SANDBOX")) ? "https://rest.sandbox.lalamove.com" : "https://rest.lalamove.com";
    const path = "/v3/quotations";
    const body = JSON.stringify({
      data: {
        serviceType: env("LALAMOVE_SERVICE", "LALAGO"),
        language: "pt_BR",
        stops: [
          { coordinates: { lat: String(o.lat), lng: String(o.lng) }, address: o.full },
          { coordinates: { lat: String(dest.lat), lng: String(dest.lng) }, address: fullAddress(ctx.address, ctx.cep) },
        ],
      },
    });
    const time = String(Date.now());
    const signature = await hmacHex(env("LALAMOVE_SECRET"), `${time}\r\nPOST\r\n${path}\r\n\r\n${body}`);
    const r = await getJson(base + path, {
      method: "POST",
      headers: {
        Authorization: `hmac ${env("LALAMOVE_KEY")}:${time}:${signature}`,
        Market: env("LALAMOVE_MARKET", "BR"),
        "Content-Type": "application/json",
        "Request-ID": crypto.randomUUID(),
      },
      body,
    });
    const d = r?.data || {};
    const price = toNumber(d.priceBreakdown?.total);
    if (!(price > 0)) return [];
    return [{ id: `lalamove-${d.quotationId}`, provider: "lalamove", carrier: "Lalamove", service: "Moto", price: round2(price), sameDay: true }];
  },
};

const PROVIDERS = [correios, melhorEnvio, uberDirect, lalamove];

// ---------------------------------------------------------------- HTTP
function corsHeaders(req) {
  const allowed = env("ALLOWED_ORIGINS").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": !allowed.length ? "*" : (allowed.includes(origin) ? origin : allowed[0]),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

const json = (data, status, headers) =>
  new Response(JSON.stringify(data), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });

export async function handler(req) {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405, cors);

  let input;
  try { input = await req.json(); } catch { return json({ error: "Pedido inválido" }, 400, cors); }

  const cep = digits(input?.cep);
  if (cep.length !== 8) return json({ error: "CEP inválido" }, 400, cors);
  const qty = parseItems(input?.items);
  if (!qty) return json({ error: "Itens inválidos" }, 400, cors);

  const origin = digits(env("ORIGEM_CEP"));
  const providers = PROVIDERS.filter((p) => p.enabled());
  if (origin.length !== 8 || !providers.length) {
    console.error("frete: configure ORIGEM_CEP e pelo menos um provedor");
    return json({ error: "Frete indisponível no momento" }, 503, cors);
  }

  let products, address;
  try {
    [products, address] = await Promise.all([loadProducts(qty), lookupCep(cep)]);
  } catch (err) {
    console.error("frete: falha ao ler produtos", err);
    return json({ error: "Frete indisponível no momento" }, 503, cors);
  }
  if (!address) return json({ error: "CEP não encontrado" }, 404, cors);
  if (!products.length) return json({ error: "Itens inválidos" }, 400, cors);

  const ctx = {
    cep, origin, address, products,
    box: pack(products),
    value: round2(products.reduce((s, p) => s + p.unit * p.qty, 0)),
  };

  const results = await Promise.allSettled(providers.map((p) => p.quote(ctx)));
  let options = [];
  const unavailable = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") options.push(...r.value);
    else { unavailable.push(providers[i].name); console.error(`frete: ${providers[i].name}`, String(r.reason)); }
  });

  // Com contrato dos Correios ativo, não repete os Correios vindos do Melhor Envio
  if (options.some((o) => o.provider === "correios")) {
    options = options.filter((o) => !(o.provider === "melhorenvio" && /correios/i.test(o.carrier)));
  }
  options.sort((a, b) => a.price - b.price);

  const publicAddress = { street: address.street, district: address.district, city: address.city, uf: address.uf };
  const quoteId = options.length ? await saveQuote(cep, publicAddress, qty, options) : null;

  return json({ cep, address: publicAddress, options, unavailable, quote_id: quoteId }, 200, cors);
}

// A cotação fica salva para a função "pagamento" cobrar exatamente este frete
export const itemsKey = (qty) => [...qty.entries()].map(([id, q]) => `${id}:${q}`).sort().join(",");

function serviceHeaders() {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  return key.startsWith("sb_") ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` };
}

async function saveQuote(cep, address, qty, options) {
  if (!env("SUPABASE_SERVICE_ROLE_KEY")) return null;
  try {
    const rows = await getJson(`${env("SUPABASE_URL")}/rest/v1/shipping_quotes`, {
      method: "POST",
      headers: { ...serviceHeaders(), "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ cep, address, items_key: itemsKey(qty), options }),
    });
    return rows?.[0]?.id ?? null;
  } catch (err) {
    console.error("frete: falha ao salvar a cotação", String(err));
    return null;
  }
}

globalThis.Deno?.serve(handler);
