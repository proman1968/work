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
        <style>
            .view-enter {
                animation: view-fade-in 0.5s ease;
            }
            @keyframes view-fade-in {
                from { opacity: 0; }
                to { opacity: 1; }
            }
        </style>
        <div ~show="!fullScreen" accent-invert slot="header" shadow horizontal flex style="padding: 2px; gap: 4px;">
            <div center flex horizontal style="overflow: hidden; flex-wrap: balance;">
                <div :flex="ODA.states?.mobileMode"></div>
                <item-node-explorer no-flex :$item></item-node-explorer>
                <div flex></div>
                <slot name="top-panel"></slot>
                <div class="view-selector" no-flex horizontal style="justify-content: space-between; overflow: hidden;">
                    <div  class="flow" no-flex horizontal style="gap: 8px; border-radius: 4px; align-items: center;">
                            <oda-button ~if="showRoleSelector" :icon="roleIcon" :label="activeRole" :icon-size  @tap="nextRole"
                                style="font-size: xx-small;"
                                center icon-pos="top"
                            ></oda-button>
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
                            <item-node
                                ~for="formViews"
                                :$item="$for.item"
                                :hide-label="view?.id !== $for.item.id"
                                :icon-size
                                :content="view?.id === $for.item.id"
                                :raised="view?.id === $for.item.id"
                                ~style="{ opacity: view?.id === $for.item.id ? 1 : 0.45, borderRadius: '4px' }"
                                @tap.stop="switchView($for.item, $event)"
                                @pointerdown.stop="view?.id === $for.item.id && openView($event)"
                            ></item-node>
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
            let views = (root?.items || []).filter(item =>
                item.type === '$handler' && item.allowUse !== false
            );
            // Для handler'а 'file' подставляем icon/label из конкретного открытого файла,
            // чтобы отображать расширение (например 'JSON') и соответствующую иконку
            const ext = this.$item?.ext;
            for (const v of views) {
                v.$context = this.$item;
                if (v.id === 'file' && ext) {
                    v.icon = 'files-color:s-' + ext;
                    v.label = ext.toUpperCase();
                }
            }
            this.formViews = views;
            this.render();
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
            if (n) {
                const role = await this.activeRole;
                if (role)
                    n.role = role;
            }
        }
    },
    focusedItem: null,
    get roleIcon() {
        return this.getRoleIcon(this.activeRole);
    },
    get roles(){
        return this.$item?.fetch('roles');
    },
    get showRoleSelector() {
        return Promise.resolve(this.roles).then(roles =>
            Array.isArray(roles) && roles.length > 1
        );
    },
    async getRoleIcon(role){
        return  ({
            ADMIN: 'fontawesome:s-user-shield',
            BOSS: 'fontawesome:s-user-tie',
            USER: 'fontawesome:s-user-pen',
        })[await role]
    },
    activeRole: {
        $save: true,
        async get (){
            const roles = await this.roles;
            return roles[0];
        },
        set(role) {
            if (this.$item) {
                this.$item.role = role;
                // Сброс кэша класса для актуализации данных по новой роли
                this.$item.reset?.();
                // Сброс кэша представлений — каждое пересоздаётся заново,
                // чтобы перезагрузить логи и данные по новой роли
                for (const id in this.controls) {
                    const el = this.controls[id];
                    if (el?.isConnected)
                        el.remove();
                }
                this.controls = {};
                this.view_control = undefined;
                // Пересоздать текущее представление
                if (this.view) {
                    const view = this.view;
                    this.view = undefined;
                    this.async(() => { this.view = view; });
                }
            }
        }
    },
    async nextRole(){
        const roles = await this.roles;
        const act_role = await this.activeRole;
        let idx = roles.indexOf(act_role);
        this.activeRole = roles[idx + 1] || roles[0];
    },
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
                if (this.view_control?.save) {
                    await this.view_control?.save();
                } else {
                    const saveParams = this.activeRole ? {role: this.activeRole} : {};
                    await this.$item.save(this.view_control?.body, saveParams);
                }
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
        this.host.view_name = handler.id;
        this.view = handler;
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
            if (!n) return;
            let el = this.controls[n.id];
            for (let id in this.controls) {
                let old = this.controls[id];
                if (old !== el && this.contains(old))
                    this.removeChild(old);
            }
            if (!el) {
                await n?.import?.(`class.js`);
                el =  ODA.createComponent('item-' + n.id, { $item: this.$item, $context: this.$item, slot: 'main', $handler: n });
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