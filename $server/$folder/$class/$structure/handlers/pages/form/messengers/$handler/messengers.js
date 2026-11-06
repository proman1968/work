export default {
    imports: 'oda//icon, oda//button',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                @apply --flex;
                padding: 16px 20px;
                gap: 16px;
                overflow-y: auto;
                background: var(--content-background);
                color: var(--content-color);
                font-size: 13px;
                box-sizing: border-box;
            }
            .card {
                @apply --vertical;
                gap: 12px;
                padding: 14px 16px;
                border: 1px solid var(--subtle-border, var(--border-color));
                border-radius: 8px;
                background: var(--subtle-background);
            }
            .subcard {
                @apply --vertical;
                gap: 10px;
                padding: 12px 14px;
                border: 1px solid var(--subtle-border, var(--border-color));
                border-radius: 8px;
                background: var(--content-background);
            }
            .card-header {
                @apply --horizontal;
                align-items: center;
                justify-content: space-between;
                flex-wrap: wrap;
                gap: 8px;
                font-weight: 700;
                font-size: 15px;
            }
            .header-left {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
            }
            .row {
                @apply --horizontal;
                align-items: center;
                flex-wrap: wrap;
                gap: 8px;
            }
            .field-label {
                font-size: 13px;
                font-weight: 600;
                color: var(--muted-color);
                min-width: 150px;
            }
            .badge {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 3px 10px;
                border-radius: 12px;
                font-size: 12px;
                font-weight: 600;
                background: var(--accent-soft);
                color: var(--accent-color);
            }
            .badge.inherited {
                background: var(--light-background);
                color: var(--content-color);
                border: 1px solid var(--border-color);
            }
            .badge.warn {
                background: rgba(245, 158, 11, 0.14);
                color: #d97706;
            }
            .chip {
                @apply --horizontal;
                align-items: center;
                gap: 6px;
                padding: 3px 9px;
                border-radius: 14px;
                background: var(--accent-soft);
                color: var(--content-color);
                font-size: 12px;
            }
            .chip.unlinked {
                background: var(--light-background);
                color: var(--muted-color);
            }
            select, input[type="text"], input[type="password"] {
                padding: 5px 8px;
                border: 1px solid var(--control-border-color, var(--border-color));
                border-radius: 6px;
                font: inherit;
                font-size: 13px;
                background: var(--control-background, var(--content-background));
                color: var(--control-color, var(--content-color));
            }
            .code-box {
                @apply --horizontal;
                align-items: center;
                flex-wrap: wrap;
                gap: 10px;
                padding: 10px 12px;
                border: 1px dashed var(--accent-color);
                border-radius: 6px;
                background: var(--accent-soft);
            }
            .code-mono {
                font-family: monospace;
                font-weight: 700;
                font-size: 14px;
                padding: 3px 8px;
                border-radius: 4px;
                background: var(--content-background);
                border: 1px solid var(--border-color);
                user-select: all;
            }
            .muted {
                color: var(--muted-color);
                font-size: 13px;
            }
            .msg-ok {
                padding: 8px 12px;
                border-radius: 6px;
                background: rgba(16, 185, 129, 0.12);
                color: #059669;
                font-size: 13px;
                font-weight: 600;
            }
            .msg-err {
                padding: 8px 12px;
                border-radius: 6px;
                background: rgba(220, 38, 38, 0.1);
                color: var(--error-color, #dc2626);
                font-size: 13px;
                font-weight: 600;
            }
            a.deep-link {
                color: var(--accent-color);
                font-weight: 600;
                text-decoration: underline;
            }
        </style>

        <div class="card">
            <div class="card-header">
                <div class="header-left">
                    <oda-icon icon="communication:phonelink-ring" icon-size="24"></oda-icon>
                    <span>{{$item?.label || $item?.id || pointLabel}} — Мессенджеры (Telegram / MAX)</span>
                </div>
                <div class="row">
                    <span ~if="effectiveBot && !effectiveBot.inherited" class="badge">
                        Собственный бот: {{effectiveBot.label}} ({{effectiveBot.kind === 'max' ? 'MAX' : 'Telegram'}})
                    </span>
                    <span ~if="effectiveBot && effectiveBot.inherited" class="badge inherited">
                        Наследуется от «{{effectiveBot.sourceLabel || effectiveBot.sourcePath}}»: {{effectiveBot.label}} ({{effectiveBot.kind === 'max' ? 'MAX' : 'Telegram'}})
                    </span>
                    <span ~if="!effectiveBot" class="badge warn">
                        Бот не задан (работает браузерный Web-Push)
                    </span>
                    <oda-button icon="icons:refresh" label="Обновить" title="Обновить статус и проверить коды привязки" @tap="pollAndReload()"></oda-button>
                </div>
            </div>

            <div ~if="notice" class="msg-ok">{{notice}}</div>
            <div ~if="error" class="msg-err">{{error}}</div>

            <!-- 1. Привязка бота к точке $structure / $base / $server (для ADMIN) -->
            <div class="subcard" ~if="canEdit">
                <div class="row" style="justify-content: space-between;">
                    <span style="font-weight: 700; font-size: 14px;">1. Бот точки «{{pointLabel}}» (наследуется дочерними подразделениями)</span>
                    <div class="row">
                        <oda-button ~if="!editOwnBot && !ownBot" icon="icons:add" label="Привязать своего бота к этой точке" @tap="startEditOwnBot()"></oda-button>
                        <oda-button ~if="ownBot" icon="icons:delete" label="Сбросить своего бота (наследовать вышестоящего)" @tap="clearOwnBot()"></oda-button>
                    </div>
                </div>

                <div ~if="!ownBot && !editOwnBot" class="muted">
                    <span ~if="effectiveBot">Эта точка использует вышестоящего бота «{{effectiveBot.label}}» от «{{effectiveBot.sourceLabel || effectiveBot.sourcePath}}».</span>
                    <span ~if="!effectiveBot">У этой и вышестоящих точек бот ещё не настроен. Нажмите «Привязать своего бота к этой точке» и укажите токен от @BotFather (Telegram) или MAX.</span>
                </div>

                <div ~if="ownBot || editOwnBot" style="display:flex; flex-direction:column; gap:10px;">
                    <div class="row">
                        <span class="field-label">Платформа:</span>
                        <select :value="draftBotKind" @change="draftBotKind = $event.target.value">
                            <option value="telegram">Telegram Bot API</option>
                            <option value="max">MAX Bot API</option>
                        </select>
                        <span class="field-label" style="min-width: 120px;">Название бота:</span>
                        <input type="text" placeholder="Например: Бот Бизнес Интер Софт" :value="draftBotLabel" @input="draftBotLabel = $event.target.value" style="min-width: 220px;">
                    </div>
                    <div class="row">
                        <span class="field-label">Токен бота:</span>
                        <input type="password" :placeholder="ownBot?.tokenMask ? 'Сохранён (' + ownBot.tokenMask + ') — введите новый для замены' : 'Вставьте токен от @BotFather или MAX'" :value="draftBotToken" @input="draftBotToken = $event.target.value" style="min-width: 280px; flex: 1;">
                        <span class="field-label" style="min-width: 95px;">@username:</span>
                        <input type="text" placeholder="определится авто" :value="draftBotUsername" @input="draftBotUsername = $event.target.value" style="width: 160px;">
                    </div>
                </div>

                <!-- Общий групповой чат подразделения -->
                <div class="row" style="padding-top: 8px; border-top: 1px dashed var(--subtle-border, var(--border-color));">
                    <span class="field-label">Общий чат точки:</span>
                    <input type="text" placeholder="chat_id группы (необязательно)" :value="draftGroupChatId" @input="draftGroupChatId = $event.target.value" style="width: 190px;">
                    <input type="text" placeholder="Название группы" :value="draftGroupTitle" @input="draftGroupTitle = $event.target.value" style="width: 190px;">
                    <oda-button icon="av:vpn-key" label="Код привязки группы" title="Сгенерировать код и отправить в групповой чат с ботом" @tap="requestLinkCode('group')"></oda-button>
                    <oda-button ~if="draftGroupChatId" icon="icons:close" title="Отвязать группу" @tap="unbind('group')"></oda-button>
                </div>

                <div ~if="linkCodeInfo && linkCodeInfo.target === 'group'" class="code-box">
                    <span>Добавьте бота в групповой чат подразделения и отправьте туда команду:</span>
                    <span class="code-mono">{{linkCodeInfo.command}}</span>
                    <oda-button icon="icons:check" label="Я отправил код — проверить" @tap="pollAndReload()"></oda-button>
                </div>

                <div class="row">
                    <label class="row" style="cursor: pointer;">
                        <input type="checkbox" :checked="draftBroadcastToMembers" @change="draftBroadcastToMembers = $event.target.checked">
                        <span>Доставлять общие сообщения подразделения лично всем привязанным участникам точки (если не задан общий чат)</span>
                    </label>
                </div>

                <div class="row" style="justify-content: flex-end; gap: 8px;">
                    <oda-button ~if="effectiveBot" icon="communication:chat" label="Проверить общую рассылку подразделения" @tap="testDelivery('department')"></oda-button>
                    <oda-button icon="icons:save" label="Сохранить настройки точки" @tap="saveConfig()"></oda-button>
                </div>
            </div>

            <!-- 2. Личная привязка текущего пользователя -->
            <div class="subcard">
                <div class="row" style="justify-content: space-between;">
                    <span style="font-weight: 700; font-size: 14px;">2. Ваша личная привязка (для персональных напоминаний и задач)</span>
                    <div class="row">
                        <oda-button icon="av:vpn-key" label="Получить код привязки" @tap="requestLinkCode('user')"></oda-button>
                        <oda-button ~if="hasPersonalLink" icon="communication:chat" label="Проверить доставку мне" @tap="testDelivery('personal')"></oda-button>
                    </div>
                </div>

                <div class="row">
                    <span class="field-label">Telegram:</span>
                    <div ~if="currentUser?.telegram" class="chip">
                        <span>Привязан: {{currentUser.telegram.username ? '@' + currentUser.telegram.username : currentUser.telegram.chatId}}</span>
                        <span style="cursor:pointer; font-weight:bold;" title="Отвязать Telegram" @tap="unbind('user', 'telegram')">×</span>
                    </div>
                    <span ~if="!currentUser?.telegram" class="muted">не привязан</span>

                    <span class="field-label" style="min-width: 70px; margin-left: 16px;">MAX:</span>
                    <div ~if="currentUser?.max" class="chip">
                        <span>Привязан: {{currentUser.max.username || currentUser.max.firstName || currentUser.max.chatId}}</span>
                        <span style="cursor:pointer; font-weight:bold;" title="Отвязать MAX" @tap="unbind('user', 'max')">×</span>
                    </div>
                    <span ~if="!currentUser?.max" class="muted">не привязан</span>
                </div>

                <div ~if="linkCodeInfo && linkCodeInfo.target === 'user'" class="code-box">
                    <span>Отправьте боту {{linkCodeInfo.bot?.username ? '@' + linkCodeInfo.bot.username : (linkCodeInfo.bot?.label || 'мессенджера')}} команду:</span>
                    <span class="code-mono">{{linkCodeInfo.command}}</span>
                    <a ~if="linkCodeInfo.deepLink" class="deep-link" :href="linkCodeInfo.deepLink" target="_blank" rel="noopener">Открыть бота</a>
                    <oda-button icon="icons:check" label="Я отправил код — проверить" @tap="pollAndReload()"></oda-button>
                </div>
            </div>

            <!-- 3. Участники подразделения из настроек безопасности (#security) -->
            <div class="subcard" ~if="members && members.length">
                <span style="font-weight: 700; font-size: 14px;">3. Участники подразделения (из «Роли и места») и их каналы получения:</span>
                <div class="row">
                    <div ~for="members" :class="($for.item.telegram || $for.item.max) ? 'chip' : 'chip unlinked'">
                        <oda-icon icon="icons:person" icon-size="14"></oda-icon>
                        <span>{{memberLabel($for.item.uid)}}</span>
                        <span ~if="$for.item.telegram">[TG]</span>
                        <span ~if="$for.item.max">[MAX]</span>
                        <span ~if="!$for.item.telegram && !$for.item.max">[Web-Push]</span>
                    </div>
                </div>
            </div>
        </div>
    `,
    pointLabel: '',
    ownBot: null,
    effectiveBot: null,
    members: [],
    currentUser: null,
    userMap: {},
    canEdit: false,
    editOwnBot: false,
    draftBotKind: 'telegram',
    draftBotLabel: '',
    draftBotToken: '',
    draftBotUsername: '',
    draftGroupChatId: '',
    draftGroupTitle: '',
    draftBroadcastToMembers: true,
    linkCodeInfo: null,
    notice: '',
    error: '',
    async attached() {
        await this.reload();
    },
    get hasPersonalLink() {
        return Boolean(this.currentUser?.telegram || this.currentUser?.max);
    },
    memberLabel(uid) {
        return this.userMap?.[uid] ? `${this.userMap[uid]} (${uid})` : uid;
    },
    applyStatus(st = {}) {
        this.pointLabel = st.pointLabel || this.$item?.label || this.$item?.id || 'WORK';
        this.ownBot = st.ownBot || null;
        this.effectiveBot = st.effectiveBot || null;
        this.members = Array.isArray(st.members) ? st.members : [];
        this.currentUser = st.currentUser || null;
        if (this.ownBot) {
            this.draftBotKind = this.ownBot.kind || 'telegram';
            this.draftBotLabel = this.ownBot.label || '';
            this.draftBotUsername = this.ownBot.username || '';
            this.draftBotToken = '';
        }
        this.draftGroupChatId = st.groupChatId || '';
        this.draftGroupTitle = st.groupTitle || '';
        this.draftBroadcastToMembers = st.broadcastToMembers !== false;
    },
    async loadUsers() {
        try {
            const uRoot = (await WORK.get_item('/USERS')) || (await WORK.get_item('/users'));
            const items = (await uRoot?.items) || [];
            const map = {};
            for (const u of items) {
                if (!u?.id || u.id[0] === '$')
                    continue;
                map[u.id] = u.label || u.DATA?.label || u.id;
            }
            this.userMap = map;
        }
        catch { /* ignore */ }
    },
    async reload() {
        this.error = '';
        if (!this.$item)
            return;
        try {
            this.canEdit = Boolean(WORK?.DEV_MODE || await this.$item.isAdmin);
            await this.loadUsers();
            const st = await this.$item.fetch('messenger_status');
            if (st)
                this.applyStatus(st);
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    startEditOwnBot() {
        this.editOwnBot = true;
        if (!this.draftBotLabel)
            this.draftBotLabel = `Бот ${this.pointLabel || ''}`.trim();
    },
    async clearOwnBot() {
        this.error = '';
        this.notice = '';
        try {
            const st = await this.$item.fetch('messenger_save_config', {
                post: { bot: null, botId: '' },
            });
            this.editOwnBot = false;
            this.draftBotToken = '';
            this.applyStatus(st);
            this.notice = 'Собственный бот точки сброшен (используется наследование)';
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async saveConfig() {
        this.error = '';
        this.notice = '';
        try {
            const payload = {
                groupChatId: String(this.draftGroupChatId || '').trim(),
                groupTitle: String(this.draftGroupTitle || '').trim(),
                broadcastToMembers: Boolean(this.draftBroadcastToMembers),
            };
            if (this.ownBot || this.editOwnBot || this.draftBotToken) {
                payload.bot = {
                    id: this.ownBot?.id || '',
                    kind: this.draftBotKind || 'telegram',
                    label: String(this.draftBotLabel || '').trim(),
                    token: String(this.draftBotToken || '').trim(),
                    username: String(this.draftBotUsername || '').replace(/^@/, '').trim(),
                    enabled: true,
                };
            }
            const st = await this.$item.fetch('messenger_save_config', { post: payload });
            this.draftBotToken = '';
            this.applyStatus(st);
            this.notice = 'Настройки мессенджеров точки сохранены';
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async requestLinkCode(target = 'user') {
        this.error = '';
        this.notice = '';
        try {
            const info = await this.$item.fetch('messenger_link_code', {
                post: { target, channel: this.effectiveBot?.kind || this.draftBotKind || 'telegram' },
            });
            this.linkCodeInfo = info;
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async pollAndReload() {
        this.error = '';
        this.notice = '';
        try {
            const st = await this.$item.fetch('messenger_poll');
            this.applyStatus(st);
            if (Array.isArray(st?.matched) && st.matched.length) {
                this.linkCodeInfo = null;
                this.notice = `Привязка выполнена (${st.matched.map(m => m.type === 'group' ? 'группа ' + m.chatTitle : 'пользователь ' + m.uid).join(', ')})`;
            }
            else {
                this.notice = 'Статус обновлён';
            }
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async unbind(target = 'user', channel = '') {
        this.error = '';
        this.notice = '';
        try {
            const st = await this.$item.fetch('messenger_unbind', {
                post: { target, channel },
            });
            this.applyStatus(st);
            this.notice = target === 'group' ? 'Групповой чат отвязан' : `Личный чат ${channel || ''} отвязан`;
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async testDelivery(scope = 'personal') {
        this.error = '';
        this.notice = '';
        try {
            const res = await this.$item.fetch('messenger_test', {
                post: { scope },
            });
            if (scope === 'department') {
                if (res?.delivered)
                    this.notice = `Тестовое сообщение отправлено подразделению (группа: ${res.groupDelivered ? 'да' : 'нет'}, лично участникам: ${res.membersDelivered?.length || 0})`;
                else
                    this.error = `Не удалось доставить в мессенджер (участников: ${res?.memberCount || 0})`;
            }
            else {
                if (res?.delivered)
                    this.notice = `Тестовое сообщение доставлено в ${res.channel} (бот «${res.botLabel || res.botId}»)`;
                else
                    this.error = res?.error || res?.reason || 'Не удалось доставить сообщение';
            }
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
};
