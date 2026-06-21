# Changelog - Save API

## Что было добавлено

### 1. Custom Save Handler API

Добавлена возможность переопределить поведение кнопки Save для отправки документов на сервер вместо скачивания.

#### Новые функции:

**`setCustomSaveHandler(handler)`**
- Устанавливает кастомный обработчик сохранения
- Параметр: `async (detail: DocumentSaveEventDetail) => Promise<void>`
- Если установлен, вызывается вместо автоматического скачивания файла
- Передать `null` чтобы вернуться к стандартному поведению

**`requestDocumentContent()`**
- Запрашивает текущее содержимое документа из редактора
- Вызывает событие `onSave` с данными документа
- Если установлен кастомный обработчик, вызовет его
- Иначе скачает файл

**`isDocumentDirty()`**
- Проверяет, есть ли несохраненные изменения
- Возвращает `boolean`

**`setDocumentModified(modified: boolean)`**
- Устанавливает флаг изменения документа
- Используется внутренне, но доступна для внешнего использования

#### Новые события:

**`document-save`**
- Генерируется при успешном сохранении (только с кастомным обработчиком)
- `event.detail` содержит `DocumentSaveEventDetail`

**`document-save-error`**
- Генерируется при ошибке сохранения
- `event.detail` содержит `{ error, fileName }`

#### Новые типы:

```typescript
interface DocumentSaveEventDetail {
  fileName: string;        // Имя файла
  fileType: string;        // Тип файла (DOCX, XLSX, PPTX, CSV)
  documentData: Uint8Array; // Бинарные данные в формате OnlyOffice bin
  outputFormat: number;    // Числовой формат OnlyOffice
  sourceUrl?: string;      // URL откуда был загружен документ
}
```

### 2. Отслеживание изменений документа

**`onDocumentStateChange` event**
- Автоматически отслеживает изменения документа
- Обновляет заголовок страницы (добавляет `*` при изменениях)
- Обновляет внутренний флаг `isDocumentModified`

### 3. Глобальный API

Все функции экспортированы в `window` для использования из консоли браузера:

```javascript
window.setCustomSaveHandler(handler)
window.requestDocumentContent()
window.isDocumentDirty()
window.setDocumentModified(modified)
window.getDocmentObj()
```

## Примеры использования

### Базовый пример - сохранение на сервер

```javascript
window.setCustomSaveHandler(async (detail) => {
  const response = await fetch('/api/save', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-File-Name': detail.fileName,
    },
    body: detail.documentData,
  });
  
  if (!response.ok) {
    throw new Error('Save failed');
  }
});
```

### Сохранение в исходный URL

```javascript
window.setCustomSaveHandler(async (detail) => {
  if (detail.sourceUrl) {
    // Сохранить туда же, откуда загрузили
    await fetch(detail.sourceUrl, {
      method: 'PUT',
      body: detail.documentData,
    });
  } else {
    // Новый документ - создать на сервере
    await fetch('/api/documents', {
      method: 'POST',
      body: detail.documentData,
    });
  }
});
```

### Слушать события

```javascript
window.addEventListener('document-save', (e) => {
  console.log('Saved:', e.detail.fileName);
});

window.addEventListener('document-save-error', (e) => {
  alert('Error: ' + e.detail.error.message);
});
```

## Обратная совместимость

✅ Все изменения обратно совместимы:
- Если кастомный обработчик не установлен, работает стандартное поведение (скачивание)
- Существующий код продолжит работать без изменений
- Новые функции опциональны

## Файлы изменены

- `lib/onlyoffice-editor.ts` - добавлен кастомный обработчик и события
- `index.ts` - экспорт функций в глобальную область
- `docs/CUSTOM_SAVE_HANDLER.md` - полная документация
- `docs/SAVE_API.md` - обновлена документация API
- `docs/API_CHEATSHEET.md` - добавлены примеры
- `docs/CONSOLE_EXAMPLES.md` - примеры для консоли
- `examples/custom-save-example.html` - рабочий пример
- `README.md` - обновлена документация

## Тестирование

1. Откройте `examples/custom-save-example.html` в браузере
2. Нажмите "Включить сохранение на сервер"
3. Откройте документ и внесите изменения
4. Нажмите Ctrl+S или кнопку Save
5. Проверьте лог - должно появиться сообщение о сохранении

## Следующие шаги

Для интеграции в ваш проект:

1. Установите обработчик сохранения при загрузке страницы
2. Реализуйте серверный endpoint для приема данных
3. Обработайте ошибки и покажите пользователю статус
4. Опционально: добавьте автосохранение

См. полную документацию в `docs/CUSTOM_SAVE_HANDLER.md`

