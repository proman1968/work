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
            <oda-button icon="icons:add" @tap="odaFormEmail?.createEmail?.()" title="Написать"></oda-button>
            <oda-button icon="icons:refresh" @tap="odaFormEmail?.fetchRefresh?.()" title="Обновить"></oda-button>
        </div>
        <oda-form-email flex :$item></oda-form-email>
    `,
    get odaFormEmail() {
        return this.$('oda-form-email');
    },
}

const NO_MAILBOX = 'Сначала настройте почтовый ящик в настройках формы';
const EMPTY_DRAFT = () => ({ from: '', to: '', subject: '', body: '', inReplyTo: '' });

function accountAddresses(mailboxes = {}) {
    const result = [];
    for (const [key, box] of Object.entries(mailboxes || {})) {
        const address = String(box?.auth?.user || box?.address || key || '').trim();
        if (address && !result.includes(address))
            result.push(address);
    }
    return result;
}

function parseJson(value) {
    if (value && typeof value === 'object')
        return value;
    if (typeof value !== 'string' || !value)
        return null;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : null;
    }
    catch {
        return null;
    }
}

function formatMailDate(value) {
    if (!value)
        return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime()))
        return String(value);
    return d.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function newUid() {
    if (globalThis.crypto?.randomUUID)
        return crypto.randomUUID();
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/** Адрес из «Имя <a@b>» или «a@b». */
function bareAddress(value) {
    const s = String(value || '').trim();
    const m = s.match(/<([^>]+)>/);
    return (m ? m[1] : s).trim();
}

/** Проверка поля «Кому»: непустое, каждый адрес похож на e-mail. */
function validateRecipients(to) {
    const list = String(to || '').split(/[,;]/).map(s => s.trim()).filter(Boolean);
    if (!list.length)
        throw new Error('Укажите получателя');
    const bad = list.filter(a => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(bareAddress(a)));
    if (bad.length)
        throw new Error('Некорректный адрес: ' + bad.join(', '));
    return list.join(', ');
}

function htmlToText(html) {
    try {
        return new DOMParser().parseFromString(html, 'text/html').body?.textContent || '';
    }
    catch {
        return '';
    }
}

function quoteBody(msg) {
    const text = msg.body || htmlToText(msg.html || '');
    const quoted = String(text).split(/\r?\n/).map(line => '> ' + line).join('\n');
    return `\n\n${msg.dateLabel || ''}, ${msg.from || ''} пишет:\n${quoted}`;
}

/** Документ для iframe sandbox: без скриптов, ссылки — в новой вкладке. */
function htmlDocument(html) {
    return '<!doctype html><html><head><meta charset="utf-8"><base target="_blank">'
        + '<style>body{margin:0;font-family:sans-serif;word-wrap:break-word;}img{max-width:100%;height:auto;}</style>'
        + '</head><body>' + String(html || '') + '</body></html>';
}

function defaultEmlJson({ uid, from, to, subject, body, address, inReplyTo, status = 'pending' }) {
    const json = {
        uid,
        subject: subject || '(без темы)',
        from: from || '',
        to: to || '',
        date: new Date().toISOString(),
        body: body || '',
        html: '',
        status,
        box: 'outbox',
        mailbox: address || '',
    };
    if (inReplyTo)
        json.inReplyTo = inReplyTo;
    return json;
}

/** Метаданные письма для message лога (список строится без чтения тел). */
function emlMeta(json) {
    return {
        uid: json.uid || '',
        subject: json.subject || '',
        from: json.from || '',
        to: json.to || '',
        date: json.date || '',
        box: json.box || '',
        mailbox: json.mailbox || '',
        status: json.status || '',
    };
}

/** Строка лога → письмо списка. Старые записи без box в message — чтение файла (legacy). */
async function rowToMessage(row) {
    let meta = parseJson(row.content) || {};
    if (!meta.box) {
        try {
            const res = await fetch(row.path);
            const json = parseJson(await res.text());
            if (!json?.box)
                return null;
            meta = json;
        }
        catch {
            return null;
        }
    }
    const date = meta.date || row.time || '';
    return {
        path: row.path,
        uid: meta.uid || '',
        subject: meta.subject || '(без темы)',
        from: meta.from || '',
        to: meta.to || '',
        date,
        status: meta.status || '',
        error: meta.error || '',
        box: meta.box,
        address: meta.mailbox || '',
        messageId: meta.messageId || '',
        body: null,
        html: null,
        dateLabel: formatMailDate(date),
        sortTime: date ? new Date(date).getTime() : (row.time || 0),
    };
}

function emptyMailbox(address = '') {
    return {
        address,
        smtp: { host: '', port: 465, secure: true },
        imap: { host: '', port: 993, secure: true },
        auth: { user: address, pass: '' },
    };
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
                border-right: 1px solid var(--subtle-border);
            }
            .accounts-toolbar {
                padding: 6px var(--space-m);
                gap: var(--space-s);
                @apply --header;
                align-items: center;
            }
            .account-item {
                padding: 10px var(--space-m) 10px 12px;
                cursor: pointer;
                border-bottom: 1px solid var(--subtle-border);
            }
            .account-item:not([info-invert]):hover {
                @apply --hover;
            }
            .account-title {
                font-weight: 500;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .account-sub {
                font-size: x-small;
                @apply --muted;
            }
            /* на инвертированной плашке приглушённый цвет темы нечитаем — следуем цвету плашки */
            [info-invert] .account-sub {
                color: inherit;
                fill: inherit;
                opacity: .75;
            }
            .editor {
                padding: 12px var(--space-l);
                gap: var(--space-m);
                overflow: auto;
            }
            fieldset {
                border: 1px solid var(--subtle-border);
                border-radius: var(--radius-s);
                padding: var(--space-s) var(--space-m);
                margin: 0;
            }
            legend {
                font-size: x-small;
                padding: 0 var(--space-s);
            }
            input {
                border: none;
                outline: none;
                background: transparent;
                color: inherit;
                width: 100%;
                padding: var(--space-s) 0;
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
                @apply --muted;
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
    draft: EMPTY_DRAFT(),
    accounts: [],
    _settings: null,
    /** Зарегистрированные колонки (oda-mailbox) — для перезагрузки по changed. */
    _mailboxRegistry() {
        return this._mailboxes ??= new Set();
    },
    attached() {
        this.loadSettings();
        this._onChanged ??= () => this.debounce('email-reload', () => this.reload(), 150);
        this._watch();
    },
    detached() {
        for (const src of this._watched || [])
            src?.unlisten?.('changed', this._onChanged);
        this._watched = null;
    },
    async _watch() {
        if (this._watched || !this.$item)
            return;
        this._watched = [this.$item];
        try {
            const history = await this.$item.get_item('/~/logs');
            if (history)
                this._watched.push(history);
        }
        catch { /* нет логов */ }
        for (const src of this._watched)
            src?.listen?.('changed', this._onChanged);
    },
    async loadSettings() {
        try {
            this._settings = await this.$item?.fetch('read_secret', { filename: 'email.json' });
        }
        catch {
            this._settings = null;
        }
        this.accounts = accountAddresses(this._settings?.mailboxes);
        return this._settings;
    },
    /** Даты с логами, по убыванию. Общие для всех колонок. */
    loadDates() {
        return this._datesPromise ??= Promise.resolve(this.$item?.logs({ mode: 'dates' }))
            .then(list => (Array.isArray(list) ? list : [])
                .map(String)
                .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
                .sort((a, b) => b.localeCompare(a)))
            .catch(() => []);
    },
    /** Письма дня (все ящики), одна загрузка на форму; исходящие — последняя версия по uid. */
    dayMessages(day) {
        const cache = this._dayCache ??= new Map();
        if (!cache.has(day)) {



            cache.set(day, (async () => {
                const rows = await this.$item.logs({ mode: 'bodies', day, ext: 'eml' });
                const seen = new Set();
                const list = [];
                // rows — по убыванию time: первая строка uid — актуальная версия
                for (const row of rows || []) {
                    const msg = await rowToMessage(row);
                    if (!msg)
                        continue;
                    const key = msg.uid ? 'uid:' + msg.uid : 'path:' + msg.path;
                    if (seen.has(key))
                        continue;
                    seen.add(key);
                    list.push(msg);
                }
                list.sort((a, b) => (b.sortTime || 0) - (a.sortTime || 0));
                return list;
            })().catch(e => {
                console.warn('[email] day', day, e);
                cache.delete(day);
                return [];
            }));
        }
        return cache.get(day);
    },
    reload() {
        this._datesPromise = null;
        this._dayCache?.clear();
        for (const mb of this._mailboxRegistry())
            mb.reload();
    },
    async fetchRefresh() {
        try {
            await this.$pdp.$handler.fetch('refresh');
        }
        catch (e) {
            ODA.showMessage(e.message || String(e));
        }
        await this.loadSettings();
        this.reload();
    },
    async selectMessage(msg) {
        this.selected = msg;
        this.mode = 'view';
        if (msg.body != null)
            return;
        try {
            const res = await fetch(msg.path);
            const json = parseJson(await res.text()) || {};
            this.selected = {
                ...msg,
                body: json.body || '',
                html: json.html || '',
                messageId: msg.messageId || json.messageId || '',
                error: msg.error || json.error || '',
            };
        }
        catch (e) {
            console.error(e);
            ODA.showMessage(e.message);
            this.selected = { ...msg, body: e.message, html: '' };
        }
    },
    async createEmail(draft = {}) {
        if (!this.accounts.length)
            await this.loadSettings();
        if (!this.accounts.length) {
            ODA.showMessage(NO_MAILBOX);
            return;
        }
        this.draft = { ...EMPTY_DRAFT(), from: this.accounts[0], ...draft };
        this.selected = null;
        this.mode = 'compose';
    },
    async reply() {
        const msg = this.selected;
        if (!msg)
            return;
        if (msg.body == null)
            await this.selectMessage(msg);
        const src = this.selected;
        const subject = /^re:/i.test(src.subject || '') ? src.subject : 'Re: ' + (src.subject || '');
        const to = src.box === 'outbox' ? src.to : src.from;
        const from = this.accounts.includes(src.address) ? src.address : undefined;
        await this.createEmail({
            to,
            subject,
            body: quoteBody(src),
            inReplyTo: src.messageId || '',
            ...(from ? { from } : {}),
        });
    },
    setFrom(address) {
        this.draft.from = address;
    },
    async sendDraft() {
        const address = this.draft.from || this.accounts[0];
        if (!address) {
            ODA.showMessage(NO_MAILBOX);
            return;
        }
        let to;
        try {
            to = validateRecipients(this.draft.to);
        }
        catch (e) {
            ODA.showMessage(e.message);
            return;
        }
        const settings = this._settings || await this.loadSettings();
        const box = settings?.mailboxes?.[address];
        const eml = defaultEmlJson({
            uid: newUid(),
            from: box?.auth?.user || address,
            to,
            subject: this.draft.subject,
            body: this.draft.body,
            address,
            inReplyTo: this.draft.inReplyTo,
            status: 'pending',
        });
        try {
            await this.$item.save_file(new File([JSON.stringify(eml)], 'outbound.eml', { type: 'application/json' }), {
                encoding: 'utf-8',
                folder: address,
                message: JSON.stringify(emlMeta(eml)),
            });
            this.mode = 'idle';
            this.draft = EMPTY_DRAFT();
            this.reload();
        }
        catch (e) {
            ODA.showMessage(e.message);
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
                border-bottom: 1px solid var(--subtle-border);
            }
            .box-title {
                @apply --header;
                padding: var(--space-m) 12px;
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
                @apply --muted;
                font-size: small;
            }
        </style>
        <div class="box-title">{{box?.label || box?.id}}</div>
        <div class="days" vertical flex>
            <email-day ~for="dates" :day="$for.item" :box-id="box?.id" :first="$for.index === 0"></email-day>
            <div ~if="!dates.length" class="empty">Нет писем</div>
        </div>
    `,
    box: null,
    dates: [],
    // имена реестров разные: $pdp сначала ищет свойство на самом узле
    _dayRegistry() {
        return this._days ??= new Set();
    },
    attached() {
        this.$pdp?._mailboxRegistry?.().add(this);
        this.reload();
    },
    detached() {
        this.$pdp?._mailboxRegistry?.().delete(this);
    },
    async reload() {
        this.dates = await this.$pdp.loadDates();
        for (const day of this._dayRegistry())
            day.reload();
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
            :host([hidden-day]) {
                display: none;
            }
            .day-header {
                cursor: pointer;
                padding: 6px 10px;
                align-items: center;
                gap: var(--space-s);
                font-size: small;
            }
            /* раскрытый день — цвета плашки --accent-invert, приглушаем только свёрнутые */
            .day-header:not([accent-invert]) {
                @apply --muted;
            }
            .msg-list {
                gap: 2px;
                padding: 0 var(--space-s) 6px;
            }
            .msg-item {
                display: grid;
                grid-template-columns: 1fr auto;
                grid-template-rows: auto auto;
                gap: 2px var(--space-m);
                padding: var(--space-m) 10px;
                cursor: pointer;
                border-radius: var(--radius-s);
                margin: 0 2px;
            }
            .msg-item:not([info-invert]):hover {
                @apply --hover;
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
                @apply --muted;
                white-space: nowrap;
                justify-self: end;
            }
            .msg-from, .msg-to {
                font-size: x-small;
                @apply --muted;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                min-width: 0;
            }
            .msg-to {
                justify-self: end;
                text-align: right;
            }
            /* на инвертированной плашке приглушённый цвет темы нечитаем — следуем цвету плашки */
            [info-invert] .msg-date,
            [info-invert] .msg-from,
            [info-invert] .msg-to {
                color: inherit;
                fill: inherit;
                opacity: .75;
            }
            .empty {
                padding: var(--space-s) 12px var(--space-m);
                @apply --muted;
                font-size: x-small;
            }
        </style>
        <div class="day-header" horizontal :accent-invert="expanded" @tap="expanded = !expanded">
            <span flex>{{label}}</span>
            <oda-button icon-size="16" :icon="expanderIcon"></oda-button>
        </div>
        <div class="msg-list" vertical ~if="expanded">
            <div ~for="messages" class="msg-item"
                :info-invert="selectedPath === $for.item.path"
                @tap="$pdp.selectMessage($for.item)">
                <div class="msg-subject">{{$for.item.subject}}</div>
                <div class="msg-date">{{$for.item.status === 'failed' ? 'ошибка' : $for.item.dateLabel}}</div>
                <div class="msg-from">От: {{$for.item.from}}</div>
                <div class="msg-to">Кому: {{$for.item.to}}</div>
            </div>
            <div ~if="loaded && !messages.length" class="empty">Нет писем</div>
        </div>
    `,
    day: '',
    boxId: '',
    messages: [],
    loaded: false,
    first: {
        $def: false,
        set(n) {
            if (n)
                this.expanded = true;
        }
    },
    expanded: {
        $def: false,
        $attr: true,
        set(n) {
            if (n)
                this.reload();
        },
    },
    get selectedPath() {
        return this.$pdp?.selected?.path || '';
    },
    get expanderIcon() {
        return this.expanded ? 'icons:chevron-right:90' : 'icons:chevron-right';
    },
    get label() {
        const date = new Date(this.day + 'T12:00:00');
        if (Number.isNaN(date.getTime()))
            return this.day;
        return date.toLocaleDateString('ru-RU', {
            weekday: 'short',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });
    },
    attached() {
        this.$pdp?._dayRegistry?.().add(this);
        if (this.expanded)
            this.reload();
    },
    detached() {
        this.$pdp?._dayRegistry?.().delete(this);
    },
    async reload() {
        if (!this.expanded || !this.day || !this.boxId)
            return;
        const day = this.day, boxId = this.boxId;
        const list = await this.$pdp.dayMessages(day);
        if (day !== this.day || boxId !== this.boxId)
            return;
        this.messages = list.filter(m => m.box === boxId);
        this.loaded = true;
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
                padding: 12px var(--space-l);
                gap: var(--space-m);
            }
            fieldset {
                border: 1px solid var(--subtle-border);
                border-radius: var(--radius-s);
                padding: var(--space-s) var(--space-m);
                margin: 0;
            }
            legend {
                font-size: x-small;
                padding: 0 var(--space-s);
            }
            input, textarea, select {
                border: none;
                outline: none;
                background: transparent;
                color: inherit;
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
                @apply --muted;
                padding: 24px;
            }
            .msg-meta {
                font-size: small;
                @apply --muted;
            }
            .msg-error {
                font-size: small;
                color: var(--error-color);
            }
            .toolbar {
                gap: var(--space-m);
                align-items: center;
                justify-content: flex-end;
            }
            .view-body {
                white-space: pre-wrap;
                overflow: auto;
                padding: var(--space-m) 0;
            }
            .view-html {
                border: 1px solid var(--subtle-border);
                border-radius: var(--radius-s);
                box-sizing: border-box;
                width: 100%;
                /* намеренно белый в обеих темах: чужая вёрстка писем рассчитана на светлый фон */
                background: white;
            }
        </style>
        <div ~if="mode === 'idle'" class="idle" flex>Выберите письмо</div>
        <div ~if="mode === 'compose'" vertical flex style="gap: 8px;">
            <fieldset>
                <legend>От</legend>
                <select @change="(e) => $pdp.setFrom(e.target.value)">
                    <option ~for="accounts" :value="$for.item" :selected="$for.item === draft.from">{{$for.item}}</option>
                </select>
            </fieldset>
            <fieldset>
                <legend>Кому</legend>
                <input placeholder="recipient@example.com" ::value="draft.to">
            </fieldset>
            <fieldset>
                <legend>Тема</legend>
                <input placeholder="Тема письма" ::value="draft.subject">
            </fieldset>
            <fieldset flex vertical>
                <legend>Текст</legend>
                <textarea ::value="draft.body" flex></textarea>
            </fieldset>
            <div class="toolbar" horizontal>
                <oda-button icon="icons:send" @tap="$pdp.sendDraft()" title="Отправить">Отправить</oda-button>
            </div>
        </div>
        <div ~if="mode === 'view' && selected" vertical flex style="gap: 4px;">
            <div horizontal class="toolbar">
                <strong flex>{{selected.subject}}</strong>
                <oda-button icon="icons:reply" @tap="$pdp.reply()" title="Ответить">Ответить</oda-button>
            </div>
            <span class="msg-meta">От: {{selected.from}}</span>
            <span class="msg-meta">Кому: {{selected.to}}</span>
            <span ~if="selected.status" class="msg-meta">Статус: {{statusLabel}}</span>
            <span ~if="selected.error" class="msg-error">{{selected.error}}</span>
            <iframe ~if="selected.html" class="view-html" flex sandbox="allow-popups allow-popups-to-escape-sandbox" :srcdoc="htmlDoc"></iframe>
            <div class="view-body" flex ~if="!selected.html">{{selected.body ?? 'Загрузка…'}}</div>
        </div>
    `,
    // selected / draft / accounts — у формы (через $pdp); свои одноимённые свойства перекрыли бы их
    mode: 'idle',
    get statusLabel() {
        const s = this.$pdp.selected?.status || '';
        return { pending: 'отправляется', sent: 'отправлено', failed: 'ошибка отправки' }[s] || s;
    },
    get htmlDoc() {
        return htmlDocument(this.$pdp.selected?.html);
    },
});
