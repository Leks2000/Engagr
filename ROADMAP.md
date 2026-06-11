# Engagr — Project Roadmap & Analysis

> Last updated: 2026-06-11

---

## 🔍 Project Overview

**Engagr** — Chrome Extension + Railway Backend + Telegram Mini App  
Цель: автоматизировать мониторинг LinkedIn / X / Reddit, генерировать AI-комментарии и управлять одобрением действий прямо из Telegram.

### Architecture

```
[Chrome Extension "Engagr WebBridge"]
       │  scrapes DOM → sends posts to backend
       │  receives tasks → executes actions (like, comment, connect)
       ▼
[Railway Backend — Flask API + APScheduler]
       │  stores settings/queue/stats in JSON files
       │  calls Groq AI for comment generation
       │  manages approval queue
       ▼
[Telegram Bot + Mini App (WebApp)]
       │  shows feed, approve/reject actions
       │  settings, memory (project context)
       └─ user interacts here
```

---

## ✅ Что работает (на момент анализа)

| Компонент | Статус |
|-----------|--------|
| Railway backend запущен (`/health` OK) | ✅ |
| X/Twitter feed парсинг (5 твитов найдено) | ✅ |
| Telegram Bot авторизация | ✅ |
| Telegram Mini App базовый UI | ✅ |
| Extension popup + Scan Feed (X) | ✅ |
| Generate Reply для X (после фикса) | ✅ |
| LinkedIn Scan Feed (после фикса) | ✅ |
| AI comment generation (Groq) | ✅ |
| Queue system (задачи на одобрение) | ✅ |

---

## ❌ Что НЕ работало (исправлено в этом релизе)

### Баг 1: `storage.load_settings` / `storage.load_stats` → AttributeError
- **Проблема:** В `backend/main.py` вызывались `storage.load_settings()` и `storage.load_stats()`,  
  но в `backend/storage.py` эти функции называются `get_settings()` и `get_stats()`
- **Симптом:** `"error": "module 'user_memory' has no attribute 'load_memory'"` при Generate Reply  
  (реальная ошибка была про `storage`, но выдавалась через цепочку импорта)
- **Фикс:** `sed -i 's/storage.load_settings/storage.get_settings/g'` и аналогично для `load_stats`
- **Файл:** `backend/main.py` — 11 мест

### Баг 2: LinkedIn парсер не находит посты (0 posts found)
- **Проблема:** LinkedIn в 2024-2025 обновил DOM. Селекторы устарели, новый LinkedIn  
  использует `span[dir="ltr"]` для текста постов, контейнеры `occludable-update` и т.д.
- **Фикс:** Переписан `linkedin_parser.js` с:
  - Расширенным набором селекторов (20+ CSS классов и атрибутов)
  - Улучшенным fallback через `span[dir="ltr"]`
  - Дедупликацией DOM-дерева (предок vs потомок)
  - Защитой от `invalid selector` ошибок
- **Файл:** `extension/src/linkedin_parser.js`

---

## 📊 Оценка проекта

| Параметр | Оценка | Комментарий |
|----------|--------|-------------|
| Архитектура | 7/10 | Правильная идея, но JSON-файлы вместо БД — проблема при масштабировании |
| Код backend | 6/10 | `main.py` слишком большой (2600+ строк), нужна декомпозиция |
| Extension | 7/10 | Работает, но чувствителен к DOM-изменениям LinkedIn |
| AI интеграция | 8/10 | Groq хорошо интегрирован, user memory — отличная идея |
| UX Telegram | 6/10 | Базовый, не автоматический (нужен polling каждые N минут) |
| Тесты | 4/10 | Мало тестов, нет автотестов для критических маршрутов |
| Деплой | 8/10 | Railway + автодеплой — хорошо |

**Итоговая оценка: 6.5/10** — хорошая основа, нужна доработка

---

## 🔧 Что нужно улучшить

### 🔴 Критично (делать немедленно)
1. **Авто-сканирование каждые N минут** — сейчас пользователь жмёт Scan Feed вручную.  
   Нужен `setInterval` в background.js + настройка интервала
2. **Авто-пуш задач в Telegram** — найденные посты должны автоматически приходить в чат/Mini App
3. **LinkedIn авторизация через cookies** — `li_at` cookie нужно брать автоматически из расширения, не просить вручную
4. **Реальная отправка комментариев** — сейчас только генерация, нужна реальная отправка через LinkedIn/X API или DOM-клик

