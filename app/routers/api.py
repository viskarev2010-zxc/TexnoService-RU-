from pathlib import Path

import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app import rag_service
from app.database import get_db
from app.models import ChatMessage, Document, DocumentChunk
from app.schemas import (
    ChatMessageOut,
    ChatRequest,
    ChatResponse,
    DocumentOut,
    LoginRequest,
    TokenResponse,
)
from app.security import (
    chat_rate_limit,
    create_access_token,
    get_current_admin,
    login_rate_limit,
    verify_admin_password,
)

router = APIRouter(prefix="/api")
logger = logging.getLogger(__name__)

MAX_UPLOAD_BYTES = 10 * 1024 * 1024


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


@router.delete("/documents/{document_id}", status_code=204, dependencies=[Depends(get_current_admin)])
def delete_document(document_id: int, db: Session = Depends(get_db)):
    document = db.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Документ не найден")
    db.delete(document)
    db.commit()


@router.get("/admin/messages", response_model=list[ChatMessageOut], dependencies=[Depends(get_current_admin)])
def admin_messages(db: Session = Depends(get_db)):
    return (
        db.query(ChatMessage)
        .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
        .limit(50)
        .all()
    )


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

    db.add_all(
        [
            ChatMessage(session_id=payload.session_id, role="user", content=payload.message),
            ChatMessage(session_id=payload.session_id, role="assistant", content=answer),
        ]
    )
    db.commit()

    return ChatResponse(session_id=payload.session_id, answer=answer, sources=sources)
