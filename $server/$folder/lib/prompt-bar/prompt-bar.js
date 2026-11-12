export default {
    imports: 'oda//button, oda//icon, ~/lib//tree, ~/lib//user, ~/lib//class-picker',
}

/**
 * work-prompt-bar — единый композер WORK (чат класса, микрочат задачи).
 * Поле с автовысотой (Enter — отправить, Shift+Enter — строка, Ctrl+Enter — файлы, Esc — стоп/очистить),
 * вложения (+, вставка картинок, перетаскивание), получатели, модель (ai),
 * режим (если задан modes), диктовка (Web Speech; в обычном чате — ещё и аудиофайл), отправка/стоп.
 * Уровень рассуждений (effort) модель выбирает сама в зависимости от сложности задачи.
 * События: send, stop, clear, prompt-key; model/mode — свойства (хост слушает *-changed).
 */

/** Является ли узел $ai языковой моделью, подходящей для чата (не image/audio/embedding/asr/tts). */
export function isChatModel(item) {
    if (!item)
        return false;
    if (item.type && item.type !== '$ai')
        return false;
    const mod = String(item.DATA?.modality ?? (typeof item.modality === 'string' ? item.modality : '') ?? '').toLowerCase();
    if (['image', 'audio', 'embedding', 'video', 'voice', 'asr', 'tts', 'stt'].includes(mod))
        return false;
    const name = String(item.id || item.label || item.DATA?.label || item.path || '').toLowerCase();
    if (/(flux|sdxl|stable-?diffusion|z-image|embedding|bge-|rerank|whisper|\basr\b|\btts\b|\bstt\b|voice|kokoro|musicgen|wan2|ltx-video)/i.test(name))
        return false;
    const caps = item.DATA?.capabilities ?? item.capabilities;
    if (caps && typeof caps.then !== 'function') {
        const list = Array.isArray(caps)
            ? caps.map(String)
            : String(caps || '').split(/[\s,]+/).filter(Boolean);
        if (list.length)
            return list.includes('chat');
    }
    return true;
}

/** Ключ пользовательских настроек модели ИИ (привязан к пользователю, а не к подразделению/точке). */
function userAiStorageKey(suffix = 'model') {
    const uid = globalThis.WORK?.uid
        || globalThis.WORK?.USER?.id
        || globalThis.WORK?.credentials?.uid
        || 'default';
    return `work.user.ai:${uid}:${suffix}`;
}

export function getUserPreferredModel() {
    if (typeof localStorage === 'undefined')
        return '';
    try {
        const val = localStorage.getItem(userAiStorageKey('model'))
            || localStorage.getItem('work.user.ai:default:model')
            || '';
        if (val && /(flux|sdxl|stable-?diffusion|z-image|embedding|bge-|rerank|whisper|\basr\b|\btts\b|\bstt\b|voice|kokoro|musicgen|wan2|ltx-video)/i.test(val))
            return '';
        return val;
    }
    catch {
        return '';
    }
}

export function setUserPreferredModel(modelPath) {
    if (!modelPath || typeof localStorage === 'undefined')
        return;
    if (/(flux|sdxl|stable-?diffusion|z-image|embedding|bge-|rerank|whisper|\basr\b|\btts\b|\bstt\b|voice|kokoro|musicgen|wan2|ltx-video)/i.test(modelPath))
        return;
    try {
        localStorage.setItem(userAiStorageKey('model'), modelPath);
        localStorage.setItem('work.user.ai:default:model', modelPath);
        if (typeof BroadcastChannel !== 'undefined')
            new BroadcastChannel('work-user-ai-model').postMessage({ model: modelPath });
    }
    catch { /* ignore */ }
}

export function getUserPreferredEfforts() {
    if (typeof localStorage === 'undefined')
        return {};
    try {
        const raw = localStorage.getItem(userAiStorageKey('efforts'))
            || localStorage.getItem('work.user.ai:default:efforts');
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && typeof parsed === 'object' ? parsed : {};
    }
    catch {
        return {};
    }
}

export function setUserPreferredEfforts(efforts) {
    if (!efforts || typeof efforts !== 'object' || typeof localStorage === 'undefined')
        return;
    try {
        const str = JSON.stringify(efforts);
        localStorage.setItem(userAiStorageKey('efforts'), str);
        localStorage.setItem('work.user.ai:default:efforts', str);
    }
    catch { /* ignore */ }
}

/** Выпадающий список для WORK.showDropdown: выбор закрывает дропдаун со значением id. */
ODA({ is: 'work-prompt-menu',
    imports: 'oda//icon',
    template: /*html*/`
        <style>
            :host { @apply --vertical; padding: 4px; min-width: 240px; max-width: 360px; font-size: small; }
            .it { @apply --horizontal; align-items: flex-start; gap: 10px; padding: 8px 10px; border-radius: var(--radius-s, 6px); cursor: pointer; }
            .it:hover { background: var(--accent-soft); }
            .it[on] { font-weight: 600; }
            .hint { opacity: .6; font-size: x-small; font-weight: normal; margin-top: 2px; }
        </style>
        <div class="it" ~for="options" :on="$for.item.id === value" @tap="pick($for.item.id)">
            <oda-icon no-flex :icon="$for.item.id === value ? 'carbon:checkmark' : ($for.item.icon || 'carbon:circle-dash')" :icon-size="16"></oda-icon>
            <div vertical flex><span>{{$for.item.label}}</span><span class="hint" ~if="$for.item.hint">{{$for.item.hint}}</span></div>
        </div>
    `,
    options: [],
    value: '',
    pick(id) { this.parentElement?.close?.(id); },
});

