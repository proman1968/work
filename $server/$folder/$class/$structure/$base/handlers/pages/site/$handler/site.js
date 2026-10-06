/**
 * Узел навигации. Не plain-объект намеренно: Reactor не активирует экземпляры
 * собственных классов, иначе поле item (элемент WORK) подменилось бы копией ($def).
 */
class SiteOrgNode {
    constructor(item, depth) {
        this.item = item;
        this.depth = depth;
        this.kids = undefined;
        this.expanded = false;
    }
}

/**
 * site ($base) — сайт организации: шапка, слева навигация по подразделениям
 * (дерево узлов структуры), справа — сайт выбранного узла в iframe.
 * Корень дерева — главная организации (без iframe).
 * Геттеры units/groups/description/bossList/kindLabel — из слоя $structure (склейка ~).
 */
export default {
    imports: 'oda//button, oda//icon, ~/lib//icon, ~/lib//user, ~/lib//site-user',
    template: /* html */`
    <style>
        :host {
            @apply --vertical;
            @apply --flex;
            overflow: hidden;
        }
        .topbar {
            @apply --horizontal;
            @apply --header;
            align-items: center;
            gap: 12px;
            padding: 8px 16px;
            flex-shrink: 0;
        }
        .topbar .org {
            @apply --flex;
            font-size: 1.15rem;
            font-weight: 700;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            cursor: pointer;
        }
        .layout {
            @apply --horizontal;
            @apply --flex;
            min-height: 0;
        }
        aside {
            @apply --vertical;
            width: 280px;
            flex-shrink: 0;
            overflow: auto;
            padding: 8px 0;
            border-right: 1px solid var(--subtle-border);
            @apply --content;
        }
        .row {
            @apply --horizontal;
            align-items: center;
            gap: 6px;
            padding: 6px 12px 6px 0;
            cursor: pointer;
            border-radius: 0 var(--radius-round, 999px) var(--radius-round, 999px) 0;
            margin-right: 8px;
        }
        .row:hover {
            background: var(--accent-soft);
        }
        .row.selected {
            @apply --accent-invert;
        }
        .row .name {
            @apply --flex;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .chev {
            width: 20px;
            flex-shrink: 0;
            opacity: .6;
        }
        main {
            @apply --vertical;
            @apply --flex;
            @apply --content;
            min-width: 0;
            overflow: hidden;
            position: relative;
        }
        iframe {
            border: none;
            flex: 1;
            width: 100%;
            min-height: 0;
        }
        .home {
            @apply --vertical;
            @apply --flex;
            overflow: auto;
        }
        .hero {
            @apply --horizontal;
            align-items: center;
            gap: 24px;
            padding: 40px 32px;
            color: white;
            fill: white;
            background: linear-gradient(135deg, var(--main-color), color-mix(in oklch, var(--main-color) 55%, black));
        }
        .hero h1 {
            margin: 0;
            font-size: clamp(1.6rem, 3.2vw, 2.4rem);
            letter-spacing: -0.02em;
        }
        .hero p {
            margin: 6px 0 0;
            opacity: .85;
            line-height: 1.5;
            max-width: 640px;
        }
        .body {
            @apply --vertical;
            gap: 20px;
            padding: 24px 32px 40px;
            max-width: 1100px;
            box-sizing: border-box;
        }
        h2 {
            margin: 0 0 8px;
            font-size: 1rem;
            font-weight: 600;
        }
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
            gap: 12px;
        }
        .card {
            @apply --card;
            @apply --horizontal;
            align-items: center;
            gap: 12px;
            padding: 12px 14px;
            cursor: pointer;
            transition: transform var(--duration-fast, 120ms) var(--easing, ease), box-shadow var(--duration-fast, 120ms);
        }
        .card:hover {
            transform: translateY(-1px);
            box-shadow: var(--elevation-2);
        }
        .card .name {
            @apply --flex;
            font-weight: 500;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .chip {
            @apply --chip;
        }
        .people {
            @apply --horizontal;
            align-items: center;
            gap: 6px;
            font-size: small;
        }
        @media (max-width: 720px) {
            .layout {
                flex-direction: column;
            }
            aside {
                width: auto;
                max-height: 35%;
                border-right: none;
                border-bottom: 1px solid var(--subtle-border);
            }
            .hero {
                padding: 24px 20px;
            }
            .body {
                padding: 16px 20px 32px;
            }
        }
    </style>
    <div class="topbar">
        <item-icon :$item :icon-size="28"></item-icon>
        <div class="org" @tap="selectRoot">{{$item?.label}}</div>
        <item-site-user :$item></item-site-user>
    </div>
    <div class="layout">
        <aside>
            <div class="row" ~for="rows" ~class="{selected: current === $for.item}" ~style="{paddingLeft: (8 + $for.item.depth * 16) + 'px'}" @tap="select($for.item)">
                <oda-icon class="chev" :icon-size="18" :icon="chevron($for.item)" @tap.stop="toggle($for.item)"></oda-icon>
                <item-icon :$item="$for.item.item" :icon-size="22"></item-icon>
                <div class="name">{{$for.item.item.label}}</div>
            </div>
        </aside>
        <main>
            <div class="home" ~if="isHome">
                <div class="hero">
                    <item-icon :$item :icon-size="88"></item-icon>
                    <div>
                        <h1>{{$item?.label}}</h1>
                        <p ~if="description">{{description}}</p>
                    </div>
                </div>
                <div class="body">
                    <div class="people" ~if="bossList?.length">
                        <span>Руководство</span>
                        <item-user ~for="bossList" :$item="$for.item" round :icon-size="28" :title="$for.item.label"></item-user>
                    </div>
                    <section ~if="units?.length">
                        <h2>Подразделения</h2>
                        <div class="grid">
                            <div class="card" ~for="units" @tap="openNode($for.item)">
                                <item-icon :$item="$for.item" :icon-size="32"></item-icon>
                                <div class="name">{{$for.item.label}}</div>
                                <span class="chip">{{$for.item.type === '$base' ? 'организация' : 'подразделение'}}</span>
                            </div>
                        </div>
                    </section>
                    <section ~if="groups?.length">
                        <h2>Должностные группы</h2>
                        <div class="grid">
                            <div class="card" ~for="groups" @tap="openNode($for.item)">
                                <item-icon :$item="$for.item" :icon-size="32"></item-icon>
                                <div class="name">{{$for.item.label}}</div>
                                <span class="chip">группа</span>
                            </div>
                        </div>
                    </section>
                </div>
            </div>
            <iframe ~for="frames" ~show="!isHome && currentHref === $for.item.href" :src="$for.item.href"></iframe>
        </main>
    </div>
    `,
    rows: [],
    frames: [],
    current: null,
    currentHref: '',
    _frameSeq: 0,
    _childLoc: '',
    get isHome() {
        return !this.current || this.current.item === this.$item;
    },
    chevron(node) {
        if (node.kids && !node.kids.length)
            return '';
        return node.expanded ? 'icons:expand-more' : 'icons:chevron-right';
    },
    _rebuild() {
        const out = [];
        const walk = (node) => {
            out.push(node);
            if (node.expanded)
                for (const k of node.kids || [])
                    walk(k);
        };
        if (this._root)
            walk(this._root);
        this.rows = out;
    },
    async _loadKids(node) {
        if (node.kids)
            return node.kids;
        let items = [];
        try {
            items = (await node.item.items) || [];
        } catch { items = []; }
        node.kids = items
            .filter(i => i instanceof CORE.$class && ['$structure', '$base', '$group'].includes(i.type))
            .map(item => new SiteOrgNode(item, node.depth + 1));
        return node.kids;
    },
    async toggle(node) {
        if (!node.expanded)
            await this._loadKids(node);
        node.expanded = !node.expanded;
        this._rebuild();
    },
    select(node, sub = '') {
        if (!node)
            return;
        this.current = node;
        this._childLoc = '';
        if (node.item !== this.$item) {
            const base = new URL(node.item.url + '/~/handlers//site/index.html').href;
            let frame = this.frames.find(f => f.base === base);
            if (!frame) {
                frame = { id: ++this._frameSeq, base, href: sub ? base + '#' + sub : base };
                this.frames = [...this.frames, frame];
            }
            this.currentHref = frame.href;
            this._activeFrame = frame;
        }
        else
            this._activeFrame = null;
        this.emitLocation();
    },
    selectRoot() {
        this.select(this._root);
    },
    /** Раскрыть путь до узла по short и выбрать его; не нашли — главная. */
    async revealShort(short, sub = '') {
        let node = this._root;
        while (node && node.item.short !== short) {
            const kids = await this._loadKids(node);
            const next = kids.find(k => short === k.item.short || short.startsWith(k.item.short + '/'));
            if (!next)
                break;
            node.expanded = true;
            node = next;
        }
        this._rebuild();
        this.select(node?.item.short === short ? node : this._root, sub);
    },
    /** Карточки главной: выбор узла в навигации. */
    openNode(item) {
        if (item)
            this.revealShort(item.short);
    },
    async emitLocation() {
        const { buildSiteLoc } = await import((this.$item?.short || '') + '/~/lib//site-loc.js');
        const myShort = this.$item?.short || '';
        let loc;
        if (this.isHome)
            loc = buildSiteLoc(myShort, '', {});
        else
            loc = buildSiteLoc(myShort, this._childLoc || buildSiteLoc(this.current.item.short, '', {}), {});
        const shell = this._shell();
        if (shell)
            shell.loc(window, loc);
        else if (WORK.top === window && location.hash.replace(/^#/, '') !== loc)
            history.replaceState(null, '', '#' + loc);
    },
    /** Сообщение вложенного сайта о его локации — только от активного фрейма. */
    _onChildLoc(win, loc) {
        const active = this._activeFrame;
        if (!active)
            return;
        const el = this.$$('iframe').find(f => f.contentWindow === win);
        if (!el || new URL(el.src).href !== new URL(active.href).href)
            return;
        this._childLoc = loc || '';
        this.emitLocation();
    },
    async applyLocation() {
        const { parseSiteHash, matchSelf } = await import((this.$item?.short || '') + '/~/lib//site-loc.js');
        const m = matchSelf(parseSiteHash(location.hash), this.$item?.short || '');
        if (m.idx >= 0 && m.childCtx)
            await this.revealShort(m.childCtx, m.childSubFragment);
        else
            this.selectRoot();
    },
    async ready() {
        if (!this.$item)
            return;
        // API для вложенных сайтов (тот же origin): выбор узла и передача локации
        window.__workSiteShell = {
            open: (short) => {
                this.revealShort(short);
                return true;
            },
            loc: (win, loc) => this._onChildLoc(win, loc),
        };
        this._root = new SiteOrgNode(this.$item, 0);
        this._root.expanded = true;
        await this._loadKids(this._root);
        this._rebuild();
        await this.applyLocation();
    },
    attached() {},
    detached() {
        if (window.__workSiteShell)
            window.__workSiteShell = undefined;
    },
}
