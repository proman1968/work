# Примеры использования в консоли браузера

## Быстрый старт

Откройте консоль браузера (F12) и попробуйте следующие команды:

### 1. Проверить, есть ли несохраненные изменения

```javascript
// Проверить статус документа
console.log('Документ изменен:', window.isDocumentDirty?.());
```

### 2. Запросить текущее содержимое документа

```javascript
// Это вызовет событие onSave и скачает документ
window.requestDocumentContent?.();
```

### 3. Отправить команду редактору напрямую

```javascript
// Сохранить документ
window.editor?.sendCommand({
  command: 'asc_Save',
  data: {},
});
```

### 4. Получить информацию о документе

```javascript
// Получить текущий документ из store
const doc = window.getDocmentObj?.();
console.log('Имя файла:', doc?.fileName);
console.log('Файл:', doc?.file);
console.log('URL:', doc?.url);
```

## Расширенные примеры

### Автосохранение

```javascript
// Автосохранение каждые 2 минуты
const autoSaveInterval = setInterval(() => {
  if (window.isDocumentDirty?.()) {
    console.log('Автосохранение...');
    window.requestDocumentContent?.();
  } else {
    console.log('Нет изменений для сохранения');
  }
}, 2 * 60 * 1000);

// Остановить автосохранение
// clearInterval(autoSaveInterval);
```

### Отслеживание изменений

```javascript
// Создать обработчик для отслеживания изменений
let changeCount = 0;
const originalOnDocumentStateChange = window.editor?.events?.onDocumentStateChange;

// Переопределить обработчик (осторожно!)
if (window.editor) {
  // Это только для демонстрации, в реальном коде лучше использовать встроенный механизм
  console.log('Отслеживание изменений включено');
  console.log('Количество изменений будет отображаться в консоли');
}
```

### Принудительное сохранение

```javascript
// Сохранить документ независимо от того, есть ли изменения
window.editor?.sendCommand({
  command: 'asc_Save',
  data: {},
});
console.log('Запрос на сохранение отправлен');
```

### Получить формат документа

```javascript
// Получить информацию о текущем документе
const doc = window.getDocmentObj?.();
if (doc?.fileName) {
  const ext = doc.fileName.split('.').pop()?.toLowerCase();
  console.log('Расширение файла:', ext);
  
  const formatMap = {
    'docx': 'Word Document',
    'xlsx': 'Excel Spreadsheet',
    'pptx': 'PowerPoint Presentation',
    'csv': 'CSV File'
  };
  
  console.log('Тип документа:', formatMap[ext] || 'Unknown');
}
```

## Отладка

### Проверить состояние редактора

```javascript
// Проверить, инициализирован ли редактор
console.log('Редактор инициализирован:', !!window.editor);

// Проверить доступные команды
console.log('Доступные методы редактора:', Object.keys(window.editor || {}));
```

### Логирование событий сохранения

```javascript
// Добавить логирование в консоль (для отладки)
const originalSendCommand = window.editor?.sendCommand;
if (originalSendCommand) {
  window.editor.sendCommand = function(cmd) {
    console.log('Команда редактору:', cmd);
    return originalSendCommand.call(this, cmd);
  };
}
```

## Полезные глобальные переменные

```javascript
// Проверить доступные глобальные функции
console.log('Доступные функции:');
console.log('- window.onCreateNew:', typeof window.onCreateNew);
console.log('- window.requestDocumentContent:', typeof window.requestDocumentContent);
console.log('- window.isDocumentDirty:', typeof window.isDocumentDirty);
console.log('- window.getDocmentObj:', typeof window.getDocmentObj);
console.log('- window.editor:', typeof window.editor);
```

## Примечания

⚠️ **Важно**: Эти примеры предназначены для отладки и тестирования. В production коде используйте официальное API из модулей.

💡 **Совет**: Некоторые функции могут быть недоступны в глобальной области видимости. В этом случае импортируйте их из соответствующих модулей.

