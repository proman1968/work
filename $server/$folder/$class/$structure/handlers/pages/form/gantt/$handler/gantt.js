/**
 * Единое представление «Диаграмма Ганта» (form/gantt): временная шкала задач и этапов,
 * отображение длительности, прогресса выполнения, зависимостей (depends_on) и сдвига сроков.
 */
function parseIsoDay(s) {
    if (!s)
        return null;
    const t = Date.parse(String(s).slice(0, 10) + 'T00:00:00Z');
    return Number.isFinite(t) ? t : null;
}

function fmtIsoDay(ms) {
    return new Date(ms).toISOString().slice(0, 10);
}

const DAY_MS = 86400_000;

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
                font-size: 12.5px;
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
            .gantt-wrap {
                @apply --flex;
                overflow: auto;
                position: relative;
            }
            .gantt-grid {
                display: flex;
                flex-direction: column;
                min-width: max-content;
            }
            .gantt-head, .gantt-row {
                display: flex;
                align-items: center;
                border-bottom: 1px solid var(--subtle-border);
            }
            .gantt-head {
                position: sticky;
                top: 0;
                z-index: 3;
                background: var(--subtle-background);
                font-weight: 700;
            }
            .left-col {
                width: 280px;
                flex-shrink: 0;
                padding: 6px 10px;
                border-right: 1px solid var(--subtle-border);
                position: sticky;
                left: 0;
                background: var(--content-background);
                z-index: 2;
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 6px;
            }
            .gantt-head .left-col {
                background: var(--subtle-background);
                z-index: 4;
            }
            .timeline {
                position: relative;
                display: flex;
                height: 32px;
            }
            .day-cell {
                width: {{dayWidth}}px;
                flex-shrink: 0;
                border-right: 1px dashed rgba(148,163,184,0.28);
                text-align: center;
                line-height: 32px;
                font-size: 11px;
                color: var(--muted-color);
            }
            .day-cell.weekend {
                background: rgba(148,163,184,0.08);
            }
            .bar {
                position: absolute;
                top: 5px;
                height: 22px;
                border-radius: 6px;
                background: rgba(29, 99, 220, 0.25);
                border: 1px solid #1d63dc;
                overflow: hidden;
                cursor: pointer;
                display: flex;
                align-items: center;
            }
            .bar.done {
                background: rgba(16, 185, 129, 0.28);
                border-color: #10b981;
            }
            .bar-fill {
                height: 100%;
                background: rgba(29, 99, 220, 0.72);
            }
            .bar.done .bar-fill {
                background: rgba(16, 185, 129, 0.8);
            }
            .bar-lbl {
                position: relative;
                z-index: 1;
                padding: 0 6px;
                font-size: 11px;
                font-weight: 600;
                white-space: nowrap;
                color: var(--content-color);
            }
            .shift-btns {
                display: flex;
                gap: 2px;
            }
            .shift-btn {
                border: 1px solid var(--subtle-border);
                background: var(--subtle-background);
                color: var(--content-color);
                border-radius: 4px;
                cursor: pointer;
                font-size: 11px;
                padding: 1px 5px;
            }
        </style>

        <div class="toolbar">
            <b>Диаграмма Ганта ({{bars.length}})</b>
            <oda-button icon="icons:zoom-in" @tap="dayWidth = Math.min(48, dayWidth + 6)">Крупнее</oda-button>
            <oda-button icon="icons:zoom-out" @tap="dayWidth = Math.max(18, dayWidth - 6)">Мельче</oda-button>
            <oda-button icon="icons:refresh" @tap="reload()">Обновить</oda-button>
            <span style="margin-left:auto;color:var(--muted-color);">Период: {{minDayStr}} — {{maxDayStr}}</span>
        </div>

        <div class="gantt-wrap">
            <div class="gantt-grid">
                <div class="gantt-head">
                    <div class="left-col">Задача / Этап</div>
                    <div class="timeline">
                        <div ~for="days" class="day-cell" ~class="{weekend: $for.item.weekend}">{{$for.item.label}}</div>
                    </div>
                </div>

                <div ~if="!bars.length" style="padding:20px;color:var(--muted-color);">
                    Нет задач с датами. Создайте этапы в «Планировщике» или запустите BPMN-процесс.
                </div>

                <div class="gantt-row" ~for="bars">
                    <div class="left-col">
                        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;" @tap="openTask($for.item)">{{$for.item.title}}</span>
                        <div class="shift-btns">
                            <button class="shift-btn" title="Сдвинуть на −1 день" @tap="shiftBar($for.item, -1)">◀</button>
                            <button class="shift-btn" title="Сдвинуть на +1 день" @tap="shiftBar($for.item, 1)">▶</button>
                        </div>
                    </div>
                    <div class="timeline" :style="'width:' + (days.length * dayWidth) + 'px;'">
                        <div ~for="days" class="day-cell" ~class="{weekend: $for.$for.item.weekend}"></div>
                        <div class="bar" ~class="{done: $for.item.status === 'Выполнено'}"
                            :style="'left:' + $for.item.leftPx + 'px;width:' + $for.item.widthPx + 'px;'"
                            :title="$for.item.startStr + ' → ' + $for.item.dueStr + ' (' + $for.item.progress + '%)'"
                            @tap="openTask($for.item)">
                            <div class="bar-fill" :style="'width:' + $for.item.progress + '%'"></div>
                            <span class="bar-lbl">{{$for.item.progress}}%</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `,
    items: [],
    tasksTarget: null,
    dayWidth: 28,
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
    get range() {
        const todayMs = parseIsoDay(new Date().toISOString().slice(0, 10));
        let minMs = todayMs - 2 * DAY_MS;
        let maxMs = todayMs + 14 * DAY_MS;
        for (const it of this.items || []) {
            const s = parseIsoDay(it.start_at);
            const e = parseIsoDay(it.due_at);
            if (s && s < minMs)
                minMs = s - DAY_MS;
            if (e && e > maxMs)
                maxMs = e + 2 * DAY_MS;
        }
        return { minMs, maxMs };
    },
    get minDayStr() {
        return fmtIsoDay(this.range.minMs);
    },
    get maxDayStr() {
        return fmtIsoDay(this.range.maxMs);
    },
    get days() {
        const { minMs, maxMs } = this.range;
        const out = [];
        for (let t = minMs; t <= maxMs && out.length < 180; t += DAY_MS) {
            const d = new Date(t);
            const dow = d.getUTCDay();
            out.push({
                ms: t,
                label: `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
                weekend: dow === 0 || dow === 6,
            });
        }
        return out;
    },
    get bars() {
        const { minMs } = this.range;
        return (this.items || []).map(it => {
            const s = parseIsoDay(it.start_at) || parseIsoDay(it.due_at) || minMs;
            const e = Math.max(s, parseIsoDay(it.due_at) || s);
            const leftDays = Math.max(0, Math.round((s - minMs) / DAY_MS));
            const spanDays = Math.max(1, Math.round((e - s) / DAY_MS) + 1);
            return {
                ...it,
                startMs: s,
                dueMs: e,
                startStr: fmtIsoDay(s),
                dueStr: fmtIsoDay(e),
                leftPx: leftDays * this.dayWidth + 2,
                widthPx: Math.max(18, spanDays * this.dayWidth - 4),
            };
        });
    },
    async reload() {
        const target = await this._resolveTarget();
        this.tasksTarget = target;
        if (!target?.fetch) {
            this.items = [];
            return;
        }
        const res = await target.fetch('db_query', { limit: 300 }).catch(() => null);
        this.items = (res?.items || []).map(o => ({
            id: o.id,
            version: o.version,
            title: o.title || o.id,
            start_at: o.body?.start_at || new Date().toISOString().slice(0, 10),
            due_at: o.body?.due_at || o.body?.start_at || new Date().toISOString().slice(0, 10),
            progress: Number(o.body?.progress) || 0,
            status: o.body?.status || 'К выполнению',
            body: o.body || {},
        }));
    },
    async shiftBar(bar, deltaDays) {
        if (!bar?.id || !this.tasksTarget?.fetch)
            return;
        const nextStart = fmtIsoDay(bar.startMs + deltaDays * DAY_MS);
        const nextDue = fmtIsoDay(bar.dueMs + deltaDays * DAY_MS);
        await this.tasksTarget.fetch('db_update', {}, {
            id: bar.id,
            version: bar.version,
            body: { ...bar.body, start_at: nextStart, due_at: nextDue },
        });
        await this.reload();
    },
    openTask(bar) {
        if (!bar?.id || !this.tasksTarget)
            return;
        window.execute?.(this.tasksTarget, { view: 'object', id: bar.id });
    },
};
