/**
 * Модальное окно однократного показа выпущенного токена подключения (MCP и WORK Chrome Bridge).
 * Отображается один раз после выпуска — повторно восстановить секрет из БД невозможно.
 */
ODA({
    is: 'user-token',
    imports: 'oda//button',
    template: /* html */`
    <style>
        :host {
            @apply --vertical;
            gap: 12px;
            padding: 16px;
            min-width: 340px;
            max-width: 520px;
            box-sizing: border-box;
            @apply --light;
        }
        .warn {
            padding: 10px 12px;
            border-radius: 8px;
            background: var(--accent-soft, #eff6ff);
            border: 1px solid var(--border-color, #d1d5db);
            font-size: 13px;
            line-height: 1.45;
        }
        .field {
            @apply --vertical;
            gap: 4px;
        }
        .label {
            font-size: 12px;
            font-weight: 600;
            opacity: 0.8;
        }
        .row {
            @apply --horizontal;
            gap: 8px;
            align-items: stretch;
        }
        .val {
            flex: 1;
            min-width: 0;
            padding: 8px 10px;
            border-radius: 6px;
            border: 1px solid var(--border-color, #d1d5db);
            background: var(--subtle-background, #f8fafc);
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            font-size: 12.5px;
            line-height: 1.4;
            word-break: break-all;
            user-select: all;
        }
        .copy-btn {
            flex-shrink: 0;
            padding: 0 12px;
            border-radius: 6px;
            border: 1px solid var(--border-color, #d1d5db);
            background: var(--content, #fff);
            cursor: pointer;
            font-size: 12.5px;
            white-space: nowrap;
        }
        .copy-btn.ok {
            border-color: var(--success-color, #16a34a);
            color: var(--success-color, #16a34a);
        }
        .hint {
            font-size: 12px;
            opacity: 0.75;
            line-height: 1.4;
        }
    </style>
    <div class="warn">
        <strong>Сохраните токен сейчас.</strong> Он показывается только один раз.
        Если потеряете — отзовите в профиле и выпустите новый.
    </div>

    <div class="field">
        <div class="label">Персональный токен (для Chrome Bridge и MCP)</div>
        <div class="row">
            <div class="val">{{token}}</div>
            <button class="copy-btn" :class="{ok: copied === 'token'}" @tap.stop="copy('token', token)">
                {{copied === 'token' ? 'Скопировано' : 'Скопировать'}}
            </button>
        </div>
    </div>

    <div class="field">
        <div class="label">Адрес сервера WORK (для расширения Chrome Bridge)</div>
        <div class="row">
            <div class="val">{{origin}}</div>
            <button class="copy-btn" :class="{ok: copied === 'origin'}" @tap.stop="copy('origin', origin)">
                {{copied === 'origin' ? 'Скопировано' : 'Скопировать'}}
            </button>
        </div>
    </div>

    <div class="field">
        <div class="label">Адрес MCP-сервера (для OpenCode / Claude Code)</div>
        <div class="row">
            <div class="val">{{mcpUrl}}</div>
            <button class="copy-btn" :class="{ok: copied === 'mcp'}" @tap.stop="copy('mcp', mcpUrl)">
                {{copied === 'mcp' ? 'Скопировано' : 'Скопировать'}}
            </button>
        </div>
    </div>

    <div class="field">
        <div class="label">Готовая строка для WORK Chrome Bridge (можно вставить целиком в поле токена)</div>
        <div class="row">
            <div class="val">{{bridgeJson}}</div>
            <button class="copy-btn" :class="{ok: copied === 'json'}" @tap.stop="copy('json', bridgeJson)">
                {{copied === 'json' ? 'Скопировано' : 'Скопировать'}}
            </button>
        </div>
    </div>

    <div class="hint">
        В Chrome: иконка расширения <b>WORK Chrome Bridge</b> → <b>Настройки</b> → вставьте адрес и токен (или готовую строку) → <b>Сохранить и подключить</b>.
    </div>
    `,
    token: '',
    origin: '',
    copied: '',
    get mcpUrl() {
        return (this.origin || location.origin) + '/mcp';
    },
    get bridgeJson() {
        return JSON.stringify({
            server: this.origin || location.origin,
            token: this.token || '',
        });
    },
    async copy(key, text) {
        const val = String(text ?? '');
        let ok = false;
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(val);
                ok = true;
            }
        }
        catch { /* fallback ниже */ }
        if (!ok && typeof document !== 'undefined') {
            try {
                const ta = document.createElement('textarea');
                ta.value = val;
                ta.setAttribute('readonly', '');
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                ok = document.execCommand('copy');
                ta.remove();
            }
            catch { /* ignore */ }
        }
        if (ok) {
            this.copied = key;
            clearTimeout(this._copyTimer);
            this._copyTimer = setTimeout(() => {
                if (this.copied === key)
                    this.copied = '';
            }, 2000);
        }
    },
});
