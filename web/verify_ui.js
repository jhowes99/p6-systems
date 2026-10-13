/**
 * Shared P6 Verify UI — catalog + assertion rows (Studio console parity).
 */
(function (global) {
  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderAssertions(assertions) {
    const asserts = assertions || [];
    if (!asserts.length) return `<p class="muted">No assertion rows returned.</p>`;
    return `<ul class="verifyAssert">${asserts
      .map(
        (a) =>
          `<li class="${a.pass ? "ok" : "alarm"}"><b>${esc(a.name || a.id || "assert")}</b> · expected ${esc(String(a.expected ?? "—"))} · actual ${esc(String(a.actual ?? "—"))} · ${a.pass ? "PASS" : "FAIL"}</li>`
      )
      .join("")}</ul>`;
  }

  function renderVerifyRunRow({ testName, testId, pass, assertions, error, raw }) {
    const asserts = assertions || [];
    const assertHtml = renderAssertions(asserts);
    if (error) {
      return `<div class="verifyRow alarm"><div class="verifyHead"><b>${esc(testName || testId || "Verify")}</b> · <span class="alarm">ERROR</span></div><p>${esc(error)}</p></div>`;
    }
    const payload = raw || { testId, pass, assertions: asserts };
    return `<div class="verifyRow ${pass ? "ok" : "alarm"}">
      <div class="verifyHead"><b>${esc(testName || testId)}</b> · <span class="${pass ? "ok" : "alarm"}">${pass ? "PASS" : "FAIL"}</span></div>
      ${assertHtml}
      <details class="advDetails"><summary>Advanced (API payload)</summary><pre class="mono">${esc(JSON.stringify(payload, null, 2))}</pre></details>
    </div>`;
  }

  async function fetchCatalog(base) {
    const r = await fetch(`${base || ""}/api/verify/tests`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data.tests || [];
  }

  async function runTest(testId, base) {
    const r = await fetch(`${base || ""}/api/verify/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ testId: testId || undefined })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    const pass = !!(data.pass || data.result?.pass);
    const assertions = data.result?.assertions || data.assertions || [];
    return { pass, assertions, raw: data };
  }

  global.P6VerifyUI = { esc, renderVerifyRunRow, renderAssertions, fetchCatalog, runTest };
})(typeof window !== "undefined" ? window : globalThis);
