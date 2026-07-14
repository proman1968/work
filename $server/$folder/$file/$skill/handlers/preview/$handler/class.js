export default {
    icon: 'carbon:settings',
    template: /* html */`
        <skill-preview :$item></skill-preview>
    `
}
ODA({is: 'skill-preview',
    imports: 'oda//button, oda//icon',
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                padding: 8px;
                gap: 8px;
                min-width: 250px;
                max-width: 400px;
            }
            .header {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                font-weight: 600;
            }
            .status {
                font-size: small;
                opacity: 0.7;
            }
            .result {
                @apply --light;
                padding: 8px;
                border-radius: 8px;
                font-size: small;
                white-space: pre-wrap;
                word-break: break-word;
                max-height: 200px;
                overflow-y: auto;
            }
            .error {
                color: var(--error-color, #d32f2f);
                font-size: small;
                padding: 4px;
            }
            fieldset {
                border: 1px solid var(--header-background);
                border-radius: 8px;
                margin: 0;
                padding: 8px;
            }
            legend {
                font-size: small;
                padding: 0 4px;
                font-weight: 600;
            }
            input, textarea {
                width: 100%;
                box-sizing: border-box;
                padding: 4px 6px;
                border: 1px solid var(--header-background);
                border-radius: 4px;
                font-size: small;
                font-family: inherit;
            }
            textarea {
                resize: vertical;
                min-height: 3em;
            }
            .actions {
                @apply --horizontal;
                justify-content: flex-end;
                gap: 4px;
            }
            oda-button {
                border-radius: 8px;
            }
        </style>

        <div class="header" horizontal>
            <oda-icon :icon="skillIcon"></oda-icon>
            <label flex>{{skillLabel}}</label>
            <span class="status">{{statusLabel}}</span>
        </div>

        <div ~if="hasError" class="error">{{skillError}}</div>

        <div ~if="hasResult" class="result">{{resultText}}</div>

        <div ~if="isPending" vertical>
            <fieldset ~if="fields.length" vertical>
                <legend>Параметры</legend>
                <div ~for="fields" vertical style="gap: 4px; padding: 4px 0;">
                    <label ~if="$for.item.label || $for.item.id" style="font-size: x-small; opacity: 0.7;">{{$for.item.label || $for.item.id}}</label>
                    <textarea ~if="$for.item.type === 'Text'"
                              :placeholder="$for.item.placeholder || ''"
                              ::value="formData[$for.item.id]"
                              rows="2"></textarea>
                    <input ~if="$for.item.type !== 'Text'"
                           type="text"
                           :placeholder="$for.item.placeholder || ''"
                           ::value="formData[$for.item.id]">
                </div>
            </fieldset>
            <div class="actions">
                <oda-button :icon="isRunning ? 'icons:timer' : 'icons:play-arrow'" :disabled="isRunning" @tap="execute">
                    {{isRunning ? '...' : 'Выполнить'}}
                </oda-button>
            </div>
        </div>

        <div ~if="isRunning" class="status" horizontal style="align-items: center; gap: 4px;">
            <oda-icon icon="icons:timer" icon-size="16"></oda-icon>
            Выполняется...
        </div>

        <div ~if="isDone && !hasResult" class="status" horizontal style="align-items: center; gap: 4px;">
            <oda-icon icon="icons:check" icon-size="16"></oda-icon>
            Готово
        </div>
    `,
    $item: {
        $def: null,
        set(n) {
            Promise.resolve(n).then(file => {
                this._file = file;
                this._loadSkillData();
                if (file?.listen) {
                    file.listen('changed', () => {
                        this._loadSkillData();
                    });
                }
            });
        }
    },
    log: null,
    _skillData: null,
    isRunning: false,
    formData: {},
    get skillData() {
        return this._skillData;
    },
    get skillLabel() {
        return this._skillData?.label || this._skillData?.skill || 'Skill';
    },
    get skillIcon() {
        return this._skillData?.icon || 'carbon:settings';
    },
    get skillError() {
        return this._skillData?.error || '';
    },
    get fields() {
        return this._skillData?.METADATA?.FIELDS?.fields || this._skillData?.metadata?.FIELDS?.fields || [];
    },
    get status() {
        return this._skillData?.status || 'pending';
    },
    get isPending() {
        return this.status === 'pending' && !this.isRunning;
    },
    get isRunning() {
        return this.status === 'running' || this._running;
    },
    get isDone() {
        return this.status === 'done';
    },
    get hasError() {
        return this.status === 'error' && !!this.skillError;
    },
    get hasResult() {
        const r = this._skillData?.result;
        return r != null && typeof r !== 'object';
    },
    get resultText() {
        const r = this._skillData?.result;
        if (r == null) return '';
        if (typeof r === 'string') return r;
        return JSON.stringify(r, null, 2);
    },
    get statusLabel() {
        switch (this.status) {
            case 'pending': return 'ожидание';
            case 'running': return 'выполняется';
            case 'done': return 'готово';
            case 'error': return 'ошибка';
            default: return '';
        }
    },
    async _loadSkillData() {
        const file = this._file;
        if (!file?.load) {
            this._skillData = null;
            this.render();
            return;
        }
        try {
            const raw = await file.load();
            const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (this.log?.METADATA && !data.METADATA)
                data.METADATA = this.log.METADATA;
            this._skillData = data;
            if (!this._formDataInit) {
                this._formDataInit = true;
                const fields = data?.METADATA?.FIELDS?.fields || [];
                for (const f of fields) {
                    if (data.data?.[f.id] != null)
                        this.formData[f.id] = data.data[f.id];
                    else
                        this.formData[f.id] = '';
                }
            }
        }
        catch (e) {
            console.warn('[skill-preview] load', e);
        }
        this.render();
    },
    async _resolveClass(filePath) {
        const parts = String(filePath || '').split('/').filter(Boolean);
        if (!parts.length)
            return null;
        // /users/UID/... → storage = /users/UID
        if (parts[0] === 'users' && parts[1])
            return WORK.get_item('/users/' + parts[1], 'info');
        // /root/group/... → storage = первый сегмент (root или другой корневой контейнер)
        return WORK.get_item('/' + parts[0], 'info');
    },
    async execute() {
        const file = this._file;
        if (!file?.path) return;
        this._running = true;
        this.render();

        // Обновляем data в .skill файле перед запуском
        try {
            const updated = {
                ...this._skillData,
                data: { ...(this._skillData.data || {}), ...this.formData },
                status: 'running',
                updatedAt: Date.now(),
            };
            if (file.save) {
                await file.save(JSON.stringify(updated, null, 2));
            }
        }
        catch (e) {
            console.warn('[skill-preview] save before execute', e);
        }

        // Разрешаем storage из пути файла (как ai-preview)
        const storage = await this._resolveClass(file.path);

        if (!storage?.fetch) {
            console.warn('[skill-preview] storage not found for path:', file.path);
            this._running = false;
            this._skillData = {
                ...this._skillData,
                status: 'error',
                error: 'Не найдено классе для выполнения',
                updatedAt: Date.now(),
            };
            this.render();
            return;
        }

        try {
            const skillPath = file.path;
            const taskPath = this._skillData?.taskPath || null;
            await storage.fetch('execute_skill', { skillPath, taskPath });
        }
        catch (e) {
            console.error('[skill-preview] execute_skill', e);
            this._skillData = {
                ...this._skillData,
                status: 'error',
                error: e?.message || String(e),
                updatedAt: Date.now(),
            };
        }
        finally {
            this._running = false;
            await this._loadSkillData();
            this.render();
        }
    },
})