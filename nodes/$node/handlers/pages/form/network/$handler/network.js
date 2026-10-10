/**
 * Граф сети WORK: наш сервер в центре, узлы реестра — первый круг, их объявленные соседи — дальше.
 * Данные — network_graph() реестра /NODES.
 */
const COLORS = { self: '#3f51b5', active: '#2e7d32', remote: '#78909c', pending: '#f9a825', key_changed: '#c62828', id_changed: '#c62828' };

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function layout(graph, size) {
    const c = size / 2;
    const byLevel = new Map();
    for (const n of graph.nodes)
        (byLevel.get(n.level) || byLevel.set(n.level, []).get(n.level)).push(n);
    const pos = new Map();
    for (const [level, list] of byLevel) {
        const r = level === 0 ? 0 : level * size * 0.18;
        list.forEach((n, i) => {
            const a = (2 * Math.PI * i) / list.length - Math.PI / 2 + level * 0.3;
            pos.set(n.id, { x: c + r * Math.cos(a), y: c + r * Math.sin(a) });
        });
    }
    return pos;
}

function render(graph) {
    if (!graph?.nodes?.length)
        return '<div class="empty">Реестр узлов пуст</div>';
    const levels = Math.max(...graph.nodes.map(n => n.level || 0));
    const size = Math.max(420, 260 + levels * 240);
    const pos = layout(graph, size);
    const lines = graph.edges.map(e => {
        const a = pos.get(e.from), b = pos.get(e.to);
        return a && b ? `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#90a4ae" stroke-width="1.5"/>` : '';
    }).join('');
    const nodes = graph.nodes.map(n => {
        const p = pos.get(n.id);
        const color = COLORS[n.status] || COLORS.remote;
        const r = n.self ? 22 : n.known ? 16 : 11;
        const title = [n.label, n.origin, 'id ' + n.id, n.status, n.error].filter(Boolean).map(esc).join('\n');
        return `<g><title>${title}</title>`
            + `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${color}" stroke="#fff" stroke-width="2"/>`
            + `<text x="${p.x}" y="${p.y + r + 14}" text-anchor="middle" font-size="12" fill="currentColor">${esc(n.label)}</text></g>`;
    }).join('');
    return `<svg viewBox="0 0 ${size} ${size}" width="100%" style="max-height: 100%;">${lines}${nodes}</svg>`;
}

export default {
    icon: 'carbon:network-3',
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                @apply --flex;
                overflow: auto;
                padding: 8px;
            }
            .bar {
                gap: 8px;
                align-items: center;
                padding-bottom: 8px;
            }
            .legend span {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                margin-right: 12px;
                font-size: small;
            }
            .legend i {
                width: 10px;
                height: 10px;
                border-radius: 50%;
                display: inline-block;
            }
            .empty {
                padding: 24px;
                opacity: .6;
                text-align: center;
            }
        </style>
        <div class="bar" horizontal>
            <button @tap="reload">Обновить</button>
            <label>Глубина <select ::value="depth"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label>
            <div class="legend" flex>
                <span><i style="background:#3f51b5"></i>наш сервер</span>
                <span><i style="background:#2e7d32"></i>в реестре</span>
                <span><i style="background:#78909c"></i>известен через соседей</span>
                <span><i style="background:#f9a825"></i>ожидает</span>
                <span><i style="background:#c62828"></i>ключ изменился</span>
            </div>
        </div>
        <div flex ~html="svg"></div>
    `,
    depth: {
        $def: 2,
        set() {
            this.svg = undefined;
        },
    },
    get svg() {
        return Promise.resolve(this.$item?.fetch?.('network_graph', { depth: this.depth }))
            .then(render)
            .catch(e => '<div class="empty">' + esc(e?.message || e) + '</div>');
    },
    reload() {
        this.svg = undefined;
    },
};
