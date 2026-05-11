import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  getAuth,
  inMemoryPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  setDoc,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const GEMINI_API_KEY = "AIzaSyDfFC86rHI2FT_jMYbG3u6NmCr3C2REUEE";
// This API key setup is temporary and unsafe for public deployment. Move the Gemini API call to Firebase Cloud Functions before deployment.
// Enable Email/Password provider in Firebase Console: Authentication > Sign-in method > Email/Password > Enable.
// Security rules:
// rules_version = '2';
// service cloud.firestore {
//   match /databases/{database}/documents {
//     match /users/{userId}/{document=**} {
//       allow read, write: if request.auth != null && request.auth.uid == userId;
//     }
//   }
// }

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_KEY_STORAGE = "hotWheelsCollectorGeminiKey";
const ARCHIVE_LIMIT = 20;
const CONDITIONS = [
  "Mint Carded",
  "Carded",
  "Damaged Card",
  "Loose",
  "Loose Mint",
  "Custom",
  "For Trade",
  "Sold"
];
const SORTS = [
  ["newest", "Newest first"],
  ["oldest", "Oldest first"],
  ["car_az", "Car name A-Z"],
  ["car_za", "Car name Z-A"],
  ["quantity_desc", "Quantity high to low"],
  ["mainline_asc", "Mainline number ascending"],
  ["mainline_desc", "Mainline number descending"]
];
const DETAIL_FIELDS = [
  "car_name",
  "series_name",
  "series_number",
  "mainline_number",
  "toy_number",
  "barcode",
  "copyright_year",
  "manufacturing_country"
];
const META_FIELDS = ["release_year", "case_code", "rarity", "variant", "match_confidence", "notes"];

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Require a fresh login when the app is opened.
// Firebase normally remembers users across reloads; this app intentionally does not.
await setPersistence(auth, inMemoryPersistence);
await signOut(auth);

const els = {
  loginTab: document.getElementById("loginTab"),
  registerTab: document.getElementById("registerTab"),
  authTabs: document.querySelector(".auth-tabs"),
  loginForm: document.getElementById("loginForm"),
  registerForm: document.getElementById("registerForm"),
  loginEmail: document.getElementById("loginEmail"),
  loginPassword: document.getElementById("loginPassword"),
  registerDisplayName: document.getElementById("registerDisplayName"),
  registerEmail: document.getElementById("registerEmail"),
  registerPassword: document.getElementById("registerPassword"),
  registerConfirmPassword: document.getElementById("registerConfirmPassword"),
  loginButton: document.getElementById("loginButton"),
  registerButton: document.getElementById("registerButton"),
  authMessage: document.getElementById("authMessage"),
  authStatus: document.getElementById("authStatus"),
  frontImageInput: document.getElementById("frontImageInput"),
  backImageInput: document.getElementById("backImageInput"),
  frontPreviewWrap: document.getElementById("frontPreviewWrap"),
  backPreviewWrap: document.getElementById("backPreviewWrap"),
  frontPreviewImage: document.getElementById("frontPreviewImage"),
  backPreviewImage: document.getElementById("backPreviewImage"),
  scanButton: document.getElementById("scanButton"),
  scanStatus: document.getElementById("scanStatus"),
  resultFields: document.getElementById("resultFields"),
  confidenceBadge: document.getElementById("confidenceBadge"),
  quantityInput: document.getElementById("quantityInput"),
  conditionInput: document.getElementById("conditionInput"),
  notesInput: document.getElementById("notesInput"),
  addCollectionButton: document.getElementById("addCollectionButton"),
  discardScanButton: document.getElementById("discardScanButton"),
  collectionList: document.getElementById("collectionList"),
  archiveList: document.getElementById("archiveList"),
  archiveCount: document.getElementById("archiveCount"),
  statsGrid: document.getElementById("statsGrid"),
  searchInput: document.getElementById("searchInput"),
  conditionFilter: document.getElementById("conditionFilter"),
  seriesFilter: document.getElementById("seriesFilter"),
  yearFilter: document.getElementById("yearFilter"),
  rarityFilter: document.getElementById("rarityFilter"),
  caseFilter: document.getElementById("caseFilter"),
  sortSelect: document.getElementById("sortSelect"),
  bottomNav: document.getElementById("bottomNav"),
  menuButton: document.getElementById("menuButton"),
  menuSheet: document.getElementById("menuSheet"),
  accountEmail: document.getElementById("accountEmail"),
  settingsGeminiKey: document.getElementById("settingsGeminiKey"),
  saveGeminiKeyButton: document.getElementById("saveGeminiKeyButton"),
  logoutButton: document.getElementById("logoutButton"),
  shareSummaryButton: document.getElementById("shareSummaryButton"),
  editDialog: document.getElementById("editDialog"),
  editFields: document.getElementById("editFields"),
  saveEditButton: document.getElementById("saveEditButton")
};

