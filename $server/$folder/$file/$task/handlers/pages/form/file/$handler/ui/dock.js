/**
 * Шапка задачи и панель доков.
 *   microchat-header  — единственная шапка: заголовок, статус, кнопка контекста (кольцо % — показ/скрытие доков), закрыть.
 *                       В странице form (work-form) встраивается в её шапку (slot top-panel) без заголовка.
 *   microchat-dock    — вкладки: «Контекст» (статистика сессии) + доки: файлы, отчёты субагентов, развёрнутые ответы.
 *   microchat-context — статистика: модель, лимит, токены, сообщения, разбивка контекста, исходные сообщения, экспорт.
 *   microchat-doc     — просмотр дока: html/pdf — страница, картинка, markdown, текст; копировать/сохранить/открыть.
 * Состояние (docs, dockOpen, dockTab, stats) — у шелла (file.js); компоненты читают его через shell.
 */
import { extOf, fileItemOf, fileUrl, copyText, findShell, fmtTime, linkifyWork, workHref } from './util.js';
import { fmtNum, fmtDate } from './docs.js';
import '/$server/$folder/lib/dot/dot.js';
import '/$server/$folder/lib/chat-item/chat-item.js';
import { dotStateOfTask } from '/$server/$folder/lib/dot/dot-math.js';

let snapshotName;
try {
    ({ snapshotName } = await import('/sources/modules/agent/util.js'));
}
catch {
    ({ snapshotName } = await import('../../../../../../../../../../sources/modules/agent/util.js'));
}

const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'];
const PAGE = ['html', 'htm', 'pdf'];
const VIDEO = ['mp4', 'webm'];
const VIDEO_EXT = new Set(['mp4', 'webm']);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']);
const BINARY = ['docx', 'xlsx', 'xls', 'pptx', 'ppt', 'zip', 'rar', '7z', 'tar', 'gz', 'exe', 'dll', 'so', 'bin'];

/** Иконка по расширению файла. */
function extIcon(snapshot) {
    const ext = String(snapshot || '').split('.').pop().toLowerCase();
    if (VIDEO_EXT.has(ext))
        return 'carbon:video';
    if (IMAGE_EXT.has(ext))
        return 'carbon:image';
    if (ext === 'xlsx' || ext === 'xls')
        return 'carbon:table';
    if (ext === 'md' || ext === 'markdown')
        return 'carbon:document';
    return 'carbon:document';
}

const STATUS = {
    idle: { label: 'Готово', icon: 'carbon:checkmark' },
    running: { label: 'Работает', icon: 'spinners:3-dots-scale' },
    waiting: { label: 'Ждёт вас', icon: 'carbon:help' },
    needs_review: { label: 'Нужна проверка', icon: 'carbon:warning' },
    stopped: { label: 'Остановлено', icon: 'carbon:pause' },
    error: { label: 'Ошибка', icon: 'carbon:warning' },
    limit: { label: 'Лимит шагов', icon: 'carbon:warning' },
};

