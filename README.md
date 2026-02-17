# Ruf API Platform

## English

### Description
Ruf API Platform is a desktop API workspace for engineers who want to test, debug, and iterate faster without switching between multiple tools. It combines API requests, response analysis, environments, SQL utilities, and terminal workflows in one place.

The main advantage is workflow speed: import a spec, run requests, inspect results, and execute related SQL from the same interface. Data stays local, setup is simple, and day-to-day integration work becomes more predictable.

### Capabilities
- Import from OpenAPI/Swagger, Postman, Insomnia, WSDL, and `.rufcollection`
- Import via file, raw text, URL, and drag-and-drop
- Workspace tree with folders, search, sorting, and drag-and-drop reordering
- Full HTTP request editor: method, URL, params, headers, auth, and body
- Body modes: JSON, XML, YAML, text, multipart/form-data, and file upload
- Variable-based environments with per-collection settings
- Response viewer with body/headers/history, search, and JSON schema generation
- cURL generation from the current request state
- Data-driven request runs from JSON/CSV datasets
- Collection and folder runner with run history and rerun flow
- SQL pre/post scripts at request level
- Built-in SQL terminal (PostgreSQL/MySQL)
- Built-in command terminal (PowerShell/Git Bash on Windows, zsh/Git Bash on macOS)
- Certificate controls (custom CA, TLS validation switch)
- In-app updates via GitHub Releases

### Installation
#### Option 1: Install desktop app
1. Open the repository `Releases` page.
2. Download the installer for your OS.
3. Install and launch Ruf API Platform.

#### Option 2: Run from source
Requirements:
- Node.js 20+
- npm
- Rust toolchain (stable)

Commands:
```bash
npm install
npm run tauri:dev
```

Build UI:
```bash
npm run tauri:ui:build
```

Build desktop app:
```bash
npm run tauri:build
```

### License
Licensed under the MIT License. See `LICENSE`.

---

## Русский

### Описание
Ruf API Platform — desktop-инструмент для работы с API в едином пространстве: от импорта спецификаций до запуска запросов, анализа ответов и сопутствующих SQL/терминальных задач. Он рассчитан на разработчиков и QA, которым важны скорость и цельный рабочий процесс.

Ключевое преимущество — меньше переключений между сервисами и быстрее цикл изменений. Вы можете импортировать коллекцию, протестировать запросы, проверить ответ и выполнить SQL в одном интерфейсе, с локальным хранением данных.

### Возможности
- Импорт из OpenAPI/Swagger, Postman, Insomnia, WSDL и `.rufcollection`
- Импорт из файла, текста, URL и через drag-and-drop
- Дерево workspace: папки, поиск, сортировка, drag-and-drop
- Полноценный HTTP-редактор: метод, URL, параметры, заголовки, авторизация, body
- Форматы body: JSON, XML, YAML, text, multipart/form-data, загрузка файлов
- Окружения с переменными и настройками на коллекцию
- Просмотр ответов (body/headers/history), поиск и генерация JSON Schema
- Генерация `curl` по текущему запросу
- Data-driven запуск запросов по JSON/CSV
- Раннер коллекций и папок с историей запусков
- SQL pre/post скрипты на уровне запроса
- Встроенный SQL Terminal (PostgreSQL/MySQL)
- Встроенный терминал команд (PowerShell/Git Bash на Windows, zsh/Git Bash на macOS)
- Настройки сертификатов (кастомные CA, переключение TLS-валидации)
- Встроенные обновления приложения через GitHub Releases

### Установка
#### Вариант 1: Установка desktop-приложения
1. Откройте страницу `Releases` репозитория.
2. Скачайте установщик под вашу ОС.
3. Установите и запустите Ruf API Platform.

#### Вариант 2: Запуск из исходников
Требования:
- Node.js 20+
- npm
- Rust toolchain (stable)

Команды:
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

### License
Проект распространяется под лицензией MIT. См. файл `LICENSE`.
