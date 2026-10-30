export default {
    icon: 'odant:structure',
    imports: 'oda//app-layout.js, oda//icon, oda//button, ~/lib//tree.js, ~/lib//node-explorer.js, ~/lib//consultant.js',
    extends: 'oda-app-layout',
    template: /*html*/`
        <item-tree slot='left-panel' allow-search :items-selector :show-size show-status show-users allow-focus :hide-roots :hide-tops :$item style="height: 0"></item-tree>
        <item-consultant slot='left-panel' id="consultant" label="ИИ" icon="bootstrap:robot" :$item hidden style="height: 0"></item-consultant>
        <div flex vertical slot='main' style="overflow: hidden; position: relative;">
            <call-form ~if="showCall" id="callForm"></call-form>
            <item-hexagon-layout ~show="showHexagon" flex id="hexagon"></item-hexagon-layout>
            <user-profile flex ~if="showUser" id="profile"></user-profile>
            <div id="formsWrap" flex vertical ~show="showForms" style="z-index: 1; min-height: 0;">
                <iframe ~show="focusedPage === $for.item" style="border: none;" flex ~for="pages" :src="$for.item"></iframe>
            </div>
        </div>
        <div id="bookmarksBar" slot="footer" class="pe-no-print" horizontal no-flex :hidden="!hasBookmarks" ~show="hasBookmarks" style="display: flex; flex-direction: row; align-items: center; gap: 4px; padding: 3px 6px; min-height: 44px; height: 44px; box-sizing: border-box; background: var(--header-background); color: var(--header-color); border-top: 1px solid var(--border-color); overflow-x: auto; overflow-y: hidden; user-select: none; z-index: 2;">
            <div horizontal flex style="display: flex; flex-direction: row; align-items: center; gap: 4px; flex: 1; min-width: 0; overflow-x: auto; overflow-y: hidden; scrollbar-width: thin;">
                <div ~for="bookmarks" :title="$for.item.title || $for.item.short" @tap="activateBookmark($for.item)" @auxclick="onBookmarkAuxClick($for.item, $event)" ~style="bookmarkItemStyle($for.item)">
                    <oda-icon :icon="$for.item.icon || 'icons:dashboard'" icon-size="18"></oda-icon>
                    <span style="max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; line-height: 1.15;">{{$for.item.label}}</span>
                    <span title="Закрыть форму" @tap.stop="closeBookmark($for.item, $event)" style="position: absolute; top: 1px; right: 2px; width: 14px; height: 14px; display: inline-flex; align-items: center; justify-content: center; border-radius: 3px; font-size: 10px; font-weight: 700; line-height: 1; opacity: 0.65;">✕</span>
                </div>
            </div>
            <button type="button" ~if="bookmarks.length > 1" title="Закрыть все открытые формы" @tap.stop="closeAllBookmarks($event)" style="display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; margin-left: 4px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--content-background); color: var(--content-color); font-size: 12px; font-weight: 700; cursor: pointer; flex-shrink: 0;">✕</button>
        </div>
    `,
    visibleMode: 'main',
    showSize: false,
    pages: [],
    bookmarks: [],
    focusedPage: '',
    get hasBookmarks() {
        return Array.isArray(this.bookmarks) && this.bookmarks.length > 0 && this.visibleMode === 'main';
    },
    bookmarkItemStyle(bm) {
        const isActive = Boolean(bm && this.focusedPage === bm.url && this.visibleMode === 'main');
        return {
            position: 'relative',
            display: 'inline-flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1px',
            minWidth: '64px',
            maxWidth: '200px',
            height: '38px',
            padding: '2px 18px 2px 10px',
            boxSizing: 'border-box',
            borderRadius: '3px',
            cursor: 'pointer',
            flexShrink: '0',
            fontWeight: isActive ? '600' : '500',
            border: isActive ? '1px solid var(--accent-color)' : '1px solid var(--border-color)',
            background: isActive
                ? 'color-mix(in oklch, var(--accent-color) 22%, var(--content-background))'
                : 'var(--content-background)',
            color: 'var(--content-color)',
            fill: 'var(--content-color)',
        };
    },
    get showCall(){
        return this.visibleMode === 'call' && this.left_drawer.closed;
    },
    set showCall(n){
        this.visibleMode = 'call';
        this.left_drawer.closed = n;
        this.left_buttons = undefined;
        if (!n) {
            this.load_page();
        }
    },
    get showHexagon(){
        if(this.visibleMode === 'main')
            return !this.focusedPage;
        return !this.left_drawer.closed;
    },
    get showUser(){
        return this.visibleMode === 'user' && this.left_drawer.closed;
    },
    set showUser(n){
        this.visibleMode = 'user';
        this.left_drawer.closed = n;
    },
    get showForms(){
        return !!this.focusedPage && this.visibleMode === 'main';
    },
    async begin_call(){
        this.showCall = true;
        return new Promise((resolve) => {
            this.async(() => {
                resolve(this.$('#callForm'));
            }, 500);
        });
    },

    get hexagon() {
        return this.$('#hexagon');
    },
    user_icon: {
        $def: 'icons:account-circle',
        get() {
            return Promise.resolve(WORK.USER?.icon).then(i => i || 'icons:account-circle');
        }
    },
    get left_buttons() {
        let user_icon = this.user_icon;
        if (user_icon && typeof user_icon.then === 'function')
            user_icon = 'icons:account-circle'; // пока грузится
        const user_color = WORK.USER?.iconColor || 'transparent';
        let buttons = [
            {
                round: true,
                icon: 'eva:o-phone-call-outline',
                click: (e) => {
                    this.showCall = true;
                },
                rainbow: true,
                hidden:{
                    $attr: true,
                    get(){
                        return !top.RTCCaller.current_call
                    }
                }
            },
            {
                round: true,
                icon: user_icon,
                default: 'icons:account-circle',
                style: `color: white; fill: white; background:${user_color}`,
                click: (e) => {
                    this.showUser = true;
                },
                get errorInvert(){
                    return !WORK.uid;
                }

            },
            {
                round: true,
                icon: 'icons:apps',
                click: (e) => {
                    e.stopPropagation();
                    this.visibleMode = 'main';
                    let url = window.location.origin + window.location.pathname + '#';
                    window.open(url, '_self');
                    this.left_drawer.closed = !this.left_drawer.closed;
                }
            }
        ]

        buttons[0].hidden = !top.RTCCaller.current_call
        return buttons;
    },
    _onFocusedIndexChanged(e) {
        this.visibleMode = 'main';
        const drawer = this.left_drawer;
        const activeCtrl = drawer?.controls?.[drawer.focusedIndex];
        if (activeCtrl && typeof activeCtrl.onShow === 'function')
            activeCtrl.onShow();
    },
    /**
     * Открыть панель ИИ «Консультант» вместо дерева в левой панели
     * и (если передан контекст открытой формы) автоматически задать вопрос.
     */
    async openConsultant(ctx) {
        this.visibleMode = 'main';
        const drawer = this.left_drawer;
        const consultant = this.$('#consultant') || this.$('item-consultant');
        if (drawer) {
            const controls = drawer.controls || [];
            const idx = controls.findIndex(c => c === consultant || c?.localName === 'item-consultant' || c?.id === 'consultant');
            if (idx >= 0) {
                drawer.closed = false;
                const tabs = drawer.$?.('app-tabs');
                if (tabs)
                    tabs.focusedIndex = idx;
                drawer.focusedIndex = idx;
                drawer._persistActiveTab?.(idx);
                drawer.updateControls?.();
            }
        }
        if (consultant) {
            consultant.onShow?.();
            if (ctx)
                await consultant.askAboutContext(ctx);
        }
        return consultant;
    },
    async _onClose(e) {
        let $item = e.detail.value;
        let iframe = this.$$('iframe').find(f => f.src === $item.open_url);
        let result = await iframe?.contentWindow.close();
    },
    get icon() {
        return this.$handler?.icon;
    },
    hideRoots: 1,
    hideTops: 0,
    itemsSelector: 'items',

    _bookmarksStorageKey() {
        const root = this.$item?.short || this.$item?.path || '/';
        return 'work.explorer.bookmarks:' + root;
    },
    _extractShortFromUrl(pageUrl = '') {
        if (!pageUrl)
            return '';
        try {
            let s = decodeURI(String(pageUrl));
            if (s.startsWith(window.location.origin))
                s = s.slice(window.location.origin.length);
            s = s.replace(/\/index\.html$/, '');
            s = s.replace(/\/~\/handlers\/pages\/[^/]+\/?$/, '');
            return s || '/';
        }
        catch {
            return '';
        }
    },
    _extractHashFromUrl(pageUrl = '') {
        if (!pageUrl)
            return '';
        try {
            let s = decodeURI(String(pageUrl));
            if (s.startsWith(window.location.origin))
                s = s.slice(window.location.origin.length);
            s = s.replace(/\/index\.html$/, '');
            return '#' + s;
        }
        catch {
            return '';
        }
    },
    _defaultLabelForShort(short = '') {
        const clean = String(short || '').replace(/\/+$/, '');
        const last = clean.split('/').filter(Boolean).pop() || 'Форма';
        if (last === 'REGISTER')
            return 'Бухгалтерский журнал';
        if (last === 'OPERATIONS')
            return 'Операции';
        if (last === 'CATALOGS')
            return 'Справочники';
        return last;
    },
    _defaultIconForItem($item, short = '') {
        if ($item?.DATA?.icon)
            return $item.DATA.icon;
        if ($item?.icon && typeof $item.icon === 'string')
            return $item.icon;
        const last = String(short || '').split('/').filter(Boolean).pop() || '';
        if (last === 'REGISTER')
            return 'odant:grid';
        if (/^\d+(?:\.\d+)?$/.test(last))
            return 'odant:calendar';
        if (/\.[a-z0-9]+$/i.test(last)) {
            const ext = last.split('.').pop().toLowerCase();
            return 'files-color:s-' + ext;
        }
        return 'icons:dashboard';
    },
    _saveBookmarksState() {
        if (typeof localStorage === 'undefined')
            return;
        try {
            const data = {
                activeUrl: this.focusedPage || '',
                items: (this.bookmarks || []).map(b => ({
                    url: b.url,
                    hash: b.hash,
                    short: b.short,
                    stateKey: b.stateKey || '',
                    label: b.label,
                    title: b.title,
                    icon: b.icon,
                })),
            };
            localStorage.setItem(this._bookmarksStorageKey(), JSON.stringify(data));
        }
        catch { /* ignore */ }
    },
    _restoreBookmarksState() {
        if (typeof localStorage === 'undefined')
            return null;
        try {
            const raw = localStorage.getItem(this._bookmarksStorageKey());
            if (!raw)
                return null;
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed?.items) || !parsed.items.length)
                return null;
            const validItems = parsed.items.filter(b => b && typeof b.url === 'string' && b.url.startsWith(window.location.origin));
            if (!validItems.length)
                return null;
            for (const b of validItems) {
                if (!b.short)
                    b.short = this._extractShortFromUrl(b.url);
                if (!b.hash)
                    b.hash = this._extractHashFromUrl(b.url);
                if (!b.label)
                    b.label = this._defaultLabelForShort(b.short);
                if (!b.icon)
                    b.icon = this._defaultIconForItem(null, b.short);
                if (!b.title)
                    b.title = `${b.label} (${b.short})`;
            }
            this.bookmarks = validItems;
            const activeUrl = parsed.activeUrl || validItems.at(-1)?.url || '';
            setTimeout(() => {
                for (const b of this.bookmarks || [])
                    this._hydrateBookmarkMeta(b, { cachedOnly: true });
            }, 1200);
            return {
                activeUrl,
                items: validItems,
            };
        }
        catch {
            return null;
        }
    },
    async _hydrateBookmarkMeta(entry, { cachedOnly = false } = {}) {
        if (!entry?.short)
            return;
        try {
            const cached = CORE?.$item?.ITEMS?.[entry.short];
            if (!cached && cachedOnly)
                return;
            const item = cached || await WORK.get_item(entry.short);
            if (!item)
                return;
            const rawLabel = item.DATA?.label || item.label || item.id || entry.label;
            const code = entry.short.split('/').filter(Boolean).pop() || '';
            const isAcc = item.type === '$account' || /^\d+(?:\.\d+)?$/.test(code);
            let label = String(rawLabel || entry.label);
            if (code === 'REGISTER' && (label === 'REGISTER' || label === 'План счетов и журнал'))
                label = 'Бухгалтерский журнал';
            else if (isAcc && code && !label.startsWith(code + ' ') && label !== code)
                label = `${code} ${label}`;
            const icon = this._defaultIconForItem(item, entry.short);
            if (entry.label !== label || entry.icon !== icon) {
                entry.label = label;
                entry.title = `${label} (${entry.short})`;
                entry.icon = icon;
                this.bookmarks = [...(this.bookmarks || [])];
                this._saveBookmarksState();
            }
        }
        catch { /* ignore */ }
    },
    _upsertBookmarkForUrl(pageUrl, $item = null) {
        if (!pageUrl)
            return null;
        const short = $item?.short || $item?.path || this._extractShortFromUrl(pageUrl);
        const hash = this._extractHashFromUrl(pageUrl);
        const list = Array.isArray(this.bookmarks) ? [...this.bookmarks] : [];
        const itemStateKey = ($item && ('_stateKey' in Object($item)) && $item._stateKey) ? String($item._stateKey) : '';
        let bm = list.find(b => b.url === pageUrl);
        if (!bm) {
            const label = $item?.DATA?.label || $item?.label || this._defaultLabelForShort(short);
            bm = {
                url: pageUrl,
                hash,
                short,
                stateKey: itemStateKey,
                label,
                title: `${label} (${short})`,
                icon: this._defaultIconForItem($item, short),
            };
            list.push(bm);
            this.bookmarks = list;
            setTimeout(() => this._hydrateBookmarkMeta(bm, { cachedOnly: true }), 800);
        }
        else if ($item) {
            const label = $item?.DATA?.label || $item?.label || bm.label;
            const icon = this._defaultIconForItem($item, short);
            if (itemStateKey)
                bm.stateKey = itemStateKey;
            if (bm.label !== label || bm.icon !== icon) {
                bm.label = label;
                bm.icon = icon;
                this.bookmarks = [...list];
            }
        }
        this._saveBookmarksState();
        return bm;
    },
    /**
     * Раскрыть дерево и сфокусироваться на элементе, от которого открыта форма.
     */
    async syncTreeToPath(targetPath) {
        if (!targetPath)
            return;
        const clean = String(targetPath).replace(/\/~\/handlers\/.*$/, '').replace(/\/+$/, '') || '/';
        const trees = (this.$$('item-tree') || []).filter(t => !t.hidden);
        let matchedTree = null;
        for (const t of trees) {
            const rootShort = String(t.$item?.short || t.$item?.path || '/').replace(/\/+$/, '') || '/';
            if (rootShort !== '/' && (clean === rootShort || clean.startsWith(rootShort + '/'))) {
                matchedTree = t;
                break;
            }
        }
        if (!matchedTree)
            matchedTree = trees.find(t => (t.$item?.short || t.$item?.path || '/') === '/') || trees[0];
        if (matchedTree && typeof matchedTree.revealPath === 'function') {
            await matchedTree.revealPath(clean);
        }
    },
    activateBookmark(bm) {
        if (!bm?.url)
            return;
        this.visibleMode = 'main';
        const hash = bm.hash || this._extractHashFromUrl(bm.url);
        if (hash && decodeURI(window.location.hash) !== decodeURI(hash)) {
            history.replaceState(null, '', window.location.pathname + hash);
        }
        this.load_page(bm.url);
    },
    onBookmarkAuxClick(bm, e) {
        if (e?.button === 1) {
            e.preventDefault();
            this.closeBookmark(bm, e);
        }
    },
    closeBookmark(bm, e) {
        e?.stopPropagation?.();
        if (!bm?.url)
            return;
        const url = bm.url;
        this.pages.remove(url);
        const list = (this.bookmarks || []).filter(b => b.url !== url);
        this.bookmarks = list;
        if (this.focusedPage === url) {
            const next = list.at(-1);
            if (next) {
                this.activateBookmark(next);
            }
            else {
                this.focusedPage = '';
                this._saveBookmarksState();
                history.replaceState(null, '', window.location.pathname);
            }
        }
        else {
            this._saveBookmarksState();
        }
    },
    closeAllBookmarks(e) {
        e?.stopPropagation?.();
        this.pages.splice(0, this.pages.length);
        this.bookmarks = [];
        this.focusedPage = '';
        this._saveBookmarksState();
        history.replaceState(null, '', window.location.pathname);
    },

    load_page(explicitUrl = '') {
        let url = explicitUrl;
        if (!url) {
            let hash = decodeURI(window.location.hash);
            if (hash && hash !== '#') {
                url = hash.replace('#', window.location.origin) + '/index.html';
                url = encodeURI(url);
            }
        }
        if (url) {
            this.pages.add(url);
            this.visibleMode = 'main';
            this.focusedPage = url;
            const bm = this._upsertBookmarkForUrl(url);
            if (bm?.stateKey || bm?.short)
                this.syncTreeToPath(bm.stateKey || bm.short);
            this.async(() => {
                for (const sel of ['#formsWrap', '#bookmarksBar']) {
                    const node = this.$?.(sel);
                    if (node) {
                        if (node[R]?.states)
                            node[R].states.sleep = false;
                        node.render?.(true);
                    }
                }
                for (const f of this.$$?.('iframe') || []) {
                    if (f[R]?.states)
                        f[R].states.sleep = false;
                    f.render?.(true);
                }
            }, 10);
        }
        else {
            this.focusedPage = '';
            this._saveBookmarksState();
        }
        if(this.mobile && this.left_drawer)
            this.left_drawer.closed = true;
        this.async(() => {
            const cons = this.$('#consultant') || this.$('item-consultant');
            cons?.refreshFormContext?.();
        }, 250);
    },
    attached() {
        this.async(async ()=>{
            if(!WORK.uid && !WORK.DEV_MODE){
                this.visibleMode = 'user';
                if(this.left_drawer)
                    this.left_drawer.closed = true;
            }
            if (this.$item?.type === '$server' && !WORK.DEV_MODE) {
                try {
                    const isAdm = await this.$item.isAdmin;
                    this.hideTops = isAdm ? 0 : 1;
                }
                catch { /* ignore */ }
            }
        })
        window.explorer = this;
        WORK.authEvents?.addEventListener('auth', () => {
            this.user_icon = undefined;
            this.left_buttons = undefined;
            this.render?.();
        });
        window.execute = async ($item, nav) => {
            const short = $item?.short ?? $item?.path ?? '';
            if (nav && typeof nav === 'object') {
                try {
                    sessionStorage.setItem('work.form.nav:' + short, JSON.stringify(nav));
                    new BroadcastChannel('work-form-nav').postMessage({ short, nav });
                }
                catch { /* ignore */ }
            }
            let hash = '#' + short;
            if ($item.type !== '$handler')
                hash += '/~/handlers/pages/' + ($item.page || 'form');
            history.replaceState(null, '', window.location.pathname + hash);
            const fullUrl = encodeURI(window.location.origin + short + ($item.type !== '$handler' ? '/~/handlers/pages/' + ($item.page || 'form') : '') + '/index.html');
            this._upsertBookmarkForUrl(fullUrl, $item);
            this.load_page(fullUrl);
        }
        window.addEventListener('hashchange', ()=>{
            this.load_page();
        });
        window.close = (win) => {
            const iframe = this.$$('iframe').find(f => f.contentWindow === win);
            if (iframe) {
                const url = this.pages.find(u => u === iframe.src);
                if (url) {
                    const bm = (this.bookmarks || []).find(b => b.url === url);
                    if (bm) {
                        this.closeBookmark(bm);
                        return;
                    }
                    this.pages.remove(url);
                    let nextHash = window.location.origin + window.location.pathname + '#';
                    if (this.pages.length) {
                        nextHash += this.pages.last.replace(window.location.origin, '').replace('/index.html', '');
                    }
                    window.open(nextHash, '_self');
                }
            }
        }
        const restored = this._restoreBookmarksState();
        const hasInitialHash = Boolean(window.location.hash && window.location.hash !== '#');
        if (!hasInitialHash && restored?.activeUrl) {
            const activeBm = restored.items.find(b => b.url === restored.activeUrl) || restored.items.at(-1);
            if (activeBm) {
                const hash = activeBm.hash || this._extractHashFromUrl(activeBm.url);
                if (hash)
                    history.replaceState(null, '', window.location.pathname + hash);
                this.load_page(activeBm.url);
                return;
            }
        }
        this.load_page();
    },
}

