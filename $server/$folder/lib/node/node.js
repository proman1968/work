import { isLinkNode } from '../tree/link-nodes.js';

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
            label{
                text-overflow: ellipsis;
                overflow: hidden;
                white-space: nowrap !important;
                cursor: pointer;
                padding: 2px 4px;
            }
            label.link{
                text-decoration: underline;
                font-weight: normal;
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
                scale: {{isStructureLike ? 1 : .82}};
                transition: scale .2s;
            }
            .size{
                @apply --content;
                @apply --raised;
                @apply --bold;
                @apply --no-flex;
                border-radius: 8px;
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
            .obj-count{
                @apply --no-flex;
                font-size: 12px;
                font-weight: 700;
                padding: 0 6px;
                white-space: nowrap;
                align-self: center;
                opacity: .85;
            }
        </style>
        <div horizontal flex style="align-items: center; min-width: 0; width: 100%;">
            <div vertical flex style="min-width: 0;">
                <div horizontal flex style="min-width: 0;">
                    <label flex style="min-width: 0;" :bold="$item instanceof CORE.$class && !isLink" ~class="{link: isLink}" :title="isLink ? $item?.path : label" ~show="!hideLabel">{{label}}</label>
                    <span class="history-time" ~if="historyTime" ~show="!hideLabel">{{historyTime}}</span>
                </div>
            </div>
            <span class="obj-count" ~if="objectCount">{{objectCount}}</span>
            <span class="size" class="size" ~if="showSize" ~show="$item?.size">{{$item?.size}}</span>
            <slot></slot>
        </div>
    `,
    showSize: false,
    get objectCount() {
        const it = this.$item;
        if (!it || ('isPlace' in Object(it) && it.isPlace))
            return '';
        const t = it.type;
        if (t === '$base' || t === '$structure' || t === '$server' || t === '$domain')
            return '';
        const c = isLinkNode(it) ? it.objectCount : it.DATA?.objectCount;
        return (typeof c === 'number' && c > 0) ? String(c) : '';
    },
    get isStructureLike() {
        const it = this.$item;
        if (!it || this.isLink)
            return false;
        const t = it.type;
        return t === '$base' || t === '$structure' || t === '$server' || it.id === 'ORGANIZATIONS';
    },
    // пользователи в строке дерева не показываются (шум и запросы на каждую строку); свойство оставлено для совместимости биндов
    showUsers: false,
    hideLabel: false,
    hideHistoryTime: false,
    get historyTime() {
        if (this.hideHistoryTime)
            return '';
        const path = this.$item?.path;
        if (!path || !String(path).includes('/history/'))
            return '';
        const parse = CORE.$file?.parseHistoryEntryPath || this.$item?.constructor?.parseHistoryEntryPath;
        if (typeof parse !== 'function')
            return '';
        return parse.call(CORE.$file || this.$item.constructor, path)?.dateTime || '';
    },
    /** Узел-ссылка рабочего места — только через isLinkNode (см. link-nodes.js):
     * прямое чтение `$item.isLink` у настоящих элементов дёргает `_onEmpty`. */
    get isLink() {
        return isLinkNode(this.$item);
    },
    get status(){
        if(this.isLink)
            return '';
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
        if(this.isLink)
            return 24;
        if(this.isStructureLike)
            return 28;
        if(!this.showStatus)
            return 24;
        if(this.$item){
            if(this.$item instanceof CORE.$handler)
                return 26;
            if(this.$item instanceof CORE.$class)
                return 24;
            return 24;
        }
    },
    showStatus: false
}