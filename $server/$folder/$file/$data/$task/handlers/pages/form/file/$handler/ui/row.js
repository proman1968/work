import { projectBlock } from './rows.js';

/**
 * Базовые строки ленты (образец: v2 session-timeline-row + message-*).
 * Этап 2а: prompt / thinking / text / error. Остальные виды пока
 * рендерятся старыми microchat-view (маппинг ниже), их очередь — этап 2б.
 */

/** kind проекции → тег строки. Нет записи — старый microchat-view. */
export const ROW_TAG = {
    prompt: 'microchat-row-prompt',
    thinking: 'microchat-row-thinking',
    text: 'microchat-row-text',
    error: 'microchat-row-error',
    agent: 'microchat-row-agent',
    approval: 'microchat-row-approval',
    todo: 'microchat-row-todo',
    attachment: 'microchat-row-attachment',
    diff: 'microchat-row-diff',
};

/** Тег строки для элемента ленты по проекции. */
export function rowTag(item, ctx) {
    const r = projectBlock(item, ctx);
    if (!r)
        return null;
    // media: html — инлайн-превью, остальное пока старыми view
    if (r.kind === 'media')
        return item?.type === 'html' ? 'microchat-row-media' : null;
    return ROW_TAG[r.kind] || null;
}

const BASE_STYLE = /*html*/`
    <style>
        :host {
            @apply --vertical;
            min-width: 0;
        }
        .head {
            @apply --horizontal;
            align-items: center;
            gap: 8px;
            min-width: 0;
            padding: 4px 8px;
            font-size: small;
            cursor: pointer;
            user-select: none;
        }
        .head > .title {
            font-weight: 600;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .head > .state {
            opacity: .55;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .body {
            font-size: small;
            word-break: break-word;
            min-width: 0;
            margin-bottom: 8px;
        }
    </style>
`;

const HOVER_STYLE = /*html*/`
    <style>
        .hbar {
            @apply --horizontal;
            align-items: center;
            gap: 8px;
            min-width: 0;
            padding: 4px 8px;
            font-size: x-small;
            opacity: 0;
            pointer-events: none;
            transition: opacity .2s ease-in-out;
        }
        :host(:hover) > .hbar { opacity: .9; pointer-events: auto; }
        .hbar oda-button {
            padding: 4px;
        }
        .hbar > .meta {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            margin-right: 4px;
        }
        .hbar oda-button {
            padding: 0;
        }
    </style>
`;

function fmtTime(ms) {
    const t = Number(ms) || 0;
    if (!t) return '';
    try {
        return new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    }
    catch { return ''; }
}

function fmtDuration(ms) {
    const s = Math.max(0, Math.round(Number(ms) / 1000) || 0);
    if (s < 60) return s + 'с';
    return Math.floor(s / 60) + 'м ' + String(s % 60).padStart(2, '0') + 'с';
}

function modelShort(m) {
    const s = String(m || '').trim();
    if (!s) return '';
    return s.split('/').pop() || s;
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(String(text ?? ''));
    }
    catch { /* нет буфера */ }
}

ODA({ is: 'microchat-row-prompt',
    imports: 'oda//icon, oda//button',
    template: /*html*/`
        ${BASE_STYLE}
        ${HOVER_STYLE}
        <style>
            :host { align-items: flex-end; margin-bottom: 8px; }
            .bubble {
                @apply --accent;
                border-radius: 8px;
                padding: 8px 12px;
                margin-bottom: 4px;
                max-width: 85%;
                min-width: 0;
                font-size: small;
                font-weight: 600;
                word-break: break-word;
            }
        </style>
        <div class="bubble">{{text}}</div>
        <div class="hbar">
            <span class="meta">{{meta}}</span>
            <oda-button icon="icons:undo" title="Сбросить" :icon-size="16" @tap="revert"></oda-button>
            <oda-button icon="icons:content-copy" title="Копировать" :icon-size="16" @tap="copy"></oda-button>
        </div>
    `,
    data: null,
    $item: null,
    get text() { return String(this.data?.content || this.data?.label || 'prompt'); },
    get meta() {
        return [this.data?.mode, modelShort(this.data?.model), fmtTime(this.data?.time)]
            .filter(Boolean).join(' · ');
    },
    copy() { copyText(this.data?.content); },
    /** Панель ввода: $pdp строк — ribbon, а панель живёт в тени шелла. Идём вверх. */
    findPanel() {
        let n = this;
        while (n) {
            const p = n.$?.('microchat-panel');
            if (p)
                return p;
            n = n.host;
        }
        return null;
    },
    /** Сброс до момента: удалить блок и всё после, текст + вложения — в ввод. */
    async revert() {
        const id = this.data?.id;
        if (!id || !this.$item?.fetch)
            return;
        // Текст — до fetch: после усечения его уже негде взять
        const fallback = { prompt: String(this.data?.content || ''), includes: [] };
        let res;
        try {
            res = await this.$item.fetch('revert', { id });
        }
        catch {
            return;
        }
        if (!res || res.ok === false)
            return;
        const filled = res.prompt ? res : { ...res, ...fallback };
        this.findPanel()?.prefill?.(filled);
    },
});

