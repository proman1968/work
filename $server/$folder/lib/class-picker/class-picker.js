/**
 * Единый системный контрол выбора конечного класса хранения (`item-class-picker`)
 * и построитель иерархического дерева классов (`buildClassTree`, `pickClassFromTree`).
 *
 * Используется единообразно везде, где пользователю нужно выбрать класс создания объекта/операции:
 *  - при нажатии «+ Новый» на промежуточном классе в `form/objects` («Выберите класс для создания объекта '...'»);
 *  - при нажатии «+» → «Создать операцию…» в чате подразделения (`work-prompt-bar` / `chat.js`, «Создать операцию»).
 */

function fmtCount(n) {
    const num = Number(n);
    if (!Number.isFinite(num) || num <= 0)
        return '';
    return num.toLocaleString('ru-RU');
}

/**
 * Определить путь корневого класса данных для любого класса/подкласса данных:
 * например `/ORGANIZATIONS/Деловая сфера/MODULES/Register/OPERATIONS/Платёжное поручение`
 * → `/ORGANIZATIONS/Деловая сфера/MODULES/Register/OPERATIONS`.
 */
export function resolveDataRootPath(rawPath, $item = null) {
    if (!rawPath || typeof rawPath !== 'string')
        return '';
    if ($item && ($item.type === '$file' || $item.type === '$handler' || (globalThis.CORE?.$file && $item instanceof globalThis.CORE.$file)))
        return '';
    const clean = rawPath.replace(/\/~\/handlers\/.*$/, '').replace(/\/+$/, '');
    const m = /^(.*?\/MODULES\/[^/]+\/[^/]+)(?:\/(.+))?$/.exec(clean);
    if (m)
        return m[1];
    const m2 = /^(.*?\/(?:OPERATIONS|CATALOGS|REGISTER|STRUCTS))(?:\/(.+))?$/.exec(clean);
    if (m2)
        return m2[1];
    return '';
}

/**
 * Сформировать заголовок вкладки для нового объекта класса (например, «Новое платёжное поручение»).
 */
export function formatNewObjectLabel(classTitle = '') {
    const raw = String(classTitle || '').trim();
    if (!raw)
        return 'Новый объект';
    const clean = raw.replace(/\s*\([^)]*\)\s*$/, '').trim() || raw;
    const words = clean.split(/\s+/).filter(Boolean);
    const firstWord = (words[0] || '').toLowerCase();
    const lastWord = (words[words.length - 1] || firstWord).toLowerCase();
    const lower = raw.charAt(0).toLowerCase() + raw.slice(1);
    if (/(?:ое|ее)$/.test(firstWord) || /(?:ние|тие|ье|мя|мо)$/.test(firstWord) || (words.length === 1 && /(?:ние|тие|ье|мя|мо)$/.test(lastWord)))
        return `Новое ${lower}`;
    if (/(?:ая|яя)$/.test(firstWord) || /(?:сть|ция|ка|жа|та|плата|убыль)$/.test(firstWord) || (words.length === 1 && /(?:сть|ция|ка|жа|та|плата|убыль)$/.test(lastWord)))
        return `Новая ${lower}`;
    return `Новый ${lower}`;
}

/**
 * Построить иерархическое дерево классов из словаря/массива классов и листьев.
 * Промежуточные узлы (`leaf: false`) выступают раскрываемыми группами,
 * а конечные классы (`leaf: true`) — выбираемыми точками создания объекта.
 */
