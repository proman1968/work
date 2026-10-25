# vendor — сторонние библиотеки интерфейса (без сборки, локально)

Интерфейс данных (рабочее место, `$server/$folder/$class/$structure/handlers/pages/app`) работает без сборки и без CDN: библиотеки лежат здесь и отдаются сервером как обычные файлы (`/vendor/...`).

| Папка | Что | Версия | Лицензия |
|---|---|---|---|
| `lit/lit.js` | Lit 3 одним ES-модулем: `lit` (`LitElement`, `html`, `css`, `svg`, `nothing`) и директивы `repeat`, `classMap`, `styleMap`, `ifDefined`, `unsafeHTML`, `keyed`, `live`, `ref`, `guard`, `until` | 3.3.3 | BSD-3-Clause (`lit/LICENSE`) |
| `webawesome/` | Web Awesome (бесплатная часть): готовые компоненты `wa-*`, стили и токены, русские подписи | 3.14.0 | MIT (`webawesome/LICENSE.md`) |
| `xlsx-0.20.3.tgz` | SheetJS для работы с таблицами (устанавливается как npm-пакет) | 0.20.3 | Apache-2.0 |

## Как обновить

Делается один раз во временной папке, в проект попадают только готовые файлы.

**Lit** (бандл склеивает `lit` и нужные директивы в один файл — в браузере без сборки нет import map для `lit/…`):

```
npm install lit esbuild
# entry.js: export * from 'lit'; export * from 'lit/directives/repeat.js'; … (список директив — в таблице выше)
npx esbuild entry.js --bundle --format=esm --minify --legal-comments=none --outfile=lit.js
```

**Web Awesome**: скопировать `node_modules/@awesome.me/webawesome/dist-cdn` в `vendor/webawesome` без `*.d.ts`, `*.json`, `*.html`, `custom-elements*`, папок `react`, `ssr`, `types`, `skills` (около 600 файлов, 2 МБ). `dist-cdn` — самодостаточная сборка: Lit внутри, поэтому у компонентов Web Awesome свой экземпляр Lit, а у компонентов оболочки — `vendor/lit/lit.js`; общих шаблонов у них нет, конфликта не возникает.

Компоненты Web Awesome подключаются **явно** — списком в `app/$handler/components.js`: автозагрузчик Web Awesome не видит элементы внутри shadow DOM Lit-компонентов. Новый компонент — добавить имя в список.

Значки — не Font Awesome: оболочка берёт их из спрайтов проекта (`/oda/tools/icons/lib/svg/<набор>.svg#<значок>`, `<work-icon name="набор:значок">`), поэтому `icon` в `class.js` классов работает и там, и тут.
