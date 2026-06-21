# URL Parameters - Параметры URL

## Обзор

Редактор поддерживает настройку через URL параметры. Это позволяет:
- Открывать документы напрямую из URL
- Настраивать язык интерфейса
- Управлять поведением кнопки Save
- Показывать/скрывать элементы интерфейса

## Список параметров

### `locale` - Язык интерфейса

**Значения:** `en`, `zh`  
**По умолчанию:** Язык браузера

Устанавливает язык интерфейса редактора.

**Примеры:**
```
?locale=en
?locale=zh
```

---

### `src` - Открыть документ из URL (рекомендуется)

**Значения:** URL строка  
**По умолчанию:** -  
**Приоритет:** Низкий (если указан `file`, используется `file`)

Открывает документ из указанного URL при загрузке страницы.

**Примеры:**
```
?src=https://example.com/document.docx
?src=http://127.0.0.1:5500/doc/document.docx
?src=./documents/report.xlsx
```

**Требования:**
- URL должен быть доступен (CORS)
- Поддерживаемые форматы: DOCX, XLSX, PPTX, DOC, XLS, PPT, CSV

---

### `file` - Открыть документ из URL (обратная совместимость)

**Значения:** URL строка  
**По умолчанию:** -  
**Приоритет:** Высокий (приоритет над `src`)

Аналогично `src`, но имеет более высокий приоритет. Используется для обратной совместимости.

**Примеры:**
```
?file=https://example.com/document.docx
```

**Примечание:** Если указаны оба параметра `file` и `src`, используется `file`.

---

### `save` - Поведение кнопки Save

**Значения:** `download`, `event`  
**По умолчанию:** `download`

Управляет поведением кнопки Save (Ctrl+S).

#### `save=download` (по умолчанию)

Стандартное поведение - скачивание файла на компьютер пользователя.

```
?save=download
# или просто не указывать параметр
```

#### `save=event`

Вместо скачивания генерируется событие `document-save-requested` с данными документа.

```
?save=event
```

**Использование:**

```javascript
// Слушать событие сохранения
window.addEventListener('document-save-requested', (event) => {
  const { fileName, fileType, documentData, sourceUrl } = event.detail;
  
  console.log('Сохранение:', fileName);
  console.log('Тип:', fileType);
  console.log('Размер:', documentData.length, 'байт');
  console.log('Источник:', sourceUrl);
  
  // Отправить на сервер
  fetch(sourceUrl || '/api/save', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-File-Name': fileName,
    },
    body: documentData,
  });
});
```

**Структура события:**

```typescript
interface DocumentSaveEventDetail {
  fileName: string;        // Имя файла (например, "document.docx")
  fileType: string;        // Тип файла (например, "DOCX", "XLSX")
  documentData: Uint8Array; // Бинарные данные документа
  outputFormat: number;    // Числовой формат OnlyOffice
  sourceUrl?: string;      // URL откуда был загружен документ
}
```

---

### `menu` - Показать/скрыть меню

**Значения:** `on`, `off`  
**По умолчанию:** `on`

Управляет видимостью плавающего меню в правом нижнем углу.

#### `menu=on` (по умолчанию)

Меню отображается.

```
?menu=on
# или просто не указывать параметр
```

#### `menu=off`

Меню полностью скрыто.

```
?menu=off
```

**Когда использовать:**
- Встраивание редактора в iframe
- Кастомный UI с собственными кнопками
- Режим "только просмотр" или ограниченный функционал

---

## Комбинирование параметров

Параметры можно комбинировать, разделяя их символом `&`.

### Примеры

**Открыть документ на китайском языке:**
```
?locale=zh&src=https://example.com/document.docx
```

**Открыть документ с кастомным сохранением:**
```
?src=https://example.com/doc.docx&save=event
```

**Открыть документ без меню:**
```
?src=https://example.com/doc.docx&menu=off
```

**Полная настройка:**
```
?locale=zh&src=https://example.com/doc.docx&save=event&menu=off
```

---

## Примеры использования

### 1. Встраивание в iframe с кастомным сохранением

```html
<iframe 
  src="https://your-domain.com/editor/?src=https://example.com/doc.docx&save=event&menu=off"
  width="100%" 
  height="600">
</iframe>

<script>
  window.addEventListener('message', (event) => {
    if (event.data.type === 'document-save-requested') {
      const { fileName, documentData } = event.data.detail;
      // Сохранить на сервер
      saveToServer(fileName, documentData);
    }
  });
</script>
```

### 2. Локальная разработка

```
http://127.0.0.1:5500/dist/index.html?src=http://127.0.0.1:5500/doc/document.docx&locale=zh
```

### 3. Production с кастомным сохранением

```
https://editor.example.com/?src=https://api.example.com/documents/123&save=event
```

---

## Приоритеты параметров

1. **file vs src**: `file` имеет приоритет над `src`
2. **locale**: URL параметр → Cookie → localStorage → Язык браузера → `en`

---

## Безопасность

⚠️ **Важно:**

1. **CORS**: Удаленные URL должны поддерживать CORS
2. **HTTPS**: Рекомендуется использовать HTTPS для удаленных документов
3. **Валидация**: Всегда валидируйте URL на сервере перед загрузкой
4. **Размер файла**: Большие файлы могут вызвать проблемы с памятью браузера

---

## Отладка

Откройте консоль браузера (F12) для просмотра логов:

```javascript
// Проверить текущие параметры
console.log(window.location.search);

// Проверить загруженный документ
console.log(window.getDocmentObj());

// Проверить состояние документа
console.log('Modified:', window.isDocumentDirty());
```