ODA({ is: 'microchat-row-thinking',
    imports: 'oda//icon, oda//markdown//markdown-viewer',
    template: /*html*/`
        ${BASE_STYLE}
        <div class="head" @tap="toggle">
            <oda-icon no-flex :icon="typeIcon" :icon-size="16"></oda-icon>
            <span class="title" no-flex>{{label}}</span>
            <oda-icon no-flex :icon="chevron" :icon-size="16"></oda-icon>
        </div>
        <div class="body" ~if="open">
            <oda-markdown-viewer vertical :value="viewContent"></oda-markdown-viewer>
        </div>
    `,
    data: null,
    userOpen: false,
    get label() { return String(this.data?.label || 'Думаю'); },
    get isFocus() { return !!this.data?.id && this.$pdp?.focusedBlock?.id === this.data.id; },
    get streaming() { return this.isFocus && !!this.$pdp?.streaming; },
    /** В фокусе стрима — раскрыт (видно ход мысли), иначе свернут. */
    get open() { return this.userOpen || this.streaming; },
    get typeIcon() {
        if (this.streaming || (!this.data?.content && this.$pdp?.pending))
            return 'spinners:3-dots-scale';
        return this.data?.icon || 'carbon:idea';
    },
    get chevron() { return this.open ? 'icons:chevron-right:90' : 'icons:chevron-right'; },
    get viewContent() { return String(this.data?.content || '') + (this.$pdp?.streamingText && this.isFocus ? this.$pdp.streamingText : ''); },
    toggle() { this.userOpen = !this.userOpen; },
});

ODA({ is: 'microchat-row-text',
    imports: 'oda//markdown//markdown-viewer, oda//button',
    template: /*html*/`
        ${BASE_STYLE}
        ${HOVER_STYLE}
        <style>
            .body {
                @apply --content;
                border-radius: 8px;
                padding: 8px 12px;
                margin-bottom: 8px;
            }
        </style>
        <div class="body">
            <oda-markdown-viewer vertical :value="viewContent"></oda-markdown-viewer>
        </div>
        <div class="hbar">
            <oda-button icon="icons:content-copy" title="Копировать" :icon-size="16" @tap="copy"></oda-button>
            <span class="meta">{{meta}}</span>
        </div>
    `,
    data: null,
    get isFocus() { return !!this.data?.id && this.$pdp?.focusedBlock?.id === this.data.id; },
    get viewContent() {
        return String(this.data?.content || '')
            + (this.$pdp?.streamingText && this.isFocus ? this.$pdp.streamingText : '');
    },
    get meta() {
        return [this.data?.mode, modelShort(this.data?.model), fmtDuration(this.data?.durationMs)]
            .filter(Boolean).join(' · ');
    },
    copy() { copyText(this.data?.content); },
});

/** Предок фокуса, пока идёт работа: раскрыт, иконка — волна (как было автоматом). */
const ANCESTOR = {
    get isAncestor() {
        const id = this.data?.id;
        return !!id && !this.isFocus && !!this.$pdp?.activeIds?.has(id);
    },
    get ancestorActive() {
        return this.isAncestor && !!this.$pdp?.pending;
    },
};

