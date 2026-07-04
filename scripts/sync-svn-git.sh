#!/bin/bash
# Синхронизация SVN -> Git зеркало
# Запуск: bash sync-svn-git.sh или ./sync-svn-git.sh

set -e

echo "===================================="
echo "  Синхронизация SVN -> Git зеркало"
echo "===================================="
echo ""

# Проверка что мы в корне репозитория
if [ ! -d ".git" ]; then
    echo "[ОШИБКА] Папка .git не найдена!"
    echo "Запустите этот скрипт из корня Git репозитория."
    exit 1
fi

SVN_URL="https://scm.odant.org/svn/cms/web/work"
TEMP_DIR=$(mktemp -d /tmp/svn-sync-tmp-XXXXXX)

cleanup() {
    rm -rf "$TEMP_DIR" 2>/dev/null || true
}
trap cleanup EXIT

if [ ! -d ".svn" ]; then
    echo "[1/4] Скачиваем последнюю версию из SVN..."
    svn export "$SVN_URL" "$TEMP_DIR" --quiet --non-interactive 2>/dev/null
    
    if [ $? -ne 0 ]; then
        echo "[ОШИБКА] Не удалось подключиться к SVN: $SVN_URL"
        exit 1
    fi
    
    echo "[2/4] Копируем изменения в рабочую директорию..."
    
    # Удаляем файлы которых нет в SVN (исключая .git и скрипты)
    find . -maxdepth 1 -not -path '.' -not -name '.git' \
        -not -name 'scripts' -not -name '*.bat' -not -name '*.sh' \
        -not -name '.svn-sync-ignore' | while read -r f; do
        if [ -d "$f" ]; then
            rm -rf "$f"
        else
            rm -f "$f"
        fi
    done
    
    # Копируем файлы из SVN
    cp -r "$TEMP_DIR/." .
    
    echo "[3/4] Проверяем изменения в Git..."
else
    echo "[1/4] Обновляем рабочую копию из SVN..."
    svn update --non-interactive --no-auth-cache >/dev/null 2>&1
    
    if [ $? -ne 0 ]; then
        echo "[ОШИБКА] Не удалось обновить рабочую копию SVN."
        exit 1
    fi
    
    echo "[2/4] Рабочая копия уже актуальна..."
    echo "[3/4] Проверяем изменения в Git..."
fi

# Добавляем все изменённые файлы в Git
git add -A 2>/dev/null

# Проверяем есть ли изменения
CHANGES=$(git status --short 2>/dev/null)
if [ -z "$CHANGES" ]; then
    echo ""
    echo "[OK] Изменений нет, синхронизация не нужна."
    echo "===================================="
    exit 0
fi

# Создаём коммит
echo "[4/4] Создаю коммит в Git..."
TIMESTAMP=$(date "+%Y-%m-%d %H:%M:%S")
git commit -m "Sync from SVN: $TIMESTAMP" >/dev/null 2>&1

if [ $? -ne 0 ]; then
    echo "[ОШИБКА] Не удалось создать коммит."
    exit 1
fi

echo ""
echo "[OK] Коммит создан успешно!"
echo ""

# Отправка в удалённое Git зеркало (GitHub)
echo "[ДОПОЛНИТЕЛЬНО] Отправка в удалённое зеркало GitHub..."
git push origin main >/dev/null 2>&1

if [ $? -ne 0 ]; then
    echo "[ВНИМАНИЕ] Не удалось отправить на GitHub."
    echo "Коммит сохранён локально. Для отправки выполните:"
    echo "  git push origin main"
else
    echo "[OK] Отправлено в GitHub зеркало!"
fi

echo ""
echo "===================================="
echo "  Синхронизация завершена успешно!"
echo "===================================="