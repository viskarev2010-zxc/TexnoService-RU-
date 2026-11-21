const TOKEN_KEY = "admin_token";

const $ = (id) => document.getElementById(id);

const loginView = $("login-view");
const appView = $("app-view");
const loginForm = $("login-form");
const passwordInput = $("password-input");
const loginError = $("login-error");

const pageTitle = $("page-title");
const pageSubtitle = $("page-subtitle");

const documentsBody = $("documents-body");
const documentsEmpty = $("documents-empty");
const docsCount = $("docs-count");
const docFilter = $("doc-filter");

const sessionsList = $("sessions-list");
const sessionsEmpty = $("sessions-empty");
const threadTitle = $("thread-title");
const threadSubtitle = $("thread-subtitle");
const threadMessages = $("thread-messages");
const deleteSessionButton = $("delete-session");

const previewModal = $("preview-modal");
const previewTitle = $("preview-title");
const previewBody = $("preview-body");

const toasts = $("toasts");

const TABS = {
  overview: ["Обзор", "Сводка по базе знаний и обращениям"],
  documents: ["Документы", "Загрузка и управление базой знаний"],
  dialogs: ["Диалоги", "Обращения клиентов и история ответов"],
};

let currentTab = "overview";
let documents = [];
let sessions = [];
let activeSession = null;
let selectedFile = null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

function toast(message, kind = "info") {
  const palette =
    kind === "error"
      ? "border-red-200 bg-red-50 text-red-700"
      : kind === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : "border-slate-200 bg-white text-slate-700";
  const node = el("div", `rounded-lg border px-3.5 py-2.5 text-xs shadow-sm ${palette}`, message);
  toasts.appendChild(node);
  setTimeout(() => node.remove(), 3500);
}

function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

async function api(path, options = {}) {
  const headers = Object.assign({}, options.headers || {});
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(path, { ...options, headers });
  if (response.status === 401) {
    logout();
    throw new Error("Сессия истекла, войдите заново");
  }
  if (!response.ok) {
    let detail = "Ошибка запроса";
    try {
      const data = await response.json();
      if (typeof data.detail === "string") detail = data.detail;
    } catch (error) {
      detail = `Ошибка ${response.status}`;
    }
    throw new Error(detail);
  }
  return response.status === 204 ? null : response.json();
}

function showLogin() {
  appView.classList.add("hidden");
  loginView.classList.remove("hidden");
  loginForm.reset();
  passwordInput.focus();
}

function logout() {
  sessionStorage.removeItem(TOKEN_KEY);
  selectedFile = null;
  activeSession = null;
  showLogin();
}

function setTab(tab) {
  if (!TABS[tab]) return;
  currentTab = tab;
  pageTitle.textContent = TABS[tab][0];
  pageSubtitle.textContent = TABS[tab][1];

  document.querySelectorAll(".nav-item").forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle("bg-slate-100", active);
    button.classList.toggle("text-slate-900", active);
    button.classList.toggle("text-slate-600", !active);
  });
  document.querySelectorAll("main > section").forEach((section) => {
    section.classList.add("hidden");
  });
  $(`tab-${tab}`).classList.remove("hidden");

  if (tab === "overview") loadOverview();
  if (tab === "documents") loadDocuments();
  if (tab === "dialogs") loadSessions();
}

function showApp() {
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
  appView.classList.add("lg:flex");
  setTab(currentTab);
}

function statValue(id, value) {
  const node = $(id);
  if (node) node.textContent = String(value ?? "—");
}

