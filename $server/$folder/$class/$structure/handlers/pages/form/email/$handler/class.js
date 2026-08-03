export default {
    icon: 'enterprise:email',
    imports: 'oda//button, oda//icon',
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                @apply --flex;
            }
            .email-top-panel {
                gap: 4px;
                align-items: center;
            }
        </style>
        <div class="email-top-panel" slot="top-panel" horizontal>
            <oda-button icon="icons:add" @tap="$('oda-form-email')?.createEmail?.()" title="Написать"></oda-button>
            <oda-button icon="icons:refresh" @tap="$('oda-form-email')?.fetchRefresh?.()" title="Обновить"></oda-button>
        </div>
        <oda-form-email flex :$item></oda-form-email>
    `,
    async showSettings($item, ...params) {
        // todo: заменить $item на this, когда заработает bind
        return runEmailSettingsDialog($item);
    },
}

/** RFC 2047: один encoded-word → строка (ошибка → null). */
function decodeMimeWord(charset, encoding, data) {
    try {
        let bytes;
        const enc = String(encoding || '').toUpperCase();
        if (enc === 'B') {
            const bin = atob(String(data || '').replace(/\s+/g, ''));
            bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
        }
        else if (enc === 'Q') {
            const q = String(data || '').replace(/_/g, ' ');
            const out = [];
            for (let i = 0; i < q.length; i++) {
                if (q[i] === '=' && i + 2 < q.length) {
                    const hex = q.slice(i + 1, i + 3);
                    if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
                        out.push(parseInt(hex, 16));
                        i += 2;
                        continue;
                    }
                }
                out.push(q.charCodeAt(i));
            }
            bytes = new Uint8Array(out);
        }
        else {
            return null;
        }
        const cs = String(charset || 'utf-8').trim().toLowerCase();
        const label = cs === 'utf8' ? 'utf-8' : cs;
        return new TextDecoder(label).decode(bytes);
    }
    catch {
        return null;
    }
}

/** RFC 2047 encoded-words в значении заголовка; без =?...?= — без изменений. */
function decodeRfc2047(str) {
    str = String(str ?? '');
    if (!str.includes('=?'))
        return str;
    // LWSP только между соседними encoded-word удаляется (RFC 2047 §6.2)
    str = str.replace(/(\=\?[^?]+\?[bBqQ]\?[^?]*\?=)(\s+)(?=\=\?)/g, '$1');
    return str.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (full, charset, encoding, data) => {
        const decoded = decodeMimeWord(charset, encoding, data);
        return decoded != null ? decoded : full;
    });
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
    for (const key of Object.keys(headers))
        headers[key] = decodeRfc2047(headers[key]);
    return {
        headers,
        body,
        subject: headers.subject || '(без темы)',
        from: headers.from || '',
        to: headers.to || '',
        status: headers['x-work-status'] || '',
    };
}

/** path лога: …/message/.<account>/<box>.eml… */
function mailboxFromPath(path) {
    const m = String(path || '').match(/\/message\/\.([^/]+)\/(inbox|outbox|trash)\.eml/i);
    if (!m)
        return null;
    return {
        address: decodeURIComponent(m[1]),
        box: m[2].toLowerCase(),
    };
}

function accountAddresses(mailboxes = {}) {
    const result = [];
    for (const [key, box] of Object.entries(mailboxes || {})) {
        const address = String(box?.auth?.user || box?.address || key || '').trim();
        if (address && !result.includes(address))
            result.push(address);
    }
    return result;
}

function asItemArray(value) {
    if (value == null)
        return [];
    if (Array.isArray(value))
        return value;
    return [value];
}

function dayKeyFromEntry(entry) {
    if (entry?.name)
        return String(entry.name);
    const parts = String(entry?.path || '').split('/').filter(Boolean);
    return parts.pop() || '';
}

function parseLogContent(row) {
    let meta = row?.content;
    if (typeof meta === 'string') {
        try {
            meta = JSON.parse(meta);
        }
        catch {
            meta = null;
        }
    }
    if (!meta || typeof meta !== 'object')
        return {};
    return meta;
}

function formatMailDate(value) {
    if (!value)
        return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime()))
        return String(value);
    return d.toLocaleString([], {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
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

function accountsToMailboxes(accounts = [], previousMailboxes = {}) {
    const mailboxes = Object.create(null);
    for (const acc of accounts) {
        const address = String(acc.auth?.user || '').trim();
        if (!address)
            continue;
        const prevPass = previousMailboxes[address]?.auth?.pass || '';
        const nextPass = acc.auth?.pass || '';
        mailboxes[address] = {
            smtp: { ...acc.smtp },
            imap: { ...acc.imap },
            auth: {
                user: address,
                pass: nextPass || prevPass || '',
            },
        };
    }
    return mailboxes;
}

async function runEmailSettingsDialog($item) {
    const $context = $item.$context?.length ? $item.$context[0] : $item.$context;
    const settings = await $context.fetch('read_secret', { filename: 'email.json' });
    const el = ODA.createElement('oda-email-settings', {
        accounts: mailboxesToAccounts(settings?.mailboxes),
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
    }
    catch {
        return null;
    }
    try {
        el.validate();
        const mailboxes = accountsToMailboxes(el.accounts, settings?.mailboxes);
        await $context.fetch(
            'save_secret',
            { filename: 'email.json' },
            JSON.stringify({ mailboxes }),
        );
        return mailboxes;
    }
    catch (e) {
        alert(e.message || e);
        return null;
    }
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
                min-height: 320px;
                overflow: hidden;
            }
            .accounts {
                width: 220px;
                min-width: 180px;
                @apply --light;
                border-right: 1px solid var(--border-color);
            }
            .accounts-toolbar {
                padding: 6px 8px;
                gap: 4px;
                @apply --header;
                align-items: center;
            }
            .account-item {
                padding: 10px 8px 10px 12px;
                cursor: pointer;
                border-bottom: 1px solid var(--border-color);
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
                padding: 12px 16px;
                gap: 8px;
                overflow: auto;
            }
            fieldset {
                border: 1px solid var(--border-color);
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
                gap: 12px;
                align-items: center;
            }
            .port {
                max-width: 72px;
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
                <div ~if="accounts.length" ~for="accounts" class="account-item" horizontal
                    :info-invert="index === $for.index"
                    @tap="index = $for.index">
                    <div vertical flex>
                        <div class="account-title">{{$for.item.auth?.user || '(новый)'}}</div>
                        <div class="account-sub">{{$for.item.smtp?.host || 'SMTP не задан'}}</div>
                    </div>
                    <oda-button ~if="index === $for.index" icon="icons:delete" title="Удалить ящик" @tap="removeAccount($for.index)"></oda-button>
                </div>
                <div ~if="!accounts.length" class="empty">Нет ящиков</div>
            </div>
        </div>
        <div class="editor" vertical flex>
            <div ~if="accounts[index]" vertical flex>
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
            </div>
            <div ~if="!accounts[index]" class="empty" flex>Выберите ящик или нажмите «+»</div>
        </div>
    `,
    accounts: [],
    index: -1,
    addAccount() {
        this.accounts.push(emptyMailbox(''));
        this.index = this.accounts.length - 1;
        this.render();
    },
    removeAccount(index) {
        if (index < 0)
            return;
        this.accounts.splice(index, 1);
        this.async(() => {
            if (this.index >= index) {
                this.index = Math.min(this.index, this.accounts.length - 1);
            }
            this.render();
        })
    },
    validate() {
        const logins = this.accounts.map(a => String(a.auth?.user || '').trim()).filter(Boolean);
        if (this.accounts.some(a => !String(a.auth?.user || '').trim()))
            throw new Error('Укажите логин e-mail для каждого ящика');
        if (logins.length !== new Set(logins).size)
            throw new Error('Логины ящиков должны быть уникальными');
    },
});

