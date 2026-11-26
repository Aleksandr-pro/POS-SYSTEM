<!-- Значение JWT_SECRET вырезано при переносе в публичный репозиторий. См. SECURITY.md. -->
# Подключаем сервер Cloudflare — пошагово

Идём вместе. 6 шагов, ~15 минут. Ничего устанавливать не нужно — только браузер.
Всё, что нужно вставлять, лежит в файлах рядом: **`worker.js`** и **`schema.sql`**.

> В версии 2.5.0 в worker.js добавлена коллекция `supplies` (поставки на склад).
> Если Worker уже был опубликован раньше — скопируйте `worker.js` заново и нажмите **Deploy**.

Ваши значения (запишите, пригодятся):

| Что | Значение |
|---|---|
| Имя базы D1 | `poskontrol` |
| Имя Worker | `pos-kontrol-api` |
| Привязка базы | `DB` |
| Секрет | `JWT_SECRET` |
| Секрет — значение | **не хранится в репозитории** — см. `SECURITY.md`; возьмите из Google Диска (папка 3) или из Cloudflare → Worker → Settings → Variables and Secrets |

---

## Шаг 1. Аккаунт Cloudflare

1. Откройте **https://dash.cloudflare.com/sign-up**
2. Введите email и пароль → **Sign up**.
3. Подтвердите email по письму от Cloudflare (без этого Worker не задеплоится).

Уже есть аккаунт — сразу **https://dash.cloudflare.com/login**

---

## Шаг 2. Создаём базу данных

1. Откройте **https://dash.cloudflare.com/?to=/:account/workers/d1**
   (если ссылка откроет не тот раздел: меню слева → **Storage & Databases → D1 SQL Database**).
2. Кнопка **Create** / **Create database**.
3. **Name**: `poskontrol`
4. **Location hint** (если спросит): `EEUR` (Eastern Europe) — ближе к Казахстану. Если нет — пропустите.
5. **Create**.

Дальше — таблицы:

6. Откройте созданную базу `poskontrol` → вкладка **Console**.
7. Вставьте в поле запроса весь текст ниже и нажмите **Execute**:

```sql
CREATE TABLE IF NOT EXISTS records (
  collection TEXT NOT NULL,
  id         TEXT NOT NULL,
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (collection, id)
);
CREATE INDEX IF NOT EXISTS idx_records_sync ON records (collection, updated_at);
CREATE INDEX IF NOT EXISTS idx_records_deleted ON records (deleted_at);
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  user_name  TEXT,
  action     TEXT NOT NULL,
  collection TEXT,
  entity_id  TEXT,
  ip         TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_log (created_at DESC);
INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1');
```

8. Проверка: в консоли выполните
   `SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%';`
   Должно вывести 3 строки: **records**, **meta**, **audit_log**.

> Если консоль ругается на несколько запросов сразу — выполняйте их по одному в том же порядке (файл `schema.sql` разбит так же).

---

## Шаг 3. Создаём Worker (сам сервер)

1. Откройте **https://dash.cloudflare.com/?to=/:account/workers-and-pages**
2. **Create** → **Workers** → **Start with Hello World!** → **Get started**.
3. **Name**: `pos-kontrol-api` → **Deploy**.
4. Если Cloudflare попросит выбрать поддомен `workers.dev` — введите любой свободный,
   например `ivan-pos` (латиница). Тогда адрес сервера будет
   `https://pos-kontrol-api.ivan-pos.workers.dev`.
5. В карточке Worker нажмите **Edit code** (или «Continue to project» → **Edit code**).
6. В редакторе выделите весь шаблонный код (**Ctrl+A** / на телефоне — выделить всё) и удалите.
7. Откройте файл **`worker.js`** (лежит рядом с этой инструкцией), скопируйте **всё** его содержимое
   и вставьте в редактор.
8. Нажмите **Deploy** (справа сверху).

9. Скопируйте адрес вида `https://pos-kontrol-api.<ваш-поддомен>.workers.dev` — он нужен в шаге 6.

---

## Шаг 4. Привязываем базу к Worker

