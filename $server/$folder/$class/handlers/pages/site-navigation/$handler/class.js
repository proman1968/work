export default {
    icon: 'carbon:tree-view-alt',
    label: 'Навигация',
    imports: 'oda//app-layout.js, ~/lib//tree.js',
    extends: 'oda-app-layout',
    template: /* html */`
    <site-nav-tree
        slot="left-panel"
        allow-focus
        only-classes
        hide-system
        :$item
        style="height: 0"
    ></site-nav-tree>
    <div flex vertical slot="main" style="overflow: hidden; position: relative;">
        <iframe ~for="frames" ~show="current_href === $for.item.href" style="border: none;" flex :src="$for.item.href"></iframe>
    </div>
    `,
    current_href: '',
    current_item: null,
    frames: [],
    _frameSeq: 0,
    last_sel: { $def: '', $save: true },
    get $saveKey() {
        return this.$item?.short || '';
    },
    get isLoggedIn() {
        return !!WORK.uid;
    },
    get isTop() {
        return WORK.top === window;
    },
    user_icon: {
        $def: 'icons:account-circle',
        get() {
            return Promise.resolve(WORK.USER?.icon).then(i => i || 'icons:account-circle');
        }
    },
    get left_buttons() {
        if (!this.isTop) return [];
        let user_icon = this.user_icon;
        if (user_icon && typeof user_icon.then === 'function')
            user_icon = 'icons:account-circle';
        const user_color = WORK.USER?.iconColor || 'transparent';
        return [{
            round: true,
            icon: user_icon,
            default: 'icons:account-circle',
            style: `color: white; fill: white; background:${user_color}`,
            click: () => this.open_profile(),
            get errorInvert() {
                return !WORK.uid;
            }
        }];
    },
    _onAuth() {
        this.isLoggedIn = undefined;
        this.user_icon = undefined;
        this.left_buttons = undefined;
    },
    async open_profile() {
        const profile = ODA.createComponent('user-profile');
        try {
            await WORK.showModal(profile, {
                TITLE: { label: this.isLoggedIn ? 'Профиль' : 'Вход или регистрация' },
                allowClose: true,
                BUTTONS: [],
            });
        } catch (_) {
        } finally {
            this._onAuth();
        }
    },
    isSelf(item) {
        return item === this.$item || item?.short === this.$item?.short;
    },
    frame_url(item) {
        return new URL(item.url + '/~/handlers//site-main/index.html').href;
    },
    open_item(item) {
        if (!item) return;
        const base = this.frame_url(item);
        let frame = this.frames.find(f => f.base === base);
        if (!frame) {
            frame = { id: ++this._frameSeq, base, href: base };
            this.frames = [...this.frames, frame];
        }
        this.current_item = item;
        this.current_href = frame.href;
        this.last_sel = this.isSelf(item) ? '' : (item.short || item.path || '');
        const tree = this.$('site-nav-tree');
        if (tree)
            tree.focusedItem = item;
        this.emit_location();
    },
    async find_class(short) {
        if (!short || !this.$item) return null;
        if (this.$item.short === short || this.$item.path === short)
            return this.$item;
        const walk = async (node) => {
            const kids = ((await node.items) || []).filter(i => i instanceof CORE.$class);
            for (const k of kids) {
                if (k.short === short || k.path === short)
                    return k;
                const found = await walk(k);
                if (found) return found;
            }
            return null;
        };
        return walk(this.$item);
    },
    async apply_location() {
        const { parseSiteHash, matchSelf } = await import((this.$item?.short || '') + '/~/lib//site-loc.js');
        const segs = parseSiteHash(location.hash);
        const myShort = this.$item?.short || '';
        const m = matchSelf(segs, myShort);
        let selShort = '';
        if (m.idx >= 0 && m.childCtx)
            selShort = m.childCtx;
        else if (m.idx < 0 && this.last_sel)
            selShort = this.last_sel;
        const target = selShort
            ? (await this.find_class(selShort)) || this.$item
            : this.$item;
        this.open_item(target);
    },
    async emit_location() {
        const { buildFragment, buildSiteLoc } = await import((this.$item?.short || '') + '/~/lib//site-loc.js');
        const myShort = this.$item?.short || '';
        let loc;
        if (this.current_item && this.isSelf(this.current_item)) {
            loc = buildSiteLoc(myShort, '', { view: 'site-main' });
        } else if (this.current_item) {
            loc = buildSiteLoc(myShort, buildFragment([{
                ctx: this.current_item.short || '',
                params: new Map([['view', 'site-main']]),
            }]), {});
        } else {
            loc = buildSiteLoc(myShort, '', { view: 'site-main' });
        }
        this._myLoc = loc;
        if (window.parent && window.parent !== window) {
            try { parent.postMessage({ kind: 'work-site-loc', loc }, location.origin); } catch {}
        } else {
            const cur = location.hash.replace(/^#/, '');
            if (cur !== loc) history.replaceState(null, '', '#' + loc);
        }
    },
    async ready() {
        this._boundAuth = () => this._onAuth();
        WORK.authEvents?.addEventListener('auth', this._boundAuth);
        WORK.AUTH_CHANNEL?.addEventListener('message', this._boundAuth);
        if (this.$item) {
            this.$item.expanded = true;
            await this.apply_location();
        }
    },
    detached() {
        if (this._boundAuth) {
            WORK.authEvents?.removeEventListener('auth', this._boundAuth);
            WORK.AUTH_CHANNEL?.removeEventListener('message', this._boundAuth);
        }
    }
}

ODA({
    is: 'site-nav-tree',
    imports: '~/lib//tree.js',
    extends: 'item-tree',
    execute(item) {
        if (!item) return;
        this.focusedItem = item;
        let host = this.host;
        while (host && typeof host.open_item !== 'function')
            host = host.host;
        host?.open_item(item);
    }
})
