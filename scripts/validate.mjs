import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const read = (path) => readFile(new URL("../" + path, import.meta.url), "utf8");
const [html, worker, serviceWorker, schema, auditMigration, manifestText, configText, packageText, apiConfig, appJs, installJs] =
  await Promise.all([
    read("index.html"),
    read("cloudflare/worker.js"),
    read("sw.js"),
    read("cloudflare/schema.sql"),
    read("cloudflare/migrations/0002_audit_events.sql"),
    read("manifest.webmanifest"),
    read("wrangler.jsonc"),
    read("package.json"),
    read("api-config.js"),
    read("app.js"),
    read("install.js")
  ]);

const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1].trim())
  .filter(Boolean);
assert.equal(inlineScripts.length, 0, "index.html não deve conter JavaScript inline.");
assert.ok(html.includes('<script src="./app.js" defer></script>'));
assert.ok(html.includes('<script src="./install.js" defer></script>'));
assert.ok(html.includes("script-src 'self' https://cdn.jsdelivr.net"), "A CSP deve bloquear scripts inline e permitir apenas scripts próprios e jsPDF.");
assert.ok(!/\bon[a-z]+\s*=/i.test(html), "index.html não deve conter manipuladores de evento inline.");
new vm.Script(appJs, { filename: "app.js" });
new vm.Script(installJs, { filename: "install.js" });

new vm.Script(worker.replace("export default {", "globalThis.workerDefault = {"), { filename: "cloudflare/worker.js" });
new vm.Script(serviceWorker.replace(/\bself\b/g, "globalThis"), { filename: "sw.js" });
new vm.Script(apiConfig, { filename: "api-config.js" });

const manifest = JSON.parse(manifestText);
assert.equal(manifest.name, "Capricho | Gestão de Estoque");
assert.equal(manifest.short_name, "Capricho");
assert.equal(manifest.theme_color, "#5E3023");
assert.equal(manifest.background_color, "#F3E9DC");
assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192"));
assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512"));

const wrangler = JSON.parse(configText.replace(/^\s*\/\/.*$/gm, ""));
assert.ok(wrangler.d1_databases?.some((binding) => binding.binding === "DB"));
assert.equal(wrangler.secrets, undefined, "Os segredos são gerenciados no painel do Cloudflare.");
assert.ok(worker.includes("!env.APP_PASSWORD || !env.SESSION_SECRET"), "A API deve recusar login se os segredos não estiverem configurados.");
assert.ok(worker.includes("const MAX_JSON_BODY_BYTES = 16 * 1024;"), "A API deve limitar o tamanho das requisições JSON.");
assert.ok(worker.includes('contentType !== "application/json"'), "A API deve validar o tipo de conteúdo.");
assert.ok(worker.includes("request.body?.getReader()"), "A API deve impor o limite do corpo durante a leitura.");
assert.ok(worker.includes("Array.isArray(parsed)"), "A API deve rejeitar JSON que não seja um objeto.");
assert.ok(worker.includes('headers.set("Permissions-Policy"'), "A API deve enviar cabeçalhos de segurança.");
assert.ok(worker.includes('headers.set("Strict-Transport-Security"'), "A API deve enviar HSTS.");

const packageInfo = JSON.parse(packageText);
assert.equal(packageInfo.scripts?.["test:smoke"], "node scripts/smoke-test.mjs");
assert.ok(schema.includes("CREATE TABLE IF NOT EXISTS products"));
assert.ok(schema.includes("CREATE TABLE IF NOT EXISTS movements"));
assert.ok(schema.includes("CREATE TABLE IF NOT EXISTS login_attempts"));
assert.ok(schema.includes("CREATE TABLE IF NOT EXISTS audit_events"));
assert.ok(auditMigration.includes("CREATE TABLE IF NOT EXISTS audit_events"));
assert.ok(auditMigration.includes("CREATE INDEX IF NOT EXISTS audit_events_date_idx"));
assert.ok(worker.includes('path === "/api/login"'));
assert.ok(worker.includes('path === "/api/products"'));
assert.ok(worker.includes('path === "/api/movements"'));
assert.ok(worker.includes('path === "/api/backup"'));
assert.ok(worker.includes('path === "/api/audit"'));
assert.ok(worker.includes("async function auditTableExists(env)"));
assert.ok(worker.includes('action:"stock_adjusted"'));
assert.ok(worker.includes('action:"product_deleted"'));
assert.ok(appJs.includes('apiRequest("/api/audit?limit=100")'));
assert.ok(html.includes('id="audit-panel"'));
assert.ok(html.includes('id="audit-table"'));
assert.ok(html.includes('src="./api-config.js"'));
assert.ok(html.includes('id="login-form"'));
assert.ok(html.includes('id="sync-now"'));
assert.ok(html.includes('id="logout-now"'));
assert.ok(html.includes("Content-Security-Policy"), "A interface deve aplicar uma política de segurança de conteúdo.");
assert.ok(html.includes('id="p-adjustment-note"'), "A interface deve pedir motivo ao ajustar saldo.");
assert.ok(worker.includes("if (quantityChanged && !adjustmentNote)"), "A API deve rejeitar ajustes de saldo sem motivo.");
assert.ok(serviceWorker.includes('"./app.js"') && serviceWorker.includes('"./install.js"'), "O cache PWA deve incluir os scripts separados.");
assert.ok(worker.includes('adjustmentNote,"equipe",timestamp'), "O motivo do ajuste deve ser gravado no histórico.");

console.log("Validação concluída.");
console.log("- Scripts JavaScript: OK");
console.log("- Manifesto, ícones e configuração Wrangler: OK");
console.log("- Tabelas D1 e rotas da API: OK");
console.log("- Login e controles de sincronização no app: OK");
