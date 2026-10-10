/**
 * site ($structure) — рабочая зона подразделения / должностной группы:
 * шапка с описанием и составом, дочерние подразделения и группы, доступные ссылки на классы.
 * Слои $base и $server переопределяют template и жизненный цикл (ready/attached/detached).
 */
export default {
    icon: 'iconoir:internet',
    label: 'Сайт',
    imports: 'oda//button, ~/lib//icon, ~/lib//user, ~/lib//site-user',
    template: /* html */`
    <style>
        :host {
            @apply --vertical;
            @apply --flex;
            @apply --content;
            overflow: auto;
        }
        .page {
            @apply --vertical;
            gap: 20px;
            width: 100%;
            max-width: 1100px;
            margin: 0 auto;
            padding: 20px 24px 40px;
            box-sizing: border-box;
        }
        .head {
            @apply --horizontal;
            align-items: center;
            gap: 16px;
        }
        .head .title {
            @apply --flex;
            @apply --vertical;
            gap: 4px;
            min-width: 0;
        }
        h1 {
            margin: 0;
            font-size: clamp(1.4rem, 2.6vw, 1.9rem);
            font-weight: 700;
            letter-spacing: -0.02em;
        }
        .kind {
            @apply --muted;
            font-size: small;
            text-transform: uppercase;
            letter-spacing: .08em;
        }
        .desc {
            margin: 0;
            line-height: 1.5;
            @apply --muted;
        }
        .people {
            @apply --horizontal;
            flex-wrap: wrap;
            gap: 16px;
            align-items: center;
        }
        .people .role {
            @apply --horizontal;
            align-items: center;
            gap: 6px;
            font-size: small;
        }
        .people .role span {
            @apply --muted;
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
        .empty {
            @apply --muted;
            font-size: small;
        }
    </style>
    <div class="page">
        <div class="head">
            <item-icon :$item :icon-size="56"></item-icon>
            <div class="title">
                <div class="kind">{{kindLabel}}</div>
                <h1>{{$item?.label}}</h1>
                <p class="desc" ~if="description">{{description}}</p>
            </div>
            <item-site-user :$item></item-site-user>
        </div>
        <div class="people" ~if="bossList?.length || userList?.length">
            <div class="role" ~if="bossList?.length">
                <span>Руководство</span>
                <item-user ~for="bossList" :$item="$for.item" round :icon-size="28" :title="$for.item.label"></item-user>
            </div>
            <div class="role" ~if="userList?.length">
                <span>Сотрудники</span>
                <item-user ~for="userList" :$item="$for.item" round :icon-size="28" :title="$for.item.label"></item-user>
            </div>
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
        <section ~if="links?.length">
            <h2>Рабочие ссылки</h2>
            <div class="grid">
                <div class="card" ~for="links" @tap="openLink($for.item)" :title="$for.item.path">
                    <oda-icon :icon="$for.item.icon || 'bootstrap:database'" :icon-size="28"></oda-icon>
                    <div class="name">{{$for.item.label}}</div>
                    <span class="chip">{{$for.item.access === 'read' ? 'чтение' : 'работа'}}</span>
                </div>
            </div>
        </section>
        <div class="empty" ~if="loaded && !units?.length && !links?.length">
            Здесь пока нет подразделений и рабочих ссылок.
        </div>
    </div>
    `,
    loaded: false,
    get kindLabel() {
        return { '$base': 'Организация', '$structure': 'Подразделение', '$server': 'WORK' }[this.$item?.type] || '';
    },
    get description() {
        return Promise.resolve(this.$item?.body).then(b => b?.description || '').catch(() => '');
    },
    get bossList() {
        return Promise.resolve(this.$item?.bosses).then(l => Array.isArray(l) ? l.filter(Boolean) : []).catch(() => []);
    },
    get userList() {
        return Promise.resolve(this.$item?.users).then(l => Array.isArray(l) ? l.filter(Boolean) : []).catch(() => []);
    },
    /** Дочерние узлы структуры (кроме кабинетов и данных). */
    get structureChildren() {
        if (!this.$item)
            return [];
        return Promise.resolve(this.$item.items).then(items =>
            (items || []).filter(i => i instanceof CORE.$class && ['$structure', '$base'].includes(i.type))
        ).catch(() => []);
    },
    get units() {
        return this.structureChildren;
    },
    /** Ссылки рабочего места (LINKS), доступные пользователю: листья link_tree (сырой JSON, без __bind). */
    get links() {
        if (!this.$item)
            return [];
        return Promise.resolve(WORK.fetch(this.$item.short || '/', 'link_tree', {})).then(tree => {
            const out = [];
            const walk = (nodes) => {
                for (const n of nodes || []) {
                    if (n?.children?.length)
                        walk(n.children);
                    else if (n?.path)
                        out.push(n);
                }
            };
            walk(Array.isArray(tree) ? tree : []);
            return out;
        }).catch(() => []);
    },
    /** Оболочка-организация во внешнем окне (тот же origin): выбор узла в её навигации. */
    _shell() {
        try {
            return window.parent !== window ? window.parent.__workSiteShell || null : null;
        }
        catch { return null; }
    },
    openNode(item) {
        if (!item)
            return;
        if (this._shell()?.open(item.short))
            return;
        location.href = item.url + '/~/handlers//site/index.html';
    },
    /** Открыть класс по ссылке: во вкладке explorer, иначе — в новой вкладке браузера. */
    async openLink(node) {
        if (!node?.path)
            return;
        const top = WORK.top;
        if (typeof top?.execute === 'function') {
            const item = await WORK.get_item(node.path);
            if (item) {
                top.execute(item);
                return;
            }
        }
        window.open(encodeURI(node.path + '/~/handlers/pages/form/'), '_blank');
    },
    async emitLocation() {
        const { buildSiteLoc } = await import((this.$item?.short || '') + '/~/lib//site-loc.js');
        const loc = buildSiteLoc(this.$item?.short || '', '', {});
        const shell = this._shell();
        if (shell)
            shell.loc(window, loc);
        else if (WORK.top === window && location.hash.replace(/^#/, '') !== loc)
            history.replaceState(null, '', '#' + loc);
    },
    async ready() {
        await Promise.all([this.units, this.groups, this.links]).catch(() => {});
        this.loaded = true;
        if (this.$item)
            this.emitLocation();
    },
    attached() {},
    detached() {},
}