let uid = "";
let collectionItems = [];
let archiveItems = [];
let currentScan = createEmptyScan();
let editingItemId = "";
let frontImageDataUrl = "";
let backImageDataUrl = "";
let currentUser = null;
let allowAppSession = false;
let registeringUser = false;
let pendingAuthMessage = "";
let appStarted = false;

function startApp() {
  if (appStarted) return;
  appStarted = true;

  fillSelects();
  setupNavigation();
  setupEvents();
  setupServiceWorker();
  renderResultForm();
  loadGeminiKeyInput();
}

// Module scripts usually run before DOMContentLoaded, but this app also awaits
// Firebase setup. This keeps the buttons wired even if the DOM is already ready.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startApp);
} else {
  startApp();
}

onAuthStateChanged(auth, async (user) => {
  // Firebase may briefly report a user right after registration. Only a manual
  // login is allowed to open the scanner and the private app pages.
  if (user && !allowAppSession) {
    if (!registeringUser) {
      await signOut(auth);
    }
    return;
  }

  if (!user) {
    showSignedOutState(pendingAuthMessage || "Log in or register to continue.");
    pendingAuthMessage = "";
    return;
  }

  currentUser = user;
  uid = user.uid;
  els.bottomNav.hidden = false;
  els.authStatus.textContent = `Signed in as ${getUserLabel(user)}.`;
  els.accountEmail.textContent = `Signed in as ${getUserLabel(user)}`;
  await loadAllData();
  showPage("scanPage");
});

function setupEvents() {
  els.authTabs.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-auth-mode]");
    if (!tab) return;
    setAuthMode(tab.dataset.authMode);
  });
  els.loginButton.addEventListener("click", loginUser);
  els.registerButton.addEventListener("click", registerUser);
  els.logoutButton.addEventListener("click", logoutUser);
  els.saveGeminiKeyButton.addEventListener("click", saveGeminiKey);
  els.frontImageInput.addEventListener("change", () => handleImagePick("front"));
  els.backImageInput.addEventListener("change", () => handleImagePick("back"));
  els.scanButton.addEventListener("click", scanAndIdentify);
  els.addCollectionButton.addEventListener("click", addToCollection);
  els.discardScanButton.addEventListener("click", discardScan);
  els.shareSummaryButton.addEventListener("click", shareCollectionSummary);
  els.saveEditButton.addEventListener("click", saveEditedItem);

  [els.searchInput, els.conditionFilter, els.seriesFilter, els.yearFilter, els.rarityFilter, els.caseFilter, els.sortSelect]
    .forEach((input) => input.addEventListener("input", renderCollection));

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;

    const id = button.dataset.id;
    const action = button.dataset.action;

    if (action === "edit") openEditDialog(id);
    if (action === "archive") archiveItem(id);
    if (action === "restore") restoreItem(id);
    if (action === "delete") permanentlyDeleteArchiveItem(id);
    if (action === "share") shareItem(id);
  });
}

function setupNavigation() {
  document.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => showPage(button.dataset.page));
  });

  els.menuButton.addEventListener("click", () => {
    const isOpen = !els.menuSheet.hidden;
    els.menuSheet.hidden = isOpen;
    els.menuButton.setAttribute("aria-expanded", String(!isOpen));
  });
}

function setupServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch(console.warn);
  }
}

function fillSelects() {
  els.conditionInput.innerHTML = CONDITIONS.map((condition) => `<option>${condition}</option>`).join("");
  els.conditionFilter.innerHTML = `<option value="">All conditions</option>${CONDITIONS.map((condition) => `<option>${condition}</option>`).join("")}`;
  els.sortSelect.innerHTML = SORTS.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
}

