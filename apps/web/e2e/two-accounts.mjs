/**
 * Real two-account browser acceptance test. Requires the API, worker and web app to be running
 * (WEB_URL, default http://localhost:3100). Uses the worker's Playwright install; no extra dependency.
 *
 *   node apps/web/e2e/two-accounts.mjs
 *
 * Account A: register → audit → (AI interpretation if configured) → select findings → proposal → edit + save → logout.
 * Account B: register → empty workspace → A's audit and proposal are "not found" in the UI and 404 from the API.
 * Account A: log back in → audit and edited proposal are still there.
 */
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const require = createRequire(new URL("../../worker/package.json", import.meta.url));
const { chromium } = require("playwright");

const WEB = (process.env.WEB_URL ?? "http://localhost:3100").replace(/\/$/, "");
const AUDIT_URL = process.env.E2E_AUDIT_URL ?? "https://example.com/";
const RUN_AI = process.env.E2E_RUN_AI !== "0";
const run = randomUUID().slice(0, 8);
const A = { name: "Account A", email: `e2e-a-${run}@scopepilot.test`, password: "first account passphrase" };
const B = { name: "Account B", email: `e2e-b-${run}@scopepilot.test`, password: "second account passphrase" };
let passed = 0;

function check(label, condition, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) throw new Error(`Check failed: ${label}`);
  passed += 1;
}

async function register(page, account) {
  await page.goto(`${WEB}/register`);
  await page.getByLabel("Name").fill(account.name);
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  const registered = page.waitForResponse((response) => response.url().endsWith("/api/v1/auth/register"));
  await page.getByRole("button", { name: "Create account" }).click();
  const response = await registered;
  const result = { status: response.status(), body: await response.json(), setCookie: response.headers()["set-cookie"] ?? null };
  await page.waitForURL(`${WEB}/workspace`);
  return result;
}

