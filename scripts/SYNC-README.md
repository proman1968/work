# Настройка автоматической синхронизации SVN → Git

## Скрипты синхронизации

В папке `scripts/` находятся два скрипта:

- `sync-svn-git.bat` — для Windows (PowerShell, CMD)
- `sync-svn-git.sh` — для Linux/Mac/Git Bash

## Ручной запуск

### Windows:
```cmd
cd C:\projects\web\work
scripts\sync-svn-git.bat
```

### Linux / Git Bash:
```bash
cd /c/projects/web/work
bash scripts/sync-svn-git.sh
```

## Автоматический запуск в Windows (Task Scheduler)

### Шаг 1: Откройте Task Scheduler
- Нажмите `Win + R`
- Введите `taskschd.msc` и нажмите Enter

### Шаг 2: Создайте задачу
1. В правом меню кликните **"Создать задачу..."**
2. Вкладка **"Общее"**:
   - Имя: `SVN → Git Sync`
   - Описание: `Автоматическая синхронизация SVN репозитория с Git зеркалом`
   - Поставьте галочку **"Выполнять вне зависимости от того, вошел ли пользователь"**

3. Вкладка **"Триггеры"**:
   - Нажмите **"Создать..."**
   - Начать задачу: `По расписанию`
   - Выберите частоту (ежедневно / еженедельно)
   - Время запуска (например, 08:00)
   - Нажмите OK

4. Вкладка **"Действия"**:
   - Нажмите **"Создать..."**
   - Действие: `Запуск программы`
   - Программа: `cmd.exe`
   - Добавление аргументов: `/c "C:\projects\web\work\scripts\sync-svn-git.bat"`
   - Начало в: `C:\projects\web\work\scripts`
   - Нажмите OK

5. Вкладка **"Условия"**:
   - Снимите галочку `"Запускать только при питании от сети"` (если ноутбук)

6. Вкладка **"Параметры"**:
   - Поставьте галочку `"Включить выполнение по расписанию"`
   - Нажмите OK

### Шаг 3: Проверка
Через несколько минут проверьте Task Scheduler — задача должна появиться в списке и выполниться.

## Альтернатива: Cron (Linux/Mac)

```bash
crontab -e
```

Добавить строку (каждые 15 минут):
```bash
*/15 * * * * /bin/bash /c/projects/web/work/scripts/sync-svn-git.sh >> /tmp/svn-sync.log 2>&1
```

## Альтернатива: Git hook post-commit в SVN

Создайте файл `hooks/post-commit` в вашем SVN репозитории:

```bash
#!/bin/bash
#!/bin/sh
cd /path/to/git/mirror
git svn rebase 2>/dev/null || svn export . temp-work && cp -r temp-work/. . && rm -rf temp-work
git add -A
git commit -m "Auto-sync from SVN hook" 2>/dev/null
git push origin main 2>/dev/null
```

Сделайте исполняемым:
```bash
chmod +x hooks/post-commit
```

## Диагностика

Если синхронизация не работает:

1. Проверьте доступность SVN:
   ```bash
   svn info https://scm.odant.org/svn/cms/web/work
   ```

2. Проверьте Git удалённый репозиторий:
   ```bash
   git remote -v
   ```

3. Запустите скрипт без подавления вывода ошибок:
   ```cmd
   cmd /c scripts\sync-svn-git.bat