function setAuthMode(mode) {
  const isLogin = mode === "login";
  els.loginForm.hidden = !isLogin;
  els.registerForm.hidden = isLogin;
  els.loginTab.classList.toggle("active-auth-tab", isLogin);
  els.registerTab.classList.toggle("active-auth-tab", !isLogin);
  els.loginTab.setAttribute("aria-selected", String(isLogin));
  els.registerTab.setAttribute("aria-selected", String(!isLogin));
  els.authMessage.textContent = "";
}

async function loginUser() {
  const email = els.loginEmail.value.trim();
  const password = els.loginPassword.value;

  if (!email || !password) {
    els.authMessage.textContent = "Enter your email and password.";
    return;
  }

  els.authMessage.textContent = "Logging in...";
  try {
    allowAppSession = true;
    await signInWithEmailAndPassword(auth, email, password);
    els.loginPassword.value = "";
    els.authMessage.textContent = "Logged in.";
  } catch (error) {
    allowAppSession = false;
    els.authMessage.textContent = formatAuthError(error);
  }
}

async function registerUser() {
  const displayName = els.registerDisplayName.value.trim();
  const email = els.registerEmail.value.trim();
  const password = els.registerPassword.value;
  const confirmPassword = els.registerConfirmPassword.value;
  const validationError = validateRegistration(displayName, email, password, confirmPassword);

  if (validationError) {
    els.authMessage.textContent = validationError;
    return;
  }

  els.authMessage.textContent = "Creating account...";
  registeringUser = true;
  try {
    const successMessage = "Registration successful. Please login.";
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(credential.user, { displayName });
    await createUserProfile(credential.user, displayName);
    pendingAuthMessage = successMessage;
    allowAppSession = false;
    // Firebase signs in new accounts automatically. We sign out here so the
    // scanner stays locked until the user returns to the Login tab.
    await signOut(auth);
    setAuthMode("login");
    els.registerDisplayName.value = "";
    els.registerEmail.value = "";
    els.registerPassword.value = "";
    els.registerConfirmPassword.value = "";
    els.authMessage.textContent = successMessage;
  } catch (error) {
    allowAppSession = false;
    if (auth.currentUser) {
      await signOut(auth);
    }
    els.authMessage.textContent = formatAuthError(error);
  } finally {
    registeringUser = false;
  }
}

async function logoutUser() {
  allowAppSession = false;
  await signOut(auth);
}

async function createUserProfile(user, displayName) {
  await setDoc(doc(db, "users", user.uid, "profile", "main"), {
    uid: user.uid,
    displayName,
    email: user.email || "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

function validateRegistration(displayName, email, password, confirmPassword) {
  if (!displayName) return "Display name is required.";
  if (!email) return "Email is required.";
  if (!password) return "Password is required.";
  if (!confirmPassword) return "Confirm password is required.";
  if (password.length < 6) return "Password must be at least 6 characters.";
  if (password !== confirmPassword) return "Confirm password must match password.";
  return "";
}

function loadGeminiKeyInput() {
  els.settingsGeminiKey.value = localStorage.getItem(GEMINI_KEY_STORAGE) || GEMINI_API_KEY;
}

function saveGeminiKey() {
  if (!requireSignedIn()) return;

  const key = els.settingsGeminiKey.value.trim();
  if (!key) {
    els.authStatus.textContent = "Enter a Gemini API key before saving.";
    return;
  }

  localStorage.setItem(GEMINI_KEY_STORAGE, key);
  els.authStatus.textContent = "Gemini API key saved in this browser.";
}

function getGeminiApiKey() {
  return localStorage.getItem(GEMINI_KEY_STORAGE) || GEMINI_API_KEY;
}

async function handleImagePick(side) {
  if (!requireSignedIn()) return;

  const input = side === "front" ? els.frontImageInput : els.backImageInput;
  const file = input.files && input.files[0];
  if (!file) return;

  const dataUrl = await compressImage(file, 1200, 0.72);
  if (side === "front") {
    frontImageDataUrl = dataUrl;
    els.frontPreviewImage.src = dataUrl;
    els.frontPreviewWrap.hidden = false;
  } else {
    backImageDataUrl = dataUrl;
    els.backPreviewImage.src = dataUrl;
    els.backPreviewWrap.hidden = false;
  }

  els.scanButton.disabled = !(frontImageDataUrl && backImageDataUrl);
  els.scanStatus.textContent = frontImageDataUrl && backImageDataUrl ? "Both photos ready." : "Add the other card photo.";
}

async function scanAndIdentify() {
  if (!requireSignedIn()) return;

  if (!frontImageDataUrl || !backImageDataUrl) {
    els.scanStatus.textContent = "Add both front and back photos first.";
    return;
  }

  els.scanButton.disabled = true;
  els.scanStatus.textContent = "Sending both card photos to Gemini...";

  try {
    const result = await detectWithGemini(getGeminiApiKey(), frontImageDataUrl, backImageDataUrl);
    if (!requireSignedIn()) return;
    currentScan.details = { ...currentScan.details, ...(result.details || {}) };
    currentScan.possible_metadata = { ...currentScan.possible_metadata, ...(result.possible_metadata || {}) };
    await saveDetectedScanResult();
    renderResultForm();
    els.confidenceBadge.textContent = `Confidence: ${currentScan.possible_metadata.match_confidence || "low"}`;
    els.scanStatus.textContent = "Scan complete and saved to scans. Review and edit before adding.";
  } catch (error) {
    showError(error);
  } finally {
    els.scanButton.disabled = false;
  }
}

async function detectWithGemini(apiKey, frontDataUrl, backDataUrl) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: getGeminiPrompt() },
            dataUrlToInlineData(frontDataUrl),
            dataUrlToInlineData(backDataUrl)
          ]
        }
      ],
      generationConfig: { responseMimeType: "application/json" }
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini request failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return parseJsonOnly(data.candidates?.[0]?.content?.parts?.[0]?.text || "{}");
}