ODA({ is: 'microchat-header',
    imports: 'oda//button, oda//icon',
    template: /*html*/`
        <style>
            :host { @apply --horizontal; align-items: center; gap: 8px; min-width: 0; box-sizing: border-box; }
            :host(:not([inline])) { padding: 6px 10px 6px 16px; border-bottom: 1px solid var(--subtle-border); min-height: 44px; }
            :host([inline]) { padding: 0 6px; max-width: 45vw; }
            :host([inline]) .title { font-weight: 500; font-size: small; opacity: .9; }
            .title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
            .chip { @apply --chip; }
            .chip[running] { background: var(--accent-soft); border-color: transparent; }
            .chip[waiting] { background: var(--warning-soft); border-color: transparent; }
            .chip[bad] { background: var(--error-soft); border-color: transparent; }
            :host([inline]) .chip { background: var(--content-background); color: var(--content-color); }
            .ring {
                position: relative; width: 30px; height: 30px; border: none; padding: 0; border-radius: 50%;
                background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; color: inherit;
            }
            .ring:hover, .ring[on] { background: var(--accent-soft); }
            :host([inline]) .ring:hover, :host([inline]) .ring[on] { background: rgba(255,255,255,.2); }
            .ring svg { position: absolute; inset: 3px; transform: rotate(-90deg); }
            .ring span { font-size: 8px; font-weight: 700; }
            .dot { position: absolute; top: 2px; right: 2px; width: 7px; height: 7px; border-radius: 50%; background: var(--accent-color); }
            oda-button { border-radius: var(--radius-s); padding: 2px; }
            oda-button[on] { background: var(--accent-soft); }
            :host([inline]) oda-button[on] { background: rgba(255,255,255,.2); }
        </style>
        <work-dot no-flex :size="inline ? 22 : 26" :state="dotState" :eyes="look.eyes || 'round'" :accessory="look.accessory || 'none'" :color="look.color || ''" :title="statusMeta.label"></work-dot>
        <span class="title" flex :title="title">{{title}}</span>
        <span class="chip" no-flex :running="status === 'running'" :waiting="status === 'waiting'" :bad="status === 'error' || status === 'limit' || status === 'needs_review'">
            <oda-icon :icon="statusMeta.icon" :icon-size="12"></oda-icon>{{statusMeta.label}}
        </span>
        <oda-button no-flex ~if="canEnablePush" icon="carbon:notification" :icon-size="17" title="Включить уведомления задач" @tap="enablePush"></oda-button>
        <button class="ring" no-flex :on="dockOpen" :title="ringTitle" @tap="toggleDock">
            <svg viewBox="0 0 24 24" width="24" height="24">
                <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-opacity=".18" stroke-width="2.5"></circle>
                <circle cx="12" cy="12" r="10" fill="none" stroke="var(--accent-color)" stroke-width="2.5" stroke-linecap="round"
                    :stroke-dasharray="dash"></circle>
            </svg>
            <span>{{pct}}</span>
            <i class="dot" ~if="fresh"></i>
        </button>
        <oda-button no-flex ~if="closable" icon="carbon:close" :icon-size="18" title="Закрыть" @tap="close"></oda-button>
    `,
    shell: null,
    inline: { $attr: true, $def: false },
    attached() {
        this.shell ??= findShell(this);
    },
    get title() { return this.shell?.title || 'Задача'; },
    get status() { return this.shell?.status || 'idle'; },
    get look() { return this.shell?.look || {}; },
    /** Персонаж в шапке: статус задачи одним взглядом (работает, ждёт вас, ошибка). */
    get dotState() {
        if (this.shell?.voiceOn && this.shell?._voice?.state === 'speaking')
            return 'speaking';
        return dotStateOfTask(this.status);
    },
    get statusMeta() {
        if (this.status === 'idle' && this.shell?.data && !this.shell.items?.length)
            return { label: 'Новая', icon: 'carbon:add-alt' };
        return STATUS[this.status] || STATUS.idle;
    },
    get stats() { return this.shell?.stats; },
    get pct() { return (this.stats?.pct ?? 0) + '%'; },
    get dash() {
        const c = 2 * Math.PI * 10;
        const v = Math.max(0, Math.min(100, this.stats?.pct || 0)) / 100 * c;
        return v.toFixed(1) + ' ' + c.toFixed(1);
    },
    get dockOpen() { return !!this.shell?.dockOpen; },
    get fresh() { return !this.dockOpen && !!this.shell?.freshDocs; },
    get closable() { return !!this.shell?.closable && !this.inline; },
    pushEnabled: false,
    get canEnablePush() { return !this.pushEnabled && typeof Notification !== 'undefined' && Notification.permission !== 'granted'; },
    async enablePush() {
        const ok = await window.WORK?.top?.WORK?.enableTaskNotifications?.(true);
        this.pushEnabled = !!ok;
        if (!ok)
            ODA.showMessage?.('Уведомления не включены: проверьте разрешение браузера и вход в WORK');
    },
    get ringTitle() {
        const s = this.stats;
        const docs = this.shell?.files?.length || 0;
        return 'Контекст: ' + fmtNum(s?.used) + (s?.limit ? ' из ' + fmtNum(s.limit) : '') + ' токенов' + (docs ? ' · файлов: ' + docs : '') + '\nПоказать/скрыть доки';
    },
    toggleDock() { this.shell?.toggleDock(); },
    close() { this.shell?.closeView(); },
});

