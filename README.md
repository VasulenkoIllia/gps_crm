# gps_crm

Система обліку абонентів для компанії, що надає послуги GPS-моніторингу: абоненти, контактні особи,
об'єкти, GPS-обладнання, SIM-картки, тарифи, договори, оплати, розсилки (Email / Telegram / Viber) та аналітика.

**Поточний стан:** клікабельний демо-прототип для обговорення вимог. Бекенду та БД ще немає — дані
вигадані, генеруються в браузері й зберігаються в `localStorage`. Маркери «?» в інтерфейсі позначають
відкриті питання, на які екран поки відповідає припущенням.

## Стек

React 19 + Vite, Ant Design 6, Recharts, TypeScript. Сервер — Node.js 24 без залежностей
(`node:http`): роздає зібраний SPA, `/health`, опційний HTTP Basic Auth.

## Команди

```bash
npm install
npm run dev          # фронтенд з hot reload: http://localhost:5173
npm run typecheck    # перевірка типів (фронтенд + сервер)
npm run build        # dist/ (SPA) + dist-server/ (сервер)
npm run start        # продакшн-сервер
```

Версія Node — 24 (`.nvmrc`).

## Структура

- `src/domain/` — модель даних, правила розрахунку абонплати й боргу, ролі та права
- `src/data/` — довідники, генератор демо-даних, відкриті питання
- `src/store/` — стан демо та дії (у реальному продукті замінюється на API)
- `src/pages/`, `src/components/`, `src/layout/` — екрани
- `server/` — продакшн-сервер
- `scripts/deploy.sh` — оновлення на сервері

## Деплой

Один контейнер за Traefik (зовнішня мережа `proxy`, entrypoint `websecure`, certresolver `cf`).
Порт на хості не публікується.

`.env` (див. `.env.example`):

- `APP_NAME=gps_crm` — назва контейнера, роутера і сервісу Traefik; має бути унікальною на сервері
- `APP_DOMAIN` — домен (DNS-запис у Cloudflare на сервер)
- `PORT`, `NODE_ENV`, `TZ`, `LOG_LEVEL` — мають значення за замовчуванням
- `BASIC_AUTH_USER`, `BASIC_AUTH_PASSWORD` — опційно закривають сайт паролем (крім `/health`)

Перший запуск:

```bash
git clone git@github.com:VasulenkoIllia/gps_crm.git && cd gps_crm
cp .env.example .env
docker compose up -d --build
```

Оновлення:

```bash
./scripts/deploy.sh
```

Скрипт робить `git pull --ff-only`, перебудовує контейнер і чекає, поки `/health` відповість.
Відкат: `git checkout <коміт> && docker compose up -d --build`.

## Правила репозиторію

- Документація не комітиться, окрім цього README: `docs/`, `AGENTS.md`, `CLAUDE.md`, `.claude/` — у `.gitignore`.
- Коміти — лише від автора репозиторію, без співавторів.
- `.env` ніколи не комітиться, лише `.env.example`.