ODA({
    is: 'oda-form-email',
    imports: 'oda//button, oda//icon, oda//app-layout',
    extends: 'oda-app-layout',
    template: /* html */ `
        <style>
            :host {
                overflow: hidden;
            }
        </style>
        <!--<oda-mailbox ~for="boxes" slot="left-panel" vertical flex :box="$for.item" :label="$for.item.label" :icon="$for.item.icon"></oda-mailbox>-->
        <oda-mailbox slot="left-panel" vertical flex :box="boxes[0]" label="Входящие" icon="icons:inbox"></oda-mailbox>
        <oda-mailbox slot="left-panel" vertical flex :box="boxes[1]" label="Исходящие" icon="iconoir:send-mail"></oda-mailbox>
        <oda-mailbox slot="left-panel" vertical flex :box="boxes[2]" label="Корзина" icon="icons:delete"></oda-mailbox>
        <oda-email-message slot="main" :mode></oda-email-message>
    `,
    $item: null,
    boxes: [
        { id: 'inbox', label: 'Входящие', icon: 'icons:inbox' },
        { id: 'outbox', label: 'Исходящие', icon: 'iconoir:send-mail' },
        { id: 'trash', label: 'Корзина', icon: 'icons:delete' },
    ],
    selected: null,
    mode: 'idle',
    draft: { to: '', subject: '', body: '' },
    get _settings() {
        this.$item?.fetch('read_secret', { filename: 'email.json' }).then(res => {
            this._settings = res;
        });
        return null;
    },
    _watch: null,
    _datesEpoch: 0,
    get accounts() {
        return accountAddresses(this._settings?.mailboxes);
    },
    async attached() {
        await this._settings;
        this.async(() => {
            this.init();
        });
    },
    async init() {
        this.bumpDates();
        if (this._watch)
            return;
        const onChanged = () => this.debounce('email-dates', () => this.bumpDates(), 150);
        this.$item?.listen?.('changed', onChanged);
        this._watch = true;
    },
    async loadSettings() {
        this._settings = await this.$item.fetch('read_secret', { filename: 'email.json' });
    },
    bumpDates() {
        this._datesEpoch = (this._datesEpoch || 0) + 1;
        this.render();
    },
    async fetchRefresh() {
        await this.$pdp.$handler.fetch('refresh');
        await this.loadSettings();
        this.bumpDates();
    },
    selectMessage(row) {
        this.selected = row;
        this.mode = 'view';
        this.render();
    },
    createEmail() {
        const address = this.accounts[0];
        if (!address) {
            alert('Сначала настройте почтовый ящик (⚙)');
            return;
        }
        this.selected = null;
        this.draft = { to: '', subject: '', body: '' };
        this.mode = 'compose';
        this.render();
    },
    async sendDraft() {
        const address = this.accounts[0];
        if (!address) {
            alert('Сначала настройте почтовый ящик (⚙)');
            return;
        }
        const settings = this._settings || await this.$item.fetch('read_secret', { filename: 'email.json' });
        const box = settings?.mailboxes?.[address];
        const eml = defaultEml({
            from: box?.auth?.user || address,
            to: this.draft.to,
            subject: this.draft.subject,
            body: this.draft.body,
            address,
            status: 'pending',
        });
        try {
            await this.$item.save_file(new File([eml], 'outbox.eml', { type: 'message/rfc822' }), {
                encoding: 'utf-8',
                folder: address,
            });
            this.mode = 'idle';
            this.draft = { to: '', subject: '', body: '' };
            this.bumpDates();
        }
        catch (e) {
            alert(e.message);
        }
    },
});

