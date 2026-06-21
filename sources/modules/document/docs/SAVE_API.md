# Save API Documentation

## Обзор

OnlyOffice редактор предоставляет API для работы с сохранением документов и отслеживанием изменений.

## События

### 1. `onDocumentStateChange`

Срабатывает при изменении состояния документа (когда пользователь редактирует документ).

```typescript
onDocumentStateChange: (event: any) => {
  const isModified = event?.data; // true - документ изменен, false - нет изменений
  console.log('Document modified:', isModified);
}
```

**Использование:**
- Показать индикатор несохраненных изменений (например, звездочку в заголовке)
- Включить/отключить кнопку сохранения
- Предупредить пользователя при попытке закрыть страницу с несохраненными изменениями

### 2. `onRequestSaveAs`

Срабатывает при нажатии кнопки "Save" в меню редактора или при нажатии Ctrl+S.

```typescript
onRequestSaveAs: (event: any) => {
  console.log('Save As requested:', event);
  // Запустить процесс сохранения
  window.editor?.sendCommand({
    command: 'asc_Save',
    data: {},
  });
}
```

### 3. `onSave`

Срабатывает когда редактор готов передать данные документа для сохранения.

```typescript
onSave: (event: SaveEvent) => {
  const documentData = event.data.data.data; // Uint8Array с содержимым документа
  const outputFormat = event.data.option.outputformat; // Формат документа
  
  // Обработать сохранение
  // ...
  
  // Уведомить редактор о завершении сохранения
  window.editor?.sendCommand({
    command: 'asc_onSaveCallback',
    data: { err_code: 0 }, // 0 = успех, другое значение = ошибка
  });
}
```

## API функции

### `requestDocumentContent()`

Запрашивает текущее содержимое документа из редактора.

```typescript
import { requestDocumentContent } from './lib/onlyoffice-editor';

// Запросить содержимое документа
requestDocumentContent();

// Это вызовет событие onSave с текущими данными документа
```

### `isDocumentDirty()`

Проверяет, есть ли несохраненные изменения в документе.

```typescript
import { isDocumentDirty } from './lib/onlyoffice-editor';

if (isDocumentDirty()) {
  console.log('Документ имеет несохраненные изменения');
}
```

### `setDocumentModified(modified: boolean)`

Устанавливает флаг изменения документа (используется внутренне).

```typescript
import { setDocumentModified } from './lib/onlyoffice-editor';

setDocumentModified(true); // Отметить документ как измененный
setDocumentModified(false); // Отметить документ как сохраненный
```

## Примеры использования

### Пример 1: Автосохранение каждые 5 минут

```typescript
import { requestDocumentContent, isDocumentDirty } from './lib/onlyoffice-editor';

// Автосохранение каждые 5 минут
setInterval(() => {
  if (isDocumentDirty()) {
    console.log('Автосохранение...');
    requestDocumentContent();
  }
}, 5 * 60 * 1000);
```

### Пример 2: Предупреждение при закрытии страницы

```typescript
import { isDocumentDirty } from './lib/onlyoffice-editor';

window.addEventListener('beforeunload', (e) => {
  if (isDocumentDirty()) {
    e.preventDefault();
    e.returnValue = 'У вас есть несохраненные изменения. Вы уверены, что хотите покинуть страницу?';
    return e.returnValue;
  }
});
```

### Пример 3: Кастомная кнопка сохранения

```typescript
import { requestDocumentContent, isDocumentDirty } from './lib/onlyoffice-editor';

const saveButton = document.getElementById('custom-save-button');

// Обновить состояние кнопки при изменении документа
// (это уже реализовано в onDocumentStateChange)

saveButton?.addEventListener('click', () => {
  if (isDocumentDirty()) {
    requestDocumentContent();
  }
});
```

### Пример 4: Получение содержимого документа

```typescript
// В обработчике onSave
async function handleSaveDocument(event: SaveEvent) {
  const documentData = event.data.data.data; // Uint8Array
  const outputFormat = event.data.option.outputformat;
  
  // Конвертировать в нужный формат и скачать
  await convertBinToDocumentAndDownload(documentData, fileName, targetFormat);
  
  // Уведомить редактор
  window.editor?.sendCommand({
    command: 'asc_onSaveCallback',
    data: { err_code: 0 },
  });
}
```

## Команды редактора

### `asc_Save`

Запрашивает сохранение документа.

```typescript
window.editor?.sendCommand({
  command: 'asc_Save',
  data: {},
});
```

### `asc_onSaveCallback`

Уведомляет редактор о результате сохранения.

```typescript
window.editor?.sendCommand({
  command: 'asc_onSaveCallback',
  data: { 
    err_code: 0  // 0 = успех, другое значение = ошибка
  },
});
```

## Типы данных

```typescript
interface SaveEvent {
  data: {
    data: {
      data: Uint8Array;  // Содержимое документа
    };
    option: {
      outputformat: number;  // Формат документа (см. c_oAscFileType2)
    };
  };
}
```

## Примечания

1. **Формат данных**: Данные в `onSave` приходят в виде `Uint8Array` в формате OnlyOffice bin
2. **Конвертация**: Для сохранения в DOCX/XLSX/PPTX нужно использовать x2t конвертер
3. **Асинхронность**: Сохранение может быть асинхронным, не забудьте вызвать `asc_onSaveCallback`
4. **Индикатор изменений**: Заголовок страницы автоматически обновляется (добавляется `*` при изменениях)

