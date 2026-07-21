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
                flex-wrap: nowrap;
                align-items: center;
                gap: 16px;
                min-width: 0;
                padding: 4px 0 0;

                &.stacked {
                    flex-wrap: wrap;
                    row-gap: 4px;
                    column-gap: 16px;
                    align-items: stretch;

                    .self-slot {
                        flex: 1;
                        min-width: 0;

                        oda-button {
                            width: 100%;
                            justify-content: flex-start;
                        }
                    }
                    .tabs-scroll-wrap {
                        flex: 1 0 100%;
                        order: 3;
                        max-width: 100%;
                    }
                    .user-slot {
                        margin-left: 0;
                        padding-bottom: 0;
                    }
                }

                .self-tab {
                    border-radius: 0 3cqmin 0 0;
                    padding: 6px;
                }
            }
            .self-slot {
                @apply --vertical;
                justify-content: center;
                flex-shrink: 0;

                oda-button {
                    border-radius: 8px;

                    &.selected {
                        @apply --raised;
                    }
                }
            }
            .tabs-scroll-wrap {
                flex: 1;
                min-width: 0;
                position: relative;
                border-radius: 100cqmin;
                overflow: hidden;

                &::before,
                &::after {
                    content: '';
                    position: absolute;
                    top: 0;
                    bottom: 4px;
                    width: 28px;
                    pointer-events: none;
                    opacity: 0;
                    z-index: 1;
                    transition: opacity 0.15s ease;
                }
                &::before {
                    left: 0;
                    background: linear-gradient(to right, rgba(0, 0, 0, 0.2), transparent);
                }
                &::after {
                    right: 0;
                    background: linear-gradient(to left, rgba(0, 0, 0, 0.2), transparent);
                }
                &.can-scroll-left::before {
                    opacity: 1;
                }
                &.can-scroll-right::after {
                    opacity: 1;
                }
            }
            .tabs-scroll {
                overflow-x: auto;
                overflow-y: hidden;
                scrollbar-width: thin;
                padding: 4px 8px 6px;

                &::-webkit-scrollbar {
                    height: 4px;
                }
                &::-webkit-scrollbar-thumb {
                    background: rgba(0, 0, 0, 0.25);
                    border-radius: 2px;
                }

                menu {
                    display: flex;
                    flex-wrap: nowrap;
                    align-items: center;
                    gap: 6px;
                    margin: 0;
                    padding: 0;
                    list-style: none;
                    width: max-content;
                    min-width: 100%;
                    min-height: 36px;

                    li {
                        display: flex;
                        align-items: center;
                        flex-shrink: 0;

                        oda-button {
                            --oda-button-padding: 0 14px;
                            height: 32px;
                            min-height: 32px;
                            border-radius: 100cqmin;
                            font-size: 14px;
                            font-weight: 500;
                            letter-spacing: 0.01em;
                            opacity: 0.65;
                            background: transparent;
                            box-shadow: none;

                            &:hover {
                                opacity: 0.9;
                                background: color-mix(in oklab, var(--dark-background) 35%, transparent);
                            }
                            &.selected {
                                opacity: 1;
                                @apply --accent-invert;
                                box-shadow: none;
                            }
                        }
                    }
                }
            }
            .user-slot {
                display: flex;
                align-items: center;
                padding: 0 8px;
                margin-left: auto;
                flex-shrink: 0;
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
        <div class="tabs-row" id="tabs-row" ~class="{stacked: tabsStacked}">
            <div class="self-slot" id="self-slot">
                <oda-button
                    class="self-tab"
                    ~class="{selected: current_item === $item}"
                    @tap="open_subpage($item)"
                    :icon="$item.icon || 'iconoir:internet'"
                    :icon-size="32"
                    :label="$item.label"
                ></oda-button>
            </div>
            <div
                class="tabs-scroll-wrap"
                ~class="{'can-scroll-left': tabsCanScrollLeft, 'can-scroll-right': tabsCanScrollRight}"
            >
                <div id="tabs-scroll" class="tabs-scroll">
                    <menu>
                        <li ~for="sub_items">
                            <oda-button
                                ~class="{selected: current_item === $for.item}"
                                @tap="open_subpage($for.item)"
                                :icon="$for.item.icon || 'iconoir:link'"
                                :icon-size="18"
                                :label="$for.item.label"
                            ></oda-button>
                        </li>
                    </menu>
                </div>
            </div>
            <div ~if="isTopSite" class="user-slot" id="user-slot">
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
    tabsCanScrollLeft: false,
    tabsCanScrollRight: false,
    tabsStacked: false,
    _selfNaturalWidth: 0,
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
    get sub_items() {
        if (!this.$item) return [];
        return Promise.resolve(this.$item.items).then(items =>
            (items || []).filter(i => i instanceof CORE.$class)
        );
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
    updateTabsScrollHints() {
        const el = this._tabsScrollEl || this.$('#tabs-scroll');
        if (!el) {
            this.tabsCanScrollLeft = false;
            this.tabsCanScrollRight = false;
            return;
        }
        const max = el.scrollWidth - el.clientWidth;
        const left = el.scrollLeft;
        this.tabsCanScrollLeft = left > 1;
        this.tabsCanScrollRight = max > 1 && left < max - 1;
    },
    updateTabsStacked() {
        const row = this.$('#tabs-row');
        const self = this.$('#self-slot');
        const user = this.$('#user-slot');
        if (!row || !self) return;

        if (!this.tabsStacked) {
            const w = Math.ceil(self.getBoundingClientRect().width);
            if (w > 0)
                this._selfNaturalWidth = w;
        } else if (!this._selfNaturalWidth) {
            const btn = self.querySelector('oda-button');
            this._selfNaturalWidth = Math.ceil(btn?.scrollWidth || self.scrollWidth || 120);
        }

        const gap = 16;
        const userW = user ? Math.ceil(user.getBoundingClientRect().width) : 0;
        const selfW = this._selfNaturalWidth || Math.ceil(self.getBoundingClientRect().width);
        const available = row.clientWidth - selfW - userW - gap;
        const stacked = available < 400;
        if (stacked !== this.tabsStacked) {
            this.tabsStacked = stacked;
            this.async(() => this.updateTabsScrollHints());
        }
    },
    _onTabsWheel(e) {
        const el = this._tabsScrollEl;
        if (!el) return;
        if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
        const max = el.scrollWidth - el.clientWidth;
        if (max <= 0) return;
        const next = el.scrollLeft + e.deltaY;
        if (next <= 0 && el.scrollLeft <= 0) return;
        if (next >= max && el.scrollLeft >= max) return;
        e.preventDefault();
        el.scrollLeft = next;
    },
    _onTabsChromeResize() {
        this.updateTabsStacked();
        this.updateTabsScrollHints();
    },
    _setupTabsScroll() {
        const el = this.$('#tabs-scroll');
        const row = this.$('#tabs-row');
        if (!el) return;
        if (this._tabsScrollEl !== el) {
            this._teardownTabsScroll();
            this._tabsScrollEl = el;
            this._boundTabsScroll = () => this.updateTabsScrollHints();
            this._boundTabsWheel = (e) => this._onTabsWheel(e);
            el.addEventListener('scroll', this._boundTabsScroll, { passive: true });
            el.addEventListener('wheel', this._boundTabsWheel, { passive: false });
            this._tabsResizeObserver = new ResizeObserver(() => this._onTabsChromeResize());
            this._tabsResizeObserver.observe(el);
            const menu = el.querySelector('menu');
            if (menu)
                this._tabsResizeObserver.observe(menu);
            if (row)
                this._tabsResizeObserver.observe(row);
        }
        this.updateTabsStacked();
        this.updateTabsScrollHints();
    },
    _teardownTabsScroll() {
        const el = this._tabsScrollEl;
        if (el) {
            if (this._boundTabsScroll)
                el.removeEventListener('scroll', this._boundTabsScroll);
            if (this._boundTabsWheel)
                el.removeEventListener('wheel', this._boundTabsWheel);
        }
        this._tabsResizeObserver?.disconnect();
        this._tabsResizeObserver = null;
        this._tabsScrollEl = null;
        this._boundTabsScroll = null;
        this._boundTabsWheel = null;
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
        this.async(() => this._setupTabsScroll());
        await this.sub_items;
        this.async(() => this._setupTabsScroll());
        if (this.$item)
            this.open_subpage(this.$item);
    },
    detached() {
        this._teardownTabsScroll();
        if (this._boundAuth) {
            WORK.authEvents?.removeEventListener('auth', this._boundAuth);
            WORK.AUTH_CHANNEL?.removeEventListener('message', this._boundAuth);
        }
    }
}