ODA({ is: 'item-hexagon-layout', imports: 'oda//hexagon-layout.js', extends: 'oda-hexagon-layout',
    async _onDrop(e) {
        if (this.isMoveDrag) {
            this._onDropDef(e);
            return;
        }
        e.preventDefault();
        const x = +e.target.dataset.x, y = +e.target.dataset.y;
        let data = e.dataTransfer.getData('data');
        data = JSON.parse(data);
        let $item = new this.$pdp.$item.constructor(data);
        let $handler = await new Promise(async (resolve, reject) => {
            const params = {
                $item, path: '', execute: async e => {
                    const res = await e;
                    resolve(res);
                    this.render();
                }
            };
            const el = ODA.createElement('item-menu', params);
            let res = await WORK.showModal(el, { TITLE:{label:'Select executor' }});
        })
        let shortcut = {
            x,
            y,
            label: '<u>' + $item.short.replaceAll('//', '').replaceAll('/', ' / ') + '</u><br><b>' + $handler.label + '</b>',
            title: $item.short,
            item_path: $item.path,
            handler_path: $handler.path,
            props: {
                icon: $item.icon,
                title: $item.short,
                subIcon: $handler?.icon || 'icons:warning',
                subTitle: $handler?.label || 'warning'
            }
        };
        this.items.push(shortcut);
        this.isMoveDrag = false;
    },
    async _onHexTap(item) {
        const $item = await WORK.get_item(item.item_path);
        if (item.isTop) {
            window.execute($item);
        } else {
            const $handler = await WORK.get_item(item.handler_path);
            $handler.$context = $item;
            $handler.execute();
        }
    },
})
