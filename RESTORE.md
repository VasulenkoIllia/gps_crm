# Відновлення gps_crm

Для того, хто відновлює базу вперше й без автора поруч. Команди виконуються по одній, у кожного кроку позначено, де він
виконується і чи щось пише. Приклади для staging. Для production у шляхах, назві проєкту й контейнері замість `staging`
стоїть `production`, а база має ту назву, що в `POSTGRES_DB` файлу `.env` (`gps_crm` у прикладах).

Нічого не відновлювати просто на всякий випадок: розділ потрібен для аварій. Код повертається окремо й без торкання
даних, відкатом на попередній тег.

## Що є

Дампи лежать у `backups/` теки середовища, `/var/www/projects/gps_crm_staging`. Формат `pg_dump -Fc`. Права лише для
власника. Дампи не шифруються, тому з сервера нікуди не копіюються відкритими.

| Файли                        | Коли з'являються     | Скільки лишається |
| ---------------------------- | -------------------- | ----------------- |
| `scheduled-<дата-час>.dump`  | кожні 6 годин        | 8, це дві доби    |
| `daily-<дата>.dump`          | перший дамп доби     | 7                 |
| `weekly-<рікWтиждень>.dump`  | перший дамп тижня    | 4                 |
| `predeploy-<час>-<тег>.dump` | перед кожним деплоєм | 10                |

Час у назвах за UTC, крім `predeploy`: там час сервера. У `predeploy` тег це реліз, який тоді викочувався, а дані в дампі
ще до його міграцій. Денні й тижневі копії це той самий файл, що й дамп, з якого вони взяті, тому місця вони майже не
займають. Дамп, що не прочитався повністю, у ротацію не потрапляє, і старі копії тоді не видаляються.

`.env` у дампі немає. Пароль БД і решта значень мають бути в менеджері паролів. У дампі немає й ролей PostgreSQL: зараз
роль одна, її створює сам контейнер з `.env`.

**Копії поза сервером поки немає.** Дампи лежать на тому самому диску, що й база. Вони рятують від помилки в даних і
невдалої міграції, але не від втрати сервера. До завантаження реальних даних копія поза сервером обов'язкова.

## Як перевірити, що бекапи працюють

На сервері після ssh (лише читає). Очікується `"ok":true` і свіжий `lastOkAt`: дамп не старший за 7 годин, перевірка
відновлення не старша за місяць.

```bash
cd /var/www/projects/gps_crm_staging && cat backup-status/dump.json backup-status/check.json && tail -n 5 backup.log
```

Перевірка відновлення вручну. На сервері після ssh (пише лише тимчасовий контейнер, живу базу читає). Бере найновіший
дамп за розкладом, піднімає окрему базу без мережі, відновлює дамп, порівнює таблиці й кількість рядків із живою базою, видаляє
контейнер разом з томом. Очікується `... restores: <N> tables`.

```bash
/var/www/projects/gps_crm_deploy/backup.sh staging check
```

Коли `"ok":false`, поле `reason` каже, що сталось. Подробиці в `backup.log` і `restore-check.log`.

| `reason`            | Що сталось                                   | Що робити                                                   |
| ------------------- | -------------------------------------------- | ----------------------------------------------------------- |
| `lock`              | деплой годину тримав блокування              | глянути `deploy.log`, запустити дамп вручну                 |
| `busy`              | перевірка вже йде                            | дочекатись її завершення                                    |
| `no-db`             | немає рівно одного здорового контейнера `db` | перевірити стан контейнерів, база могла впасти              |
| `disk`              | мало місця на диску                          | звільнити місце: диск спільний, чужого не чіпати            |
| `dump`, `read-back` | дамп не знявся за годину або не прочитався   | лог бази; дамп не записаний, старі копії цілі               |
| `no-dump`           | немає жодного дампа за розкладом             | запустити `backup.sh staging dump`                          |
| `restore`           | дамп не відновився                           | справжня тривога: відновити старіший дамп кроками 2-3 нижче |
| `tables`, `rows`    | відновлені дані не схожі на живі             | те саме; у логу названо таблиці                             |
| `cleanup`           | не видалився тимчасовий контейнер            | видалити вручну: `docker rm -f -v <контейнер з логу>`       |
| `live`              | не вдалося прочитати живу базу               | перевірити контейнер `db`, повторити                        |
| `unknown`           | скрипт зупинився не на передбаченому кроці   | читати лог                                                  |