export function buildClassTree({
    classes = null,
    leaves = null,
    rows = null,
    rootCid = '',
    rootPath = '',
    defaultIcon = 'carbon:catalog',
    defaultType = '$catalog',
} = {}) {
    // Если передан уже готовый массив узлов дерева с вложенными children — клонируем и нормализуем
    if (Array.isArray(classes) && classes.length > 0 && classes.some(c => Array.isArray(c?.children) && c.children.length > 0 && typeof c.leaf === 'boolean')) {
        const cloneNodes = (list) => (list || []).map(n => {
            const kids = cloneNodes(n.children || []);
            const cid = n.cid || n.id || n.path || '';
            return {
                cid,
                path: n.path || cid,
                parent: n.parent || '',
                label: n.label || cid.split('/').pop() || '',
                type: n.type || defaultType,
                icon: n.icon || defaultIcon,
                leaf: typeof n.leaf === 'boolean' ? n.leaf : kids.length === 0,
                count: Number(n.count ?? n.objectCount) || 0,
                children: kids,
                expanded: n.expanded !== false,
            };
        });
        return cloneNodes(classes);
    }

    const rawMap = new Map();
    const rowCounts = new Map();
    for (const r of rows || []) {
        if (r?.cid)
            rowCounts.set(r.cid, (rowCounts.get(r.cid) || 0) + 1);
    }

    const classList = Array.isArray(classes)
        ? classes
        : (classes && typeof classes === 'object' ? Object.values(classes) : []);

    for (const c of classList) {
        const cid = c?.cid || c?.id || c?.path || '';
        if (!cid)
            continue;
        const path = c.path || cid;
        rawMap.set(cid, {
            cid,
            path,
            parent: c.parent || '',
            label: c.label || path.split('/').pop() || cid,
            type: c.type || defaultType,
            icon: c.icon || defaultIcon,
            leaf: typeof c.leaf === 'boolean' ? c.leaf : true,
            count: Number(c.count ?? c.objectCount) || rowCounts.get(cid) || 0,
            children: [],
            expanded: true,
        });
    }

    for (const l of leaves || []) {
        const cid = l?.cid || l?.id || l?.path || '';
        if (!cid || rawMap.has(cid))
            continue;
        const path = l.path || cid;
        rawMap.set(cid, {
            cid,
            path,
            parent: l.parent || '',
            label: l.label || path.split('/').pop() || cid,
            type: l.type || defaultType,
            icon: l.icon || defaultIcon,
            leaf: true,
            count: Number(l.count ?? l.objectCount) || rowCounts.get(cid) || 0,
            children: [],
            expanded: true,
        });
    }

    // Определим корневой узел открытого промежуточного класса (например, .../OPERATIONS или открытый справочник)
    let rootNode = (rootCid && rawMap.get(rootCid))
        || (rootPath && [...rawMap.values()].find(n => n.path === rootPath))
        || [...rawMap.values()].find(n => !n.leaf && (!n.parent || !rawMap.has(n.parent)))
        || null;

    let effectiveRootCid = rootNode?.cid || rootCid;
    let effectiveRootPath = rootNode?.path || rootPath;

    // Если корень не передан явно (например, передан список операций подразделения),
    // вычисляем общий корневой префикс .../OPERATIONS автоматически
    if (!effectiveRootPath) {
        for (const n of rawMap.values()) {
            const p = String(n.path || '');
            const m = /^(.*\/OPERATIONS)(?:\/|$)/i.exec(p);
            if (m) {
                effectiveRootPath = m[1];
                if (!effectiveRootCid)
                    effectiveRootCid = m[1];
                break;
            }
        }
    }

    const byPath = new Map();
    for (const n of rawMap.values()) {
        if (n.path)
            byPath.set(n.path, n);
    }

    // Привяжем каждого потомка к ближайшему родителю (или синтезируем промежуточные папки по пути)
    const roots = [];
    for (const node of [...rawMap.values()]) {
        if (node.cid === effectiveRootCid || (effectiveRootPath && node.path === effectiveRootPath))
            continue;
        if (node.type === '$virtual')
            continue;
        let parentNode = node.parent && node.parent !== effectiveRootCid && node.parent !== effectiveRootPath
            ? (rawMap.get(node.parent) || byPath.get(node.parent))
            : null;
        if (!parentNode && effectiveRootPath && node.path && node.path.startsWith(effectiveRootPath + '/')) {
            const rel = node.path.slice(effectiveRootPath.length + 1).split('/').filter(Boolean);
            let curPath = effectiveRootPath;
            let curParent = null;
            for (let i = 0; i < rel.length - 1; i++) {
                curPath += '/' + rel[i];
                let mid = byPath.get(curPath);
                if (!mid) {
                    mid = {
                        cid: curPath,
                        path: curPath,
                        parent: curParent?.cid || effectiveRootCid,
                        label: rel[i],
                        type: defaultType,
                        icon: defaultIcon,
                        leaf: false,
                        count: 0,
                        children: [],
                        expanded: true,
                    };
                    rawMap.set(mid.cid, mid);
                    byPath.set(curPath, mid);
                    if (curParent)
                        curParent.children.push(mid);
                    else
                        roots.push(mid);
                }
                else {
                    mid.leaf = false;
                }
                curParent = mid;
            }
            parentNode = curParent;
        }
        if (parentNode && parentNode !== node) {
            parentNode.leaf = false;
            if (!parentNode.children.includes(node))
                parentNode.children.push(node);
        }
        else if (!roots.includes(node)) {
            roots.push(node);
        }
    }

    // Оставляем только ветки, ведущие хотя бы к одному конечному листу хранения, и сортируем
    const pruneAndSort = (list) => {
        const kept = [];
        for (const n of list) {
            n.children = pruneAndSort(n.children || []);
            if (n.children.length > 0)
                n.leaf = false;
            if (n.leaf || n.children.length > 0)
                kept.push(n);
        }
        kept.sort((a, b) => String(a.label || '').localeCompare(String(b.label || ''), 'ru', { numeric: true }));
        return kept;
    };
    return pruneAndSort(roots);
}