async function loadOverview() {
  try {
    const stats = await api("/api/admin/stats");
    statValue("stat-documents", stats.documents);
    statValue("stat-chunks", stats.chunks);
    statValue("stat-today", stats.questions_today);
    statValue("stat-messages", stats.messages);
    statValue("stat-up", stats.feedback_up);
    statValue("stat-down", stats.feedback_down);
  } catch (error) {
    toast(error.message, "error");
  }

  const questionsBox = $("overview-questions");
  questionsBox.replaceChildren();
  try {
    const messages = await api("/api/admin/messages?limit=80");
    const questions = messages.filter((item) => item.role === "user").slice(0, 6);
    if (!questions.length) {
      questionsBox.appendChild(el("p", "px-5 py-8 text-center text-xs text-slate-400", "Вопросов пока нет."));
    }
    questions.forEach((message) => {
      const row = el("div", "px-5 py-3");
      row.appendChild(el("p", "text-sm text-slate-700 line-clamp-2", message.content));
      row.appendChild(el("p", "mt-1 text-[11px] text-slate-400", `${formatDate(message.created_at)} · ${message.session_id.slice(0, 8)}`));
      questionsBox.appendChild(row);
    });
  } catch (error) {
    questionsBox.appendChild(el("p", "px-5 py-6 text-xs text-red-600", error.message));
  }

  const sessionsBox = $("overview-sessions");
  sessionsBox.replaceChildren();
  try {
    const items = await api("/api/admin/sessions?limit=5");
    if (!items.length) {
      sessionsBox.appendChild(el("p", "px-5 py-8 text-center text-xs text-slate-400", "Диалогов пока нет."));
    }
    items.forEach((session) => {
      const row = el("button", "block w-full px-5 py-3 text-left transition hover:bg-slate-50");
      row.type = "button";
      row.appendChild(el("p", "truncate text-sm text-slate-700", session.last_message));
      row.appendChild(el("p", "mt-1 text-[11px] text-slate-400", `${session.messages_count} сообщ. · ${formatDate(session.last_activity)}`));
      row.addEventListener("click", () => {
        setTab("dialogs");
        setTimeout(() => openSession(session.session_id), 60);
      });
      sessionsBox.appendChild(row);
    });
  } catch (error) {
    sessionsBox.appendChild(el("p", "px-5 py-6 text-xs text-red-600", error.message));
  }
}

function documentRow(doc) {
  const row = document.createElement("tr");

  const nameCell = document.createElement("td");
  nameCell.className = "px-5 py-3";
  nameCell.appendChild(el("p", "max-w-xs truncate font-medium text-slate-800", doc.filename));
  nameCell.appendChild(el("p", "text-[11px] text-slate-400", `ID ${doc.id}`));
  row.appendChild(nameCell);

  row.appendChild(el("td", "px-5 py-3 text-slate-500", String(doc.chunks_count)));
  row.appendChild(el("td", "px-5 py-3 text-slate-500", formatDate(doc.created_at)));

  const actions = el("td", "px-5 py-3");
  const wrap = el("div", "flex items-center justify-end gap-1.5");

  const preview = el("button", "rounded-md border border-slate-300 px-2.5 py-1 text-[11px] text-slate-600 transition hover:bg-slate-50", "Просмотр");
  preview.type = "button";
  preview.addEventListener("click", () => openPreview(doc));
  wrap.appendChild(preview);

  const rename = el("button", "rounded-md border border-slate-300 px-2.5 py-1 text-[11px] text-slate-600 transition hover:bg-slate-50", "Имя");
  rename.type = "button";
  rename.addEventListener("click", () => renameDocument(doc));
  wrap.appendChild(rename);

  const remove = el("button", "rounded-md border border-red-200 px-2.5 py-1 text-[11px] text-red-600 transition hover:bg-red-50", "Удалить");
  remove.type = "button";
  remove.addEventListener("click", () => deleteDocument(doc, remove));
  wrap.appendChild(remove);

  actions.appendChild(wrap);
  row.appendChild(actions);
  return row;
}

function renderDocuments() {
  const query = docFilter.value.trim().toLowerCase();
  const filtered = documents.filter((doc) => doc.filename.toLowerCase().includes(query));

  documentsBody.replaceChildren();
  filtered.forEach((doc) => documentsBody.appendChild(documentRow(doc)));
  documentsEmpty.classList.toggle("hidden", filtered.length > 0);
  if (!filtered.length) {
    documentsEmpty.textContent = documents.length ? "Ничего не найдено по фильтру." : "Документов пока нет. Загрузите первый файл.";
  }
  docsCount.textContent = `${filtered.length} из ${documents.length}`;
}

async function loadDocuments() {
  try {
    documents = await api("/api/documents");
    renderDocuments();
  } catch (error) {
    toast(error.message, "error");
  }
}