async function addToCollection() {
  if (!requireSignedIn()) return;

  syncScanForm();
  const item = {
    uid: currentUser.uid,
    ownerEmail: currentUser.email || "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    frontImageDataUrl,
    backImageDataUrl,
    details: currentScan.details,
    possible_metadata: currentScan.possible_metadata,
    quantity: Math.max(1, Number(els.quantityInput.value) || 1),
    condition: els.conditionInput.value,
    user_notes: els.notesInput.value.trim(),
    status: "active"
  };

  const ref = await addDoc(collection(db, "users", uid, "collection"), item);
  await updateDoc(ref, { id: ref.id });
  els.scanStatus.textContent = "Added to collection.";
  discardScan();
  await loadAllData();
  showPage("collectionPage");
}

async function saveDetectedScanResult() {
  if (!requireSignedIn()) return;

  await addDoc(collection(db, "users", currentUser.uid, "scans"), {
    uid: currentUser.uid,
    ownerEmail: currentUser.email || "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    frontImageDataUrl,
    backImageDataUrl,
    details: currentScan.details,
    possible_metadata: currentScan.possible_metadata,
    status: "detected"
  });
}

async function archiveItem(id) {
  if (!requireSignedIn()) return;
  const item = collectionItems.find((entry) => entry.id === id);
  if (!item || !uid) return;

  await addDoc(collection(db, "users", uid, "archive"), {
    ...stripFirestoreOnlyFields(item),
    id: item.id,
    status: "archived",
    archivedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  await deleteDoc(doc(db, "users", uid, "collection", id));
  await trimArchive();
  await loadAllData();
}

async function restoreItem(id) {
  if (!requireSignedIn()) return;
  const item = archiveItems.find((entry) => entry.id === id);
  if (!item || !uid) return;

  const ref = await addDoc(collection(db, "users", uid, "collection"), {
    ...stripFirestoreOnlyFields(item),
    status: "active",
    updatedAt: serverTimestamp()
  });
  await updateDoc(ref, { id: ref.id });
  await deleteDoc(doc(db, "users", uid, "archive", id));
  await loadAllData();
}

async function permanentlyDeleteArchiveItem(id) {
  if (!requireSignedIn()) return;
  if (!uid) return;
  await deleteDoc(doc(db, "users", uid, "archive", id));
  await loadAllData();
}

async function trimArchive() {
  const snap = await getDocs(query(collection(db, "users", uid, "archive"), orderBy("archivedAt", "desc")));
  const docsToDelete = snap.docs.slice(ARCHIVE_LIMIT);
  await Promise.all(docsToDelete.map((oldDoc) => deleteDoc(oldDoc.ref)));
}

async function loadAllData() {
  if (!uid) return;

  const collectionSnap = await getDocs(query(collection(db, "users", uid, "collection"), orderBy("createdAt", "desc")));
  const archiveSnap = await getDocs(query(collection(db, "users", uid, "archive"), orderBy("archivedAt", "desc"), limit(ARCHIVE_LIMIT + 5)));

  collectionItems = collectionSnap.docs.map(fromDoc);
  archiveItems = archiveSnap.docs.map(fromDoc);

  if (archiveItems.length > ARCHIVE_LIMIT) {
    await trimArchive();
    return loadAllData();
  }

  renderCollection();
  renderArchive();
  renderStats();
}

function showSignedOutState(message = "Log in or register to continue.") {
  currentUser = null;
  uid = "";
  allowAppSession = false;
  collectionItems = [];
  archiveItems = [];
  els.bottomNav.hidden = true;
  els.menuSheet.hidden = true;
  els.menuButton.setAttribute("aria-expanded", "false");
  els.accountEmail.textContent = "Not signed in.";
  els.authStatus.textContent = "Please login first.";
  els.authMessage.textContent = message;
  discardScan();
  renderCollection();
  renderArchive();
  renderStats();
  showPage("authPage");
}

function renderResultForm() {
  els.resultFields.innerHTML = "";
  addFormHeading(els.resultFields, "Card Details");
  DETAIL_FIELDS.forEach((field) => addInput(els.resultFields, field, currentScan.details[field], "details"));
  addFormHeading(els.resultFields, "Possible Metadata");
  META_FIELDS.forEach((field) => addInput(els.resultFields, field, currentScan.possible_metadata[field], "possible_metadata"));
}

function addFormHeading(parent, text) {
  const heading = document.createElement("h3");
  heading.className = "field-heading";
  heading.textContent = text;
  parent.appendChild(heading);
}

function addInput(parent, field, value, group) {
  const wrap = document.createElement("div");
  wrap.className = field === "notes" ? "field full-field" : "field";
  const id = `${group}-${field}`;
  wrap.innerHTML = `
    <label for="${id}">${formatLabel(field)}</label>
    <input id="${id}" data-group="${group}" data-field="${field}" value="${escapeAttribute(value || "")}" />
  `;
  parent.appendChild(wrap);
}

function syncScanForm() {
  document.querySelectorAll("#resultFields [data-group][data-field]").forEach((input) => {
    currentScan[input.dataset.group][input.dataset.field] = input.value.trim();
  });
}

function renderCollection() {
  const items = getFilteredItems();
  els.collectionList.innerHTML = items.length ? items.map(renderCollectionCard).join("") : '<div class="empty-state">No collection items match.</div>';
}

function renderArchive() {
  els.archiveCount.textContent = `Archive count: ${archiveItems.length} / ${ARCHIVE_LIMIT}`;
  els.archiveList.innerHTML = archiveItems.length ? archiveItems.map(renderArchiveCard).join("") : '<div class="empty-state">Archive is empty.</div>';
}

function renderCollectionCard(item) {
  const details = item.details || {};
  const meta = item.possible_metadata || {};
  return `
    <article class="saved-card">
      ${renderImages(item)}
      <h3>${escapeHtml(details.car_name || "Unnamed car")}</h3>
      <p>Series: ${escapeHtml(details.series_name || "")}</p>
      <p>Mainline: ${escapeHtml(details.mainline_number || "")}</p>
      <p>Toy #: ${escapeHtml(details.toy_number || "")}</p>
      <p>Quantity: ${Number(item.quantity || 1)}</p>
      <p>Condition: ${escapeHtml(item.condition || "")}</p>
      ${meta.release_year ? `<p>Release year: ${escapeHtml(meta.release_year)}</p>` : ""}
      ${meta.case_code ? `<p>Case code: ${escapeHtml(meta.case_code)}</p>` : ""}
      <div class="item-actions">
        <button class="secondary-button" data-action="edit" data-id="${item.id}" type="button">Edit</button>
        <button class="secondary-button" data-action="share" data-id="${item.id}" type="button">Share</button>
        <button class="ghost-button" data-action="archive" data-id="${item.id}" type="button">Archive/Delete</button>
      </div>
    </article>
  `;
}

function renderArchiveCard(item) {
  const details = item.details || {};
  return `
    <article class="saved-card">
      ${renderImages(item)}
      <h3>${escapeHtml(details.car_name || "Archived item")}</h3>
      <p>Series: ${escapeHtml(details.series_name || "")}</p>
      <p>Toy #: ${escapeHtml(details.toy_number || "")}</p>
      <div class="item-actions">
        <button class="secondary-button" data-action="restore" data-id="${item.id}" type="button">Restore</button>
        <button class="ghost-button" data-action="delete" data-id="${item.id}" type="button">Permanently Delete</button>
      </div>
    </article>
  `;
}

function renderImages(item) {
  return `
    <div class="thumb-row">
      ${item.frontImageDataUrl ? `<img src="${item.frontImageDataUrl}" alt="Front card">` : ""}
      ${item.backImageDataUrl ? `<img src="${item.backImageDataUrl}" alt="Back card">` : ""}
    </div>
  `;
}

function renderStats() {
  const totalUnique = collectionItems.length;
  const totalQuantity = collectionItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const mintCarded = sumByCondition("Mint Carded");
  const loose = collectionItems
    .filter((item) => ["Loose", "Loose Mint"].includes(item.condition))
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const seriesCounts = countBy((item) => item.details?.series_name || "Unknown");
  const yearCounts = countBy((item) => item.possible_metadata?.release_year || "Unknown");
  const conditionCounts = countBy((item) => item.condition || "Unknown");
  const topSeries = Object.entries(seriesCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "None";

  els.statsGrid.innerHTML = [
    statCard("Total unique cars", totalUnique),
    statCard("Total quantity", totalQuantity),
    statCard("Mint carded count", mintCarded),
    statCard("Loose count", loose),
    statCard("Most common series", topSeries),
    statCard("Collection by year", formatCounts(yearCounts)),
    statCard("Collection by condition", formatCounts(conditionCounts))
  ].join("");
}

function getFilteredItems() {
  const search = els.searchInput.value.toLowerCase().trim();
  const condition = els.conditionFilter.value;
  const series = els.seriesFilter.value.toLowerCase().trim();
  const year = els.yearFilter.value.toLowerCase().trim();
  const rarity = els.rarityFilter.value.toLowerCase().trim();
  const caseCode = els.caseFilter.value.toLowerCase().trim();

  const filtered = collectionItems.filter((item) => {
    const details = item.details || {};
    const meta = item.possible_metadata || {};
    return (!search || (details.car_name || "").toLowerCase().includes(search))
      && (!condition || item.condition === condition)
      && (!series || (details.series_name || "").toLowerCase().includes(series))
      && (!year || (meta.release_year || "").toLowerCase().includes(year))
      && (!rarity || (meta.rarity || "").toLowerCase().includes(rarity))
      && (!caseCode || (meta.case_code || "").toLowerCase().includes(caseCode));
  });

  return sortItems(filtered, els.sortSelect.value);
}

function sortItems(items, sort) {
  return [...items].sort((a, b) => {
    if (sort === "oldest") return getMillis(a.createdAt) - getMillis(b.createdAt);
    if (sort === "car_az") return (a.details?.car_name || "").localeCompare(b.details?.car_name || "");
    if (sort === "car_za") return (b.details?.car_name || "").localeCompare(a.details?.car_name || "");
    if (sort === "quantity_desc") return Number(b.quantity || 0) - Number(a.quantity || 0);
    if (sort === "mainline_asc") return numberish(a.details?.mainline_number) - numberish(b.details?.mainline_number);
    if (sort === "mainline_desc") return numberish(b.details?.mainline_number) - numberish(a.details?.mainline_number);
    return getMillis(b.createdAt) - getMillis(a.createdAt);
  });
}

function openEditDialog(id) {
  if (!requireSignedIn()) return;

  const item = collectionItems.find((entry) => entry.id === id);
  if (!item) return;

  editingItemId = id;
  els.editFields.innerHTML = "";
  addFormHeading(els.editFields, "Details");
  DETAIL_FIELDS.forEach((field) => addEditInput(field, item.details?.[field] || "", "details"));
  addFormHeading(els.editFields, "Metadata");
  META_FIELDS.forEach((field) => addEditInput(field, item.possible_metadata?.[field] || "", "possible_metadata"));
  addEditInput("quantity", item.quantity || 1, "root", "number");
  addEditSelect("condition", item.condition || "Carded");
  addEditInput("user_notes", item.user_notes || "", "root");
  els.editDialog.showModal();
}

function addEditInput(field, value, group, type = "text") {
  const wrap = document.createElement("div");
  wrap.className = field.includes("notes") ? "field full-field" : "field";
  wrap.innerHTML = `
    <label>${formatLabel(field)}</label>
    <input type="${type}" min="1" data-edit-group="${group}" data-edit-field="${field}" value="${escapeAttribute(value)}" />
  `;
  els.editFields.appendChild(wrap);
}

function addEditSelect(field, value) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  wrap.innerHTML = `
    <label>${formatLabel(field)}</label>
    <select data-edit-group="root" data-edit-field="${field}">
      ${CONDITIONS.map((condition) => `<option ${condition === value ? "selected" : ""}>${condition}</option>`).join("")}
    </select>
  `;
  els.editFields.appendChild(wrap);
}

async function saveEditedItem() {
  if (!requireSignedIn()) return;
  const item = collectionItems.find((entry) => entry.id === editingItemId);
  if (!item || !uid) return;

  const updated = stripFirestoreOnlyFields(item);
  document.querySelectorAll("[data-edit-group][data-edit-field]").forEach((input) => {
    const group = input.dataset.editGroup;
    const field = input.dataset.editField;
    const value = field === "quantity" ? Math.max(1, Number(input.value) || 1) : input.value.trim();

    if (group === "root") {
      updated[field] = value;
    } else {
      updated[group][field] = value;
    }
  });

  await updateDoc(doc(db, "users", uid, "collection", editingItemId), {
    ...updated,
    updatedAt: serverTimestamp()
  });
  els.editDialog.close();
  await loadAllData();
}

async function shareItem(id) {
  if (!requireSignedIn()) return;

  const item = collectionItems.find((entry) => entry.id === id);
  const summary = item ? buildItemSummary(item) : buildCollectionSummary();

  await shareText(summary);
}

async function shareCollectionSummary() {
  if (!requireSignedIn()) return;

  await shareText(buildCollectionSummary());
}

async function shareText(summary) {
  if (navigator.share) {
    await navigator.share({ title: "Hot Wheels Collection", text: summary });
  } else {
    await navigator.clipboard.writeText(summary);
    els.authStatus.textContent = "Collection summary copied for sharing.";
  }
}

function buildItemSummary(item) {
  const details = item.details || {};
  return `${details.car_name || "Hot Wheels item"}
Series: ${details.series_name || ""}
Mainline: ${details.mainline_number || ""}
Toy #: ${details.toy_number || ""}
Quantity: ${item.quantity || 1}
Condition: ${item.condition || ""}
Scanned using Hot Wheels Collector Scanner`;
}

function buildCollectionSummary() {
  const stats = getSummaryStats();
  return `My Hot Wheels Collection:
Total unique cars: ${stats.totalUnique}
Total quantity: ${stats.totalQuantity}
Mint Carded: ${stats.mintCarded}
Loose: ${stats.loose}
Top series: ${stats.topSeries}
Scanned using Hot Wheels Collector Scanner`;
}

function getSummaryStats() {
  const seriesCounts = countBy((item) => item.details?.series_name || "Unknown");
  return {
    totalUnique: collectionItems.length,
    totalQuantity: collectionItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    mintCarded: sumByCondition("Mint Carded"),
    loose: collectionItems.filter((item) => ["Loose", "Loose Mint"].includes(item.condition)).reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    topSeries: Object.entries(seriesCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "None"
  };
}

function discardScan() {
  currentScan = createEmptyScan();
  frontImageDataUrl = "";
  backImageDataUrl = "";
  els.frontImageInput.value = "";
  els.backImageInput.value = "";
  els.frontPreviewImage.removeAttribute("src");
  els.backPreviewImage.removeAttribute("src");
  els.frontPreviewWrap.hidden = true;
  els.backPreviewWrap.hidden = true;
  els.quantityInput.value = "1";
  els.conditionInput.value = "Carded";
  els.notesInput.value = "";
  els.confidenceBadge.textContent = "Waiting";
  els.scanButton.disabled = true;
  renderResultForm();
}

function createEmptyScan() {
  return {
    details: Object.fromEntries(DETAIL_FIELDS.map((field) => [field, ""])),
    possible_metadata: Object.fromEntries(META_FIELDS.map((field) => [field, ""]))
  };
}

function getGeminiPrompt() {
  return `Analyze these two Hot Wheels card images. The first image is the FRONT of the card. The second image is the BACK of the card.

Extract only visible details. Do not guess. If a field is not visible, use an empty string.

For FRONT, detect:
- car_name
- series_name
- series_number
- mainline_number

For BACK, detect:
- toy_number
- barcode
- copyright_year
- manufacturing_country

Then infer possible metadata only if there is strong evidence from the visible details:
- release_year
- case_code
- rarity
- variant
- match_confidence
- notes

Important:
Case code is often not visible, so do not force it. If uncertain, leave it blank or write "Possible only, needs database match" in notes.

Return only valid JSON with this exact structure:
{
  "details": {
    "car_name": "",
    "series_name": "",
    "series_number": "",
    "mainline_number": "",
    "toy_number": "",
    "barcode": "",
    "copyright_year": "",
    "manufacturing_country": ""
  },
  "possible_metadata": {
    "release_year": "",
    "case_code": "",
    "rarity": "",
    "variant": "",
    "match_confidence": "high/medium/low",
    "notes": ""
  }
}`;
}

function compressImage(file, maxSize, quality) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
      URL.revokeObjectURL(image.src);
    };
    image.onerror = () => reject(new Error("Could not read image."));
    image.src = URL.createObjectURL(file);
  });
}

