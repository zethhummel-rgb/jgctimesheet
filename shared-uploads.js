(function() {
  "use strict";

  const VERSION = "1";
  const MB = 1024 * 1024;
  const TUS_LOCAL_URL = "vendor/tus.min.js?v=1";
  const TUS_FALLBACK_URL = "https://cdn.jsdelivr.net/npm/tus-js-client@4.3.1/dist/tus.min.js";
  const BUCKET_RULES = {
    announcements: { maxBytes: 10 * MB, types: ["application/pdf"], label: "PDF" },
    certificates: { maxBytes: 10 * MB, types: ["application/pdf", "image/jpeg", "image/png"], label: "PDF, JPG, or PNG" },
    "digital-po-temp": { maxBytes: 12 * MB, types: ["application/pdf", "image/jpeg", "image/png", "image/webp"], label: "PDF, JPG, PNG, or WebP" },
    "equipment-documents": { maxBytes: 25 * MB, types: ["application/pdf"], label: "PDF" },
    "incident-photos": { maxBytes: 10 * MB, types: ["image/*"], label: "photo" },
    policies: { maxBytes: 10 * MB, types: ["application/pdf"], label: "PDF" },
    "profile-photos": { maxBytes: 5 * MB, types: ["image/*"], label: "photo" },
    "toolbox-talks": { maxBytes: 10 * MB, types: ["application/pdf"], label: "PDF" }
  };
  const INPUT_RULES = {
    adminCertificateFile: { bucket: "certificates" },
    certificateFile: { bucket: "certificates" },
    announcementFile: { bucket: "announcements" },
    policyFile: { bucket: "policies" },
    toolboxTalkFile: { bucket: "toolbox-talks" },
    profilePhotoFile: { bucket: "profile-photos" },
    equipmentManualFiles: { bucket: "equipment-documents" },
    equipmentYearlyInspectionFile: { bucket: "equipment-documents" },
    poReceiptInput: {
      bucket: "digital-po-temp",
      maxBytes: 12 * MB,
      types: ["image/jpeg", "image/png", "image/webp"],
      label: "JPG, PNG, or WebP photo"
    }
  };
  const state = {
    projectUrl: "",
    publishableKey: "",
    createClient: null,
    tusPromise: null,
    objectUrls: new WeakMap()
  };

  function reportDiagnostic(options) {
    if (typeof window.logJgcDiagnostic === "function") {
      window.logJgcDiagnostic(options);
    }
  }

  function configure(options) {
    const config = options || {};
    state.projectUrl = String(config.projectUrl || state.projectUrl || "").replace(/\/$/, "");
    state.publishableKey = String(config.publishableKey || state.publishableKey || "");
    state.createClient = typeof config.createClient === "function" ? config.createClient : state.createClient;
    enhanceKnownInputs();
    return api;
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (!bytes) {
      return "0 B";
    }
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const amount = bytes / Math.pow(1024, index);
    return amount.toFixed(index === 0 || amount >= 10 ? 0 : 1) + " " + units[index];
  }

  function fileExtension(file) {
    const name = String(file && file.name || "").toLowerCase();
    const match = name.match(/\.([a-z0-9]+)$/);
    return match ? match[1] : "";
  }

  function isImageFile(file) {
    const type = String(file && file.type || "").toLowerCase();
    return type.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"].includes(fileExtension(file));
  }

  function isPdfFile(file) {
    return String(file && file.type || "").toLowerCase() === "application/pdf" || fileExtension(file) === "pdf";
  }

  function matchesAllowedType(file, allowedTypes) {
    const type = String(file && file.type || "").toLowerCase();
    return (allowedTypes || []).some((allowed) => {
      const expected = String(allowed || "").toLowerCase();
      if (expected === "image/*") {
        return isImageFile(file);
      }
      if (expected === "application/pdf") {
        return isPdfFile(file);
      }
      return type === expected;
    });
  }

  function getInputRule(input, overrides) {
    const inputRule = input && INPUT_RULES[input.id] ? INPUT_RULES[input.id] : {};
    const options = overrides || {};
    const bucket = String(options.bucket || inputRule.bucket || "");
    const bucketRule = BUCKET_RULES[bucket] || {};
    const pathname = String(window.location && window.location.pathname || "").toLowerCase();
    let pageRule = {};

    if (input && input.id === "photos") {
      pageRule = pathname.includes("incident-report")
        ? { bucket: "incident-photos", maxBytes: 10 * MB, types: ["image/*"], label: "photo" }
        : { maxBytes: 10 * MB, types: ["image/*"], label: "photo" };
    }

    return Object.assign({}, bucketRule, inputRule, pageRule, options, {
      bucket: String(options.bucket || pageRule.bucket || bucket)
    });
  }

  function validateFile(file, options) {
    const rule = getInputRule(options && options.input, options);
    if (!file) {
      return { valid: false, error: "Choose a file first.", rule };
    }
    if (!Number(file.size || 0)) {
      return { valid: false, error: (file.name || "The selected file") + " is empty.", rule };
    }
    if (rule.maxBytes && file.size > rule.maxBytes) {
      return {
        valid: false,
        error: (file.name || "The selected file") + " is " + formatBytes(file.size) + ". The limit is " + formatBytes(rule.maxBytes) + ".",
        rule
      };
    }
    if (rule.types && rule.types.length && !matchesAllowedType(file, rule.types)) {
      return {
        valid: false,
        error: (file.name || "The selected file") + " is not an accepted " + (rule.label || "file type") + ".",
        rule
      };
    }
    return { valid: true, error: "", rule };
  }

  function validateFiles(files, options) {
    const list = Array.from(files || []);
    if (!list.length) {
      return { valid: false, error: "Choose a file first.", files: [] };
    }
    for (const file of list) {
      const result = validateFile(file, options);
      if (!result.valid) {
        return Object.assign(result, { files: list });
      }
    }
    return { valid: true, error: "", files: list, rule: getInputRule(options && options.input, options) };
  }

  function getAssistant(input) {
    if (!input) {
      return null;
    }
    const id = input.getAttribute("data-jgc-upload-assistant-id");
    return id ? document.getElementById(id) : null;
  }

  function createAssistant(input) {
    if (!input || getAssistant(input)) {
      return getAssistant(input);
    }
    const id = "jgc-upload-assistant-" + Math.random().toString(36).slice(2, 10);
    const panel = document.createElement("div");
    panel.id = id;
    panel.className = "jgc-upload-assistant";
    panel.setAttribute("aria-live", "polite");
    panel.innerHTML = [
      '<div class="jgc-upload-preview" hidden></div>',
      '<div class="jgc-upload-status-row">',
      '  <span class="jgc-upload-status">No file selected.</span>',
      '  <button class="jgc-upload-retry" type="button" hidden>Retry</button>',
      "</div>",
      '<div class="jgc-upload-progress" hidden>',
      '  <div class="jgc-upload-progress-track"><span></span></div>',
      '  <strong class="jgc-upload-progress-label">0%</strong>',
      "</div>"
    ].join("");
    input.setAttribute("data-jgc-upload-assistant-id", id);
    input.insertAdjacentElement("afterend", panel);
    panel.querySelector(".jgc-upload-retry").addEventListener("click", async function() {
      const retry = panel._jgcRetry;
      if (typeof retry !== "function") {
        return;
      }
      this.disabled = true;
      this.hidden = true;
      setInputStatus(input, "Retrying upload...", "uploading");
      try {
        await retry();
      } catch (error) {
        setInputStatus(input, friendlyError(error, "Upload could not be retried."), "error", retry);
      } finally {
        this.disabled = false;
      }
    });
    return panel;
  }

  function revokePreviews(input) {
    const urls = state.objectUrls.get(input) || [];
    urls.forEach((url) => URL.revokeObjectURL(url));
    state.objectUrls.delete(input);
  }

  function renderPreviews(input, files) {
    const panel = createAssistant(input);
    const preview = panel && panel.querySelector(".jgc-upload-preview");
    if (!preview) {
      return;
    }
    revokePreviews(input);
    preview.innerHTML = "";
    const urls = [];
    Array.from(files || []).forEach((file) => {
      const item = document.createElement("div");
      item.className = "jgc-upload-preview-item";
      if (isImageFile(file) && !["heic", "heif"].includes(fileExtension(file))) {
        const url = URL.createObjectURL(file);
        urls.push(url);
        const image = document.createElement("img");
        image.src = url;
        image.alt = "Preview of " + (file.name || "selected photo");
        item.appendChild(image);
      } else {
        const icon = document.createElement("span");
        icon.className = "jgc-upload-file-icon";
        icon.textContent = isPdfFile(file) ? "PDF" : "FILE";
        item.appendChild(icon);
      }
      const details = document.createElement("span");
      details.className = "jgc-upload-file-details";
      const name = document.createElement("strong");
      name.textContent = file.name || "Selected file";
      const size = document.createElement("small");
      size.textContent = formatBytes(file.size);
      details.append(name, size);
      item.appendChild(details);
      preview.appendChild(item);
    });
    state.objectUrls.set(input, urls);
    preview.hidden = !files || !files.length;
  }

  function setInputProgress(input, percent) {
    const panel = createAssistant(input);
    if (!panel) {
      return;
    }
    const progress = panel.querySelector(".jgc-upload-progress");
    const bar = panel.querySelector(".jgc-upload-progress-track span");
    const label = panel.querySelector(".jgc-upload-progress-label");
    const value = Math.max(0, Math.min(100, Math.round(Number(percent || 0))));
    progress.hidden = false;
    bar.style.width = value + "%";
    label.textContent = value + "%";
  }

  function setInputStatus(input, message, kind, retry) {
    const panel = createAssistant(input);
    if (!panel) {
      return;
    }
    panel.dataset.state = kind || "ready";
    panel.querySelector(".jgc-upload-status").textContent = String(message || "");
    const retryButton = panel.querySelector(".jgc-upload-retry");
    panel._jgcRetry = typeof retry === "function" ? retry : null;
    retryButton.hidden = !panel._jgcRetry;
    if (kind !== "uploading") {
      panel.querySelector(".jgc-upload-progress").hidden = true;
    }
  }

  function handleSelection(input, options) {
    const files = Array.from(input && input.files || []);
    renderPreviews(input, files);
    if (!files.length) {
      input.setCustomValidity("");
      setInputStatus(input, "No file selected.", "ready");
      return;
    }
    const result = validateFiles(files, Object.assign({}, options, { input }));
    input.setCustomValidity(result.valid ? "" : result.error);
    if (!result.valid) {
      setInputStatus(input, result.error, "error");
      return;
    }
    const total = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
    setInputStatus(input, files.length + " file" + (files.length === 1 ? "" : "s") + " ready (" + formatBytes(total) + ").", "ready");
  }

  function enhanceFileInput(input, options) {
    if (!input || String(input.type || "").toLowerCase() !== "file") {
      return null;
    }
    const rule = getInputRule(input, options);
    if (!rule.maxBytes && !(rule.types && rule.types.length)) {
      return null;
    }
    input._jgcUploadOptions = Object.assign({}, input._jgcUploadOptions || {}, options || {});
    const panel = createAssistant(input);
    if (input.files && input.files.length) {
      handleSelection(input, input._jgcUploadOptions);
    }
    return panel;
  }

  function enhanceKnownInputs(root) {
    const scope = root && root.querySelectorAll ? root : document;
    Object.keys(INPUT_RULES).forEach((id) => {
      const input = scope.querySelector ? scope.querySelector("#" + id) : null;
      if (input) {
        enhanceFileInput(input, INPUT_RULES[id]);
      }
    });
    const photoInput = scope.querySelector ? scope.querySelector("#photos") : null;
    if (photoInput) {
      enhanceFileInput(photoInput, getInputRule(photoInput));
    }
  }

  function friendlyError(error, fallback) {
    const message = String(error && error.message || error || fallback || "Upload failed.").trim();
    if (/failed to fetch|networkerror|network request failed|load failed/i.test(message)) {
      return "The upload lost its internet connection. Check the connection and choose Retry.";
    }
    if (/jwt|session|auth|unauthorized|401/i.test(message)) {
      return "Your sign-in expired before the upload finished. Sign in again, then retry.";
    }
    if (/payload too large|maximum allowed size|413/i.test(message)) {
      return "The file is larger than the storage limit.";
    }
    if (/mime|content.?type|not supported|415/i.test(message)) {
      return "That file type is not accepted for this upload.";
    }
    if (/object not found|not found/i.test(message)) {
      return "The file was not found in secure storage. Refresh the page and try again.";
    }
    return message || fallback || "Upload failed.";
  }

  function loadScript(source) {
    if (typeof window.loadJgcScriptOnce === "function") {
      return window.loadJgcScriptOnce(source, "tus");
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.async = true;
      script.src = source;
      script.onload = () => window.tus ? resolve(window.tus) : reject(new Error("Upload library did not start."));
      script.onerror = () => reject(new Error("Upload library could not be loaded."));
      document.head.appendChild(script);
    });
  }

  function ensureTus() {
    if (window.tus && window.tus.Upload) {
      return Promise.resolve(window.tus);
    }
    if (!state.tusPromise) {
      state.tusPromise = loadScript(TUS_LOCAL_URL)
        .catch(() => loadScript(TUS_FALLBACK_URL))
        .catch((error) => {
          state.tusPromise = null;
          throw error;
        });
    }
    return state.tusPromise;
  }

  function resolveClient(client) {
    if (client) {
      return client;
    }
    return typeof state.createClient === "function" ? state.createClient() : null;
  }

  function getProjectUrl(client) {
    return String(state.projectUrl || client && client.supabaseUrl || "").replace(/\/$/, "");
  }

  function getTusEndpoint(projectUrl) {
    const url = new URL(projectUrl);
    const projectRef = url.hostname.split(".")[0];
    return "https://" + projectRef + ".storage.supabase.co/storage/v1/upload/resumable";
  }

  async function getAccessToken(client) {
    if (!client || !client.auth || typeof client.auth.getSession !== "function") {
      throw new Error("Supabase is not available for this upload.");
    }
    const result = await client.auth.getSession();
    if (result.error) {
      throw result.error;
    }
    const token = result.data && result.data.session && result.data.session.access_token;
    if (!token) {
      throw new Error("Your sign-in session was not found. Sign in again before uploading.");
    }
    return token;
  }

  async function uploadResult(options) {
    const config = options || {};
    const input = typeof config.input === "string" ? document.getElementById(config.input) : config.input;
    const file = config.file || input && input.files && input.files[0];
    const validation = validateFile(file, Object.assign({}, config, { input }));
    const retry = typeof config.retry === "function" ? config.retry : null;

    if (input) {
      enhanceFileInput(input, config);
    }
    if (!validation.valid) {
      if (input) {
        setInputStatus(input, validation.error, "error", retry);
      }
      return { data: null, error: { message: validation.error } };
    }
    if (!config.bucket || !config.path) {
      const error = { message: "The upload destination is incomplete." };
      if (input) {
        setInputStatus(input, error.message, "error", retry);
      }
      return { data: null, error };
    }

    const client = resolveClient(config.client);
    try {
      const tus = await ensureTus();
      const accessToken = await getAccessToken(client);
      const projectUrl = getProjectUrl(client);
      if (!projectUrl) {
        throw new Error("The Supabase project URL is not available.");
      }
      if (input) {
        setInputStatus(input, "Uploading " + (file.name || "file") + "...", "uploading");
        setInputProgress(input, 0);
      }
      if (typeof config.onProgress === "function") {
        config.onProgress(0, file.size || 0, 0);
      }

      return await new Promise((resolve) => {
        const upload = new tus.Upload(file, {
          endpoint: getTusEndpoint(projectUrl),
          retryDelays: [0, 1000, 3000, 5000, 10000],
          headers: {
            authorization: "Bearer " + accessToken,
            apikey: state.publishableKey || client && client.supabaseKey || "",
            "x-upsert": config.upsert ? "true" : "false"
          },
          uploadDataDuringCreation: true,
          removeFingerprintOnSuccess: true,
          chunkSize: 6 * MB,
          metadata: {
            bucketName: String(config.bucket),
            objectName: String(config.path).replace(/^\/+/, ""),
            contentType: String(config.contentType || file.type || "application/octet-stream"),
            cacheControl: String(config.cacheControl == null ? "3600" : config.cacheControl)
          },
          fingerprint: function(uploadFile) {
            return Promise.resolve([
              "jgc",
              VERSION,
              config.bucket,
              config.path,
              uploadFile && uploadFile.name || "blob",
              uploadFile && uploadFile.size || 0,
              uploadFile && uploadFile.lastModified || 0
            ].join("-"));
          },
          onProgress: function(bytesUploaded, bytesTotal) {
            const percent = bytesTotal ? bytesUploaded / bytesTotal * 100 : 0;
            if (input) {
              setInputProgress(input, percent);
              setInputStatus(input, "Uploading " + (file.name || "file") + "...", "uploading");
              setInputProgress(input, percent);
            }
            if (typeof config.onProgress === "function") {
              config.onProgress(bytesUploaded, bytesTotal, percent);
            }
          },
          onSuccess: function() {
            if (input) {
              setInputProgress(input, 100);
              setInputStatus(input, (file.name || "File") + " uploaded successfully.", "success");
            }
            if (typeof config.onSuccess === "function") {
              config.onSuccess();
            }
            resolve({
              data: {
                path: String(config.path).replace(/^\/+/, ""),
                fullPath: String(config.bucket) + "/" + String(config.path).replace(/^\/+/, ""),
                uploadUrl: upload.url || ""
              },
              error: null
            });
          },
          onError: function(uploadError) {
            const message = friendlyError(uploadError, "Upload failed.");
            if (input) {
              setInputStatus(input, message, "error", retry);
            }
            if (typeof config.onError === "function") {
              config.onError(uploadError);
            }
            reportDiagnostic({
              severity: "error",
              category: "storage",
              event_type: "storage_upload_failed",
              source: "shared-uploads",
              message,
              record_table: config.recordTable || "",
              record_id: config.recordId || "",
              details: { bucket: config.bucket, path: config.path, file_name: file.name || "", file_size: file.size || 0, error: uploadError }
            });
            resolve({ data: null, error: { message, originalError: uploadError } });
          }
        });
        upload.start();
      });
    } catch (error) {
      const message = friendlyError(error, "Upload failed.");
      if (input) {
        setInputStatus(input, message, "error", retry);
      }
      reportDiagnostic({
        severity: "error",
        category: "storage",
        event_type: "storage_upload_failed",
        source: "shared-uploads",
        message,
        record_table: config.recordTable || "",
        record_id: config.recordId || "",
        details: { bucket: config.bucket, path: config.path, file_name: file.name || "", file_size: file.size || 0, error }
      });
      return { data: null, error: { message, originalError: error } };
    }
  }

  function normalizeStoragePath(bucket, path) {
    let value = String(path || "").trim();
    try {
      value = decodeURIComponent(value);
    } catch (error) {
      // Keep the original path when it contains a literal percent sign.
    }
    value = value.replace(/^\/+/, "");
    if (value.startsWith(bucket + "/")) {
      value = value.slice(bucket.length + 1);
    }
    return value;
  }

  function writeViewerMessage(viewer, title, message, isError) {
    if (!viewer || viewer.closed) {
      return;
    }
    const accent = isError ? "#ef5350" : "#2bd957";
    try {
      viewer.document.open();
      viewer.document.write('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + String(title || "Secure file") + '</title><style>body{margin:0;background:#06130f;color:#fff;font:16px Arial,sans-serif;display:grid;min-height:100vh;place-items:center;padding:24px;box-sizing:border-box}.box{width:min(520px,100%);border:1px solid #315046;border-top:4px solid ' + accent + ';background:#0d211a;padding:24px;box-sizing:border-box}h1{font-size:22px;margin:0 0 12px}p{line-height:1.5;margin:0;color:#d9e6df}</style></head><body><div class="box"><h1>' + String(title || "Secure file") + '</h1><p>' + String(message || "") + '</p></div></body></html>');
      viewer.document.close();
    } catch (error) {
      // The viewer may already be navigating away.
    }
  }

  async function openSignedFile(options) {
    const config = options || {};
    const bucket = String(config.bucket || "").trim();
    const path = normalizeStoragePath(bucket, config.path);
    const viewer = config.viewer === false ? null : (config.viewer || window.open("", "_blank"));
    const client = resolveClient(config.client);

    if (viewer) {
      writeViewerMessage(viewer, "Opening secure file", "Creating a fresh secure link...", false);
    }
    if (!client || !bucket || !path) {
      const message = "The secure file location is incomplete.";
      reportDiagnostic({
        severity: "error",
        category: "storage",
        event_type: "signed_storage_link_incomplete",
        source: "shared-uploads",
        message,
        details: { bucket, path }
      });
      writeViewerMessage(viewer, "File could not be opened", message, true);
      if (!viewer && typeof config.onError === "function") {
        config.onError({ message });
      }
      return { data: null, error: { message } };
    }

    try {
      const result = await client.storage.from(bucket).createSignedUrl(path, Number(config.expiresIn || 600));
      if (result.error || !result.data || !result.data.signedUrl) {
        throw result.error || new Error("A secure file link could not be created.");
      }
      if (viewer) {
        viewer.opener = null;
        viewer.location.replace(result.data.signedUrl);
      } else {
        window.location.href = result.data.signedUrl;
      }
      return result;
    } catch (error) {
      const message = friendlyError(error, "File could not be opened.");
      reportDiagnostic({
        severity: "error",
        category: "storage",
        event_type: "signed_storage_link_failed",
        source: "shared-uploads",
        message,
        record_table: config.recordTable || "",
        record_id: config.recordId || "",
        details: { bucket, path, error }
      });
      writeViewerMessage(viewer, "File could not be opened", message, true);
      if (!viewer && typeof config.onError === "function") {
        config.onError({ message, originalError: error });
      }
      return { data: null, error: { message, originalError: error } };
    }
  }

  function signedLocationFromUrl(href) {
    try {
      const url = new URL(href, window.location.href);
      const marker = "/storage/v1/object/sign/";
      const index = url.pathname.indexOf(marker);
      if (index < 0 || !/\.supabase\.co$/i.test(url.hostname)) {
        return null;
      }
      const storagePath = decodeURIComponent(url.pathname.slice(index + marker.length));
      const slash = storagePath.indexOf("/");
      if (slash <= 0) {
        return null;
      }
      return { bucket: storagePath.slice(0, slash), path: storagePath.slice(slash + 1) };
    } catch (error) {
      return null;
    }
  }

  function handleSignedLinkClick(event) {
    if (event.defaultPrevented || event.button && event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    const anchor = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!anchor || anchor.dataset.jgcSignedOpening === "off") {
      return;
    }
    const location = signedLocationFromUrl(anchor.href);
    if (!location) {
      return;
    }
    event.preventDefault();
    openSignedFile(location);
  }

  function registerInputRule(id, options) {
    if (!id) {
      return;
    }
    INPUT_RULES[id] = Object.assign({}, INPUT_RULES[id] || {}, options || {});
    const input = document.getElementById(id);
    if (input) {
      enhanceFileInput(input, INPUT_RULES[id]);
    }
  }

  document.addEventListener("change", function(event) {
    const input = event.target;
    if (!input || String(input.type || "").toLowerCase() !== "file") {
      return;
    }
    const options = input._jgcUploadOptions || INPUT_RULES[input.id] || (input.id === "photos" ? getInputRule(input) : null);
    if (!options) {
      return;
    }
    enhanceFileInput(input, options);
    handleSelection(input, options);
  });
  document.addEventListener("click", handleSignedLinkClick);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function() { enhanceKnownInputs(); }, { once: true });
  } else {
    enhanceKnownInputs();
  }

  const api = {
    version: VERSION,
    configure,
    enhanceFileInput,
    enhanceKnownInputs,
    formatBytes,
    friendlyError,
    getInputRule,
    openSignedFile,
    registerInputRule,
    setInputProgress,
    setInputStatus,
    uploadResult,
    validateFile,
    validateFiles
  };
  window.JGCUploads = api;
})();
