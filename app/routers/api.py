from __future__ import annotations

import csv
import io
import logging
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import rag_service
from app.database import get_db
from app.models import ChatFeedback, ChatMessage, Document, DocumentChunk
from app.schemas import (
    ChatMessageOut,
    ChatRequest,
    ChatResponse,
    DocumentDetailOut,
    DocumentOut,
    DocumentRename,
    FeedbackRequest,
    LoginRequest,
    MetaOut,
    SearchHit,
    SessionOut,
    StatsOut,
    TokenResponse,
)
from app.security import (
    chat_rate_limit,
    create_access_token,
    feedback_rate_limit,
    get_current_admin,
    login_rate_limit,
    search_rate_limit,
    verify_admin_password,
)

router = APIRouter(prefix="/api")
logger = logging.getLogger(__name__)

MAX_UPLOAD_BYTES = 10 * 1024 * 1024

SUGGESTIONS = [
    "Сколько стоит чистка ноутбука от пыли?",
    "Сколько занимает установка Windows?",
    "Даёте ли вы гарантию на ремонт?",
    "Есть ли выезд на дом?",
    "Восстанавливаете ли данные с жёсткого диска?",
    "Как записаться на диагностику?",
]

META = MetaOut(
    company="ТехноСервис",
    tagline="Ремонт и настройка компьютеров с 2014 года",
    phone="+7 (495) 120-45-67",
    email="help@technoservice.ru",
    address="Москва, ул. Профсоюзная, 42, офис 3",
    schedule="Пн–Сб, 10:00–19:00",
    suggestions=SUGGESTIONS,
)


def _tokens(text: str) -> set[str]:
    return {w.lower() for w in text.split() if len(w) > 2}


@router.get("/meta", response_model=MetaOut)
def meta():
    return META


@router.post("/admin/login", response_model=TokenResponse, dependencies=[Depends(login_rate_limit)])
def admin_login(payload: LoginRequest):
    if not verify_admin_password(payload.password):
        raise HTTPException(status_code=401, detail="Неверный пароль")
    return TokenResponse(access_token=create_access_token())