export const CLASS_PICKER_DEF = {
    is: 'item-class-picker',
    imports: '/oda/components/button/button.js, /oda/components/icon/icon.js',
    template: /*html*/`
    <style>
        :host {
            @apply --vertical;
            @apply --content;
            padding: 12px 14px;
            gap: 12px;
            box-sizing: border-box;
        }
        .tree-box {
            @apply --vertical;
            min-height: 320px;
            max-height: 62vh;
            overflow: auto;
            border: 1px solid var(--border-color);
            background: var(--content-background);
            padding: 8px 10px;
            box-sizing: border-box;
        }
        .tree-row {
            @apply --horizontal;
            align-items: center;
            min-height: 28px;
            padding: 2px 6px;
            user-select: none;
            gap: 6px;
            white-space: nowrap;
        }
        .tree-row.leaf {
            cursor: pointer;
        }
        .tree-row.group {
            cursor: pointer;
        }
        .tree-row.leaf:hover:not([selected]),
        .tree-row.group:hover {
            background: var(--accent-soft, rgba(59, 130, 246, 0.08));
        }
        .tree-row[selected] {
            background: var(--selected-background, #3b82f6);
            color: var(--selected-color, #ffffff);
        }
        .indent-guide {
            display: inline-block;
            width: 18px;
            height: 26px;
            border-left: 1px dotted var(--border-color);
            flex-shrink: 0;
        }
        .expander {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 13px;
            height: 13px;
            border: 1px solid var(--border-color);
            background: var(--light-background);
            color: var(--content-color);
            font-size: 11px;
            line-height: 1;
            cursor: pointer;
            flex-shrink: 0;
            margin-right: 2px;
        }
        .expander-spacer {
            display: inline-block;
            width: 15px;
            flex-shrink: 0;
        }
        .node-icon {
            flex-shrink: 0;
            color: light-dark(#d97706, #fbbf24);
        }
        .tree-row[selected] .node-icon {
            color: inherit;
        }
        .node-label {
            font-size: 13px;
        }
        .tree-row.group .node-label {
            color: light-dark(#64748b, #94a3b8);
            font-weight: 600;
        }
        .node-count {
            font-size: 12.5px;
            color: light-dark(#8a8a8a, #94a3b8);
            margin-left: 4px;
        }
        .tree-row[selected] .node-count {
            color: inherit;
            opacity: 0.9;
        }
        .footer-bar {
            @apply --horizontal;
            justify-content: flex-end;
            align-items: center;
            gap: 8px;
        }
        button.dlg-btn {
            @apply --content;
            @apply --border;
            min-width: 78px;
            padding: 3px 12px;
            font-size: small;
            font-family: inherit;
            border-radius: 0;
            cursor: pointer;
        }
        button.dlg-btn:hover:not(:disabled) {
            @apply --hover;
        }
        button.dlg-btn:disabled {
            opacity: 0.45;
            cursor: default;
        }
    </style>
    <div class="tree-box">
        <div ~for="flatRows"
            :class="'tree-row ' + ($for.item.node.leaf ? 'leaf' : 'group')"
            :selected="$for.item.node.leaf && selectedCid === $for.item.node.cid"
            @tap="onRowTap($for.item.node, $event)"
            @dblclick="onRowDblClick($for.item.node, $event)">
            <span class="indent-guide" ~for="$for.item.guides"></span>
            <span class="expander" ~if="$for.item.node.children?.length" @tap.stop="toggleNode($for.item.node)">{{$for.item.node.expanded ? '−' : '+'}}</span>
            <span class="expander-spacer" ~if="!$for.item.node.children?.length"></span>
            <oda-icon class="node-icon" :icon="$for.item.node.icon || 'carbon:catalog'" icon-size="20"></oda-icon>
            <span class="node-label">{{$for.item.node.label}}</span>
            <span class="node-count" ~if="$for.item.node.leaf && $for.item.node.count > 0">({{fmtCount($for.item.node.count)}})</span>
        </div>
    </div>
    <div class="footer-bar">
        <button type="button" class="dlg-btn" :disabled="!selectedCid" @tap="confirmPick">OK</button>
        <button type="button" class="dlg-btn" @tap="cancelPick">Отмена</button>
    </div>
    `,
    fmtCount,
    treeNodes: [],
    selectedCid: '',
    confirmedCid: '',
    treeVersion: 0,
    get flatRows() {
        void this.treeVersion;
        const out = [];
        const walk = (list, level) => {
            for (const node of list || []) {
                const guides = Array.from({ length: level }, (_, i) => i);
                out.push({ node, level, guides });
                if (node.expanded && node.children?.length)
                    walk(node.children, level + 1);
            }
        };
        walk(this.treeNodes, 0);
        return out;
    },
    toggleNode(node) {
        if (!node)
            return;
        node.expanded = !node.expanded;
        this.treeVersion++;
        this.render?.(true);
    },
    onRowTap(node) {
        if (!node)
            return;
        if (node.leaf) {
            this.selectedCid = node.cid;
        }
        else {
            this.selectedCid = '';
            if (node.children?.length)
                this.toggleNode(node);
        }
        this.render?.(true);
    },
    onRowDblClick(node) {
        if (!node)
            return;
        if (node.leaf) {
            this.selectedCid = node.cid;
            this.confirmPick();
        }
        else if (node.children?.length) {
            this.toggleNode(node);
        }
    },
    confirmPick() {
        if (!this.selectedCid)
            return;
        this.confirmedCid = this.selectedCid;
        this.parentElement?.close?.('ok');
    },
    cancelPick() {
        this.confirmedCid = '';
        this.parentElement?.close?.('');
    },
};

