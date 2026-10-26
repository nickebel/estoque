const SESSION_SECONDS = 12 * 60 * 60;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_MAX_ATTEMPTS = 8;
const ALLOWED_ORIGINS = new Set([
  "https://nickebel.github.io",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:8000",
  "http://127.0.0.1:8000"
]);
const encoder = new TextEncoder();

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const headers = {
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
  if (ALLOWED_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}
function withCors(response, request) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request))) headers.set(key, value);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {"Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store"}
  });
}
function b64url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function fromB64url(value) {
  let encoded = value.replace(/-/g, "+").replace(/_/g, "/");
  while (encoded.length % 4) encoded += "=";
  const binary = atob(encoded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
async function sign(value, secret) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), {name:"HMAC", hash:"SHA-256"}, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}
async function issueToken(secret) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(encoder.encode(JSON.stringify({alg:"HS256",typ:"JWT"})));
  const payload = b64url(encoder.encode(JSON.stringify({sub:"estoque-equipe",iat:now,exp:now+SESSION_SECONDS})));
  const body = header + "." + payload;
  return body + "." + await sign(body, secret);
}
function constantTimeEqual(a, b) {
  const x = encoder.encode(String(a));
  const y = encoder.encode(String(b));
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
async function authenticated(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const parts = token.split(".");
  if (parts.length !== 3 || !env.SESSION_SECRET) return false;
  const body = parts[0] + "." + parts[1];
  if (!constantTimeEqual(await sign(body, env.SESSION_SECRET), parts[2])) return false;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[1])));
    return payload.sub === "estoque-equipe" && Number(payload.exp) > Math.floor(Date.now()/1000);
  } catch { return false; }
}
async function checkLoginRateLimit(request, env, passwordMatches) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipHash = await sign("estoque-login:" + ip, env.SESSION_SECRET);
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const old = await env.DB.prepare("SELECT failed_count, window_started_at, locked_until FROM login_attempts WHERE ip_hash=?").bind(ipHash).first();

  if (old?.locked_until && Date.parse(old.locked_until) > nowMs) {
    return {allowed:false, ipHash, retryAfter:Math.max(1,Math.ceil((Date.parse(old.locked_until)-nowMs)/1000))};
  }
  if (passwordMatches) {
    await env.DB.prepare("DELETE FROM login_attempts WHERE ip_hash=?").bind(ipHash).run();
    return {allowed:true, ipHash};
  }

  const isCurrentWindow = old && nowMs - Date.parse(old.window_started_at) < LOGIN_WINDOW_SECONDS * 1000;
  const count = isCurrentWindow ? Number(old.failed_count) + 1 : 1;
  const windowStart = isCurrentWindow ? old.window_started_at : now;
  const lockedUntil = count >= LOGIN_MAX_ATTEMPTS ? new Date(nowMs + LOGIN_WINDOW_SECONDS * 1000).toISOString() : null;

  await env.DB.batch([
    env.DB.prepare("INSERT INTO login_attempts (ip_hash,failed_count,window_started_at,locked_until) VALUES (?,?,?,?) ON CONFLICT(ip_hash) DO UPDATE SET failed_count=excluded.failed_count,window_started_at=excluded.window_started_at,locked_until=excluded.locked_until")
      .bind(ipHash,count,windowStart,lockedUntil),
    env.DB.prepare("DELETE FROM login_attempts WHERE window_started_at < ? AND ip_hash <> ?").bind(new Date(nowMs - 24*60*60*1000).toISOString(),ipHash)
  ]);
  return {allowed:false, ipHash, locked:Boolean(lockedUntil), retryAfter:lockedUntil?LOGIN_WINDOW_SECONDS:0};
}

