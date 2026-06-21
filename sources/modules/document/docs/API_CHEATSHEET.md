# API Cheat Sheet

## 🚀 Быстрый старт

### Проверить изменения
```javascript
window.isDocumentDirty()  // true/false
```

### Сохранить документ
```javascript
window.requestDocumentContent()  // Скачает документ (или вызовет кастомный обработчик)
```

### Получить информацию о документе
```javascript
const doc = window.getDocmentObj()
console.log(doc.fileName, doc.file, doc.url)
```

### Установить обработчик сохранения на сервер
```javascript
window.setCustomSaveHandler(async (detail) => {
  await fetch('/api/save', {
    method: 'POST',
    body: detail.documentData,
  });
});
```

## 📋 События редактора

### onDocumentStateChange
Срабатывает при изменении документа
```typescript
onDocumentStateChange: (event) => {
  const isModified = event?.data;  // true/false
}
```

### onRequestSaveAs
Срабатывает при нажатии Save (Ctrl+S)
```typescript
onRequestSaveAs: (event) => {
  window.editor?.sendCommand({
    command: 'asc_Save',
    data: {},
  });
}
```

### onSave
Срабатывает при сохранении
```typescript
onSave: (event) => {
  const data = event.data.data.data;  // Uint8Array
  const format = event.data.option.outputformat;
  
  // Обработать сохранение...
  
  // Уведомить редактор
  window.editor?.sendCommand({
    command: 'asc_onSaveCallback',
    data: { err_code: 0 },
  });
}
```

## 🎯 Команды редактора

### Сохранить документ
```javascript
window.editor?.sendCommand({
  command: 'asc_Save',
  data: {},
});
```

### Уведомить о завершении сохранения
```javascript
window.editor?.sendCommand({
  command: 'asc_onSaveCallback',
  data: { err_code: 0 },  // 0 = успех
});
```

### Установить URL изображений
```javascript
window.editor?.sendCommand({
  command: 'asc_setImageUrls',
  data: { urls: { 'image.png': 'blob:...' } },
});
```

### Открыть документ
```javascript
window.editor?.sendCommand({
  command: 'asc_openDocument',
  data: { buf: documentData },  // string или ArrayBuffer
});
```

## 💡 Примеры использования

### Сохранение на сервер
```javascript
window.setCustomSaveHandler(async (detail) => {
  const response = await fetch(detail.sourceUrl || '/api/save', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-File-Name': detail.fileName,
    },
    body: detail.documentData,
  });

  if (!response.ok) throw new Error('Save failed');
});
```

### Автосохранение
```javascript
setInterval(() => {
  if (window.isDocumentDirty()) {
    window.requestDocumentContent();
  }
}, 5 * 60 * 1000);  // Каждые 5 минут
```

### Предупреждение при закрытии
```javascript
window.addEventListener('beforeunload', (e) => {
  if (window.isDocumentDirty()) {
    e.preventDefault();
    e.returnValue = 'Есть несохраненные изменения!';
  }
});
```

### Кастомная кнопка сохранения
```javascript
saveButton.addEventListener('click', () => {
  if (window.isDocumentDirty()) {
    window.requestDocumentContent();
  } else {
    alert('Нет изменений для сохранения');
  }
});
```

### Индикатор изменений
```javascript
// Автоматически обновляется в onDocumentStateChange
// Заголовок страницы: "* document.docx" при изменениях
```

## 🔍 Отладка

### Проверить состояние редактора
```javascript
console.log('Редактор:', !!window.editor);
console.log('Изменен:', window.isDocumentDirty());
console.log('Документ:', window.getDocmentObj());
```

### Логировать команды
```javascript
const original = window.editor?.sendCommand;
window.editor.sendCommand = function(cmd) {
  console.log('Команда:', cmd);
  return original.call(this, cmd);
};
```

## 📦 Типы данных

### SaveEvent
```typescript
interface SaveEvent {
  data: {
    data: {
      data: Uint8Array;  // Содержимое документа
    };
    option: {
      outputformat: number;  // Формат (см. c_oAscFileType2)
    };
  };
}
```

### Document Object
```typescript
interface DocumentObject {
  fileName: string;
  file?: File;
  url?: string;
}
```

## ⚡ Горячие клавиши

- **Ctrl+S** - Сохранить документ (вызывает `onRequestSaveAs`)
- **Ctrl+P** - Печать
- **Ctrl+Z** - Отменить
- **Ctrl+Y** - Повторить

## 🔗 Ссылки

- [Полная документация API](SAVE_API.md)
- [Примеры для консоли](CONSOLE_EXAMPLES.md)
- [OnlyOffice API Docs](https://api.onlyoffice.com/editors/basic)

