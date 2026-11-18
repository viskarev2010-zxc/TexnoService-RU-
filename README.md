# ТехноСервис — ИИ-консультант по базе знаний (RAG)

FastAPI + PostgreSQL + GigaChat. Веб-чат для клиентов и админ-панель управления базой знаний с JWT-защитой.

## Возможности

- RAG-поиск по загруженным документам (`.txt`, `.md`, `.pdf`) и ответы строго по контексту через GigaChat
- Чат с историей сообщений и списком источников ответа
- Админка: вход по паролю, загрузка документов с прогрессом, удаление, лента диалогов
- JWT (HS256, 8 часов), bcrypt-проверка пароля, rate limiting на `/api/chat` и вход

## Запуск

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env   # заполнить DATABASE_URL, GIGACHAT_CREDENTIALS, SECRET_KEY, ADMIN_PASSWORD
uvicorn app.main:app --reload
```

- Чат: http://localhost:8000/
- Админка: http://localhost:8000/admin.html
- Документация API: http://localhost:8000/docs
