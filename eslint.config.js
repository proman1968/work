/**
 * ESLint (flat config) — этап hardening 4.1.
 * Область пока только новый/меняемый код (потом расширить на всё дерево):
 *   sources/modules/agent/** — ядро агента (инструменты, цикл, права, сессии)
 *   sources/host/**           — хост (HTTP, аутентификация, сетевая защита, секреты)
 * Правила: @eslint/js recommended; no-empty (в т.ч. пустой catch) — warn,
 * станет error в 4.2, когда пустые catch получат log.debug (agent/log.js).
 */
import js from '@eslint/js';
import globals from 'globals';

export default [
    {
        ignores: ['**/node_modules/**'],
    },
    {
        files: ['sources/modules/agent/**/*.js', 'sources/host/**/*.js'],
        languageOptions: {
            ecmaVersion: 2025,
            sourceType: 'module',
            // WORK — глобал ядра (globalThis.WORK задаётся при старте сервера)
            globals: { ...globals.node, WORK: 'readonly' },
        },
        rules: {
            ...js.configs.recommended.rules,
            // переменные с префиксом _ — осознанно отбрасываемые (resources.js: _hooks)
            'no-unused-vars': ['error', { varsIgnorePattern: '^_' }],
            'no-empty': ['error', { allowEmptyCatch: false }],
        },
    },
];
