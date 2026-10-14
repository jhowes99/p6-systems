(function () {
  const secureModeStatus = document.getElementById("secureModeStatus");
  const btnToggleSecure = document.getElementById("btnToggleSecure");
  const newPassword = document.getElementById("newPassword");
  const btnSetPassword = document.getElementById("btnSetPassword");
  const passwordStatus = document.getElementById("passwordStatus");
  const loginPassword = document.getElementById("loginPassword");
  const btnLogin = document.getElementById("btnLogin");
  const btnLogout = document.getElementById("btnLogout");
  const loginStatus = document.getElementById("loginStatus");
  const btnAuditVerify = document.getElementById("btnAuditVerify");
  const auditVerify = document.getElementById("auditVerify");
  const validationExceptionPasscode = document.getElementById("validationExceptionPasscode");
  const btnSetValidationExceptionPasscode = document.getElementById("btnSetValidationExceptionPasscode");
  const validationExceptionPasscodeStatus = document.getElementById("validationExceptionPasscodeStatus");

  async function loadSecurityConfig() {
    try {
      const r = await fetch("/api/security/config");
      const d = await r.json();
      if (d.ok) {
        secureModeStatus.textContent = d.secureMode ? "Secure Mode ON" : "Secure Mode OFF";
        secureModeStatus.style.color = d.secureMode ? "#059669" : "#6b7280";
      }
    } catch (e) {
      secureModeStatus.textContent = "Error loading config";
    }
  }

  btnToggleSecure.onclick = async () => {
    try {
      const r = await fetch("/api/security/config");
      const d = await r.json();
      const current = d.ok && d.secureMode;
      const res = await fetch("/api/security/secure-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !current })
      });
      const out = await res.json();
      if (out.ok) loadSecurityConfig();
      else passwordStatus.textContent = out.error || "Failed";
    } catch (e) {
      passwordStatus.textContent = e?.message || "Error";
    }
  };

  btnSetPassword.onclick = async () => {
    passwordStatus.textContent = "";
    const pwd = newPassword.value;
    if (!pwd) {
      passwordStatus.textContent = "Enter a password.";
      return;
    }
    try {
      const res = await fetch("/api/security/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwd })
      });
      const d = await res.json();
      if (d.ok) {
        passwordStatus.textContent = "Password set.";
        newPassword.value = "";
      } else passwordStatus.textContent = d.error || "Failed";
    } catch (e) {
      passwordStatus.textContent = e?.message || "Error";
    }
  };

  btnLogin.onclick = async () => {
    loginStatus.textContent = "";
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: loginPassword.value }),
        credentials: "include"
      });
      const d = await res.json();
      if (d.ok) loginStatus.textContent = "Logged in.";
      else loginStatus.textContent = d.error || "Login failed.";
    } catch (e) {
      loginStatus.textContent = e?.message || "Error";
    }
  };

  btnLogout.onclick = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
      loginStatus.textContent = "Logged out.";
    } catch (e) {
      loginStatus.textContent = e?.message || "Error";
    }
  };

  btnSetValidationExceptionPasscode.onclick = async () => {
    validationExceptionPasscodeStatus.textContent = "";
    const passcode = (validationExceptionPasscode && validationExceptionPasscode.value) ? validationExceptionPasscode.value : "";
    try {
      const res = await fetch("/api/config/validation-exception-passcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: passcode.trim() }),
        credentials: "include"
      });
      const d = await res.json();
      if (d.ok) {
        validationExceptionPasscodeStatus.textContent = d.requiresPasscode ? "Passcode set. Exceptions now require this passcode." : "Passcode cleared. Exceptions no longer require a passcode.";
        if (validationExceptionPasscode) validationExceptionPasscode.value = "";
      } else validationExceptionPasscodeStatus.textContent = d.error || "Failed";
    } catch (e) {
      validationExceptionPasscodeStatus.textContent = e?.message || "Error";
    }
  };

  btnAuditVerify.onclick = async () => {
    try {
      const r = await fetch("/api/audit/verify");
      const d = await r.json();
      if (d.ok) {
        auditVerify.innerHTML = "<strong>OK</strong> — Chain valid. Last hash: <code>" + (d.lastHash || "").slice(0, 16) + "…</code>";
      } else {
        auditVerify.innerHTML = "<strong>Broken</strong> at index " + (d.brokenAt ?? "?") + ". Last valid hash: " + (d.lastHash || "").slice(0, 16) + "…";
      }
    } catch (e) {
      auditVerify.textContent = "Error: " + (e?.message || e);
    }
  };

  loadSecurityConfig();
})();