ODA({
    is: 'oda-mailbox',
    template: /* html */ `
        <style>
            :host {
                min-width: 240px;
                overflow: hidden;
                border-bottom: 1px solid var(--border-color);
            }
            .box-title {
                @apply --header;
                padding: 8px 12px;
                font-weight: 600;
                font-size: small;
                text-transform: uppercase;
                letter-spacing: .04em;
            }
            .days {
                overflow-y: auto;
            }
            .empty {
                padding: 12px;
                opacity: .6;
                font-size: small;
            }
        </style>
        <div class="box-title">{{box?.label || box?.id}}</div>
        <div class="days" vertical flex>
            <email-day ~for="dates" :day="$for.item" :box-id="box?.id"></email-day>
            <div ~if="!dates.length" class="empty">Нет писем</div>
        </div>
    `,
    box: null,
    dayPaths: {},
    get dates() {
        return Object.keys(this.dayPaths).sort((a, b) => b.localeCompare(a));
    },
    attached() {
        this.refreshDayPaths();
    },
    async refreshDayPaths() {
        const item = this.$pdp.$item;
        if (!item)
            return;
        const map = Object.create(null);
        try {
            let entries = await item.get_item('/~/logs/.data.logs/history/*');
            entries = asItemArray(await Promise.resolve(entries));
            for (const entry of entries) {
                const day = dayKeyFromEntry(entry);
                const path = entry?.path;
                if (!day || !path)
                    continue;
                (map[day] ??= []).push(path);
            }
        }
        catch { /* нет логов аккаунта */ }

        this.dayPaths = map;
        this.render();
    },
});

