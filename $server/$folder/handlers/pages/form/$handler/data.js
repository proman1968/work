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
            #tools {
                gap: 4px;
                padding: 4px;
                overflow-x: auto;
            }
            #tools oda-button {
                flex-shrink: 0;
            }
            #tools oda-button[info-invert] {
                flex-shrink: 1;
                min-width: 0;
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
    imports: 'oda//icon, oda//app-layout, ~/lib//node-explorer, ~/lib//confirm.js, ~/lib//tree',
    extends: 'oda-app-layout',
    template: /* html */`
        <div ~show="!fullScreen" accent-invert slot="header" shadow horizontal flex style="padding: 2px; gap: 4px;">
            <div center flex horizontal style="overflow: hidden; flex-wrap: balance;">
                <div :flex="ODA.states?.mobileMode"></div>
                <item-node-explorer no-flex :$item></item-node-explorer>
                <div flex></div>
                <div class="view-selector" no-flex horizontal style="justify-content: space-between; overflow: hidden;">
                    <div  class="flow" no-flex horizontal style="gap: 8px; border-radius: 4px; align-items: center;">
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
                        <div id="tools" raised no-flex horizontal style="min-height: 32px; align-items: center; gap: 8px; border-bottom: 1px solid;">
                            <oda-button
                                ~for="formViews"
                                :icon="$for.item.icon || 'files:file'"
                                :icon-size
                                :label="view?.id === $for.item.id ? view.label : ''"
                                :title="$for.item.label"
                                :info-invert="view?.id === $for.item.id"
                                :light="view?.id !== $for.item.id"
                                style="border-radius: 4px;"
                                @tap.stop="switchView($for.item, $event)"
                                @pointerdown.stop="view?.id === $for.item.id && openView($event)"
                            ></oda-button>
                        </div>
                    </div>
                </div>
            </div>
            <oda-button  @tap="close" error :icon-size content-invert icon="icons:close" style="border-radius: 50%; margin: 4px;"></oda-button>
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
    iconSize: 24,
    openView(e){
        if(e.button === 0 && this.view)
            window.open(this.view.short + '/');
    },
    back(e){
        alert('надо скрыть')
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
    formViews: [],
    async loadFormViews() {
        if (!this.$item) {
            this.formViews = [];
            return;
        }
        try {
            const root = await this.$item.fetch('handlers', {path: '//form'});
            this.formViews = (root?.items || []).filter(item =>
                item.type === '$handler' && item.allowUse !== false
            );
        } catch (err) {
            console.error(err);
            this.formViews = [];
        }
    },
    $item: {
        $def: null,
        async set(n) {
            const view_name = this.host.default_view || this.host.view_name || n?.form;
            this.view ||= await n.get_item(`/~/handlers//form/${view_name}`);
            this.loadFormViews();
        }
    },
    focusedItem: null,
    modal: false,
    dialog: false,
    get isTop(){
        return window === top;
    },
    async close(e) {
        if (this.$item?.isChanged) {
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
    switchView(handler, e) {
        e?.stopPropagation?.();
        e?.preventDefault?.();
        if (this.view?.id === handler.id) return;
        const form_idx = window.location.href.lastIndexOf('/form') + '/form'.length;
        const url = `${window.location.href.slice(0, form_idx)}/${handler.id}/index.html`;
        if (url === location.href) return;
        this.host.view_name = handler.id;
        location.assign(url);
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