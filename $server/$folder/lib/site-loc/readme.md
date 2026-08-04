# site-loc — helpers локации site / site-navigation

Чистые функции разбора/сборки `#ctx=…` для page-handler `site` и `site-navigation`.

## Использование (клиент)

Без top-level `import` в `class.js` (babel-merge). В методах:

```js
const { parseSiteHash, buildSiteLoc, matchSelf, buildFragment } = await import(
  (this.$item?.short || '') + '/~/lib//site-loc.js'
);
```

Deep `//` находит `lib/site-loc/site-loc.js` через наследование `$folder`.
