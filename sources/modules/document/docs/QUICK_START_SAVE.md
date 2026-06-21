# Quick Start - Сохранение на сервер

## 🚀 За 2 минуты

### Шаг 1: Добавьте скрипт на вашу страницу

```html
<!DOCTYPE html>
<html>
<head>
  <title>Document Editor</title>
</head>
<body>
  <div id="iframe"></div>
  
  <!-- Подключите собранный редактор -->
  <script src="./dist/index.js"></script>
  
  <!-- Настройте сохранение -->
  <script>
    window.setCustomSaveHandler(async (detail) => {
      // Отправить на ваш сервер
      const response = await fetch(detail.sourceUrl || '/api/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-File-Name': detail.fileName,
        },
        body: detail.documentData,
      });
      
      if (!response.ok) {
        throw new Error('Ошибка сохранения');
      }
    });
  </script>
</body>
</html>
```

### Шаг 2: Реализуйте серверный endpoint

#### Node.js (Express)

```javascript
const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const app = express();

app.post('/api/save', express.raw({ type: 'application/octet-stream', limit: '50mb' }), async (req, res) => {
  try {
    const fileName = req.headers['x-file-name'];
    const filePath = path.join(__dirname, 'documents', fileName);
    
    await fs.writeFile(filePath, req.body);
    
    res.json({ success: true, path: filePath });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(3000);
```

#### Python (Flask)

```python
from flask import Flask, request, jsonify
import os

app = Flask(__name__)

@app.route('/api/save', methods=['POST'])
def save_document():
    try:
        file_name = request.headers.get('X-File-Name')
        file_data = request.get_data()
        
        file_path = os.path.join('documents', file_name)
        
        with open(file_path, 'wb') as f:
            f.write(file_data)
        
        return jsonify({'success': True, 'path': file_path})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(port=3000)
```

#### PHP

```php
<?php
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $fileName = $_SERVER['HTTP_X_FILE_NAME'] ?? 'document.bin';
    $fileData = file_get_contents('php://input');
    
    $filePath = __DIR__ . '/documents/' . $fileName;
    
    if (file_put_contents($filePath, $fileData)) {
        echo json_encode(['success' => true, 'path' => $filePath]);
    } else {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to save file']);
    }
} else {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
}
?>
```

### Шаг 3: Готово! 🎉

Теперь при нажатии **Ctrl+S** или кнопки **Save** документ будет отправляться на ваш сервер.

## 📝 Важные замечания

### Формат данных

⚠️ **Внимание:** `documentData` содержит данные в формате **OnlyOffice bin**, а не финальный DOCX/XLSX/PPTX!

Для конвертации в финальный формат на сервере используйте x2t конвертер:
- [x2t-wasm](https://github.com/ONLYOFFICE/x2t-wasm) - WebAssembly версия
- [DocumentServer](https://github.com/ONLYOFFICE/DocumentServer) - полный сервер

### Обработка ошибок

```javascript
window.setCustomSaveHandler(async (detail) => {
  try {
    const response = await fetch('/api/save', {
      method: 'POST',
      body: detail.documentData,
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    console.error('Save error:', error);
    alert('Не удалось сохранить документ: ' + error.message);
    throw error; // Важно пробросить ошибку!
  }
});
```

### Слушать события

```javascript
// Успешное сохранение
window.addEventListener('document-save', (e) => {
  console.log('Saved:', e.detail.fileName);
  showNotification('Документ сохранен');
});

// Ошибка сохранения
window.addEventListener('document-save-error', (e) => {
  console.error('Error:', e.detail.error);
  showNotification('Ошибка сохранения', 'error');
});
```

## 🔧 Дополнительные возможности

### Автосохранение

```javascript
setInterval(() => {
  if (window.isDocumentDirty()) {
    window.requestDocumentContent();
  }
}, 5 * 60 * 1000); // Каждые 5 минут
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

### Индикатор сохранения

```javascript
window.setCustomSaveHandler(async (detail) => {
  const status = document.getElementById('status');
  status.textContent = 'Сохранение...';
  
  try {
    await fetch('/api/save', {
      method: 'POST',
      body: detail.documentData,
    });
    
    status.textContent = 'Сохранено ✓';
  } catch (error) {
    status.textContent = 'Ошибка ✗';
    throw error;
  }
});
```

## 📚 Дополнительная документация

- [Custom Save Handler](CUSTOM_SAVE_HANDLER.md) - Полная документация
- [Save API](SAVE_API.md) - API Reference
- [API Cheat Sheet](API_CHEATSHEET.md) - Шпаргалка
- [Console Examples](CONSOLE_EXAMPLES.md) - Примеры для консоли

## 🧪 Тестирование

Откройте `examples/custom-save-example.html` для интерактивного примера.

