<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Исследование извлечения статей и обхода ограничений (The Atlantic / Paywalls)

## Контекст задачи
Было проведено исследование и сравнение механизма извлечения статей в нашем проекте (`magShorts`) с read-it-later инструментом **Readeck** (`codeberg.org/readeck/readeck`) с целью понять, как обходить paywall и ограничения на примере издания *The Atlantic*.

## Что было сделано и протестировано

1. **Анализ кодовой базы Readeck (`pkg/extract`, `internal/httpclient`)**:
   - В Readeck есть файл селекторов `pkg/extract/contentscripts/assets/site-config/theatlantic.com.json` (правила FiveFilters для выделения контейнера `article` и удаления рекламных блоков).
   - В Readeck есть сетевой клиент на Go с эмуляцией TLS-отпечатка Chrome (GREASE-шифры RFC 8701, CipherSuites, Client Hints `Sec-CH-UA`).
   - **Тест**: мы скомпилировали сетевой клиент Readeck и выполнили реальный запрос к `theatlantic.com`.
   - **Результат**: **`HTTP 403 Forbidden` (`error code: 1020` от Cloudflare)**. Серверная часть Readeck **не может** напрямую скачать сайт The Atlantic. В Readeck такие сайты сохраняются исключительно через клиентское **Browser Extension**, которое берет уже отрендеренный DOM из авторизованной вкладки браузера пользователя и отправляет на сервер.

2. **Попытки прямого серверного извлечения с сайта The Atlantic в magShorts**:
   - *Прямой HTTP-запрос (Node.js fetch / undici / curl)*: блокируется Cloudflare WAF с кодом `403`.
   - *Подмена User-Agent (Googlebot, Chrome 133/144)*: блокируется (Cloudflare валидирует reverse DNS для Googlebot и отпечаток TLS).
   - *Проксирование (`FEED_PROXY_URL`)*: блокируется `403` (блокировка выполняется на уровне Cloudflare edge, а не регионального провайдера).
   - *Headless Chrome (`--headless --dump-dom`)*: страница отдает заглушку *«Our site’s security protections triggered a block... Cloudflare Ray ID»*.
   - *Сервис разблокировки Marreta (`marreta.link`)*: выдает ошибку доступа.
   - *Зеркала архивов (Wayback Machine)*: Wayback Machine для многих страниц The Atlantic архивирует страницу ошибки Cloudflare (HTTP `402`). `archive.ph` с серверного IP блокируется Cloudflare CAPTCHA.

3. **Текущий рабочий механизм magShorts (RSS Feed Fallback)**:
   - The Atlantic транслирует **полный текст статей (100% объема)** в своем RSS-фиде (`https://www.theatlantic.com/feed/all/`, поле `<content:encoded>`). Пословное сравнение с сохраненной в архиве статьей показало идентичность (859 слов в фиде против 870 слов на сайте, разница только в 11 словах подзаголовка и копирайта).
   - В [src/lib/extract.ts](file:///Users/m1xxos/projects/magShorts/src/lib/extract.ts) заложен шаг 3 (`fromFeed`), который при ошибке прямого доступа забирает полный текст из фида.

## Почему результат выглядел «как текст из RSS»
1. **Отсутствие тегов `<h2>`**: генератор фида The Atlantic вырезает теги `<h2>` и форматирует подзаголовки обычным курсивом (`<p><em>...</em></p>`), из-за чего парсер не находит заголовков, и оглавление ридера (`ReaderOutline`) остается пустым.
2. **Отсутствие лида**: подзаголовок статьи хранится в поле `summary`, но не инжектируется в начало тела как акцентный абзац.
3. **Старые статьи в БД**: в ленте доступны только последние ~25 публикаций. Для более старых статей в БД сохранялся урезанный plain-text тизер до 6 000 символов (`CONTENT_MAX_LENGTH` в [src/lib/rss.ts](file:///Users/m1xxos/projects/magShorts/src/lib/rss.ts)).

## Рекомендации для будущих агентов (Что делать дальше)

1. **Semantic Feed Upgrader (Рекомендуется для автономности)**:
   - В функции `feedBody()` в [src/lib/extract.ts](file:///Users/m1xxos/projects/magShorts/src/lib/extract.ts) добавить эвристику: если в теле статьи нет `<h2>`, сканировать параграфы `<p><em>...</em></p>` / `<p><strong>...</strong></p>` длиной до 80 символов и преобразовывать их в `<h2>`. Это автоматически сгенерирует оглавление ридера.
   - Добавлять лид из `article.summary` в начало тела в виде `<p class="lead font-serif text-lg text-muted">`.
   - Это дает 100% полный текст и премиальную журнальную верстку без сетевых запросов и риска блокировок.

2. **Client-Side Capture (модель Readeck)**:
   - Создать эндпоинт `POST /api/articles/capture` и JS-букмарклет для браузера. Пользователь сможет в 1 клик отправлять открытый DOM любой статьи (включая закрытые платные сайты, где он авторизован) прямо в ридер magShorts.

3. **Прямой серверный обход Cloudflare (если потребуется именно сайт)**:
   - Потребуется интеграция решений типа FlareSolverr или `curl-impersonate` / Playwright с плагином `playwright-extra` + `puppeteer-extra-plugin-stealth` и ротацией резидентных прокси, так как обычный headless-браузер на сервере детектируется Cloudflare.