ODA({ is: 'microchat-dock',
    imports: 'oda//button, oda//icon',
    template: /*html*/`
        <style>
            :host { @apply --vertical; overflow: hidden; min-width: 0; border-left: 1px solid var(--subtle-border); background: var(--subtle-background); }
            .tabs { @apply --horizontal; align-items: center; gap: 2px; padding: 6px 8px; border-bottom: 1px solid var(--subtle-border); overflow-x: auto; min-height: 44px; box-sizing: border-box; }
            .tab {
                @apply --horizontal; align-items: center; gap: 6px; flex-shrink: 0; max-width: 200px; height: 30px; padding: 0 10px;
                border-radius: var(--radius-s); cursor: pointer; font-size: small; user-select: none; border: 1px solid transparent;
            }
            .tab:hover { background: var(--code-background); }
            .tab:focus-visible { @apply --focus-ring; }
            .tab[on] { background: var(--content-background); border-color: var(--subtle-border); font-weight: 600; }
            .tab span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .tab i { font-style: normal; font-size: x-small; font-weight: 600; min-width: 16px; height: 16px; border-radius: 8px; padding: 0 4px; box-sizing: border-box; text-align: center; line-height: 16px; background: var(--accent-soft); }
            .tabs oda-button { border-radius: var(--radius-s); padding: 2px; }
            .sheet { overflow: hidden; min-height: 0; }
        </style>
        <div class="tabs" no-flex role="tablist">
            <div class="tab" ~for="tabs" role="tab" tabindex="0" :aria-selected="tab === $for.item.id ? 'true' : 'false'" :on="tab === $for.item.id"
                :title="$for.item.title" @tap="select($for.item.id)" @keydown="tabKey($event, $for.item.id)">
                <oda-icon :icon="$for.item.icon" :icon-size="14"></oda-icon><span>{{$for.item.label}}</span><i ~if="$for.item.count">{{$for.item.count}}</i>
            </div>
            <div flex></div>
            <oda-button no-flex icon="carbon:close" :icon-size="16" title="Скрыть доки" @tap="hide"></oda-button>
        </div>
        <div class="sheet" flex vertical>
            <div flex vertical ~if="tab === 'context'" style="min-height:0"><microchat-context flex></microchat-context></div>
            <div flex vertical ~if="tab === 'monitor'" style="min-height:0"><microchat-monitor flex></microchat-monitor></div>
            <div flex vertical ~if="tab === 'results'" style="min-height:0"><microchat-results flex></microchat-results></div>
            <div flex vertical ~if="tab === 'files'" style="min-height:0"><microchat-files flex></microchat-files></div>
        </div>
    `,
    get shell() { return findShell(this); },
    get docs() { return this.shell?.docs || []; },
    /** Опубликованные результаты (из data.results) и отчёты субагентов. */
    get results() { return this.shell?.data?.results || []; },
    get reports() { return this.docs.filter(d => d.kind === 'text'); },
    /** Вкладка живёт в шелле (dockTab): openDoc и новые файлы переключают её оттуда. */
    get tab() { return this.shell?.dockTab || 'context'; },
    /** Компьютер использовался в задаче — «Монитор» есть и после его удаления (скриншоты и команды остаются в ленте). */
    get hasComputer() { return !!this.shell?.computer?.used; },
    get hasResults() { return this.results.length + this.reports.length > 0; },
    get fileCount() { return this.shell?.files?.length || 0; },
    get tabs() {
        const list = [{ id: 'context', label: 'Контекст', icon: 'carbon:chart-pie', title: 'Статистика сессии' }];
        if (this.hasComputer)
            list.push({ id: 'monitor', label: 'Монитор', icon: 'carbon:screen', title: 'Компьютер агента' });
        if (this.hasResults)
            list.push({ id: 'results', label: 'Результаты', icon: 'carbon:report', title: 'Результаты работы', count: this.results.length + this.reports.length });
        if (this.fileCount)
            list.push({ id: 'files', label: 'Файлы', icon: 'carbon:folder', title: 'Файлы задачи: ваши вложения и созданное агентом', count: this.fileCount });
        return list;
    },
    select(key) { this.shell?.selectTab(key); },
    tabKey(e, key) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.select(key);
        }
    },
    hide() { findShell(this)?.toggleDock(false); },
});