## Дані зіпсовані, сервер справний

Жива база до кроку 5 не змінюється. Дамп відновлюється поруч окремою базою, а перемикання міняє дві назви однією
транзакцією. Стара база лишається під іншою назвою, поки її не видалять вручну.

Якщо все зламав реліз, а не дії в застосунку, спершу поверніть код відкатом на попередній тег, а дамп беріть
`predeploy-*-<TAG>.dump`, де `<TAG>` це невдалий реліз. Крок 6 тоді пропускається: міграцію цього релізу застосовувати
не можна. На кроці 7 `current_tag` уже показує попередній тег.

**0. На своєму комп'ютері: вимкнути автодеплой (пише в GitHub).** Деплой посеред відновлення перезапустив би застосунок і міг би
застосувати міграцію не до тієї бази. Для production цей крок не потрібен: там деплой запускається вручну.

```bash
gh variable set STAGING_DEPLOY_ENABLED --body false --repo VasulenkoIllia/gps_crm
```

**1. На сервері після ssh: вибрати дамп (лише читає).** Запишіть назву файлу, вона буде `<DUMP>`. Очікується перелік
дампів з розмірами й контейнер `gps_crm_staging-db-1` зі станом `healthy`.

```bash
cd /var/www/projects/gps_crm_staging && ls -lht backups/ && docker ps --filter name=gps_crm_staging-db --format '{{.Names}} {{.Status}}'
```

**2. На сервері після ssh: відновити дамп поруч (пише окрему базу `gps_crm_restore`).** Якщо така база вже є після
минулої спроби, спершу видаліть її командою з кроку 9, вказавши `gps_crm_restore`. Очікується `restored` в кінці.

```bash
cd /var/www/projects/gps_crm_staging && docker exec gps_crm_staging-db-1 sh -c 'createdb -U "$POSTGRES_USER" gps_crm_restore' && docker exec -i gps_crm_staging-db-1 sh -c 'pg_restore -U "$POSTGRES_USER" -d gps_crm_restore --exit-on-error --single-transaction' < backups/<DUMP> && echo restored
```

**3. На сервері після ssh: подивитись, що відновилось (лише читає).** Очікується кількість таблиць і остання міграція.
Переконайтесь, що це потрібні дані: кількість рядків у потрібній таблиці дасть запит
`select count(*) from <TABLE>` у тій самій команді.

```bash
docker exec -i gps_crm_staging-db-1 sh -c 'psql -U "$POSTGRES_USER" -d gps_crm_restore -X -At' <<'SQL'
select 'tables', count(*) from pg_tables where schemaname not in ('pg_catalog', 'information_schema');
select 'latest migration', max(migration_name) from _prisma_migrations where finished_at is not null and rolled_back_at is null;
SQL
```

**4. На сервері після ssh: зупинити застосунок (пише).** Звідси сайт не працює до кроку 7. Очікується `Stopped`.

```bash
cd /var/www/projects/gps_crm_staging && IMAGE_TAG=$(cat current_tag) docker compose --project-name gps_crm_staging --env-file .env -f release/compose.yml stop app
```

**5. На сервері після ssh: перемкнути бази (пише).** Завершує всі з'єднання й міняє назви однією транзакцією: або обидві,
або жодна. Жива база стає `gps_crm_replaced`. Очікується `COMMIT`. Якщо база `gps_crm_replaced` уже є, спершу видаліть її
(крок 9). Помилка `is being accessed by other users` означає, що з'єднання ще не закрилось: повторіть команду.

```bash
docker exec -i gps_crm_staging-db-1 sh -c 'psql -U "$POSTGRES_USER" -d postgres -X -v ON_ERROR_STOP=1' <<'SQL'
select count(pg_terminate_backend(pid)) from pg_stat_activity where datname in ('gps_crm', 'gps_crm_restore') and pid <> pg_backend_pid();
begin;
alter database gps_crm rename to gps_crm_replaced;
alter database gps_crm_restore rename to gps_crm;
commit;
SQL
```

