const GEMINI_API_KEY = "PASTE_YOUR_GEMINI_API_KEY_HERE";
// This API key setup is for local testing only. Do not publish this publicly. Move the API call to Firebase Cloud Functions before deployment.

const GEMINI_MODEL = "gemini-2.5-flash";
const API_KEY_STORAGE = "hotWheelsGeminiApiKey";
const SCANS_STORAGE = "hotWheelsSavedScans";

const imageInput = document.getElementById("imageInput");
const previewWrap = document.getElementById("previewWrap");
const previewImage = document.getElementById("previewImage");
const detectButton = document.getElementById("detectButton");
const statusMessage = document.getElementById("statusMessage");
const fieldsWrap = document.getElementById("fieldsWrap");
const jsonOutput = document.getElementById("jsonOutput");
const confidenceBadge = document.getElementById("confidenceBadge");
const copyButton = document.getElementById("copyButton");
const saveButton = document.getElementById("saveButton");
const clearButton = document.getElementById("clearButton");
const apiWarning = document.getElementById("apiWarning");
const savedScans = document.getElementById("savedScans");
const apiKeyInput = document.getElementById("apiKeyInput");
const saveKeyButton = document.getElementById("saveKeyButton");
const forgetKeyButton = document.getElementById("forgetKeyButton");

let selectedFile = null;
let currentScan = createEmptyCombinedScan();

const frontFields = ["car_name", "series_name", "series_number", "mainline_number"];
const backFields = ["toy_number", "barcode", "copyright_year", "manufacturing_country"];

document.addEventListener("DOMContentLoaded", () => {
  setupNavigation();
  setupServiceWorker();
  renderFields();
  renderJson();
  renderSavedScans();
  refreshApiKeyState();
});

imageInput.addEventListener("change", () => {
  const file = imageInput.files && imageInput.files[0];

  if (!file) {
    resetImage();
    return;
  }

  selectedFile = file;
  previewImage.src = URL.createObjectURL(file);
  previewImage.onload = () => URL.revokeObjectURL(previewImage.src);
  previewWrap.hidden = false;
  detectButton.disabled = false;
  statusMessage.textContent = "Photo ready. Choose the side, then tap Detect Details.";
});

detectButton.addEventListener("click", async () => {
  const apiKey = getSavedApiKey();

  if (!apiKey) {
    statusMessage.textContent = "Add your Gemini API key in Settings first.";
    showPage("settingsPage");
    return;
  }

  if (!selectedFile) {
    statusMessage.textContent = "Take or choose a photo first.";
    return;
  }

  detectButton.disabled = true;
  statusMessage.textContent = "Reading card details with Gemini...";

  try {
    const scanMode = getScanMode();
    const base64Image = await fileToBase64(selectedFile);
    const detected = await detectDetails(apiKey, selectedFile.type || "image/jpeg", base64Image, scanMode);

    applyDetectedDetails(detected, scanMode);
    statusMessage.textContent = "Details detected. You can edit any field before saving.";
  } catch (error) {
    console.error(error);
    statusMessage.textContent = error.message || "Scanning failed. Check your API key and internet connection.";
  } finally {
    detectButton.disabled = false;
  }
});

copyButton.addEventListener("click", async () => {
  syncFieldsToScan();
  renderJson();

  try {
    await navigator.clipboard.writeText(jsonOutput.value);
    statusMessage.textContent = "JSON copied.";
  } catch (error) {
    console.error(error);
    statusMessage.textContent = "Copy failed. You can select the JSON manually.";
  }
});

saveButton.addEventListener("click", () => {
  syncFieldsToScan();
  renderJson();

  const scans = getSavedScans();
  const scanToSave = {
    ...currentScan,
    id: currentScan.id || createScanId(),
    date_scanned: new Date().toLocaleString()
  };

  scans.unshift(scanToSave);
  localStorage.setItem(SCANS_STORAGE, JSON.stringify(scans));
  currentScan = scanToSave;
  renderSavedScans();
  statusMessage.textContent = "Scan saved locally.";
});

clearButton.addEventListener("click", () => {
  currentScan = createEmptyCombinedScan();
  resetImage();
  renderFields();
  renderJson();
  statusMessage.textContent = "Cleared.";
});

saveKeyButton.addEventListener("click", () => {
  const key = apiKeyInput.value.trim();

  if (!key) {
    statusMessage.textContent = "Paste an API key before saving.";
    return;
  }

  localStorage.setItem(API_KEY_STORAGE, key);
  refreshApiKeyState();
  statusMessage.textContent = "API key saved locally.";
  showPage("scanPage");
});

forgetKeyButton.addEventListener("click", () => {
  localStorage.removeItem(API_KEY_STORAGE);
  apiKeyInput.value = "";
  refreshApiKeyState();
  statusMessage.textContent = "API key removed.";
});

function setupNavigation() {
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.addEventListener("click", () => showPage(button.dataset.page));
  });
}

function showPage(pageId) {
  document.querySelectorAll(".page").forEach((page) => {
    page.classList.toggle("active-page", page.id === pageId);
  });

  document.querySelectorAll(".nav-button").forEach((button) => {
    button.classList.toggle("active-nav", button.dataset.page === pageId);
  });
}

function setupServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch((error) => {
      console.warn("Service worker registration failed:", error);
    });
  }
}

function refreshApiKeyState() {
  const apiKey = getSavedApiKey();
  apiWarning.hidden = Boolean(apiKey);
  apiKeyInput.value = apiKey || "";
}

