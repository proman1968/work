export default {
    label: 'APPS',
    icon: 'icons:dashboard',
    template: /* html */`
        <style>
            :host {
                @apply --flex;
                @apply --vertical;
                overflow: hidden;
            }
            .save-error-icon {
                anchor-name: --error-icon;
            }

            #error_tooltip {
                position-anchor: --error-icon;
                top: anchor(bottom);
                left: auto;
                right: anchor(left);
                margin: 0;

                @apply --error;
                background: #333;
                color: white;
                padding: 8px 12px;
                border-radius: 6px;
                font-size: 14px;
                pointer-events: none;
                border: none;
            }
            #error_tooltip::backdrop{
                pointer-events: none;
            }
        </style>
        <work-form :$item flex :view_name></work-form>
    `,
    view_name: {
        $def: '',
        $save: true
    }
}
ODA({is: 'work-form',
    imports: 'oda//icon, oda//app-layout, oda//property-grid, ~/lib//node-explorer, ~/lib//confirm.js, ~/lib//tree',
    extends: 'oda-app-layout',
    template: /* html */`
        <div ~show="!fullScreen" accent-invert slot="header" shadow horizontal flex style="padding: 2px; gap: 2px;">
            <oda-button  @tap="close" error :icon-size content-invert icon="icons:close" style="padding: 0px; border-radius: 50%; margin: 4px;"></oda-button>
            <item-node-explorer flex :$item style="align-items: center; overflow: hidden;" @resize>

                <div class="view-selector" flex horizontal style="justify-content: space-between; overflow: hidden;" ~style="{order: flow?1:0}">
                    <div flex></div>
                    <div class="flow" no-flex horizontal style="gap: 8px; border-radius: 4px; align-items: center;">
                        <div
                            ~if="view?.allowSave"
                            :disabled="saving"
                            :rainbow="saving"
                            :error-invert="$item?.isChanged && !!saveError"
                            :success-invert="$item?.isChanged && !saveError"
                            style="position: relative; align-items: center;"
                            horizontal
                        >
                            <oda-icon
                                ~if="saveError"
                                icon="icons:error"
                                @mouseenter="this.$('#error_tooltip').showPopover()"
                                @mouseleave="this.$('#error_tooltip').hidePopover()"
                                class="save-error-icon"
                            ></oda-icon>
                            <div id="error_tooltip" popover="manual">{{saveError}}</div>
                            <oda-button
                                :icon="saving ? 'spinners:8-dots-rotate' : 'icons:save'"
                                :icon-size
                                :disabled="!$item?.isChanged"
                                @tap="save"
                                style="border-radius: 4px;"
                                center
                            ></oda-button>

                        </div>
                        <div id="tools" raised no-flex horizontal style="min-height: 32px; align-items: center; border-bottom: 1px solid;">
                            <item-node :icon-size  :$item="view" @pointerdown.stop="openView"></item-node>
                            <oda-button hidden icon="icons:settings" :icon-size @tap.stop="settings"></oda-button>
                            <oda-button icon="icons:chevron-right:90" :icon-size @tap.stop="select_view" style="padding: 0px;"></oda-button>
                        </div>
                    </div>
                </div>
                <div horizontal  :flex="!!flow" style="justify-content: space-between; top: 0px; right: 0px; order: 0;">
                    <div flex></div>
                    <oda-button  @tap="invite" icon="social:share" style="padding: 4px;"></oda-button>
                    <oda-button ~if="modal" :icon="screenModeIcon" @tap="fullScreen = !fullScreen" style="padding: 4px;"></oda-button>

                </div>
            </item-node-explorer>
        </div>
        <div slot="footer" footer horizontal flex style="justify-items: space-between">
            <item-tools :$item filter="service"></item-tools>
            <item-tools :$item="focusedItem" filter="service"></item-tools>
            <div flex></div>
            <div no-flex horizontal ~show="dialog">
                <oda-button info-invert icon="icons:check" :icon-size @tap="ok" label="Apply"></oda-button>
            </div>
        </div>
    `,
    get allowZoom(){
        return window !== top;
    },
    iconSize: 24,
    get users(){
        return this.$item?.users.then(res=>{
            return res;
        });
    },
    get supervisor(){
        return this.users.then(users=>{
            return users.users.find?.(i=>i.id === 'supervisors')?.users.last;
        });
    },
    get admins(){
        return this.users.then(users=>{
            return users.users.find?.(i=>i.id === 'admins')?.users || [];
        });
    },
    get admin(){
        return this.admins.then(admins=>admins.last);
    },
    flow: 0,
    _onResize(e){
        if(e.target.offsetHeight > this.iconSize * 2)
            this.flow = this.clientWidth - e.target.offsetWidth;
        else
           this.flow = 0;
    },
    async invite(e){
          const shareData = {
            title: this.$item.id,
            text: 'Посмотрите эту ссылку',
            url: top.location.href,
        };

        try {
            // Проверяем поддержку Web Share API
            if (navigator.share && navigator.canShare(shareData)) {
                await navigator.share(shareData);
                console.log('Успешно поделились');
            } else {
            // Fallback для браузеров без поддержки
                fallbackShare(url, title);
            }
        } catch (err) {
            console.error('Ошибка при шеринге:', err);
        }
    },
    openView(e){
        if(e.button === 0 && this.view)
            window.open(this.view.short + '/');
    },
    back(e){
        alert('надо скрыть')
    },
    get screenModeIcon() {
        return this.fullScreen ? 'icons:fullscreen-exit' : 'icons:fullscreen';
    },
    fullScreen: {
        // $save: true,
        $def: false,
        set(n) {
            if (n) {
                if (this.popover) {
                    this.hidePopover();
                }
                this.requestFullscreen?.();
            }
            else if (document.fullscreenElement === this)
                document.exitFullscreen?.();

        }
    },
    async ready() {
        window.execute ??= ($item) => {
            let url = $item.short + '/';
            if($item.type !== '$handler')
               url += '~/handlers/pages/' + $item.page + '/'
            url = encodeURI(url);
            window.open(url, url)
        }
        // для закрытия вкладки браузера (form без explorer)
        if (window.parent !== window)
            window.close = () => {
                return this.close();
            }
    },
    view_name: '',
    $item: {
        $def: null,
        async set(n) {
            const view_name = this.host.default_view || this.host.view_name || this.$item?.form;
            this.view ||= await this.$item.get_item(`/~/handlers//form/${view_name}`);
        }
    },
    focusedItem: null,
    modal: false,
    dialog: false,
    get isTop(){
        return true;
        return window === top;
    },
    async close(e) {
        if (this.$item.isChanged) {
            const el = ODA.createElement('item-confirm', { $item: this.$item, message: 'Закрыть и ...' });
            const result = await WORK.showDialog(el, { $item: this.$item,  allowClose: true, OK: null, BUTTONS: [{label: 'Сохранить', icon: 'icons:save', success: true}, {label: 'Не сохранять', icon: 'icons:delete', error: true}]});
            switch(result){
                case 1:{
                    this.save();
                } break;
            }
            // this.$item.isChanged = false;
        }
        this.parentElement?.fire('close', true);
        if (!this.modal)
            window.parent?.close(window);
    },
    saving: false,
    saveError: null,
    save(e) {
        if (this.saving) return;
        this.saveError = null;
        this.saving = true;
        this.async(async ()=>{
            try{
                await this.$item.save(this.view_control?.body, {});
            }
            catch (err) {
                this.saveError = err;
            }
            finally{
                this.saving = false;
            }
        }, 100)
    },
    settings(e) {
        if(!this.view_control)
            return;
        let el = ODA.createComponent('oda-property-grid', {
            inspected: this.view_control
        });
        this.appendChild(el);
        WORK.showDropdown(el, {}, this.$('#tools'));

    },
    async select_view(e) {
        e.stopPropagation();
        e.preventDefault();
        const params = { $item: this.$item, path: '//form', hideTops: 1, hideRoots: 1 };
        params.execute = (handler) => {
            const form_idx = window.location.href.lastIndexOf('/form') + '/form'.length;
            const url = `${window.location.href.slice(0, form_idx)}/${handler.id}/index.html`;
            if (url === location.href) return;
            this.host.view_name = handler.id;
            location.assign(url);
        }
        let res = await WORK.showMenu(params, this.$('#tools'));
        // alert(res)
    },
    ok(e) {
        alert('ok')
    },
    cancel(e) {
        alert('cancel')
    },
    controls: {},
    view: {
        async set(n) {
            let el = this.controls[n.id];
            for (let id in this.controls) {
                let old = this.controls[id];
                if (old !== el && this.contains(old))
                    this.removeChild(old);
            }
            if (!el) {
                await n?.import?.(`data.js`);
                el =  ODA.createComponent('item-' + n.id, { $item: this.$item, slot: 'main', $handler: n });
                this.controls[n.id] = el;
                this.appendChild(el);
            }
            else if (!el.isConnected)
                this.appendChild(el);
            this.view_control = el;
            this.host.view_name = n.id;
        }
    },
    $listeners: {
        fullscreenchange(e) {
            if (document.fullscreenElement !== this) {
                this.fullScreen = false;
            }
        }
    }
})