### 🟡 Важно (следующий спринт)
5. **Автоматическое добавление в друзья LinkedIn** — логика есть в `linkedin_actions.js`, нужно подключить к потоку
6. **Фильтрация постов по ключевым словам** — пользователь задаёт темы, приходят только релевантные
7. **Разбить main.py** — вынести роуты в blueprints: `x_routes.py`, `linkedin_routes.py`, `settings_routes.py`
8. **SQLite вместо JSON-файлов** — надёжнее, быстрее, поддерживает конкурентный доступ
9. **Reddit интеграция** — была в планах, не реализована

### 🟢 Желательно (будущий спринт)
10. **Telegram inline-кнопки для одобрения** — approve/reject прямо в чате без Mini App
11. **Аналитика** — dashboard с метриками: сколько комментариев, лайков, новых связей
12. **Многопользовательский режим** — сейчас данные в файлах по user_id, нужна полноценная изоляция
13. **Rate limiting** — защита от спама, лимиты на действия в час

---

## ❌ Что удалить / упростить

1. **Дублирующиеся селекторы** в парсерах — оставить только 3-5 проверенных актуальных
2. **Неиспользуемые `/api/extension/linkedin/queue` роуты** — если задублированы с основными
3. **Большие блоки закомментированного кода** в main.py (есть несколько)
4. **Fake/mock данные** (тестовые posts с `sim` в URL) — убрать из production

---

## 🗺️ Дальнейший план разработки

### Sprint 1 — Auto-Scan & Push (2 недели)
**Цель: Посты сами приходят в Telegram без ручного нажатия**

- [ ] `background.js`: добавить `setInterval` авто-сканирования (каждые 5/15/30 мин — настраивается)
- [ ] `background.js`: при нахождении новых постов — отправлять на backend `/api/extension/posts/push`
- [ ] Backend: новый эндпоинт `POST /api/extension/posts/push` → Telegram Bot push notification
- [ ] Telegram Bot: отправка поста + inline-кнопки [✅ Генерировать комментарий] [❌ Пропустить]
- [ ] Настройка интервала сканирования в Extension popup

### Sprint 2 — Real Actions (2 недели)
**Цель: Комментарии и лайки реально отправляются**

- [ ] `linkedin_actions.js`: довести до рабочего состояния post_comment через DOM
- [ ] `x_actions.js`: реальный post tweet/reply через DOM-клик
- [ ] Backend: очередь действий с retry и rate limiting
- [ ] Telegram: статус выполненного действия (✅ Posted / ❌ Failed)
- [ ] LinkedIn auto-connect: нажатие Connect через расширение

### Sprint 3 — Smart Filtering (1 неделя)  
**Цель: Приходят только релевантные посты**

- [ ] Ключевые слова в настройках (уже есть в UI, нужна логика)
- [ ] AI-оценка релевантности поста (0-10) перед пушем
- [ ] Фильтр: не показывать рекламные/promoted посты
- [ ] Настройка: минимальная длина поста, минимальный engagement

### Sprint 4 — UX & Analytics (2 недели)
**Цель: Понятный интерфейс и статистика**

- [ ] Переработать Telegram Mini App — чистый feed с preview постов
- [ ] Dashboard: комментарии / лайки / connects за день/неделю
- [ ] История одобренных и отклоненных действий
- [ ] Telegram inline approve/reject без открытия Mini App

### Sprint 5 — Reddit + Scale (3 недели)
**Цель: Добавить Reddit, готовить к публичному запуску**

- [ ] Reddit content script: парсинг постов из subreddit
- [ ] AI-комментарии для Reddit стиля
- [ ] SQLite миграция данных из JSON-файлов  
- [ ] Тесты: pytest для критических API endpoints
- [ ] Документация для пользователей

---

## 🔑 Ключевые технические решения

### Как должно работать в итоге (целевое состояние):
```
1. Пользователь открывает LinkedIn/X в браузере
2. Расширение АВТОМАТИЧЕСКИ сканирует feed каждые 15 мин
3. Новые релевантные посты → backend → Telegram push
4. В Telegram: карточка поста + кнопки [Сгенерировать ответ] [Пропустить]
5. Нажимает "Сгенерировать" → 3 варианта AI-комментария
6. Выбирает вариант или редактирует → нажимает [Отправить]
7. Расширение АВТОМАТИЧЕСКИ отправляет комментарий на LinkedIn/X
8. В Telegram: ✅ "Комментарий опубликован"
```

### Архитектурные изменения для этого:
- Extension ↔ Backend: WebSocket или SSE вместо polling (для моментального push)
- Background.js: постоянный авто-скан через `chrome.alarms` API (не `setInterval` — убивается SW)
- Backend: добавить Telegram webhook push при получении новых постов

---

*Engagr v0.5 — foundation built, automation next*
