# Ruf API Platform

Ruf API Platform — desktop-приложение для тестирования API, импорта коллекций и работы с SQL/терминалом в одном интерфейсе.

## Что умеет приложение

- Импорт API-коллекций из:
  - OpenAPI / Swagger (`.json`, `.yaml`, `.yml`)
  - WSDL (`.wsdl`, `.xml`)
  - Postman Collection
  - Insomnia Export
  - собственного формата `.rufcollection`
- Импорт из файла, текста или URL.
- Дерево Workspace:
  - коллекции и вложенные папки
  - drag-and-drop
  - дублирование/переименование/удаление
  - сортировка и быстрое раскрытие/сворачивание
- Полноценный редактор HTTP-запросов:
  - method + URL
  - query params
  - headers
  - body (JSON, form-data, raw и т.д.)
  - генерация `curl`
- Просмотр ответа:
  - Body / Headers / History
  - поиск по ответу
  - JsonPath-поиск
  - копирование и сохранение
- Окружения (Environment) на коллекцию:
  - переменные
  - базовый URL
  - общие headers
- SQL-инструменты:
  - настройки подключений PostgreSQL / MySQL
  - тест подключения
  - SQL Terminal
- Встроенный терминал команд:
  - Windows: PowerShell + Git Bash (если установлен)
  - macOS: macOS Terminal (zsh) + Git Bash (если найден)
- Обновления приложения из GitHub Releases (in-app updater).
- Кастомный заголовок окна с нативными кнопками управления.

## Для кого

Ruf подходит для:

- backend/frontend-разработчиков
- QA / manual testers
- DevOps / SRE, которым нужен быстрый API и SQL workflow
- команд, которым важно хранить API-коллекции локально и без облачной привязки

## Поддерживаемые платформы

- Windows
- macOS

Приложение ориентировано на desktop-сценарий (Tauri).

## Установка

1. Откройте страницу Releases репозитория.
2. Скачайте установщик под вашу ОС.
3. Установите приложение.

## Быстрый старт

1. Запустите приложение.
2. Нажмите `+` или `Add` в пустом workspace.
3. Импортируйте спецификацию (файл/текст/URL).
4. Выберите запрос в дереве слева.
5. Настройте Environment (base URL, переменные, headers).
6. Нажмите `Send`.
7. Анализируйте ответ во вкладках Body / Headers / History.

## Где хранятся данные

Данные хранятся локально в `localStorage` текущего desktop-приложения:

- коллекции
- окружения
- история запросов
- настройки интерфейса

Приложение не требует облачного аккаунта.

## Разработка (локально)

Требования:

- Node.js 20+
- npm
- Rust toolchain (stable)

Запуск в dev-режиме:

```bash
npm install
npm run tauri:dev
```

Сборка UI:

```bash
npm run tauri:ui:build
```

Сборка desktop-приложения:

```bash
npm run tauri:build
```

Проверка линтером:

```bash
npm run lint
```

## Релизы и автообновления

Подробная инструкция по релизам и ключам обновления: `RELEASING.md`.
