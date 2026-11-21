from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    filename: str
    chunks_count: int
    created_at: datetime


class DocumentDetailOut(DocumentOut):
    preview: list[str] = []


class DocumentRename(BaseModel):
    filename: str = Field(min_length=1, max_length=255)

    @field_validator("filename")
    @classmethod
    def clean(cls, value: str) -> str:
        value = value.replace("\\", "/").split("/")[-1].strip()
        if not value:
            raise ValueError("Пустое имя файла")
        return value


class SearchHit(BaseModel):
    document_id: int
    chunk_id: int
    filename: str
    snippet: str


class ChatRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=64)
    message: str = Field(min_length=1, max_length=2000)


class ChatResponse(BaseModel):
    session_id: str
    answer: str
    sources: list[str] = []
    message_id: int | None = None


class LoginRequest(BaseModel):
    password: str = Field(min_length=1, max_length=72)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class ChatMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: str
    role: str
    content: str
    created_at: datetime


class SessionOut(BaseModel):
    session_id: str
    messages_count: int
    last_message: str
    last_activity: datetime
    started_at: datetime


class StatsOut(BaseModel):
    documents: int
    chunks: int
    messages: int
    sessions: int
    questions_today: int
    feedback_up: int
    feedback_down: int


class FeedbackRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=64)
    message_id: int | None = None
    rating: Literal["up", "down"]


class MetaOut(BaseModel):
    company: str
    tagline: str
    phone: str
    email: str
    address: str
    schedule: str
    suggestions: list[str]
