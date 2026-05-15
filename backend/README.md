# Warehouse Brain Backend

Бэкенд для PWA "Учёт брака" — Fastify + PostgreSQL + WebSocket.

## Быстрый старт

```bash
cd backend
npm install
cp .env.example .env          # настройте переменные
npm run db:init               # создаёт таблицы + seed данные
npm run dev                   # запускает на :3001
```

## Требования

- Node.js ≥ 18
- PostgreSQL 14+ (установите локально, через WSL2 или Docker)

## Переменные окружения (.env)

| Переменная | Описание | По умолчанию |
|---|---|---|
| POSTGRES_HOST | Хост БД | localhost |
| POSTGRES_PORT | Порт БД | 5432 |
| POSTGRES_DB | Имя БД | warehouse_brain |
| POSTGRES_USER | Пользователь | postgres |
| POSTGRES_PASSWORD | Пароль | password |
| JWT_SECRET | Секрет для JWT | change-this... |
| BACKEND_PORT | Порт сервера | 3001 |

## Команды

```bash
npm run dev          # dev-сервер с nodemon
npm run db:migrate   # применить миграции
npm run db:rollback  # откатить последнюю миграцию
npm run db:seed      # загрузить seed данные (admin профиль)
npm run db:init      # migrate + seed разом
```

## API Endpoints

### Auth
| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/auth/login` | Логин/регистрация по employeeId |
| GET | `/api/auth/me` | Текущий пользователь (JWT) |

### Brain Items
| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/brain` | Все товары БД брака (JWT) |
| POST | `/api/brain/import` | Импорт из Excel (JWT) |
| DELETE | `/api/brain` | Очистка БД (admin, JWT) |

### Boxes
| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/boxes` | Все короба (JWT) |
| POST | `/api/boxes` | Создать активный короб (JWT) |
| PUT | `/api/boxes/:id` | Обновить короб/items (JWT) |
| DELETE | `/api/boxes/:id` | Удалить короб (JWT) |
| GET | `/api/boxes/:id/items` | Товары короба (JWT) |

### Separate Items
| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/separate` | Все отдельные items (JWT) |
| POST | `/api/separate` | Добавить item (JWT) |
| DELETE | `/api/separate/:id` | Удалить item (JWT) |

### Maintenance
| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/maintenance` | Статус maintenance mode (JWT) |
| PUT | `/api/maintenance` | Обновить статус (JWT) |

### Scan History
| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/scan-history/batch` | Пакетная отправка сканов (JWT) |

## WebSocket

Подключиться: `ws://localhost:3001/ws/sync`

События:
- `connected` — подключение установлено
- `init` — начальное состояние maintenance mode
- `maintenance_mode_changed` — обновление статуса
- `ping/pong` — heartbeat

Фронтенд отправляет:
- `{ type: 'subscribe', boxId? }` — подписка на короб
- `{ type: 'unsubscribe', boxId }` — отписка
- `{ type: 'ping' }` — проверка связи

## Структура

```
backend/
├── migrations/          # SQL миграции
│   └── 001_init.sql    # основная схема БД
├── seed.js             # начальные данные (admin)
├── src/
│   ├── server.js       # Fastify bootstrap
│   ├── config.js       # env parsing
│   ├── db/
│   │   └── index.js    # pg pool + query helpers
│   ├── routes/         # API endpoints
│   │   ├── auth.js     # login/me
│   │   ├── profile.js  # GET/PUT /:employeeId
│   │   ├── brain.js    # CRUD brain items
│   │   ├── boxes.js    # CRUD boxes + box_items
│   │   ├── separate.js # CRUD separate items
│   │   ├── maintenance.js # GET/PUT maintenance mode
│   │   └── scan-history.js # POST batch scans
│   ├── ws/
│   │   ├── index.js    # WebSocket init
│   │   ├── sync-ws.js  # /ws/sync handler
│   │   └── broadcast.js # broadcast helper
│   └── middleware/     # auth, error handling
```
