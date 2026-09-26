/**
 * Визуалка form/file для ai.task — шелл: лента + док закрытых + промптбар.
 * Мета хендлера — class.js.
 */

import './ui/views.js';
import { focusChainIds } from './ui/rows.js';
import './ui/row.js';
import './ui/panel.js';
import './ui/dock.js';
import './ui/form.js';
import './ui/quiz.js';
import './ui/todo.js';
import './ui/html.js';

export default {
    imports: 'oda//button, oda//splitter',
    template: /* html */`
        <style>
            :host {
                overflow: hidden;
                position: relative;
                @apply --horizontal;
                @apply --info-invert;
            }
            .dock-over {
                position: absolute;
                top: 0;
                right: 0;
                z-index: 200;
                margin: 4px;
                padding: 0px 8px 0px 0px;
                border-radius: 16px;
            }
            .feed {
                overflow: hidden;
                max-width: {{showDock ?  '100%': '720px'}};
                margin: 0px auto;
                transition: width, max-width 0.3s ease-in-out;
            }
            .control-wrap {
                min-width: 0;
                min-height: 0;
                max-height: 80vh;
                overflow-y: auto;
            }
        </style>
        
        <div flex vertical class="feed" ~if="showFeed">
            <div ~if="mobile" flex></div>
            <div vertical :flex="!mobile" style="overflow: hidden; padding: 8px;">
                <microchat-ribbon flex :data :$item></microchat-ribbon>
            </div>
            <div class="control-wrap" ~if="controlType" ~is="controlType" :data="controlData" :$item></div>
            <microchat-panel info-invert no-flex :data :$item></microchat-panel>
        </div>
        <oda-splitter ~if="showDock && !mobile" left ::width="dockWidth"></oda-splitter>
        <microchat-dock content no-flex ~if="showDock" :data :$item ~style="dockStyle"></microchat-dock>   
        <oda-button class="dock-over" content ~if="showDockBtn" shadow icon="icons:chevron-left" :label="dockReports.length" :icon-size title="Отчёты" @tap="openDock"></oda-button>                

    `,
    colorMode: 'content',
    data: null,
    streamingText: '',
    /** prompt: start → done; typeIcon и стоп панели */
    pending: false,
    /** wait-кнопки прячем, пока идёт стрим (реактивный флаг для кэша геттеров) */
    streaming: false,
    dockOpen: { $def: true, $save: true },
    dockPick: -1,
    dockWidth: { $def: 280, $save: true },

    /** После disconnect cleanupDeps рвёт deps, кэш геттеров остаётся — tap на dockOpen не будит showDock. */
    _dockKeys: ['canDock', 'showDock', 'showDockBtn', 'showFeed', 'dockReports', 'dockIndex', 'dockCurrent', 'dockStyle'],
    _invalidateDock() {
        const cache = this[R]?.cache;
        if (!cache) return;
        for (const k of this._dockKeys)
            cache[k] = undefined;
    },
    attached() {
        this._invalidateDock();
        this.render?.(true);
    },
    openDock() {
        this.dockOpen = true;
        this._invalidateDock();
        this.render?.(true);
    },
    pickDock(i) {
        this.dockPick = i;
        this._invalidateDock();
        this.render?.(true);
    },

    $item: {
        $def: null,
        async set(n) {
            n?.listen('changed', () => {
                this.streamingText = '';
                this._reload();
            });
            n?.listen('chat.start', () => {
                this.pending = true;
            });
            n?.listen('chat.delta', e => {
                // pending только start→done; delta не поднимает (иначе Стоп снова включает радугу/волны)
                this.streaming = true;
                this.streamingText += e.detail?.value?.token || '';
            });
            n?.listen('chat.done', () => {
                this.pending = false;
                this.streaming = false;
                this.streamingText = '';
                this._reload();
            });
            this._reload();
            this.streaming = false;
            // только карта WORK.chatPending: чтение n.chatPending с item без флага уходит в _onEmpty и возвращает truthy Promise
            this.pending = WORK.chatPending?.[n?.short] === true || WORK.chatPending?.[n?.path] === true;
        },
    },
    /** Сериализация перезагрузок: не больше одного load в полёте; события во время загрузки схлопываются
     *  в одну повторную после её завершения. Параллельных запросов нет — ответы не приходят вразнобой,
     *  финальная загрузка всегда стартует после последнего события и читает финальный файл. */
    _reload() {
        if (this._loading) {
            this._reloadAgain = true;
            return;
        }
        this._loading = (async () => {
            let retries = 0;
            try {
                do {
                    this._reloadAgain = false;
                    try {
                        this.data = await this.$item?.load();
                        this._autoDock();
                        retries = 0;
                    } catch (e) {
                        // реджект не должен убивать цикл: сгоревший _reloadAgain = застывшая лента без последнего блока
                        if (++retries > 5) {
                            console.warn('microchat reload: сдаюсь после 5 попыток', e);
                            break;
                        }
                        console.warn('microchat reload: ошибка, повтор', e);
                        this._reloadAgain = true;
                        await new Promise(r => setTimeout(r, 300 * retries));
                    }
                } while (this._reloadAgain);
            } finally {
                this._loading = null;
            }
        })();
    },
    /** Новый отчёт — открыть док: «Скрыть» ($save) не должно прятать свежие исследования. Первый reload только запоминает базу. */
    _autoDock() {
        const n = this.dockReports.length;
        if (this._dockSeen != null && n > this._dockSeen)
            this.dockOpen = true;
        this._dockSeen = n;
    },
    $listeners: {
        resize() { this.mobile = undefined; },
    },
    get mobile() {
        return ODA.states.mobileMode;
    },
    get canDock() {
        return this.dockReports.length > 0;
    },
    get showDock() {
        return this.canDock && this.dockOpen;
    },
    get showDockBtn() {
        return this.canDock && !this.dockOpen;
    },
    get showFeed() {
        return !(this.showDock && this.mobile);
    },
    get dockStyle() {
        return this.mobile ? { width: '100%' } : { width: this.dockWidth + 'px', maxWidth: '80%', minWidth: '30%' };
    },
    get dockReports() {
        const out = [];
        const seen = new Set(); // проталкивание total даёт боксу content ребёнка — дубль в доке не нужен
        const walk = (items) => {
            for (const b of items || []) {
                if (!b || b.hidden) continue;
                walk(b.items);
                if (b.doc && b.content && !b.error && !seen.has(b.content)) {
                    seen.add(b.content);
                    out.push(b);
                }
            }
        };
        walk(this.data?.items);
        if (this.data?.content && !seen.has(this.data.content))
            out.push(this.data);
        return out;
    },
    get dockIndex() {
        const n = this.dockReports.length;
        if (!n) return -1;
        const i = this.dockPick;
        return (i < 0 || i >= n) ? n - 1 : i;
    },
    get dockCurrent() {
        const i = this.dockIndex;
        return i < 0 ? null : this.dockReports[i];
    },
    get title() { return this.data?.name || this.$item?.name || 'task'; },
    get items() { return this.data?.items; },
    get formBlock() {
        return lastOfType(this.data, 'form');
    },
    get checkGap() {
        const c = lastOfType(this.data, 'check');
        return !!c && !checkFullyOk(c);
    },
    get result() {
        const form = this.formBlock;
        if (form)
            return form.values || form.answer;
        const ribbon = this.$('microchat-ribbon');
        return ribbon?.viewFor(this.focusedBlock)?.result;
    },
    /**
     * Контрол над панелью (как в образце: все контролы — часть нижней панели):
     * открытая форма (внутри quiz — сам quiz) → html в фокусе → висящий todo.
     */
    get controlData() {
        const form = lastOpenForm(this.data);
        if (form)
            return quizOfForm(this.data, form) || form;
        const focus = this.focusedBlock;
        if (focus && focus.type === 'html' && !focus.error && focus.content)
            return focus;
        return pendingTodo(this.data, focus);
    },
    get controlType() {
        const d = this.controlData;
        if (!d)
            return null;
        if (d.type === 'form')
            return 'microchat-control-form';
        if (d.type === 'quiz' || d.quiz)
            return 'microchat-control-quiz';
        if (d.type === 'html')
            return 'microchat-control-html';
        if (d.type === 'todo' || Array.isArray(d.steps))
            return 'microchat-control-todo';
        return null;
    },
    get focusedBlock() {
        let items = this.items;
        while (items?.length) {
            let last;
            for (let i = items.length - 1; i >= 0; i--) {
                const b = items[i];
                // закрытый ignore без doc/stop (reasoning) — не фокус; пустой — слот стрима CoT.
                // doc/stop с ignore (html) — артефакт в фокусе, не пропускать
                if (b && !b.hidden && !(b.ignore && b.content && !b.doc && !b.stop)) { last = b; break; }
            }
            // box с content-маркером (includes/expand) — не лист: спускаемся в детей
            if (!last || !last.items?.length) return last;
            items = last.items;
        }
        return undefined;
    },
    /** focused без тела — слот стрима, не факт что стрим идёт (`streaming` — только delta/done) */
    get streamTarget() {
        const b = this.focusedBlock;
        return (b && !b.content) ? b : undefined;
    },
    /** id фокуса + всех предков: активные предки раскрыты, иконка — волна. */
    get activeIds() {
        return new Set(focusChainIds(this.data, this.focusedBlock?.id));
    },
};

