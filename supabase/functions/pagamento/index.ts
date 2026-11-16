// =====================================================================
//  Edge Function "pagamento": pedidos com Pix e cartão (Mercado Pago)
// ---------------------------------------------------------------------
//  POST /pagamento   { action: "order" }   cria o pedido (e o Pix, se for Pix)
//                    { action: "card" }    paga o pedido com o cartão tokenizado
//                    { action: "status" }  o site consulta se já foi pago
//  POST /pagamento/webhook                 aviso do Mercado Pago
//
//  O preço dos produtos vem do banco e o frete vem da cotação salva pela
//  função "frete". O navegador nunca define quanto será cobrado.
//  Os dados do cartão ficam no Mercado Pago: aqui só chega um token.
//
//  Secrets:
//    MP_ACCESS_TOKEN    obrigatório (Mercado Pago > Suas integrações > Credenciais)
//    MP_WEBHOOK_SECRET  recomendado (assinatura secreta dos webhooks)
//    PIX_DESCONTO       padrão 0.035; use o mesmo valor de pixDiscount no config.js
//    PIX_EXPIRA_MIN     padrão 30 (minutos para pagar o Pix)
//    APP_NOME           nome da loja na descrição do pagamento
//    MP_FATURA          nome na fatura do cartão (até 13 letras)
//    ALLOWED_ORIGINS    ex.: https://rl-solutions.github.io
//  Automáticos do Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// =====================================================================

const env = (k, d = "") => ((globalThis.Deno?.env.get(k)) ?? d).trim();
const digits = (v) => String(v ?? "").replace(/\D/g, "");
const round2 = (n) => Math.round(n * 100) / 100;
const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v ?? ""));
const TIMEOUT_MS = 15000;
const MP = "https://api.mercadopago.com";

const pixRate = () => {
  const r = Number(env("PIX_DESCONTO", "0.035"));
  return r >= 0 && r < 0.5 ? r : 0;
};
const pixMinutes = () => Math.min(Math.max(Number(env("PIX_EXPIRA_MIN", "30")) || 30, 5), 1440);

// Erro com status HTTP para devolver ao site
const fail = (status, error, extra = {}) => Object.assign(new Error(error), { httpStatus: status, extra });

async function getJson(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`${res.status} em ${new URL(url).host}: ${text.slice(0, 400)}`);
    err.status = res.status;
    throw err;
  }
  return text ? JSON.parse(text) : null;
}

