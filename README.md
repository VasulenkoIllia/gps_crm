# gps_crm

Система обліку клієнтів для компанії, що надає послуги GPS-моніторингу: клієнти, контактні особи, платники, договори,
об'єкти, обладнання, SIM-картки й довідники.

**Поточний стан:** фундамент застосунку (каркас, health, CI/CD, оболонка інтерфейсу), вхід із 2FA, користувачі й ролі,
журнал дій, архів, екран «Система», фонові задачі, довідники (тарифи, послуги з історією цін, собівартість, деактивація
через архів), клієнти (серії ID, контактні особи, платники, договори з файлами), обладнання й об'єкти (історія статусів,
умов, послуг і встановлень), глобальний пошук, головна сторінка, експорт списків в Excel, перевірка масштабу на сиді
1 млн клієнтів. Клікабельний демо-прототип збережений у тезі `demo`.

## Стек

- Node.js 24, TypeScript 6, ESM, npm workspaces
- API: Fastify 5, Zod 4, pino, Prisma 7 з адаптером `pg`, PostgreSQL 18, pg-boss 12
- Web: React 19, Vite 8, Ant Design 6 (`uk_UA`), React Router, TanStack Query
- Перевірки: Vitest, Playwright, ESLint, dependency-cruiser, Prettier
- Запуск: один Docker-образ, Docker Compose, Traefik, образи в GHCR, GitHub Actions

## Структура

```
apps/api            API: src/core (конфіг, БД, помилки, http, задачі), src/modules, src/jobs.ts, prisma/ (схема і міграції)
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
cp .env.example .env     # задати POSTGRES_PASSWORD, APP_DB_PASSWORD, SECRETS_KEY, FIRST_ADMIN_*,
                         # підставити паролі в DATABASE_URL і MIGRATION_DATABASE_URL
npm run db:up            # PostgreSQL 18 і Mailpit з infra/compose.dev.yml
npm run db:deploy        # застосувати міграції
npm run db:setup         # пароль ролі застосунку, схема черги й перший адміністратор
npm run dev              # API на :3000, інтерфейс на http://localhost:5173
```

Вітрина інтерфейсу: `http://localhost:5173/ui`. Листи в Mailpit: `http://localhost:8026`.

## Команди

| Команда                    | Що робить                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| `npm run verify`           | те саме, що job `verify` у CI: формат, ESLint, залежності, compose, типи, unit-тести, збірка |
| `npm run test:integration` | міграції та інтеграційні тести на PostgreSQL (потрібні `db:up` і `TEST_DATABASE_URL`)        |
| `npm run test:e2e`         | Playwright на зібраному застосунку (потрібні `build`, `db:up`, змінні `E2E_*`)               |
| `npm run format`           | відформатувати код                                                                           |
| `npm run db:migrate`       | нова міграція локально (`prisma migrate dev`)                                                |
| `npm run db:setup`         | пароль ролі, схема черги, перший адміністратор (те саме робить `migrate` на сервері)         |
| `npm run routes:update`    | оновити перелік маршрутів `route-inventory.json` (запуск з `-w @gps_crm/api`)                |
| `npm run db:down`          | зупинити локальні сервіси                                                                    |

Git-хуків немає: `.npmrc` вимикає install-скрипти (`ignore-scripts=true`), тому ворота тримає CI.

## CI/CD

`.github/workflows/ci.yml` запускається на push у `main` і на pull request, крім змін лише в `README.md`:

1. `verify`: `npm run verify`.
2. `integration`: PostgreSQL 18, міграції з нуля, тест інваріантів схеми, інтеграційні тести, збіг міграцій зі схемою.
3. `security`: gitleaks, `npm audit --omit=dev` (high блокує), перевірка авторів комітів.
4. `e2e`: зібраний застосунок з PostgreSQL 18 і Mailpit, Playwright у Chromium.
5. `image`, лише push у `main`, після чотирьох попередніх: збірка, Trivy (critical блокує), запуск образу з перевіркою
   `/health`, публікація в GHCR з тегом `sha-<коміт>`.
6. `clean-images`: у GHCR лишаються останні 30 версій.
7. `deploy-staging`, лише коли змінна репозиторію `STAGING_DEPLOY_ENABLED` дорівнює `true`.

`.github/workflows/deploy-production.yml` запускається вручну з `main` з тегом образу. Він відмовляє, поки змінна
репозиторію `PRODUCTION_ENABLED` не дорівнює `true` і якщо цей тег не пройшов `deploy-staging`.

Змінні репозиторію: `COMMIT_AUTHOR_EMAIL`, `STAGING_DEPLOY_ENABLED`, `PRODUCTION_ENABLED`. Секрети репозиторію:
`DEPLOY_SSH_KEY`, `DEPLOY_SSH_KEY_PRODUCTION`, `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_KNOWN_HOSTS`. GitHub Environments не
використовуються.

## Деплой

Сервер не потребує ні git, ні доступу до репозиторію. На ньому лежать `.env` кожного середовища, образи з GHCR, теки
релізів і бекапів, які ведуть скрипти, і два скрипти, встановлені вручну: `deploy-entry.sh` як команда обмежених
SSH-ключів і `backup.sh` для cron. На кожне середовище свій ключ.

1. CI надсилає по SSH рядок `<тег>`, середовище задає сам ключ. `--skip-migrate` після тегу додається лише вручну, для
   відкату.
2. `infra/scripts/deploy-entry.sh` суворо перевіряє його, бере блокування, тягне образ, копіює з нього `compose.yml` і
   `deploy.sh` у теку середовища й звіряє їхній хеш зі списком дозволених на сервері. Зміна цих двох файлів потребує
   одного підтвердження на сервері, звичайні релізи йдуть автоматично.
