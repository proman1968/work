export default{
    icon: 'enterprise:email',
    imports: 'oda//app-layout',
    extends: 'oda-app-layout',
    template: /* html */`
        <oda-form-email slot="main" flex :$item></oda-form-email>
    `
}

function parseEmlClient(raw) {
    raw = String(raw ?? '');
    const sep = raw.match(/\r?\n\r?\n/);
    const head = sep ? raw.slice(0, sep.index) : raw;
    const body = sep ? raw.slice(sep.index + sep[0].length) : '';
    const headers = Object.create(null);
    for (const line of head.split(/\r?\n/)) {
        const m = line.match(/^([\w-]+):\s*(.*)$/i);
        if (m)
            headers[m[1].toLowerCase()] = m[2].trim();
    }
    return {
        headers,
        body,
        subject: headers.subject || '(без темы)',
        from: headers.from || '',
        to: headers.to || '',
        status: headers['x-work-status'] || '',
    };
}

function mailboxFromPath(path) {
    const m = String(path || '').match(/\/([^/]+)\/email\/([^/]+)\/(inbox|outbox)\.eml\//i);
    return m ? { structure: m[1], address: m[2], box: m[3].toLowerCase() } : null;
}

function defaultEml({ from, to, subject, body, address, status = 'pending' }) {
    return [
        `X-WORK-Status: ${status}`,
        address ? `X-WORK-Mailbox: ${address}` : '',
        from ? `From: ${from}` : '',
        to ? `To: ${to}` : '',
        subject ? `Subject: ${subject}` : 'Subject: ',
        'Content-Type: text/plain; charset=utf-8',
        '',
        body || '',
    ].filter((l, i) => i > 0 || l).join('\r\n');
}

const MAIL_PRESETS = {
    gmail: {
        label: 'Gmail',
        smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
        imap: { host: 'imap.gmail.com', port: 993, secure: true },
    },
    yandex: {
        label: 'Яндекс',
        smtp: { host: 'smtp.yandex.ru', port: 465, secure: true },
        imap: { host: 'imap.yandex.ru', port: 993, secure: true },
    },
    outlook: {
        label: 'Microsoft 365',
        smtp: { host: 'smtp.office365.com', port: 587, secure: false },
        imap: { host: 'outlook.office365.com', port: 993, secure: true },
    },
    mailru: {
        label: 'Mail.ru',
        smtp: { host: 'smtp.mail.ru', port: 465, secure: true },
        imap: { host: 'imap.mail.ru', port: 993, secure: true },
    },
};

function emptyMailbox(address = '') {
    return {
        address,
        smtp: { host: '', port: 465, secure: true },
        imap: { host: '', port: 993, secure: true },
        auth: { user: address, pass: '' },
    };
}

function mailboxesToAccounts(mailboxes = {}) {
    return Object.entries(mailboxes).map(([address, box]) => ({
        address,
        smtp: { host: '', port: 465, secure: true, ...box.smtp },
        imap: { host: '', port: 993, secure: true, ...box.imap },
        auth: { user: address, pass: '', ...box.auth },
    }));
}

function accountsToMailboxes(accounts = []) {
    const mailboxes = Object.create(null);
    for (const acc of accounts) {
        const address = String(acc.address || '').trim();
        if (!address)
            continue;
        mailboxes[address] = {
            smtp: { ...acc.smtp },
            imap: { ...acc.imap },
            auth: {
                user: String(acc.auth?.user || address).trim(),
                pass: acc.auth?.pass || '',
            },
        };
    }
    return mailboxes;
}

ODA({
    is: 'oda-email-settings',
    imports: 'oda//button, oda//checkbox, oda//icon',
    template: /* html */ `
        <style>
            :host {
                @apply --horizontal;
                @apply --flex;
                min-width: 640px;
                min-height: 420px;
                overflow: hidden;
            }
            .accounts {
                width: 220px;
                min-width: 180px;
                @apply --vertical;
                @apply --light;
                border-right: 1px solid var(--border-color, rgba(0,0,0,.1));
            }
            .accounts-toolbar {
                padding: 6px 8px;
                gap: 4px;
                @apply --horizontal;
                @apply --header;
                align-items: center;
            }
            .account-item {
                padding: 10px 12px;
                cursor: pointer;
                border-bottom: 1px solid rgba(0,0,0,.06);
            }
            .account-item[active] {
                @apply --selection;
            }
            .account-title {
                font-weight: 500;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .account-sub {
                font-size: x-small;
                opacity: .75;
            }
            .editor {
                @apply --vertical;
                @apply --flex;
                padding: 12px 16px;
                gap: 8px;
                overflow: auto;
            }
            fieldset {
                border: 1px solid var(--border-color, rgba(0,0,0,.12));
                border-radius: 4px;
                padding: 8px 12px;
                margin: 0;
            }
            legend {
                font-size: small;
                padding: 0 4px;
            }
            input {
                border: none;
                outline: none;
                background: transparent;
                width: 100%;
                padding: 4px 0;
                box-sizing: border-box;
                font: inherit;
            }
            .row {
                @apply --horizontal;
                gap: 12px;
                align-items: center;
            }
            .row fieldset {
                @apply --flex;
            }
            .port {
                max-width: 72px;
            }
            .presets {
                @apply --horizontal;
                gap: 4px;
                flex-wrap: wrap;
                padding: 4px 0 8px;
            }
            .empty {
                padding: 24px;
                opacity: .6;
                text-align: center;
            }
        </style>
        <div class="accounts" vertical>
            <div class="accounts-toolbar" horizontal>
                <strong flex>Ящики</strong>
                <oda-button icon="icons:add" title="Добавить ящик" @tap="addAccount"></oda-button>
            </div>
            <div flex style="overflow-y:auto;">
                <div ~for="accounts" class="account-item"
                    :active="index === $for.index"
                    @tap="index = $for.index">
                    <div class="account-title">{{$for.item.address || '(новый)'}}</div>
                    <div class="account-sub">{{$for.item.smtp?.host || 'SMTP не задан'}}</div>
                </div>
                <div ~if="!accounts.length" class="empty">Нет ящиков</div>
            </div>
        </div>
        <div class="editor" vertical flex>
            <div ~if="accounts[index]" vertical flex>
                <fieldset>
                    <legend>Адрес e-mail</legend>
                    <input type="email" placeholder="name@example.com" ::value="accounts[index].address">
                </fieldset>
                <div class="presets" horizontal>
                    <oda-button ~for="presetList" @tap="applyPreset($for.item.id)">{{$for.item.label}}</oda-button>
                </div>
                <fieldset>
                    <legend>Исходящая (SMTP)</legend>
                    <input placeholder="smtp.example.com" ::value="accounts[index].smtp.host">
                    <div class="row" horizontal>
                        <fieldset class="port">
                            <legend>Порт</legend>
                            <input type="number" ::value="accounts[index].smtp.port">
                        </fieldset>
                        <label horizontal style="gap:4px; align-items:center;">
                            <oda-checkbox ::value="accounts[index].smtp.secure"></oda-checkbox>
                            <span>SSL/TLS</span>
                        </label>
                    </div>
                </fieldset>
                <fieldset>
                    <legend>Входящая (IMAP)</legend>
                    <input placeholder="imap.example.com" ::value="accounts[index].imap.host">
                    <div class="row" horizontal>
                        <fieldset class="port">
                            <legend>Порт</legend>
                            <input type="number" ::value="accounts[index].imap.port">
                        </fieldset>
                        <label horizontal style="gap:4px; align-items:center;">
                            <oda-checkbox ::value="accounts[index].imap.secure"></oda-checkbox>
                            <span>SSL/TLS</span>
                        </label>
                    </div>
                </fieldset>
                <div class="row" horizontal>
                    <fieldset flex>
                        <legend>Логин</legend>
                        <input placeholder="user@example.com" ::value="accounts[index].auth.user">
                    </fieldset>
                    <fieldset flex>
                        <legend>Пароль</legend>
                        <input type="password" placeholder="••••••••" ::value="accounts[index].auth.pass">
                    </fieldset>
                </div>
                <oda-button error icon="icons:delete" @tap="removeAccount" style="align-self:flex-start; margin-top:8px;">Удалить ящик</oda-button>
            </div>
            <div ~if="!accounts[index]" class="empty" flex>Выберите ящик или нажмите «+»</div>
        </div>
    `,
    accounts: [],
    index: -1,
    get presetList() {
        return Object.entries(MAIL_PRESETS).map(([id, p]) => ({ id, label: p.label }));
    },
    // get current() {
    //     return this.accounts[this.index] || null;
    // },
    // нужно смотреть reactor
    addAccount() {
        this.accounts.push(emptyMailbox(''));
        this.index = this.accounts.length - 1;
        this.render();
    },
    removeAccount() {
        if (this.index < 0)
            return;
        this.accounts.splice(this.index, 1);
        this.index = Math.min(this.index, this.accounts.length - 1);
        this.render();
    },
    applyPreset(presetId) {
        const acc = this.current;
        const preset = MAIL_PRESETS[presetId];
        if (!acc || !preset)
            return;
        acc.smtp = { ...acc.smtp, ...preset.smtp };
        acc.imap = { ...acc.imap, ...preset.imap };
        this.render();
    },
    validate() {
        const addresses = this.accounts.map(a => String(a.address || '').trim()).filter(Boolean);
        if (this.accounts.some(a => !String(a.address || '').trim()))
            throw new Error('Укажите адрес e-mail для каждого ящика');
        if (addresses.length !== new Set(addresses).size)
            throw new Error('Адреса ящиков должны быть уникальными');
    },
});

ODA({
    is: 'oda-form-email',
    imports: 'oda//button, oda//icon',
    template: /* html */ `
        <style>
            :host {
                @apply --horizontal;
                @apply --flex;
                overflow: hidden;
            }
            .sidebar {
                width: 200px;
                min-width: 160px;
                @apply --vertical;
                @apply --light;
                border-right: 1px solid var(--border-color, rgba(0,0,0,.08));
            }
            .toolbar {
                padding: 6px 8px;
                gap: 4px;
                @apply --horizontal;
                @apply --header;
                align-items: center;
            }
            .sidebar-section {
                padding: 6px 10px;
                font-size: x-small;
                opacity: .7;
                text-transform: uppercase;
            }
            .mailbox-item, .folder-item {
                padding: 8px 12px;
                cursor: pointer;
                border-radius: 4px;
                margin: 2px 6px;
            }
            .mailbox-item[active], .folder-item[active] {
                @apply --selection;
            }
            .list-pane {
                width: 300px;
                min-width: 220px;
                @apply --vertical;
                border-right: 1px solid var(--border-color, rgba(0,0,0,.08));
            }
            .msg-item {
                padding: 10px 12px;
                cursor: pointer;
                border-bottom: 1px solid rgba(0,0,0,.06);
            }
            .msg-item[active] {
                @apply --selection;
            }
            .msg-subject {
                font-weight: 500;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .msg-meta {
                font-size: x-small;
                opacity: .75;
            }
            .preview {
                @apply --vertical;
                @apply --flex;
                overflow: auto;
            }
            .preview-head {
                padding: 12px 16px;
                @apply --light;
                border-bottom: 1px solid var(--border-color, rgba(0,0,0,.08));
            }
            .preview-body {
                padding: 16px;
                white-space: pre-wrap;
            }
            .compose {
                padding: 12px;
                @apply --vertical;
                gap: 8px;
            }
            .compose fieldset {
                border: 1px solid var(--border-color, rgba(0,0,0,.12));
                border-radius: 4px;
                padding: 6px 10px;
                margin: 0;
            }
            .compose legend {
                font-size: x-small;
                padding: 0 4px;
            }
            .compose input, .compose textarea {
                border: none;
                outline: none;
                background: transparent;
                width: 100%;
                box-sizing: border-box;
                font: inherit;
            }
            .compose textarea {
                min-height: 120px;
                resize: vertical;
            }
        </style>
        <div class="sidebar" vertical>
            <div class="toolbar" horizontal>
                <oda-button icon="icons:settings" @tap="openSettings" title="Настройки ящиков"></oda-button>
                <oda-button icon="icons:refresh" @tap="refreshMessages" title="Обновить"></oda-button>
                <oda-button icon="icons:create" @tap="startCompose" title="Написать"></oda-button>
            </div>
            <div flex vertical>
                <div class="sidebar-section">Ящики</div>
                <div ~for="mailboxList" class="mailbox-item"
                    :active="selectedAddress === $for.item"
                    @tap="selectMailbox($for.item)">{{$for.item}}</div>
                <div ~if="!mailboxList.length" class="sidebar-section">Нет ящиков</div>
                <div class="sidebar-section">Папки</div>
                <div class="folder-item" :active="folder === 'inbox'" @tap="folder = 'inbox'">Входящие</div>
                <div class="folder-item" :active="folder === 'outbox'" @tap="folder = 'outbox'">Исходящие</div>
            </div>
        </div>
        <div ~if="!composing" class="list-pane" vertical flex>
            <div flex style="overflow-y: auto;">
                <div ~for="filteredMessages" class="msg-item"
                    :active="selectedRow?.path === $for.item.path"
                    @tap="selectMessage($for.item)">
                    <div class="msg-subject">{{$for.item.subject}}</div>
                    <div class="msg-meta">{{$for.item.timeLabel}} · {{$for.item.status || $for.item.box}}</div>
                </div>
                <div ~if="!filteredMessages.length" class="sidebar-section" style="padding:16px;">Нет писем</div>
            </div>
        </div>
        <div ~if="composing" class="list-pane compose" vertical flex>
            <fieldset>
                <legend>Кому</legend>
                <input placeholder="recipient@example.com" ::value="compose.to">
            </fieldset>
            <fieldset>
                <legend>Тема</legend>
                <input placeholder="Тема письма" ::value="compose.subject">
            </fieldset>
            <fieldset flex>
                <legend>Текст</legend>
                <textarea ::value="compose.body" flex></textarea>
            </fieldset>
            <div horizontal style="gap:8px;">
                <oda-button accent icon="icons:send" @tap="sendCompose">Отправить</oda-button>
                <oda-button @tap="composing = false">Отмена</oda-button>
            </div>
        </div>
        <div class="preview" vertical flex>
            <div ~if="selectedRow && !composing" class="preview-head" vertical>
                <strong>{{preview.subject}}</strong>
                <span class="msg-meta">От: {{preview.from}}</span>
                <span class="msg-meta">Кому: {{preview.to}}</span>
                <span ~if="preview.status" class="msg-meta">Статус: {{preview.status}}</span>
            </div>
            <div ~if="selectedRow && !composing" class="preview-body">{{preview.body}}</div>
            <div ~if="!selectedRow && !composing" flex style="padding:24px; opacity:.6;">Выберите письмо</div>
        </div>
    `,
    $item: null,
    composing: false,
    folder: 'inbox',
    selectedAddress: '',
    selectedRow: null,
    preview: { subject: '', from: '', to: '', body: '', status: '' },
    messages: [],
    compose: { to: '', subject: '', body: '' },
    _settings: null,
    _watch: null,
    get structureId() {
        const item = this.$item;
        if (!item)
            return '';
        return item.id || item.DATA?.id || item.path?.split('/').filter(Boolean).pop() || '';
    },
    get mailboxList() {
        return this._settings?.mailboxes
            ? Object.keys(this._settings.mailboxes)
            : [];
    },
    get filteredMessages() {
        const addr = this.selectedAddress;
        const folder = this.folder;
        const structureId = this.structureId;
        if (!addr || !structureId)
            return [];
        return this.messages.filter(m =>
            m.structure === structureId && m.address === addr && m.box === folder
        );
    },
    attached() {
        this.init();
    },
    async init() {
        await this.loadSettings();
        if (!this.selectedAddress && this.mailboxList.length)
            this.selectedAddress = this.mailboxList[0];
        await this.refreshMessages();
        if (this._watch)
            return;
        const onChanged = () => this.debounce('email-refresh', () => this.refreshMessages(), 150);
        this.$item?.listen?.('changed', onChanged);
        this._watch = true;
    },
    async loadSettings() {
        this._settings = await this.$item.fetch('read_secret', { name: 'email' });
    },
    async openSettings() {
        if (!this.structureId) {
            alert('Откройте почту из группы ($structure), не из корня storage');
            return;
        }
        await this.loadSettings();
        const el = ODA.createElement('oda-email-settings', {
            accounts: mailboxesToAccounts(this._settings?.mailboxes),
        });
        if (!el.accounts.length) {
            el.addAccount();
        }
        else {
            el.index = 0;
        }
        try {
            await WORK.showDialog(el, {
                TITLE: { label: 'Почтовые ящики', icon: 'enterprise:email' },
                OK: { label: 'Сохранить', icon: 'icons:save' },
                CANCEL: { label: 'Отмена', icon: 'icons:close' },
            });
            el.validate();
            const mailboxes = accountsToMailboxes(el.accounts);
            await this.$item.fetch(
                'save_secret',
                { name: 'email' },
                JSON.stringify({ mailboxes }),
            );
            await this.loadSettings();
            const list = Object.keys(mailboxes);
            if (!list.includes(this.selectedAddress))
                this.selectedAddress = list[0] || '';
            await this.refreshMessages();
        }
        catch { /* cancel */ }
    },
    selectMailbox(address) {
        this.selectedAddress = address;
        this.selectedRow = null;
        this.preview = { subject: '', from: '', to: '', body: '', status: '' };
    },
    async refreshMessages() {
        if (!this.$item)
            return;
        const to = new Date().toISOString().slice(0, 10);
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - 30);
        const from = fromDate.toISOString().slice(0, 10);
        let rows = await this.$item.fetch('log_index', { flat: true, from, to, ext: 'eml' });
        if (!Array.isArray(rows))
            rows = [];
        const items = [];
        for (const row of rows) {
            const hit = mailboxFromPath(row.path);
            if (!hit)
                continue;
            let subject = '';
            let status = '';
            let fromH = '';
            let toH = '';
            let body = '';
            try {
                const file = await WORK.get_item(row.path, 'info');
                const raw = await file.load();
                const parsed = parseEmlClient(raw);
                subject = parsed.subject;
                status = parsed.status;
                fromH = parsed.from;
                toH = parsed.to;
                body = parsed.body;
            }
            catch { /* skip preview fields */ }
            items.push({
                ...row,
                structure: hit.structure,
                address: hit.address,
                box: hit.box,
                subject,
                status,
                from: fromH,
                to: toH,
                body,
                timeLabel: row.time
                    ? new Date(row.time).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                    : '',
            });
        }
        items.sort((a, b) => (b.time || 0) - (a.time || 0));
        this.messages = items;
        this.render();
    },
    async selectMessage(row) {
        this.selectedRow = row;
        if (row.body != null) {
            this.preview = {
                subject: row.subject,
                from: row.from,
                to: row.to,
                body: row.body,
                status: row.status,
            };
            return;
        }
        try {
            const file = await WORK.get_item(row.path, 'info');
            const raw = await file.load();
            const parsed = parseEmlClient(raw);
            this.preview = {
                subject: parsed.subject,
                from: parsed.from,
                to: parsed.to,
                body: parsed.body,
                status: parsed.status,
            };
        }
        catch (e) {
            this.preview = { subject: row.path, from: '', to: '', body: e.message, status: '' };
        }
    },
    startCompose() {
        if (!this.selectedAddress) {
            alert('Сначала настройте почтовый ящик (⚙)');
            return;
        }
        this.composing = true;
        this.compose = { to: '', subject: '', body: '' };
    },
    async sendCompose() {
        const address = this.selectedAddress;
        if (!address)
            return;
        const settings = this._settings || await this.$item.fetch('read_secret', { name: 'email' });
        const box = settings?.mailboxes?.[address];
        const folder = await this.$item.get_item('~/email/' + address);
        if (!folder) {
            alert('Папка ящика не найдена. Сохраните настройки — будет создана email/' + address);
            return;
        }
        const eml = defaultEml({
            from: box?.auth?.user || address,
            to: this.compose.to,
            subject: this.compose.subject,
            body: this.compose.body,
            address,
            status: 'pending',
        });
        try {
            await folder.save_file(new File([eml], 'outbox.eml', { type: 'message/rfc822' }), { encoding: 'utf-8' });
            this.composing = false;
            this.folder = 'outbox';
            await this.refreshMessages();
        }
        catch (e) {
            alert(e.message);
        }
    },
});
