const base = String(process.env.API_BASE_URL || "").trim().replace(/\/+$/, "");
const password = process.env.APP_PASSWORD;

if (!base || !password) {
  console.error("Configure API_BASE_URL e APP_PASSWORD no terminal antes de executar o teste.");
  process.exit(1);
}

async function call(path, options = {}) {
  const headers = { Accept: "application/json" };
  if (options.body) headers["Content-Type"] = "application/json";
  if (options.token) headers.Authorization = "Bearer " + options.token;
  const response = await fetch(base + path, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store"
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(path + " retornou HTTP " + response.status + ": " + (data?.error || "resposta inválida"));
  }
  return data;
}

try {
  const health = await call("/api/health");
  if (!health?.ok) throw new Error("O health check não confirmou a API.");
  if (health.runtimeSecretsConfigured !== true) throw new Error("Os segredos de execução não estão disponíveis no Worker.");

  const unauthenticated = await fetch(base + "/api/products", {
    headers: { Accept: "application/json" },
    cache: "no-store"
  });
  if (unauthenticated.status !== 401) {
    throw new Error("A rota de produtos deve exigir autenticação (esperado HTTP 401).");
  }

  const wrongContentType = await fetch(base + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: "{}",
    cache: "no-store"
  });
  if (wrongContentType.status !== 415) {
    throw new Error("A API deve rejeitar conteúdo que não seja JSON (esperado HTTP 415).");
  }

  const arrayPayload = await fetch(base + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "[]",
    cache: "no-store"
  });
  if (arrayPayload.status !== 400) {
    throw new Error("A API deve rejeitar arrays como corpo de login (esperado HTTP 400).");
  }

  const login = await call("/api/login", { method: "POST", body: { password } });
  if (!login?.token) throw new Error("O login não retornou uma sessão.");

  const token = login.token;
  const products = await call("/api/products", { token });
  const movements = await call("/api/movements", { token });
  const audit = await call("/api/audit?limit=100", { token });
  const backup = await call("/api/backup", { token });
  if (!Array.isArray(products) || !Array.isArray(movements) ||
      audit.enabled !== true || !Array.isArray(audit.events) ||
      !Array.isArray(backup.products) || !Array.isArray(backup.moves) ||
      backup.auditEnabled !== true || !Array.isArray(backup.auditEvents)) {
    throw new Error("A API respondeu, mas um endpoint não retornou a estrutura esperada.");
  }

  console.log("Teste concluído sem alterar o estoque.");
  console.log("- API e segredos de execução: online");
  console.log("- Proteção das rotas privadas: OK");
  console.log("- Validação de conteúdo JSON: OK");
  console.log("- Login: OK");
  console.log("- Auditoria: OK (" + audit.events.length + " eventos recentes)");
  console.log("- Produtos: " + products.length);
  console.log("- Movimentações recentes na tela: " + movements.length);
  console.log("- Backup remoto: OK (" + backup.moves.length + " movimentações e " + backup.auditEvents.length + " eventos de auditoria incluídos)");
} catch (error) {
  console.error("Falha no teste:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
