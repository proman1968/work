export default {
    imports: '~/lib//icon, ~/lib//user, ~/lib//users',
    extends: 'item-icon',
    template: /*html*/`
        <style>
            :host{
                text-align: initial;
                @apply --horizontal;
                overflow: hidden;
                @apply --flex;
                border-top-left-radius: 8px;
                border-bottom-left-radius: 8px;
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
            [bubble]{
                @apply --info-invert;
                border-radius: 16px;
                min-width: 8px;
                text-align: center;
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
        </style>
        <div horizontal flex style="padding: 0px 2px; align-items: center;">
            <div vertical flex style="gap: 2px;">
                <div horizontal flex> 
                    <label :bold="$item instanceof CORE.$storage" flex>{{label}}</label>
                    <item-user  ~if="showAdmin" :$item="admin"></item-user>
                </div>
                <item-users flex ~if="showUsers && isStorage"flex :$item disabled></item-users>
            </div>
            <span class="size" class="size" ~if="showSize" ~show="$item?.size">{{$item?.size}}</span>
        </div>
    `,
    showSize: false,
    showUsers: false,
    get showAdmin(){
        if(!(this.$item instanceof CORE.$storage) || this.$item instanceof CORE.$user)
            return false
        return new AsyncPromise(async ()=>{
            let admin = await this.admin;
            return admin && admin.id !== WORK.uid;
        })
    },
    get status(){
        if(this.$item.constructor === CORE.$storage)
            return this.$item.status;
        return ''
    },
    get admin(){
        return new AsyncPromise(async ()=>{
            let res = await Promise.resolve(this.$item?.admins);
            return res?.last
        })
    },
    label: {
        get() {
            if (this._customLabel != null && this._customLabel !== '')
                return this._customLabel;
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
    get bubble(){
        return this.$item?.count || '';
    },
    set $item(n){
        n?.addEventListener?.('changed', e=>{
            this.bubble = undefined;
        })
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
            if(this.$item instanceof CORE.$storage)
                return 48;
            return 24;
        }
    },
    showStatus: false
}