1. В карточке Worker: **Settings** → **Bindings** → **Add** → **D1 database**.
2. **Variable name**: `DB` (ровно две буквы, заглавные).
3. **D1 database**: выберите `poskontrol`.
4. **Save** / **Add binding**.
5. Нажмите **Deploy**, чтобы применить (Cloudflare попросит подтвердить новую версию).

---

## Шаг 5. Секрет для токенов входа

1. Там же: **Settings** → **Variables and Secrets** → **Add**.
2. Тип: **Secret**.
3. **Name**: `JWT_SECRET`
4. **Value**: `<ВСТАВЬТЕ-СЕКРЕТ>`
5. **Save** → **Deploy**.

---

## Шаг 6. Проверяем, что сервер живой

Откройте в браузере:

```
https://pos-kontrol-api.<ваш-поддомен>.workers.dev/api/health
```

Должно быть ровно так:

```json
{"ok":true,"app":"POS Контроль API","version":"1.0.0","users":0,"hasSecret":true}
```

- `"users":0` — база подключена, пользователей пока нет ✅
- `"users":-1` — база не привязана (вернитесь к шагу 4)
- `"hasSecret":false` — не задан `JWT_SECRET` (шаг 5) или не нажат Deploy
- `"error":"Не подключена база D1 (binding DB)"` — привязка называется не `DB`

---

## Шаг 7. Подключаем приложение

1. Откройте POS Контроль.
2. На экране входа внизу — **«Подключить сервер»**
   (если уже вошли: **Настройки → Сервер и синхронизация**).
3. Вставьте адрес **без** `/api` и без слэша на конце:
   `https://pos-kontrol-api.ivan-pos.workers.dev`
4. **Проверить связь** → должно появиться «Сервер доступен · пользователей: 0».
5. **Сохранить**.
6. Теперь вход:
   - **первый аккаунт** → «Создать аккаунт на сервере» (или «Зарегистрироваться» на экране входа).
     Этот пользователь станет **Администратором**;
   - **сотрудники** → те же адрес + логин и пароль, которые им создал администратор.
7. После входа нажмите **«Синхронизировать»** — локальные данные уйдут в облако.

На втором устройстве: тот же адрес сервера → войти тем же логином → данные подтянутся сами.

---

## Если что-то пошло не так

| Что видите | Что делать |
|---|---|
| При деплое «You need to register a workers.dev subdomain» | придумайте поддомен в открывшемся окне |
| `/api/health` отдаёт 500 `Не подключена база D1` | шаг 4: привязка должна называться ровно `DB` |
| `/api/health` отдаёт `hasSecret:false` | шаг 5 + нажать **Deploy** после добавления секрета |
| «Ошибка 1102 Worker exceeded CPU» | маловероятно (заложено под бесплатный тариф), пришлите мне текст ошибки |
| В приложении «Нет связи с сервером» | адрес должен начинаться с `https://`, без `/api` на конце |
| «Это имя пользователя уже занято» | логин занят в облаке — выберите другой |
| Вход не проходит, а пароль верный | пароль облака и пароль локального аккаунта — разные; сбросьте у администратора |

**Проверка изнутри (по желанию):** можете открыть
`https://pos-kontrol-api.<поддомен>.workers.dev/api/health?x=1` — тот же ответ.

---

## Когда закончите

Пришлите мне адрес `https://pos-kontrol-api.<ваш-поддомен>.workers.dev` — я отсюда проверю
health, регистрацию и синхронизацию и скажу, всё ли в порядке.

### Что важно знать про бесплатный тариф

- 100 000 запросов в день, 10 мс процессорного времени на запрос — приложению хватает с запасом.
- Пароли: PBKDF2-SHA256 10 000 итераций + секретный «перец» (`JWT_SECRET`).
  Поэтому **не меняйте `JWT_SECRET`** после первых регистраций — пароли перестанут подходить.
- Данные хранятся в D1 (SQLite) в вашем аккаунте Cloudflare; доступ — только по адресу Worker
  и токену. Резервную копию можно сделать в приложении: Настройки → «Скачать копию (JSON)».