function dataUrlToInlineData(dataUrl) {
  const [header, data] = dataUrl.split(",");
  const mimeType = header.match(/data:(.*);base64/)?.[1] || "image/jpeg";
  return {
    inline_data: {
      mime_type: mimeType,
      data
    }
  };
}

function parseJsonOnly(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw error;
    return JSON.parse(match[0]);
  }
}

function fromDoc(snapshot) {
  return { ...snapshot.data(), id: snapshot.id };
}

function stripFirestoreOnlyFields(item) {
  return {
    id: item.id || "",
    uid: item.uid || uid,
    ownerEmail: item.ownerEmail || currentUser?.email || "",
    frontImageDataUrl: item.frontImageDataUrl || "",
    backImageDataUrl: item.backImageDataUrl || "",
    details: { ...(item.details || {}) },
    possible_metadata: { ...(item.possible_metadata || {}) },
    quantity: Number(item.quantity || 1),
    condition: item.condition || "Carded",
    user_notes: item.user_notes || "",
    status: item.status || "active"
  };
}

function showPage(pageId) {
  if (!uid && pageId !== "authPage") {
    pageId = "authPage";
  }

  document.querySelectorAll(".page").forEach((page) => {
    page.classList.toggle("active-page", page.id === pageId);
  });

  document.querySelectorAll(".nav-button").forEach((button) => {
    button.classList.toggle("active-nav", button.dataset.page === pageId);
  });

  els.menuSheet.hidden = true;
  els.menuButton.setAttribute("aria-expanded", "false");

  if (["archivePage", "statsPage", "settingsPage"].includes(pageId)) {
    els.menuButton.classList.add("active-nav");
  } else {
    els.menuButton.classList.remove("active-nav");
  }
}

