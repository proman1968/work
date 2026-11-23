/**
 * Визуальный BPMN 2.0 редактор и запускатель процессов (form/bpmn) для /MODULES/Process/Схемы процессов.
 */
const DEFAULT_DIAGRAM = () => ({
    nodes: [
        { id: 'n_start', kind: 'start', label: 'Старт', x: 70, y: 150, role: '', days: 0 },
        { id: 'n_task1', kind: 'task', label: 'Согласование заявки', x: 240, y: 150, role: 'Руководитель', days: 2 },
        { id: 'n_gw1', kind: 'gateway', label: 'Одобрено?', x: 440, y: 150, role: '', days: 0 },
        { id: 'n_task2', kind: 'task', label: 'Исполнение', x: 630, y: 150, role: 'Исполнитель', days: 3 },
        { id: 'n_end', kind: 'end', label: 'Завершение', x: 810, y: 150, role: '', days: 0 },
    ],
    edges: [
        { id: 'e1', from: 'n_start', to: 'n_task1', label: '' },
        { id: 'e2', from: 'n_task1', to: 'n_gw1', label: '' },
        { id: 'e3', from: 'n_gw1', to: 'n_task2', label: 'Да' },
        { id: 'e4', from: 'n_task2', to: 'n_end', label: '' },
    ],
});

