export default {
    icon: 'iconoir:internet',
    label: 'Сайт',
    imports: 'oda//button, ~/lib//icon, ~/lib//user',
    template: /* html */`
    <style>
        :host {
            @apply --flex;
            @apply --vertical;
            overflow: hidden;

            .tabs-row {
                @apply --header;
                display: flex;
                flex-wrap: wrap;
                align-items: flex-end;
                gap: 4px;
            }
            menu {
                display: flex;
                flex-wrap: wrap;
                gap: 4px;
                margin: 0;
                padding: 0;
                list-style: none;
                flex: 1;
                min-width: 0;

                li {
                    @apply --vertical;
                    justify-content: end;

                    oda-button {
                        border-radius: 8px 8px 0 0;

                        &.self-tab {
                            border-radius: 0 8px 0 0;
                        }
                        &.selected {
                            @apply --raised;
                        }
                    }
                }
            }
            .user-slot {
                display: flex;
                align-items: center;
                padding: 0 8px 4px;
                margin-left: auto;
            }
            .user-slot .login-btn {
                border-radius: 8px;
            }
            .sheet {
                @apply --flex;
                @apply --vertical;
                @apply --content;
                overflow: hidden;
                min-height: 0;

                iframe {
                    border: none;
                    flex: 1;
                    width: 100%;
                    min-height: 0;
                }
            }
            .chrome {
                @apply --flex;
                @apply --vertical;
                overflow: hidden;
                min-height: 0;
            }
            .view-host {
                @apply --flex;
                @apply --vertical;
                overflow: hidden;
                min-height: 0;
            }
        }
    </style>
    <div ~if="!view_name" class="chrome" flex>
        <div class="tabs-row">
            <menu>
                <li ~for="child_items">
                    <oda-button
                        ~class="{selected: current_item === $for.item, 'self-tab': isSelf($for.item)}"
                        @tap="open_subpage($for.item)"
                        :icon="$for.item.icon || 'iconoir:link'"
                        :icon-size="isSelf($for.item) ? 32 : 24"
                        :label="$for.item.label"
                    ></oda-button>
                </li>
            </menu>
            <div ~if="isTopSite" class="user-slot">
                <oda-button
                    ~if="!isLoggedIn"
                    class="login-btn"
                    label="Войти"
                    icon="icons:account-circle"
                    @tap="open_profile"
                ></oda-button>
                <item-user
                    ~if="isLoggedIn"
                    :$item="currentUser"
                    round
                    :icon-size="32"
                    @tap="open_profile"
                ></item-user>
            </div>
        </div>
        <div class="sheet" flex>
            <iframe ~for="frames" ~show="current_href === $for.item.href" :src="$for.item.href"></iframe>
        </div>
    </div>
    <div ~if="view_name" class="view-host" flex id="view-host"></div>
    `,
    view_name: {
        $def: '',
        set(n) {
            if (n)
                this.async(() => this.mount_view());
        }
    },
    default_view: 'main',
    current_href: '',
    current_item: null,
    frames: [],
    _frameSeq: 0,
    controls: {},
    get isLoggedIn() {
        return !!WORK.uid;
    },
    get isTopSite() {
        return window.parent === window;
    },
    get currentUser() {
        return WORK.USER;
    },
    _onAuth() {
        this.isLoggedIn = undefined;
        this.currentUser = undefined;
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
    get child_items() {
        return new AsyncPromise(async () => {
            if (!this.$item) return [];
            const children = ((await this.$item.items) || []).filter(i => i instanceof CORE.$class);
            return [this.$item, ...children];
        });
    },
    isSelf(item) {
        return item === this.$item || item?.short === this.$item?.short;
    },
    frame_url(item) {
        if (this.isSelf(item))
            return new URL(item.url + `/~/handlers//site/${this.default_view}/index.html`).href;
        return new URL(item.url + '/~/handlers//site/index.html').href;
    },
    open_subpage(item) {
        if (!item) return;
        const href = this.frame_url(item);
        if (!this.frames.find(f => f.href === href)) {
            this.frames = [...this.frames, { id: ++this._frameSeq, href }];
        }
        this.current_item = item;
        this.current_href = href;
    },
    async mount_view() {
        const name = this.view_name;
        if (!name || !this.$item) return;
        let el = this.controls[name];
        if (!el) {
            const view = await this.$item.get_item(`/~/handlers//site/${name}`);
            await view?.import?.('class.js');
            el = ODA.createComponent('item-' + view.id, { $item: this.$item, $handler: view });
            this.controls[name] = el;
        }
        const host = this.$('#view-host');
        if (host && el && !host.contains(el)) {
            while (host.firstChild)
                host.removeChild(host.firstChild);
            host.appendChild(el);
        }
    },
    async ready() {
        if (this.view_name) {
            await this.mount_view();
            return;
        }
        this._boundAuth = () => this._onAuth();
        WORK.authEvents?.addEventListener('auth', this._boundAuth);
        WORK.AUTH_CHANNEL?.addEventListener('message', this._boundAuth);
        if (this.$item)
            this.open_subpage(this.$item);
    },
    detached() {
        if (this._boundAuth) {
            WORK.authEvents?.removeEventListener('auth', this._boundAuth);
            WORK.AUTH_CHANNEL?.removeEventListener('message', this._boundAuth);
        }
    }
}