async function login(page, account) {
  await page.goto(`${WEB}/login`);
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${WEB}/workspace`);
}

async function logout(page) {
  await page.getByRole("button", { name: "Log out" }).click();
  await page.waitForURL(/\/login$/);
}

async function sessionCookie(context) {
  return (await context.cookies()).find((cookie) => /scopepilot_session$/.test(cookie.name));
}

function editableBody(proposal) {
  const { id: _id, auditId: _a, auditUrl: _u, status, revision, opportunities, createdAt: _c, updatedAt: _up, ...content } = proposal;
  return { revision, status, content: { ...content, title: "Overwritten by B" }, opportunityIds: opportunities.map((o) => o.id) };
}

const browser = await chromium.launch();
try {
  const anonymous = await browser.newContext();
  const anonPage = await anonymous.newPage();
  await anonPage.goto(`${WEB}/workspace/proposals`);
  check("Signed-out visitor is redirected to login", anonPage.url() === `${WEB}/login?next=%2Fworkspace%2Fproposals`, anonPage.url());
  const anonApi = await anonPage.request.get(`${WEB}/api/v1/audits`);
  check("Signed-out API call is rejected", anonApi.status() === 401, `HTTP ${anonApi.status()}`);
  await anonymous.close();

  // ---- Account A
  const contextA = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const pageA = await contextA.newPage();
  await register(pageA, A);
  const cookieA = await sessionCookie(contextA);
  check("A registered and signed in with an HTTP-only SameSite=Lax cookie", cookieA?.httpOnly && cookieA.sameSite === "Lax", cookieA?.name);
  await pageA.getByText("Your first audit starts with one public URL.").waitFor();
  check("A sees an empty workspace with their account in the shell", await pageA.getByText(A.email).first().isVisible());
  check("No auth data in localStorage/sessionStorage", await pageA.evaluate(() => localStorage.length === 0 && sessionStorage.length === 0));

  await pageA.goto(`${WEB}/workspace/audits/new`);
  await pageA.locator("#audit-url").fill(AUDIT_URL);
  await pageA.getByRole("button", { name: /Submit audit/ }).click();
  await pageA.waitForURL(/\/workspace\/audits\/[a-f0-9]{24}$/);
  const auditId = pageA.url().split("/").pop();
  console.log(`      audit ${auditId}: waiting for the worker…`);
  await pageA.getByRole("checkbox", { name: /^Add to proposal:/ }).first().waitFor({ timeout: 240_000 });
  check("A's audit finished with selectable findings", true, auditId);

  const aiButton = pageA.getByRole("button", { name: "Generate AI interpretation" });
  if (RUN_AI && await aiButton.isVisible().catch(() => false) && await aiButton.isEnabled()) {
    await aiButton.click();
    await pageA.getByRole("button", { name: "Regenerate interpretation" }).waitFor({ timeout: 120_000 });
    const body = await (await pageA.request.get(`${WEB}/api/v1/audits/${auditId}/interpretation`)).json();
    check("A ran AI interpretation", body.interpretation !== null, `status ${body.interpretation?.status}`);
  } else {
    console.log("      AI interpretation not configured or unavailable; skipped.");
  }

  const boxes = pageA.getByRole("checkbox", { name: /^Add to proposal:/ });
  const toSelect = Math.min(2, await boxes.count());
  for (let i = 0; i < toSelect; i += 1) await boxes.first().check();
  await pageA.getByRole("button", { name: "Create proposal from selection" }).click();
  await pageA.waitForURL(/\/workspace\/proposals\/[a-f0-9]{24}$/, { timeout: 30_000 });
  const proposalId = pageA.url().split("/").pop();
  const title = `E2E proposal ${run}`;
  await pageA.getByLabel("Proposal title").fill(title);
  await pageA.getByRole("button", { name: "Save proposal" }).click();
  await pageA.getByText("Saved", { exact: true }).waitFor();
  const savedA = (await (await pageA.request.get(`${WEB}/api/v1/proposals/${proposalId}`)).json()).proposal;
  check("A created and saved an edited proposal", savedA.title === title && savedA.revision === 2 && savedA.auditId === auditId, `${proposalId} rev ${savedA.revision}, ${savedA.opportunities.length} opportunities`);

  const noCsrf = await pageA.request.post(`${WEB}/api/v1/proposals`, { data: { auditId, selections: [] }, headers: { origin: WEB } });
  check("Write without the CSRF token is refused", noCsrf.status() === 403, `HTTP ${noCsrf.status()} ${(await noCsrf.json()).error}`);
  const crossOrigin = await pageA.request.post(`${WEB}/api/v1/auth/logout`, { data: {}, headers: { origin: "https://evil.example" } });
  check("Cross-origin write is refused by the web proxy", crossOrigin.status() === 403, `HTTP ${crossOrigin.status()}`);

  await logout(pageA);
  const reuse = await (await browser.newContext()).request.get(`${WEB}/api/v1/audits`, { headers: { cookie: `${cookieA.name}=${cookieA.value}` } });
  check("A's old session cookie is rejected after logout", reuse.status() === 401, `HTTP ${reuse.status()}`);
  await pageA.goto(`${WEB}/workspace`);
  check("After logout the workspace redirects to login", pageA.url().startsWith(`${WEB}/login`), pageA.url());

  // ---- Account B
  const contextB = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const pageB = await contextB.newPage();
  // Registering with A's email must look exactly like registering a brand-new email (no enumeration).
  const probe = await browser.newContext();
  const takeoverPassword = "account b takeover attempt";
  const takeover = await probe.request.post(`${WEB}/api/v1/auth/register`, { data: { name: "Intruder", email: A.email.toUpperCase(), password: takeoverPassword }, headers: { origin: WEB } });
  const takeoverResult = { status: takeover.status(), body: await takeover.json(), setCookie: takeover.headers()["set-cookie"] ?? null };
  const registeredB = await register(pageB, B);
  check("Registering with A's email returns exactly what a new email returns", JSON.stringify(takeoverResult) === JSON.stringify(registeredB) && registeredB.status === 202 && registeredB.setCookie === null, `HTTP ${takeoverResult.status} vs ${registeredB.status}`);
  const takeoverLogin = await probe.request.post(`${WEB}/api/v1/auth/login`, { data: { email: A.email, password: takeoverPassword }, headers: { origin: WEB } });
  check("The other password does not sign in to A's account", takeoverLogin.status() === 401, `HTTP ${takeoverLogin.status()}`);
  await probe.close();
  await pageB.getByText("Your first audit starts with one public URL.").waitFor();
  check("B registered into an empty audit list", true);
  await pageB.goto(`${WEB}/workspace/proposals`);
  await pageB.getByText("Proposals start from audit evidence.").waitFor();
  check("B has no proposals", true);
  await pageB.goto(`${WEB}/workspace/audits/${auditId}`);
  await pageB.getByText("Audit not found").waitFor();
  check("B opening A's audit URL sees 'Audit not found'", true);
  await pageB.goto(`${WEB}/workspace/proposals/${proposalId}`);
  await pageB.getByText("Proposal not found").waitFor();
  check("B opening A's proposal URL sees 'Proposal not found'", true);
  for (const path of [`audits/${auditId}`, `audits/${auditId}/interpretation`, `proposals/${proposalId}`]) {
    const response = await pageB.request.get(`${WEB}/api/v1/${path}`);
    check(`B GET /api/v1/${path} → 404`, response.status() === 404, `HTTP ${response.status()}`);
  }
  const csrfB = (await (await pageB.request.get(`${WEB}/api/v1/auth/session`)).json()).csrfToken;
  const writes = [
    ["PUT", `proposals/${proposalId}`, editableBody(savedA)],
    ["POST", `proposals/${proposalId}/draft`, {}],
    ["POST", `audits/${auditId}/interpretation`, {}],
    ["POST", "proposals", { auditId, selections: [{ source: "finding", ref: savedA.opportunities[0]?.ref ?? "seo:f0" }] }],
  ];
  for (const [method, path, data] of writes) {
    const response = await pageB.request.fetch(`${WEB}/api/v1/${path}`, { method, data, headers: { origin: WEB, "x-csrf-token": csrfB } });
    check(`B ${method} /api/v1/${path} with a valid CSRF token → 404`, response.status() === 404, `HTTP ${response.status()}`);
  }
  await logout(pageB);

  // ---- Account A again
  await login(pageA, A);
  await pageA.locator(`a[href="/workspace/audits/${auditId}"]`).first().waitFor();
  check("A's audit is listed after signing back in", true);
  await pageA.goto(`${WEB}/workspace/proposals`);
  await pageA.getByText(title).first().waitFor();
  check("A's proposal is listed after signing back in", true);
  await pageA.goto(`${WEB}/workspace/proposals/${proposalId}`);
  await pageA.getByLabel("Proposal title").waitFor();
  check("A's edited proposal is intact", await pageA.getByLabel("Proposal title").inputValue() === title);
  const afterB = (await (await pageA.request.get(`${WEB}/api/v1/proposals/${proposalId}`)).json()).proposal;
  check("B's attempts did not change A's proposal", afterB.revision === 2 && afterB.title === title, `rev ${afterB.revision}`);
  await logout(pageA);

  console.log(`\nAll ${passed} checks passed. Accounts: ${A.email}, ${B.email}; audit ${auditId}; proposal ${proposalId}.`);
} finally {
  await browser.close();
}