ODA({
    is: 'email-day',
    imports: 'oda//button',
    template: /* html */ `
        <style>
            :host {
                @apply --vertical;
                @apply --no-flex;
            }
            .day-header {
                cursor: pointer;
                padding: 6px 10px;
                align-items: center;
                gap: 4px;
                font-size: small;
                opacity: .85;
            }
            .msg-list {
                gap: 2px;
                padding: 0 4px 6px;
            }
            .msg-item {
                display: grid;
                grid-template-columns: 1fr auto;
                grid-template-rows: auto auto;
                gap: 2px 8px;
                padding: 8px 10px;
                cursor: pointer;
                border-radius: 4px;
                margin: 0 2px;
            }
            .msg-subject {
                font-weight: 500;
                font-size: small;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                min-width: 0;
            }
            .msg-date {
                font-size: x-small;
                opacity: .7;
                white-space: nowrap;
                justify-self: end;
            }
            .msg-from, .msg-to {
                font-size: x-small;
                opacity: .75;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                min-width: 0;
            }
            .msg-to {
                justify-self: end;
                text-align: right;
            }
        </style>
        <div class="day-header" horizontal :accent="expanded" @tap="expanded = !expanded">
            <span flex>{{label}}</span>
            <oda-button icon-size="16" :icon="expanderIcon"></oda-button>
        </div>
        <div class="msg-list" vertical ~if="expanded">
            <div ~for="items" class="msg-item"
                :info-invert="selectedPath === $for.item.path"
                @tap="$pdp?.selectMessage?.($for.item)">
                <div class="msg-subject">{{$for.item.subject}}</div>
                <div class="msg-date">{{$for.item.dateLabel}}</div>
                <div class="msg-from">От: {{$for.item.from}}</div>
                <div class="msg-to">Кому: {{$for.item.to}}</div>
            </div>
        </div>
    `,
    day: {
        $def: '',
        set(n) {
            if (this.isFirst)
                this.expanded = true;
        }
    },
    boxId: '',
    messages: [],
    _loading: false,
    _loadedFor: '',
    get selectedPath() {
        return this.$pdp?.selected?.path || '';
    },
    get expanderIcon() {
        return this.expanded ? 'icons:chevron-right:90' : 'icons:chevron-right';
    },
    get isFirst() {
        const dates = this.$pdp?.dates;
        return Array.isArray(dates) && dates[0] === this.day;
    },
    expanded: {
        $def: false,
        $attr: true,
        set(n) {
            if (n)
                this.async(() => this.loadMessages());
        },
    },
    get label() {
        const date = new Date(this.day + 'T12:00:00');
        if (Number.isNaN(date.getTime()))
            return this.day;
        return date.toLocaleDateString(undefined, {
            weekday: 'short',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });
    },
    get items() {
        if (this.expanded)
            this.async(() => this.loadMessages());
        return this.messages;
    },
    async loadMessages() {
        if (!this.expanded || !this.day || !this.boxId)
            return;
        const key = this.day + '|' + this.boxId + '|' + (this.$pdp?._datesEpoch ?? 0);
        if (this._loading || this._loadedFor === key)
            return;
        this._loading = true;
        try {
            const item = this.$pdp?.$item;
            const paths = this.$pdp?.dayPaths?.[this.day] || [];
            if (!item || !paths.length) {
                this.messages = [];
                this._loadedFor = key;
                this.render();
                return;
            }
            const rows = [];
            const seen = new Set();
            for (const folderPath of paths) {
                try {
                    let files = await WORK.get_item(folderPath + '/*');
                    files = asItemArray(await Promise.resolve(files));
                    files = await Promise.all(files.map(f => Promise.resolve(f)));
                    for (const file of files) {
                        if (!file || typeof file.load !== 'function')
                            continue;
                        let row;
                        try {
                            const raw = await file.load();
                            row = typeof raw === 'string' ? JSON.parse(raw) : raw;
                        }
                        catch {
                            continue;
                        }
                        if (!row?.path)
                            continue;
                        const hit = mailboxFromPath(row.path);
                        if (!hit || hit.box !== this.boxId)
                            continue;
                        if (seen.has(row.path))
                            continue;
                        seen.add(row.path);
                        const meta = parseLogContent(row);
                        const dateValue = meta.date || row.time || '';
                        rows.push({
                            ...row,
                            address: hit.address,
                            box: hit.box,
                            subject: meta.subject || '(без темы)',
                            from: meta.from || '',
                            to: meta.to || '',
                            date: dateValue,
                            dateLabel: formatMailDate(dateValue),
                            sortTime: dateValue ? new Date(dateValue).getTime() : (row.time || 0),
                        });
                    }
                }
                catch { /* нет файлов в папке дня */ }
            }
            rows.sort((a, b) => (b.sortTime || 0) - (a.sortTime || 0));
            this.messages = rows;
            this._loadedFor = key;
            this.render();
        }
        finally {
            this._loading = false;
        }
    },
    attached() {
        if (this.expanded)
            this.async(() => this.loadMessages());
    },
});