/** Дочерняя строка операции: одна строка + раскрытие полного тела. */
ODA({ is: 'microchat-row-kid',
    imports: 'oda//icon, oda//markdown//markdown-viewer, ~/lib//node',
    template: /*html*/`
        <style>
            :host { @apply --vertical; min-width: 0; }
            .kid {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                min-width: 0;
                padding: 2px 8px 2px 24px;
                font-size: small;
                cursor: pointer;
                user-select: none;
            }
            .kid > .label {
                font-weight: 600;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .kid > .target {
                opacity: .55;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                max-width: 40%;
                min-width: 0;
            }
            a.target { color: inherit; }
            .kid > .preview {
                opacity: .55;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                flex: 1;
            }
            .kid-body {
                padding: 0 8px 4px 24px;
                font-size: small;
                min-width: 0;
            }
        </style>
        <div class="kid" @tap="toggle">
            <oda-icon no-flex :icon="icon" :icon-size="14"></oda-icon>
            <span class="label" no-flex>{{label}}</span>
            <span class="target" no-flex ~if="targetPath" @tap.stop="openTarget" :title="targetPath">
                <item-node :$item="targetItem" :icon-size="14"></item-node>
            </span>
            <a class="target" no-flex ~if="targetUrl" :href="targetUrl" target="_blank" @click.stop>{{targetUrl}}</a>
            <span class="preview" flex ~if="!open">{{preview}}</span>
        </div>
        <div class="kid-body" ~if="open && full">
            <oda-markdown-viewer vertical :value="full"></oda-markdown-viewer>
        </div>
    `,
    data: null,
    open: false,
    get icon() {
        if (this.data?.error) return 'icons:close';
        if (this.data?.done) return 'icons:check';
        return this.data?.icon || 'icons:chevron-right';
    },
    get label() { return String(this.data?.label || this.data?.type || ''); },
    /** Цель хода — item-node (иконка + имя + переход), URL — ссылка. */
    get targetPath() {
        const p = String(this.data?.path || '').trim();
        return p.startsWith('/') ? p : '';
    },
    get targetUrl() {
        const u = String(this.data?.url || '').trim();
        return /^https?:\/\//i.test(u) ? u : '';
    },
    get targetItem() {
        const p = this.targetPath;
        if (!p || typeof WORK?.get_item !== 'function')
            return null;
        return WORK.get_item(p).catch(() => null);
    },
    openTarget(e) {
        e?.stopPropagation?.();
        const p = this.targetPath;
        if (p)
            window.open(p.replace(/\/$/, '') + '/~/handlers/pages/form/', '_blank');
    },
    get full() { return String(this.data?.content || ''); },
    get preview() {
        const t = this.full.replace(/\s+/g, ' ').trim();
        return this.data?.state || t.slice(0, 120);
    },
    toggle() { this.open = !this.open; },
});

/** Строка операции: шапка (статус + суть) + свернутые дети. */
ODA({ is: 'microchat-row-agent',
    imports: 'oda//icon',
    template: /*html*/`
        <style>
            :host { @apply --vertical; min-width: 0; }
            .head {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                min-width: 0;
                padding: 4px 8px;
                font-size: small;
                cursor: pointer;
                user-select: none;
            }
            .head > .title {
                font-weight: 600;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .head > .state {
                opacity: .55;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
        </style>
        <div class="head" @tap="toggle">
            <oda-icon no-flex :icon="statusIcon" :icon-size="16"></oda-icon>
            <span class="title" no-flex>{{title}}</span>
            <span class="state" no-flex ~if="state">{{state}}</span>
            <oda-icon no-flex :icon="chevron" :icon-size="16"></oda-icon>
        </div>
        <div ~if="open">
            <microchat-row-kid ~for="kids" :data="$for.item"></microchat-row-kid>
        </div>
    `,
    ...ANCESTOR,
    data: null,
    userOpen: false,
    get title() { return String(this.data?.label || this.data?.type || ''); },
    get state() { return String(this.data?.state || ''); },
    get isFocus() { return !!this.data?.id && this.$pdp?.focusedBlock?.id === this.data.id; },
    get streaming() { return this.isFocus && !!this.$pdp?.streaming; },
    get statusIcon() {
        if (this.data?.error) return 'icons:error';
        if (this.ancestorActive) return 'spinners:3-dots-scale';
        if (this.streaming || (!this.data?.content && !this.kids.length && this.$pdp?.pending)) return 'spinners:3-dots-scale';
        return this.data?.icon || 'icons:check-circle';
    },
    /** В фокусе стрима — раскрыт, иначе свернут (кроме ручного). */
    get open() { return this.userOpen || this.streaming || this.ancestorActive; },
    get chevron() { return this.open ? 'icons:chevron-right:90' : 'icons:chevron-right'; },
    get kids() { return (this.data?.items || []).filter(b => b && !b.hidden); },
    toggle() { this.userOpen = !this.userOpen; },
});

