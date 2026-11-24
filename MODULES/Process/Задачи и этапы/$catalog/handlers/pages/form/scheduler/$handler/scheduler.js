/**
 * Единое представление «Планировщик» (form/scheduler): канбан-доска по статусам и недельный план,
 * работает на классе Задачи и этапы (/MODULES/Process), в $project, $base, $structure и соло в корне WORK.
 */
const STATUSES = ['К выполнению', 'В работе', 'На проверке', 'Выполнено'];

export default {
    imports: 'oda//button, oda//icon',
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                @apply --flex;
                overflow: hidden;
                background: var(--content-background);
                color: var(--content-color);
                font-size: 13px;
            }
            .toolbar {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                padding: 8px 12px;
                border-bottom: 1px solid var(--subtle-border);
                background: var(--subtle-background);
                flex-wrap: wrap;
            }
            .toolbar input, .toolbar select {
                padding: 5px 8px;
                border: 1px solid var(--control-border-color);
                border-radius: 6px;
                background: var(--control-background);
                color: var(--control-color);
                font: inherit;
            }
            .board {
                @apply --flex;
                display: grid;
                grid-template-columns: repeat(4, minmax(220px, 1fr));
                gap: 10px;
                padding: 12px;
                overflow: auto;
            }
            .col {
                background: var(--subtle-background);
                border: 1px solid var(--subtle-border);
                border-radius: 10px;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                min-height: 220px;
            }
            .col-head {
                padding: 8px 10px;
                font-weight: 700;
                border-bottom: 1px solid var(--subtle-border);
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .col-body {
                padding: 8px;
                display: flex;
                flex-direction: column;
                gap: 8px;
                overflow-y: auto;
                flex: 1;
            }
            .task-card {
                background: var(--content-background);
                border: 1px solid var(--subtle-border);
                border-radius: 8px;
                padding: 8px 10px;
                display: flex;
                flex-direction: column;
                gap: 5px;
                box-shadow: 0 1px 3px rgba(0,0,0,0.06);
            }
            .task-title {
                font-weight: 600;
                cursor: pointer;
            }
            .task-title:hover {
                color: var(--accent-color, #1d63dc);
            }
            .task-meta {
                font-size: 11.5px;
                color: var(--muted-color);
                display: flex;
                justify-content: space-between;
                gap: 6px;
                flex-wrap: wrap;
            }
            .prog-bar {
                height: 5px;
                border-radius: 4px;
                background: rgba(148,163,184,0.28);
                overflow: hidden;
            }
            .prog-fill {
                height: 100%;
                background: var(--accent-color, #1d63dc);
            }
        </style>

        <div class="toolbar">
            <input type="text" placeholder="Новая задача / этап…" ::value="newTitle" style="min-width:220px;flex:1;">
            <input type="date" ::value="newStart" title="Начало">
            <input type="date" ::value="newDue" title="Срок">
            <input type="text" placeholder="Исполнитель" ::value="newAssignee" style="width:140px;">
            <oda-button icon="icons:add" :disabled="!newTitle.trim() || !tasksTarget" @tap="addTask()">Добавить</oda-button>
            <oda-button icon="icons:refresh" @tap="reload()">Обновить</oda-button>
        </div>

        <div ~if="!tasksTarget" style="padding:14px;color:var(--muted-color);">
            Модуль «Процессы» не подключён в этом разделе — отображаются локальные задачи <code>.task</code> (если есть).
        </div>

        <div class="board">
            <div class="col" ~for="columns">
                <div class="col-head">
                    <span>{{$for.item.status}}</span>
                    <span>{{$for.item.cards.length}}</span>
                </div>
                <div class="col-body">
                    <div class="task-card" ~for="$for.item.cards">
                        <div class="task-title" @tap="openTask($for.$for.item)">{{$for.$for.item.title}}</div>
                        <div class="task-meta">
                            <span>{{$for.$for.item.assignee || 'Без исполнителя'}}</span>
                            <span>{{$for.$for.item.start_at || '—'}} → {{$for.$for.item.due_at || '—'}}</span>
                        </div>
                        <div class="prog-bar"><div class="prog-fill" :style="'width:' + ($for.$for.item.progress || 0) + '%'"></div></div>
                        <div ~if="$for.$for.item.editable" class="task-meta" style="align-items:center;">
                            <select :value="$for.$for.item.status" @change="changeStatus($for.$for.item, $event.target.value)" style="font-size:11.5px;padding:2px 4px;">
                                <option ~for="statusOptions" :value="$for.$for.$for.item">{{$for.$for.$for.item}}</option>
                            </select>
                            <span>{{$for.$for.item.progress || 0}}%</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `,
    items: [],
    tasksTarget: null,
    newTitle: '',
    newStart: new Date().toISOString().slice(0, 10),
    newDue: new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10),
    newAssignee: '',
    get statusOptions() {
        return STATUSES;
    },
    get columns() {
        return STATUSES.map(st => ({
            status: st,
            cards: (this.items || []).filter(x => (x.status || 'К выполнению') === st),
        }));
    },
    attached() {
        this.reload();
    },
    async _resolveTarget() {
        const p = String(this.$item?.short || this.$item?.path || '');
        if (p.includes('/Process/Задачи и этапы') && this.$item?.fetch)
            return this.$item;
        const m = /^(\/(?:ORGANIZATIONS|PROJECTS)\/[^/]+)/.exec(p);
        if (m) {
            const candidate = await WORK.get_item(`${m[1]}/MODULES/Process/Задачи и этапы`).catch(() => null);
            if (candidate?.fetch)
                return candidate;
        }
        const rootCandidate = await WORK.get_item('/MODULES/Process/Задачи и этапы').catch(() => null);
        return rootCandidate?.fetch ? rootCandidate : null;
    },
    async reload() {
        const target = await this._resolveTarget();
        this.tasksTarget = target;
        const list = [];
        if (target?.fetch) {
            try {
                const res = await target.fetch('db_query', { limit: 300 });
                for (const o of res?.items || []) {
                    list.push({
                        id: o.id,
                        version: o.version,
                        title: o.title || o.id,
                        status: o.body?.status || 'К выполнению',
                        start_at: o.body?.start_at || '',
                        due_at: o.body?.due_at || '',
                        progress: Number(o.body?.progress) || 0,
                        assignee: o.body?.assignee || '',
                        body: o.body || {},
                        editable: true,
                    });
                }
            }
            catch { /* ignore */ }
        }
        this.items = list;
    },
    async addTask() {
        const title = this.newTitle.trim();
        if (!title || !this.tasksTarget?.fetch)
            return;
        await this.tasksTarget.fetch('db_create', {}, {
            body: {
                name: title,
                start_at: this.newStart,
                due_at: this.newDue,
                assignee: this.newAssignee.trim(),
                status: 'К выполнению',
                progress: 0,
            },
        });
        this.newTitle = '';
        await this.reload();
    },
    async changeStatus(card, nextStatus) {
        if (!card?.editable || !this.tasksTarget?.fetch)
            return;
        const progress = nextStatus === 'Выполнено' ? 100 : (nextStatus === 'В работе' && !card.progress ? 25 : card.progress);
        await this.tasksTarget.fetch('db_update', {}, {
            id: card.id,
            version: card.version,
            body: { ...card.body, status: nextStatus, progress },
        });
        await this.reload();
    },
    openTask(card) {
        if (!card?.id || !this.tasksTarget)
            return;
        window.execute?.(this.tasksTarget, { view: 'object', id: card.id });
    },
};