ODA({ is: 'microchat-context',
    imports: 'oda//button, oda//icon',
    template: /*html*/`
        <style>
            :host { @apply --vertical; overflow-y: auto; padding: 16px 20px 24px; gap: 20px; font-size: small; user-select: text; }
            .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 16px 24px; }
            .k { @apply --muted; font-size: x-small; margin-bottom: 2px; }
            .v { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; }
            .cap { @apply --muted; font-size: x-small; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 8px; }
            .bar { @apply --horizontal; height: 10px; border-radius: 5px; overflow: hidden; background: var(--subtle-border); }
            .bar div { height: 100%; }
            .legend { @apply --horizontal; flex-wrap: wrap; gap: 6px 14px; margin-top: 8px; }
            .legend span { @apply --horizontal; align-items: center; gap: 6px; }
            .legend i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
            .msgs { @apply --vertical; border: 1px solid var(--subtle-border); border-radius: var(--radius-m); overflow: hidden; }
            .msg { border-bottom: 1px solid var(--subtle-border); }
            .msg:last-child { border-bottom: none; }
            .msg .row { @apply --horizontal; align-items: center; gap: 8px; padding: 7px 12px; cursor: pointer; }
            .msg .row:hover { background: var(--code-background); }
            .msg .row b { font-weight: 600; }
            .msg .row .id { @apply --muted; font-family: var(--font-mono); font-size: x-small; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
            .msg .row .t { @apply --muted; font-size: x-small; white-space: nowrap; margin-left: auto; }
            pre { margin: 0; padding: 8px 12px; background: var(--code-background); font-family: var(--font-mono); font-size: 11px; max-height: 320px; overflow: auto; white-space: pre-wrap; word-break: break-word; }
            .head { @apply --horizontal; align-items: center; }
            .head oda-button { border-radius: var(--radius-s); padding: 2px 8px; font-size: x-small; }
        </style>
        <div class="grid">
            <div><div class="k">Сессия</div><div class="v" :title="s.title">{{s.title}}</div></div>
            <div><div class="k">Сообщения</div><div class="v">{{fmtNum(s.items)}}</div></div>
            <div><div class="k">Провайдер</div><div class="v">{{s.provider}}</div></div>
            <div><div class="k">Модель</div><div class="v" :title="s.model">{{s.modelName}}</div></div>
            <div><div class="k">Лимит контекста</div><div class="v">{{s.limit ? fmtNum(s.limit) : '—'}}</div></div>
            <div><div class="k">Использование</div><div class="v">{{s.pct}}% · {{fmtNum(s.used)}}</div></div>
            <div><div class="k">Всего токенов</div><div class="v">{{fmtNum(s.total)}}</div></div>
            <div><div class="k">Входные токены</div><div class="v">{{fmtNum(s.input)}}</div></div>
            <div><div class="k">Выходные токены</div><div class="v">{{fmtNum(s.output)}}</div></div>
            <div><div class="k">Рассуждение (оценка)</div><div class="v">{{fmtNum(s.reasoning)}}</div></div>
            <div><div class="k">Сообщения пользователя</div><div class="v">{{fmtNum(s.users)}}</div></div>
            <div><div class="k">Ходы агента</div><div class="v">{{fmtNum(s.assistant)}}</div></div>
            <div><div class="k">Вызовы инструментов</div><div class="v">{{fmtNum(s.calls)}}{{s.callErrors ? ' · ошибок ' + s.callErrors : ''}}</div></div>
            <div><div class="k">Сжато элементов</div><div class="v">{{fmtNum(s.compacted)}}</div></div>
            <div><div class="k">Сессия создана</div><div class="v">{{fmtDate(s.created)}}</div></div>
            <div><div class="k">Последняя активность</div><div class="v">{{fmtDate(s.updated)}}</div></div>
        </div>
        <div ~if="s.parts?.length">
            <div class="cap">Разбивка контекста (последний ход, оценка)</div>
            <div class="bar"><div ~for="s.parts" ~style="{width: $for.item.pct + '%', background: $for.item.color}" :title="$for.item.label + ': ' + $for.item.tokens"></div></div>
            <div class="legend"><span ~for="s.parts"><i ~style="{background: $for.item.color}"></i>{{$for.item.label}} {{$for.item.pct}}%</span></div>
        </div>
        <div>
            <div class="head">
                <div class="cap" flex>Исходные сообщения</div>
                <oda-button icon="carbon:download" :icon-size="14" label="Экспортировать сессию" @tap="exportSession"></oda-button>
            </div>
            <div class="msgs">
                <div class="msg" ~for="items">
                    <div class="row" @tap="toggle($for.item.id)">
                        <b>{{$for.item.type}}</b><span class="id">• {{$for.item.id}}</span>
                        <span class="t">{{fmtDate($for.item.time)}}</span>
                        <oda-icon :icon="openId === $for.item.id ? 'carbon:chevron-up' : 'carbon:chevron-down'" :icon-size="12"></oda-icon>
                    </div>
                    <pre ~if="openId === $for.item.id">{{json($for.item)}}</pre>
                </div>
            </div>
        </div>
    `,
    openId: '',
    fmtNum,
    fmtDate,
    get s() { return this.$pdp?.stats || {}; },
    get items() { return this.$pdp?.data?.items || []; },
    toggle(id) { this.openId = this.openId === id ? '' : id; },
    json(v) { return JSON.stringify(v, null, 2); },
    exportSession() {
        const data = this.$pdp?.data;
        if (!data)
            return;
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (String(this.s.title || 'task').replace(/[\\/:*?"<>|\n]+/g, ' ').slice(0, 60).trim() || 'task') + '.task.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
});

ODA({ is: 'microchat-monitor',
    imports: 'oda//button, oda//icon',
    template: /*html*/`
        <style>
            :host { @apply --vertical; overflow: hidden; min-width: 0; }
            .bar { @apply --horizontal; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--subtle-border); min-height: 36px; box-sizing: border-box; }
            .bar b { font-size: small; font-weight: 600; }
            .bar oda-button { border-radius: var(--radius-s); padding: 2px; }
            .state { @apply --chip; }
            .state[live] { background: var(--success-soft); border-color: transparent; }
            .body { overflow: hidden; min-height: 0; flex: 1; position: relative; }
            .live { background: #111; }
            iframe { border: none; width: 100%; height: 100%; position: absolute; inset: 0; }
            .off { @apply --vertical; overflow-y: auto; gap: 12px; padding: 14px; font-size: small; }
            .note { @apply --muted; line-height: 1.45; }
            .shot { width: 100%; border: 1px solid var(--subtle-border); border-radius: var(--radius-s); background: #111; display: block; }
            .cap { @apply --muted; font-size: x-small; margin-top: 4px; }
            .thumbs { @apply --horizontal; gap: 6px; overflow-x: auto; padding-bottom: 4px; }
            .thumb { flex: none; width: 96px; height: 60px; object-fit: cover; border-radius: var(--radius-xs); border: 2px solid transparent; cursor: pointer; background: #111; opacity: .7; }
            .thumb[on] { border-color: var(--accent-color); opacity: 1; }
            .cmds { @apply --vertical; border: 1px solid var(--subtle-border); border-radius: var(--radius-m); overflow: hidden; }
            .cmd { @apply --horizontal; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--subtle-border); min-width: 0; }
            .cmd:last-child { border-bottom: none; }
            .cmd b { font-weight: 600; white-space: nowrap; }
            .cmd span { @apply --muted; font-family: var(--font-mono); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
        </style>
        <div class="bar" no-flex>
            <b>Компьютер «{{name}}»</b>
            <span class="state" :live="live">{{stateLabel}}</span>
            <div flex></div>
            <oda-button no-flex ~if="live" icon="carbon:launch" :icon-size="16" title="Открыть в новой вкладке" @tap="launch"></oda-button>
        </div>
        <div class="body live" ~if="live"><iframe :src="src"></iframe></div>
        <div class="body off" ~if="!live">
            <div class="note">{{offNote}}</div>
            <div ~if="shot">
                <img class="shot" :src="shot.url" :alt="shot.label">
                <div class="cap">{{shot.label}} · {{fmtTime(shot.time)}}</div>
            </div>
            <div class="thumbs" ~if="screens.length > 1">
                <img class="thumb" ~for="screens" :src="$for.item.url" :on="$for.index === shotIndex" :title="$for.item.label" @tap="pick($for.index)">
            </div>
            <div class="cmds" ~if="commands.length">
                <div class="cmd" ~for="commands"><b>{{$for.item.label}}</b><span>{{$for.item.target}}</span></div>
            </div>
        </div>
    `,
    fmtTime,
    picked: -1,
    get shell() { return findShell(this); },
    get computer() { return this.shell?.computer || { name: 'main', commands: [], screens: [] }; },
    get name() { return this.computer.name; },
    get live() { return this.shell?.computerState === 'running'; },
    get stateLabel() {
        const s = this.shell?.computerState;
        if (!this.shell?.computerChecked)
            return 'проверяю…';
        return s === 'running' ? 'работает' : s === 'stopped' ? 'выключен' : 'удалён или не создан';
    },
    get offNote() {
        const s = this.shell?.computerState;
        if (!this.shell?.computerChecked)
            return 'Проверяю состояние компьютера…';
        return (s === 'stopped'
            ? 'Компьютер выключен — живой экран не виден (он запустится при следующей команде агента).'
            : 'Компьютера больше нет — живой экран недоступен.')
            + (this.screens.length || this.commands.length ? ' Ниже — то, что агент на нём делал в этой задаче.' : '');
    },
    get screens() { return this.computer.screens; },
    get commands() { return this.computer.commands.slice(-12).reverse(); },
    get shotIndex() { return this.picked >= 0 && this.picked < this.screens.length ? this.picked : this.screens.length - 1; },
    get shot() { return this.screens[this.shotIndex] || null; },
    pick(i) { this.picked = i; },
    get src() { return location.origin + '/~computer/' + encodeURIComponent(this.name); },
    launch() { window.open(this.src, 'work-computer'); },
});

ODA({ is: 'microchat-results',
    imports: 'oda//button, oda//icon, oda//markdown//markdown-viewer',
    template: /*html*/`
        <style>
            :host { @apply --vertical; overflow: hidden; min-width: 0; }
            .sel-bar { @apply --horizontal; align-items: center; gap: 4px; padding: 6px 10px; border-bottom: 1px solid var(--subtle-border); min-height: 36px; box-sizing: border-box; }
            .sel { @apply --horizontal; align-items: center; gap: 6px; font-size: small; user-select: none; flex: 1; min-width: 0; }
            .sel .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
            .sel .cnt { @apply --muted; font-size: x-small; white-space: nowrap; }
            .arr { background: none; border: 1px solid var(--subtle-border); border-radius: var(--radius-s); cursor: pointer; padding: 2px 6px; color: inherit; line-height: 1.2; }
            .arr:hover { background: var(--code-background); }
            .arr:disabled { opacity: .3; cursor: default; }
            .body { overflow: auto; min-height: 0; flex: 1; }
            .empty { @apply --muted; text-align: center; padding: 40px 20px; }
        </style>
        <div class="sel-bar" no-flex ~if="items.length">
            <div class="sel" flex>
                <button class="arr" :disabled="idx <= 0" @tap="prev" title="Предыдущий" aria-label="Предыдущий результат">‹</button>
                <span class="name" :title="cur?.title">{{cur?.title}}</span>
                <span class="cnt">{{idx + 1}} из {{items.length}}</span>
                <button class="arr" :disabled="idx >= items.length - 1" @tap="next" title="Следующий" aria-label="Следующий результат">›</button>
            </div>
        </div>
        <div class="body" flex vertical>
            <div class="empty" ~if="!items.length">Результатов пока нет</div>
            <microchat-doc flex ~if="curDoc" :doc="curDoc"></microchat-doc>
        </div>
    `,
    pickedKey: '',
    pickedAt: 0,
    get shell() { return findShell(this); },
    /** Опубликованные результаты (data.results) и отчёты субагентов. */
    get items() {
        const shell = this.shell;
        const results = shell?.data?.results || [];
        const reports = (shell?.docs || []).filter(d => d.kind === 'text');
        const mapped = results.map(r => ({
            key: 'result:' + r.snapshot,
            kind: 'file',
            path: r.snapshot,
            title: r.title || snapshotName(r.snapshot),
            time: r.time,
            published: true,
        }));
        return [...mapped, ...reports];
    },
    /** Выбор: последний сделанный человеком; запрос шелла (новый отчёт, ссылка из ответа) новее — он главнее; иначе — самый новый результат. */
    get selectedKey() {
        const fromShell = this.shell?.resultKey;
        return this.pickedAt >= (this.shell?.resultKeyAt || 0) ? this.pickedKey : fromShell;
    },
    get idx() {
        const i = this.items.findIndex(x => x.key === this.selectedKey);
        return i >= 0 ? i : this.items.length - 1;
    },
    get cur() { return this.items[this.idx] || null; },
    get curDoc() {
        const item = this.cur;
        if (!item)
            return null;
        if (item.kind === 'text')
            return item;
        // тот же объект, пока результат не изменился: microchat-doc перезагружает текст при каждой смене doc
        const cache = this._docs ??= new Map();
        const key = item.key + '|' + item.path;
        if (!cache.has(key))
            cache.set(key, { kind: 'file', path: item.path, title: item.title, time: item.time, published: true });
        return cache.get(key);
    },
    go(i) {
        const item = this.items[i];
        if (!item)
            return;
        this.pickedKey = item.key;
        this.pickedAt = Date.now();
    },
    prev() { this.go(this.idx - 1); },
    next() { this.go(this.idx + 1); },
});

ODA({ is: 'microchat-files',
    imports: 'oda//button, oda//icon',
    template: /*html*/`
        <style>
            :host { @apply --vertical; overflow: hidden; min-width: 0; }
            .list { overflow-y: auto; flex: 1; min-height: 0; padding: 4px 12px 16px; }
            .head { @apply --muted; font-size: x-small; text-transform: uppercase; letter-spacing: .05em; padding: 10px 2px 6px; }
            .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px; align-items: start; }
            .tile { @apply --vertical; gap: 4px; cursor: pointer; border-radius: var(--radius-m); padding: 4px; min-width: 0; }
            .tile:hover { background: var(--code-background); }
            .tile:focus-visible { @apply --focus-ring; }
            .tile chat-item { pointer-events: none; }
            .meta { @apply --horizontal; @apply --muted; align-items: center; gap: 4px; font-size: x-small; padding: 0 6px 2px; }
            .meta .pub { color: var(--accent-color); }
            .view { @apply --vertical; flex: 1; min-height: 0; overflow: hidden; }
            .back-bar { @apply --horizontal; align-items: center; gap: 8px; padding: 4px 10px; border-bottom: 1px solid var(--subtle-border); min-height: 34px; box-sizing: border-box; }
            .back { background: none; border: 1px solid var(--subtle-border); border-radius: var(--radius-s); cursor: pointer; padding: 2px 10px; color: inherit; font-size: small; }
            .back:hover { background: var(--code-background); }
            .back-bar span { @apply --muted; font-size: x-small; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
            .empty { @apply --muted; text-align: center; padding: 40px 20px; }
        </style>
        <div class="list" ~if="!cur">
            <div class="empty" ~if="!items.length">Файлов пока нет</div>
            <div class="head" ~if="items.length">Файлы задачи · {{items.length}}</div>
            <div class="grid">
                <div class="tile" ~for="items" tabindex="0" role="button" :title="'Открыть ' + $for.item.title" @tap="open($for.item)" @keydown="tileKey($event, $for.item)">
                    <chat-item visible history compact :$file="itemOf($for.item)"></chat-item>
                    <div class="meta">
                        <oda-icon :icon="$for.item.source === 'user' ? 'carbon:user' : 'carbon:bot'" :icon-size="12"></oda-icon>
                        <span>{{$for.item.source === 'user' ? 'вы' : 'агент'}} · {{fmtTime($for.item.time)}}</span>
                        <span class="pub" ~if="$for.item.published">· в ленте</span>
                    </div>
                </div>
            </div>
        </div>
        <div class="view" ~if="cur">
            <div class="back-bar" no-flex>
                <button class="back" @tap="close" title="К списку файлов">← Файлы</button>
                <span flex :title="cur.real">{{cur.source === 'user' ? 'ваше вложение' : 'создано агентом'}} · {{items.length}} {{items.length === 1 ? 'файл' : 'файлов'}} в задаче</span>
            </div>
            <microchat-doc flex :doc="curDoc"></microchat-doc>
        </div>
    `,
    fmtTime,
    get shell() { return findShell(this); },
    get items() { return this.shell?.files || []; },
    get cur() { return this.items.find(f => f.key === this.shell?.dockFile) || null; },
    /** Один и тот же объект, пока версия файла не изменилась: microchat-doc перезагружает текст при каждой смене doc. */
    get curDoc() {
        const f = this.cur;
        if (!f)
            return null;
        const cache = this._docs ??= new Map();
        const key = f.key + '|' + f.path;
        if (!cache.has(key))
            cache.set(key, { kind: 'file', path: f.path, title: f.title, time: f.time, published: !!f.published });
        return cache.get(key);
    },
    /** Карточка файла — тот же chat-item, что в ленте чата (превью, иконка, имя). Обещание кэшируется, иначе плитка перезагружалась бы на каждой перерисовке. */
    itemOf(f) { return fileItemOf(f.path); },
    open(f) { this.shell?.openFile(f.key); },
    close() { this.shell?.closeFile(); },
    tileKey(e, f) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.open(f);
        }
    },
});

ODA({ is: 'microchat-doc',
    imports: 'oda//button, oda//icon, oda//markdown//markdown-viewer',
    template: /*html*/`
        <style>
            :host { @apply --vertical; overflow: hidden; min-width: 0; }
            .bar { @apply --horizontal; align-items: center; gap: 4px; padding: 6px 10px; border-bottom: 1px solid var(--subtle-border); min-width: 0; }
            .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; font-size: small; }
            .sub { @apply --muted; font-size: x-small; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
            .sub[mono] { font-family: var(--font-mono); }
            .sub[link] { cursor: pointer; text-decoration: underline dotted; }
            .bar oda-button { border-radius: var(--radius-s); padding: 2px; }
            .body { overflow: auto; min-height: 0; }
            iframe { border: none; width: 100%; height: 100%; background: white; }
            .img { @apply --vertical; align-items: center; justify-content: center; padding: 16px; }
            .img img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: var(--radius-s); }
            video { width: 100%; max-height: 100%; background: #000; border-radius: var(--radius-s); }
            .md { padding: 14px 20px; user-select: text; line-height: 1.6; }
            pre { margin: 0; padding: 12px 16px; font-family: var(--font-mono); font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; user-select: text; }
            .empty { @apply --muted; padding: 24px; text-align: center; }
        </style>
        <div class="bar" no-flex>
            <div vertical flex style="min-width: 0;">
                <span class="name">{{doc?.title}}</span>
                <span class="sub" :mono="isFile" :link="isFile" :title="isFile ? 'Открыть форму ' + path : subtitle" @tap="openForm">{{subtitle}}</span>
            </div>
            <oda-button no-flex ~if="isFile" icon="carbon:renew" :icon-size="16" title="Обновить" @tap="reload"></oda-button>
            <oda-button no-flex ~if="!isImage" icon="carbon:copy" :icon-size="16" title="Копировать" @tap="copy"></oda-button>
            <oda-button no-flex ~if="!isFile" icon="carbon:save" :icon-size="16" :title="saved ? 'Сохранено: ' + saved : 'Сохранить файлом .md в класс задачи'" :success="!!saved" @tap="save"></oda-button>
            <oda-button no-flex icon="carbon:download" :icon-size="16" title="Скачать" @tap="download"></oda-button>
            <oda-button no-flex ~if="isFile" icon="carbon:launch" :icon-size="16" title="Открыть в новой вкладке" @tap="launch"></oda-button>
        </div>
        <div class="body" flex vertical>
            <iframe flex ~if="isPage" :src="url"></iframe>
            <div class="img" flex ~if="isImage"><img :src="url"></div>
            <video flex controls preload="metadata" ~if="isVideo" :src="url"></video>
            <div class="md" ~if="isMarkdown && text"><oda-markdown-viewer vertical :value="md"></oda-markdown-viewer></div>
            <pre ~if="!isPage && !isImage && !isVideo && !isMarkdown && !isBinary && text">{{text}}</pre>
            <div class="empty" ~if="isBinary">Двоичный файл — скачайте или откройте в приложении</div>
            <div class="empty" ~if="!isPage && !isImage && !isVideo && !text">{{loading ? 'Загрузка…' : 'Нет содержимого'}}</div>
        </div>
    `,
    doc: {
        $def: null,
        set(n) {
            this.fileText = '';
            this.bust = Date.now();
            this.saved = '';
            this.loadText();
        },
    },
    fileText: '',
    loading: false,
    bust: 0,
    saved: '',
    get isFile() { return this.doc?.kind === 'file'; },
    get path() { return this.isFile ? this.doc.path : ''; },
    get ext() { return this.isFile ? extOf(this.path) : 'md'; },
    get isBinary() { return BINARY.includes(this.ext); },
    get isImage() { return IMAGE.includes(this.ext); },
    get isPage() { return PAGE.includes(this.ext); },
    get isVideo() { return VIDEO.includes(this.ext); },
    get isMarkdown() { return this.ext === 'md'; },
    get url() { return fileUrl(this.path) + '?_=' + this.bust; },
    get text() { return this.isFile ? this.fileText : String(this.doc?.text || ''); },
    get md() { return linkifyWork(this.text, this.doc?.artifacts || new Map()); },
    get subtitle() {
        if (this.isFile)
            return ['Снимок файла', this.doc?.published ? 'показан в общей ленте' : '', fmtTime(this.doc?.time)].filter(Boolean).join(' · ');
        return [this.doc?.subtitle, fmtTime(this.doc?.time)].filter(Boolean).join(' · ');
    },
    async loadText() {
        if (!this.isFile || this.isImage || this.isPage || this.isVideo || this.isBinary)
            return;
        this.loading = true;
        try {
            const item = await WORK.get_item(this.path);
            const raw = await item?.load?.();
            this.fileText = typeof raw === 'string' ? raw : (raw == null ? '' : JSON.stringify(raw, null, 2));
        }
        catch (e) {
            this.fileText = 'Не удалось загрузить: ' + (e?.message || e);
        }
        finally {
            this.loading = false;
        }
    },
    reload() {
        this.bust = Date.now();
        this.loadText();
    },
    copy() { copyText(this.text); },
    fileName() {
        const base = String(this.doc?.title || 'документ').replace(/[\\/:*?"<>|\n]+/g, ' ').trim().slice(0, 60) || 'документ';
        return this.isFile ? base : base + '.md';
    },
    download() {
        if (this.isFile && (this.isImage || this.isPage || this.isVideo || !this.text)) {
            const a = document.createElement('a');
            a.href = fileUrl(this.path);
            a.download = this.fileName();
            a.click();
            return;
        }
        const blob = new Blob([this.text], { type: 'text/markdown' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = this.fileName();
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    async save() {
        const shell = findShell(this);
        const res = await shell?.saveDoc(this.fileName(), this.text);
        if (res)
            this.saved = res;
    },
    launch() { window.open(fileUrl(this.path), '_blank'); },
    openForm() {
        if (this.isFile)
            window.open(workHref(this.path), '_blank');
    },
});
