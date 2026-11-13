export default {
    imports: 'oda//icon, ~/lib//menu, ~/lib//popover',
    extends: 'oda-icon',
    template: /* html */`
        <style>
            :host {
                cursor: pointer;
            }
            :host([is-inherit]), :host([is-inherit]) .icon {
                opacity: .7;
            }
            :host([ai-inactive]) .icon {
                opacity: .42;
                filter: grayscale(.65);
            }
            .icon {
                cursor: pointer;
                border-radius: {{isUser ? '50%' : '4px'}};
            }
            :host([is-user]) .icon {
                color: white;
            }
            :host(:hover) .icon {
                scale: 1;
            }
        </style>
    `,
    online: {
        $def: false,
        $attr: true,
        get() {
            if (this.isUser)
                return this.$item?.online;
            return false;
        }
    },
    subIcon:{
        $def: '',
        get (){
            if (!this.isUser) {
                if (this.$item?.type === '$virtual')
                    return 'carbon:filter';
                return this.$item?.subIcon;
            }
            return Promise.resolve(this.online).then(res => res ? 'unicon:check-circle' : '');
        }
    },
    subIconColor:{
        $def: '',
        get (){
            if (!this.isUser) {
                if (this.$item?.type === '$virtual')
                    return '#ede9fe';
                return '';
            }
            return Promise.resolve(this.online).then(res => res ? 'lime' : '');
        }
    },
    fill: {
        $def: '',
        get() {
            const it = this.$item;
            if (!it || this.isUser)
                return '';
            const t = it.type;
            if (t === '$module' || (t === '$domain' && it.id === 'MODULES'))
                return '#e600ff';
            if (t === '$virtual')
                return '#6d28d9';
            return '';
        }
    },
    get default(){
        if (this.isUser) {
            const lbl = String(this.$item?.label || '').trim();
            if (lbl) {
                const initials = lbl.split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase();
                if (initials)
                    return '@:' + initials;
            }
            return 'icons:account-circle';
        }
        return 'files:file';
    },
    get iconColor() {
        if (this.isUser)
            return this.$item?.iconColor;
        return ''
    },
    autoRun: false,
    menuMode: {
        $def: 'handlers',
        $list: ['handlers', 'tools', 'both']
    },
    title: {
        $attr: true,
        get() {
            if (this.isUser)
                return this.$item?.label;
            return this.$item?.short;
        }
    },
    isInherit: {
        $attr: true,
        $type: Boolean,
        get() {
            return this.$item?.isInherit;
        }

    },
    aiInactive: {
        $attr: true,
        $type: Boolean,
        get() {
            const it = this.$item;
            if (!it || it.id === 'MODELS' || (it.type !== '$ai' && it.type !== '$provider'))
                return false;
            return (it.aiActive ?? it.DATA?.aiActive) === false;
        }
    },
    isUser: {
        $attr: true,
        $def: false,
        get() {
            return this.$item instanceof CORE.$user;
        }
    },
    isClass: {
        $attr: true,
        $def: false,
        get() {
            return this.$item instanceof CORE.$class;
        }
    },
    $listeners: {
        tap(e) {
            // e.stopPropagation();
            let h = this;
            while (h && h.localName !== 'item-menu') {
                h = h.host || h.parentElement;
            }
            const menuCtx = h?.$item || this.topHost?.$item;
            if (this.autoRun) {
                this.async(() => {
                    if (this.$pdp.execute) {
                        this.$pdp.execute(this.$item);
                    }
                    else {
                        if (menuCtx)
                            this.$item.$context = menuCtx;
                        this.$item.execute();
                    }
                })
            }
            if (h) {
                h.parentElement?.fire('close');
            }
        },
        contextmenu(e) {
            e.preventDefault();
            e.stopPropagation();
            WORK.showMenu({ $item: this.$item, mode: this.menuMode }, e);
        }
    }
}