class RequestError extends Error {
  constructor(message, status = 400) { super(message); this.name = "RequestError"; this.status = status; }
}
async function readJson(request) {
  try { return await request.json(); }
  catch { throw new RequestError("Envie um JSON válido."); }
}
function text(value, max = 180) { return String(value ?? "").trim().slice(0, max); }
function amount(value, label = "Quantidade", allowZero = false) {
  const n = Number(value);
  if (!Number.isFinite(n) || (allowZero ? n < 0 : n <= 0) || n > 1000000000) {
    throw new RequestError(label + " inválida.");
  }
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function mapProduct(row) {
  return {id:row.id,name:row.name,category:row.category,unit:row.unit,qty:Number(row.quantity),min:Number(row.min_quantity),notes:row.notes};
}
function mapMovement(row) {
  return {id:row.id,date:row.created_at,productId:row.product_id,name:row.product_name,unit:row.unit,type:row.movement_type,qty:Number(row.quantity),after:Number(row.balance_after),note:row.note};
}
function nowIso() { return new Date().toISOString(); }
function productInput(body) {
  const name = text(body.name, 100), unit = text(body.unit, 25);
  if (!name) throw new RequestError("Informe o nome do produto.");
  if (!unit) throw new RequestError("Informe a unidade de controle.");
  return {
    name, category:text(body.category,60), unit,
    qty:amount(body.qty ?? 0,"Quantidade",true),
    min:amount(body.min ?? 0,"Quantidade mínima",true),
    notes:text(body.notes,180)
  };
}
async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (request.method === "OPTIONS") return new Response(null, {status:204});
  if (path === "/api/health" && request.method === "GET") return json({ok:true,service:"estoque-padaria-api"});
  if (path === "/api/login" && request.method === "POST") {
    if (!env.APP_PASSWORD || !env.SESSION_SECRET) return json({error:"Faltam configurar os segredos APP_PASSWORD e SESSION_SECRET no Cloudflare."},503);
    const body = await readJson(request);
    const rate = await checkLoginRateLimit(request, env, constantTimeEqual(body.password || "", env.APP_PASSWORD));
    if (!rate.allowed) {
      const headers = rate.retryAfter ? {"Retry-After":String(rate.retryAfter)} : {};
      return new Response(JSON.stringify({error:rate.locked ? "Muitas tentativas. Aguarde 15 minutos antes de tentar novamente." : "Senha incorreta."}), {
        status:rate.locked ? 429 : 401,
        headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...headers}
      });
    }
    return json({token:await issueToken(env.SESSION_SECRET),expiresIn:SESSION_SECONDS});
  }
  if (!path.startsWith("/api/")) return json({error:"Rota não encontrada."},404);
  if (!await authenticated(request,env)) return json({error:"Sessão expirada ou acesso não autorizado."},401);

  if (path === "/api/products" && request.method === "GET") {
    const result = await env.DB.prepare("SELECT * FROM products ORDER BY name COLLATE NOCASE").all();
    return json(result.results.map(mapProduct));
  }
  if (path === "/api/products" && request.method === "POST") {
    const body = productInput(await readJson(request));
    const id = crypto.randomUUID(), timestamp = nowIso();
    const statements = [
      env.DB.prepare("INSERT INTO products (id,name,category,unit,quantity,min_quantity,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(id,body.name,body.category,body.unit,body.qty,body.min,body.notes,timestamp,timestamp)
    ];
    if (body.qty > 0) {
      statements.push(env.DB.prepare("INSERT INTO movements (id,product_id,product_name,unit,movement_type,quantity,balance_after,note,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .bind(crypto.randomUUID(),id,body.name,body.unit,"entrada",body.qty,body.qty,"Saldo inicial","equipe",timestamp));
    }
    await env.DB.batch(statements);
    const row = await env.DB.prepare("SELECT * FROM products WHERE id=?").bind(id).first();
    return json(mapProduct(row),201);
  }
  const productMatch = path.match(/^\/api\/products\/([^/]+)$/);
  if (productMatch && request.method === "PUT") {
    const id = decodeURIComponent(productMatch[1]);
    const body = productInput(await readJson(request));
    const old = await env.DB.prepare("SELECT * FROM products WHERE id=?").bind(id).first();
    if (!old) return json({error:"Produto não encontrado."},404);
    const timestamp = nowIso();
    if (body.qty === Number(old.quantity)) {
      const result = await env.DB.prepare("UPDATE products SET name=?,category=?,unit=?,quantity=?,min_quantity=?,notes=?,updated_at=? WHERE id=? AND quantity=?")
        .bind(body.name,body.category,body.unit,body.qty,body.min,body.notes,timestamp,id,Number(old.quantity)).run();
      if (!result.meta.changes) return json({error:"O estoque mudou em outro aparelho. Atualize a tela e tente novamente."},409);
    } else {
      const type = body.qty > Number(old.quantity) ? "entrada" : "saida";
      const movementQty = Math.abs(body.qty-Number(old.quantity));
      const results = await env.DB.batch([
        env.DB.prepare("UPDATE products SET name=?,category=?,unit=?,quantity=?,min_quantity=?,notes=?,updated_at=? WHERE id=? AND quantity=?")
          .bind(body.name,body.category,body.unit,body.qty,body.min,body.notes,timestamp,id,Number(old.quantity)),
        env.DB.prepare("INSERT INTO movements (id,product_id,product_name,unit,movement_type,quantity,balance_after,note,created_by,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE changes()=1")
          .bind(crypto.randomUUID(),id,body.name,body.unit,type,movementQty,body.qty,"Ajuste feito no cadastro","equipe",timestamp)
      ]);
      if (!results[0].meta.changes) return json({error:"O estoque mudou em outro aparelho. Atualize a tela e tente novamente."},409);
    }
    const row = await env.DB.prepare("SELECT * FROM products WHERE id=?").bind(id).first();
    return json(mapProduct(row));
  }
  if (productMatch && request.method === "DELETE") {
    const id = decodeURIComponent(productMatch[1]);
    const result = await env.DB.prepare("DELETE FROM products WHERE id=?").bind(id).run();
    if (!result.meta.changes) return json({error:"Produto não encontrado."},404);
    return json({ok:true});
  }
  if (path === "/api/movements" && request.method === "GET") {
    const limit = url.searchParams.get("all") === "1" ? 5000 : 100;
    const result = await env.DB.prepare("SELECT * FROM movements ORDER BY created_at DESC LIMIT ?").bind(limit).all();
    return json(result.results.map(mapMovement));
  }
  if (path === "/api/backup" && request.method === "GET") {
    const [productRows, movementRows] = await Promise.all([
      env.DB.prepare("SELECT * FROM products ORDER BY name COLLATE NOCASE").all(),
      env.DB.prepare("SELECT * FROM movements ORDER BY created_at DESC LIMIT 5000").all()
    ]);
    const moves = movementRows.results.map(mapMovement);
    return json({
      products: productRows.results.map(mapProduct),
      moves,
      exportedAt: nowIso(),
      movementLimit: 5000,
      movementsTruncated: moves.length >= 5000
    });
  }
  if (path === "/api/movements" && request.method === "POST") {
    const body = await readJson(request);
    const productId = text(body.productId,80);
    const type = body.type === "entrada" || body.type === "saida" ? body.type : "";
    const quantity = amount(body.qty,"Quantidade");
    if (!productId || !type) return json({error:"Informe produto e tipo de movimentação."},400);
    const old = await env.DB.prepare("SELECT * FROM products WHERE id=?").bind(productId).first();
    if (!old) return json({error:"Produto não encontrado."},404);
    const oldQty = Number(old.quantity);
    const nextQty = Math.round((oldQty + (type === "entrada" ? quantity : -quantity) + Number.EPSILON)*100)/100;
    if (nextQty < 0) return json({error:"A saída é maior que o saldo disponível ("+oldQty+" "+old.unit+")."},400);
    const timestamp = nowIso(), movementId = crypto.randomUUID();
    const updateSql = type === "entrada"
      ? "UPDATE products SET quantity=quantity+?,updated_at=? WHERE id=? AND quantity=?"
      : "UPDATE products SET quantity=quantity-?,updated_at=? WHERE id=? AND quantity=? AND quantity>=?";
    const update = type === "entrada"
      ? env.DB.prepare(updateSql).bind(quantity,timestamp,productId,oldQty)
      : env.DB.prepare(updateSql).bind(quantity,timestamp,productId,oldQty,quantity);
    const insert = env.DB.prepare("INSERT INTO movements (id,product_id,product_name,unit,movement_type,quantity,balance_after,note,created_by,created_at) SELECT ?,id,name,unit,?,?,?,?,'equipe',? FROM products WHERE id=? AND quantity=? AND changes()=1")
      .bind(movementId,type,quantity,nextQty,text(body.note),timestamp,productId,nextQty);
    const results = await env.DB.batch([update,insert]);
    if (!results[0].meta.changes) return json({error:"O estoque foi alterado em outro aparelho. Atualize e tente novamente."},409);
    const row = await env.DB.prepare("SELECT * FROM movements WHERE id=?").bind(movementId).first();
    if (!row) return json({error:"Saldo atualizado, mas não foi possível confirmar o histórico. Atualize o estoque."},500);
    return json(mapMovement(row),201);
  }
  return json({error:"Rota não encontrada."},404);
}
export default {
  async fetch(request, env) {
    try {
      return withCors(await route(request,env),request);
    } catch (error) {
      const status = error instanceof RequestError ? error.status : 500;
      const message = status === 500 ? "Erro interno do servidor. Confira a configuração da API e do banco." : error.message;
      return withCors(json({error:message},status),request);
    }
  }
};
