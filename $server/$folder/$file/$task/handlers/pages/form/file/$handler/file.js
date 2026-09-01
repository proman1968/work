/**
 * Визуалка form/file для ai.task — шелл: лента + док закрытых + промптбар.
 * Мета хендлера — class.js.
 */

import './ui/views.js';
import './ui/panel.js';
import './ui/dock.js';

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
        </style>
        
        <div flex vertical class="feed" ~if="showFeed">
            <div ~if="mobile" flex></div>
            <div vertical :flex="!mobile" style="overflow: hidden; padding: 8px;">
                <microchat-ribbon flex :data :$item></microchat-ribbon>
            </div>
            <microchat-panel info-invert no-flex :data :$item></microchat-panel>
        </div>
        <oda-splitter ~if="showDock && !mobile" left ::width="dockWidth"></oda-splitter>
        <microchat-dock content no-flex ~if="showDock" :data :$item ~style="dockStyle"></microchat-dock>   
        <oda-button class="dock-over" content ~if="showDockBtn" shadow icon="icons:chevron-left" :label="dockReports.length" :icon-size title="Отчёты" @tap="dockOpen = true"></oda-button>                

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
                this.pending = true;
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
    get title() { return this.data?.title || this.$item?.name || 'task'; },
    get items() { return this.data?.items; },
    get result() {
        return this.$('microchat-ribbon')?.viewFor(this.focusedBlock)?.result;
    },
    get focusedBlock() {
        let items = this.items;
        while (items?.length) {
            let last;
            for (let i = items.length - 1; i >= 0; i--) {
                if (!items[i]?.hidden) { last = items[i]; break; }
            }
            if (!last || last.content || !last.items?.length) return last;
            items = last.items;
        }
        return undefined;
    },
    /** focused без тела — слот стрима, не факт что стрим идёт (`streaming` — только delta/done) */
    get streamTarget() {
        const b = this.focusedBlock;
        return (b && !b.content && !b.html) ? b : undefined;
    },
};
