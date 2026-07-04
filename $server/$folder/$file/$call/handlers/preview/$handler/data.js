export default{
    icon: 'communication:call',
    template: /* html */`
        <phone-call :$item></phone-call>
    `
}
ODA({ is: 'phone-call', imports: '~/lib//icon.js', template: /* html */`
        <style>
            :host{
                @apply --vertical;
                width: min-content;
                gap: 5px;
                @apply --center;
            }
            div {
                @apply --horizontal;
                align-items: center;
                padding: 4px 10px;
                gap: 5px;
                align-self: center;
            }
            item-icon{
                border-radius: 50%;
                @apply --shadow;
            }
            span{
                text-align: center;
                padding: 4px 4px 0px 4px;
                font-size: small;
            }

        </style>
        <span bold>{{theme}}</span>
        <div no-flex>
            <item-icon :$item="user" content></item-icon>
            <oda-icon :icon></oda-icon>
            <item-icon ~for="receivers" :$item="$for.item" content></item-icon>
        </div>
    `,
    $item: undefined,
    get message() {
        return this.$item?.load().then(text => JSON.parse(text))
    },
    get user() {
        return this.message?.then(message=>{
            return WORK.get_$user(message.user);
        }) 
    },
    get receivers() {
        return WORK.$users().then(async users=>{
            let message = await this.message;
            return message.receivers.map(id => users.find(u => u.id === id)).filter(Boolean);
        })
    },
    attached() {
        this.async(() => {
            this.message?.then(message => {
                this.$pdp.colorMode = COLORS[message.type] || '';
            });
        });
    },
    get type() {
        return this.message?.then(message => message.type);
    },
    get theme(){
        return this.message?.then(message=>{
            return message.theme || THEMES[message.type];
        });
    },
    get icon(){
        return this.type?.then(type=>(ICONS[type] || ('@:'+type)));
    }
})
const ICONS = {
    offer: 'unicon:phone-volume',
    answer: 'unicon:phone',
    cancel: 'unicon:phone-slash',
    timeout: 'unicon:phone-times',
    busy: 'unicon:phone-times',
    end_call: 'unicon:phone:90',
    hang: 'unicon:phone:90',
}
const COLORS = {
    offer: 'success-invert',
    answer: 'success',
    cancel: 'error-invert',
    busy: 'error-invert',
    timeout: 'error-invert',
    end_call: 'error',
    hang: 'error-invert',
}
const THEMES = {
    offer: 'offer',
    answer: 'answer',
    cancel: 'cancel',
    busy: 'busy',
    timeout: 'timeout',
    end_call: 'end_call',
    hang: 'hang',
}