3. `infra/scripts/deploy.sh` працює окремою сесією, тож обрив SSH його не перериває. Робить дамп БД з перевіркою читання,
   запускає міграції одноразовим контейнером, піднімає застосунок і чекає `/health/ready` до 90 секунд, потім перевіряє
   маршрут Traefik. Якщо новий образ не готовий, повертає попередній і завершується з помилкою. Падіння міграції
   зупиняє деплой, запущена версія працює далі.

Запит до стану: `GET /health` (процес живий), `GET /health/ready` (база відповідає, міграції образу застосовані, немає
невдалої міграції, черга задач запущена). Порт застосунку на хості не публікується, доступ лише через Traefik.

Базовий образ закріплений за digest в `infra/Dockerfile`. Новий digest:
`docker buildx imagetools inspect node:24-alpine --format '{{json .Manifest.Digest}}'`.

## Фонові задачі

Задачі виконує pg-boss, оголошені вони в `apps/api/src/jobs.ts`. Схему `pgboss` і права ставить крок `setup` під власником
схеми, застосунок працює під роллю без DDL. HTTP відповідає кожен процес, а `APP_ROLE` вибирає решту: `all` (так на
сервері) і `worker` виконують задачі, `api` лише ставить їх у чергу. Запис про нову версію робить `all` або `api`. Стан
задач, черг, бекапів і версії показує екран «Система». Щоночі `subscribers.rollup-reconcile` звіряє статус клієнта й
лічильники об'єктів з фактом. Експорт списку в Excel іде задачею `exports.build`, яку ставить запит: файл пишеться потоком у
сховище файлів і живе 24 години, щогодини `exports.cleanup` прибирає старі файли й експорти, що не завершились.

## Бекапи

Окрім дампу перед деплоєм, `infra/scripts/backup.sh` за розкладом cron робить дамп кожні 6 годин із повним читанням і
ротацією, а раз на місяць перевіряє відновлення в тимчасовій базі без мережі. Скрипт встановлюється на сервер вручну, як
`deploy-entry.sh`: реліз його не оновлює. `compose.yml` і `deploy.sh` він не змінює. Результати скрипт пише в
`backup-status/`, застосунок читає цю теку лише на читання. Файли договорів лежать у томі `files-data` і в дамп не
входять. Покрокове відновлення: [RESTORE.md](RESTORE.md).

## Перевірка масштабу

Цілі продуктивності на 1 млн клієнтів перевіряються на окремій базі з назвою `*_scale`, ніколи на staging. Сид бере лише
`SCALE_DATABASE_URL` (`.env.example`), відмовляє базі з клієнтами поза своєю тестовою серією ID із 7 цифр і після зупинки
продовжує з того місця. На 1 млн він іде близько 40 хвилин і займає 16 ГБ, ще до 8 ГБ WAL під час запису; `--clients 10000`
перевіряє скрипт за хвилину.

```bash
# база *_scale спершу отримує міграції й setup, як на деплої (з apps/api; MIGRATION_DATABASE_URL на неї в оболонці:
# вона має перевагу над DATABASE_URL, інакше команди візьмуть її з .env і підуть у локальну базу);
# SCALE_DATABASE_URL на ту саму базу задається в середовищі оболонки
npm run seed:scale -w @gps_crm/api -- --dry-run
npm run seed:scale -w @gps_crm/api
# сесії 20 користувачів сиду й вибірки для k6, файл із токенами лише локально
npm run seed:scale -w @gps_crm/api -- --prepare-run <абсолютний шлях>.json
```

Застосунок запускається зібраним з `NODE_ENV=production` на цій базі, окремо `APP_ROLE=api` і `APP_ROLE=worker`. Далі k6
(шляхи абсолютні): `apps/api/scripts/k6/probes.js` проходить важкі запити по одному, `workday.js` дає робочий день
20 користувачів і експорт 100 тис. рядків.

```bash
k6 run -e BASE_URL=http://127.0.0.1:<порт> -e DATA=<шлях> -e SUMMARY=<шлях> apps/api/scripts/k6/probes.js
k6 run -e BASE_URL=http://127.0.0.1:<порт> -e DATA=<шлях> -e SUMMARY=<шлях> -e DURATION=10m apps/api/scripts/k6/workday.js
```

## Демо-дані

`apps/api/scripts/seed-demo.ts` готує базу до показу етапу 1: очищає всі робочі дані, крім користувачів, ролей, сесій,
2FA, стану задач і рядків журналу про людей і систему, і записує вигадане демо (довідники, серії ID, клієнти всіх типів,
об'єкти в усіх статусах з обладнанням, договори з PDF, архів, журнал). Повторний запуск замінює демо цілком. Адресу бере
лише з `DEMO_DATABASE_URL` (власник схеми), пише лише в базу staging або локальну, відмовляє базі з понад 200 клієнтами.
Усе в одній транзакції: помилка нічого не змінює. Запускається чистим Node без `tsx`, тому й у контейнері образу.

```bash
# з кореня репозиторію; --files-dir це FILES_DIR застосунку, куди лягають файли договорів
node apps/api/scripts/seed-demo.ts --database <назва бази> --files-dir <FILES_DIR> --dry-run
node apps/api/scripts/seed-demo.ts --database <назва бази> --files-dir <FILES_DIR>
```

## Правила репозиторію

- Документація не комітиться, окрім цього README і `RESTORE.md`: `docs/` і службові файли у `.gitignore`.
- Коміти лише від автора репозиторію, без співавторів. Це перевіряє CI.
- `.env` ніколи не комітиться, лише `.env.example`.