function lastOfType(root, type) {
    let found;
    const walk = (items) => {
        for (const b of items || []) {
            if (b.type === type) found = b;
            walk(b.items);
        }
    };
    walk(root?.items);
    return found;
}

/** Последняя открытая форма: стоп без approved и без ошибки. */
function lastOpenForm(root) {
    let found = null;
    const walk = (items) => {
        for (const b of items || []) {
            if (b?.type === 'form' && b?.stop && !b?.approved && !b?.error && b?.content)
                found = b;
            walk(b.items);
        }
    };
    walk(root?.items);
    return found;
}

/** Quiz-бокс, содержащий форму (прямой родитель с quiz). */
function quizOfForm(root, form) {
    let owner = null;
    const walk = (items, parent) => {
        for (const b of items || []) {
            if (b === form) {
                owner = parent;
                return true;
            }
            if (walk(b.items, b))
                return true;
        }
        return false;
    };
    walk(root?.items, root);
    if (owner && (owner.type === 'quiz' || owner.quiz))
        return owner;
    return null;
}

/** Незавершённый todo: сначала бокс в фокусе, иначе корень. Фокусный контрол его перебивает. */
function pendingTodo(root, focus) {
    const chain = focus ? [focus, ...parentsOf(root, focus)] : [];
    for (const node of chain) {
        if (isTodoOpen(node?.todo))
            return node.todo;
    }
    if (isTodoOpen(root?.todo))
        return root.todo;
    return null;
}

function isTodoOpen(todo) {
    const steps = todo?.steps;
    if (!Array.isArray(steps) || !steps.length)
        return false;
    return steps.some(s => s?.state !== 'done');
}

/** Цепочка родителей блока от прямого к корню. */
function parentsOf(root, node) {
    const chain = [];
    let current = node;
    for (;;) {
        const parent = parentOf(root, current);
        if (!parent)
            return chain;
        chain.push(parent);
        current = parent;
    }
}

function parentOf(root, node) {
    if (!root || !node || root === node)
        return null;
    for (const b of (root.items || [])) {
        if (b === node)
            return root;
        const p = parentOf(b, node);
        if (p)
            return p;
    }
    return null;
}

function checkFullyOk(block) {
    if (block?.type !== 'check') return false;
    if (block.error) return false;
    const c = String(block.content || '');
    return !!c && !/gap:/i.test(c);
}
