function describeClientMask(rawMask, days = null) {
    const src = String(rawMask || '').trim();
    const m = src.match(/^(\d{4}|[Yy]{4})-(\d{2}|[Mm]{2})-(\d{2}|[Dd]{2})[T ](\d{2}|[Hh]{2}):(\d{2}|[Mm]{2})(?::(\d{2}|[Ss]{2}))?$/);
    if (!m)
        return { ok: false, text: 'Неверный формат маски (YYYY-MM-05T10:15:00)' };
    const [, yStr, moStr, dStr, hStr, minStr] = m;
    const y = /^[Yy]{4}$/.test(yStr) ? null : Number(yStr);
    const mo = /^[Mm]{2}$/.test(moStr) ? null : Number(moStr);
    const d = /^[Dd]{2}$/.test(dStr) ? null : Number(dStr);
    const hh = /^[Hh]{2}$/.test(hStr) ? null : Number(hStr);
    const mm = /^[Mm]{2}$/.test(minStr) ? null : Number(minStr);
    if (mo !== null && (mo < 1 || mo > 12)) return { ok: false, text: 'Месяц: 01–12 или MM' };
    if (d !== null && (d < 1 || d > 31)) return { ok: false, text: 'День: 01–31 или DD' };
    if (hh !== null && (hh < 0 || hh > 23)) return { ok: false, text: 'Час: 00–23 или HH' };
    if (mm !== null && (mm < 0 || mm > 59)) return { ok: false, text: 'Минуты: 00–59 или MM' };
    if (hh === null && mm === null) return { ok: false, text: 'Укажите час или минуты' };

    let dateDesc = '';
    if (y === null && mo === null && d === null) {
        dateDesc = Array.isArray(days) && days.length === 5 ? 'По будням (пн–пт)' : 'Каждый день';
    }
    else if (y === null && mo === null && d !== null) {
        dateDesc = `Каждый месяц ${d}-го числа`;
    }
    else if (y === null && mo !== null && d !== null) {
        dateDesc = `Каждый год ${String(d).padStart(2, '0')}.${String(mo).padStart(2, '0')}`;
    }
    else if (y !== null && mo !== null && d !== null) {
        dateDesc = `${String(d).padStart(2, '0')}.${String(mo).padStart(2, '0')}.${y}`;
    }
    else {
        dateDesc = src.split(/[T ]/)[0];
    }
    const timeDesc = hh === null
        ? `в :${String(mm).padStart(2, '0')} каждого часа`
        : `в ${String(hh).padStart(2, '0')}:${mm === null ? '00' : String(mm).padStart(2, '0')}`;
    return { ok: true, text: `${dateDesc} ${timeDesc}` };
}

function eventLabelOf(on) {
    const val = Array.isArray(on) ? on[0] : String(on || '');
    if (val === 'db:register') return 'При проведении документа';
    if (val === 'db:create') return 'При создании документа';
    if (val === 'db:update') return 'При изменении документа';
    if (val === 'save' || val === 'file:save') return 'При сохранении файла';
    if (val === 'chat:message') return 'При сообщении в чат';
    return val || 'Событие';
}

function slugRuleName(text) {
    const raw = String(text || '').trim().toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return raw || ('rule-' + Date.now().toString(36));
}