/** Мультивыбор получателей подразделения для отправки сообщения. */
ODA({ is: 'work-receivers-menu',
    imports: 'oda//icon, ~/lib//user',
    template: /*html*/`
        <style>
            :host { @apply --vertical; padding: 4px; min-width: 260px; max-width: 360px; font-size: small; }
            .it { @apply --horizontal; align-items: center; gap: 8px; padding: 6px 10px; border-radius: var(--radius-s, 6px); cursor: pointer; }
            .it:hover { background: var(--accent-soft); }
            .it[on] { font-weight: 600; background: var(--subtle-background); }
            .hint { opacity: .65; font-size: x-small; font-weight: normal; }
            .clear-row { border-bottom: 1px solid var(--subtle-border, var(--border-color)); margin-bottom: 4px; }
        </style>
        <div class="it clear-row" ~if="selectedIds.length" @tap="clearAll()">
            <oda-icon no-flex icon="bootstrap:robot" :icon-size="16"></oda-icon>
            <div vertical flex>
                <span>Снять выбор (задача для ИИ)</span>
                <span class="hint">Если получатели не выбраны, создаётся задача ИИ</span>
            </div>
        </div>
        <div class="it" ~for="users" :on="isSelected($for.item)" @tap="toggle($for.item)">
            <oda-icon no-flex :icon="isSelected($for.item) ? 'icons:check' : ''" :icon-size="16"></oda-icon>
            <item-user no-flex border :$item="$for.item" :icon-size="24"></item-user>
            <div vertical flex style="min-width: 0;">
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{{$for.item.label || $for.item.id}}</span>
                <span class="hint" ~if="$for.item._placeLabel">{{$for.item._placeLabel}}</span>
            </div>
        </div>
    `,
    users: [],
    selectedIds: [],
    onToggle: null,
    onClear: null,
    isSelected(u) {
        return Boolean(u?.id && (this.selectedIds || []).includes(u.id));
    },
    toggle(u) {
        if (!u?.id) return;
        const set = new Set(this.selectedIds || []);
        if (set.has(u.id)) set.delete(u.id);
        else set.add(u.id);
        this.selectedIds = [...set];
        this.onToggle?.(u);
    },
    clearAll() {
        this.selectedIds = [];
        this.onClear?.();
        this.parentElement?.close?.(null);
    },
});

/**
 * Кнопка голосового диалога: вертикальные полосы спектра, нарисованные здесь (в наборе иконок такой нет).
 * Выключена — неподвижный силуэт; включена — полосы двигаются в такт голосу (setLevel(0..1) без перерисовки)
 * и слегка «дышат», пока тихо. prefers-reduced-motion — без движения, только высота по уровню.
 */
const BARS_BASE = [0.38, 0.66, 1, 0.66, 0.38];
ODA({ is: 'work-voice-bars',
    template: /*html*/`
        <style>
            :host { display: inline-flex; align-items: center; justify-content: center; gap: 2px; width: 100%; height: 100%; color: inherit; }
            i { display: block; width: 3px; height: 14px; border-radius: 2px; background: currentColor; transform-origin: 50% 50%; will-change: transform; }
        </style>
        <i ~for="bars" :style="'transform: scaleY(' + $for.item + ')'"></i>
    `,
    bars: BARS_BASE,
    on: {
        $attr: true,
        $def: false,
        set() {
            this._kick();
            if (!this.on)
                this.async(() => this.$$('i').forEach((el, i) => { el.style.transform = 'scaleY(' + BARS_BASE[i] + ')'; }));
        },
    },
    /** Уровень голоса 0..1 — вызывается часто, DOM не перерисовывается. */
    setLevel(v) {
        this._level = Math.max(0, Math.min(1, +v || 0));
    },
    attached() {
        this._t0 = performance.now();
        this._tick = () => {
            this._raf = 0;
            if (!this.on || !this.isConnected)
                return;
            const still = matchMedia?.('(prefers-reduced-motion: reduce)').matches;
            const t = (performance.now() - this._t0) / 1000;
            const bars = this.$$('i');
            this._smooth = (this._smooth ?? 0) + ((this._level || 0) - (this._smooth ?? 0)) * 0.35;
            for (let i = 0; i < bars.length; i++) {
                const wave = still ? 1 : 0.5 + 0.5 * Math.sin(t * (4.2 + i * 1.3) + i * 1.7);
                const idle = still ? 0.15 : 0.12 + 0.1 * wave;
                const v = Math.min(1, idle + this._smooth * (0.55 + 0.45 * wave));
                bars[i].style.transform = 'scaleY(' + (BARS_BASE[i] * (0.3 + 0.7 * v)).toFixed(3) + ')';
            }
            this._raf = requestAnimationFrame(this._tick);
        };
        this._kick();
    },
    detached() {
        cancelAnimationFrame(this._raf);
        this._raf = 0;
    },
    _kick() {
        if (this.on && !this._raf && this._tick)
            this._raf = requestAnimationFrame(this._tick);
    },
});

