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
    if errorlevel 1 (
        echo [ОШИБКА] Не удалось создать .venv
        pause
        exit /b 1
    )
)

echo [2/3] Обновление pip...
.venv\Scripts\python -m pip install --upgrade pip
if errorlevel 1 (
    echo [ОШИБКА] pip upgrade failed
    pause
    exit /b 1
)

echo [3/3] Установка зависимостей (PyPI, без git clone)...
.venv\Scripts\pip install -r qwen3_requirements.txt
if errorlevel 1 (
    echo.
    echo [ОШИБКА] pip install failed — сервер не запускаем.
    echo Повторите при стабильном интернете: .\.venv\Scripts\pip install -r qwen3_requirements.txt
    pause
    exit /b 1
)

echo.
echo === Запуск Qwen3-TTS на порту 8002 ===
echo Модель: Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice
echo.
echo Первый запуск: веса скачаются с Hugging Face автоматически.
echo Health: http://127.0.0.1:8002/health
echo Остановка: Ctrl+C
echo.

.venv\Scripts\python qwen3_server.py
if errorlevel 1 (
    echo [ОШИБКА] сервер завершился с ошибкой
)
pause
