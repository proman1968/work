# Changelog - URL Parameters

## Что было добавлено

### Новые URL параметры

#### 1. `save` - Управление поведением кнопки Save

**Значения:** `download` (по умолчанию), `event`

**Описание:**
- `save=download` - стандартное поведение, скачивание файла
- `save=event` - генерирует событие `document-save-requested` вместо скачивания

**Примеры:**
```
?save=event
?src=doc.docx&save=event
?locale=zh&src=doc.docx&save=event
```

**Использование:**
```javascript
// Слушать событие сохранения
window.addEventListener('document-save-requested', async (event) => {
  const { fileName, fileType, documentData, sourceUrl } = event.detail;
  
  // Отправить на сервер
  await fetch(sourceUrl || '/api/save', {
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
  fileName: string;        // Имя файла
  fileType: string;        // Тип файла (DOCX, XLSX, PPTX, CSV)
  documentData: Uint8Array; // Бинарные данные
  outputFormat: number;    // Числовой формат OnlyOffice
  sourceUrl?: string;      // URL источника
}
```

---

#### 2. `menu` - Показать/скрыть плавающее меню

**Значения:** `on` (по умолчанию), `off`

**Описание:**
- `menu=on` - показывает плавающее меню в правом нижнем углу
- `menu=off` - полностью скрывает меню

**Примеры:**
```
?menu=off
?src=doc.docx&menu=off
?locale=zh&src=doc.docx&save=event&menu=off
```

**Когда использовать:**
- Встраивание редактора в iframe
- Кастомный UI с собственными кнопками
- Ограниченный функционал

---

## Изменения в коде

### 1. `lib/document-utils.ts`

**Добавлено:**
- Интерфейс `URLParams` для типизации параметров
- Функция `getURLParams()` для получения и валидации параметров

```typescript
export interface URLParams {
  src?: string;
  file?: string;
  locale?: string;
  save?: 'download' | 'event';
  menu?: 'on' | 'off';
}

export function getURLParams(): URLParams {
  const params = getAllQueryString();
  return {
    src: params.src,
    file: params.file,
    locale: params.locale,
    save: params.save === 'event' ? 'event' : 'download',
    menu: params.menu === 'off' ? 'off' : 'on',
  };
}
```

### 2. `index.ts`

**Добавлено:**
- Обработка параметра `save`:
  - Если `save=event`, автоматически устанавливается кастомный обработчик
  - Генерируется событие `document-save-requested` при сохранении

- Обработка параметра `menu`:
  - Если `menu=off`, добавляется CSS для скрытия FAB меню

```typescript
// Handle save parameter
if (urlParams.save === 'event') {
  setCustomSaveHandler(async (detail) => {
    window.dispatchEvent(new CustomEvent('document-save-requested', { detail }));
  });
}

// Handle menu parameter
if (urlParams.menu === 'off') {
  const style = document.createElement('style');
  style.id = 'hide-fab-menu';
  style.textContent = `
    #fab-container {
      display: none !important;
    }
  `;
  document.head.appendChild(style);
}
```

---

## Документация

### Новые файлы:

1. **`docs/URL_PARAMETERS.md`**
   - Полная документация по всем URL параметрам
   - Примеры использования
   - Комбинирование параметров
   - Безопасность и отладка

2. **`examples/url-parameters-example.html`**
   - Интерактивные примеры всех параметров
   - Готовые ссылки для тестирования
   - Описание каждого примера

### Обновленные файлы:

1. **`README.md`**
   - Добавлена таблица с новыми параметрами
   - Примеры использования
   - Описание поведения

2. **`readme.zh.md`**
   - Китайская версия документации
   - Все новые параметры переведены

3. **`docs/CUSTOM_SAVE_HANDLER.md`**
   - Добавлен раздел про URL параметр `save=event`
   - Сравнение двух способов настройки сохранения
   - Рекомендации по использованию

---

## Примеры использования

### Встраивание в iframe

```html
<iframe 
  src="https://editor.example.com/?src=https://api.example.com/doc.docx&save=event&menu=off"
  width="100%" 
  height="600">
</iframe>

<script>
  window.addEventListener('message', (event) => {
    if (event.data.type === 'document-save-requested') {
      saveToServer(event.data.detail);
    }
  });
</script>
```

### Локальная разработка

```
http://127.0.0.1:5500/dist/index.html?src=http://127.0.0.1:5500/doc/document.docx&save=event&menu=off
```

### Production

```
https://editor.example.com/?locale=zh&src=https://api.example.com/documents/123&save=event
```

---

## Обратная совместимость

✅ Все изменения обратно совместимы:
- Если параметры не указаны, используется поведение по умолчанию
- Существующие URL продолжат работать без изменений
- Новые параметры опциональны

---

## Тестирование

1. Откройте `examples/url-parameters-example.html` в браузере
2. Нажмите на кнопки "Открыть" для разных примеров
3. Проверьте поведение редактора с разными параметрами

**Тестовые URL:**
```
# Базовый
http://127.0.0.1:5500/dist/index.html

# С документом
http://127.0.0.1:5500/dist/index.html?src=http://127.0.0.1:5500/doc/document.docx

# С событием сохранения
http://127.0.0.1:5500/dist/index.html?save=event

# Без меню
http://127.0.0.1:5500/dist/index.html?menu=off

# Полная настройка
http://127.0.0.1:5500/dist/index.html?locale=zh&src=http://127.0.0.1:5500/doc/document.docx&save=event&menu=off
```

---

## Следующие шаги

1. Протестируйте новые параметры
2. Обновите свои интеграции для использования `save=event`
3. Используйте `menu=off` для встраивания в iframe
4. Прочитайте полную документацию в `docs/URL_PARAMETERS.md`

