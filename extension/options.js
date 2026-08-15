import { getBestLanguage, translations } from "./i18n.js";

document.addEventListener("DOMContentLoaded", async () => {
  const radioModes = document.querySelectorAll('input[name="storageMode"]');
  const enableHistoryInput = document.getElementById("enableHistory");
  const includeViewerInput = document.getElementById("includeViewer");
  const rowViewer = document.getElementById("rowViewer");
  const btnSave = document.getElementById("btnSave");
  const saveStatus = document.getElementById("saveStatus");
  const btnHistory = document.getElementById("btnOpenLocalDashboard");
  const langSelect = document.getElementById("langSelect");

  const installCommand = document.getElementById("installCommand");
  const btnCopyInstall = document.getElementById("btnCopyInstall");
  const copyInstallText = document.getElementById("copyInstallText");

  // Pro & License elements
  const planPill = document.getElementById("planPill");
  const proFreeView = document.getElementById("proFreeView");
  const proActiveView = document.getElementById("proActiveView");
  const proUserEmail = document.getElementById("proUserEmail");
  const btnToggleLicenseInput = document.getElementById("btnToggleLicenseInput");
  const licenseInputRow = document.getElementById("licenseInputRow");
  const licenseKeyInput = document.getElementById("licenseKeyInput");
  const btnActivateLicense = document.getElementById("btnActivateLicense");
  const btnDeactivateLicense = document.getElementById("btnDeactivateLicense");
  const btnManageSub = document.getElementById("btnManageSub");

  const CLOUD_ENDPOINT = "https://pinar.dev";
  const MAC_LINUX_CMD = "curl -fsSL https://pinar.dev/install.sh | sh";
  const WIN_CMD = "irm https://pinar.dev/install.ps1 | iex";

  // Detect Operating System
  let isWindows = false;
  try {
    const platform = await new Promise((resolve) => {
      if (chrome.runtime?.getPlatformInfo) {
        chrome.runtime.getPlatformInfo((info) => resolve(info?.os));
      } else {
        resolve(null);
      }
    });
    isWindows = platform === "win" || /win/i.test(navigator.userAgent || navigator.platform || "");
  } catch {
    isWindows = /win/i.test(navigator.userAgent || navigator.platform || "");
  }

  if (installCommand) {
    installCommand.textContent = isWindows ? WIN_CMD : MAC_LINUX_CMD;
  }

  // Load saved settings
  const settings = await chrome.storage.sync.get({
    cloudUrl: "https://pinar.dev",
    enableHistory: true,
    includeViewer: true,
    language: "",
    licenseKey: "",
    storageMode: "local",
    userEmail: "",
    userPlan: "free",
  });

  if (!settings.cloudUrl || settings.cloudUrl.includes("workers.dev") || settings.cloudUrl.includes("djalmajr.dev")) {
    settings.cloudUrl = "https://pinar.dev";
    chrome.storage.sync.set({ cloudUrl: "https://pinar.dev" });
  }

  const currentLang = getBestLanguage(settings.language);
  if (langSelect) langSelect.value = currentLang;
  applyTranslations(currentLang);

  function applyTranslations(lang) {
    const t = translations[lang] || translations.en;
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (t[key]) {
        el.textContent = t[key];
      }
    });
    if (licenseKeyInput && t.license_placeholder) {
      licenseKeyInput.placeholder = t.license_placeholder;
    }
    updatePlanUi(settings.userPlan, settings.userEmail);
    document.documentElement.lang = lang;
  }

  function updatePlanUi(plan, email = "") {
    const lang = langSelect?.value || "en";
    const t = translations[lang] || translations.en;
    if (plan === "pro") {
      if (planPill) {
        planPill.textContent = t.plan_pro || "Pro Plan (Permanent Retention)";
        planPill.className = "plan-pill pro";
      }
      if (proFreeView) proFreeView.style.display = "none";
      if (proActiveView) proActiveView.style.display = "block";
      if (proUserEmail) proUserEmail.textContent = email || "Pro Subscriber";
    } else {
      if (planPill) {
        planPill.textContent = t.plan_free || "Free (7-Day Retention)";
        planPill.className = "plan-pill";
      }
      if (proFreeView) proFreeView.style.display = "block";
      if (proActiveView) proActiveView.style.display = "none";
    }
  }

  // Verify license key with remote worker
  if (settings.licenseKey) {
    try {
      const res = await fetch(`${CLOUD_ENDPOINT}/api/auth/verify?key=${encodeURIComponent(settings.licenseKey)}`);
      const data = await res.json();
      if (data.ok && data.plan === "pro") {
        settings.userPlan = "pro";
        settings.userEmail = data.email || "";
        await chrome.storage.sync.set({ userEmail: settings.userEmail, userPlan: "pro" });
      } else {
        settings.userPlan = "free";
        await chrome.storage.sync.set({ userPlan: "free" });
      }
    } catch {
      /* network offline, keep cached plan */
    }
    updatePlanUi(settings.userPlan, settings.userEmail);
  }

  // Toggle License Input Form
  btnToggleLicenseInput?.addEventListener("click", () => {
    if (!licenseInputRow) return;
    const isHidden = licenseInputRow.style.display === "none";
    licenseInputRow.style.display = isHidden ? "flex" : "none";
    if (isHidden && licenseKeyInput) {
      licenseKeyInput.focus();
    }
  });

  // Activate License Key
  btnActivateLicense?.addEventListener("click", async () => {
    const key = licenseKeyInput?.value?.trim();
    const lang = langSelect?.value || "en";
    const t = translations[lang] || translations.en;

    if (!key) return;
    const origText = btnActivateLicense.textContent;
    btnActivateLicense.textContent = "…";
    btnActivateLicense.disabled = true;

    try {
      const res = await fetch(`${CLOUD_ENDPOINT}/api/auth/verify?key=${encodeURIComponent(key)}`);
      const data = await res.json();

      if (data.ok && data.plan === "pro") {
        settings.licenseKey = key;
        settings.userPlan = "pro";
        settings.userEmail = data.email || "";

        await chrome.storage.sync.set({
          cloudToken: key,
          licenseKey: key,
          userEmail: settings.userEmail,
          userPlan: "pro",
        });

        updatePlanUi("pro", settings.userEmail);
        alert(t.license_activated || "Pro Activated!");
      } else {
        alert(t.license_invalid || "Invalid license key. Please check and try again.");
      }
    } catch (err) {
      alert("Error connecting to server: " + err.message);
    } finally {
      btnActivateLicense.textContent = origText;
      btnActivateLicense.disabled = false;
    }
  });

  // Deactivate License Key
  btnDeactivateLicense?.addEventListener("click", async () => {
    settings.licenseKey = "";
    settings.userPlan = "free";
    settings.userEmail = "";
    if (licenseKeyInput) licenseKeyInput.value = "";

    await chrome.storage.sync.set({
      cloudToken: "",
      licenseKey: "",
      userEmail: "",
      userPlan: "free",
    });

    updatePlanUi("free");
  });

  // Manage Subscription (Stripe Portal)
  btnManageSub?.addEventListener("click", async () => {
    if (!settings.licenseKey) return;
    const origText = btnManageSub.textContent;
    btnManageSub.textContent = "Opening…";
    btnManageSub.disabled = true;

    try {
      const res = await fetch(`${CLOUD_ENDPOINT}/api/stripe/portal`, {
        body: JSON.stringify({ licenseKey: settings.licenseKey }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = await res.json();
      if (data.url) {
        window.open(data.url, "_blank");
      } else {
        alert("Could not open billing portal: " + (data.error || "unknown error"));
      }
    } catch (err) {
      alert("Network error: " + err.message);
    } finally {
      btnManageSub.textContent = origText;
      btnManageSub.disabled = false;
    }
  });

  langSelect?.addEventListener("change", async () => {
    const selectedLang = langSelect.value;
    applyTranslations(selectedLang);
    await chrome.storage.sync.set({ language: selectedLang });
  });

  btnCopyInstall?.addEventListener("click", async (e) => {
    e.stopPropagation();
    const cmd = installCommand?.textContent || (isWindows ? WIN_CMD : MAC_LINUX_CMD);
    const t = translations[langSelect?.value || "en"] || translations.en;
    try {
      await navigator.clipboard.writeText(cmd);
      if (copyInstallText) copyInstallText.textContent = t.status_copied || "Copied!";
      setTimeout(() => {
        if (copyInstallText) copyInstallText.textContent = t.btn_copy || "Copy";
      }, 2000);
    } catch {
      /* clipboard write failed */
    }
  });

  function updateHistoryButton(mode) {
    if (!btnHistory) return;
    if (mode === "cloud") {
      btnHistory.href = `${CLOUD_ENDPOINT}/history`;
      btnHistory.title = "Open Remote History Dashboard";
    } else {
      btnHistory.href = "http://127.0.0.1:17373/history";
      btnHistory.title = "Open Local History Dashboard";
    }
  }

  function updateSelectionUi() {
    const selected = document.querySelector('input[name="storageMode"]:checked')?.value || "local";
    if (rowViewer) {
      rowViewer.style.display = selected === "cloud" ? "flex" : "none";
    }
    updateHistoryButton(selected);
  }

  enableHistoryInput.checked = settings.enableHistory !== false;
  includeViewerInput.checked = settings.includeViewer !== false;

  const initialRadio = document.querySelector(`input[name="storageMode"][value="${settings.storageMode}"]`);
  if (initialRadio) {
    initialRadio.checked = true;
  }

  updateSelectionUi();

  radioModes.forEach((radio) => {
    radio.addEventListener("change", updateSelectionUi);
  });

  btnSave.addEventListener("click", async () => {
    const storageMode = document.querySelector('input[name="storageMode"]:checked')?.value || "local";
    const enableHistory = enableHistoryInput.checked;
    const includeViewer = includeViewerInput.checked;
    const language = langSelect?.value || "en";
    const t = translations[language] || translations.en;

    await chrome.storage.sync.set({
      cloudUrl: CLOUD_ENDPOINT,
      enableHistory,
      includeViewer,
      language,
      storageMode,
    });

    updateHistoryButton(storageMode);

    saveStatus.textContent = t.status_saved || "Saved!";
    saveStatus.className = "status-msg ok";
    setTimeout(() => {
      saveStatus.textContent = "";
    }, 2000);
  });
});