async function renameDocument(doc) {
  const next = prompt("Новое имя файла", doc.filename);
  if (!next || next.trim() === doc.filename) return;
  try {
    await api(`/api/documents/${doc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: next.trim() }),
    });
    toast("Имя обновлено", "success");
    loadDocuments();
  } catch (error) {
    toast(error.message, "error");
  }
}

async function deleteDocument(doc, button) {
  if (!confirm(`Удалить «${doc.filename}» из базы знаний? Действие необратимо.`)) return;
  button.disabled = true;
  try {
    await api(`/api/documents/${doc.id}`, { method: "DELETE" });
    toast("Документ удалён", "success");
    loadDocuments();
    if (currentTab === "overview") loadOverview();
  } catch (error) {
    toast(error.message, "error");
    button.disabled = false;
  }
}

async function openPreview(doc) {
  previewTitle.textContent = doc.filename;
  previewBody.replaceChildren(el("p", "text-xs text-slate-400", "Загрузка…"));
  previewModal.classList.remove("hidden");
  previewModal.classList.add("flex");
  try {
    const detail = await api(`/api/documents/${doc.id}`);
    previewBody.replaceChildren();
    if (!detail.preview.length) {
      previewBody.appendChild(el("p", "text-xs text-slate-400", "Нет фрагментов для показа."));
    }
    detail.preview.forEach((fragment, index) => {
      const block = el("div", "rounded-lg border border-slate-200 bg-slate-50 p-3");
      block.appendChild(el("p", "mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400", `Фрагмент ${index + 1}`));
      block.appendChild(el("p", "whitespace-pre-wrap break-words text-[13px] text-slate-700", fragment));
      previewBody.appendChild(block);
    });
  } catch (error) {
    previewBody.replaceChildren(el("p", "text-xs text-red-600", error.message));
  }
}

function closePreview() {
  previewModal.classList.add("hidden");
  previewModal.classList.remove("flex");
}

function setSelectedFile(file) {
  selectedFile = file || null;
  $("clear-file").classList.toggle("hidden", !selectedFile);
  $("dropzone-title").textContent = selectedFile
    ? selectedFile.name
    : "Перетащите файл сюда или нажмите";
}

function setUploadStatus(text, kind) {
  const node = $("upload-status");
  node.textContent = text;
  node.className = `text-sm ${kind === "error" ? "text-red-600" : kind === "success" ? "text-emerald-600" : "text-slate-500"}`;
}

function uploadFile() {
  if (!selectedFile) {
    setUploadStatus("Выберите файл", "error");
    return;
  }

  const formData = new FormData();
  formData.append("file", selectedFile);

  $("upload-button").disabled = true;
  $("progress-wrap").classList.remove("hidden");
  $("progress-bar").style.width = "0%";
  $("progress-text").textContent = "0%";
  setUploadStatus("", "info");

  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/api/documents/upload");
  xhr.setRequestHeader("Authorization", `Bearer ${getToken()}`);

  xhr.upload.addEventListener("progress", (event) => {
    if (!event.lengthComputable) return;
    const percent = Math.round((event.loaded / event.total) * 100);
    $("progress-bar").style.width = `${percent}%`;
    $("progress-text").textContent = `${percent}%`;
  });

  xhr.addEventListener("load", async () => {
    $("upload-button").disabled = false;
    if (xhr.status === 401) {
      logout();
      return;
    }
    if (xhr.status === 201) {
      $("progress-bar").style.width = "100%";
      $("progress-text").textContent = "100%";
      setUploadStatus("Документ добавлен в базу знаний", "success");
      toast("Документ добавлен", "success");
      setSelectedFile(null);
      $("file-input").value = "";
      await loadDocuments();
      return;
    }
    let detail = "Не удалось загрузить файл";
    try {
      const data = JSON.parse(xhr.responseText);
      if (typeof data.detail === "string") detail = data.detail;
    } catch (error) {
      detail = `Ошибка загрузки (${xhr.status})`;
    }
    setUploadStatus(detail, "error");
  });

  xhr.addEventListener("error", () => {
    $("upload-button").disabled = false;
    setUploadStatus("Ошибка сети при загрузке", "error");
  });

  xhr.send(formData);
}

function renderMessage(message) {
  const isUser = message.role === "user";
  const row = el("div", isUser ? "flex justify-start" : "flex justify-end");
  const bubble = el(
    "div",
    isUser
      ? "max-w-[85%] rounded-xl rounded-bl-sm border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-700"
      : "max-w-[85%] rounded-xl rounded-br-sm bg-brand-600 px-3.5 py-2.5 text-sm text-white"
  );
  const meta = el(
    "p",
    `mb-1 text-[10px] uppercase tracking-wide ${isUser ? "text-slate-400" : "text-brand-100"}`,
    `${isUser ? "Клиент" : "ИИ-консультант"} · ${formatDate(message.created_at)}`
  );
  bubble.appendChild(meta);
  bubble.appendChild(el("p", "whitespace-pre-wrap break-words", message.content));
  row.appendChild(bubble);
  return row;
}

async function openSession(sessionId) {
  activeSession = sessionId;
  try {
    const messages = await api(`/api/admin/messages?session_id=${encodeURIComponent(sessionId)}&limit=200`);
    const ordered = messages.slice().reverse();
    threadTitle.textContent = `Сессия ${sessionId.slice(0, 8)}`;
    threadSubtitle.textContent = `${ordered.length} сообщ. · начата ${formatDate(ordered[0]?.created_at)}`;
    deleteSessionButton.classList.remove("hidden");
    threadMessages.replaceChildren();
    ordered.forEach((message) => threadMessages.appendChild(renderMessage(message)));
    threadMessages.scrollTop = threadMessages.scrollHeight;
  } catch (error) {
    toast(error.message, "error");
  }
}

async function loadSessions() {
  sessionsList.replaceChildren();
  try {
    sessions = await api("/api/admin/sessions?limit=50");
    sessionsEmpty.classList.toggle("hidden", sessions.length > 0);
    sessions.forEach((session) => {
      const button = el("button", "block w-full px-4 py-3 text-left transition hover:bg-slate-50");
      button.type = "button";
      if (session.session_id === activeSession) button.classList.add("bg-brand-50");
      button.appendChild(el("p", "truncate text-sm text-slate-700", session.last_message));
      button.appendChild(
        el("p", "mt-1 text-[11px] text-slate-400", `${session.session_id.slice(0, 8)} · ${session.messages_count} сообщ. · ${formatDate(session.last_activity)}`)
      );
      button.addEventListener("click", () => openSession(session.session_id));
      sessionsList.appendChild(button);
    });

    if (activeSession) {
      openSession(activeSession);
    } else if (sessions.length) {
      openSession(sessions[0].session_id);
    } else {
      threadTitle.textContent = "Выберите сессию";
      threadSubtitle.textContent = "Слева — список обращений клиентов";
      threadMessages.replaceChildren();
      deleteSessionButton.classList.add("hidden");
    }
  } catch (error) {
    toast(error.message, "error");
  }
}

async function deleteSession() {
  if (!activeSession) return;
  if (!confirm("Удалить всю историю этой сессии?")) return;
  try {
    await api(`/api/admin/sessions/${encodeURIComponent(activeSession)}`, { method: "DELETE" });
    activeSession = null;
    threadMessages.replaceChildren();
    threadTitle.textContent = "Выберите сессию";
    threadSubtitle.textContent = "Слева — список обращений клиентов";
    deleteSessionButton.classList.add("hidden");
    toast("Сессия удалена", "success");
    loadSessions();
    if (currentTab === "overview") loadOverview();
  } catch (error) {
    toast(error.message, "error");
  }
}

async function exportMessages() {
  try {
    const response = await fetch("/api/admin/export/messages.csv", {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (response.status === 401) {
      logout();
      return;
    }
    if (!response.ok) throw new Error("Не удалось выгрузить CSV");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "messages.csv";
    link.click();
    URL.revokeObjectURL(url);
    toast("CSV выгружен", "success");
  } catch (error) {
    toast(error.message, "error");
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.classList.add("hidden");
  const button = loginForm.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: passwordInput.value }),
    });
    if (response.status === 429) throw new Error("Слишком много попыток входа. Подождите минуту.");
    if (!response.ok) throw new Error("Неверный пароль");
    const data = await response.json();
    sessionStorage.setItem(TOKEN_KEY, data.access_token);
    passwordInput.value = "";
    showApp();
  } catch (error) {
    loginError.textContent = error.message;
    loginError.classList.remove("hidden");
  } finally {
    button.disabled = false;
  }
});

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => setTab(button.dataset.tab));
});

$("logout-button").addEventListener("click", logout);
$("logout-button-mobile").addEventListener("click", logout);
$("refresh-button").addEventListener("click", () => setTab(currentTab));
$("export-button").addEventListener("click", exportMessages);
deleteSessionButton.addEventListener("click", deleteSession);
docFilter.addEventListener("input", renderDocuments);

$("upload-form").addEventListener("submit", (event) => {
  event.preventDefault();
  uploadFile();
});

$("file-input").addEventListener("change", (event) => setSelectedFile(event.target.files[0]));

const dropzone = $("dropzone");
["dragenter", "dragover"].forEach((name) => {
  dropzone.addEventListener(name, (event) => {
    event.preventDefault();
    dropzone.classList.add("border-brand-500", "bg-brand-50");
  });
});
["dragleave", "drop"].forEach((name) => {
  dropzone.addEventListener(name, (event) => {
    event.preventDefault();
    dropzone.classList.remove("border-brand-500", "bg-brand-50");
  });
});
dropzone.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files[0];
  if (file) setSelectedFile(file);
});

$("clear-file").addEventListener("click", () => {
  $("file-input").value = "";
  setSelectedFile(null);
});

$("preview-close").addEventListener("click", closePreview);
previewModal.addEventListener("click", (event) => {
  if (event.target === previewModal) closePreview();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePreview();
});

(async () => {
  if (!getToken()) {
    showLogin();
    return;
  }
  showApp();
})();
