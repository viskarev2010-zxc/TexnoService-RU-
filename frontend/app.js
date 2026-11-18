const messagesEl = document.getElementById("messages");
const formEl = document.getElementById("chat-form");
const inputEl = document.getElementById("message-input");
const sendEl = document.getElementById("send-button");
const typingEl = document.getElementById("typing");

function getSessionId() {
  let id = sessionStorage.getItem("chat_session_id");
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `s-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    sessionStorage.setItem("chat_session_id", id);
  }
  return id;
}

const sessionId = getSessionId();

function makeEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function addMessage(role, text, sources) {
  const row = makeEl("div", role === "user" ? "flex justify-end" : "flex justify-start");
  const bubbleClass =
    role === "user"
      ? "max-w-[85%] rounded-2xl rounded-br-sm bg-slate-900 px-4 py-3 text-sm leading-relaxed text-white"
      : "max-w-[85%] rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-3 text-sm leading-relaxed text-slate-700";
  const bubble = makeEl("div", bubbleClass);
  bubble.appendChild(makeEl("p", "whitespace-pre-wrap break-words", text));

  if (sources && sources.length) {
    const sourceBox = makeEl("div", "mt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-200 pt-2");
    sourceBox.appendChild(makeEl("span", "text-[11px] uppercase tracking-wide text-slate-400", "Источники:"));
    sources.forEach((name) => {
      sourceBox.appendChild(
        makeEl(
          "span",
          "rounded-md bg-white px-2 py-0.5 text-[11px] text-slate-500 ring-1 ring-slate-200",
          name
        )
      );
    });
    bubble.appendChild(sourceBox);
  }

  row.appendChild(bubble);
  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setLoading(isLoading) {
  sendEl.disabled = isLoading;
  inputEl.disabled = isLoading;
  typingEl.classList.toggle("hidden", !isLoading);
  typingEl.classList.toggle("flex", isLoading);
  if (isLoading) messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function sendMessage(text) {
  const message = text.trim();
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
      addMessage("assistant", "Слишком много запросов. Подождите минуту и попробуйте снова.");
      return;
    }
    if (!response.ok) {
      let detail = "Не удалось получить ответ. Попробуйте позже.";
      try {
        const error = await response.json();
        if (typeof error.detail === "string") detail = error.detail;
      } catch (parseError) {
        /* тело не JSON */
      }
      addMessage("assistant", detail);
      return;
    }

    const data = await response.json();
    addMessage("assistant", data.answer || "Пустой ответ.", data.sources);
  } catch (error) {
    addMessage("assistant", "Сервис недоступен. Проверьте подключение и повторите попытку.");
  } finally {
    setLoading(false);
    inputEl.focus();
  }
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
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, 128)}px`;
});

document.querySelectorAll(".example").forEach((button) => {
  button.addEventListener("click", () => sendMessage(button.textContent));
});

inputEl.focus();