/** Строка-запрос: шапка (+ ответы после сдачи). Контрол — в полосе над панелью. */
ODA({ is: 'microchat-row-approval',
    imports: 'oda//icon, oda//markdown//markdown-viewer',
    template: /*html*/`
        <style>
            :host { @apply --vertical; min-width: 0; }
            .head {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                min-width: 0;
                padding: 4px 8px;
                font-size: small;
            }
            .head > .title { font-weight: 600; }
            .body { padding: 0 8px 8px; min-width: 0; font-size: small; }
        </style>
        <div class="head">
            <oda-icon no-flex :icon="icon" :icon-size="16"></oda-icon>
            <span class="title">{{title}}</span>
        </div>
        <div class="body" ~if="bodyText">
            <oda-markdown-viewer vertical :value="bodyText"></oda-markdown-viewer>
        </div>
    `,
    data: null,
    get title() { return String(this.data?.label || this.data?.type || ''); },
    get icon() { return this.data?.icon || 'icons:help'; },
    /**
     * Тело строки: сданное — ответы; вопрос/план без контрола — их текст.
     * Открытая форма/quiz тела не имеет — поля живут в полосе над панелью.
     */
    get bodyText() {
        const approved = String(this.data?.approved || '').replace(/^\s*\[form answers\]\s*/i, '').trim();
        if (approved)
            return approved;
        if (this.data?.type === 'question' || this.data?.type === 'planning' || this.data?.type === 'plan')
            return String(this.data?.content || '');
        return '';
    },
});

/** Строка-чеклист: шапка с прогрессом. Шаги — в полосе над панелью. */
ODA({ is: 'microchat-row-todo',
    imports: 'oda//icon',
    template: /*html*/`
        <style>
            :host { @apply --vertical; min-width: 0; }
            .head {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                min-width: 0;
                padding: 4px 8px;
                font-size: small;
            }
            .head > .title { font-weight: 600; }
            .head > .pos { opacity: .55; }
        </style>
        <div class="head">
            <oda-icon no-flex :icon="icon" :icon-size="16"></oda-icon>
            <span class="title">{{title}}</span>
            <span class="pos">{{pos}}</span>
        </div>
    `,
    data: null,
    get title() { return String(this.data?.label || 'План'); },
    get icon() { return this.data?.icon || 'icons:list'; },
    get pos() {
        const s = this.data?.steps || [];
        if (!s.length) return '';
        const done = s.filter(x => x?.state === 'done').length;
        return done + '/' + s.length;
    },
});

/** Строка-вложение: шапка со ссылкой + раскрытие тела. */
ODA({ is: 'microchat-row-attachment',
    imports: 'oda//icon, oda//markdown//markdown-viewer',
    template: /*html*/`
        <style>
            :host { @apply --vertical; min-width: 0; }
            .head {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                min-width: 0;
                padding: 4px 8px;
                font-size: small;
                cursor: pointer;
                user-select: none;
            }
            .head > .title {
                font-weight: 600;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .body { padding: 0 8px 8px; min-width: 0; font-size: small; }
        </style>
        <div class="head" @tap="toggle">
            <oda-icon no-flex :icon="icon" :icon-size="16"></oda-icon>
            <span class="title" flex>{{title}}</span>
            <oda-icon no-flex :icon="chevron" :icon-size="16"></oda-icon>
        </div>
        <div class="body" ~if="open && text">
            <oda-markdown-viewer vertical :value="text"></oda-markdown-viewer>
        </div>
    `,
    data: null,
    open: false,
    get title() { return String(this.data?.label || this.data?.path || this.data?.type || ''); },
    get icon() { return this.data?.icon || 'files:file'; },
    get text() { return String(this.data?.content || ''); },
    get chevron() { return this.open ? 'icons:chevron-right:90' : 'icons:chevron-right'; },
    toggle() { this.open = !this.open; },
});

