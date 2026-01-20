#!/usr/bin/env node
import readline from "node:readline";
import { spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, (ans) => resolve(ans.trim())));

function exists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function assertRepoRoot() {
  const pkg = path.resolve(process.cwd(), "package.json");
  if (!exists(pkg)) {
    console.error("❌ No encuentro package.json en el directorio actual.");
    console.error("👉 Corré este wizard desde la raíz del proyecto.");
    console.error("   CWD:", process.cwd());
    process.exit(1);
  }
}

function yn(s, defYes = true) {
  if (!s) return defYes;
  const x = s.toLowerCase();
  return ["y", "yes", "s", "si", "sí", "1"].includes(x);
}

function getPkg() {
  return readJson(path.resolve(process.cwd(), "package.json"));
}

function hasScript(name) {
  try {
    const pkg = getPkg();
    return !!pkg?.scripts?.[name];
  } catch {
    return false;
  }
}

// Windows: cmd /c, sin shell:true (evita warning DEP0190)
function run(cmd, args = [], opts = {}) {
  const isWin = process.platform === "win32";
  const finalCmd = isWin ? "cmd" : cmd;
  const finalArgs = isWin ? ["/c", cmd, ...args] : args;

  console.log(`\n> ${isWin ? "cmd /c " : ""}${cmd} ${args.join(" ")}`);

  const r = spawnSync(finalCmd, finalArgs, {
    stdio: "inherit",
    shell: false,
    ...opts
  });

  if (r.error) {
    console.error("❌ spawnSync error:", r.error.message);
    return { ok: false, code: 1 };
  }
  return { ok: r.status === 0, code: r.status ?? 0 };
}

function rmIfExists(p) {
  try {
    if (exists(p)) fs.rmSync(p, { recursive: true, force: true });
  } catch (e) {
    console.error("❌ No pude borrar:", p, e?.message || e);
  }
}

function findEntry() {
  const candidates = [
    path.resolve(process.cwd(), "dist/server.js"),
    path.resolve(process.cwd(), "dist/app.js"),
    path.resolve(process.cwd(), "dist/index.js")
  ];
  for (const c of candidates) if (exists(c)) return c;

  try {
    const pkg = getPkg();
    if (pkg?.main) {
      const m = path.resolve(process.cwd(), pkg.main);
      if (exists(m)) return m;
    }
  } catch {}

  return null;
}

function httpGet(url, timeoutMs = 2200) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.on("data", () => {});
      res.on("end", () => {
        const code = res.statusCode || 0;
        resolve({ ok: code >= 200 && code < 300, code });
      });
    });
    req.on("error", () => resolve({ ok: false, code: 0 }));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve({ ok: false, code: 0 });
    });
  });
}

async function probe(baseUrl, paths, retries = 12, sleepMs = 900) {
  let last = {};
  for (let i = 0; i < retries; i++) {
    last = {};
    let all = true;
    for (const p of paths) {
      const r = await httpGet(baseUrl + p);
      last[p] = r;
      // En un deploy real, /api/v1/tables suele estar protegido -> 401 es señal de vida.
      if (!(p === "/api/v1/tables" && r.code === 401) && !r.ok) all = false;
    }
    if (all) return { ok: true, last };
    await new Promise((r) => setTimeout(r, sleepMs));
  }
  return { ok: false, last };
}

function printProbe(baseUrl, res, paths) {
  console.log(`\n🔎 Probe baseUrl: ${baseUrl}`);
  for (const p of paths) {
    const code = res.last?.[p]?.code ?? 0;
    const tag =
      code === 0 ? "NO_CONN" :
      code >= 200 && code < 300 ? "OK" :
      code === 401 || code === 403 ? "AUTH" :
      code === 404 ? "NOT_FOUND" :
      code >= 500 ? "SERVER_ERR" :
      "FAIL";
    console.log(`  ${p} -> ${tag} (${code})`);
  }
}

function startNodeBackground(entryAbs, envVars) {
  const isWin = process.platform === "win32";
  const cmd = isWin ? "cmd" : "node";
  const args = isWin ? ["/c", "node", entryAbs] : [entryAbs];

  console.log(`\n🚀 Start (background): node ${path.relative(process.cwd(), entryAbs)}`);

  const child = spawn(cmd, args, {
    stdio: "inherit",
    shell: false,
    env: envVars
  });

  return child;
}