const DEFAULT_MENTION_ITEMS = [
    // Навыки (Skills)
    { kind: 'skill', id: 'grill-me', icon: 'carbon:notebook', description: 'Grill the user relentlessly about a plan, decision, or idea until reaching shared understanding («прожарь идею»)' },
    { kind: 'skill', id: 'office-documents', icon: 'carbon:notebook', description: 'Создание и редактирование таблиц Excel (.xlsx), документов Word (.docx) и презентаций (.pptx)' },
    { kind: 'skill', id: 'import-table', icon: 'carbon:notebook', description: 'Импорт таблиц (.xlsx / .csv) в справочники учётного ядра с проверкой дублей и dry_run' },
    { kind: 'skill', id: 'org-structure', icon: 'carbon:notebook', description: 'Проектирование и развёртывание оргструктуры подразделений ($structure) и рабочих мест (ROLES)' },
    { kind: 'skill', id: 'work-scenarios', icon: 'carbon:notebook', description: 'Типовые сценарии работы с регистрами учёта, справочниками и операциями WORK' },
    { kind: 'skill', id: 'delegate-task', icon: 'carbon:notebook', description: 'Постановка поручений сотрудникам со сроком исполнения и отслеживанием ответа' },
    { kind: 'skill', id: 'summarize-feed', icon: 'carbon:notebook', description: 'Сводка событий, сообщений, задач и документов по ленте подразделения за период' },
    { kind: 'skill', id: 'scheduled-report', icon: 'carbon:notebook', description: 'Настройка регулярных отчётов и регламентных задач по расписанию' },
    { kind: 'skill', id: 'doc-from-template', icon: 'carbon:notebook', description: 'Генерация договоров, писем и актов по шаблонам .docx / .md с подстановкой реквизитов' },
    { kind: 'skill', id: 'skill-authoring', icon: 'carbon:notebook', description: 'Сохранение удачно выполненной работы как нового навыка ИИ (SKILL.md)' },
    // Субагенты (Agents)
    { kind: 'agent', id: 'general', icon: 'bootstrap:robot', description: 'Универсальный субагент для многошаговых задач и параллельного выполнения' },
    { kind: 'agent', id: 'explore', icon: 'bootstrap:robot', description: 'Быстрая разведка по дереву классов, файлам и коду без внесения изменений' },
    { kind: 'agent', id: 'analyst', icon: 'bootstrap:robot', description: 'Финансовый и управленческий аналитик: отчёты, ОСВ, сверка таблиц и расчётов' },
    { kind: 'agent', id: 'operator', icon: 'bootstrap:robot', description: 'Учётный оператор: регистрация первичных документов, проверка аналитик и проводок' },
    { kind: 'agent', id: 'auditor', icon: 'bootstrap:robot', description: 'Аудитор учёта и безопасности: проверка корректности проводок, прав доступа и сторно' },
    { kind: 'agent', id: 'developer', icon: 'bootstrap:robot', description: 'Разработчик классов, методов, форм ODA и серверных модулей WORK' },
    { kind: 'agent', id: 'builder', icon: 'bootstrap:robot', description: 'Архитектор схемы данных: настройка METADATA.FIELDS, ANALYTICS и структуры классов' },
    { kind: 'agent', id: 'secretary', icon: 'bootstrap:robot', description: 'Делопроизводитель: подготовка писем, документов по шаблонам и протоколов встреч' },
    { kind: 'agent', id: 'web', icon: 'bootstrap:robot', description: 'Веб-исследователь: поиск информации и анализ внешних источников' },
    // Инструменты и MCP (Tools)
    { kind: 'tool', id: 'report', icon: 'carbon:tools', description: 'Учётный отчёт: Ведомость (sheet), Обороты (turnovers), Анализ счёта (analysis), Проводки (postings)' },
    { kind: 'tool', id: 'register_operation', icon: 'carbon:tools', description: 'Зарегистрировать и провести хозяйственную операцию с двойной записью' },
    { kind: 'tool', id: 'find_objects', icon: 'carbon:tools', description: 'Найти объекты в справочниках и журналах операций по фильтрам' },
    { kind: 'tool', id: 'describe_class', icon: 'carbon:tools', description: 'Прочитать схему класса (METADATA.FIELDS, ANALYTICS, OVERLAY) и доступные виды' },
    { kind: 'tool', id: 'write_table', icon: 'carbon:tools', description: 'Сохранить таблицу или выгрузку в файл Excel (.xlsx) или .csv' },
    { kind: 'tool', id: 'read_table', icon: 'carbon:tools', description: 'Прочитать строки и листы из таблицы .xlsx или .csv' },
    { kind: 'tool', id: 'create_office_file', icon: 'carbon:tools', description: 'Создать офисный документ Word (.docx), таблицу Excel (.xlsx) или презентацию (.pptx)' },
    { kind: 'tool', id: 'web_search', icon: 'carbon:tools', description: 'Поиск актуальной информации в интернете через коннекторы /SERVICES' },
    { kind: 'tool', id: 'install_skill', icon: 'carbon:plug', description: 'Установить внешний навык (SKILL.md) из OpenCode, Claude или GitHub' },
];

let _cachedServerMentions = null;
let _cachedServerMentionsAt = 0;

async function fetchServerMentionsCatalog() {
    if (_cachedServerMentions && Date.now() - _cachedServerMentionsAt < 60_000)
        return _cachedServerMentions;
    try {
        const srv = await globalThis.WORK?.get_item?.('/SERVICES');
        if (!srv || typeof srv.fetch !== 'function')
            return null;
        const res = await srv.fetch('mentions_catalog', {});
        if (res && (Array.isArray(res.skills) || Array.isArray(res.agents))) {
            _cachedServerMentions = res;
            _cachedServerMentionsAt = Date.now();
            return res;
        }
    }
    catch { /* fallback to DEFAULT_MENTION_ITEMS */ }
    return null;
}

