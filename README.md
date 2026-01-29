# Ruf — “Вызов”

Ruf — браузерный мини‑клиент для API (в духе Postman/Insomnia) с импортом OpenAPI/Swagger и запуском запросов прямо из UI.

## Возможности

- Импорт OpenAPI v2/v3:
  - из файла (`.json/.yaml/.yml`)
  - вставкой JSON/YAML
  - по URL (нужен CORS на стороне сервера, иначе браузер заблокирует `fetch`)
- Дерево коллекций:
  - коллекции и “контроллеры”
  - кнопка `env` для окружения каждой коллекции
- Окружение на коллекцию:
  - `Base URL`
  - дефолтные headers
- Редактор запроса:
  - секции Headers / Params / Body
  - автоподстановка `Body` из `example` (или из `schema` → `properties.*.example`, если прямого `example` нет)
- Просмотр ответа:
  - вкладки `Body` / `Headers`
  - подсветка статусов (2xx/3xx/4xx/5xx)
  - `⏱` время ответа

## Ограничения (важно)

- Приложение **только браузерное**: если API не разрешает CORS, запросы из Ruf не пройдут.
- Импорт по URL тоже зависит от CORS.
- В импорте поддерживаются локальные `$ref` вида `#/...`. Внешние `$ref` (файлы/URL) не подтягиваются.

## Быстрый старт

Требования: Node.js + npm.

```bash
npm install
npm run dev
```

Открой `http://localhost:5173` (порт может отличаться — Vite покажет в консоли).

## Desktop (Tauri)

Требования:
- Node.js + npm
- Rust toolchain (plugin-http требует Rust ≥ 1.77.2)

Запуск в dev-режиме:

```bash
npm install
npm run tauri:dev
```

Сборка desktop-приложения:

```bash
npm run tauri:build
```

## Использование

1. Нажми `+` (внизу справа) → импортируй OpenAPI:
   - `Выбрать файл`
   - `Импорт из json` (вставь JSON/YAML)
   - `Импорт из url` (введи URL спеки)
2. В левом дереве открой коллекцию → контроллер → выбери запрос.
3. Нажми `env` рядом с коллекцией и укажи:
   - `Base URL` (например `https://petstore3.swagger.io`)
   - headers (например `Authorization: Bearer ...`)
4. В редакторе заполни Params/Headers/Body при необходимости и нажми `Send`.

## Скрипты

- `npm run dev` — dev‑сервер Vite
- `npm run build` — TypeScript build + production build
- `npm run preview` — локальный просмотр production build
- `npm run lint` — ESLint
- `npm run tauri:dev` — desktop dev (Tauri + Vite)
- `npm run tauri:build` — сборка desktop (Tauri)

## Хранение данных

Данные сохраняются в `localStorage`:
- коллекции
- окружения на коллекцию
- размеры панелей

## Технологии

- React + TypeScript
- Vite
- `yaml` для YAML/JSON импорта