function parseDiagram(raw) {
    if (!raw || typeof raw !== 'string')
        return DEFAULT_DIAGRAM();
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.nodes) && Array.isArray(parsed?.edges))
            return parsed;
    }
    catch { /* ignore */ }
    return DEFAULT_DIAGRAM();
}

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
            .main {
                @apply --horizontal;
                @apply --flex;
                min-height: 0;
                overflow: hidden;
            }
            .sidebar {
                width: 260px;
                flex-shrink: 0;
                border-right: 1px solid var(--subtle-border);
                @apply --vertical;
                overflow-y: auto;
                padding: 8px;
                gap: 6px;
            }
            .proc-item {
                padding: 8px 10px;
                border-radius: 8px;
                border: 1px solid transparent;
                cursor: pointer;
            }
            .proc-item:hover { background: var(--subtle-background); }
            .proc-item.active {
                border-color: var(--accent-color, #1d63dc);
                background: var(--accent-soft, rgba(29,99,220,0.1));
            }
            .canvas-wrap {
                @apply --flex;
                position: relative;
                overflow: auto;
                background: radial-gradient(circle, rgba(148,163,184,0.22) 1px, transparent 1px);
                background-size: 20px 20px;
            }
            svg.bpmn-svg {
                width: 100%;
                height: 100%;
                min-width: 960px;
                min-height: 460px;
                user-select: none;
            }
            .node-group { cursor: move; }
            .prop-panel {
                width: 250px;
                flex-shrink: 0;
                border-left: 1px solid var(--subtle-border);
                padding: 12px;
                display: flex;
                flex-direction: column;
                gap: 10px;
                background: var(--subtle-background);
            }
            .prop-panel input, .prop-panel select {
                width: 100%;
                box-sizing: border-box;
                padding: 5px 8px;
                border: 1px solid var(--control-border-color);
                border-radius: 6px;
                background: var(--control-background);
                color: var(--control-color);
                font: inherit;
            }
            .status-msg { font-size: 12.5px; color: #15803d; font-weight: 600; }
        </style>

        <div class="toolbar">
            <select :value="selectedProcId" @change="selectProcess($event.target.value)" style="padding:5px 8px;border-radius:6px;border:1px solid var(--control-border-color);background:var(--control-background);color:var(--control-color);">
                <option ~for="processes" :value="$for.item.id">{{$for.item.title || $for.item.id}}</option>
            </select>
            <oda-button icon="icons:add" @tap="addNode('task')">+ Задача</oda-button>
            <oda-button icon="icons:call-split" @tap="addNode('gateway')">+ Шлюз</oda-button>
            <oda-button icon="icons:play-arrow" @tap="addNode('start')">+ Старт</oda-button>
            <oda-button icon="icons:stop" @tap="addNode('end')">+ Финал</oda-button>
            <oda-button icon="icons:trending-flat" :light="Boolean(connectFromId)" @tap="toggleConnectMode()">
                {{connectFromId ? 'Выберите целевой узел…' : 'Связать узлы'}}
            </oda-button>
            <div class="horizontal" style="margin-left:auto;gap:8px;align-items:center;">
                <span ~if="statusMsg" class="status-msg">{{statusMsg}}</span>
                <oda-button icon="icons:play-circle-filled" @tap="launchProcess()">Запустить процесс</oda-button>
                <oda-button icon="icons:save" :disabled="!changed || busy" @tap="save()">Сохранить схему</oda-button>
            </div>
        </div>

        <div class="main">
            <div class="sidebar">
                <div style="font-weight:700;padding:4px 6px;">Процессы ({{processes.length}})</div>
                <div ~for="processes" class="proc-item" ~class="{active: selectedProcId === $for.item.id}" @tap="selectProcess($for.item.id)">
                    <div style="font-weight:600;">{{$for.item.title || $for.item.id}}</div>
                    <div style="font-size:11.5px;color:var(--muted-color);">{{$for.item.body?.status || 'Черновик'}} · {{$for.item.body?.owner_role || 'без роли'}}</div>
                </div>
                <oda-button icon="icons:add" @tap="createProcess()">+ Новый процесс</oda-button>
            </div>

            <div class="canvas-wrap">
                <svg class="bpmn-svg" @pointermove="onSvgMove" @pointerup="onSvgUp">
                    <defs>
                        <marker id="bpmnArrow" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                            <polygon points="0 0, 10 3.5, 0 7" fill="#475569"></polygon>
                        </marker>
                    </defs>

                    <g ~for="renderedEdges">
                        <line :x1="$for.item.x1" :y1="$for.item.y1" :x2="$for.item.x2" :y2="$for.item.y2"
                            stroke="#475569" stroke-width="2" marker-end="url(#bpmnArrow)" style="cursor:pointer;"
                            @dblclick="removeEdge($for.item.id)"></line>
                        <text ~if="$for.item.label" :x="$for.item.mx" :y="$for.item.my - 6" text-anchor="middle" fill="#1e293b" font-size="11" font-weight="600">{{$for.item.label}}</text>
                    </g>

                    <g ~for="diagram.nodes" class="node-group"
                        @pointerdown="onNodeDown($event, $for.item)" @tap.stop="onNodeTap($for.item)">
                        <circle ~if="$for.item.kind === 'start'" :cx="$for.item.x" :cy="$for.item.y" r="22"
                            fill="#dcfce7" :stroke="selectedNodeId === $for.item.id ? '#1d63dc' : '#16a34a'" stroke-width="3"></circle>
                        <circle ~if="$for.item.kind === 'end'" :cx="$for.item.x" :cy="$for.item.y" r="22"
                            fill="#fee2e2" :stroke="selectedNodeId === $for.item.id ? '#1d63dc' : '#dc2626'" stroke-width="5"></circle>
                        <polygon ~if="$for.item.kind === 'gateway'"
                            :points="($for.item.x) + ',' + ($for.item.y - 26) + ' ' + ($for.item.x + 26) + ',' + ($for.item.y) + ' ' + ($for.item.x) + ',' + ($for.item.y + 26) + ' ' + ($for.item.x - 26) + ',' + ($for.item.y)"
                            fill="#fef3c7" :stroke="selectedNodeId === $for.item.id ? '#1d63dc' : '#d97706'" stroke-width="2.5"></polygon>
                        <rect ~if="$for.item.kind === 'task'"
                            :x="$for.item.x - 72" :y="$for.item.y - 30" width="144" height="60" rx="10"
                            fill="#eff6ff" :stroke="selectedNodeId === $for.item.id ? '#1d63dc' : '#3b82f6'" stroke-width="2.5"></rect>

                        <text :x="$for.item.x" :y="$for.item.kind === 'task' ? $for.item.y - 4 : $for.item.y + 42"
                            text-anchor="middle" fill="#0f172a" font-size="12" font-weight="600">{{$for.item.label}}</text>
                        <text ~if="$for.item.kind === 'task' && ($for.item.role || $for.item.days)"
                            :x="$for.item.x" :y="$for.item.y + 15" text-anchor="middle" fill="#475569" font-size="10.5">
                            {{$for.item.role || 'Исполнитель'}} · {{$for.item.days || 1}} дн.
                        </text>
                    </g>
                </svg>
            </div>

            <div class="prop-panel" ~if="selectedNode">
                <div style="font-weight:700;">Свойства узла</div>
                <label>Название
                    <input type="text" :value="selectedNode.label" @input="updateSelectedNode('label', $event.target.value)">
                </label>
                <label ~if="selectedNode.kind === 'task'">Роль / Исполнитель
                    <input type="text" :value="selectedNode.role || ''" @input="updateSelectedNode('role', $event.target.value)">
                </label>
                <label ~if="selectedNode.kind === 'task'">Длительность (дней)
                    <input type="number" min="1" :value="selectedNode.days || 1" @input="updateSelectedNode('days', Number($event.target.value) || 1)">
                </label>
                <oda-button icon="icons:delete" @tap="removeSelectedNode()">Удалить узел</oda-button>
            </div>
        </div>
    `,
    processes: [],
    selectedProcId: '',
    diagram: DEFAULT_DIAGRAM(),
    selectedNodeId: '',
    connectFromId: '',
    changed: false,
    busy: false,
    statusMsg: '',
    _drag: null,
    get isViewChanged() {
        return Boolean(this.changed);
    },
    get selectedProc() {
        return (this.processes || []).find(p => p.id === this.selectedProcId) || null;
    },
    get selectedNode() {
        return (this.diagram?.nodes || []).find(n => n.id === this.selectedNodeId) || null;
    },
    get renderedEdges() {
        const byId = new Map((this.diagram?.nodes || []).map(n => [n.id, n]));
        const out = [];
        for (const e of this.diagram?.edges || []) {
            const a = byId.get(e.from);
            const b = byId.get(e.to);
            if (!a || !b)
                continue;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 1;
            const padA = a.kind === 'task' ? 72 : 24;
            const padB = b.kind === 'task' ? 72 : 26;
            const x1 = Math.round(a.x + (dx / len) * Math.min(padA, len / 2));
            const y1 = Math.round(a.y + (dy / len) * Math.min(padA, len / 2));
            const x2 = Math.round(b.x - (dx / len) * Math.min(padB, len / 2));
            const y2 = Math.round(b.y - (dy / len) * Math.min(padB, len / 2));
            out.push({ id: e.id, x1, y1, x2, y2, mx: Math.round((x1 + x2) / 2), my: Math.round((y1 + y2) / 2), label: e.label || '' });
        }
        return out;
    },
    attached() {
        this.reload();
    },
    async reload() {
        if (!this.$item?.fetch)
            return;
        const res = await this.$item.fetch('db_query', { limit: 200 }).catch(() => null);
        this.processes = Array.isArray(res?.items) ? res.items : [];
        if (this.processes.length && !this.selectedProc) {
            this.selectProcess(this.processes[0].id);
        }
        else if (this.selectedProc) {
            this.diagram = parseDiagram(this.selectedProc.body?.bpmn_xml);
        }
    },
    selectProcess(id) {
        this.selectedProcId = id;
        const proc = this.selectedProc;
        this.diagram = parseDiagram(proc?.body?.bpmn_xml);
        this.selectedNodeId = '';
        this.connectFromId = '';
        this.changed = false;
        this.statusMsg = '';
    },
    async createProcess() {
        const name = window.prompt?.('Название нового бизнес-процесса:', 'Новый процесс');
        if (!name || !name.trim())
            return;
        const created = await this.$item.fetch('db_create', {}, {
            body: { name: name.trim(), status: 'Черновик', bpmn_xml: JSON.stringify(DEFAULT_DIAGRAM()) },
        });
        await this.reload();
        if (created?.id)
            this.selectProcess(created.id);
    },
    addNode(kind) {
        const idx = (this.diagram.nodes || []).length + 1;
        const labels = { start: 'Старт', end: 'Финал', gateway: 'Условие', task: `Шаг ${idx}` };
        const id = `n_${Date.now().toString(36)}_${idx}`;
        const node = { id, kind, label: labels[kind] || 'Узел', x: 140 + (idx * 65) % 620, y: 120 + (idx * 45) % 220, role: 'Исполнитель', days: 1 };
        this.diagram = { ...this.diagram, nodes: [...this.diagram.nodes, node] };
        this.selectedNodeId = id;
        this.changed = true;
    },
    toggleConnectMode() {
        this.connectFromId = this.connectFromId ? '' : (this.selectedNodeId || '__pick__');
    },
    onNodeTap(node) {
        if (!node)
            return;
        if (this.connectFromId) {
            if (this.connectFromId === '__pick__') {
                this.connectFromId = node.id;
                return;
            }
            if (this.connectFromId !== node.id) {
                const exists = (this.diagram.edges || []).some(e => e.from === this.connectFromId && e.to === node.id);
                if (!exists) {
                    const edge = { id: 'e_' + Date.now().toString(36), from: this.connectFromId, to: node.id, label: '' };
                    this.diagram = { ...this.diagram, edges: [...this.diagram.edges, edge] };
                    this.changed = true;
                }
            }
            this.connectFromId = '';
            return;
        }
        this.selectedNodeId = node.id;
    },
    onNodeDown(e, node) {
        this.selectedNodeId = node.id;
        this._drag = { id: node.id, startX: e.clientX, startY: e.clientY, ox: node.x, oy: node.y };
    },
    onSvgMove(e) {
        if (!this._drag)
            return;
        const nx = Math.max(40, Math.round(this._drag.ox + (e.clientX - this._drag.startX)));
        const ny = Math.max(40, Math.round(this._drag.oy + (e.clientY - this._drag.startY)));
        this.diagram = {
            ...this.diagram,
            nodes: this.diagram.nodes.map(n => n.id === this._drag.id ? { ...n, x: nx, y: ny } : n),
        };
        this.changed = true;
    },
    onSvgUp() {
        this._drag = null;
    },
    updateSelectedNode(key, val) {
        if (!this.selectedNodeId)
            return;
        this.diagram = {
            ...this.diagram,
            nodes: this.diagram.nodes.map(n => n.id === this.selectedNodeId ? { ...n, [key]: val } : n),
        };
        this.changed = true;
    },
    removeSelectedNode() {
        if (!this.selectedNodeId)
            return;
        const id = this.selectedNodeId;
        this.diagram = {
            nodes: this.diagram.nodes.filter(n => n.id !== id),
            edges: this.diagram.edges.filter(e => e.from !== id && e.to !== id),
        };
        this.selectedNodeId = '';
        this.changed = true;
    },
    removeEdge(edgeId) {
        this.diagram = { ...this.diagram, edges: this.diagram.edges.filter(e => e.id !== edgeId) };
        this.changed = true;
    },
    async save() {
        const proc = this.selectedProc;
        if (!proc || this.busy)
            return;
        this.busy = true;
        try {
            const nextBody = { ...(proc.body || {}), bpmn_xml: JSON.stringify(this.diagram) };
            await this.$item.fetch('db_update', {}, { id: proc.id, version: proc.version, body: nextBody });
            this.changed = false;
            this.statusMsg = '✓ Схема сохранена';
            await this.reload();
        }
        finally {
            this.busy = false;
        }
    },
    async launchProcess() {
        const proc = this.selectedProc;
        if (!proc)
            return;
        const tasksPath = String(this.$item?.short || '').replace(/\/Схемы процессов.*$/, '/Задачи и этапы');
        const tasksItem = await WORK.get_item(tasksPath).catch(() => null);
        if (!tasksItem?.fetch) {
            this.statusMsg = 'Класс «Задачи и этапы» не найден рядом со схемами';
            return;
        }
        const taskNodes = (this.diagram?.nodes || []).filter(n => n.kind === 'task');
        if (!taskNodes.length)
            return;
        let curDay = new Date();
        let prevTaskId = '';
        let createdCount = 0;
        for (const tn of taskNodes) {
            const startStr = curDay.toISOString().slice(0, 10);
            const durDays = Math.max(1, Number(tn.days) || 1);
            const endDay = new Date(curDay.getTime() + durDays * 86400_000);
            const dueStr = endDay.toISOString().slice(0, 10);
            const created = await tasksItem.fetch('db_create', {}, {
                body: {
                    name: `${proc.title}: ${tn.label}`,
                    process_ref: proc.id,
                    ...(prevTaskId ? { depends_on: prevTaskId } : {}),
                    start_at: startStr,
                    due_at: dueStr,
                    duration_hours: durDays * 8,
                    progress: 0,
                    assignee: tn.role || '',
                    status: 'К выполнению',
                    priority: 'Обычный',
                },
            });
            if (created?.id) {
                prevTaskId = created.id;
                createdCount++;
            }
            curDay = endDay;
        }
        this.statusMsg = `✓ Процесс запущен: создано этапов — ${createdCount}`;
    },
};
