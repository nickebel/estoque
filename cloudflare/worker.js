// Estoque API: runtime secrets are bound to the Production Worker in Cloudflare Settings > Variables and Secrets.
const SESSION_SECONDS = 12 * 60 * 60;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_MAX_ATTEMPTS = 8;
const MAX_JSON_BODY_BYTES = 16 * 1024;
const PASSWORD_HASH_ITERATIONS = 310000;
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
  headers.set("X-Permitted-Cross-Domain-Policies", "none");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
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
async function issueToken(secret, user = null) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(encoder.encode(JSON.stringify({alg:"HS256",typ:"JWT"})));
  const payloadData = user
    ? {sub:user.id,username:user.username,displayName:user.displayName,role:user.role,sv:Number(user.sessionVersion||1),iat:now,exp:now+SESSION_SECONDS}
    : {sub:"estoque-equipe",username:"equipe",displayName:"Equipe",role:"admin",iat:now,exp:now+SESSION_SECONDS};
  const payload = b64url(encoder.encode(JSON.stringify(payloadData)));
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
async function usersTableExists(env) {
  const row = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").first();
  return Boolean(row);
}
async function countUsers(env) {
  if (!await usersTableExists(env)) return 0;
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM users").first();
  return Number(row?.count || 0);
}
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {name:"PBKDF2",salt,iterations:PASSWORD_HASH_ITERATIONS,hash:"SHA-256"},
    key,256
  );
  return b64url(new Uint8Array(bits));
}
function decodeUserSalt(value) {
  return fromB64url(value);
}
async function createPasswordRecord(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return {passwordSalt:b64url(salt),passwordHash:await passwordHash(password,salt)};
}
async function verifyPassword(password, salt, expectedHash) {
  const actualHash = await passwordHash(password,decodeUserSalt(salt));
  return constantTimeEqual(actualHash,expectedHash);
}
function usernameValue(value) {
  const username = text(value,40).toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
    throw new RequestError("O usuário deve ter de 3 a 40 caracteres: letras sem acento, números, ponto, hífen ou sublinhado.");
  }
  return username;
}
function validateUserPassword(value) {
  if (typeof value !== "string" || value.length < 12 || value.length > 128) {
    throw new RequestError("A senha individual deve ter entre 12 e 128 caracteres.");
  }
  return value;
}
async function authenticated(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const parts = token.split(".");
  if (parts.length !== 3 || !env.SESSION_SECRET) return null;
  const body = parts[0] + "." + parts[1];
  if (!constantTimeEqual(await sign(body, env.SESSION_SECRET), parts[2])) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[1])));
    if (Number(payload.exp) <= Math.floor(Date.now()/1000)) return null;

    const tableExists = await usersTableExists(env);
    const userCount = tableExists ? await countUsers(env) : 0;
    if (payload.sub === "estoque-equipe") {
      // As soon as the account table exists, only individual accounts may use the API.
      if (tableExists || userCount > 0) return null;
      return {...payload,username:"equipe",displayName:"Equipe",role:"admin",legacy:true};
    }
    if (!tableExists) return null;
    const user = await env.DB.prepare("SELECT id,username,display_name,role,active,session_version FROM users WHERE id=?").bind(payload.sub).first();
    if (!user || Number(user.active) !== 1 || Number(payload.sv||1)!==Number(user.session_version||1)) return null;
    return {
      sub:user.id,username:user.username,displayName:user.display_name,role:user.role,
      iat:payload.iat,exp:payload.exp,sv:Number(user.session_version||1),legacy:false
    };
  } catch { return null; }
}
async function loginLockStatus(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipHash = await sign("estoque-login:" + ip, env.SESSION_SECRET);
  const old = await env.DB.prepare("SELECT locked_until FROM login_attempts WHERE ip_hash=?").bind(ipHash).first();
  if (old?.locked_until && Date.parse(old.locked_until) > Date.now()) {
    return {locked:true,retryAfter:Math.max(1,Math.ceil((Date.parse(old.locked_until)-Date.now())/1000))};
  }
  return {locked:false,retryAfter:0};
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
  const contentType = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new RequestError("O tipo de conteúdo deve ser application/json.", 415);
  }

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BODY_BYTES) {
    throw new RequestError("A requisição excede o limite permitido de 16 KB.", 413);
  }

  const reader = request.body?.getReader();
  if (!reader) throw new RequestError("Envie um JSON válido.");
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_JSON_BODY_BYTES) {
        await reader.cancel();
        throw new RequestError("A requisição excede o limite permitido de 16 KB.", 413);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError("Não foi possível ler o corpo da requisição.");
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", {fatal:true}).decode(body));
  } catch {
    throw new RequestError("Envie um JSON válido.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RequestError("O corpo da requisição deve ser um objeto JSON.");
  }
  return parsed;
}
function text(value, max = 180) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new RequestError("Um campo de texto tem formato inválido.");
  return value.trim().slice(0, max);
}
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

