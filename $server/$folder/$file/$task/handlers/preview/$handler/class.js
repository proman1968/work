/**
 * Preview ai.task — shell: лента + док закрытых + промптбар.
 * data/items/$item/focusedBlock/streamTarget/result/streamingText/streaming/dockReports; без знания внутренностей детей.
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
            }
            .dock-over {
                position: absolute;
                top: 0;
                right: 0;
                z-index: 200;
                margin: 4px;
                padding: 0px;
            }
        </style>
   
        <div flex vertical ~if="showFeed">
            <div flex vertical style="overflow: hidden;">
                <microchat-ribbon flex :data :$item></microchat-ribbon>
            </div>
            <microchat-panel info-invert no-flex :data :$item></microchat-panel>
        </div>
        <oda-splitter ~if="showDock && !mobile" left ::width="dockWidth"></oda-splitter>
        <microchat-dock no-flex ~if="showDock" :data :$item ~style="dockStyle"></microchat-dock>   
        <oda-button class="dock-over" content ~if="showDockBtn" round shadow icon="icons:chevron-left" :icon-size title="Отчёты" @tap="dockOpen = true"></oda-button>                

    `,
    colorMode: 'content',
    data: null,
    streamingText: '',
    /** wait-кнопки прячем, пока идёт стрим (реактивный флаг для кэша геттеров) */
    streaming: false,
    dockOpen: { $def: true, $save: true },
    dockPick: -1,
    dockWidth: { $def: 280, $save: true },

    $item: {
        $def: null,
        async set(n) {
            n?.listen('changed', async () => {
                this.streamingText = '';
                this.data = await n.load();
                this.streaming = !!this.streamTarget;
            });
            n?.listen('chat.delta', e => {
                this.streaming = true;
                this.streamingText += e.detail?.value?.token || '';
            });
            n?.listen('chat.done', async () => {
                this.streaming = false;
                this.streamingText = '';
                this.data = await n.load();
            });
            this.data = await n?.load();
            this.streaming = false;
        },
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
        return this.mobile ? { width: '100%' } : { maxWidth: '50%' };
    },
    get dockReports() {
        const out = [];
        const walk = (items) => {
            for (const b of items || []) {
                if (!b || b.hidden) continue;
                walk(b.items);
                if (Array.isArray(b.items) && b.content)
                    out.push(b);
            }
        };
        walk(this.data?.items);
        if (this.data?.content)
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
    /** focused без тела — стрим уже идёт или ещё ждём первый токен */
    get streamTarget() {
        const b = this.focusedBlock;
        return (b && !b.content && !b.html) ? b : undefined;
    },
};