function startNpmScriptBackground(scriptName, envVars) {
  const isWin = process.platform === "win32";
  const cmd = isWin ? "cmd" : "npm";
  const args = isWin ? ["/c", "npm", "run", scriptName] : ["run", scriptName];

  console.log(`\n🚀 Start (background): npm run ${scriptName}`);

  const child = spawn(cmd, args, {
    stdio: "inherit",
    shell: false,
    env: envVars
  });

  return child;
}

async function deployStartAndProbe() {
  // baseUrl IPv4 por defecto (evita FAIL(0) por IPv6/localhost en Windows)
  const port = Number(process.env.PORT || 3000);
  const baseUrl = process.env.API_BASE_URL || `http://127.0.0.1:${port}`;
  const paths = ["/health", "/ready", "/api/v1/tables"];

  const childEnv = { ...process.env, NODE_ENV: "production", TRUST_PROXY: "1", PORT: String(port) };

  // preferimos npm run start si existe
  let child = null;

  if (hasScript("start")) {
    child = startNpmScriptBackground("start", childEnv);
  } else {
    const entry = findEntry();
    if (!entry) {
      console.error("❌ No encuentro entry en dist/ (server.js/app.js/index.js) ni package.json main.");
      return { ok: false, child: null, baseUrl, paths, res: { ok: false, last: {} } };
    }
    child = startNodeBackground(entry, childEnv);
  }

  console.log(`\n🧪 Probe automático: ${paths.join(", ")} (reintentos)`);
  const res = await probe(baseUrl, paths);

  return { ok: res.ok, child, baseUrl, paths, res };
}

async function doClean() {
  // si existe npm run clean, usamos eso
  if (hasScript("clean")) {
    const r = run("npm", ["run", "clean"]);
    console.log(r.ok ? "✅ CLEAN OK" : `❌ CLEAN FAIL (code ${r.code})`);
    return r.ok;
  }

  // fallback: dist + .cache
  rmIfExists(path.resolve(process.cwd(), "dist"));
  rmIfExists(path.resolve(process.cwd(), ".cache"));
  console.log("✅ CLEAN OK (fallback dist + .cache)");
  return true;
}

async function doExportOpenApi() {
  // preferimos script si existe
  if (hasScript("openapi:export")) {
    const r = run("npm", ["run", "openapi:export"]);
    console.log(r.ok ? "✅ OPENAPI EXPORT OK" : `❌ OPENAPI EXPORT FAIL (code ${r.code})`);
    return r.ok;
  }

  // fallback a dist/types/openapi/*
  const p1 = path.resolve(process.cwd(), "dist/types/openapi/export.js");
  const p2 = path.resolve(process.cwd(), "dist/types/openapi/exportOpenApi.js");
  const target = exists(p1) ? p1 : exists(p2) ? p2 : null;

  if (!target) {
    console.log("⚠️ No encuentro export OpenAPI en dist/types/openapi/*.js");
    return false;
  }

  const r = run("node", [target]);
  console.log(r.ok ? "✅ OPENAPI EXPORT OK" : `❌ OPENAPI EXPORT FAIL (code ${r.code})`);
  return r.ok;
}

