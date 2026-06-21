# Custom Save Handler - Сохранение на сервер

## Обзор

По умолчанию при нажатии кнопки **Save** (или Ctrl+S) документ скачивается на компьютер пользователя.

Вы можете переопределить это поведение двумя способами:
1. **URL параметр** `?save=event` - автоматически включает событие сохранения
2. **JavaScript API** `setCustomSaveHandler()` - программная настройка

## Способ 1: URL параметр (рекомендуется)

### Быстрый старт

Добавьте `?save=event` к URL редактора:

```
https://your-domain.com/editor/?save=event
https://your-domain.com/editor/?src=doc.docx&save=event
```

Затем слушайте событие `document-save-requested`:

```javascript
window.addEventListener('document-save-requested', async (event) => {
  const { fileName, fileType, documentData, sourceUrl } = event.detail;

  // Отправить на сервер
  const response = await fetch(sourceUrl || '/api/save', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-File-Name': fileName,
    },
    body: documentData,
  });

  if (!response.ok) {
    console.error('Save failed');
  }
});
```

**Преимущества:**
- ✅ Не требует изменения кода редактора
- ✅ Легко встраивать в iframe
- ✅ Настройка через URL

## Способ 2: JavaScript API

### Быстрый старт

Используйте `setCustomSaveHandler()` для программной настройки:

```javascript
window.setCustomSaveHandler(async (detail) => {
  // detail содержит:
  // - fileName: имя файла
  // - fileType: тип файла (docx, xlsx, pptx, csv)
  // - documentData: Uint8Array с содержимым документа
  // - outputFormat: числовой формат OnlyOffice
  // - sourceUrl: URL откуда был загружен документ (если есть)
  
  console.log('Сохранение:', detail.fileName);
  
  // Отправить на сервер
  const response = await fetch(detail.sourceUrl || '/api/save', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-File-Name': detail.fileName,
      'X-File-Type': detail.fileType,
    },
    body: detail.documentData,
  });
  
  if (!response.ok) {
    throw new Error('Ошибка сохранения на сервере');
  }
  
  console.log('Документ успешно сохранен на сервере');
});
```

**Преимущества:**
- ✅ Полный контроль над логикой сохранения
- ✅ Можно динамически менять поведение
- ✅ Доступ к Promise для обработки ошибок

**Отключить обработчик:**

```javascript
window.setCustomSaveHandler(null);
```

---

## Сравнение способов

| Характеристика | URL параметр | JavaScript API |
|----------------|--------------|----------------|
| Простота | ⭐⭐⭐ | ⭐⭐ |
| Встраивание в iframe | ✅ Отлично | ⚠️ Требует доступ к window |
| Динамическое изменение | ❌ Нет | ✅ Да |
| Обработка ошибок | Через события | Через Promise |
| Рекомендуется для | Встраивание, простые случаи | Сложная логика |

## Детальные примеры

### Пример 1: Сохранение на сервер с PUT запросом

```javascript
window.setCustomSaveHandler(async (detail) => {
  // Если документ был загружен с URL, сохраняем туда же
  if (detail.sourceUrl) {
    const response = await fetch(detail.sourceUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      body: detail.documentData,
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  } else {
    // Новый документ - создаем на сервере
    const response = await fetch('/api/documents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileName: detail.fileName,
        fileType: detail.fileType,
        data: Array.from(detail.documentData), // Конвертируем в массив для JSON
      }),
    });
    
    if (!response.ok) {
      throw new Error('Не удалось создать документ');
    }
  }
});
```

### Пример 2: Сохранение с FormData

```javascript
window.setCustomSaveHandler(async (detail) => {
  const formData = new FormData();
  
  // Создаем Blob из Uint8Array
  const blob = new Blob([detail.documentData], {
    type: 'application/octet-stream',
  });
  
  formData.append('file', blob, detail.fileName);
  formData.append('fileType', detail.fileType);
  
  const response = await fetch('/api/upload', {
    method: 'POST',
    body: formData,
  });
  
  if (!response.ok) {
    throw new Error('Upload failed');
  }
  
  const result = await response.json();
  console.log('Saved to:', result.url);
});
```

### Пример 3: Сохранение с индикатором прогресса

