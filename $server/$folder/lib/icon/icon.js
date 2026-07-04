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
            if (this.isUser){
                return this.online?.then?.(res=>{
                    return (res?'unicon:check-circle':null);
                })
            }

            return this.$item?.subIcon;
        }

    },
    subIconColor:{
        $def: '',
        get (){
            if (this.isUser){
                return this.online?.then?.(res=>{
                    return (res?'lime':'');
                })
            }
            return '';
        }
    },
    get default(){
        return this.isUser?'':'files:file';
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
    isUser: {
        $attr: true,
        $def: false,
        get() {
            return this.$item instanceof CORE.$user;
        }
    },
    isStorage: {
        $attr: true,
        $def: false,
        get() {
            return this.$item instanceof CORE.$storage;
        }
    },
    $listeners: {
        tap(e) {
            // e.stopPropagation();
            if (this.autoRun) {
                this.async(() => {
                    if (this.$pdp.execute) {
                        this.$pdp.execute(this.$item);
                    }
                    else {
                        this.$item.$context = this.topHost.$item;
                        this.$item.execute();
                    }
                })
            }
            let h = this;
            while (h && h.localName !== 'item-menu') {
                h = h.host || h.parentElement;
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