function requireSignedIn() {
  if (currentUser && uid) {
    return true;
  }

  els.authMessage.textContent = "Please login first.";
  showPage("authPage");
  return false;
}

function showError(error) {
  console.error(error);
  els.scanStatus.textContent = error.message || "Something went wrong.";
  els.authStatus.textContent = error.message || "Something went wrong.";
}

function statCard(label, value) {
  return `<article class="stat-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`;
}

function countBy(getKey) {
  return collectionItems.reduce((counts, item) => {
    const key = getKey(item);
    counts[key] = (counts[key] || 0) + Number(item.quantity || 1);
    return counts;
  }, {});
}

function sumByCondition(condition) {
  return collectionItems
    .filter((item) => item.condition === condition)
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

function formatCounts(counts) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n") || "None";
}

function getMillis(timestamp) {
  if (!timestamp) return 0;
  if (typeof timestamp.toMillis === "function") return timestamp.toMillis();
  if (timestamp.seconds) return timestamp.seconds * 1000;
  return Number(timestamp) || 0;
}

function numberish(value) {
  const match = String(value || "").match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function formatLabel(value) {
  return value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("\n", " ");
}

function formatAuthError(error) {
  const code = error?.code || "";

  if (code.includes("email-already-in-use")) return "That email is already registered. Try logging in.";
  if (code.includes("invalid-email")) return "Enter a valid email address.";
  if (code.includes("invalid-credential")) return "Email or password is incorrect.";
  if (code.includes("weak-password")) return "Password should be at least 6 characters.";
  if (code.includes("operation-not-allowed")) return "Enable Email/Password sign-in in Firebase Authentication.";

  return error?.message || "Authentication failed.";
}

function getUserLabel(user) {
  return user.displayName || user.email || user.uid.slice(0, 8);
}