@router.post(
    "/documents/upload",
    response_model=DocumentOut,
    status_code=201,
    dependencies=[Depends(get_current_admin)],
)
async def upload_document(file: UploadFile = File(...), db: Session = Depends(get_db)):
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if not data:
        raise HTTPException(status_code=400, detail="Пустой файл")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Файл больше 10 МБ")

    filename = Path(file.filename or "document").name
    try:
        text = rag_service.extract_text(filename, data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    chunks = rag_service.split_text(text)
    if not chunks:
        raise HTTPException(status_code=400, detail="В файле нет текста")

    document = Document(filename=filename, chunks_count=len(chunks))
    document.chunks = [DocumentChunk(content=chunk) for chunk in chunks]
    db.add(document)
    db.commit()
    db.refresh(document)
    return document


@router.get("/documents", response_model=list[DocumentOut], dependencies=[Depends(get_current_admin)])
def list_documents(db: Session = Depends(get_db)):
    return db.query(Document).order_by(Document.created_at.desc()).all()


@router.get(
    "/documents/search",
    response_model=list[SearchHit],
    dependencies=[Depends(get_current_admin), Depends(search_rate_limit)],
)
def search_documents(q: str = Query(min_length=2, max_length=200), db: Session = Depends(get_db)):
    rows = (
        db.query(DocumentChunk.id, Document.id, Document.filename, DocumentChunk.content)
        .join(Document)
        .filter(DocumentChunk.content.ilike(f"%{q}%"))
        .limit(25)
        .all()
    )
    hits = []
    for chunk_id, document_id, filename, content in rows:
        index = content.lower().find(q.lower())
        start = max(index - 60, 0)
        hits.append(
            SearchHit(
                document_id=document_id,
                chunk_id=chunk_id,
                filename=filename,
                snippet=content[start : start + 240],
            )
        )
    return hits


@router.get(
    "/documents/{document_id}",
    response_model=DocumentDetailOut,
    dependencies=[Depends(get_current_admin)],
)
def document_detail(document_id: int, db: Session = Depends(get_db)):
    document = db.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Документ не найден")
    chunks = (
        db.query(DocumentChunk.content)
        .filter(DocumentChunk.document_id == document_id)
        .order_by(DocumentChunk.id)
        .limit(10)
        .all()
    )
    payload = DocumentOut.model_validate(document).model_dump()
    return DocumentDetailOut(**payload, preview=[row[0][:500] for row in chunks])


@router.patch(
    "/documents/{document_id}",
    response_model=DocumentOut,
    dependencies=[Depends(get_current_admin)],
)
def rename_document(document_id: int, payload: DocumentRename, db: Session = Depends(get_db)):
    document = db.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Документ не найден")
    document.filename = payload.filename
    db.commit()
    db.refresh(document)
    return document


@router.delete("/documents/{document_id}", status_code=204, dependencies=[Depends(get_current_admin)])
def delete_document(document_id: int, db: Session = Depends(get_db)):
    document = db.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Документ не найден")
    db.delete(document)
    db.commit()


@router.get("/admin/messages", response_model=list[ChatMessageOut], dependencies=[Depends(get_current_admin)])
def admin_messages(
    session_id: str | None = Query(default=None, max_length=64),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    query = db.query(ChatMessage)
    if session_id:
        query = query.filter(ChatMessage.session_id == session_id)
    return query.order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc()).limit(limit).all()


@router.get("/admin/sessions", response_model=list[SessionOut], dependencies=[Depends(get_current_admin)])
def admin_sessions(limit: int = Query(default=30, ge=1, le=100), db: Session = Depends(get_db)):
    rows = (
        db.query(ChatMessage)
        .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
        .limit(1000)
        .all()
    )
    grouped: dict[str, list[ChatMessage]] = {}
    for message in rows:
        grouped.setdefault(message.session_id, []).append(message)

    result = []
    for session_id, items in grouped.items():
        items.sort(key=lambda m: (m.created_at, m.id))
        last = items[-1]
        last_user = next((m for m in reversed(items) if m.role == "user"), last)
        result.append(
            SessionOut(
                session_id=session_id,
                messages_count=len(items),
                last_message=last_user.content[:300],
                last_activity=last.created_at,
                started_at=items[0].created_at,
            )
        )
    result.sort(key=lambda s: s.last_activity, reverse=True)
    return result[:limit]


@router.delete("/admin/sessions/{session_id}", status_code=204, dependencies=[Depends(get_current_admin)])
def delete_session(session_id: str, db: Session = Depends(get_db)):
    db.query(ChatMessage).filter(ChatMessage.session_id == session_id).delete()
    db.query(ChatFeedback).filter(ChatFeedback.session_id == session_id).delete()
    db.commit()


@router.get("/admin/stats", response_model=StatsOut, dependencies=[Depends(get_current_admin)])
def admin_stats(db: Session = Depends(get_db)):
    today = datetime.now(timezone.utc).date()
    return StatsOut(
        documents=db.query(func.count(Document.id)).scalar() or 0,
        chunks=db.query(func.count(DocumentChunk.id)).scalar() or 0,
        messages=db.query(func.count(ChatMessage.id)).scalar() or 0,
        sessions=db.query(func.count(func.distinct(ChatMessage.session_id))).scalar() or 0,
        questions_today=db.query(func.count(ChatMessage.id))
        .filter(ChatMessage.role == "user", func.date(ChatMessage.created_at) == today)
        .scalar()
        or 0,
        feedback_up=db.query(func.count(ChatFeedback.id)).filter(ChatFeedback.rating == "up").scalar() or 0,
        feedback_down=db.query(func.count(ChatFeedback.id)).filter(ChatFeedback.rating == "down").scalar() or 0,
    )


@router.get("/admin/export/messages.csv", dependencies=[Depends(get_current_admin)])
def export_messages(db: Session = Depends(get_db)):
    rows = db.query(ChatMessage).order_by(ChatMessage.id).all()
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";")
    writer.writerow(["id", "session_id", "role", "created_at", "content"])
    for row in rows:
        writer.writerow(
            [row.id, row.session_id, row.role, row.created_at.isoformat(), row.content]
        )
    data = buffer.getvalue().encode("utf-8-sig")
    return StreamingResponse(
        io.BytesIO(data),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="messages.csv"'},
    )


@router.get("/chat/history/{session_id}", response_model=list[ChatMessageOut])
def chat_history(session_id: str, db: Session = Depends(get_db)):
    return (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.id)
        .limit(200)
        .all()
    )


@router.post("/feedback", status_code=201, dependencies=[Depends(feedback_rate_limit)])
def feedback(payload: FeedbackRequest, db: Session = Depends(get_db)):
    if payload.message_id is not None and not db.get(ChatMessage, payload.message_id):
        raise HTTPException(status_code=404, detail="Сообщение не найдено")
    db.add(
        ChatFeedback(
            session_id=payload.session_id,
            message_id=payload.message_id,
            rating=payload.rating,
        )
    )
    db.commit()
    return {"status": "ok"}


@router.post("/chat", response_model=ChatResponse, dependencies=[Depends(chat_rate_limit)])
def chat(payload: ChatRequest, db: Session = Depends(get_db)):
    rows = db.query(DocumentChunk.id, DocumentChunk.content, Document.filename).join(Document).all()
    relevant = rag_service.find_relevant([(row[0], row[1]) for row in rows], payload.message)

    names = {row[0]: row[2] for row in rows}
    sources = sorted({names[chunk_id] for chunk_id, _ in relevant})
    context = "\n\n".join(content for _, content in relevant)

    if not context:
        answer = "В базе знаний компании нет информации по этому вопросу."
    else:
        try:
            answer = rag_service.ask_gigachat(context, payload.message)
        except Exception as exc:
            logger.exception("GigaChat request failed")
            raise HTTPException(status_code=502, detail="Сервис ИИ временно недоступен") from exc

    user_message = ChatMessage(session_id=payload.session_id, role="user", content=payload.message)
    bot_message = ChatMessage(session_id=payload.session_id, role="assistant", content=answer)
    db.add_all([user_message, bot_message])
    db.flush()
    bot_id = bot_message.id
    db.commit()

    return ChatResponse(
        session_id=payload.session_id,
        answer=answer,
        sources=sources,
        message_id=bot_id,
    )