ODA({ is: 'work-prompt-bar',
    imports: 'oda//button, oda//icon, ~/lib//tree, ~/lib//user, ~/lib//class-picker',
    template: /* html */`
        <style>
            :host { @apply --vertical; position: relative; }
            .mention-popup {
                position: absolute;
                left: 0;
                right: 0;
                bottom: calc(100% + 6px);
                z-index: 250;
                max-height: 292px;
                overflow-y: auto;
                background: var(--content-background, #1e293b);
                color: var(--content-color, #f8fafc);
                border: 1px solid var(--border-color, rgba(148, 163, 184, 0.28));
                border-radius: 12px;
                padding: 5px;
                box-shadow: 0 10px 28px -6px rgba(0, 0, 0, 0.28), 0 2px 8px rgba(0, 0, 0, 0.12);
                display: flex;
                flex-direction: column;
                gap: 1px;
            }
            .mention-item {
                display: flex;
                align-items: center;
                gap: 9px;
                padding: 7px 10px;
                border-radius: 8px;
                cursor: pointer;
                font-size: 13.5px;
                line-height: 1.35;
                min-width: 0;
                user-select: none;
            }
            .mention-item:hover,
            .mention-item[active] {
                background: var(--accent-soft, rgba(59, 130, 246, 0.14));
            }
            .mention-ic {
                flex-shrink: 0;
                opacity: 0.78;
            }
            .mention-id {
                font-weight: 600;
                flex-shrink: 0;
                white-space: nowrap;
                color: var(--content-color);
            }
            .mention-desc {
                flex: 1 1 auto;
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                color: var(--muted-color, #94a3b8);
                font-size: 13px;
            }
            .mention-tag {
                flex-shrink: 0;
                font-size: 10.5px;
                font-weight: 600;
                padding: 1px 6px;
                border-radius: 999px;
                opacity: 0.7;
                background: var(--subtle-background, rgba(148, 163, 184, 0.14));
            }
            .box {
                @apply --vertical; @apply --content;
                border: 1px solid var(--subtle-border, var(--border-color)); border-radius: var(--radius-l, 16px);
                box-shadow: 0 1px 2px var(--shadow-color), 0 6px 24px -12px var(--shadow-color);
                transition: border-color .15s, box-shadow .15s;
            }
            .box:focus-within:not([error]) { border-color: color-mix(in oklch, var(--accent-color) 55%, var(--subtle-border, transparent)); }
            .box[drag] { border-color: var(--accent-color); background: var(--accent-soft); }
            .box[error] { border-color: var(--error-color); }
            .chips { @apply --horizontal; flex-wrap: wrap; gap: 6px; padding: 10px 12px 0; }
            .file { @apply --chip; font-size: small; padding: 3px 4px 3px 10px; max-width: 220px; background: var(--subtle-background); }
            .file span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .file oda-button { padding: 0; border-radius: 50%; }
            textarea {
                border: none; outline: none; resize: none; background: transparent; color: inherit;
                font: inherit; font-size: 15px; line-height: 1.5; padding: 12px 16px 4px; height: 24px; max-height: 40vh;
                overflow-y: auto; box-sizing: content-box;
            }
            textarea::placeholder { color: var(--muted-color, inherit); opacity: .8; }
            .row { @apply --horizontal; align-items: center; gap: 4px; padding: 6px 8px 8px; min-width: 0; }
            .pill {
                @apply --horizontal; align-items: center; gap: 4px; height: 30px; padding: 0 10px; border-radius: 999px; flex-shrink: 1; min-width: 0;
                border: none; background: transparent; color: inherit; fill: currentColor; font: inherit; font-size: small; cursor: pointer; white-space: nowrap;
            }
            .pill:hover { background: var(--code-background, rgba(0,0,0,.05)); }
            .pill[plan] { color: var(--accent-color); }
            .pill[ask] { color: light-dark(darkorange, orange); }
            .pill span { overflow: hidden; text-overflow: ellipsis; max-width: 180px; }
            .icon-btn { width: 32px; height: 32px; border-radius: 50%; padding: 0; flex-shrink: 0; }
            .icon-btn[rec] { background: var(--error-soft); fill: var(--error-color); }
            .dialog-btn { width: 32px; height: 32px; border-radius: 50%; padding: 0; flex-shrink: 0; border: none; background: transparent; color: inherit; cursor: pointer; display: flex; align-items: center; justify-content: center; opacity: .75; }
            .dialog-btn:hover { background: var(--code-background, rgba(0,0,0,.05)); opacity: 1; }
            .dialog-btn:focus-visible { @apply --focus-ring; }
            .dialog-btn[on] { background: var(--accent-soft); color: var(--accent-color); opacity: 1; }
            .dialog-btn work-voice-bars { width: 20px; height: 20px; }
            .timer { color: var(--error-color); font-size: small; padding: 0 6px; white-space: nowrap; font-variant-numeric: tabular-nums; }
            .send {
                width: 34px; height: 34px; border-radius: 50%; border: none; cursor: pointer; flex-shrink: 0;
                display: flex; align-items: center; justify-content: center;
                background: var(--accent-color); color: var(--accent-back); fill: var(--accent-back);
                transition: opacity .15s, transform .1s;
            }
            .send:active { transform: scale(.94); }
            .send[disabled] { opacity: .3; cursor: default; }
            item-user { flex-shrink: 0; }
        </style>
        <div class="mention-popup" ~if="mentionOpen && mentionFiltered.length" @mousedown.prevent>
            <div class="mention-item" ~for="mentionFiltered" :active="$for.index === mentionIndex"
                @mouseenter="mentionIndex = $for.index" @tap.stop="applyMention($for.item)">
                <oda-icon class="mention-ic" no-flex :icon="$for.item.icon || 'carbon:notebook'" :icon-size="16"></oda-icon>
                <span class="mention-id">@{{$for.item.id}}</span>
                <span class="mention-desc" :title="$for.item.description">{{$for.item.description}}</span>
                <span class="mention-tag">{{$for.item.tagLabel}}</span>
            </div>
        </div>
        <div class="box" :error :drag @dragover="onDragOver" @dragleave="drag = false" @drop="onDrop">
            <div class="chips" ~if="files.length">
                <div class="file" ~for="files" :title="$for.item.name">
                    <oda-icon :icon="fileIcon($for.item)" :icon-size="14"></oda-icon>
                    <span>{{$for.item.name}}</span>
                    <oda-button icon="carbon:close" :icon-size="14" @tap="removeFile($for.index)"></oda-button>
                </div>
            </div>
            <textarea id="text" rows="1" :placeholder="recording ? 'Говорите…' : placeholder" :value="value" :readonly="recording"
                @input="onInput" @keydown="_onKeydown" @click="_onCaretMove" @keyup="_onCaretMove" @blur="_onBlur" @paste="_onPaste"></textarea>
            <div class="row">
                <oda-button class="icon-btn" icon="carbon:add" :icon-size="20" title="Действия: прикрепить файлы, выбрать получателей, создать операцию" @tap="onPlusTap($event)"></oda-button>
                <oda-button class="icon-btn" ~if="deptUsers?.length" icon="icons:supervisor-account" :icon-size="18" title="Получатели подразделения (если не выбраны — создаётся задача ИИ)" @tap="chooseReceivers($event)"></oda-button>
                <button class="pill" ~if="modes?.length" :plan="mode === 'plan'" :ask="mode === 'ask'" :title="modeMeta?.hint" @tap="chooseMode">
                    <oda-icon :icon="modeMeta?.icon" :icon-size="14"></oda-icon><span>{{modeMeta?.label}}</span><oda-icon icon="carbon:chevron-down" :icon-size="12"></oda-icon>
                </button>
                <item-user ~for="receivers" border no-flex :$item="$for.item" :icon-size="22" title="Снять получателя" @tap.stop="toggleReceiver($for.item)"></item-user>
                <div flex></div>
                <button class="pill" ~if="ai" :title="modelTitle" @pointerdown.stop="selectModel($event)">
                    <oda-icon :icon="modelIcon" :icon-size="16"></oda-icon><span>{{modelName}}</span><oda-icon icon="carbon:chevron-down" :icon-size="12"></oda-icon>
                </button>
                <span class="timer" ~if="recording">⏺ {{timer}}</span>
                <button class="dialog-btn" ~if="dialog" :on="dialogOn" :title="dialogOn ? 'Выключить голосовой диалог' : 'Голосовой диалог: говорите с агентом'" :aria-pressed="dialogOn ? 'true' : 'false'" @tap="toggleDialog">
                    <work-voice-bars :on="dialogOn"></work-voice-bars>
                </button>
                <oda-button class="icon-btn" ~if="speech && !dialog" :rec="recording" :icon="recording ? 'carbon:stop-filled' : 'carbon:microphone'" :icon-size="18"
                    :title="recording ? 'Остановить диктовку' : 'Диктовка'" @tap="toggleMic"></oda-button>
                <button class="send" :disabled="!canSend && !pending && !recording" :title="recording ? 'Остановить запись и отправить (Enter)' : (stopMode ? 'Остановить (Esc)' : (pending ? 'Отправить в очередь (Enter)' : 'Отправить (Enter)'))" @tap="onSendTap">
                    <oda-icon :icon="stopMode ? 'carbon:stop-filled' : 'carbon:arrow-up'" :icon-size="18"></oda-icon>
                </button>
            </div>
        </div>
    `,
    value: {
        $def: '',
        set(v) {
            if (!v)
                this.mentionOpen = false;
            this.async(() => this._autosize());
        },
    },
    files: [],
    mentionOpen: false,
    mentionQuery: '',
    mentionIndex: 0,
    _mentionStart: -1,
    _mentionEnd: -1,
    serverMentions: null,
    get mentionFiltered() {
        const srv = this.serverMentions;
        const rawList = [];
        const seen = new Set();
        const addItem = (it, tagLabel) => {
            if (!it?.id) return;
            const key = it.kind + ':' + String(it.id).toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            rawList.push({
                ...it,
                tagLabel: tagLabel || (it.kind === 'skill' ? 'skill' : it.kind === 'agent' ? 'agent' : it.kind === 'user' ? 'сотрудник' : 'tool'),
            });
        };

        if (srv) {
            for (const s of (srv.skills || [])) addItem(s, 'skill');
            for (const a of (srv.agents || [])) addItem(a, 'agent');
            for (const t of (srv.tools || [])) addItem(t, t.kind === 'mcp' ? 'mcp' : 'tool');
        }
        for (const d of DEFAULT_MENTION_ITEMS)
            addItem(d);

        for (const u of (this.deptUsers || [])) {
            const uid = u?.id || '';
            const label = u?.label || uid;
            if (!uid) continue;
            addItem({
                kind: 'user',
                id: label.replace(/\s+/g, '_'),
                userObj: u,
                icon: 'icons:person',
                description: (u._placeLabel ? u._placeLabel + ' · ' : '') + 'Получатель сообщения в подразделении',
            }, 'сотрудник');
        }

        const q = String(this.mentionQuery || '').trim().toLowerCase();
        if (!q)
            return rawList.slice(0, 30);

        const starts = [];
        const contains = [];
        for (const it of rawList) {
            const idLow = String(it.id || '').toLowerCase();
            const descLow = String(it.description || '').toLowerCase();
            if (idLow.startsWith(q))
                starts.push(it);
            else if (idLow.includes(q) || descLow.includes(q))
                contains.push(it);
        }
        return [...starts, ...contains].slice(0, 25);
    },
    ai: false,
    /** Вместо микрофона-диктовки — кнопка голосового диалога со спектром (форма задачи); событие dialog с новым состоянием. */
    dialog: { $attr: true, $def: false },
    dialogOn: false,
    /** Уровень голоса 0..1 для полос спектра — без перерисовки. */
    setDialogLevel(v) { this.$('work-voice-bars')?.setLevel(v); },
    toggleDialog() { this.fire('dialog', !this.dialogOn); },
    pending: false,
    recording: false,
    timer: '',
    error: false,
    drag: false,
    placeholder: 'Сообщение…',
    model: '',
    effort: '',
    /** Режимы: [{ id, label, icon, hint }] — пилюля выбора показывается, если задано. */
    modes: null,
    mode: '',
    receivers: [],
    deptUsers: [],
    operationClasses: [],
    /** Совместимость со старыми хостами (TTS убран из бара). */
    ttsMode: 'off',
    showTts: false,
    showUsage: false,
    get modelItem() {
        return this.model ? WORK.get_item(this.model) : null;
    },
    get modelName() {
        return String(this.model || '').split('/').pop() || 'Модель';
    },
    /** Иконка выбранной модели — её собственная (наследуется от провайдера), как в дереве /MODELS. */
    get modelIcon() {
        const fallback = 'carbon:machine-learning-model';
        if (!this.model)
            return fallback;
        return Promise.resolve(this.modelItem)
            .then(async m => (await m?.icon) || fallback)
            .catch(() => fallback);
    },
    /** Подсказка: провайдер и модель (одинаковые имена у разных провайдеров различимы). */
    get modelTitle() {
        const parts = String(this.model || '').split('/').filter(Boolean);
        return parts.length >= 3 ? 'Модель: ' + parts.slice(1).join(' / ') : 'Выбрать модель';
    },
    get modeMeta() {
        return (this.modes || []).find(m => m.id === this.mode) || this.modes?.[0];
    },
    get canSend() {
        return !!(String(this.value ?? '').trim() || this.files.length);
    },
    /** Идёт работа и поле пусто — кнопка «стоп»; есть текст — отправка (хост может поставить в очередь). */
    get stopMode() {
        return this.pending && !this.recording && !this.canSend;
    },
    get speech() {
        return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    },
    fileIcon(f) {
        return String(f?.type || '').startsWith('image/') ? 'carbon:image' : 'carbon:document';
    },
    attached() {
        this.async(() => this._autosize(), 50);
        this._ensureMentionsLoaded();
    },
    async _ensureMentionsLoaded() {
        const cat = await fetchServerMentionsCatalog();
        if (cat)
            this.serverMentions = cat;
    },
    _autosize() {
        const ta = this.$('#text');
        if (!ta)
            return;
        if (ta.value !== String(this.value ?? ''))
            ta.value = String(this.value ?? '');
        ta.style.height = 'auto';
        ta.style.height = Math.min(Math.max(24, ta.scrollHeight - 16), window.innerHeight * .4) + 'px';
    },
    onInput(e) {
        this.value = e.target.value;
        this._updateMentionState(e.target);
    },
    _onCaretMove(e) {
        if (e?.key && ['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(e.key))
            return;
        this._updateMentionState(e?.target || this.$('#text'));
    },
    _onBlur() {
        setTimeout(() => { this.mentionOpen = false; }, 160);
    },
    _updateMentionState(ta) {
        ta = ta || this.$('#text');
        if (!ta) {
            this.mentionOpen = false;
            return;
        }
        const text = String(ta.value ?? '');
        const pos = typeof ta.selectionStart === 'number' ? ta.selectionStart : text.length;
        const before = text.slice(0, pos);
        const m = /(?:^|[\s(])@([^\s@]*)$/.exec(before);
        if (!m) {
            this.mentionOpen = false;
            return;
        }
        const query = m[1] || '';
        const atPos = before.lastIndexOf('@');
        this._mentionStart = atPos;
        this._mentionEnd = pos;
        if (this.mentionQuery !== query)
            this.mentionIndex = 0;
        this.mentionQuery = query;
        this.mentionOpen = true;
        if (!this.serverMentions)
            this._ensureMentionsLoaded();
    },
    applyMention(item) {
        if (!item)
            return;
        const ta = this.$('#text');
        const text = String(this.value ?? '');
        const start = this._mentionStart >= 0 ? this._mentionStart : text.lastIndexOf('@');
        const end = this._mentionEnd >= start ? this._mentionEnd : text.length;
        if (item.kind === 'user' && item.userObj) {
            this.toggleReceiver(item.userObj);
        }
        const replacement = '@' + item.id + ' ';
        const nextValue = start >= 0
            ? text.slice(0, start) + replacement + text.slice(end)
            : (text ? text + ' ' + replacement : replacement);
        this.mentionOpen = false;
        this.value = nextValue;
        this.async(() => {
            if (ta) {
                ta.value = nextValue;
                const caret = (start >= 0 ? start : text.length) + replacement.length;
                ta.focus();
                ta.setSelectionRange?.(caret, caret);
                this._autosize();
            }
        }, 15);
    },
    _scrollMentionIntoView() {
        this.async(() => {
            const popup = this.$('.mention-popup');
            const active = popup?.querySelector?.('.mention-item[active]');
            active?.scrollIntoView?.({ block: 'nearest' });
        }, 10);
    },
    focusInput() {
        this.async(() => this.$('#text')?.focus(), 30);
    },
    selectInput() {
        this.async(() => this.$('#text')?.select(), 17);
    },
    clearFiles() {
        this.files = [];
        this.focusInput();
    },
    removeFile(index) {
        this.files = this.files.filter((_, i) => i !== index);
        this.focusInput();
    },
    _addFiles(list) {
        if (!list?.length)
            return;
        const files = [...this.files];
        for (const f of list) {
            let n = f.name;
            let i = n.lastIndexOf('/');
            if (i > 0)
                n = n.slice(i + 1);
            i = n.lastIndexOf('.');
            if (i > 0) {
                f.label = n.slice(0, i);
                f.ext = n.slice(i + 1);
            }
            if (!files.find(x => x.name === f.name))
                files.push(f);
        }
        this.files = files;
        this.focusInput();
    },
    async getFile() {
        const list = await ODA.showFileDialog({ multiple: true });
        if (!list?.length)
            return;
        this._addFiles([...list]);
        window.focus();
    },
    /** Скриншот из буфера часто `image.png` — без уникального имени второй paste отсекается дедупом. */
    _namePaste(f, i = 0) {
        const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
        const generic = !f.name || /^image\.\w+$/i.test(f.name);
        const name = generic ? `paste-${Date.now()}${i ? '-' + i : ''}.${ext}` : f.name;
        return f.name === name ? f : new File([f], name, { type: f.type, lastModified: Date.now() });
    },
    _onPaste(e) {
        const images = [...(e.clipboardData?.items || [])]
            .filter(it => it.kind === 'file' && it.type.startsWith('image/'))
            .map(it => it.getAsFile()).filter(Boolean);
        if (!images.length)
            return;
        e.preventDefault();
        this._addFiles(images.map((f, i) => this._namePaste(f, i)));
    },
    onDragOver(e) {
        if ([...(e.dataTransfer?.types || [])].includes('Files')) {
            e.preventDefault();
            this.drag = true;
        }
    },
    onDrop(e) {
        this.drag = false;
        const list = e.dataTransfer?.files;
        if (!list?.length)
            return;
        e.preventDefault();
        this._addFiles([...list]);
    },
    _onKeydown(e) {
        if (this.mentionOpen && this.mentionFiltered.length) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                e.stopPropagation();
                this.mentionIndex = (this.mentionIndex + 1) % this.mentionFiltered.length;
                this._scrollMentionIntoView();
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                e.stopPropagation();
                this.mentionIndex = (this.mentionIndex - 1 + this.mentionFiltered.length) % this.mentionFiltered.length;
                this._scrollMentionIntoView();
                return;
            }
            if ((e.key === 'Enter' && !e.ctrlKey && !e.shiftKey && !e.altKey) || e.key === 'Tab') {
                e.preventDefault();
                e.stopPropagation();
                const chosen = this.mentionFiltered[this.mentionIndex] || this.mentionFiltered[0];
                if (chosen)
                    this.applyMention(chosen);
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                this.mentionOpen = false;
                return;
            }
        }
        if (e.code === 'Space' && e.ctrlKey) {
            this.value = this.value.fixKeyboardLayout();
            return;
        }
        if (e.key === 'Enter' && e.ctrlKey) {
            this.getFile();
            return;
        }
        if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.isComposing) {
            e.preventDefault();
            if (this.canSend || this.recording)
                this.onSendTap();
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            if (this.pending) {
                this.fire('stop');
                return;
            }
            if (this.recording) {
                this._mic().undoLastWord();
                return;
            }
            this.value = '';
            this.files = [];
            this.fire('clear');
            this.focusInput();
            return;
        }
        this.fire('prompt-key', e);
    },
    _mic() {
        return this._audioController ??= new MicAudioController(this);
    },
    toggleMic() {
        this._mic().toggle();
    },
    onSendTap() {
        if (this._sendPending)
            return;
        if (this.recording)
            return this._sendAfterStop();
        if (this.stopMode) {
            this.fire('stop');
            return;
        }
        if (!this.canSend)
            return;
        this.fire('send');
    },
    /** Send во время записи: остановить диктовку, дождаться финала и отправить один раз. */
    async _sendAfterStop() {
        if (this._sendPending)
            return;
        this._sendPending = true;
        try {
            await this._mic().stopAndFlush();
        }
        finally {
            this._sendPending = false;
        }
        if (!this.canSend)
            return;
        this.fire('send');
    },
    async _menu(e, options, value) {
        const el = ODA.createComponent('work-prompt-menu', { options, value });
        try {
            return await WORK.showDropdown(el, {}, e.currentTarget || e.target);
        }
        catch (err) {
            if (err instanceof WORK.CancelError)
                return null;
            throw err;
        }
    },
    async onPlusTap(e) {
        const hasUsers = Array.isArray(this.deptUsers) && this.deptUsers.length > 0;
        const hasOps = Array.isArray(this.operationClasses) && this.operationClasses.length > 0;
        if (!hasUsers && !hasOps)
            return this.getFile();
        const anchor = e?.currentTarget || e?.target || this;
        const options = [
            { id: 'files', label: 'Изображения и файлы', icon: 'carbon:attachment', hint: 'Прикрепить файлы с диска (Ctrl+Enter)' },
        ];
        if (hasUsers) {
            options.push({
                id: 'receivers',
                label: 'Получатели подразделения',
                icon: 'icons:supervisor-account',
                hint: this.receivers?.length
                    ? 'Выбрано: ' + this.receivers.map(u => u.label || u.id).join(', ')
                    : '@ — выбрать сотрудников (если не выбраны — задача ИИ)',
            });
        }
        if (hasOps) {
            options.push({
                id: 'operations',
                label: 'Создать операцию…',
                icon: 'carbon:task-complete',
                hint: '/ — новый документ в доступном классе операций',
            });
        }
        const picked = await this._menu({ currentTarget: anchor }, options, '');
        if (picked === 'files')
            return this.getFile();
        if (picked === 'receivers')
            return this.chooseReceivers({ currentTarget: anchor });
        if (picked === 'operations')
            return this.chooseOperationClass({ currentTarget: anchor });
    },
    toggleReceiver(user) {
        if (!user?.id) return;
        const list = Array.isArray(this.receivers) ? [...this.receivers] : [];
        const idx = list.findIndex(u => u?.id === user.id);
        if (idx >= 0)
            list.splice(idx, 1);
        else
            list.push(user);
        this.receivers = list;
        this.fire('receivers-changed', list);
    },
    async chooseReceivers(e) {
        const users = Array.isArray(this.deptUsers) ? this.deptUsers : [];
        if (!users.length) return;
        const anchor = e?.currentTarget || e?.target || this;
        const el = ODA.createComponent('work-receivers-menu', {
            users,
            selectedIds: (this.receivers || []).map(u => u?.id).filter(Boolean),
            onToggle: (u) => this.toggleReceiver(u),
            onClear: () => {
                this.receivers = [];
                this.fire('receivers-changed', []);
            },
        });
        try {
            await WORK.showDropdown(el, { TITLE: { label: 'Получатели подразделения' } }, anchor);
        }
        catch (err) {
            if (!(err instanceof WORK.CancelError))
                throw err;
        }
        this.focusInput();
    },
    async chooseOperationClass() {
        const ops = Array.isArray(this.operationClasses) ? this.operationClasses : [];
        if (!ops.length) return;
        const buildFn = globalThis.__workClassPicker?.buildClassTree || globalThis.WORK?.buildClassTree;
        const pickFn = globalThis.__workClassPicker?.pickClassFromTree || globalThis.WORK?.pickClassFromTree;
        if (typeof buildFn !== 'function' || typeof pickFn !== 'function') return;
        const tree = buildFn({
            classes: ops,
            defaultIcon: 'carbon:task-complete',
            defaultType: '$operation',
        });
        if (!tree.length) return;
        const id = await pickFn(tree, {
            title: 'Создать операцию',
        });
        if (id)
            this.fire('create-operation', { path: id });
        this.focusInput();
    },
    async chooseMode(e) {
        const id = await this._menu(e, this.modes || [], this.mode);
        if (id)
            this.mode = id;
        this.focusInput();
    },
    async selectModel(e) {
        const modelsRoot = await WORK.get_item('/MODELS');
        try {
            if (modelsRoot?.[R]?.cache)
                delete modelsRoot[R].cache.items;
            const localNode = WORK.items?.['/MODELS/Local'];
            if (localNode?.[R]?.cache)
                delete localNode[R].cache.items;
        }
        catch { /* ignore */ }
        const tree = ODA.createElement('item-tree', {
            $item: modelsRoot, hideTops: 1, hideRoots: 2, allowCategories: false, onlyChatModels: true,
            execute(item) {
                if (!isChatModel(item))
                    return;
                this.parentElement.close(item);
            },
        });
        let item;
        try {
            item = await WORK.showDropdown(tree, { TITLE: { label: 'Модель' } }, e.currentTarget || e);
        }
        catch (err) {
            if (err instanceof WORK.CancelError)
                return;
            throw err;
        }
        if (!item)
            return;
        setUserPreferredModel(item.path);
        this.model = item.path;
        this.focusInput();
    },
})

