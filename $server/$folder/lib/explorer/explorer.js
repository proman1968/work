export default {
    icon: 'odant:structure',
    imports: 'oda//app-layout.js, ~/lib//tree.js, ~/lib//node-explorer.js',
    extends: 'oda-app-layout',
    template: /*html*/`
        <item-tree light slot='left-panel' :items-selector :show-size show-users allow-focus :hide-roots :hide-tops :$item style="height: 0"></item-tree>
        <div flex vertical slot='main' style="overflow: hidden; position: relative;">
            <call-form ~if="showCall" id="callForm"></call-form>
            <item-hexagon-layout ~show="showHexagon" flex id="hexagon"></item-hexagon-layout>
            <user-profile flex ~if="showUser" id="profile"></user-profile>
            <div flex vertical ~show="showForms" style="z-index: 1;">
                <iframe ~show="focusedPage === $for.item" style="border: none;" flex ~for="pages" :src="$for.item"></iframe>
            <div>
        </div>
    `,
    visibleMode: 'main',
    showSize: false,
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
    get left_buttons() {
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
                get icon(){
                    return WORK.USER?.icon || 'icons:account-circle'
                },
                click: (e) => {
                    this.showUser = true;
                },
                style: 'color: white; fill: white; background:'  + WORK.USER?.iconColor || 'transparent',
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
    load_page(){
        let url = decodeURI(window.location.hash);
        if(url){
            url = url.replace('#', window.location.origin) + '/index.html';
            url = encodeURI(url);
            this.pages.add(url);
            this.visibleMode = 'main';
        }
        this.focusedPage = url;
        if(this.mobile && this.left_drawer)
            this.left_drawer.closed = true;
    },
    focusedPage: '',
    attached() {
        this.async(()=>{
            if(!WORK.uid){
                this.visibleMode = 'user';
                if(this.left_drawer)
                    this.left_drawer.closed = true;
            }
        })
        window.explorer = this;
        window.execute = async ($item) => {
            let url = window.location.origin + window.location.pathname + '#' + $item.short;
            if ($item.type !== '$handler')
                url += '/~/handlers/pages/' + ($item.page || 'form');
            location.assign(url);
            this.load_page();
        }
        window.addEventListener('hashchange', ()=>{
            this.load_page();
        });
        window.close = (win) => { //todo Разобраться!!!
            const iframe = this.$$('iframe').find(f => f.contentWindow === win);
            if (iframe) {
                const item = this.pages.find(url => {
                    return url === iframe.src
                });
                if (item) {
                    //this.focusedPage = (this.pages.indexOf(item) - 1);
                    this.pages.remove(item);

                    // открыть предыдущий page
                    let url = window.location.origin + window.location.pathname + '#';
                    if (this.pages.length) {
                        url += this.pages.last.replace(window.location.origin, '').replace('/index.html', '');
                    }
                    window.open(url, '_self');
                }
            }
        }
        this.load_page();
    },
    pages: [],
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