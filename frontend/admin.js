const TOKEN_KEY = "admin_token";

const loginView = document.getElementById("login-view");
const dashboardView = document.getElementById("dashboard-view");
const loginForm = document.getElementById("login-form");
const passwordInput = document.getElementById("password-input");
const loginError = document.getElementById("login-error");
const logoutButton = document.getElementById("logout-button");

const uploadForm = document.getElementById("upload-form");
const fileInput = document.getElementById("file-input");
const uploadButton = document.getElementById("upload-button");
const uploadStatus = document.getElementById("upload-status");
const progressWrap = document.getElementById("progress-wrap");
const progressBar = document.getElementById("progress-bar");
const progressText = document.getElementById("progress-text");

const documentsBody = document.getElementById("documents-body");
const documentsEmpty = document.getElementById("documents-empty");
const messagesFeed = document.getElementById("messages-feed");
const messagesEmpty = document.getElementById("messages-empty");

function makeEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("ru-RU");
}

function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

function setStatus(node, text, kind) {
  node.textContent = text;
  node.className = `text-sm ${kind === "error" ? "text-red-600" : kind === "success" ? "text-emerald-600" : "text-slate-500"}`;
}

function logout() {
  sessionStorage.removeItem(TOKEN_KEY);
  dashboardView.classList.add("hidden");
  logoutButton.classList.add("hidden");
  loginView.classList.remove("hidden");
  passwordInput.value = "";
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
      /* тело не JSON */
    }
    throw new Error(detail);
  }
  return response.status === 204 ? null : response.json();
}

async function loadDocuments() {
  documentsBody.replaceChildren();
  try {
    const documents = await api("/api/documents");
    documentsEmpty.classList.toggle("hidden", documents.length > 0);

    documents.forEach((doc) => {
      const row = document.createElement("tr");
      row.appendChild(makeEl("td", "py-3 pr-4 font-medium text-slate-700", doc.filename));
      row.appendChild(makeEl("td", "py-3 pr-4 text-slate-500", String(doc.chunks_count)));
      row.appendChild(makeEl("td", "py-3 pr-4 text-slate-500", formatDate(doc.created_at)));

      const actionCell = makeEl("td", "py-3 text-right");
      const button = makeEl(
        "button",
        "rounded-lg border border-red-200 px-3 py-1 text-xs text-red-600 transition hover:bg-red-50 disabled:opacity-50",
        "Удалить"
      );
      button.type = "button";
      button.addEventListener("click", async () => {
        if (!confirm(`Удалить документ «${doc.filename}» из базы знаний?`)) return;
        button.disabled = true;
        try {
          await api(`/api/documents/${doc.id}`, { method: "DELETE" });
          await loadDocuments();
        } catch (error) {
          alert(error.message);
          button.disabled = false;
        }
      });
      actionCell.appendChild(button);
      row.appendChild(actionCell);
      documentsBody.appendChild(row);
    });
  } catch (error) {
    documentsEmpty.classList.remove("hidden");
    documentsEmpty.textContent = error.message;
  }
}

function renderSession(sessionId, messages) {
  const card = makeEl("div", "rounded-xl border border-slate-200 p-4");
  const header = makeEl("div", "flex flex-wrap items-center justify-between gap-2");
  header.appendChild(makeEl("p", "text-xs font-medium text-slate-500", `Сессия ${sessionId.slice(0, 8)}`));
  header.appendChild(makeEl("p", "text-xs text-slate-400", formatDate(messages[messages.length - 1].created_at)));
  card.appendChild(header);

  const list = makeEl("div", "mt-3 space-y-2");
  messages.forEach((message) => {
    const isUser = message.role === "user";
    const row = makeEl("div", isUser ? "flex justify-start" : "flex justify-end");
    const bubble = makeEl(
      "div",
      isUser
        ? "max-w-[85%] rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700"
        : "max-w-[85%] rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
    );
    bubble.appendChild(makeEl("p", "mb-1 text-[11px] uppercase tracking-wide opacity-60", isUser ? "Клиент" : "ИИ"));
    bubble.appendChild(makeEl("p", "whitespace-pre-wrap break-words", message.content));
    row.appendChild(bubble);
    list.appendChild(row);
  });
  card.appendChild(list);
  return card;
}

async function loadMessages() {
  messagesFeed.replaceChildren();
  try {
    const messages = await api("/api/admin/messages");
    messagesEmpty.classList.toggle("hidden", messages.length > 0);

    const sessions = new Map();
    messages
      .slice()
      .reverse()
      .forEach((message) => {
        if (!sessions.has(message.session_id)) sessions.set(message.session_id, []);
        sessions.get(message.session_id).push(message);
      });

    sessions.forEach((items, sessionId) => messagesFeed.appendChild(renderSession(sessionId, items)));
  } catch (error) {
    messagesEmpty.classList.remove("hidden");
    messagesEmpty.textContent = error.message;
  }
}

function showDashboard() {
  loginView.classList.add("hidden");
  dashboardView.classList.remove("hidden");
  logoutButton.classList.remove("hidden");
  loadDocuments();
  loadMessages();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.classList.add("hidden");
  const button = loginForm.querySelector("button");
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
    showDashboard();
  } catch (error) {
    loginError.textContent = error.message;
    loginError.classList.remove("hidden");
  } finally {
    button.disabled = false;
  }
});

uploadForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const file = fileInput.files[0];
  if (!file) {
    setStatus(uploadStatus, "Выберите файл", "error");
    return;
  }

  const formData = new FormData();
  formData.append("file", file);

  uploadButton.disabled = true;
  progressWrap.classList.remove("hidden");
  progressBar.style.width = "0%";
  progressText.textContent = "0%";
  setStatus(uploadStatus, "", "info");

  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/api/documents/upload");
  xhr.setRequestHeader("Authorization", `Bearer ${getToken()}`);

  xhr.upload.addEventListener("progress", (event) => {
    if (!event.lengthComputable) return;
    const percent = Math.round((event.loaded / event.total) * 100);
    progressBar.style.width = `${percent}%`;
    progressText.textContent = `${percent}%`;
  });

  xhr.addEventListener("load", async () => {
    uploadButton.disabled = false;
    if (xhr.status === 401) {
      logout();
      return;
    }
    if (xhr.status === 201) {
      progressBar.style.width = "100%";
      progressText.textContent = "100%";
      setStatus(uploadStatus, "Документ добавлен в базу знаний", "success");
      fileInput.value = "";
      await loadDocuments();
      return;
    }
    let detail = "Не удалось загрузить файл";
    try {
      const data = JSON.parse(xhr.responseText);
      if (typeof data.detail === "string") detail = data.detail;
    } catch (error) {
      /* тело не JSON */
    }
    setStatus(uploadStatus, detail, "error");
  });

  xhr.addEventListener("error", () => {
    uploadButton.disabled = false;
    setStatus(uploadStatus, "Ошибка сети при загрузке", "error");
  });

  xhr.send(formData);
});

logoutButton.addEventListener("click", logout);
document.getElementById("refresh-docs").addEventListener("click", loadDocuments);
document.getElementById("refresh-messages").addEventListener("click", loadMessages);

if (getToken()) {
  showDashboard();
} else {
  loginForm.reset();
  passwordInput.focus();
}
