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
        return Promise.resolve(this.$item?.load()).then(raw => {
            if (!raw)
                return null;
            return typeof raw === 'string' ? JSON.parse(raw) : raw;
        }).catch(() => null);
    },
    get user() {
        return Promise.resolve(this.message).then(message => {
            return message?.user ? WORK.get_$user(message.user) : null;
        });
    },
    get receivers() {
        return Promise.all([WORK.users, this.message]).then(([users, message]) => {
            const list = Array.isArray(users) ? users : [];
            const ids = Array.isArray(message?.receivers) ? message.receivers : [];
            return ids.map(id => list.find(u => u.id === id)).filter(Boolean);
        }).catch(() => []);
    },
    attached() {
        this.async(() => {
            Promise.resolve(this.message).then(message => {
                if (message?.type && this.$pdp)
                    this.$pdp.colorMode = COLORS[message.type] || '';
            });
        });
    },
    get type() {
        return Promise.resolve(this.message).then(message => message?.type || '');
    },
    get theme() {
        return Promise.resolve(this.message).then(message => {
            if (!message)
                return '';
            return message.theme || THEMES[message.type] || '';
        });
    },
    get icon() {
        return Promise.resolve(this.type).then(type => (ICONS[type] || (type ? '@:' + type : '')));
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