/** Строка файловых изменений: шапка + файлы со статусами (как file-changes). */
ODA({ is: 'microchat-row-diff',
    imports: 'oda//icon',
    template: /*html*/`
        <style>
            :host { @apply --vertical; min-width: 0; }
            .head {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                min-width: 0;
                padding: 4px 8px;
                font-size: small;
                cursor: pointer;
                user-select: none;
            }
            .head > .title { font-weight: 600; }
            .head > .counts { opacity: .55; }
        </style>
        <div class="head" @tap="toggle">
            <oda-icon no-flex :icon="statusIcon" :icon-size="16"></oda-icon>
            <span class="title" no-flex>{{title}}</span>
            <span class="counts" no-flex>{{counts}}</span>
            <oda-icon no-flex :icon="chevron" :icon-size="16"></oda-icon>
        </div>
        <div ~if="open">
            <microchat-row-kid ~for="kids" :data="$for.item"></microchat-row-kid>
        </div>
    `,
    ...ANCESTOR,
    data: null,
    userOpen: false,
    get title() { return String(this.data?.label || this.data?.type || 'Изменения'); },
    get isFocus() { return !!this.data?.id && this.$pdp?.focusedBlock?.id === this.data.id; },
    get streaming() { return this.isFocus && !!this.$pdp?.streaming; },
    get open() { return this.userOpen || this.streaming || this.ancestorActive; },
    get chevron() { return this.open ? 'icons:chevron-right:90' : 'icons:chevron-right'; },
    get statusIcon() {
        if (this.data?.error) return 'icons:error';
        if (this.ancestorActive) return 'spinners:3-dots-scale';
        return this.data?.icon || 'icons:check-circle';
    },
    get kids() { return (this.data?.items || []).filter(b => b && !b.hidden); },
    get counts() {
        const kids = this.kids;
        if (!kids.length) return String(this.data?.state || '');
        const bad = kids.filter(b => b.error).length;
        return bad ? kids.length + ' файлов, ошибок: ' + bad : kids.length + ' файлов';
    },
    toggle() { this.userOpen = !this.userOpen; },
});

/** Строка-медиа: только шапка. Превью — над панелью (htmlControl шелла, 80vh). */
ODA({ is: 'microchat-row-media',
    imports: 'oda//icon',
    template: /*html*/`
        <style>
            :host { @apply --vertical; min-width: 0; }
            .head {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                min-width: 0;
                padding: 4px 8px;
                font-size: small;
            }
            .head > .title { font-weight: 600; }
        </style>
        <div class="head">
            <oda-icon no-flex :icon="icon" :icon-size="16"></oda-icon>
            <span class="title" flex>{{title}}</span>
        </div>
    `,
    ...ANCESTOR,
    data: null,
    get title() { return String(this.data?.label || this.data?.type || ''); },
    get icon() {
        if (this.ancestorActive) return 'spinners:3-dots-scale';
        return this.data?.icon || 'editor:code';
    },
    get isFocus() { return !!this.data?.id && this.$pdp?.focusedBlock?.id === this.data.id; },
});

ODA({ is: 'microchat-row-error',
    imports: 'oda//icon, oda//markdown//markdown-viewer',
    template: /*html*/`
        ${BASE_STYLE}
        <style>:host { @apply --error-invert; border-radius: 8px; }</style>
        <div class="head">
            <oda-icon no-flex :icon="typeIcon" :icon-size="16"></oda-icon>
            <span class="title" no-flex>{{label}}</span>
        </div>
        <div class="body" ~if="viewContent">
            <oda-markdown-viewer vertical :value="viewContent"></oda-markdown-viewer>
        </div>
    `,
    data: null,
    get label() { return String(this.data?.label || this.data?.state || 'Ошибка'); },
    get typeIcon() { return this.data?.icon || 'icons:error'; },
    get viewContent() { return String(this.data?.content || ''); },
});