async function main() {
  assertRepoRoot();

  console.log("\n🧭 Wizard personalv5-enterprise-api\n");
  console.log("¿Qué querés hacer ahora?");
  console.log("  1) Development (npm run dev)");
  console.log("  2) Tests unitarios (npm test)");
  console.log("  3) Tests integración DB (TEST_INTEGRATION=1)");
  console.log("  4) Build (npm run build)");
  console.log("  5) Deploy/Start producción (build + start + probe automático)");
  console.log("  6) Lint (npm run lint)");
  console.log("  7) Typecheck (npm run typecheck)");
  console.log("  8) Clean (dist + .cache)");
  console.log("  9) Export OpenAPI (build si hace falta)");
  console.log(" 10) Smoke test (GET /health y /ready)");
  console.log(" 11) Reset schema cache (.cache/schema.json)");

  const action = await ask("Elegí 1-11: ");

  if (action === "1") {
    run("npm", ["run", "dev"]);
    rl.close();
    return;
  }

  if (action === "2") {
    run("npm", ["test"]);
    rl.close();
    return;
  }

  if (action === "3") {
    // cross-env puede no existir: intentamos directo
    if (hasScript("test")) {
      const r = run("npx", ["cross-env", "TEST_INTEGRATION=1", "npm", "test"]);
      if (!r.ok) {
        // fallback sin cross-env
        const env2 = { ...process.env, TEST_INTEGRATION: "1" };
        run("npm", ["test"], { env: env2 });
      }
    }
    rl.close();
    return;
  }

  if (action === "4") {
    const r = run("npm", ["run", "build"]);
    console.log(r.ok ? "✅ BUILD OK" : `❌ BUILD FAIL (code ${r.code})`);
    rl.close();
    return;
  }

  if (action === "5") {
    // sugerencia: clean antes (opcional)
    const cleanFirst = yn(await ask("¿Clean antes de build? (S/n): "), true);
    if (cleanFirst) {
      const ok = await doClean();
      if (!ok) {
        rl.close();
        return;
      }
    }

    const b = run("npm", ["run", "build"]);
    if (!b.ok) {
      console.log(`❌ BUILD FAIL (code ${b.code})`);
      rl.close();
      return;
    }
    console.log("\n✅ BUILD OK");

    const started = await deployStartAndProbe();
    printProbe(started.baseUrl, started.res, started.paths);

    if (!started.ok) {
      console.log("❌ DEPLOY FAIL");

      // Por defecto: si falla, lo matamos (evita quedar con procesos colgados)
      const keep = yn(await ask("¿Dejar server corriendo igual? (s/N): "), false);
      if (!keep && started.child) {
        try { started.child.kill("SIGTERM"); } catch {}
        console.log("🧹 Server cerrado por fallo de probe");
      } else {
        console.log("🟢 Server queda corriendo. Ctrl+C para cortar.");
      }

      rl.close();
      process.exit(1);
    }

    console.log("✅ DEPLOY OK");
    console.log("🟢 Server queda corriendo. Ctrl+C para cortar.");
    rl.close();
    return;
  }

  if (action === "6") {
    const r = run("npm", ["run", "lint"]);
    console.log(r.ok ? "✅ LINT OK" : `❌ LINT FAIL (code ${r.code})`);
    rl.close();
    return;
  }

  if (action === "7") {
    const r = run("npm", ["run", "typecheck"]);
    console.log(r.ok ? "✅ TYPECHECK OK" : `❌ TYPECHECK FAIL (code ${r.code})`);
    rl.close();
    return;
  }

  if (action === "8") {
    await doClean();
    rl.close();
    return;
  }

  if (action === "9") {
    // build si no existe dist
    const dist = path.resolve(process.cwd(), "dist");
    if (!exists(dist)) {
      const b = run("npm", ["run", "build"]);
      if (!b.ok) {
        console.log(`❌ BUILD FAIL (code ${b.code})`);
        rl.close();
        return;
      }
    }
    await doExportOpenApi();
    rl.close();
    return;
  }

  if (action === "10") {
    const port = Number((await ask("Port (default 3000): ")) || 3000);
    const baseUrl = process.env.API_BASE_URL || `http://127.0.0.1:${port}`;
    const res = await probe(baseUrl, ["/health", "/ready"], 3, 500);
    console.log(res.ok ? "✅ SMOKE OK" : "❌ SMOKE FAIL");
    printProbe(baseUrl, res, ["/health", "/ready"]);
    rl.close();
    return;
  }

  if (action === "11") {
    const cacheDir = path.resolve(process.cwd(), ".cache");
    const schema = path.resolve(cacheDir, "schema.json");
    rmIfExists(schema);
    console.log("✅ SCHEMA CACHE RESET OK:", schema);
    rl.close();
    return;
  }

  console.log("❌ Opción inválida.");
  rl.close();
  process.exit(1);
}

main().catch((e) => {
  console.error("❌ Wizard error:", e?.stack || e);
  try { rl.close(); } catch {}
  process.exit(1);
});
