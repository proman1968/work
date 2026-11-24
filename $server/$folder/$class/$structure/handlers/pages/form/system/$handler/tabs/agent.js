export default {
    imports: 'oda//icon, oda//button',
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                @apply --flex;
                padding: 16px 20px;
                gap: 16px;
                overflow-y: auto;
                background: var(--content-background);
                color: var(--content-color);
                font-size: 13px;
            }
            .card {
                @apply --vertical;
                gap: 10px;
                padding: 14px 16px;
                border: 1px solid var(--subtle-border, var(--border-color));
                border-radius: 10px;
                background: var(--subtle-background);
            }
            .card-head {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                font-weight: 700;
                font-size: 14.5px;
            }
            .rule-item {
                @apply --vertical;
                gap: 6px;
                padding: 10px 12px;
                border-radius: 8px;
                border: 1px solid var(--subtle-border, var(--border-color));
                background: var(--content-background);
            }
            .row {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
            }
            input[type="text"], input[type="number"], select, textarea {
                padding: 5px 8px;
                border: 1px solid var(--control-border-color, var(--border-color));
                border-radius: 6px;
                font: inherit;
                font-size: 12.5px;
                background: var(--content-background);
                color: var(--control-color, inherit);
            }
            textarea {
                width: 100%;
                min-height: 64px;
                resize: vertical;
                box-sizing: border-box;
            }
            .badge {
                font-size: 11px;
                padding: 2px 7px;
                border-radius: 10px;
                background: var(--accent-soft);
                color: var(--accent-color);
                font-weight: 600;
            }
            .badge.off {
                background: rgba(148, 163, 184, 0.2);
                color: var(--muted-color);
            }
            .muted {
                color: var(--muted-color);
                font-size: 12.5px;
            }
        </style>

        <div class="card">
            <div class="card-head">
                <oda-icon icon="bootstrap:robot" icon-size="20"></oda-icon>
                <span>Правила проактивности узла ({{triggers.length}})</span>
                <div class="row" style="margin-left:auto;">
                    <oda-button icon="icons:add" @tap="openNewRule()">Новое правило</oda-button>
                    <oda-button icon="icons:refresh" @tap="reload()">Обновить</oda-button>
                </div>
            </div>

            <div ~if="editing" class="rule-item" style="border-color:var(--accent-color);">
                <div style="font-weight:700;">{{editingIsNew ? 'Новое правило проактивности' : 'Редактирование: ' + form.name}}</div>
                <div class="row">
                    <input type="text" placeholder="Имя правила (латиница/цифры/_/-)" :disabled="!editingIsNew" ::value="form.name" style="width:200px;">
                    <select ::value="form.on">
                        <option value="db:register">Проведение документа (db:register)</option>
                        <option value="db:create">Создание объекта (db:create)</option>
                        <option value="db:update">Изменение объекта (db:update)</option>
                        <option value="chat:message">Сообщение в чате (chat:message)</option>
                        <option value="save">Сохранение файла (save)</option>
                    </select>
                    <input ~if="form.on !== 'save' && form.on !== 'chat:message'" type="text" placeholder="Путь класса (необязательно)" ::value="form.class" style="flex:1;min-width:200px;">
                    <input ~if="form.on === 'save'" type="text" placeholder="Расширения (eml, pdf)" ::value="form.ext" style="width:160px;">
                </div>
                <div class="row">
                    <input type="text" placeholder="Условие when (например: sum > 100000)" ::value="form.when" style="flex:1;min-width:220px;">
                    <input type="number" placeholder="Cooldown (сек)" ::value="form.cooldownSec" style="width:120px;" title="Пауза между срабатываниями на один объект (сек)">
                    <label class="row" style="gap:4px;cursor:pointer;">
                        <input type="checkbox" :checked="form.approval" @change="form.approval = $event.target.checked">
                        <span>Карточка подтверждения</span>
                    </label>
                    <label class="row" style="gap:4px;cursor:pointer;">
                        <input type="checkbox" :checked="form.enabled" @change="form.enabled = $event.target.checked">
                        <span>Включено</span>
                    </label>
                </div>
                <input type="text" placeholder="Быстрый шаблон ответа без LLM (необязательно, например: Проведена сумма {{sum}})" ::value="form.template">
                <textarea placeholder="Инструкция для ИИ-агента (если не задан быстрый шаблон)..." ::value="form.body"></textarea>
                <div class="row" style="justify-content:flex-end;">
                    <oda-button icon="icons:check" info-invert @tap="saveRule()">Сохранить</oda-button>
                    <oda-button icon="icons:close" @tap="editing = false">Отмена</oda-button>
                </div>
            </div>

            <div ~if="!triggers.length" class="muted">Для этого узла ещё не заданы проактивные триггеры.</div>

            <div class="rule-item" ~for="triggers">
                <div class="row">
                    <b>{{$for.item.name}}</b>
                    <span class="badge">{{$for.item.on}}</span>
                    <span ~if="$for.item.approval" class="badge">подтверждение</span>
                    <span class="badge" ~class="{ off: !$for.item.enabled }">{{$for.item.enabled ? 'вкл' : 'выкл'}}</span>
                    <div class="row" style="margin-left:auto;">
                        <oda-button icon="editor:mode-edit" @tap="editRule($for.item)">Изменить</oda-button>
                        <oda-button ~if="$for.item.own" icon="icons:delete" @tap="deleteRule($for.item.name)"></oda-button>
                    </div>
                </div>
                <div ~if="$for.item.when" class="muted">Условие: <code>{{$for.item.when}}</code></div>
                <div ~if="$for.item.template" class="muted">Шаблон: {{$for.item.template}}</div>
                <div ~if="!$for.item.template && $for.item.body" class="muted">{{$for.item.body}}</div>
            </div>
        </div>

        <div class="card">
            <div class="card-head">
                <oda-icon icon="icons:schedule" icon-size="20"></oda-icon>
                <span>Расписания узла ({{schedules.length}})</span>
            </div>
            <div class="row">
                <input type="text" placeholder="Название (например: Утренняя сводка)" ::value="schedLabel" style="width:220px;">
                <input type="number" placeholder="Каждые (мин ≥ 15)" ::value="schedEvery" style="width:140px;">
                <input type="text" placeholder="Задача для Агента..." ::value="schedPrompt" style="flex:1;min-width:220px;">
                <oda-button icon="icons:add" @tap="addSchedule()">Добавить</oda-button>
            </div>
            <div ~if="!schedules.length" class="muted">Расписаний узла пока нет.</div>
            <div class="rule-item" ~for="schedules">
                <div class="row">
                    <b>{{$for.item.label}}</b>
                    <span class="badge">{{$for.item.when}}</span>
                    <span class="badge" ~class="{ off: !$for.item.enabled }">{{$for.item.enabled ? 'активно' : 'пауза'}}</span>
                    <div class="row" style="margin-left:auto;">
                        <oda-button @tap="toggleSched($for.item)">{{$for.item.enabled ? 'Пауза' : 'Включить'}}</oda-button>
                        <oda-button icon="icons:delete" @tap="deleteSched($for.item)"></oda-button>
                    </div>
                </div>
                <div class="muted">{{$for.item.prompt}}</div>
            </div>
        </div>

        <div ~if="error" style="color:var(--error-color, #c00);">{{error}}</div>
    `,
    triggers: [],
    schedules: [],
    editing: false,
    editingIsNew: true,
    form: {},
    schedLabel: '',
    schedEvery: 60,
    schedPrompt: '',
    error: '',
    async attached() {
        await this.reload();
    },
    async reload() {
        this.error = '';
        if (!this.$item?.fetch)
            return;
        try {
            const res = await this.$item.fetch('agent_rules_list');
            this.triggers = Array.isArray(res?.triggers) ? res.triggers : [];
            this.schedules = Array.isArray(res?.schedules) ? res.schedules : [];
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    openNewRule() {
        this.editingIsNew = true;
        this.form = {
            name: '',
            on: 'db:register',
            class: '',
            ext: '',
            when: '',
            template: '',
            body: '',
            approval: false,
            cooldownSec: 60,
            maxPerHour: 20,
            enabled: true,
        };
        this.editing = true;
    },
    editRule(r) {
        this.editingIsNew = false;
        this.form = {
            name: r.name,
            on: Array.isArray(r.on) ? r.on.join(', ') : (r.on || 'save'),
            class: r.class || '',
            ext: r.ext || '',
            when: r.when || '',
            template: r.template || '',
            body: r.body || '',
            approval: Boolean(r.approval),
            cooldownSec: Number(r.cooldownSec) || 0,
            maxPerHour: Number(r.maxPerHour) || 20,
            enabled: r.enabled !== false,
            as: r.as || '',
        };
        this.editing = true;
    },
    async saveRule() {
        this.error = '';
        try {
            const payload = { ...this.form, as: this.form.as || WORK.uid };
            await this.$item.fetch('agent_rule_save', {}, JSON.stringify(payload));
            this.editing = false;
            await this.reload();
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async deleteRule(name) {
        this.error = '';
        try {
            await this.$item.fetch('agent_rule_save', {}, JSON.stringify({ name, delete: true }));
            await this.reload();
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async addSchedule() {
        this.error = '';
        const prompt = String(this.schedPrompt || '').trim();
        if (!prompt)
            return;
        try {
            await this.$item.fetch('agent_schedule_save', {}, JSON.stringify({
                label: this.schedLabel || prompt.slice(0, 50),
                prompt,
                rule: { every: Math.max(15, Number(this.schedEvery) || 60) },
            }));
            this.schedLabel = '';
            this.schedPrompt = '';
            await this.reload();
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async toggleSched(s) {
        this.error = '';
        try {
            await this.$item.fetch('agent_schedule_save', {}, JSON.stringify({ id: s.id, toggle: true, enabled: !s.enabled }));
            await this.reload();
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async deleteSched(s) {
        this.error = '';
        try {
            await this.$item.fetch('agent_schedule_save', {}, JSON.stringify({ id: s.id, delete: true }));
            await this.reload();
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
};
