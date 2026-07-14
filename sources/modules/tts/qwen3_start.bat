@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo === Qwen3-TTS сервер ===
echo.

python --version >nul 2>&1
if errorlevel 1 (
    echo [ОШИБКА] Python не найден. Установите Python 3.10+ и добавьте в PATH
    pause
    exit /b 1
)

if not exist ".venv" (
    echo [1/3] Создание виртуального окружения...
    python -m venv .venv
)

echo [2/3] Обновление pip...
.venv\Scripts\python -m pip install --upgrade pip

echo [3/3] Установка зависимостей...
.venv\Scripts\pip install -r qwen3_requirements.txt

echo.
echo === Запуск Qwen3-TTS сервера на порту 8002 ===
echo Модель: Qwen/Qwen3-TTS-12Hz-0.6B-Base
echo.
echo Первый запуск: модель скачается автоматически (~1.2 ГБ)
echo.
echo Остановка: Ctrl+C
echo.

.venv\Scripts\python qwen3_server.py
pause