function getSavedApiKey() {
  const savedKey = localStorage.getItem(API_KEY_STORAGE);

  if (savedKey) {
    return savedKey;
  }

  if (GEMINI_API_KEY && GEMINI_API_KEY !== "PASTE_YOUR_GEMINI_API_KEY_HERE") {
    return GEMINI_API_KEY;
  }

  return "";
}

function getScanMode() {
  return document.querySelector("input[name='scanMode']:checked").value;
}

function renderFields() {
  fieldsWrap.innerHTML = "";

  addFieldGroup("Front", "front", frontFields);
  addFieldGroup("Back", "back", backFields);
  updateConfidenceBadge("");
}

function addFieldGroup(title, side, fieldNames) {
  const heading = document.createElement("h3");
  heading.textContent = title;
  heading.className = "field-heading";
  fieldsWrap.appendChild(heading);

  fieldNames.forEach((fieldName) => {
    const field = document.createElement("div");
    field.className = "field";

    const label = document.createElement("label");
    label.textContent = formatLabel(fieldName);
    label.setAttribute("for", `${side}-${fieldName}`);

    const input = document.createElement("input");
    input.id = `${side}-${fieldName}`;
    input.dataset.side = side;
    input.dataset.field = fieldName;
    input.value = currentScan[side][fieldName] || "";
    input.addEventListener("input", () => {
      syncFieldsToScan();
      renderJson();
    });

    field.append(label, input);
    fieldsWrap.appendChild(field);
  });
}

function renderJson() {
  jsonOutput.value = JSON.stringify(currentScan, null, 2);
}

function syncFieldsToScan() {
  document.querySelectorAll("[data-side][data-field]").forEach((input) => {
    currentScan[input.dataset.side][input.dataset.field] = input.value.trim();
  });
}

function applyDetectedDetails(detected, scanMode) {
  const fields = scanMode === "front" ? frontFields : backFields;
  const side = scanMode === "front" ? "front" : "back";

  fields.forEach((field) => {
    currentScan[side][field] = detected[field] || "";
  });

  currentScan.id = currentScan.id || createScanId();
  currentScan.date_scanned = new Date().toLocaleString();

  renderFields();
  renderJson();
  updateConfidenceBadge(detected.confidence || "");
}

function updateConfidenceBadge(confidence) {
  confidenceBadge.textContent = confidence ? `Confidence: ${confidence}` : "Waiting";
}

function createEmptyCombinedScan() {
  return {
    id: createScanId(),
    date_scanned: new Date().toLocaleString(),
    front: {
      car_name: "",
      series_name: "",
      series_number: "",
      mainline_number: ""
    },
    back: {
      toy_number: "",
      barcode: "",
      copyright_year: "",
      manufacturing_country: ""
    },
    possible_metadata: {
      release_year: "",
      case_code: "",
      rarity: "",
      variant: "",
      match_confidence: ""
    }
  };
}

function createScanId() {
  return `scan-${Date.now()}`;
}

function resetImage() {
  selectedFile = null;
  imageInput.value = "";
  previewImage.removeAttribute("src");
  previewWrap.hidden = true;
  detectButton.disabled = true;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = reader.result || "";
      const base64Data = String(result).split(",")[1];

      if (base64Data) {
        resolve(base64Data);
      } else {
        reject(new Error("Could not convert image to base64."));
      }
    };

    reader.onerror = () => reject(new Error("Could not read the selected image."));
    reader.readAsDataURL(file);
  });
}

async function detectDetails(apiKey, imageMimeType, base64Image, scanMode) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const prompt = scanMode === "front" ? getFrontPrompt() : getBackPrompt();

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: imageMimeType,
                data: base64Image
              }
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json"
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini request failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  return parseJsonOnly(text);
}

function parseJsonOnly(text) {
  try {
    return JSON.parse(text);
  } catch (firstError) {
    const match = text.match(/\{[\s\S]*\}/);

    if (!match) {
      throw firstError;
    }

    return JSON.parse(match[0]);
  }
}

function getFrontPrompt() {
  return `Analyze this Hot Wheels FRONT card image. Extract only visible details. Do not guess. If a field is not visible, use an empty string. Return only valid JSON with this exact structure:
{
  "side": "front",
  "car_name": "",
  "series_name": "",
  "series_number": "",
  "mainline_number": "",
  "confidence": "high/medium/low",
  "notes": ""
}`;
}

function getBackPrompt() {
  return `Analyze this Hot Wheels BACK card image. Extract only visible details. Do not guess. If a field is not visible, use an empty string. Return only valid JSON with this exact structure:
{
  "side": "back",
  "toy_number": "",
  "barcode": "",
  "copyright_year": "",
  "manufacturing_country": "",
  "confidence": "high/medium/low",
  "notes": ""
}`;
}

function getSavedScans() {
  try {
    return JSON.parse(localStorage.getItem(SCANS_STORAGE)) || [];
  } catch (error) {
    console.warn("Saved scans could not be loaded:", error);
    return [];
  }
}

function renderSavedScans() {
  const scans = getSavedScans();
  savedScans.innerHTML = "";

  if (!scans.length) {
    savedScans.innerHTML = '<div class="empty-state">No saved scans yet.</div>';
    return;
  }

  scans.forEach((scan) => {
    const card = document.createElement("article");
    card.className = "saved-card";

    const title = scan.front.car_name || scan.back.toy_number || "Unnamed scan";
    card.innerHTML = `
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(scan.date_scanned || "")}</p>
      <p>Series: ${escapeHtml(scan.front.series_name || "")}</p>
      <p>Toy #: ${escapeHtml(scan.back.toy_number || "")}</p>
      <p>Barcode: ${escapeHtml(scan.back.barcode || "")}</p>
    `;

    savedScans.appendChild(card);
  });
}

function formatLabel(value) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
