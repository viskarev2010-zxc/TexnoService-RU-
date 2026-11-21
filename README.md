# ТехноСервис — ИИ-консультант по базе знаний (RAG)

FastAPI + PostgreSQL + GigaChat. Публичный сайт с чатом, админ-панель базы знаний, JWT-защита.

## Возможности

**Клиентский сайт (`/`)**
- Лендинг: услуги, прайс, этапы работ, FAQ, контакты
- Чат с ИИ по базе знаний: история сессии, источники ответа, копирование, оценка ответа (👍/👎)
- Восстановление диалога после перезагрузки страницы, быстрые вопросы, новый диалог

**Админ-панель (`/admin.html`)**
- Вход по паролю → JWT (HS256, 8 часов)
- Обзор: документы, фрагменты, вопросы за сегодня, оценки ответов
- Документы: drag&drop загрузка с прогрессом, фильтр, просмотр фрагментов, переименование, удаление, поиск по тексту
- Диалоги: список сессий, история переписки, удаление сессии, экспорт всех сообщений в CSV

**Безопасность**
- bcrypt-проверка пароля, JWT, rate limiting: чат 10/мин, вход 5/мин, отзывы 20/мин, поиск 30/мин
- Ограничение размера файла (10 МБ) и типов (.txt, .md, .pdf)
- CSP, X-Frame-Options, nosniff, Referrer-Policy; CORS только для своих origin
- Рендер сообщений на фронте строго через `textContent` (защита от XSS)

## API

| Метод | Путь | Доступ |
|---|---|---|
| GET | `/health` | публичный |
| GET | `/api/meta` | публичный (контакты, примеры вопросов) |
| POST | `/api/chat` | публичный (rate limit) |
| GET | `/api/chat/history/{session_id}` | публичный |
| POST | `/api/feedback` | публичный (rate limit) |
| POST | `/api/admin/login` | пароль |
| GET | `/api/documents`, `/api/documents/{id}`, `/api/documents/search` | JWT |
| POST | `/api/documents/upload` | JWT |
| PATCH / DELETE | `/api/documents/{id}` | JWT |
| GET | `/api/admin/stats`, `/api/admin/sessions`, `/api/admin/messages` | JWT |
| DELETE | `/api/admin/sessions/{session_id}` | JWT |
| GET | `/api/admin/export/messages.csv` | JWT |

## Запуск

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env   # DATABASE_URL, GIGACHAT_CREDENTIALS, SECRET_KEY, ADMIN_PASSWORD
uvicorn app.main:app --reload
```

- Сайт: http://localhost:8000/
- Админка: http://localhost:8000/admin.html
- Swagger: http://localhost:8000/docs
