import os
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from threading import Lock

import bcrypt
import jwt
from dotenv import load_dotenv
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY", "")
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY не задан в .env")

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE = timedelta(hours=8)
ADMIN_SUBJECT = "admin"

_admin_password = os.getenv("ADMIN_PASSWORD", "")
_admin_hash = bcrypt.hashpw(_admin_password.encode()[:72], bcrypt.gensalt()) if _admin_password else None

_bearer = HTTPBearer(auto_error=False)


def verify_admin_password(password: str) -> bool:
    if _admin_hash is None:
        return False
    return bcrypt.checkpw(password.encode()[:72], _admin_hash)


def create_access_token(subject: str = ADMIN_SUBJECT) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": subject, "iat": now, "exp": now + ACCESS_TOKEN_EXPIRE}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Требуется авторизация",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_admin(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> str:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _unauthorized()
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        raise _unauthorized() from None
    if payload.get("sub") != ADMIN_SUBJECT:
        raise _unauthorized()
    return ADMIN_SUBJECT


class RateLimiter:
    def __init__(self, limit: int, window: float = 60.0):
        self.limit = limit
        self.window = window
        self._hits: dict[str, deque[float]] = {}
        self._lock = Lock()

    def __call__(self, request: Request) -> None:
        ip = request.client.host if request.client else "unknown"
        now = time.monotonic()
        with self._lock:
            hits = self._hits.setdefault(ip, deque())
            while hits and now - hits[0] > self.window:
                hits.popleft()
            if len(hits) >= self.limit:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Слишком много запросов. Попробуйте позже.",
                )
            hits.append(now)
            if len(self._hits) > 10_000:
                for key in [k for k, v in self._hits.items() if not v]:
                    self._hits.pop(key, None)


chat_rate_limit = RateLimiter(limit=10)
login_rate_limit = RateLimiter(limit=5)
