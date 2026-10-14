/**
 * Shared P6 Verify UI — catalog + assertion rows (Studio console parity).
 * Status vocabulary: PASS | FAIL | BLOCKED | NOT RUN — never invent PASS.
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
      .map((a) => {
        const expected =
          typeof a.expected === "object" ? JSON.stringify(a.expected) : String(a.expected ?? "—");
        const actual =
          typeof a.actual === "object" ? JSON.stringify(a.actual) : String(a.actual ?? "—");
        return `<li class="${a.pass ? "ok" : "alarm"}"><b>${esc(a.name || a.id || "assert")}</b> · expected ${esc(expected)} · actual ${esc(actual)} · ${a.pass ? "PASS" : "FAIL"}</li>`;
      })
      .join("")}</ul>`;
  }

  function renderVerifyRunRow({ testName, testId, pass, status, assertions, error, failureExplain, raw }) {
    const asserts = assertions || [];
    const assertHtml = renderAssertions(asserts);
    const st = status || (pass ? "PASS" : "FAIL");
    if (error) {
      return `<div class="verifyRow alarm"><div class="verifyHead"><b>${esc(testName || testId || "Verify")}</b> · <span class="alarm">ERROR</span></div><p>${esc(error)}</p></div>`;
    }
    const cls = st === "PASS" ? "ok" : st === "BLOCKED" ? "warn" : "alarm";
    const payload = raw || { testId, pass, status: st, assertions: asserts };
    return `<div class="verifyRow ${cls}">
      <div class="verifyHead"><b>${esc(testName || testId)}</b> · <span class="${cls}">${esc(st)}</span>
        <span class="muted"> · VIRTUAL</span></div>
      ${failureExplain ? `<p class="warn">${esc(failureExplain)}</p>` : ""}
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
    const status = data.status || data.result?.status || (data.pass ? "PASS" : "FAIL");
    const pass = status === "PASS";
    const assertions = data.result?.assertions || data.assertions || [];
    return {
      pass,
      status,
      assertions,
      failureExplain: data.result?.failureExplain || data.result?.blockReason || null,
      raw: data
    };
  }

  global.P6VerifyUI = { esc, renderVerifyRunRow, renderAssertions, fetchCatalog, runTest };
})(typeof window !== "undefined" ? window : globalThis);
