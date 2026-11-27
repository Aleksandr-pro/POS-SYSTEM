# Сборка APK для POS Контроль

Готовый APK лежит в `dist/POS-Kontrol-2.1.0.apk` (388 КБ, подписан схемами v1+v2+v3).
Этот документ объясняет, как он собирается и как собрать/пересобрать его ещё раз.

---

## 1. Сборка без Gradle (так собран текущий APK)

Требуется только JDK 17 и Android SDK build-tools + platform 34 — **Android Studio не нужна**.

```bash
python3 build.py                     # собирает web/ (отдельные файлы) и dist/index.html
bash android-build/build_apk.sh      # собирает и подписывает APK
```

Скрипт делает 11 шагов:

| Шаг | Инструмент | Что делает |
|---|---|---|
| 1–2 | — | копирует `web/` в `android-build/build/assets/www` (без service worker) |
| 3 | `aapt2 compile` | компилирует ресурсы (`res/`) |
| 4 | `aapt2 link` | линкует манифест, ресурсы и assets в `base.apk` |
| 5 | `javac` | компилирует `MainActivity.java`, `FileShareProvider.java` против `android.jar` |
| 6 | `d8` | переводит классы в `classes.dex` |
| 7 | `zip` | добавляет dex в APK |
| 8 | `zipalign -p -f 4` | выравнивание |
| 9 | `keytool` | создаёт ключ `android-build/poskontrol.keystore`, если его нет |
| 10 | `apksigner` | подписывает (v1 + v2 + v3) |
| 11 | `apksigner verify` | проверяет подпись |

Пути к SDK/JDK можно переопределить переменными `ANDROID_SDK` и `JAVA_HOME`.

### Подпись
- Keystore: `android-build/poskontrol.keystore`
- Alias: `poskontrol`, пароль хранилища и ключа: `poskontrol2026`
- SHA-256 сертификата: `6ae4223b…5e22dccac`

> **Важно:** сохраните keystore. Android устанавливает обновление только поверх APK
> с той же подписью. Потеря ключа = переустановка приложения (данные в localStorage
> придётся переносить через резервную копию JSON).

### Что изменять при выпуске новой версии
1. `APP_CONFIG.version` в `src/core.js`
2. `android:versionCode` и `android:versionName` в `android-build/AndroidManifest.xml`
   (versionCode обязательно увеличивать)
3. Пересобрать: `python3 build.py && bash android-build/build_apk.sh`

---

## 2. Структура нативной оболочки

```
android-build/
├── AndroidManifest.xml          package kz.poskontrol.app, minSdk 23, target 34
├── build_apk.sh                 сборка одной командой
├── src/kz/poskontrol/app/
│   ├── MainActivity.java        WebView, камера/файлы, тема, «Назад», мост AndroidPos
│   └── FileShareProvider.java   раздача файлов экспорта (content://)
├── res/
│   ├── values/, values-night/   темы системных панелей
│   ├── mipmap-*/                иконки 48–192 px + adaptive icon
│   └── drawable/                vector-логотип, splash
└── poskontrol.keystore          ключ подписи
```

### Мост `AndroidPos` (доступен из веб-части)
| Метод | Назначение |
|---|---|
| `exportFile(name, base64, mime)` | сохраняет файл в `Android/data/kz.poskontrol.app/files/exports` и открывает «Поделиться» |
| `setTheme('dark' \| 'light')` | перекрашивает статус-бар и навигацию под тему |
| `toast(text)` | системное всплывающее сообщение |
| `getVersion()` | версия приложения |

В браузере мост отсутствует — код вызывает его только при наличии (`window.AndroidPos`).

### Разрешения
`INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `CAMERA`,
`READ_EXTERNAL_STORAGE` (≤ API 32), `WRITE_EXTERNAL_STORAGE` (≤ API 28).

---

## 3. Сборка через Android Studio (если нужен Gradle-проект)

```bash
npm install
npm run build
npx cap add android
npx cap sync android
npx cap open android       # Build ▸ Build APK(s)
```
Разрешения добавьте из `android-snippets/AndroidManifest.permissions.xml`.

## 4. Сборка в GitHub Actions

`.github/workflows/build-apk.yml` — загрузите проект в репозиторий и запустите workflow,
APK придёт артефактом. Android Studio на компьютере не нужна.

---

## 5. Установка на телефон

1. Скопируйте `POS-Kontrol-2.1.0.apk` на устройство (Telegram «Избранное», кабель, Drive).
2. Откройте файл → разрешите «Установка из неизвестных источников» для файлового менеджера/Telegram.
3. При первом запуске разрешите **геолокацию** (нужна для отметок прихода/ухода; без неё время сохраняется без геометки).
4. На экране входа нажмите **«Открыть демо-версию»** — загрузятся 2 точки, 12 товаров, продажи за 14 дней.
   Демо-аккаунты: `demo / demo123` (администратор), `aigul / 123456` (продавец).
5. Для чистой базы нажмите «Зарегистрироваться» — первый пользователь станет администратором.

Требования: Android 6.0 (API 23) и выше. Интернет не нужен — приложение работает офлайн.

---

## 6. Чек-лист проверки на телефоне

- [ ] Иконка и splash отображаются
- [ ] Переключатель темы в шапке меняет интерфейс и цвет системных панелей
- [ ] Касса: товар → корзина → оплата наличными → продажа
- [ ] Kaspi QR: без чека продажа не оформляется, с фото — оформляется
- [ ] Время: «Прибытие» запрашивает геолокацию и сохраняет геометку
- [ ] Экспорт в аналитике: файл сохраняется и открывается меню «Поделиться»
- [ ] Настройки → «Скачать копию (JSON)» → файл появляется в меню «Поделиться»
- [ ] Кнопка «Назад» закрывает модалки, затем выходит из приложения