async function auditTableExists(env) {
  const row = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_events'").first();
  return Boolean(row);
}
function auditEntryStatement(env, entry) {
  return env.DB.prepare("INSERT INTO audit_events (id,action,product_id,product_name,actor,details_json,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()=1")
    .bind(
      crypto.randomUUID(),
      entry.action,
      entry.productId || null,
      text(entry.productName,100) || "Produto",
      text(entry.actor,40) || "equipe",
      JSON.stringify(entry.details || {}),
      entry.createdAt || nowIso()
    );
}
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
  if (path === "/api/health" && request.method === "GET") {
    return json({ok:true,service:"estoque-padaria-api"});
  }
  if (path === "/api/auth/status" && request.method === "GET") {
    const enabled = await usersTableExists(env);
    if (!enabled) return json({accountsEnabled:false,setupRequired:false});
    const totalUsers = await countUsers(env);
    const admins = Number((await env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE active=1 AND role='admin'").first())?.count || 0);
    return json({accountsEnabled:true,setupRequired:totalUsers===0||admins===0});
  }
  if (path === "/api/users/bootstrap" && request.method === "POST") {
    if (!env.APP_PASSWORD || !env.SESSION_SECRET) return json({error:"A configuração do acesso administrativo está incompleta."},503);
    if (!await usersTableExists(env)) {
      return json({error:"A tabela de usuários ainda não foi criada. Execute a migração 0003 no D1."},503);
    }
    const body = await readJson(request);
    if (typeof body.currentPassword !== "string" || !body.currentPassword) {
      throw new RequestError("Informe a senha atual da equipe.",400);
    }
    const correct = constantTimeEqual(body.currentPassword,env.APP_PASSWORD);
    const rate = await checkLoginRateLimit(request,env,correct);
    if (!rate.allowed) {
      return new Response(JSON.stringify({error:rate.locked?"Muitas tentativas. Aguarde 15 minutos antes de tentar novamente.":"A senha atual da equipe está incorreta."}),{
        status:rate.locked?429:401,
        headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...(rate.retryAfter?{"Retry-After":String(rate.retryAfter)}:{})}
      });
    }
    const totalUsers = await countUsers(env);
    const activeAdmins = Number((await env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE active=1 AND role='admin'").first())?.count || 0);
    if (totalUsers>0 && activeAdmins>0) return json({error:"A configuração inicial já foi concluída."},409);
    const username = usernameValue(body.username);
    const displayName = text(body.displayName,80);
    if (!displayName) throw new RequestError("Informe o nome do administrador.",400);
    const password = validateUserPassword(body.password);
    const record = await createPasswordRecord(password);
    const timestamp = nowIso();
    const inserted = await env.DB.prepare("INSERT INTO users (id,username,display_name,password_salt,password_hash,role,active,session_version,created_at,updated_at,last_login_at) SELECT ?,?,?,?,?, 'admin',1,1,?,?,NULL WHERE NOT EXISTS (SELECT 1 FROM users WHERE active=1 AND role='admin')")
      .bind(crypto.randomUUID(),username,displayName,record.passwordSalt,record.passwordHash,timestamp,timestamp).run();
    if (!inserted.meta.changes) return json({error:"Um administrador já foi configurado. Atualize a página e entre com sua conta."},409);
    return json({ok:true});
  }
  if (path === "/api/login" && request.method === "POST") {
    if (!env.APP_PASSWORD || !env.SESSION_SECRET) return json({error:"A configuração do acesso está incompleta."},503);
    const body = await readJson(request);
    if (typeof body.password !== "string" || body.password.length === 0 || body.password.length > 128) {
      throw new RequestError("Informe uma senha válida de até 128 caracteres.",400);
    }
    const accountTablePresent = await usersTableExists(env);
    const usersEnabled = accountTablePresent && await countUsers(env)>0;
    if (accountTablePresent && !usersEnabled) {
      return json({error:"Configure o primeiro administrador pelo formulário de configuração inicial."},403);
    }
    if (usersEnabled) {
      if (typeof body.username !== "string" || !body.username.trim()) {
        return json({error:"Informe seu usuário e sua senha individual."},400);
      }
      const username = usernameValue(body.username);
      const lock = await loginLockStatus(request,env);
      if (lock.locked) return new Response(JSON.stringify({error:"Muitas tentativas. Aguarde antes de tentar novamente."}),{status:429,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Retry-After":String(lock.retryAfter)}});
      const user = await env.DB.prepare("SELECT id,username,display_name,password_salt,password_hash,role,active,session_version FROM users WHERE username=? COLLATE NOCASE").bind(username).first();
      let passwordMatches = false;
      if (user && Number(user.active)===1) {
        passwordMatches = await verifyPassword(body.password,user.password_salt,user.password_hash);
      } else {
        // Reduce timing differences between unknown, inactive, and active usernames.
        await passwordHash(body.password,new Uint8Array(16).fill(0x42));
      }
      const rate = await checkLoginRateLimit(request,env,passwordMatches);
      if (!rate.allowed) {
        return new Response(JSON.stringify({error:rate.locked?"Muitas tentativas. Aguarde 15 minutos antes de tentar novamente.":"Usuário ou senha incorretos."}),{
          status:rate.locked?429:401,
          headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...(rate.retryAfter?{"Retry-After":String(rate.retryAfter)}:{})}
        });
      }
      const timestamp = nowIso();
      await env.DB.prepare("UPDATE users SET last_login_at=?,updated_at=updated_at WHERE id=?").bind(timestamp,user.id).run();
      return json({
        token:await issueToken(env.SESSION_SECRET,{id:user.id,username:user.username,displayName:user.display_name,role:user.role,sessionVersion:Number(user.session_version||1)}),
        expiresIn:SESSION_SECONDS,
        user:{id:user.id,username:user.username,displayName:user.display_name,role:user.role}
      });
    }
    const rate = await checkLoginRateLimit(request,env,constantTimeEqual(body.password,env.APP_PASSWORD));
    if (!rate.allowed) {
      const headers = rate.retryAfter ? {"Retry-After":String(rate.retryAfter)} : {};
      return new Response(JSON.stringify({error:rate.locked ? "Muitas tentativas. Aguarde 15 minutos antes de tentar novamente." : "Senha incorreta."}), {
        status:rate.locked ? 429 : 401,
        headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...headers}
      });
    }
    return json({token:await issueToken(env.SESSION_SECRET),expiresIn:SESSION_SECONDS,user:{id:"legacy",username:"equipe",displayName:"Equipe",role:"admin"}});
  }
  if (!path.startsWith("/api/")) return json({error:"Rota não encontrada."},404);
  const session = await authenticated(request,env);
  if (!session) return json({error:"Sessão expirada ou acesso não autorizado."},401);
  const role = session.role || "admin";
  const canWrite = ["admin","manager","operator"].includes(role);
  const canManageReports = ["admin","manager"].includes(role);
  const isAdmin = role === "admin";
  if (path === "/api/me" && request.method === "GET") {
    return json({user:{id:session.sub,username:session.username,displayName:session.displayName,role:role,legacy:Boolean(session.legacy)}});
  }
  if (path === "/api/users" && request.method === "GET") {
    if (!isAdmin) return json({error:"Somente administradores podem gerenciar acessos."},403);
    if (!await usersTableExists(env)) return json({error:"Execute a migração 0003 para ativar usuários individuais."},503);
    const result = await env.DB.prepare("SELECT id,username,display_name,role,active,created_at,updated_at,last_login_at FROM users ORDER BY username COLLATE NOCASE").all();
    return json(result.results.map(row=>({id:row.id,username:row.username,displayName:row.display_name,role:row.role,active:Number(row.active)===1,createdAt:row.created_at,updatedAt:row.updated_at,lastLoginAt:row.last_login_at})));
  }
  if (path === "/api/users" && request.method === "POST") {
    if (!isAdmin) return json({error:"Somente administradores podem criar acessos."},403);
    if (!await usersTableExists(env)) return json({error:"Execute a migração 0003 para ativar usuários individuais."},503);
    const body = await readJson(request);
    const username = usernameValue(body.username);
    const displayName = text(body.displayName,80);
    if (!displayName) throw new RequestError("Informe o nome do funcionário.",400);
    const password = validateUserPassword(body.password);
    const roles = ["admin","manager","operator","viewer"];
    if (!roles.includes(body.role)) throw new RequestError("Perfil de acesso inválido.",400);
    const requestedRole = body.role;
    const existing = await env.DB.prepare("SELECT id FROM users WHERE username=? COLLATE NOCASE").bind(username).first();
    if (existing) return json({error:"Esse nome de usuário já está cadastrado."},409);
    const record = await createPasswordRecord(password);
    const timestamp = nowIso();
    const id=crypto.randomUUID();
    try {
      await env.DB.prepare("INSERT INTO users (id,username,display_name,password_salt,password_hash,role,active,session_version,created_at,updated_at,last_login_at) VALUES (?,?,?,?,?,?,1,1,?,?,NULL)")
        .bind(id,username,displayName,record.passwordSalt,record.passwordHash,requestedRole,timestamp,timestamp).run();
    } catch {
      return json({error:"Não foi possível criar o usuário. Confira se o nome já está em uso."},409);
    }
    return json({id,username,displayName,role:requestedRole,active:true,createdAt:timestamp},201);
  }
  const userMatch = path.match(/^\/api\/users\/([^/]+)$/);
  if (userMatch && request.method === "PUT") {
    if (!isAdmin) return json({error:"Somente administradores podem alterar acessos."},403);
    if (!await usersTableExists(env)) return json({error:"Execute a migração 0003 para ativar usuários individuais."},503);
    const id=decodeURIComponent(userMatch[1]);
    const body=await readJson(request);
    const existing=await env.DB.prepare("SELECT id,username,display_name,role,active FROM users WHERE id=?").bind(id).first();
    if (!existing) return json({error:"Usuário não encontrado."},404);
    const displayName=body.displayName===undefined?existing.display_name:text(body.displayName,80);
    if (!displayName) throw new RequestError("Informe o nome do funcionário.",400);
    const roles=["admin","manager","operator","viewer"];
    const nextRole=body.role===undefined?existing.role:body.role;
    if (!roles.includes(nextRole)) throw new RequestError("Perfil de acesso inválido.",400);
    if (body.active!==undefined && typeof body.active!=="boolean") throw new RequestError("Status de usuário inválido.",400);
    const active=body.active===undefined?Number(existing.active)===1:body.active;
    if (id===session.sub && (!active || nextRole!=="admin")) return json({error:"Não é possível desativar ou rebaixar o administrador conectado."},400);
    const losesAdmin=Number(existing.active)===1 && existing.role==="admin" && (!active || nextRole!=="admin");
    if (losesAdmin) {
      const adminCount=Number((await env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE active=1 AND role='admin'").first())?.count||0);
      if (adminCount<=1) return json({error:"Mantenha pelo menos um administrador ativo."},400);
    }
    let record=null;
    if (body.password!==undefined && body.password!=="") record=await createPasswordRecord(validateUserPassword(body.password));
    const timestamp=nowIso();
    await env.DB.prepare("UPDATE users SET display_name=?,role=?,active=?,password_salt=COALESCE(?,password_salt),password_hash=COALESCE(?,password_hash),session_version=session_version+?,updated_at=? WHERE id=?")
      .bind(displayName,nextRole,active?1:0,record?.passwordSalt||null,record?.passwordHash||null,((record||nextRole!==existing.role||active!==(Number(existing.active)===1))?1:0),timestamp,id).run();
    return json({id,username:existing.username,displayName,role:nextRole,active,updatedAt:timestamp});
  }


  if (path === "/api/audit" && request.method === "GET") {
    if (!canManageReports) return json({error:"Seu perfil não permite consultar a auditoria."},403);
    if (!await auditTableExists(env)) {
      return json({enabled:false,events:[],message:"A trilha de auditoria ainda precisa ser ativada no banco."});
    }
    const rawLimit = Number(url.searchParams.get("limit") || 100);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit,200) : 100;
    const result = await env.DB.prepare("SELECT id,action,product_id,product_name,actor,details_json,created_at FROM audit_events ORDER BY created_at DESC LIMIT ?")
      .bind(limit).all();
    const events = result.results.map(row => {
      let details = {};
      try { details = JSON.parse(row.details_json || "{}"); } catch {}
      return {
        id:row.id,action:row.action,productId:row.product_id,productName:row.product_name,
        actor:row.actor,details,createdAt:row.created_at
      };
    });
    return json({enabled:true,events});
  }

  if (path === "/api/products" && request.method === "GET") {
    const result = await env.DB.prepare("SELECT * FROM products ORDER BY name COLLATE NOCASE").all();
    return json(result.results.map(mapProduct));
  }
  if (path === "/api/products" && request.method === "POST") {
    if (!canWrite) return json({error:"Seu perfil não permite cadastrar produtos."},403);
    const body = productInput(await readJson(request));
    const id = crypto.randomUUID(), timestamp = nowIso();
    const statements = [
      env.DB.prepare("INSERT INTO products (id,name,category,unit,quantity,min_quantity,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(id,body.name,body.category,body.unit,body.qty,body.min,body.notes,timestamp,timestamp)
    ];
    if (body.qty > 0) {
      statements.push(env.DB.prepare("INSERT INTO movements (id,product_id,product_name,unit,movement_type,quantity,balance_after,note,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .bind(crypto.randomUUID(),id,body.name,body.unit,"entrada",body.qty,body.qty,"Saldo inicial",session.username,timestamp));
    }
    if (await auditTableExists(env)) {
      statements.push(auditEntryStatement(env,{
        action:"product_created",productId:id,productName:body.name,
        details:{category:body.category,unit:body.unit,initialQuantity:body.qty},
        createdAt:timestamp,actor:session.username
      }));
    }
    await env.DB.batch(statements);
    const row = await env.DB.prepare("SELECT * FROM products WHERE id=?").bind(id).first();
    return json(mapProduct(row),201);
  }
  const productMatch = path.match(/^\/api\/products\/([^/]+)$/);
  if (productMatch && request.method === "PUT") {
    if (!canWrite) return json({error:"Seu perfil não permite alterar produtos."},403);
    const id = decodeURIComponent(productMatch[1]);
    const requestBody = await readJson(request);
    const body = productInput(requestBody);
    const old = await env.DB.prepare("SELECT * FROM products WHERE id=?").bind(id).first();
    if (!old) return json({error:"Produto não encontrado."},404);
    const adjustmentNote = text(requestBody.adjustmentNote,180);
    const quantityChanged = body.qty !== Number(old.quantity);
    if (quantityChanged && !adjustmentNote) {
      throw new RequestError("Informe o motivo do ajuste de estoque.",400);
    }
    const timestamp = nowIso();
    const auditEnabled = await auditTableExists(env);
    const before = {
      name:old.name,category:old.category,unit:old.unit,
      min:Number(old.min_quantity),notes:old.notes
    };
    const after = {
      name:body.name,category:body.category,unit:body.unit,
      min:body.min,notes:body.notes
    };
    const fieldsChanged = Object.keys(before).filter(key => before[key] !== after[key]);

    if (!quantityChanged) {
      const statements = [
        env.DB.prepare("UPDATE products SET name=?,category=?,unit=?,quantity=?,min_quantity=?,notes=?,updated_at=? WHERE id=? AND quantity=?")
          .bind(body.name,body.category,body.unit,body.qty,body.min,body.notes,timestamp,id,Number(old.quantity))
      ];
      if (auditEnabled && fieldsChanged.length) {
        statements.push(auditEntryStatement(env,{
          action:"product_updated",productId:id,productName:body.name,
          details:{fieldsChanged,before,after},createdAt:timestamp,actor:session.username
        }));
      }
      const results = await env.DB.batch(statements);
      if (!results[0].meta.changes) return json({error:"O estoque mudou em outro aparelho. Atualize a tela e tente novamente."},409);
    } else {
      const type = body.qty > Number(old.quantity) ? "entrada" : "saida";
      const movementQty = Math.abs(body.qty-Number(old.quantity));
      const statements = [
        env.DB.prepare("UPDATE products SET name=?,category=?,unit=?,quantity=?,min_quantity=?,notes=?,updated_at=? WHERE id=? AND quantity=?")
          .bind(body.name,body.category,body.unit,body.qty,body.min,body.notes,timestamp,id,Number(old.quantity)),
        env.DB.prepare("INSERT INTO movements (id,product_id,product_name,unit,movement_type,quantity,balance_after,note,created_by,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE changes()=1")
          .bind(crypto.randomUUID(),id,body.name,body.unit,type,movementQty,body.qty,adjustmentNote,session.username,timestamp)
      ];
      if (auditEnabled) {
        statements.push(auditEntryStatement(env,{
          action:"stock_adjusted",productId:id,productName:body.name,
          details:{
            previousQuantity:Number(old.quantity),newQuantity:body.qty,unit:body.unit,
            reason:adjustmentNote,fieldsChanged
          },
          createdAt:timestamp,actor:session.username
        }));
      }
      const results = await env.DB.batch(statements);
      if (!results[0].meta.changes) return json({error:"O estoque mudou em outro aparelho. Atualize a tela e tente novamente."},409);
    }
    const row = await env.DB.prepare("SELECT * FROM products WHERE id=?").bind(id).first();
    return json(mapProduct(row));
  }
  if (!isAdmin && productMatch && request.method === "DELETE") return json({error:"Somente administradores podem excluir produtos."},403);
  if (productMatch && request.method === "DELETE") {
    const id = decodeURIComponent(productMatch[1]);
    const old = await env.DB.prepare("SELECT id,name,category,unit,quantity FROM products WHERE id=?").bind(id).first();
    if (!old) return json({error:"Produto não encontrado."},404);
    const statements = [env.DB.prepare("DELETE FROM products WHERE id=?").bind(id)];
    if (await auditTableExists(env)) {
      statements.push(auditEntryStatement(env,{
        action:"product_deleted",productId:id,productName:old.name,
        details:{category:old.category,unit:old.unit,quantityAtDeletion:Number(old.quantity)},
        createdAt:nowIso(),actor:session.username
      }));
    }
    const results = await env.DB.batch(statements);
    if (!results[0].meta.changes) return json({error:"Produto não encontrado."},404);
    return json({ok:true});
  }
  if (path === "/api/movements" && request.method === "GET") {
    const limit = url.searchParams.get("all") === "1" ? 5000 : 100;
    const result = await env.DB.prepare("SELECT * FROM movements ORDER BY created_at DESC LIMIT ?").bind(limit).all();
    return json(result.results.map(mapMovement));
  }
  if (path === "/api/backup" && request.method === "GET") {
    if (!canManageReports) return json({error:"Seu perfil não permite exportar backups."},403);
    const auditEnabled = await auditTableExists(env);
    const [productRows, movementRows, auditRows] = await Promise.all([
      env.DB.prepare("SELECT * FROM products ORDER BY name COLLATE NOCASE").all(),
      env.DB.prepare("SELECT * FROM movements ORDER BY created_at DESC LIMIT 5000").all(),
      auditEnabled
        ? env.DB.prepare("SELECT id,action,product_id,product_name,actor,details_json,created_at FROM audit_events ORDER BY created_at DESC LIMIT 10000").all()
        : Promise.resolve({results:[]})
    ]);
    const moves = movementRows.results.map(mapMovement);
    const auditEvents = auditRows.results.map(row => {
      let details = {};
      try { details = JSON.parse(row.details_json || "{}"); } catch {}
      return {
        id:row.id,action:row.action,productId:row.product_id,productName:row.product_name,
        actor:row.actor,details,createdAt:row.created_at
      };
    });
    return json({
      products: productRows.results.map(mapProduct),
      moves,
      auditEvents,
      auditEnabled,
      exportedAt: nowIso(),
      movementLimit: 5000,
      movementsTruncated: moves.length >= 5000,
      auditEventLimit: 10000,
      auditEventsTruncated: auditEvents.length >= 10000
    });
  }
  if (path === "/api/movements" && request.method === "POST") {
    if (!canWrite) return json({error:"Seu perfil não permite registrar movimentações."},403);
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
    const insert = env.DB.prepare("INSERT INTO movements (id,product_id,product_name,unit,movement_type,quantity,balance_after,note,created_by,created_at) SELECT ?,id,name,unit,?,?,?,?,?,? FROM products WHERE id=? AND quantity=? AND changes()=1")
      .bind(movementId,type,quantity,nextQty,text(body.note),session.username,timestamp,productId,nextQty);
    const statements = [update,insert];
    if (await auditTableExists(env)) {
      statements.push(auditEntryStatement(env,{
        action:"movement_created",productId:productId,productName:old.name,
        details:{type,quantity,unit:old.unit,previousBalance:oldQty,balanceAfter:nextQty,note:text(body.note)},
        createdAt:timestamp,actor:session.username
      }));
    }
    const results = await env.DB.batch(statements);
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