```javascript
window.setCustomSaveHandler(async (detail) => {
  // Показать индикатор загрузки
  const progressDiv = document.getElementById('save-progress');
  if (progressDiv) {
    progressDiv.textContent = 'Сохранение...';
    progressDiv.style.display = 'block';
  }
  
  try {
    const response = await fetch('/api/save', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-File-Name': encodeURIComponent(detail.fileName),
      },
      body: detail.documentData,
    });
    
    if (!response.ok) {
      throw new Error('Save failed');
    }
    
    // Успех
    if (progressDiv) {
      progressDiv.textContent = '✓ Сохранено';
      setTimeout(() => {
        progressDiv.style.display = 'none';
      }, 2000);
    }
  } catch (error) {
    // Ошибка
    if (progressDiv) {
      progressDiv.textContent = '✗ Ошибка сохранения';
      progressDiv.style.color = 'red';
    }
    throw error; // Пробросить ошибку дальше
  }
});
```

### Пример 4: Сохранение с авторизацией

```javascript
window.setCustomSaveHandler(async (detail) => {
  const token = localStorage.getItem('authToken');
  
  const response = await fetch('/api/documents/save', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'X-File-Name': detail.fileName,
    },
    body: detail.documentData,
  });
  
  if (response.status === 401) {
    throw new Error('Требуется авторизация');
  }
  
  if (!response.ok) {
    throw new Error('Ошибка сохранения');
  }
});
```

## События

### Событие `document-save`

Генерируется при успешном сохранении документа (только если установлен кастомный обработчик).

```javascript
window.addEventListener('document-save', (event) => {
  const detail = event.detail;
  console.log('Документ сохранен:', detail.fileName);
  console.log('Тип:', detail.fileType);
  console.log('Размер:', detail.documentData.length, 'байт');
});
```

### Событие `document-save-error`

Генерируется при ошибке сохранения.

```javascript
window.addEventListener('document-save-error', (event) => {
  const { error, fileName } = event.detail;
  console.error('Ошибка сохранения', fileName, ':', error);
  
  // Показать уведомление пользователю
  alert(`Не удалось сохранить ${fileName}: ${error.message}`);
});
```

## Интерфейс DocumentSaveEventDetail

```typescript
interface DocumentSaveEventDetail {
  fileName: string;        // Имя файла (например, "document.docx")
  fileType: string;        // Тип файла (например, "DOCX", "XLSX", "CSV")
  documentData: Uint8Array; // Бинарные данные документа
  outputFormat: number;    // Числовой формат OnlyOffice (см. c_oAscFileType2)
  sourceUrl?: string;      // URL откуда был загружен документ (если есть)
}
```

## Обработка ошибок

Если обработчик выбрасывает ошибку:
1. Редактор получит уведомление об ошибке (`err_code: 1`)
2. Генерируется событие `document-save-error`
3. Документ остается помеченным как измененный

```javascript
window.setCustomSaveHandler(async (detail) => {
  try {
    const response = await fetch('/api/save', {
      method: 'POST',
      body: detail.documentData,
    });
    
    if (!response.ok) {
      // Это вызовет событие document-save-error
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    console.error('Save error:', error);
    throw error; // Важно пробросить ошибку!
  }
});
```

## Полный пример интеграции

```html
<!DOCTYPE html>
<html>
<head>
  <title>Document Editor</title>
</head>
<body>
  <div id="save-status"></div>
  <div id="iframe"></div>
  
  <script src="./dist/index.js"></script>
  <script>
    // Установить обработчик сохранения
    window.setCustomSaveHandler(async (detail) => {
      const status = document.getElementById('save-status');
      status.textContent = 'Сохранение...';
      
      const response = await fetch(detail.sourceUrl || '/api/save', {
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
      
      status.textContent = 'Сохранено ✓';
    });
    
    // Слушать события
    window.addEventListener('document-save', (e) => {
      console.log('Saved:', e.detail.fileName);
    });
    
    window.addEventListener('document-save-error', (e) => {
      alert('Ошибка: ' + e.detail.error.message);
    });
  </script>
</body>
</html>
```

## Примечания

⚠️ **Важно:**
- Обработчик должен быть **async** функцией или возвращать Promise
- При ошибке обязательно выбрасывайте исключение (`throw`)
- `documentData` - это `Uint8Array` в формате OnlyOffice bin (не финальный DOCX/XLSX!)
- Для конвертации в финальный формат используйте x2t конвертер на сервере

💡 **Совет:**
- Используйте `sourceUrl` чтобы сохранять документ туда же, откуда он был загружен
- Добавьте индикатор прогресса для лучшего UX
- Обрабатывайте ошибки сети и показывайте понятные сообщения пользователю