ODA({
    is: 'oda-email-message',
    imports: 'oda//button',
    template: /* html */ `
        <style>
            :host {
                @apply --vertical;
                @apply --flex;
                overflow: hidden;
                padding: 12px 16px;
                gap: 8px;
            }
            fieldset {
                border: 1px solid var(--border-color);
                border-radius: 4px;
                padding: 6px 10px;
                margin: 0;
            }
            legend {
                font-size: x-small;
                padding: 0 4px;
            }
            input, textarea {
                border: none;
                outline: none;
                background: transparent;
                width: 100%;
                box-sizing: border-box;
                font: inherit;
            }
            textarea {
                min-height: 160px;
                resize: vertical;
            }
            .idle {
                align-items: center;
                justify-content: center;
                opacity: .6;
                padding: 24px;
            }
            .msg-meta {
                font-size: small;
                opacity: .8;
            }
            .toolbar {
                gap: 8px;
                align-items: center;
                justify-content: flex-end;
            }
            .view-body {
                white-space: pre-wrap;
                overflow: auto;
                padding: 8px 0;
            }
        </style>
        <div ~if="mode === 'idle'" class="idle" flex>Выберите письмо</div>
        <div ~if="mode === 'compose'" vertical flex>
            <fieldset>
                <legend>Кому</legend>
                <input placeholder="recipient@example.com" ::value="draft.to">
            </fieldset>
            <fieldset>
                <legend>Тема</legend>
                <input placeholder="Тема письма" ::value="draft.subject">
            </fieldset>
            <fieldset flex>
                <legend>Текст</legend>
                <textarea ::value="draft.body" flex></textarea>
            </fieldset>
            <div class="toolbar" horizontal>
                <oda-button icon="icons:send" @tap="$pdp.sendDraft" title="Отправить">Отправить</oda-button>
            </div>
        </div>
        <div ~if="mode === 'view'" vertical flex>
            <strong>{{view.subject}}</strong>
            <span class="msg-meta">От: {{view.from}}</span>
            <span class="msg-meta">Кому: {{view.to}}</span>
            <span ~if="view.status" class="msg-meta">Статус: {{view.status}}</span>
            <div class="view-body" flex>{{view.body}}</div>
        </div>
    `,
    get mode() {
        return this.$pdp?.mode || 'idle';
    },
    get draft() {
        return this.$pdp?.draft || { to: '', subject: '', body: '' };
    },
    get view() {
        const row = this.$pdp?.selected;
        if (!row)
            return { subject: '', from: '', to: '', body: '', status: '' };
        if (row.body == null)
            this.async(() => this._ensureBody());
        return {
            subject: row.subject || '(без темы)',
            from: row.from || '',
            to: row.to || '',
            body: row.body ?? '',
            status: row.status || '',
        };
    },
    async _ensureBody() {
        const row = this.$pdp?.selected;
        if (this.$pdp?.mode !== 'view' || !row || row.body != null)
            return;
        try {
            const res = await fetch(row.path);
            const raw = await res.text();
            const parsed = parseEmlClient(raw);
            row.body = parsed.body;
            row.subject = parsed.subject;
            row.from = parsed.from;
            row.to = parsed.to;
            row.status = parsed.status;
        }
        catch (e) {
            row.body = e.message;
        }
        finally {
            this.view = row;
        }
    },
});
