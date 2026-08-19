/** «?» у контейнера (папка, класс, handler), не у файла: только если readme.md уже в items. */
function mayShowReadme($item) {
    if (!$item) return false;
    // $file extends $folder на клиенте — файлы исключаем явно
    if ($item.constructor === CORE.$file || $item.type === '$file') return false;
    return true;
}

export default {
    imports: '~/lib//icon, ~/lib//users',
    extends: 'item-icon',
    template: /*html*/`
        <style>
            :host{
                text-align: initial;
                @apply --horizontal;
                overflow: hidden;
                @apply --flex;
                padding: 2px;
            }
            :host(:hover){
                background-color: rgba(1,1,1,.1);
            }
            label{
                text-overflow: ellipsis;
                overflow: hidden;
                white-space: nowrap !important;
                cursor: pointer;
                padding: 2px 4px;
            }
            .stat{
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                font-size: xx-small;
                margin: 0px 4px;
            }
            div{
                overflow: hidden;
            }
            .icon{
                scale: .8;
                transition: scale .5s;
            }
            .size{
                @apply --content;
                @apply --raised;
                @apply --bold;
                @apply --no-flex;
                border-radius: 8px;
                position: absolute;
                right: 0px;
                font-size: x-small;
                font-family: monospace;
                padding: 2px 4px;
                white-space: nowrap;
                align-self: center;
            }
            .history-time{
                @apply --no-flex;
                font-size: xx-small;
                opacity: .55;
                margin-left: 6px;
                white-space: nowrap;
                align-self: center;
            }
            .readme-help{
                @apply --no-flex;
                opacity: .55;
                margin-left: 2px;
                cursor: pointer;
            }
            .readme-help:hover{
                opacity: 1;
            }
        </style>
        <div horizontal flex style="align-items: center;">
            <div vertical flex>
                <div horizontal flex>
                    <label :bold="$item instanceof CORE.$class" flex ~show="!hideLabel">{{label}}</label>
                    <span class="history-time" ~if="historyTime" ~show="!hideLabel">{{historyTime}}</span>
                    <oda-icon class="readme-help" ~if="hasReadme" icon="icons:help" icon-size="24" @tap.stop="openReadme" title="readme.md"></oda-icon>
                    <item-users icon-size="16" no-flex ~if="showBoss" role="BOSS" :$item :select-mode="false"></item-users>
                </div>
                <item-users icon-size="16" ~if="showUsers && isClass" role="USER" :$item :select-mode="false"></item-users>
            </div>
            <span class="size" class="size" ~if="showSize" ~show="$item?.size">{{$item?.size}}</span>
            <slot></slot>
        </div>
    `,
    showSize: false,
    showUsers: false,
    hideLabel: false,
    get historyTime() {
        const path = this.$item?.path;
        if (!path || !String(path).includes('/history/'))
            return '';
        const parse = CORE.$file?.parseHistoryEntryPath || this.$item?.constructor?.parseHistoryEntryPath;
        if (typeof parse !== 'function')
            return '';
        return parse.call(CORE.$file || this.$item.constructor, path)?.dateTime || '';
    },
    get readmeItem() {
        if (!mayShowReadme(this.$item)) return undefined;
        return Promise.resolve(this.$item.items).then(items =>
            Array.isArray(items) ? items.find(f => /^readme\.md$/i.test(f.id)) : undefined
        );
    },
    get hasReadme() {
        return Promise.resolve(this.readmeItem).then(r => !!r);
    },
    async openReadme(e) {
        e?.stopPropagation?.();
        const readme = await this.readmeItem;
        if (!readme) return;
        readme.$context = this.topHost?.$item;
        if (typeof readme.execute === 'function')
            await readme.execute();
        else if (window.execute)
            await window.execute(Reactor.activate(readme));
        let h = this;
        while (h && h.localName !== 'item-menu') {
            h = h.host || h.parentElement;
        }
        h?.parentElement?.fire('close');
    },
    get showBoss(){
        if(this.$item instanceof CORE.$class && !(this.$item instanceof CORE.$user)){
            return Promise.resolve(this.$item?.bosses).then(list => !!(list?.length));
        }
    },
    get status(){
        if(this.$item.constructor === CORE.$class)
            return this.$item.status;
        return ''
    },
    get icon() {
        if (this.$item instanceof CORE.$handler && this.$item?.id === 'file') {
            const ctx = this.topHost?.$item;
            if (ctx?.ext)
                return 'files-color:s-' + ctx.ext;
        }
        return this.$item?.icon || this.default || 'files:file';
    },
    label: {
        get() {
            if (this._customLabel != null && this._customLabel !== '')
                return this._customLabel;
            // Для handler'а 'file' показываем расширение конкретного файла из контекста
            if (this.$item instanceof CORE.$handler && this.$item?.id === 'file') {
                const ctx = this.topHost?.$item;
                if (ctx?.ext) {
                    const prefix = this.$item?.allowSave ? 'edit' : 'view';
                    return prefix + ' (' + ctx.ext.toLowerCase() + ')';
                }
            }
            return this.$item?.label;
        },
        set(n) {
            this._customLabel = n;
        }
    },
    last:{
        $def: 0,
        $save: true,
    },
    get $saveKey(){
        return this.$item?.short;
    },
    set expanded(n){
        if(this.$item){
            this.$item.expanded = n;
        }
    },
    get iconSize(){
        if(!this.showStatus)
            return 24;
        if(this.$item){
            if(this.$item instanceof CORE.$handler)
                return 32;
            if(this.$item instanceof CORE.$class)
                return 48;
            return 24;
        }
    },
    showStatus: false
}