const MIC_DICT = {
    точка: '.', запятая: ',', вопрос: '?', восклицание: '!',
    двоеточие: ':', тире: '-', абзац: '\n', отступ: '\t',
};

class MicAudioController {
    constructor(bar) {
        this.bar = bar;
    }
    pad(val) {
        return (val + '').length < 2 ? '0' + val : '' + val;
    }
    toggle() {
        if (!this.bar.recording)
            this.start();
        else
            this.stop();
    }
    start() {
        navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
            if (!this._setupRecognition()) {
                stream.getTracks().forEach(t => t.stop());
                return;
            }
            this.recognition.start();
            this.recognizing = true;
            this._armFlush();
            this.bar.recording = true;
            // уже набранный текст не стираем: диктовка дописывает его
            this._prefix = String(this.bar.value || '').trim();
            if (this._prefix)
                this._prefix += ' ';
            this._beep('start');
            this._startTimer();
            this.bar.focusInput();
            if (this.bar.ai) {
                stream.getTracks().forEach(t => t.stop());
                return;
            }
            this.mediaStream = stream;
            this.mediaRecorder = new MediaRecorder(stream);
            const chunks = [];
            this.mediaRecorder.ondataavailable = e => {
                chunks.push(e.data);
                if (this.mediaRecorder.state !== 'inactive') return;
                this.bar.files = [...this.bar.files, this._makeFile(chunks)];
                this._mediaDone = true;
                this._maybeResolveFlush();
            };
            this.mediaRecorder.start();
        }).catch(e => console.warn('[mic]', e.message));
    }
    /** Только стоп записи — без send; текст остаётся в поле для правки. */
    stop() {
        // На момент тапа последний фрагмент нередко ещё interim. Не заменять видимый
        // пользователю текст на final_transcript до асинхронного onresult/onend.
        this._textAtStop = String(this.bar.value || '').trim();
        this.recognizing = false;
        try { this.recognition?.stop(); } catch {}
        clearInterval(this.timerInterval);
        this.bar.recording = false;
        this.bar.timer = '';
        this._beep('end');
        if (!this.bar.ai) {
            try { this.mediaRecorder?.stop(); } catch {}
            this.mediaStream?.getTracks().forEach(t => t.stop());
            this.bar.focusInput();
            return;
        }
        this.bar.focusInput();
    }
    /** Остановить запись и дождаться финала транскрипта (и аудиофайла) — для отправки одним тапом. */
    stopAndFlush() {
        this.stop();
        // Отсчёт начинается после остановки, а не при старте записи: иначе
        // при диктовке дольше 3 секунд Promise уже завершён до нажатия Send.
        if (this._flushResolve && !this._flushTimer)
            this._flushTimer = setTimeout(() => this._resolveFlush(), 3000);
        return this._flushed || Promise.resolve();
    }
    /** Взвести ожидание финала: конец recognition + (вне ИИ) дописанный аудиофайл; страховка — 3с. */
    _armFlush() {
        this._recEnded = false;
        this._mediaDone = false;
        clearTimeout(this._flushTimer);
        this._flushTimer = null;
        this._flushed = new Promise(r => this._flushResolve = r);
    }
    _resolveFlush() {
        if (!this._flushResolve)
            return;
        if (!String(this.bar.value || '').trim())
            this.bar.value = this._textAtStop || (this.final_transcript || '').trim();
        this._flushResolve();
        this._flushResolve = null;
        clearTimeout(this._flushTimer);
        this._flushTimer = null;
    }
    _maybeResolveFlush() {
        if (!this._flushResolve || !this._recEnded)
            return;
        if (!this.bar.ai && !this._mediaDone)
            return;
        this._resolveFlush();
    }
    /** Esc при записи: последнее слово из value; final = value, interim сброс. */
    undoLastWord() {
        const parts = String(this.bar.value || '').trim().split(/\s+/).filter(Boolean);
        parts.pop();
        const next = parts.join(' ');
        this.bar.value = next;
        const prefix = this._prefix || '';
        this.final_transcript = prefix && next.startsWith(prefix.trim()) ? next.slice(prefix.trim().length).trim() : next;
        this.ignoreInterim = true;
        try { this.recognition?.stop(); } catch {}
    }
    _setupRecognition() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) {
            this.bar.value = 'Распознавание речи не поддерживается браузером';
            return;
        }
        this.final_transcript = '';
        this.ignoreInterim = false;
        this.recognition = new SR();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.maxAlternatives = 3;
        this.recognition.lang = 'ru-RU';
        this.recognition.onerror = ({ error }) => console.error(error);
        this.recognition.onend = () => {
            if (!this.recognizing) {
                this._recEnded = true;
                // Если при stop() браузер не выдал финальный onresult, используем
                // interim, который уже был показан в поле до остановки.
                if (!String(this.bar.value || '').trim())
                    this.bar.value = this._textAtStop || (this.final_transcript || '').trim();
                this._maybeResolveFlush();
                return;
            }
            try { this.recognition.start(); } catch {}
        };
        this.recognition.onresult = e => {
            let interim = '';
            let gotFinal = false;
            for (let i = e.resultIndex; i < e.results.length; i++) {
                if (e.results[i].isFinal) {
                    this.final_transcript += this._editInterim(e.results[i][0].transcript);
                    gotFinal = true;
                }
                else if (!this.ignoreInterim)
                    interim += e.results[i][0].transcript;
            }
            if (gotFinal)
                this.ignoreInterim = false;
            this.final_transcript = this.final_transcript.replace(/\s([\.+,?!:-])/g, '$1');
            this.bar.value = ((this._prefix || '') + (this.final_transcript + (interim ? ' ' + interim : '')).trim()).trim();
        };
        return this.recognition;
    }
    async _beep(which) {
        const file = which === 'end' ? 'beep-end.mp3' : 'beep-start.mp3';
        this._beeps ??= {};
        if (!this._beeps[file]) {
            let src = '/~/lib/prompt-bar/' + file;
            if (window.$context?.short)
                src = window.$context.short + src;
            const res = await fetch(src);
            if (!res.ok) return;
            this._beeps[file] = URL.createObjectURL(await res.blob());
        }
        new Audio(this._beeps[file]).play().catch(() => {});
    }
    _startTimer() {
        this.bar.timer = '00:00';
        let sec = 0;
        this.timerInterval = setInterval(() => {
            sec++;
            this.bar.timer = this.pad(Math.floor(sec / 60)) + ':' + this.pad(sec % 60);
            if (sec > 180) this.stop();
        }, 1000);
    }
    _editInterim(s) {
        return s.split(' ').map(word => {
            word = word.trim();
            return MIC_DICT[word] || word;
        }).join(' ');
    }
    _makeFile(chunks) {
        const blob = new Blob(chunks, { type: 'audio/mpeg' });
        return new File([blob], 'record.mp3', { type: blob.type, lastModified: Date.now() });
    }
}

export { MicAudioController };
