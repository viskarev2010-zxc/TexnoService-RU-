import io
import os
import re
from pathlib import Path

from dotenv import load_dotenv
from gigachat import GigaChat
from gigachat.models import Chat, Messages, MessagesRole
from pypdf import PdfReader

load_dotenv()

CHUNK_SIZE = 600
CHUNK_OVERLAP = 100
TOP_K = 3

SYSTEM_PROMPT = (
    "Ты — ИИ-консультант по базе знаний компании. "
    "Отвечай СТРОГО на основе предоставленного контекста. "
    "Если в контексте нет ответа, ответь: "
    "«В базе знаний компании нет информации по этому вопросу.» "
    "Запрещено использовать внешние знания, догадки и выдумывать факты. "
    "Отвечай кратко, по делу, на русском языке."
)

SUPPORTED_EXTENSIONS = {".txt", ".md", ".pdf"}

WORD_RE = re.compile(r"\w+", re.UNICODE)


def extract_text(filename: str, data: bytes) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Неподдерживаемый формат: {suffix}")
    if suffix in {".txt", ".md"}:
        return data.decode("utf-8", errors="ignore")
    reader = PdfReader(io.BytesIO(data))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def split_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return []
    step = max(size - overlap, 1)
    return [text[i : i + size] for i in range(0, len(text), step)]


def _tokens(text: str) -> set[str]:
    return {w.lower() for w in WORD_RE.findall(text) if len(w) > 1}


def find_relevant(chunks: list[tuple[int, str]], query: str, top_k: int = TOP_K) -> list[tuple[int, str]]:
    query_tokens = _tokens(query)
    if not query_tokens:
        return []
    scored = []
    for chunk_id, content in chunks:
        score = len(query_tokens & _tokens(content))
        if score:
            scored.append((score, chunk_id, content))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [(chunk_id, content) for _, chunk_id, content in scored[:top_k]]


def ask_gigachat(context: str, question: str) -> str:
    client = GigaChat(
        credentials=os.getenv("GIGACHAT_CREDENTIALS", ""),
        scope=os.getenv("GIGACHAT_SCOPE", "GIGACHAT_API_PERS"),
        model=os.getenv("GIGACHAT_MODEL", "GigaChat-2"),
        verify_ssl_certs=False,
    )
    try:
        response = client.chat(
            Chat(
                messages=[
                    Messages(role=MessagesRole.SYSTEM, content=SYSTEM_PROMPT),
                    Messages(
                        role=MessagesRole.USER,
                        content=f"Контекст:\n{context}\n\nВопрос: {question}",
                    ),
                ],
                temperature=0.1,
            )
        )
        return response.choices[0].message.content
    finally:
        client.close()