export function ensureClassPickerDefined() {
    if (typeof globalThis.ODA !== 'function')
        return;
    if (globalThis.ODA.telemetry?.['item-class-picker'])
        return;
    if (typeof customElements !== 'undefined' && customElements.get?.('item-class-picker'))
        return;
    const copy = Object.defineProperties({}, Object.getOwnPropertyDescriptors(CLASS_PICKER_DEF));
    globalThis.ODA(copy);
}

ensureClassPickerDefined();

/**
 * Открыть единое модальное окно выбора конечного класса из дерева `treeNodes`.
 * Возвращает выбранный `cid`/`path` или `''` при отмене.
 */
export async function pickClassFromTree(treeNodes, { title = 'Выберите класс', width = 0 } = {}) {
    if (!Array.isArray(treeNodes) || !treeNodes.length)
        return '';
    ensureClassPickerDefined();
    if (typeof globalThis.WORK?.showModal !== 'function' || typeof document === 'undefined')
        return '';
    const picker = globalThis.ODA.createComponent('item-class-picker', {
        treeNodes,
        selectedCid: '',
    });
    try {
        await globalThis.WORK.showModal(picker, {
            TITLE: { label: title },
            allowClose: true,
            width: width || Math.min(580, (globalThis.window?.innerWidth || 640) - 32),
        });
        return picker.confirmedCid || '';
    }
    catch {
        return '';
    }
}

globalThis.__workClassPicker = { buildClassTree, pickClassFromTree, ensureClassPickerDefined, resolveDataRootPath, formatNewObjectLabel };
if (globalThis.WORK && typeof globalThis.WORK === 'object') {
    globalThis.WORK.buildClassTree = buildClassTree;
    globalThis.WORK.pickClassFromTree = pickClassFromTree;
    globalThis.WORK.resolveDataRootPath = resolveDataRootPath;
    globalThis.WORK.formatNewObjectLabel = formatNewObjectLabel;
}

export default CLASS_PICKER_DEF;
