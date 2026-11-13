/**
 * form/provider — экран настройки внешнего/облачного провайдера ИИ ($provider):
 *  - ввод и сохранение API-ключа / OAuth-токена / Folder ID в #secret без редактирования JSON;
 *  - индикация активности провайдера и проверка связи с API (GET /v1/models);
 *  - включение/выключение моделей и добавление моделей в 1 клик (из пресета, из /v1/models или вручную).
 */
export default {
    imports: 'oda//button, oda//icon',
    template: /*html*/`
    <style>
        :host {
            @apply --vertical;
            @apply --flex;
            overflow-y: auto;
            background: var(--content-background, #ffffff);
            color: var(--content-color, #1e293b);
            font-size: 13px;
            padding: 16px 20px;
            gap: 14px;
            box-sizing: border-box;
        }
        .header-card {
            @apply --horizontal;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 12px 16px;
            border-radius: 8px;
            border: 1px solid var(--border-color, #cbd5e1);
            background: var(--subtle-background, #f8fafc);
            flex-wrap: wrap;
        }
        .header-left {
            @apply --horizontal;
            align-items: center;
            gap: 12px;
            min-width: 0;
        }
        .title {
            font-size: 16px;
            font-weight: 700;
        }
        .desc {
            font-size: 12px;
            opacity: 0.8;
            margin-top: 2px;
        }
        .badge {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 3px 10px;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 600;
            white-space: nowrap;
        }
        .badge.active {
            background: light-dark(#dcfce7, #14532d);
            color: light-dark(#166534, #bbf7d0);
            border: 1px solid light-dark(#86efac, #16a34a);
        }
        .badge.inactive {
            background: light-dark(#f1f5f9, #27272a);
            color: light-dark(#64748b, #a1a1aa);
            border: 1px solid light-dark(#cbd5e1, #3f3f46);
        }
        .dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            display: inline-block;
        }
        .dot.on { background: #22c55e; }
        .dot.off { background: #94a3b8; }

        .grid-2 {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
            gap: 14px;
        }
        .card {
            @apply --vertical;
            gap: 10px;
            padding: 14px 16px;
            border-radius: 8px;
            border: 1px solid var(--border-color, #cbd5e1);
            background: var(--content-background, #ffffff);
        }
        .section-title {
            font-weight: 700;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            opacity: 0.75;
            border-bottom: 1px solid var(--border-color, #e2e8f0);
            padding-bottom: 6px;
        }
        .field {
            @apply --vertical;
            gap: 4px;
        }
        .field label {
            font-size: 12px;
            font-weight: 600;
        }
        input:not([type="checkbox"]), select {
            padding: 6px 10px;
            font-size: 13px;
            border: 1px solid var(--border-color, #cbd5e1);
            border-radius: 6px;
            background: var(--content-background, #ffffff);
            color: inherit;
        }
        .toolbar {
            @apply --horizontal;
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
        }
        .btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 14px;
            font-size: 12.5px;
            font-weight: 600;
            border-radius: 6px;
            border: 1px solid var(--border-color, #cbd5e1);
            background: var(--subtle-background, #f1f5f9);
            color: inherit;
            cursor: pointer;
        }
        .btn.primary {
            background: var(--accent-color, #2563eb);
            border-color: var(--accent-color, #2563eb);
            color: #ffffff;
        }
        .model-row {
            @apply --horizontal;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            padding: 8px 10px;
            border-radius: 6px;
            border: 1px solid var(--border-color, #e2e8f0);
            background: var(--subtle-background, #f8fafc);
        }
        .model-row.off {
            opacity: 0.55;
        }
        .pill {
            font-size: 11px;
            padding: 1px 6px;
            border-radius: 4px;
            border: 1px solid var(--border-color, #cbd5e1);
            background: var(--content-background, #ffffff);
        }
        .msg {
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12.5px;
        }
        .msg.ok {
            background: light-dark(#dcfce7, #14532d);
            color: light-dark(#166534, #bbf7d0);
        }
        .msg.err {
            background: light-dark(#fee2e2, #450a0a);
            color: light-dark(#991b1b, #fecaca);
        }
    </style>

    <div class="header-card" ~if="state">
        <div class="header-left">
            <oda-icon :icon="state.icon || 'carbon:api'" icon-size="32"></oda-icon>
            <div>
                <div class="title">{{state.label}}</div>
                <div class="desc" ~if="state.description">{{state.description}}</div>
            </div>
        </div>
        <div class="toolbar">
            <span class="badge" ~class="state.active ? 'active' : 'inactive'">
                <span class="dot" ~class="state.active ? 'on' : 'off'"></span>
                <span>{{state.active ? 'Активен' : ('Неактивен: ' + (state.statusReason || 'Не настроен ключ'))}}</span>
            </span>
            <label class="toolbar" style="cursor:pointer;font-weight:600;">
                <input type="checkbox" :checked="state.enabled !== false" @change="toggleProviderEnabled($event.target.checked)">
                <span>Провайдер включён</span>
            </label>
        </div>
    </div>

    <div class="msg ok" ~if="notice">{{notice}}</div>
    <div class="msg err" ~if="error">{{error}}</div>

    <div class="grid-2" ~if="state">
        <!-- Левая карточка: Ключ доступа и параметры API -->
        <div class="card">
            <div class="section-title">1. Ключ доступа и подключение (#secret/{{state.secretFile}})</div>

            <div class="field">
                <label>{{state.keyLabel || 'API-ключ'}} <span ~if="state.hasKey" style="color:#16a34a;font-weight:700;">(сохранён: {{state.maskedKey}})</span></label>
                <input type="password" :value="apiKeyInput" :placeholder="state.hasKey ? 'Оставьте пустым, чтобы не менять (' + state.maskedKey + ')' : state.keyPlaceholder" @input="apiKeyInput = $this.value">
            </div>

            <div class="field" ~if="state.needsFolderId">
                <label>ID каталога Yandex Cloud (Folder ID)</label>
                <input :value="folderIdInput" :placeholder="state.folderPlaceholder || 'b1g...'" @input="folderIdInput = $this.value">
            </div>

            <div class="field" ~if="state.protocol === 'gigachat'">
                <label>Scope (версия API GigaChat)</label>
                <select @change="scopeInput = $this.value">
                    <option value="GIGACHAT_API_PERS" :selected="scopeInput === 'GIGACHAT_API_PERS'">GIGACHAT_API_PERS (Физлица)</option>
                    <option value="GIGACHAT_API_B2B" :selected="scopeInput === 'GIGACHAT_API_B2B'">GIGACHAT_API_B2B (ИП / Юрлица по пакетам)</option>
                    <option value="GIGACHAT_API_CORP" :selected="scopeInput === 'GIGACHAT_API_CORP'">GIGACHAT_API_CORP (Корпоративный pay-as-you-go)</option>
                </select>
            </div>

            <div class="field">
                <label>Адрес API (Base URL)</label>
                <input :value="baseUrlInput" @input="baseUrlInput = $this.value">
            </div>

            <div class="field">
                <label>Протокол</label>
                <select @change="protocolInput = $this.value">
                    <option value="openai" :selected="protocolInput === 'openai'">OpenAI-совместимый (openai)</option>
                    <option value="gigachat" :selected="protocolInput === 'gigachat'">Сбер GigaChat (gigachat)</option>
                    <option value="yandex" :selected="protocolInput === 'yandex'">Яндекс Cloud AI / Алиса (yandex)</option>
                    <option value="anthropic" :selected="protocolInput === 'anthropic'">Anthropic Messages API (anthropic)</option>
                    <option value="ollama" :selected="protocolInput === 'ollama'">Ollama / Локальный сервер (ollama)</option>
                </select>
            </div>

            <div class="toolbar" style="margin-top:4px;">
                <button type="button" class="btn primary" @tap="saveConfig()">Сохранить ключ и настройки</button>
                <button type="button" class="btn" ~if="state.hasKey" @tap="clearKey()">Очистить ключ</button>
                <button type="button" class="btn" @tap="fetchRemoteModels()">Проверить API / Загрузить модели</button>
            </div>
        </div>

        <!-- Правая карточка: Модели провайдера -->
        <div class="card">
            <div class="section-title">2. Подключённые модели в дереве ({{state.installedModels?.length || 0}})</div>

            <div ~if="!state.installedModels?.length" style="opacity:0.75;padding:6px 0;">
                У провайдера пока нет добавленных моделей. Добавьте их из списка ниже.
            </div>

            <div class="model-row" ~for="state.installedModels" ~class="{'off': !$for.item.active}">
                <div class="toolbar" style="min-width:0;">
                    <span class="dot" ~class="$for.item.active ? 'on' : 'off'"></span>
                    <div style="min-width:0;">
                        <div style="font-weight:700;">{{$for.item.label}}</div>
                        <div style="font-size:11.5px;opacity:0.75;">model: <code>{{$for.item.model}}</code> · ctx: {{$for.item.maxTokens}}</div>
                    </div>
                </div>
                <div class="toolbar">
                    <span class="pill" ~for="$for.item.capabilities">{{$for.$for.item}}</span>
                    <label class="toolbar" style="cursor:pointer;font-size:12px;">
                        <input type="checkbox" :checked="$for.item.enabled !== false" @change="toggleModel($for.item.path, $event.target.checked)">
                        <span>Вкл</span>
                    </label>
                </div>
            </div>

            <div class="section-title" style="margin-top:8px;">3. Быстрое добавление модели</div>
            <div class="toolbar">
                <input style="flex:1;min-width:150px;" :value="customModelId" placeholder="ID модели на API (например: gpt-4.1, deepseek-chat)…" @input="customModelId = $this.value">
                <input style="flex:1;min-width:140px;" :value="customModelLabel" placeholder="Название в дереве (опц.)" @input="customModelLabel = $this.value">
                <button type="button" class="btn primary" @tap="addCustomModel()">+ Добавить</button>
            </div>

            <div class="toolbar" ~if="missingPresetModels.length" style="margin-top:4px;">
                <span style="font-size:12px;font-weight:600;">Из каталога провайдера:</span>
                <button type="button" class="btn" ~for="missingPresetModels" @tap="addPresetModel($for.item)">+ {{$for.item.label}}</button>
            </div>

            <div ~if="remoteModels.length" style="margin-top:6px;">
                <div style="font-size:12px;font-weight:600;margin-bottom:4px;">Найдено на сервере API ({{remoteModels.length}}):</div>
                <div class="toolbar">
                    <button type="button" class="btn" ~for="remoteModels" @tap="addRemoteModel($for.item)">+ {{$for.item}}</button>
                </div>
            </div>
        </div>
    </div>
    `,
    state: null,
    apiKeyInput: '',
    folderIdInput: '',
    scopeInput: 'GIGACHAT_API_PERS',
    baseUrlInput: '',
    protocolInput: 'openai',
    customModelId: '',
    customModelLabel: '',
    remoteModels: [],
    notice: '',
    error: '',
    get missingPresetModels() {
        const installed = new Set((this.state?.installedModels || []).map(m => m.model));
        return (this.state?.presetModels || []).filter(m => !installed.has(m.model));
    },
    async attached() {
        await this.reload();
    },
    async reload() {
        if (!this.$item)
            return;
        try {
            const st = await this.$item.fetch('provider_status');
            this.state = st;
            this.folderIdInput = st?.folderId || '';
            this.scopeInput = st?.scope || 'GIGACHAT_API_PERS';
            this.baseUrlInput = st?.baseUrl || '';
            this.protocolInput = st?.protocol || 'openai';
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    _refreshModelsTree() {
        for (const w of [window, window.parent, window.top]) {
            try {
                const wk = w?.WORK;
                if (!wk?.items)
                    continue;
                for (const k of Object.keys(wk.items)) {
                    if (k === '/MODELS' || k.startsWith('/MODELS/')) {
                        const node = wk.items[k];
                        if (node?.[w.R]?.cache)
                            delete node[w.R].cache.items;
                        node?.reset?.();
                    }
                }
            }
            catch { /* ignore */ }
        }
    },
    async saveConfig() {
        this.error = '';
        this.notice = '';
        if (!this.$item)
            return;
        try {
            const payload = {
                baseUrl: this.baseUrlInput,
                protocol: this.protocolInput,
                scope: this.scopeInput,
                folderId: this.folderIdInput,
            };
            if (this.apiKeyInput.trim())
                payload.apiKey = this.apiKeyInput.trim();
            const res = await this.$item.fetch('provider_save_config', payload);
            this.apiKeyInput = '';
            this.state = res?.status || await this.$item.fetch('provider_status');
            this.notice = 'Настройки и ключ провайдера сохранены.';
            this._refreshModelsTree();
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async clearKey() {
        this.error = '';
        this.notice = '';
        if (!this.$item)
            return;
        try {
            const res = await this.$item.fetch('provider_save_config', { apiKey: '' });
            this.apiKeyInput = '';
            this.state = res?.status || await this.$item.fetch('provider_status');
            this.notice = 'Ключ удалён — провайдер переведён в неактивное состояние.';
            this._refreshModelsTree();
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async toggleProviderEnabled(checked) {
        this.error = '';
        if (!this.$item)
            return;
        try {
            await this.$item.fetch('provider_toggle_model', {
                nodePath: this.$item.path,
                enabled: checked,
            });
            await this.reload();
            this._refreshModelsTree();
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async toggleModel(modelPath, checked) {
        this.error = '';
        if (!this.$item)
            return;
        try {
            await this.$item.fetch('provider_toggle_model', {
                nodePath: modelPath,
                enabled: checked,
            });
            await this.reload();
            this._refreshModelsTree();
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async addCustomModel() {
        const model = this.customModelId.trim();
        if (!model)
            return;
        const label = this.customModelLabel.trim() || model;
        this.error = '';
        try {
            const res = await this.$item.fetch('provider_add_models', {
                models: [{ id: label, label, model }],
            });
            this.customModelId = '';
            this.customModelLabel = '';
            this.state = res?.status || await this.$item.fetch('provider_status');
            this.notice = `Модель «${label}» добавлена в дерево провайдера.`;
            this._refreshModelsTree();
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async addPresetModel(spec) {
        this.error = '';
        try {
            const res = await this.$item.fetch('provider_add_models', {
                models: [spec],
            });
            this.state = res?.status || await this.$item.fetch('provider_status');
            this.notice = `Модель «${spec.label}» добавлена.`;
            this._refreshModelsTree();
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async addRemoteModel(modelId) {
        this.error = '';
        try {
            const res = await this.$item.fetch('provider_add_models', {
                models: [{ id: modelId, label: modelId, model: modelId }],
            });
            this.state = res?.status || await this.$item.fetch('provider_status');
            this.notice = `Модель «${modelId}» добавлена.`;
            this._refreshModelsTree();
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async fetchRemoteModels() {
        this.error = '';
        this.notice = '';
        if (!this.$item)
            return;
        try {
            const res = await this.$item.fetch('list_remote');
            if (res?.error) {
                this.error = res.error + (res.tried?.length ? ' (' + res.tried.join('; ') + ')' : '');
                return;
            }
            this.remoteModels = Array.isArray(res?.models) ? res.models : [];
            this.notice = `Подключение успешно (${res.source}): доступно моделей — ${this.remoteModels.length}.`;
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
}
