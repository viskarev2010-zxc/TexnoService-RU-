const messagesEl = document.getElementById("messages");
const formEl = document.getElementById("chat-form");
const inputEl = document.getElementById("message-input");
const sendEl = document.getElementById("send-button");
const typingEl = document.getElementById("typing");
const suggestionsEl = document.getElementById("suggestions");
const newChatEl = document.getElementById("new-chat");

const SESSION_KEY = "chat_session_id";
const WELCOME_TEXT =
  "Здравствуйте! Расскажу о ценах, сроках и гарантии. Задайте вопрос или выберите готовый вариант ниже.";

const fallbackSuggestions = [
  "Сколько стоит чистка ноутбука?",
  "Сколько занимает установка Windows?",
  "Даёте ли вы гарантию?",
];

function getSessionId() {
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID
      ? crypto.randomUUID()
      : `s-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

let sessionId = getSessionId();

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function scrollDown() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function buildSources(sources) {
  const box = el("div", "mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-slate-200 pt-2");
  box.appendChild(el("span", "text-[11px] uppercase tracking-wide text-slate-400", "Источники:"));
  sources.forEach((name) => {
    box.appendChild(
      el("span", "rounded-md bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600 ring-1 ring-slate-200", name)
    );
  });
  return box;
}

async function sendFeedback(messageId, rating, button) {
  try {
    await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, message_id: messageId, rating }),
    });
  } catch (error) {
    return;
  }
  const group = button.parentElement;
  group.querySelectorAll("button").forEach((node) => {
    node.disabled = true;
    if (node !== button) node.classList.add("opacity-30");
  });
  button.classList.add("bg-emerald-50", "text-emerald-600", "ring-emerald-200");
  group.appendChild(el("span", "ml-1 text-[11px] text-slate-400", "Спасибо за оценку"));
}

function buildActions(text, messageId) {
  const bar = el("div", "mt-2 flex items-center gap-1.5 border-t border-slate-200 pt-2");
  const copy = el(
    "button",
    "rounded-md px-1.5 py-0.5 text-[11px] text-slate-400 transition hover:bg-slate-100 hover:text-slate-700",
    "Копировать"
  );
  copy.type = "button";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = "Скопировано";
      setTimeout(() => (copy.textContent = "Копировать"), 1500);
    } catch (error) {
      copy.textContent = "Не удалось";
    }
  });
  bar.appendChild(copy);

  if (messageId) {
    const votes = el("div", "ml-auto flex items-center gap-1");
    [
      ["up", "👍", "Ответ полезен"],
      ["down", "👎", "Ответ не помог"],
    ].forEach(([rating, icon, title]) => {
      const button = el("button", "rounded-md px-1.5 py-0.5 text-[11px] text-slate-400 ring-1 ring-transparent transition hover:bg-slate-100 hover:text-slate-700", icon);
      button.type = "button";
      button.title = title;
      button.setAttribute("aria-label", title);
      button.addEventListener("click", () => sendFeedback(messageId, rating, button));
      votes.appendChild(button);
    });
    bar.appendChild(votes);
  }
  return bar;
}

function addMessage(role, text, options = {}) {
  const isUser = role === "user";
  const row = el("div", isUser ? "flex justify-end" : "flex justify-start");

  if (!isUser) {
    const avatar = el("span", "mr-2 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold text-white", "ИИ");
    row.appendChild(avatar);
  }

  const bubble = el(
    "div",
    isUser
      ? "max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-4 py-2.5 text-sm leading-relaxed text-white"
      : "max-w-[85%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-2.5 text-sm leading-relaxed text-slate-700"
  );
  bubble.appendChild(el("p", "whitespace-pre-wrap break-words", text));

  if (!isUser && options.sources && options.sources.length) {
    bubble.appendChild(buildSources(options.sources));
  }
  if (!isUser) {
    bubble.appendChild(buildActions(text, options.messageId));
  }

  row.appendChild(bubble);
  messagesEl.appendChild(row);
  scrollDown();
}

function setLoading(isLoading) {
  sendEl.disabled = isLoading;
  inputEl.disabled = isLoading;
  typingEl.classList.toggle("hidden", !isLoading);
  typingEl.classList.toggle("flex", isLoading);
  if (isLoading) scrollDown();
}

async function sendMessage(rawText) {
  const message = String(rawText || "").trim();
  if (!message) return;

  addMessage("user", message);
  inputEl.value = "";
  inputEl.style.height = "auto";
  setLoading(true);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, message }),
    });

    if (response.status === 429) {
      addMessage("assistant", "Слишком много сообщений подряд. Подождите минуту и попробуйте снова.");
      return;
    }
    if (!response.ok) {
      let detail = "Не удалось получить ответ. Попробуйте позже или позвоните нам.";
      try {
        const error = await response.json();
        if (typeof error.detail === "string") detail = error.detail;
      } catch (parseError) {
        detail = "Сервис временно недоступен. Попробуйте позже.";
      }
      addMessage("assistant", detail);
      return;
    }

    const data = await response.json();
    addMessage("assistant", data.answer || "Пустой ответ.", {
      sources: data.sources,
      messageId: data.message_id,
    });
  } catch (error) {
    addMessage("assistant", "Сервис недоступен. Проверьте подключение и повторите попытку.");
  } finally {
    setLoading(false);
    inputEl.focus();
  }
}

function renderSuggestions(items) {
  suggestionsEl.replaceChildren();
  items.forEach((text) => {
    const chip = el(
      "button",
      "shrink-0 whitespace-nowrap rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] text-slate-600 transition hover:border-brand-300 hover:text-brand-700",
      text
    );
    chip.type = "button";
    chip.addEventListener("click", () => sendMessage(text));
    suggestionsEl.appendChild(chip);
  });
}

async function loadMeta() {
  try {
    const response = await fetch("/api/meta");
    if (!response.ok) throw new Error("meta");
    const data = await response.json();
    renderSuggestions(Array.isArray(data.suggestions) && data.suggestions.length ? data.suggestions : fallbackSuggestions);
  } catch (error) {
    renderSuggestions(fallbackSuggestions);
  }
}

async function loadHistory() {
  try {
    const response = await fetch(`/api/chat/history/${encodeURIComponent(sessionId)}`);
    if (!response.ok) return;
    const history = await response.json();
    if (!Array.isArray(history) || !history.length) return;

    messagesEl.replaceChildren();
    history.forEach((message) => {
      addMessage(message.role === "user" ? "user" : "assistant", message.content, {
        messageId: message.role === "assistant" ? message.id : null,
      });
    });
  } catch (error) {
    /* история необязательна */
  }
}

function startNewChat() {
  sessionStorage.removeItem(SESSION_KEY);
  sessionId = getSessionId();
  messagesEl.replaceChildren();
  addMessage("assistant", WELCOME_TEXT);
  inputEl.focus();
}

formEl.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(inputEl.value);
});

inputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    formEl.requestSubmit();
  }
});

inputEl.addEventListener("input", () => {
  inputEl.style.height = "auto";
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, 112)}px`;
});

newChatEl.addEventListener("click", startNewChat);

document.querySelectorAll('a[href="#chat"]').forEach((link) => {
  link.addEventListener("click", () => setTimeout(() => inputEl.focus(), 300));
});

loadMeta();
loadHistory();