async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------- banco (service role)
function serviceHeaders() {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  return key.startsWith("sb_") ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` };
}

const db = (path, init = {}) => getJson(`${env("SUPABASE_URL")}/rest/v1${path}`, {
  ...init,
  headers: { ...serviceHeaders(), "Content-Type": "application/json", ...(init.headers || {}) },
});

const mp = (path, init = {}) => getJson(`${MP}${path}`, {
  ...init,
  headers: { Authorization: `Bearer ${env("MP_ACCESS_TOKEN")}`, "Content-Type": "application/json", ...(init.headers || {}) },
});

const webhookUrl = () => `${env("SUPABASE_URL")}/functions/v1/pagamento/webhook`;

// Data no formato que o Mercado Pago pede, no horário de Brasília
function mpDate(d) {
  return new Date(d.getTime() - 3 * 3600e3).toISOString().replace("Z", "-03:00");
}

// ---------------------------------------------------------------- validação
function parseItems(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 30) return null;
  const qty = new Map();
  for (const it of raw) {
    const id = String(it?.id ?? "");
    const q = Number(it?.qty);
    if (!/^\d{1,18}$/.test(id) || !Number.isInteger(q) || q < 1 || q > 50) return null;
    qty.set(id, (qty.get(id) || 0) + q);
  }
  return qty;
}

// Mesmo formato usado pela função "frete" ao salvar a cotação
const itemsKey = (qty) => [...qty.entries()].map(([id, q]) => `${id}:${q}`).sort().join(",");

export function validCpf(value) {
  const c = digits(value);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (n) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(c[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}

function parseCustomer(c = {}) {
  const v = {
    name: String(c.name ?? "").trim().replace(/\s+/g, " "),
    email: String(c.email ?? "").trim().toLowerCase(),
    phone: digits(c.phone),
    cpf: digits(c.cpf),
    number: String(c.number ?? "").trim(),
    complement: String(c.complement ?? "").trim(),
  };
  const fields = [];
  if (v.name.length < 5 || v.name.length > 80 || !v.name.includes(" ")) fields.push("name");
  if (v.email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)) fields.push("email");
  if (v.phone.length < 10 || v.phone.length > 13) fields.push("phone");
  if (!validCpf(v.cpf)) fields.push("cpf");
  if (!v.number || v.number.length > 20) fields.push("number");
  if (v.complement.length > 60) fields.push("complement");
  return { fields, value: v };
}

// O que o site pode ver do pedido
function publicOrder(o) {
  return {
    id: o.id, code: o.code, status: o.status, method: o.payment_method,
    subtotal: Number(o.subtotal), discount: Number(o.discount), shipping: Number(o.shipping), total: Number(o.total),
    shipping_option: o.shipping_option, payment_status: o.payment_status, payment_status_detail: o.payment_status_detail,
    pix: o.payment_method === "pix" && o.status === "pending" && o.pix_qr_code
      ? { qr_code: o.pix_qr_code, qr_base64: o.pix_qr_base64, expires_at: o.pix_expires_at }
      : null,
  };
}

async function loadOrderForClient(id, token) {
  if (!isUuid(id) || !isUuid(token)) throw fail(404, "Pedido não encontrado");
  const rows = await db(`/orders?select=*&id=eq.${id}&access_token=eq.${token}`);
  if (!rows?.length) throw fail(404, "Pedido não encontrado");
  return rows[0];
}

// ---------------------------------------------------------------- pedido
async function createOrder(input) {
  const qty = parseItems(input.items);
  if (!qty) throw fail(400, "Itens inválidos");
  const method = input.method;
  if (method !== "pix" && method !== "card") throw fail(400, "Forma de pagamento inválida");

  const { fields, value: cust } = parseCustomer(input.customer);
  if (input.age_confirmed !== true) fields.push("age");
  if (fields.length) throw fail(422, "Confira seus dados", { fields });

  // Produtos: preço e estoque do banco
  const rows = await db(`/products?select=id,name,variant,price,sale_price,stock,active&id=in.(${[...qty.keys()].join(",")})`);
  const items = [];
  const unavailable = [];
  for (const [id, q] of qty) {
    const r = rows.find((x) => String(x.id) === id);
    if (!r || !r.active || Number(r.stock) < q) { unavailable.push(Number(id)); continue; }
    const price = Number(r.price);
    const sale = r.sale_price == null ? null : Number(r.sale_price);
    items.push({ id: Number(r.id), name: r.name, variant: r.variant, qty: q, unit_price: sale != null && sale < price ? sale : price });
  }
  if (unavailable.length) throw fail(409, "O estoque de alguns itens mudou", { code: "stock", items: unavailable });

  // Frete: só vale a cotação salva, para estes itens, nas últimas 2 horas
  if (!isUuid(input.quote_id)) throw fail(409, "Calcule o frete de novo", { code: "quote" });
  const [quote] = await db(`/shipping_quotes?select=*&id=eq.${input.quote_id}`);
  const fresh = quote && Date.now() - Date.parse(quote.created_at) < 2 * 3600e3;
  const ship = fresh && quote.items_key === itemsKey(qty) && (quote.options || []).find((o) => o.id === input.ship_id);
  if (!ship) throw fail(409, "Calcule o frete de novo", { code: "quote" });

  const subtotal = round2(items.reduce((s, i) => s + i.unit_price * i.qty, 0));
  const discount = method === "pix" ? round2(subtotal * pixRate()) : 0;
  const shipping = round2(Number(ship.price));
  const total = round2(subtotal - discount + shipping);

  const [order] = await db("/orders", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      payment_method: method, items, subtotal, discount, shipping, total,
      shipping_option: ship, shipping_cep: quote.cep, shipping_address: quote.address,
      address_number: cust.number, address_complement: cust.complement || null,
      customer_name: cust.name, customer_email: cust.email, customer_phone: cust.phone, customer_cpf: cust.cpf,
      age_confirmed: true,
    }),
  });

  let out = order;
  if (method === "pix") out = { ...order, ...(await createPix(order)) };
  return { order: publicOrder(out), token: order.access_token };
}

async function createPix(order) {
  const [first, ...rest] = order.customer_name.split(" ");
  const expires = new Date(Date.now() + pixMinutes() * 60e3);
  let p;
  try {
    p = await mp("/v1/payments", {
      method: "POST",
      headers: { "X-Idempotency-Key": `pix-${order.id}` },
      body: JSON.stringify({
        transaction_amount: Number(order.total),
        description: `Pedido ${order.code} - ${env("APP_NOME", "Loja")}`,
        payment_method_id: "pix",
        external_reference: order.id,
        notification_url: webhookUrl(),
        date_of_expiration: mpDate(expires),
        payer: {
          email: order.customer_email, first_name: first, last_name: rest.join(" ") || first,
          identification: { type: "CPF", number: order.customer_cpf },
        },
      }),
    });
  } catch (err) {
    console.error("pagamento: falha ao gerar Pix", String(err));
    await db(`/orders?id=eq.${order.id}`, {
      method: "PATCH", body: JSON.stringify({ status: "cancelled", review_reason: "Falha ao gerar o Pix no Mercado Pago" }),
    }).catch(() => {});
    throw fail(502, "Não foi possível gerar o Pix agora. Tente de novo em instantes.");
  }
  const td = p.point_of_interaction?.transaction_data || {};
  const patch = {
    payment_id: String(p.id), payment_status: p.status, payment_status_detail: p.status_detail,
    pix_qr_code: td.qr_code || null, pix_qr_base64: td.qr_code_base64 || null,
    pix_expires_at: p.date_of_expiration || expires.toISOString(),
  };
  await db(`/orders?id=eq.${order.id}`, { method: "PATCH", body: JSON.stringify(patch) });
  return patch;
}

// ---------------------------------------------------------------- cartão
async function payCard(input) {
  const order = await loadOrderForClient(input.id, input.token);
  if (order.payment_method !== "card") throw fail(400, "Este pedido não é no cartão");
  if (order.status !== "pending") throw fail(409, "Este pedido não está aguardando pagamento", { order: publicOrder(order) });

  const c = input.card || {};
  const installments = Number(c.installments);
  if (!c.token || !c.payment_method_id || !Number.isInteger(installments) || installments < 1 || installments > 12) {
    throw fail(400, "Dados do cartão incompletos");
  }
  const ident = c.payer?.identification;
  const body = {
    transaction_amount: Number(order.total),   // sempre o total do pedido, nunca o do navegador
    token: String(c.token),
    installments,
    payment_method_id: String(c.payment_method_id),
    description: `Pedido ${order.code} - ${env("APP_NOME", "Loja")}`,
    external_reference: order.id,
    notification_url: webhookUrl(),
    payer: {
      email: order.customer_email,
      identification: ident?.number
        ? { type: String(ident.type || "CPF"), number: digits(ident.number) }
        : { type: "CPF", number: order.customer_cpf },
    },
  };
  if (c.issuer_id) body.issuer_id = c.issuer_id;
  if (env("MP_FATURA")) body.statement_descriptor = env("MP_FATURA").slice(0, 13);

  let p;
  try {
    p = await mp("/v1/payments", { method: "POST", headers: { "X-Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(body) });
  } catch (err) {
    console.error("pagamento: cartão recusado pela API", String(err));
    if (err.status >= 400 && err.status < 500) {
      throw fail(402, "Pagamento recusado. Confira os dados do cartão.", { detail: "cc_rejected_other_reason" });
    }
    throw fail(502, "Não foi possível falar com o Mercado Pago. Tente de novo.");
  }
  const updated = (await syncPayment(p)) || order;
  return { order: publicOrder(updated), payment: { status: p.status, detail: p.status_detail } };
}

// ---------------------------------------------------------------- status do pagamento
// Aplica no pedido o estado real do pagamento (lido da API do Mercado Pago)
export async function syncPayment(p) {
  const orderId = p?.external_reference;
  if (!isUuid(orderId)) return null;
  const [order] = await db(`/orders?select=*&id=eq.${orderId}`);
  if (!order) return null;

  const pid = String(p.id);
  const patch = {};
  if (p.status === "approved") {
    if (order.status === "paid" && order.payment_id !== pid) {
      Object.assign(patch, { status: "needs_review", review_reason: `Pagamento em dobro: ${order.payment_id} e ${pid}. Estorne um deles.` });
    } else if (order.status === "pending" || order.status === "expired" || order.status === "cancelled") {
      Object.assign(patch, {
        status: "paid", paid_at: p.date_approved || new Date().toISOString(),
        payment_id: pid, payment_status: p.status, payment_status_detail: p.status_detail,
      });
      if (Number(p.transaction_amount) + 0.009 < Number(order.total)) {
        Object.assign(patch, { status: "needs_review", review_reason: `Valor pago (${p.transaction_amount}) menor que o total (${order.total})` });
      } else if (order.status !== "pending") {
        Object.assign(patch, { status: "needs_review", review_reason: `Pago depois de ${order.status === "expired" ? "expirar" : "cancelado"}. Confira o estoque.` });
      }
    }
  } else if (order.status === "pending") {
    Object.assign(patch, { payment_id: pid, payment_status: p.status, payment_status_detail: p.status_detail });
    if (p.status === "cancelled" && order.payment_method === "pix") patch.status = p.status_detail === "expired" ? "expired" : "cancelled";
  } else if ((order.status === "paid" || order.status === "needs_review") && order.payment_id === pid && (p.status === "refunded" || p.status === "charged_back")) {
    Object.assign(patch, { status: "refunded", payment_status: p.status, payment_status_detail: p.status_detail });
  }
  if (!Object.keys(patch).length) return order;

  // Só grava se ninguém mudou o pedido no meio do caminho
  const rows = await db(`/orders?id=eq.${order.id}&status=eq.${order.status}`, {
    method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch),
  });
  let updated = rows?.[0];
  if (!updated) return (await db(`/orders?select=*&id=eq.${order.id}`))[0];

  // Pagou: baixa o estoque (a função do banco ignora se já foi feito)
  if (updated.status === "paid" || (patch.status === "needs_review" && patch.paid_at)) {
    const ok = await db("/rpc/apply_order_stock", { method: "POST", body: JSON.stringify({ p_order: order.id }) });
    if (ok === false && updated.status === "paid") {
      const r = await db(`/orders?id=eq.${order.id}`, {
        method: "PATCH", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ status: "needs_review", review_reason: "Faltou estoque na baixa do pedido pago" }),
      });
      updated = r?.[0] || updated;
    }
  }
  return updated;
}

async function orderStatus(input) {
  let order = await loadOrderForClient(input.id, input.token);
  // Não depende só do webhook: confere direto no Mercado Pago
  if (order.status === "pending" && order.payment_id) {
    try {
      const p = await mp(`/v1/payments/${encodeURIComponent(order.payment_id)}`);
      order = (await syncPayment(p)) || order;
    } catch (err) {
      console.error("pagamento: falha ao consultar o Mercado Pago", String(err));
    }
  }
  return { order: publicOrder(order) };
}

// ---------------------------------------------------------------- webhook
export async function verifySignature(header, requestId, dataId, secret) {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((s) => {
    const i = s.indexOf("=");
    return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
  }));
  if (!parts.ts || !parts.v1) return false;
  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  let manifest = `id:${id};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${parts.ts};`;
  return safeEqual(await hmacHex(secret, manifest), parts.v1.toLowerCase());
}

async function webhook(req, url) {
  const body = await req.json().catch(() => ({}));
  const type = url.searchParams.get("type") || url.searchParams.get("topic") || body.type || body.topic;
  const dataId = String(url.searchParams.get("data.id") || body?.data?.id || "");
  if (type !== "payment" || !/^\d{1,20}$/.test(dataId)) return new Response("ignorado", { status: 200 });

  const secret = env("MP_WEBHOOK_SECRET");
  if (secret && !(await verifySignature(req.headers.get("x-signature"), req.headers.get("x-request-id"), url.searchParams.get("data.id") || dataId, secret))) {
    return new Response("assinatura inválida", { status: 401 });
  }
  const p = await mp(`/v1/payments/${dataId}`);   // a fonte da verdade é a API, não o aviso
  await syncPayment(p);
  return new Response("ok", { status: 200 });
}

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
  const url = new URL(req.url);

  if (url.pathname.endsWith("/webhook")) {
    if (req.method !== "POST") return new Response("use POST", { status: 405 });
    try { return await webhook(req, url); } catch (err) {
      console.error("pagamento: webhook", String(err));
      return new Response("erro", { status: 500 });   // o Mercado Pago tenta de novo
    }
  }

  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405, cors);
  if (!env("MP_ACCESS_TOKEN") || !env("SUPABASE_SERVICE_ROLE_KEY")) {
    console.error("pagamento: configure MP_ACCESS_TOKEN");
    return json({ error: "Pagamento indisponível no momento" }, 503, cors);
  }

  let input;
  try { input = await req.json(); } catch { return json({ error: "Pedido inválido" }, 400, cors); }

  try {
    if (input?.action === "order") return json(await createOrder(input), 200, cors);
    if (input?.action === "card") return json(await payCard(input), 200, cors);
    if (input?.action === "status") return json(await orderStatus(input), 200, cors);
    return json({ error: "Ação inválida" }, 400, cors);
  } catch (err) {
    if (err.httpStatus) return json({ error: err.message, ...err.extra }, err.httpStatus, cors);
    console.error("pagamento:", String(err));
    return json({ error: "Não foi possível processar o pagamento agora" }, 500, cors);
  }
}

globalThis.Deno?.serve(handler);
