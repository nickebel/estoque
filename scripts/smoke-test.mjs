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

  const login = await call("/api/login", { method: "POST", body: { password } });
  if (!login?.token) throw new Error("O login não retornou uma sessão.");

  const token = login.token;
  const products = await call("/api/products", { token });
  const movements = await call("/api/movements", { token });
  if (!Array.isArray(products) || !Array.isArray(movements)) {
    throw new Error("A API respondeu, mas os endpoints não retornaram listas.");
  }

  console.log("Teste concluído sem alterar dados do estoque.");
  console.log("- API: online");
  console.log("- Login: OK");
  console.log("- Produtos: " + products.length);
  console.log("- Movimentações recentes: " + movements.length);
} catch (error) {
  console.error("Falha no teste:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