export default {
    imports: 'oda//icon, oda//button',
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                @apply --flex;
                padding: 14px 18px;
                gap: 14px;
                overflow-y: auto;
                background: var(--content-background);
                color: var(--content-color);
                font-size: 13px;
            }
            .card {
                @apply --vertical;
                gap: 10px;
                padding: 12px 14px;
                border: 1px solid var(--subtle-border, var(--border-color));
                border-radius: 10px;
                background: var(--subtle-background);
            }
            .card-head {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                font-weight: 700;
                font-size: 14px;
                flex-wrap: wrap;
            }
            .rule-item {
                @apply --vertical;
                gap: 8px;
                padding: 10px 12px;
                border-radius: 8px;
                border: 1px solid var(--subtle-border, var(--border-color));
                background: var(--content-background);
            }
            .rule-item.drop-hover {
                border-color: var(--accent-color, #2563eb);
                box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-color, #2563eb) 20%, transparent);
            }
            .row {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
            }
            .field-col {
                @apply --vertical;
                gap: 4px;
                flex: 1;
                min-width: 180px;
            }
            .field-label {
                font-size: 12px;
                font-weight: 600;
                color: var(--muted-color);
            }
            input[type="text"], input[type="number"], select, textarea {
                padding: 5px 8px;
                border: 1px solid var(--control-border-color, var(--border-color));
                border-radius: 6px;
                font: inherit;
                font-size: 13px;
                background: var(--content-background);
                color: var(--control-color, inherit);
                box-sizing: border-box;
            }
            textarea {
                width: 100%;
                min-height: 70px;
                resize: vertical;
            }
            .badge {
                font-size: 11px;
                padding: 2px 7px;
                border-radius: 8px;
                background: var(--accent-soft);
                color: var(--accent-color);
                font-weight: 600;
            }
            .badge.off {
                background: rgba(148, 163, 184, 0.2);
                color: var(--muted-color);
            }
            .preset-btn {
                border: 1px solid var(--subtle-border, var(--border-color));
                background: var(--content-background);
                color: var(--content-color);
                border-radius: 6px;
                padding: 3px 9px;
                font: inherit;
                font-size: 12px;
                cursor: pointer;
            }
            .preset-btn.active {
                border-color: var(--accent-color, #2563eb);
                background: var(--accent-soft);
                color: var(--accent-color, #2563eb);
                font-weight: 600;
            }
            .inherited-box {
                @apply --vertical;
                gap: 6px;
                padding: 8px 10px;
                border-radius: 6px;
                border: 1px dashed var(--subtle-border);
                background: var(--content-background);
                max-height: 180px;
                overflow-y: auto;
                font-size: 12.5px;
            }
            .inherited-layer {
                white-space: pre-wrap;
                line-height: 1.4;
                color: var(--muted-color);
            }
            .muted {
                color: var(--muted-color);
                font-size: 12px;
            }
        </style>

        <!-- 1. Инструкция агента подразделения -->
        <div class="card">
            <div class="card-head">
                <oda-icon icon="bootstrap:robot" icon-size="20"></oda-icon>
                <span>Инструкция агента</span>
                <div class="row" style="margin-left:auto;gap:12px;">
                    <label class="row" style="gap:5px;cursor:pointer;font-weight:400;font-size:12.5px;">
                        <input type="checkbox" :checked="proactivity.autoReply" @change="toggleProactivity('autoReply', $event.target.checked)">
                        <span>Автоответ в чат</span>
                    </label>
                    <label class="row" style="gap:5px;cursor:pointer;font-weight:400;font-size:12.5px;">
                        <input type="checkbox" :checked="proactivity.quietDigest" @change="toggleProactivity('quietDigest', $event.target.checked)">
                        <span>Тихая сводка руководителю</span>
                    </label>
                </div>
            </div>

            <div class="rule-item">
                <div class="row" style="justify-content:space-between;">
                    <span class="field-label">Системная инструкция для агента этого подразделения</span>
                    <div class="row">
                        <button type="button" class="preset-btn" ~class="{ active: !systemReplace }" @tap="systemReplace = false">Дополнять</button>
                        <button type="button" class="preset-btn" ~class="{ active: systemReplace }" @tap="systemReplace = true">Заменить</button>
                    </div>
                </div>
                <textarea placeholder="Роль и правила работы агента подразделения…" ::value="systemText" style="min-height:84px;"></textarea>
                <div class="row" style="justify-content:space-between;">
                    <button type="button" class="preset-btn" ~if="inheritedLayers.length" @tap="showInherited = !showInherited">
                        {{showInherited ? 'Скрыть унаследованную' : 'Унаследованная (' + inheritedLayers.length + ')'}}
                    </button>
                    <span ~if="!inheritedLayers.length"></span>
                    <div class="row">
                        <span ~if="systemStatus" class="muted">{{systemStatus}}</span>
                        <oda-button icon="icons:save" info-invert @tap="saveSystemPrompt()">Сохранить</oda-button>
                    </div>
                </div>
                <div ~if="showInherited && inheritedLayers.length" class="inherited-box">
                    <div ~for="inheritedLayers">
                        <div style="font-weight:600;">{{$for.item.scope}}</div>
                        <div class="inherited-layer">{{$for.item.text}}</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- 2. Автоматические реакции на события -->
        <div class="card">
            <div class="card-head">
                <oda-icon icon="icons:notifications-active" icon-size="20"></oda-icon>
                <span>Автоматические реакции ({{triggerCards.length}})</span>
                <div class="row" style="margin-left:auto;">
                    <oda-button icon="icons:add" @tap="openNewRule()">Добавить</oda-button>
                </div>
            </div>

            <div ~if="editing" class="rule-item" style="border-color:var(--accent-color);">
                <div class="row" style="justify-content:space-between;">
                    <span style="font-weight:700;">{{editingIsNew ? 'Новая реакция' : (form.label || form.name)}}</span>
                    <div ~if="editingIsNew" class="row">
                        <button type="button" class="preset-btn" @tap="applyRulePreset('big-doc')">Крупная сумма</button>
                        <button type="button" class="preset-btn" @tap="applyRulePreset('incoming-file')">Новый файл</button>
                        <button type="button" class="preset-btn" @tap="applyRulePreset('chat-msg')">Сообщение в чат</button>
                    </div>
                </div>

                <div class="row">
                    <div class="field-col">
                        <span class="field-label">Название</span>
                        <input type="text" placeholder="Например: Контроль крупных продаж" ::value="form.label">
                    </div>
                    <div class="field-col">
                        <span class="field-label">Событие</span>
                        <select ::value="form.on">
                            <option value="db:register">При проведении документа</option>
                            <option value="db:create">При создании документа</option>
                            <option value="db:update">При изменении документа</option>
                            <option value="save">При сохранении файла</option>
                            <option value="chat:message">При сообщении в чат</option>
                        </select>
                    </div>
                    <div class="field-col">
                        <span class="field-label">Кому сообщить</span>
                        <select ::value="form.notifyTarget">
                            <option value="BOSS">Руководителю (BOSS)</option>
                            <option value="CHAT">В общий чат</option>
                        </select>
                    </div>
                </div>

                <div class="row" ~if="form.on !== 'save' && form.on !== 'chat:message'">
                    <div class="field-col">
                        <span class="field-label">Класс документов</span>
                        <select ~if="flatClassOptions.length" ::value="form.class">
                            <option value="">Любой класс документов</option>
                            <option ~for="flatClassOptions" :value="$for.item.path">{{$for.item.title}}</option>
                        </select>
                        <input ~if="!flatClassOptions.length" type="text" placeholder="Путь класса (необязательно)" ::value="form.class">
                    </div>
                </div>

                <div class="row" ~if="form.on === 'save'">
                    <div class="field-col">
                        <span class="field-label">Расширения файлов</span>
                        <input type="text" placeholder="pdf, docx, eml" ::value="form.ext">
                    </div>
                </div>

                <div class="field-col">
                    <span class="field-label">Задание агенту</span>
                    <textarea placeholder="Что сделать при срабатывании события…" ::value="form.body"></textarea>
                </div>

                <div class="row" style="gap:14px;">
                    <label class="row" style="gap:5px;cursor:pointer;">
                        <input type="checkbox" :checked="form.approval" @change="form.approval = $event.target.checked">
                        <span>Карточка подтверждения (Да / Нет)</span>
                    </label>
                    <label class="row" style="gap:5px;cursor:pointer;">
                        <input type="checkbox" :checked="form.enabled" @change="form.enabled = $event.target.checked">
                        <span>Включена</span>
                    </label>
                    <button type="button" class="preset-btn" style="margin-left:auto;" @tap="showRuleAdvanced = !showRuleAdvanced">
                        {{showRuleAdvanced ? 'Скрыть детали' : 'Детали'}}
                    </button>
                </div>

                <div ~if="showRuleAdvanced" class="rule-item" style="background:var(--subtle-background);">
                    <div class="row">
                        <div class="field-col">
                            <span class="field-label">Имя файла</span>
                            <input type="text" placeholder="авто" :disabled="!editingIsNew" ::value="form.name">
                        </div>
                        <div class="field-col">
                            <span class="field-label">Условие (when)</span>
                            <input type="text" placeholder="sum > 100000" ::value="form.when">
                        </div>
                        <div class="field-col" style="max-width:140px;">
                            <span class="field-label">Пауза (сек)</span>
                            <input type="number" ::value="form.cooldownSec">
                        </div>
                    </div>
                    <div class="field-col">
                        <span class="field-label">Быстрый шаблон</span>
                        <input type="text" placeholder="Проведён документ на сумму {{sum}}" ::value="form.template">
                    </div>
                </div>

                <div class="row" style="justify-content:flex-end;">
                    <oda-button icon="icons:check" info-invert @tap="saveRule()">Сохранить</oda-button>
                    <oda-button icon="icons:close" @tap="editing = false">Отмена</oda-button>
                </div>
            </div>

            <div ~if="!triggerCards.length" class="muted">Реакций пока нет</div>

            <div class="rule-item" ~for="triggerCards">
                <div class="row">
                    <b>{{$for.item.label}}</b>
                    <span class="badge">{{$for.item.eventLabel}}</span>
                    <span class="badge">{{$for.item.notifyLabel}}</span>
                    <span ~if="$for.item.approval" class="badge">подтверждение</span>
                    <span class="badge" ~class="{ off: !$for.item.enabled }">{{$for.item.enabled ? 'вкл' : 'выкл'}}</span>
                    <div class="row" style="margin-left:auto;">
                        <oda-button icon="editor:mode-edit" @tap="editRule($for.item.raw)">Изменить</oda-button>
                        <oda-button ~if="$for.item.own" icon="icons:delete" @tap="deleteRule($for.item.name)"></oda-button>
                    </div>
                </div>
                <div ~if="$for.item.when" class="muted"><code>{{$for.item.when}}</code></div>
                <div ~if="$for.item.template || $for.item.body" class="muted">{{$for.item.template || $for.item.body}}</div>
            </div>
        </div>

        <!-- 3. Расписания -->
        <div class="card">
            <div class="card-head">
                <oda-icon icon="icons:schedule" icon-size="20"></oda-icon>
                <span>Расписания ({{schedules.length}})</span>
            </div>

            <div class="rule-item" ~class="{ 'drop-hover': schedDropHover }"
                @dragover="onSchedDragOver" @dragleave="schedDropHover = false" @drop="onSchedDrop">

                <div class="row">
                    <div class="field-col">
                        <span class="field-label">Название</span>
                        <input type="text" placeholder="Например: Ежемесячная сверка" ::value="schedLabel">
                    </div>
                    <div class="row" style="gap:6px;align-self:flex-end;">
                        <button type="button" class="preset-btn" ~class="{ active: schedTaskMode === 'prompt' }" @tap="schedTaskMode = 'prompt'">Поручение</button>
                        <button type="button" class="preset-btn" ~class="{ active: schedTaskMode === 'task' }" @tap="schedTaskMode = 'task'">Повторять задачу</button>
                    </div>
                </div>

                <div class="row">
                    <button type="button" class="preset-btn" ~class="{ active: schedMode === 'daily' }" @tap="applySchedPreset('daily')">Каждый день</button>
                    <button type="button" class="preset-btn" ~class="{ active: schedMode === 'workdays' }" @tap="applySchedPreset('workdays')">По будням</button>
                    <button type="button" class="preset-btn" ~class="{ active: schedMode === 'monthly' }" @tap="applySchedPreset('monthly')">Раз в месяц</button>
                    <button type="button" class="preset-btn" ~class="{ active: schedMode === 'once' }" @tap="applySchedPreset('once')">Один раз</button>
                    <button type="button" class="preset-btn" ~class="{ active: schedMode === 'every' }" @tap="applySchedPreset('every')">Каждые N мин</button>
                </div>

                <div class="row" ~if="schedMode !== 'every'">
                    <div class="field-col" style="max-width:250px;">
                        <input type="text" placeholder="YYYY-MM-05T10:15:00" ::value="schedMask" style="font-family:monospace;">
                    </div>
                    <div class="muted" ~style="{ color: maskPreview.ok ? 'var(--content-color)' : 'var(--error-color, #dc2626)' }">
                        {{maskPreview.text}}
                    </div>
                </div>

                <div class="row" ~if="schedMode === 'every'">
                    <input type="number" min="15" ::value="schedEvery" style="width:100px;">
                    <span class="muted">минут</span>
                </div>

                <div class="row" ~if="schedTaskMode === 'task'">
                    <select :value="schedTaskPath" @change="onSelectReadyTask($event.target.value)" style="flex:1;">
                        <option value="">Выберите выполненную задачу…</option>
                        <option ~for="recentTasks" :value="$for.item.path">{{$for.item.title}}</option>
                    </select>
                </div>

                <textarea
                    :placeholder="schedTaskMode === 'task' ? 'Дополнительное уточнение (необязательно)…' : 'Поручение агенту…'"
                    ::value="schedPrompt" style="min-height:52px;"></textarea>

                <div class="row" style="justify-content:flex-end;">
                    <oda-button icon="icons:add" info-invert @tap="addSchedule()">Добавить</oda-button>
                </div>
            </div>

            <div ~if="!schedules.length" class="muted">Расписаний пока нет</div>
            <div class="rule-item" ~for="schedules">
                <div class="row">
                    <b>{{$for.item.label}}</b>
                    <span class="badge">{{$for.item.when}}</span>
                    <span ~if="$for.item.rule?.mask" class="muted" style="font-family:monospace;">{{$for.item.rule.mask}}</span>
                    <span class="badge" ~class="{ off: !$for.item.enabled }">{{$for.item.enabled ? 'активно' : 'пауза'}}</span>
                    <div class="row" style="margin-left:auto;">
                        <oda-button @tap="toggleSched($for.item)">{{$for.item.enabled ? 'Пауза' : 'Включить'}}</oda-button>
                        <oda-button icon="icons:delete" @tap="deleteSched($for.item)"></oda-button>
                    </div>
                </div>
                <div class="muted">{{$for.item.prompt}}</div>
            </div>
        </div>

        <div ~if="error" style="color:var(--error-color, #dc2626);">{{error}}</div>
    `,
    $item: {
        $def: null,
        set(n) {
            if (n)
                this.reload();
        }
    },
    triggers: [],
    schedules: [],
    proactivity: { autoReply: true, quietDigest: true },
    systemText: '',
    systemReplace: false,
    systemStatus: '',
    inheritedLayers: [],
    showInherited: false,
    flatClassOptions: [],
    recentTasks: [],
    editing: false,
    editingIsNew: true,
    showRuleAdvanced: false,
    form: {},
    schedLabel: '',
    schedMode: 'monthly',
    schedMask: 'YYYY-MM-05T10:15:00',
    schedEvery: 60,
    schedTaskMode: 'prompt',
    schedTaskPath: '',
    schedPrompt: '',
    schedDropHover: false,
    error: '',
    async attached() {
        if (this.$item)
            await this.reload();
    },
    get maskPreview() {
        const days = this.schedMode === 'workdays' ? [1, 2, 3, 4, 5] : null;
        return describeClientMask(this.schedMask, days);
    },
    get triggerCards() {
        return (this.triggers || []).map(r => {
            const notifyArr = Array.isArray(r.notify) ? r.notify : [];
            const isChat = notifyArr.includes('CHAT') || notifyArr.includes('ALL');
            return {
                name: r.name,
                label: r.label || r.name,
                eventLabel: eventLabelOf(r.on),
                notifyLabel: isChat ? 'В общий чат' : 'Руководителю',
                approval: Boolean(r.approval),
                enabled: r.enabled !== false,
                when: r.when || '',
                template: r.template || '',
                body: r.body || '',
                own: Boolean(r.own),
                raw: r,
            };
        });
    },
    async reload() {
        this.error = '';
        if (!this.$item?.fetch)
            return;
        try {
            const [rulesRes, sysRes, clsRes, tasksRes] = await Promise.all([
                this.$item.fetch('agent_rules_list'),
                this.$item.fetch('agent_system_get').catch(() => null),
                this.$item.fetch('agent_available_classes').catch(() => null),
                this.$item.fetch('agent_tasks_list').catch(() => null),
            ]);
            this.triggers = Array.isArray(rulesRes?.triggers) ? rulesRes.triggers : [];
            this.schedules = Array.isArray(rulesRes?.schedules) ? rulesRes.schedules : [];
            if (rulesRes?.proactivity)
                this.proactivity = { ...this.proactivity, ...rulesRes.proactivity };
            if (sysRes) {
                this.systemText = String(sysRes.text || '');
                this.systemReplace = Boolean(sysRes.replace);
                this.inheritedLayers = Array.isArray(sysRes.inherited) ? sysRes.inherited : [];
            }
            const opts = [];
            const walkCls = (nodes) => {
                for (const n of Array.isArray(nodes) ? nodes : []) {
                    if (n?.selectable && n.path)
                        opts.push({ path: n.path, title: `${n.label} (${String(n.shortPath || n.path).replace(/\//g, ' → ')})` });
                    if (Array.isArray(n?.children))
                        walkCls(n.children);
                }
            };
            walkCls(clsRes?.roots || []);
            this.flatClassOptions = opts;
            this.recentTasks = Array.isArray(tasksRes?.tasks) ? tasksRes.tasks : [];
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async toggleProactivity(key, value) {
        if (!this.$item?.fetch)
            return;
        this.error = '';
        try {
            const res = await this.$item.fetch('agent_proactivity_save', {}, JSON.stringify({ [key]: Boolean(value) }));
            if (res?.proactivity)
                this.proactivity = { ...this.proactivity, ...res.proactivity };
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async saveSystemPrompt() {
        if (!this.$item?.fetch)
            return;
        this.error = '';
        this.systemStatus = 'Сохранение…';
        try {
            await this.$item.fetch('agent_system_save', {}, JSON.stringify({
                text: this.systemText,
                replace: Boolean(this.systemReplace),
            }));
            this.systemStatus = 'Сохранено';
        }
        catch (e) {
            this.systemStatus = '';
            this.error = String(e?.message || e);
        }
    },
    openNewRule() {
        this.editingIsNew = true;
        this.showRuleAdvanced = false;
        this.form = {
            name: '',
            label: '',
            on: 'db:register',
            class: '',
            ext: '',
            when: '',
            template: '',
            body: '',
            notifyTarget: 'BOSS',
            approval: false,
            cooldownSec: 60,
            maxPerHour: 20,
            enabled: true,
        };
        this.editing = true;
    },
    applyRulePreset(kind) {
        if (kind === 'big-doc') {
            this.form = {
                ...this.form,
                label: 'Контроль крупной суммы документа',
                on: 'db:register',
                when: 'sum > 100000',
                approval: true,
                notifyTarget: 'BOSS',
                body: 'Проверь проведённый документ с суммой свыше 100 000, оцени риски и предложи руководителю подтвердить или проверить контрагента.',
            };
        }
        else if (kind === 'incoming-file') {
            this.form = {
                ...this.form,
                label: 'Разбор нового входящего файла',
                on: 'save',
                ext: 'pdf, docx, eml',
                approval: false,
                notifyTarget: 'BOSS',
                body: 'Прочитай новый файл, кратко перескажи суть и укажи, требуется ли реакция сотрудника.',
            };
        }
        else if (kind === 'chat-msg') {
            this.form = {
                ...this.form,
                label: 'Внимание на важное сообщение',
                on: 'chat:message',
                when: "content != ''",
                approval: false,
                notifyTarget: 'BOSS',
                body: 'Оцени срочность входящего сообщения и подготовь краткий ответ по делу.',
            };
        }
    },
    editRule(r) {
        this.editingIsNew = false;
        this.showRuleAdvanced = Boolean(r.when || r.template);
        const notifyArr = Array.isArray(r.notify) ? r.notify : [];
        this.form = {
            name: r.name,
            label: r.label || r.name,
            on: Array.isArray(r.on) ? r.on[0] : (r.on || 'save'),
            class: r.class || '',
            ext: r.ext || '',
            when: r.when || '',
            template: r.template || '',
            body: r.body || '',
            notifyTarget: (notifyArr.includes('CHAT') || notifyArr.includes('ALL')) ? 'CHAT' : 'BOSS',
            approval: Boolean(r.approval),
            cooldownSec: Number(r.cooldownSec) || 0,
            maxPerHour: Number(r.maxPerHour) || 20,
            enabled: r.enabled !== false,
            as: r.as || 'BOSS',
        };
        this.editing = true;
    },
    async saveRule() {
        this.error = '';
        try {
            const label = String(this.form.label || '').trim();
            const name = String(this.form.name || '').trim() || slugRuleName(label);
            const payload = {
                ...this.form,
                name,
                label: label || name,
                as: 'BOSS',
                notify: [this.form.notifyTarget === 'CHAT' ? 'CHAT' : 'BOSS'],
            };
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
    applySchedPreset(mode) {
        this.schedMode = mode;
        if (mode === 'daily') this.schedMask = 'YYYY-MM-DDT09:00:00';
        else if (mode === 'workdays') this.schedMask = 'YYYY-MM-DDT09:00:00';
        else if (mode === 'monthly') this.schedMask = 'YYYY-MM-05T10:15:00';
        else if (mode === 'once') {
            const d = new Date(Date.now() + 86400_000);
            this.schedMask = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T10:00:00`;
        }
    },
    onSelectReadyTask(taskPath) {
        this.schedTaskPath = taskPath;
        const found = (this.recentTasks || []).find(t => t.path === taskPath);
        if (found) {
            if (!this.schedLabel)
                this.schedLabel = found.title;
            if (!this.schedPrompt)
                this.schedPrompt = found.prompt;
        }
    },
    onSchedDragOver(e) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        this.schedDropHover = true;
    },
    onSchedDrop(e) {
        this.schedDropHover = false;
        e.preventDefault();
        const dt = e.dataTransfer;
        if (!dt) return;
        const raw = dt.getData('data') || dt.getData('application/json') || dt.getData('text/plain');
        let p = '';
        let lbl = '';
        try {
            const parsed = JSON.parse(raw);
            p = parsed?.path || parsed?.short || '';
            lbl = parsed?.label || '';
        }
        catch {
            p = String(raw || '').trim();
        }
        if (p && p.endsWith('.task')) {
            this.schedTaskMode = 'task';
            this.schedTaskPath = p;
            if (!this.schedLabel)
                this.schedLabel = lbl || p.split('/').pop().replace(/\.task$/i, '');
        }
    },
    async addSchedule() {
        this.error = '';
        const prompt = String(this.schedPrompt || '').trim();
        const taskPath = this.schedTaskMode === 'task' ? String(this.schedTaskPath || '').trim() : '';
        if (!prompt && !taskPath) {
            this.error = 'Укажите поручение или выберите готовую задачу.';
            return;
        }
        const effectivePrompt = prompt || `Повтори задачу: ${this.schedLabel || taskPath.split('/').pop()}`;
        const rule = this.schedMode === 'every'
            ? { every: Math.max(15, Number(this.schedEvery) || 60) }
            : {
                mask: this.schedMask,
                ...(this.schedMode === 'workdays' ? { days: [1, 2, 3, 4, 5] } : {}),
            };
        try {
            await this.$item.fetch('agent_schedule_save', {}, JSON.stringify({
                label: this.schedLabel || effectivePrompt.slice(0, 60),
                prompt: effectivePrompt,
                task: taskPath,
                rule,
            }));
            this.schedLabel = '';
            this.schedPrompt = '';
            this.schedTaskPath = '';
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
