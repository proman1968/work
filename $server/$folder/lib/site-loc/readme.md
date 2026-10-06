# site-loc — локация сайта и узлы оргструктуры

Чистые функции для page-handler `site`: разбор/сборка `#ctx=…` (цепочка вложенных сайтов)
и классификация узлов структуры (`structureKind`, `isStructureNode`, `STRUCTURE_TYPES`).

## Использование (клиент)

Без top-level `import` в `class.js` (babel-merge). В методах:

```js
const { parseSiteHash, buildSiteLoc, matchSelf, buildFragment } = await import(
  (this.$item?.short || '') + '/~/lib//site-loc.js'
);
```

Deep `//` находит `lib/site-loc/site-loc.js` через наследование `$folder`.
