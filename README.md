# gps_crm

Система обліку клієнтів для компанії, що надає послуги GPS-моніторингу: клієнти, контактні особи, платники, договори,
об'єкти, обладнання, SIM-картки й довідники.

**Поточний стан:** фундамент застосунку (каркас, health, CI/CD, оболонка інтерфейсу). Бізнес-модулів, входу й доменних
таблиць ще немає. Клікабельний демо-прототип збережений у тезі `demo`.

## Стек

- Node.js 24, TypeScript 6, ESM, npm workspaces
- API: Fastify 5, Zod 4, pino, Prisma 7 з адаптером `pg`, PostgreSQL 18
- Web: React 19, Vite 8, Ant Design 6 (`uk_UA`), React Router, TanStack Query
- Перевірки: Vitest, ESLint, dependency-cruiser, Prettier
- Запуск: один Docker-образ, Docker Compose, Traefik, образи в GHCR, GitHub Actions

## Структура

```
apps/api            API: src/core (конфіг, БД, помилки, http), prisma/ (схема і міграції)
apps/web            SPA: src/app (оболонка, маршрути), src/ui (тема, кит), src/lib, src/features
packages/shared     спільний код, використовується як вихідний TypeScript без збірки
infra               Dockerfile, compose.yml, compose.dev.yml, scripts/
.github/workflows   ci.yml, deploy-production.yml
```

Правила залежностей перевіряє `dependency-cruiser`: `core` не імпортує модулі, модуль імпортує інший лише через його
`index.ts`, `packages/shared` нічого не імпортує з `apps`, UI-кит не знає про фічі.

`packages/shared` у production виконує сам Node, який прибирає типи під час запуску. Тому в цьому пакеті лише синтаксис,
що стирається (без `enum`), а відносні імпорти вказують на файл `.ts`.

## Локальний запуск

Версія Node: 24 (`.nvmrc`).

```bash
npm ci
cp .env.example .env     # задати POSTGRES_PASSWORD і підставити його в DATABASE_URL
npm run db:up            # PostgreSQL 18 і Mailpit з infra/compose.dev.yml
npm run db:deploy        # застосувати міграції
npm run dev              # API на :3000, інтерфейс на http://localhost:5173
```

Вітрина інтерфейсу: `http://localhost:5173/ui`. Листи в Mailpit: `http://localhost:8026`.

## Команди

| Команда                    | Що робить                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| `npm run verify`           | те саме, що job `verify` у CI: формат, ESLint, залежності, compose, типи, unit-тести, збірка |
| `npm run test:integration` | міграції та інтеграційні тести на PostgreSQL (потрібні `db:up` і `TEST_DATABASE_URL`)        |
| `npm run format`           | відформатувати код                                                                           |
| `npm run db:migrate`       | нова міграція локально (`prisma migrate dev`)                                                |
| `npm run db:down`          | зупинити локальні сервіси                                                                    |

Git-хуків немає: `.npmrc` вимикає install-скрипти (`ignore-scripts=true`), тому ворота тримає CI.

## CI/CD

`.github/workflows/ci.yml` запускається на push у `main` і на pull request, крім змін лише в цьому файлі:

1. `verify`: `npm run verify`.
2. `integration`: PostgreSQL 18, міграції з нуля, тест інваріантів схеми, інтеграційні тести, збіг міграцій зі схемою.
3. `security`: gitleaks, `npm audit --omit=dev` (high блокує), перевірка авторів комітів.
4. `image`, лише push у `main`, після трьох попередніх: збірка, Trivy (critical блокує), запуск образу з перевіркою
   `/health`, публікація в GHCR з тегом `sha-<коміт>`.
5. `clean-images`: у GHCR лишаються останні 30 версій.
6. `deploy-staging`, лише коли змінна репозиторію `STAGING_DEPLOY_ENABLED` дорівнює `true`.

`.github/workflows/deploy-production.yml` запускається вручну з `main` з тегом образу. Він відмовляє, поки змінна
репозиторію `PRODUCTION_ENABLED` не дорівнює `true` і якщо цей тег не пройшов `deploy-staging`.

Змінні репозиторію: `COMMIT_AUTHOR_EMAIL`, `STAGING_DEPLOY_ENABLED`, `PRODUCTION_ENABLED`. Секрети репозиторію:
`DEPLOY_SSH_KEY`, `DEPLOY_SSH_KEY_PRODUCTION`, `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_KNOWN_HOSTS`. GitHub Environments не
використовуються.

## Деплой

Сервер не потребує ні git, ні доступу до репозиторію. На ньому лежать лише `.env` кожного середовища, образи з GHCR і
`deploy-entry.sh`, встановлений один раз як команда обмежених SSH-ключів. На кожне середовище свій ключ.

1. CI надсилає по SSH рядок `<тег> [--skip-migrate]`, середовище задає сам ключ.
2. `infra/scripts/deploy-entry.sh` суворо перевіряє його, бере блокування, тягне образ, копіює з нього `compose.yml` і
   `deploy.sh` у теку середовища й звіряє їхній хеш зі списком дозволених на сервері. Зміна цих двох файлів потребує
   одного підтвердження на сервері, звичайні релізи йдуть автоматично.
3. `infra/scripts/deploy.sh` працює окремою сесією, тож обрив SSH його не перериває. Робить дамп БД з перевіркою читання,
   запускає міграції одноразовим контейнером, піднімає застосунок і чекає `/health/ready` до 90 секунд, потім перевіряє
   маршрут Traefik. Якщо новий образ не готовий, повертає попередній і завершується з помилкою. Падіння міграції
   зупиняє деплой, запущена версія працює далі.

Запит до стану: `GET /health` (процес живий), `GET /health/ready` (база відповідає, міграції образу застосовані, немає
невдалої міграції). Порт застосунку на хості не публікується, доступ лише через Traefik.

Базовий образ закріплений за digest в `infra/Dockerfile`. Новий digest:
`docker buildx imagetools inspect node:24-alpine --format '{{json .Manifest.Digest}}'`.

## Правила репозиторію

- Документація не комітиться, окрім цього README: `docs/` і службові файли у `.gitignore`.
- Коміти лише від автора репозиторію, без співавторів. Це перевіряє CI.
- `.env` ніколи не комітиться, лише `.env.example`.
