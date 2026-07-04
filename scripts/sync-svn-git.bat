@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

echo ====================================
echo   Синхронизация SVN -> Git зеркало
echo ====================================
echo.

REM Проверка что мы в корне репозитория
if not exist ".git" (
    echo [ОШИБКА] Папка .git не найдена!
    echo Запустите этот скрипт из корня Git репозитория.
    pause
    exit /b 1
)

if not exist ".svn" (
    echo [ИНФО] Папка .svn не найдена. Создаём временную рабочую копию...
    set SVN_URL=https://scm.odant.org/svn/cms/web/work
    
    REM Создаём временную директорию
    set TEMP_SVN=%TEMP%\svn-sync-tmp-%RANDOM%
    mkdir "!TEMP_SVN!" 2>nul
    
    echo [1/4] Скачиваем последнюю версию из SVN...
    svn export "!SVN_URL!" "!TEMP_SVN!" --quiet --non-interactive 2>nul
    
    if errorlevel 1 (
        echo [ОШИБКА] Не удалось подключиться к SVN: !SVN_URL!
        rmdir /s /q "!TEMP_SVN!" 2>nul
        pause
        exit /b 1
    )
    
    echo [2/4] Копируем изменения в рабочую директорию...
    
    REM Удаляем файлы которых нет в SVN (исключая .git и скрипты синхронизации)
    for /f "delims=" %%F in ('dir /a /b') do (
        if /i not "%%F"==".git" (
            if /i not "%%F"=="scripts" (
                if /i not "%%F"=="sync-svn-git.bat" (
                    if /i not "%%F"=="sync-svn-git.sh" (
                        if /i not "%%F"==".svn-sync-ignore" (
                            if exist "%%F\" (
                                rmdir /s /q "%%F" 2>nul
                            ) else (
                                del "%%F" 2>nul
                            )
                        )
                    )
                )
            )
        )
    )
    
    REM Копируем файлы из SVN
    xcopy "!TEMP_SVN!\*" "." /E /Y /Q >nul 2>&1
    
    REM Удаляем временную папку
    rmdir /s /q "!TEMP_SVN!" 2>nul
    
    echo [3/4] Проверяем изменения в Git...
) else (
    echo [ИНФО] Используем существующую рабочую копию SVN (.svn)
    
    echo [1/4] Обновляем рабочую копию из SVN...
    svn update --non-interactive --no-auth-cache >nul 2>&1
    
    if errorlevel 1 (
        echo [ОШИБКА] Не удалось обновить рабочую копию SVN.
        pause
        exit /b 1
    )
    
    echo [2/4] Копируем изменения в Git рабочую директорию...
    REM Для рабочей копии файлы уже на месте, ничего не нужно копировать
    
    echo [3/4] Проверяем изменения в Git...
)

REM Добавляем все изменённые файлы в Git
git add -A 2>nul

REM Проверяем есть ли изменения
for /f "delims=" %%i in ('git status --short 2^>nul') do (
    set HAS_CHANGES=1
)

if not defined HAS_CHANGES (
    echo.
    echo [OK] Изменений нет, синхронизация не нужна.
    echo ====================================
    pause
    exit /b 0
)

REM Создаём коммит
echo [4/4] Создаю коммит в Git...
set TIMESTAMP=%date%_%time%
git commit -m "Sync from SVN: %TIMESTAMP%" >nul 2>&1

if errorlevel 1 (
    echo [ОШИБКА] Не удалось создать коммит.
    pause
    exit /b 1
)

echo.
echo [OK] Коммит создан успешно!
echo.

REM Отправка в удалённое Git зеркало (GitHub)
echo [ДОПОЛНИТЕЛЬНО] Отправка в удалённое зеркало GitHub...
git push origin main >nul 2>&1

if errorlevel 1 (
    echo [ВНИМАНИЕ] Не удалось отправить на GitHub.
    echo Коммит сохранён локально. Для отправки выполните:
    echo   git push origin main
) else (
    echo [OK] Отправлено в GitHub зеркало!
)

echo.
echo ====================================
echo   Синхронизация завершена успешно!
echo ====================================
pause
exit /b 0