**6. На сервері після ssh: міграції (пише).** Дамп може бути старший за запущений реліз, тоді застосунок не стане готовим,
поки схема не наздожене код. Очікується `No pending migrations to apply` або список застосованих міграцій.

```bash
cd /var/www/projects/gps_crm_staging && IMAGE_TAG=$(cat current_tag) docker compose --project-name gps_crm_staging --env-file .env -f release/compose.yml run --rm -T migrate
```

**7. На сервері після ssh: запустити застосунок (пише).** Очікується `Healthy` у рядку контейнера `app`.

```bash
cd /var/www/projects/gps_crm_staging && IMAGE_TAG=$(cat current_tag) docker compose --project-name gps_crm_staging --env-file .env -f release/compose.yml up -d --no-deps --wait --wait-timeout 90 app
```

**8. На своєму комп'ютері: перевірка (лише читає).** Очікується `200`. Далі перевірте дані в застосунку.

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<APP_DOMAIN>/health/ready
```

**Якщо треба повернути базу, яка була до відновлення.** На сервері після ssh, пише. Спершу крок 4, потім ця команда,
потім крок 7. Відновлена база знову стає `gps_crm_restore`. Очікується `COMMIT`.

```bash
docker exec -i gps_crm_staging-db-1 sh -c 'psql -U "$POSTGRES_USER" -d postgres -X -v ON_ERROR_STOP=1' <<'SQL'
select count(pg_terminate_backend(pid)) from pg_stat_activity where datname in ('gps_crm', 'gps_crm_replaced') and pid <> pg_backend_pid();
begin;
alter database gps_crm rename to gps_crm_restore;
alter database gps_crm_replaced rename to gps_crm;
commit;
SQL
```

**9. На сервері після ssh: прибрати стару базу (видаляє).** Лише коли дані перевірені: це повна копія попередніх даних.
Назву вказуйте точно, живу `gps_crm` так видаляти не можна. Очікується порожній вивід.

```bash
docker exec gps_crm_staging-db-1 sh -c 'dropdb -U "$POSTGRES_USER" gps_crm_replaced'
```

**10. На своєму комп'ютері: увімкнути автодеплой (пише в GitHub).**

```bash
gh variable set STAGING_DEPLOY_ENABLED --body true --repo VasulenkoIllia/gps_crm
```

## Сервер втрачено

Поки копії поза сервером немає, дампи втрачені разом із сервером. Дані лишаються лише там, куди дамп скопіювали вручну.
Докладні команди налаштування в `docs/deployment.md`: цей документ лежить у власника, поза репозиторієм. Мінімум без
нього:

1. Сервер: Docker Engine 25 або новіший, compose 2.20 або новіший, Traefik зі спільною мережею `proxy`.
2. Теки `/var/www/projects/gps_crm_staging` і `gps_crm_deploy` з правами 700, `.env` з менеджера паролів, права 600:
   назви змінних в `.env.example`, `APP_NAME` дорівнює назві теки.
3. З образу поточного релізу в `gps_crm_deploy`: `infra/scripts/deploy-entry.sh` і `infra/scripts/backup.sh`, через
   `docker create` і `docker cp`, зі звіркою хешу з кодом цього коміту. Хеш пари `compose.yml` і `deploy.sh` одним рядком
   у `approved-infra.sha256`, порядок саме такий: `cat compose.yml deploy.sh | sha256sum`.
4. Новий ключ деплою в `authorized_keys` з `command="/var/www/projects/gps_crm_deploy/deploy-entry.sh staging",restrict`,
   приватна частина в секреті `DEPLOY_SSH_KEY`, адреса в `DEPLOY_HOST`, рядок `ssh-keyscan` у `DEPLOY_KNOWN_HOSTS`.
5. Перший деплой цим ключем: команда `<тег>`. Він створює порожню базу й застосовує міграції.
6. Розклад: у crontab користувача деплою `backup.sh staging dump` кожні 6 годин і `backup.sh staging check` раз на
   місяць.
7. Якщо дамп є, скопіювати його в `backups/`, права 600, далі кроки 0-10 розділу вище.
