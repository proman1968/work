const EMPTY_DRAFT = () => ({ uid: '', origTime: 0, from: '', to: '', cc: '', subject: '', body: '', inReplyTo: '', attachments: [] });

function parseJson(value) {
    if (value && typeof value === 'object') return value;
    if (typeof value !== 'string' || !value) return null;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : null;
    }
    catch {
        return null;
    }
}

function formatMailShortDate(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    const now = new Date();
    const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    if (sameDay)
        return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

function formatMailFullDate(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleString('ru-RU', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
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
    return `\n\n${formatMailFullDate(msg.date)}, ${msg.from || ''} пишет:\n${quoted}`;
}

function htmlDocument(html) {
    return '<!doctype html><html><head><meta charset="utf-8"><base target="_blank">'
        + '<style>body{margin:0;padding:8px;font-family:sans-serif;font-size:13.5px;line-height:1.45;word-wrap:break-word;}img{max-width:100%;height:auto;}</style>'
        + '</head><body>' + String(html || '') + '</body></html>';
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
        if (!address) continue;
        const prev = previousMailboxes?.[address] || {};
        mailboxes[address] = {
            ...prev,
            smtp: { host: acc.smtp?.host || '', port: Number(acc.smtp?.port) || 465, secure: acc.smtp?.secure !== false },
            imap: { host: acc.imap?.host || '', port: Number(acc.imap?.port) || 993, secure: acc.imap?.secure !== false },
            auth: { user: address, pass: acc.auth?.pass || '' },
        };
    }
    return mailboxes;
}

async function openEmailSettingsDialog($context) {
    if (openEmailSettingsDialog.opening || !$context) return null;
    openEmailSettingsDialog.opening = true;
    let el, settings;
    try {
        settings = await $context.fetch('read_secret', { filename: 'email.json' });
        el = ODA.createElement('oda-email-settings', {
            accounts: mailboxesToAccounts(settings?.mailboxes),
        });
        if (!el.accounts.length) el.addAccount();
        else el.index = 0;
    }
    catch (e) {
        ODA.showMessage?.(e.message || String(e));
        return null;
    }
    finally {
        openEmailSettingsDialog.opening = false;
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
        await $context.fetch('save_secret', { filename: 'email.json' }, JSON.stringify({ mailboxes }));
        return mailboxes;
    }
    catch (e) {
        ODA.showMessage?.(e.message || String(e));
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
            .account-item:not([info-invert]):hover { @apply --hover; }
            .account-title {
                font-weight: 500;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .account-sub { font-size: x-small; @apply --muted; }
            [info-invert] .account-sub { color: inherit; fill: inherit; opacity: .75; }
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
            legend { font-size: x-small; padding: 0 var(--space-s); }
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
            .row { gap: 12px; align-items: center; }
            .port { max-width: 72px; }
            .empty { padding: var(--space-l); @apply --muted; }
        </style>
        <div class="accounts" vertical>
            <div class="accounts-toolbar" horizontal>
                <span flex>Ящики</span>
                <oda-button icon="icons:add" @tap="addAccount" title="Добавить ящик"></oda-button>
                <oda-button icon="icons:delete" :disabled="!current" @tap="removeAccount" title="Удалить ящик"></oda-button>
            </div>
            <div class="account-item" ~for="accounts"
                :info-invert="index === $for.index"
                @tap="index = $for.index">
                <div class="account-title">{{$for.item.auth.user || 'Новый ящик'}}</div>
                <div class="account-sub">{{$for.item.smtp.host || 'SMTP не задан'}}</div>
            </div>
            <div ~if="!accounts.length" class="empty">Нажмите «+» чтобы добавить ящик</div>
        </div>
        <div class="editor" vertical flex ~if="current">
            <fieldset>
                <legend>Учётная запись</legend>
                <input placeholder="user@example.com" ::value="current.auth.user">
                <input type="password" placeholder="Пароль или пароль приложения" ::value="current.auth.pass">
            </fieldset>
            <fieldset>
                <legend>Исходящая почта (SMTP)</legend>
                <div class="row" horizontal>
                    <input flex placeholder="smtp.yandex.ru" ::value="current.smtp.host">
                    <input class="port" type="number" placeholder="465" ::value="current.smtp.port">
                    <oda-checkbox ::value="current.smtp.secure"></oda-checkbox><span>TLS</span>
                </div>
            </fieldset>
            <fieldset>
                <legend>Входящая почта (IMAP)</legend>
                <div class="row" horizontal>
                    <input flex placeholder="imap.yandex.ru" ::value="current.imap.host">
                    <input class="port" type="number" placeholder="993" ::value="current.imap.port">
                    <oda-checkbox ::value="current.imap.secure"></oda-checkbox><span>TLS</span>
                </div>
            </fieldset>
        </div>
        <div ~if="!current" class="empty" flex>Выберите или добавьте ящик</div>
    `,
    accounts: [],
    index: -1,
    get current() { return this.accounts[this.index] ?? null; },
    addAccount() {
        this.accounts = [...this.accounts, {
            address: '',
            smtp: { host: '', port: 465, secure: true },
            imap: { host: '', port: 993, secure: true },
            auth: { user: '', pass: '' },
        }];
        this.index = this.accounts.length - 1;
    },
    removeAccount() {
        if (this.index < 0) return;
        const next = [...this.accounts];
        next.splice(this.index, 1);
        this.accounts = next;
        this.index = next.length ? Math.min(this.index, next.length - 1) : -1;
    },
    validate() {
        const seen = new Set();
        for (const acc of this.accounts) {
            const addr = String(acc.auth?.user || '').trim();
            if (!addr) throw new Error('Укажите адрес (логин) для каждого ящика');
            if (seen.has(addr)) throw new Error('Повторяющийся ящик: ' + addr);
            seen.add(addr);
        }
    },
});

export default {
    icon: 'enterprise:email',
    imports: 'oda//button, oda//icon',
    template: /* html */`
        <style>
            :host {
                @apply --horizontal;
                @apply --flex;
                overflow: hidden;
                background: var(--content-background, #ffffff);
                color: var(--content-color, #1e293b);
                font-size: 13px;
            }
            .mail-sidebar {
                @apply --vertical;
                width: 212px;
                flex-shrink: 0;
                padding: 12px 10px;
                gap: 6px;
                border-right: 1px solid var(--subtle-border, #e2e8f0);
                background: var(--subtle-background, #f8fafc);
                overflow-y: auto;
            }
            .compose-btn {
                @apply --horizontal;
                align-items: center;
                justify-content: center;
                gap: 7px;
                padding: 9px 14px;
                border-radius: 9px;
                border: none;
                background: var(--accent-color, #2563eb);
                color: var(--accent-back, #ffffff);
                font: inherit;
                font-size: 13.5px;
                font-weight: 600;
                cursor: pointer;
                margin-bottom: 6px;
                box-shadow: 0 2px 6px rgba(37, 99, 235, 0.22);
            }
            .compose-btn:hover { filter: brightness(1.06); }
            .nav-btn {
                @apply --horizontal;
                align-items: center;
                gap: 9px;
                width: 100%;
                padding: 8px 11px;
                border-radius: 8px;
                border: 1px solid transparent;
                background: transparent;
                color: inherit;
                font: inherit;
                font-size: 13.5px;
                font-weight: 500;
                text-align: left;
                cursor: pointer;
                user-select: none;
            }
            .nav-btn:hover {
                background: color-mix(in srgb, var(--accent-color, #2563eb) 6%, transparent);
            }
            .nav-btn.active {
                background: color-mix(in srgb, var(--accent-color, #2563eb) 10%, var(--content-background, #ffffff));
                border-color: color-mix(in srgb, var(--accent-color, #2563eb) 50%, transparent);
                color: var(--accent-color, #2563eb);
                font-weight: 600;
            }
            .nav-badge {
                margin-left: auto;
                padding: 1px 7px;
                border-radius: 999px;
                font-size: 11px;
                font-weight: 700;
                background: var(--accent-color, #2563eb);
                color: #ffffff;
            }
            .nav-count {
                margin-left: auto;
                font-size: 11.5px;
                color: var(--muted-color, #64748b);
            }
            .side-sep {
                height: 1px;
                margin: 4px 6px;
                background: var(--subtle-border, #e2e8f0);
            }
            .side-label {
                padding: 2px 10px;
                font-size: 11px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.04em;
                color: var(--muted-color, #64748b);
            }
            .acc-pill {
                font-size: 12.5px;
                padding: 6px 10px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .mail-list-pane {
                @apply --vertical;
                width: 335px;
                min-width: 260px;
                flex-shrink: 0;
                border-right: 1px solid var(--subtle-border, #e2e8f0);
                background: var(--content-background, #ffffff);
                overflow: hidden;
            }
            .list-toolbar {
                @apply --horizontal;
                align-items: center;
                gap: 6px;
                padding: 10px 10px 8px;
                border-bottom: 1px solid var(--subtle-border, #e2e8f0);
                background: var(--content-background, #ffffff);
            }
            .search-input {
                @apply --flex;
                min-width: 0;
                padding: 6px 10px;
                border-radius: 7px;
                border: 1px solid var(--subtle-border, #cbd5e1);
                background: var(--subtle-background, #f8fafc);
                color: inherit;
                font: inherit;
                font-size: 12.5px;
                outline: none;
            }
            .search-input:focus {
                border-color: var(--accent-color, #2563eb);
                background: var(--content-background, #ffffff);
            }
            .icon-btn {
                @apply --horizontal;
                align-items: center;
                justify-content: center;
                padding: 6px 8px;
                border-radius: 7px;
                border: 1px solid var(--subtle-border, #cbd5e1);
                background: var(--content-background, #ffffff);
                color: inherit;
                cursor: pointer;
                font-size: 12px;
            }
            .icon-btn:hover { background: var(--accent-soft); }
            .icon-btn.active {
                border-color: var(--accent-color, #2563eb);
                color: var(--accent-color, #2563eb);
                background: color-mix(in srgb, var(--accent-color, #2563eb) 10%, var(--content-background, #ffffff));
                font-weight: 600;
            }
            .msg-scroll {
                @apply --vertical;
                @apply --flex;
                overflow-y: auto;
            }
            .msg-row {
                display: flex;
                flex-direction: column;
                gap: 3px;
                padding: 10px 12px;
                border-bottom: 1px solid var(--subtle-border, #f1f5f9);
                cursor: pointer;
                position: relative;
                transition: background 0.1s ease;
            }
            .msg-row:hover {
                background: var(--subtle-background, #f8fafc);
            }
            .msg-row.selected {
                background: color-mix(in srgb, var(--accent-color, #2563eb) 10%, var(--content-background, #ffffff));
                border-left: 3px solid var(--accent-color, #2563eb);
                padding-left: 9px;
            }
            .msg-row.unread .msg-peer,
            .msg-row.unread .msg-subj {
                font-weight: 700;
            }
            .msg-top {
                display: flex;
                align-items: center;
                gap: 6px;
                min-width: 0;
            }
            .unread-dot {
                width: 7px;
                height: 7px;
                border-radius: 50%;
                background: var(--accent-color, #2563eb);
                flex-shrink: 0;
            }
            .msg-peer {
                flex: 1;
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                font-size: 13px;
                font-weight: 500;
            }
            .msg-time {
                font-size: 11px;
                color: var(--muted-color, #64748b);
                white-space: nowrap;
            }
            .msg-subj {
                font-size: 12.5px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                display: flex;
                align-items: center;
                gap: 5px;
            }
            .msg-snip {
                font-size: 11.5px;
                color: var(--muted-color, #64748b);
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .status-tag {
                font-size: 10.5px;
                padding: 1px 6px;
                border-radius: 999px;
                background: var(--subtle-background, #f1f5f9);
                color: var(--muted-color, #64748b);
            }
            .status-tag.err { background: #fef2f2; color: #dc2626; }
            .status-tag.draft { background: #fffbeb; color: #b45309; }
            .mail-view-pane {
                @apply --vertical;
                @apply --flex;
                min-width: 0;
                overflow: hidden;
                background: var(--content-background, #ffffff);
            }
            .empty-pane {
                @apply --vertical;
                @apply --flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                color: var(--muted-color, #64748b);
                padding: 24px;
                text-align: center;
            }
            .view-actions {
                @apply --horizontal;
                align-items: center;
                gap: 6px;
                padding: 10px 16px;
                border-bottom: 1px solid var(--subtle-border, #e2e8f0);
                background: var(--subtle-background, #f8fafc);
                flex-wrap: wrap;
            }
            .view-head {
                @apply --vertical;
                gap: 4px;
                padding: 14px 18px 10px;
                border-bottom: 1px solid var(--subtle-border, #e2e8f0);
            }
            .view-subject {
                font-size: 17px;
                font-weight: 700;
            }
            .view-meta {
                font-size: 12.5px;
                color: var(--muted-color, #475569);
            }
            .att-bar {
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
                padding: 8px 18px;
                border-bottom: 1px solid var(--subtle-border, #e2e8f0);
                background: var(--subtle-background, #f8fafc);
            }
            .att-chip {
                @apply --horizontal;
                align-items: center;
                gap: 5px;
                padding: 4px 10px;
                border-radius: 6px;
                border: 1px solid var(--subtle-border, #cbd5e1);
                background: var(--content-background, #ffffff);
                font-size: 12px;
                cursor: pointer;
            }
            .view-body {
                @apply --flex;
                overflow: auto;
                padding: 16px 18px;
                white-space: pre-wrap;
                line-height: 1.5;
                user-select: text;
            }
            .view-iframe {
                @apply --flex;
                width: 100%;
                border: none;
                background: #ffffff;
            }
            .compose-wrap {
                @apply --vertical;
                @apply --flex;
                padding: 14px 18px;
                gap: 10px;
                overflow-y: auto;
            }
            .compose-field {
                display: flex;
                align-items: center;
                gap: 8px;
                border-bottom: 1px solid var(--subtle-border, #e2e8f0);
                padding: 4px 0;
            }
            .compose-field label {
                width: 68px;
                font-size: 12.5px;
                color: var(--muted-color, #64748b);
                flex-shrink: 0;
            }
            .compose-field input,
            .compose-field select {
                flex: 1;
                border: none;
                outline: none;
                background: transparent;
                color: inherit;
                font: inherit;
                padding: 4px 0;
            }
            .compose-body {
                @apply --flex;
                min-height: 180px;
                border: 1px solid var(--subtle-border, #e2e8f0);
                border-radius: 8px;
                padding: 10px 12px;
                outline: none;
                background: var(--content-background, #ffffff);
                color: inherit;
                font: inherit;
                line-height: 1.5;
                resize: none;
            }
            .compose-footer {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                padding-top: 4px;
            }
        </style>

        <aside class="mail-sidebar">
            <button type="button" class="compose-btn" @tap="createEmail()">
                <oda-icon icon="icons:add" icon-size="16"></oda-icon>
                <span>Написать</span>
            </button>

            <button type="button" class="nav-btn" ~for="folders"
                ~class="{ active: activeBox === $for.item.id }"
                @tap="selectBox($for.item.id)">
                <oda-icon :icon="$for.item.icon" icon-size="16"></oda-icon>
                <span>{{$for.item.label}}</span>
                <span ~if="badgeOf($for.item.id) > 0" class="nav-badge">{{badgeOf($for.item.id)}}</span>
                <span ~if="badgeOf($for.item.id) === 0 && countOf($for.item.id) > 0" class="nav-count">{{countOf($for.item.id)}}</span>
            </button>

            <div class="side-sep" ~if="accounts.length"></div>
            <div class="side-label" ~if="accounts.length">Ящики</div>
            <button type="button" class="nav-btn acc-pill" ~if="accounts.length > 1"
                ~class="{ active: !selectedAccount }"
                @tap="selectAccount('')">Все ящики</button>
            <button type="button" class="nav-btn acc-pill" ~for="accounts"
                ~class="{ active: selectedAccount === $for.item.address }"
                @tap="selectAccount($for.item.address)"
                :title="$for.item.address">
                <span>{{$for.item.address}}</span>
            </button>

            <div style="flex: 1;"></div>
            <div class="side-sep" ~if="canConfigure"></div>
            <label ~if="canConfigure && accounts.length" style="display:flex;align-items:center;gap:6px;padding:4px 8px;font-size:12px;cursor:pointer;">
                <input type="checkbox" :checked="autoRefresh" @change="toggleAutoRefresh($event.target.checked)">
                <span>Автопроверка почты</span>
            </label>
            <button type="button" class="nav-btn" ~if="canConfigure" @tap="openSettings()">
                <oda-icon icon="icons:settings" icon-size="16"></oda-icon>
                <span>Настройка ящиков</span>
            </button>
        </aside>

        <section class="mail-list-pane">
            <div class="list-toolbar">
                <input class="search-input" type="search" placeholder="Поиск писем…" :value="searchQuery" @input="onSearchInput($event)">
                <button type="button" class="icon-btn" ~class="{ active: unreadOnly }" @tap="toggleUnreadOnly()" title="Только непрочитанные">●</button>
                <button type="button" class="icon-btn" @tap="fetchRefresh()" :disabled="refreshing" title="Проверить почту с сервера">
                    <oda-icon :icon="refreshing ? 'spinners:8-dots-rotate' : 'icons:refresh'" icon-size="15"></oda-icon>
                </button>
            </div>

            <div class="msg-scroll">
                <div ~if="loading && !messages.length" class="empty-pane">Загрузка писем…</div>
                <div ~if="!loading && !messages.length" class="empty-pane">
                    <span>В папке «{{activeBoxLabel}}» писем нет</span>
                </div>
                <div ~for="messages" class="msg-row"
                    ~class="{ selected: selected?.path === $for.item.path, unread: !$for.item.read }"
                    @tap="selectMessage($for.item)">
                    <div class="msg-top">
                        <span ~if="!$for.item.read" class="unread-dot"></span>
                        <span class="msg-peer">{{peerLabel($for.item)}}</span>
                        <span class="msg-time">{{shortDate($for.item.date || $for.item.sortTime)}}</span>
                    </div>
                    <div class="msg-subj">
                        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{$for.item.subject || '(без темы)'}}</span>
                        <oda-icon ~if="$for.item.attachmentsCount > 0" icon="editor:attach-file" icon-size="13"></oda-icon>
                        <span ~if="$for.item.status === 'failed'" class="status-tag err">ошибка</span>
                        <span ~if="$for.item.status === 'draft'" class="status-tag draft">черновик</span>
                    </div>
                    <div ~if="$for.item.snippet" class="msg-snip">{{$for.item.snippet}}</div>
                </div>
            </div>
        </section>

        <main class="mail-view-pane">
            <div ~if="mode === 'idle'" class="empty-pane">
                <oda-icon icon="enterprise:email" icon-size="40" style="opacity:0.35;"></oda-icon>
                <div style="font-size:14px;font-weight:600;">Выберите письмо для просмотра</div>
                <div ~if="!accounts.length && canConfigure" style="font-size:12.5px;">
                    Почтовый ящик для этого узла ещё не настроен.
                    <div style="margin-top:8px;">
                        <button type="button" class="compose-btn" @tap="openSettings()">Подключить ящик</button>
                    </div>
                </div>
            </div>

            <div ~if="mode === 'view' && selected" style="display:flex;flex-direction:column;flex:1;min-height:0;">
                <div class="view-actions">
                    <oda-button ~if="selected.box === 'drafts'" icon="editor:mode-edit" info-invert @tap="editDraft(selected)">Продолжить черновик</oda-button>
                    <oda-button ~if="selected.box !== 'drafts'" icon="icons:reply" @tap="reply(false)">Ответить</oda-button>
                    <oda-button ~if="selected.box !== 'drafts' && (selected.cc || (selected.to || '').includes(','))" icon="icons:reply-all" @tap="reply(true)">Ответить всем</oda-button>
                    <oda-button icon="icons:forward" @tap="forward()">Переслать</oda-button>
                    <oda-button ~if="selected.box === 'inbox'" :icon="selected.read ? 'icons:markunread' : 'icons:drafts'" @tap="toggleRead(selected)">
                        {{selected.read ? 'Непрочитано' : 'Прочитано'}}
                    </oda-button>
                    <div style="flex:1;"></div>
                    <oda-button ~if="selected.box !== 'trash'" icon="icons:delete" @tap="moveToTrash(selected)">В корзину</oda-button>
                    <oda-button ~if="selected.box === 'trash'" icon="icons:restore" @tap="restoreFromTrash(selected)">Восстановить</oda-button>
                    <oda-button ~if="selected.box === 'trash'" icon="icons:delete-forever" error @tap="deleteForever(selected)">Удалить навсегда</oda-button>
                </div>

                <div class="view-head">
                    <div class="view-subject">{{selected.subject || '(без темы)'}}</div>
                    <div class="view-meta"><b>От:</b> {{selected.from || '—'}} · <b>Дата:</b> {{fullDate(selected.date)}}</div>
                    <div class="view-meta"><b>Кому:</b> {{selected.to || '—'}} <span ~if="selected.cc">· <b>Копия:</b> {{selected.cc}}</span></div>
                    <div ~if="selected.error" style="font-size:12.5px;color:#dc2626;font-weight:600;">Ошибка доставки: {{selected.error}}</div>
                </div>

                <div ~if="selected.attachments?.length" class="att-bar">
                    <div ~for="selected.attachments" class="att-chip" @tap="openAttachment($for.item)">
                        <oda-icon icon="editor:attach-file" icon-size="14"></oda-icon>
                        <span>{{$for.item.name || 'Вложение'}}</span>
                    </div>
                </div>

                <iframe ~if="selected.html" class="view-iframe" sandbox="allow-popups allow-popups-to-escape-sandbox" :srcdoc="htmlDoc"></iframe>
                <div ~if="!selected.html" class="view-body">{{selected.body || ''}}</div>
            </div>

            <div ~if="mode === 'compose'" class="compose-wrap">
                <div style="display:flex;align-items:center;justify-content:space-between;">
                    <span style="font-size:15px;font-weight:700;">{{draft.uid ? 'Редактирование черновика' : 'Новое письмо'}}</span>
                </div>

                <div class="compose-field">
                    <label>От:</label>
                    <select @change="draft.from = $event.target.value">
                        <option ~for="accounts" :value="$for.item.address" :selected="$for.item.address === draft.from">{{$for.item.address}}</option>
                    </select>
                </div>
                <div class="compose-field">
                    <label>Кому:</label>
                    <input placeholder="recipient@example.com" :value="draft.to" @input="draft.to = $event.target.value">
                </div>
                <div class="compose-field">
                    <label>Копия:</label>
                    <input placeholder="cc@example.com (необязательно)" :value="draft.cc" @input="draft.cc = $event.target.value">
                </div>
                <div class="compose-field">
                    <label>Тема:</label>
                    <input placeholder="Тема письма" :value="draft.subject" @input="draft.subject = $event.target.value">
                </div>

                <div class="att-bar" style="padding:6px 0;border:none;background:transparent;" ~if="draft.attachments?.length">
                    <div ~for="draft.attachments" class="att-chip">
                        <oda-icon icon="editor:attach-file" icon-size="14"></oda-icon>
                        <span>{{$for.item.name}}</span>
                        <oda-icon icon="icons:close" icon-size="13" style="cursor:pointer;" @tap.stop="removeDraftAttachment($for.index)"></oda-icon>
                    </div>
                </div>

                <textarea class="compose-body" placeholder="Текст письма…" :value="draft.body" @input="draft.body = $event.target.value"></textarea>

                <div class="compose-footer">
                    <oda-button icon="icons:send" info-invert @tap="sendDraft()">Отправить</oda-button>
                    <oda-button icon="icons:save" @tap="saveDraft()">Сохранить черновик</oda-button>
                    <label class="icon-btn" style="cursor:pointer;">
                        <oda-icon icon="editor:attach-file" icon-size="15"></oda-icon>
                        <span>Прикрепить</span>
                        <input type="file" multiple hidden @change="onAttachFiles($event)">
                    </label>
                    <div style="flex:1;"></div>
                    <oda-button icon="icons:close" @tap="mode = selected ? 'view' : 'idle'">Отмена</oda-button>
                </div>
            </div>
        </main>
    `,
    $item: {
        $def: null,
        set(n, o) {
            if (o && this._onChanged)
                o.unlisten?.('changed', this._onChanged);
            if (n) {
                this._onChanged ??= () => this.debounce('mail-reload', () => this.reload(), 200);
                n.listen?.('changed', this._onChanged);
                this.initLoad();
            }
        }
    },
    folders: [
        { id: 'inbox', label: 'Входящие', icon: 'icons:inbox' },
        { id: 'drafts', label: 'Черновики', icon: 'editor:insert-drive-file' },
        { id: 'outbox', label: 'Исходящие', icon: 'iconoir:send-mail' },
        { id: 'trash', label: 'Корзина', icon: 'icons:delete' },
    ],
    activeBox: 'inbox',
    selectedAccount: '',
    searchQuery: '',
    unreadOnly: false,
    loading: false,
    refreshing: false,
    accounts: [],
    canConfigure: false,
    autoRefresh: true,
    messages: [],
    countsByBox: { inbox: 0, drafts: 0, outbox: 0, trash: 0 },
    unreadByBox: { inbox: 0, drafts: 0, outbox: 0, trash: 0 },
    selected: null,
    mode: 'idle',
    draft: EMPTY_DRAFT(),
    get activeBoxLabel() {
        return this.folders.find(f => f.id === this.activeBox)?.label || 'Входящие';
    },
    get htmlDoc() {
        return htmlDocument(this.selected?.html);
    },
    attached() {
        if (this.$item && this._loadedFor !== this.$item)
            this.initLoad();
    },
    detached() {
        this.$item?.unlisten?.('changed', this._onChanged);
    },
    async initLoad() {
        const cur = this.$item;
        if (!cur) return;
        this._loadedFor = cur;
        this.selected = null;
        this.mode = 'idle';
        await this.loadAccounts();
        await this.reload();
    },
    async loadAccounts() {
        if (!this.$item?.fetch) return;
        try {
            const res = await this.$item.fetch('mail_accounts');
            this.accounts = Array.isArray(res?.accounts) ? res.accounts : [];
            this.canConfigure = Boolean(res?.canConfigure);
            this.autoRefresh = res?.autoRefresh !== false;
        }
        catch {
            this.accounts = [];
            this.canConfigure = false;
        }
    },
    async reload() {
        if (!this.$item?.fetch) return;
        this.loading = true;
        try {
            const res = await this.$item.fetch('mail_list', {}, JSON.stringify({
                box: this.activeBox,
                address: this.selectedAccount,
                q: this.searchQuery,
                unreadOnly: this.unreadOnly,
                limit: 200,
            }));
            this.messages = Array.isArray(res?.messages) ? res.messages : [];
            if (res?.countsByBox) this.countsByBox = res.countsByBox;
            if (res?.unreadByBox) this.unreadByBox = res.unreadByBox;
        }
        catch (e) {
            this.messages = [];
        }
        finally {
            this.loading = false;
        }
    },
    badgeOf(boxId) {
        return boxId === 'inbox' ? (Number(this.unreadByBox?.[boxId]) || 0) : 0;
    },
    countOf(boxId) {
        return boxId === 'drafts' ? (Number(this.countsByBox?.[boxId]) || 0) : 0;
    },
    peerLabel(msg) {
        if (this.activeBox === 'outbox' || this.activeBox === 'drafts')
            return msg.to || '(без получателя)';
        return msg.from || '(неизвестный отправитель)';
    },
    shortDate(v) { return formatMailShortDate(v); },
    fullDate(v) { return formatMailFullDate(v); },
    selectBox(boxId) {
        this.activeBox = boxId;
        this.selected = null;
        if (this.mode === 'view') this.mode = 'idle';
        this.reload();
    },
    selectAccount(addr) {
        this.selectedAccount = addr || '';
        this.reload();
    },
    onSearchInput(e) {
        this.searchQuery = e.target.value || '';
        this.debounce('mail-search', () => this.reload(), 200);
    },
    toggleUnreadOnly() {
        this.unreadOnly = !this.unreadOnly;
        this.reload();
    },
    async fetchRefresh() {
        if (!this.$item?.fetch || this.refreshing) return;
        this.refreshing = true;
        try {
            await this.$item.fetch('mail_refresh');
        }
        catch (e) {
            ODA.showMessage?.(e?.message || String(e));
        }
        finally {
            this.refreshing = false;
        }
        await this.loadAccounts();
        await this.reload();
    },
    async selectMessage(msg) {
        if (!msg?.path || !this.$item?.fetch) return;
        this.selected = msg;
        this.mode = 'view';
        try {
            const full = await this.$item.fetch('mail_read', {}, JSON.stringify({ path: msg.path, uid: msg.uid, markRead: true }));
            this.selected = full;
            if (!msg.read && full.read) {
                msg.read = true;
                this.messages = [...this.messages];
                if (this.unreadByBox.inbox > 0) {
                    this.unreadByBox = { ...this.unreadByBox, inbox: this.unreadByBox.inbox - 1 };
                }
            }
        }
        catch (e) {
            ODA.showMessage?.(e?.message || String(e));
        }
    },
    async toggleRead(msg) {
        if (!msg?.path || !this.$item?.fetch) return;
        try {
            await this.$item.fetch('mail_state', {}, JSON.stringify({ path: msg.path, uid: msg.uid, read: !msg.read }));
            await this.reload();
            if (this.selected?.path === msg.path)
                this.selected = { ...this.selected, read: !msg.read };
        }
        catch (e) { ODA.showMessage?.(e?.message || String(e)); }
    },
    async moveToTrash(msg) {
        if (!msg?.path || !this.$item?.fetch) return;
        try {
            await this.$item.fetch('mail_state', {}, JSON.stringify({ path: msg.path, uid: msg.uid, box: 'trash' }));
            this.selected = null;
            this.mode = 'idle';
            await this.reload();
        }
        catch (e) { ODA.showMessage?.(e?.message || String(e)); }
    },
    async restoreFromTrash(msg) {
        if (!msg?.path || !this.$item?.fetch) return;
        try {
            await this.$item.fetch('mail_state', {}, JSON.stringify({ path: msg.path, uid: msg.uid, restore: true }));
            this.selected = null;
            this.mode = 'idle';
            await this.reload();
        }
        catch (e) { ODA.showMessage?.(e?.message || String(e)); }
    },
    async deleteForever(msg) {
        if (!msg?.path || !this.$item?.fetch) return;
        try {
            await this.$item.fetch('mail_state', {}, JSON.stringify({ path: msg.path, uid: msg.uid, deletePermanent: true }));
            this.selected = null;
            this.mode = 'idle';
            await this.reload();
        }
        catch (e) { ODA.showMessage?.(e?.message || String(e)); }
    },
    async createEmail(init = {}) {
        if (!this.accounts.length)
            await this.loadAccounts();
        if (!this.accounts.length) {
            ODA.showMessage?.('Сначала настройте почтовый ящик');
            return;
        }
        this.draft = {
            ...EMPTY_DRAFT(),
            from: this.selectedAccount || this.accounts[0]?.address || '',
            ...init,
        };
        this.mode = 'compose';
    },
    editDraft(msg) {
        this.createEmail({
            uid: msg.uid || '',
            origTime: msg.origTime || 0,
            from: msg.address || msg.from || this.accounts[0]?.address || '',
            to: msg.to || '',
            cc: msg.cc || '',
            subject: msg.subject === '(без темы)' ? '' : (msg.subject || ''),
            body: msg.body || '',
            attachments: Array.isArray(msg.attachments) ? [...msg.attachments] : [],
        });
    },
    reply(replyAll = false) {
        const src = this.selected;
        if (!src) return;
        const subject = /^re:/i.test(src.subject || '') ? src.subject : 'Re: ' + (src.subject || '');
        const to = src.box === 'outbox' ? src.to : src.from;
        const from = this.accounts.some(a => a.address === src.address) ? src.address : undefined;
        this.createEmail({
            to,
            cc: replyAll ? (src.cc || '') : '',
            subject,
            body: quoteBody(src),
            inReplyTo: src.messageId || '',
            ...(from ? { from } : {}),
        });
    },
    forward() {
        const src = this.selected;
        if (!src) return;
        const subject = /^fwd?:/i.test(src.subject || '') ? src.subject : 'Fwd: ' + (src.subject || '');
        const from = this.accounts.some(a => a.address === src.address) ? src.address : undefined;
        this.createEmail({
            to: '',
            subject,
            body: `\n\n---------- Пересылаемое сообщение ----------\nОт: ${src.from}\nКому: ${src.to}\nТема: ${src.subject}\n\n${src.body || htmlToText(src.html || '')}`,
            attachments: Array.isArray(src.attachments) ? src.attachments.filter(a => a.path) : [],
            ...(from ? { from } : {}),
        });
    },
    async onAttachFiles(e) {
        const files = [...(e.target?.files || [])];
        e.target.value = '';
        if (!files.length || !this.$item?.save_files) return;
        try {
            const fd = new FormData();
            for (const f of files)
                fd.append('file', f, f.name);
            const saved = await this.$item.save_files(fd, { ignore_save_logs: true });
            const arr = Array.isArray(saved) ? saved : (saved ? [saved] : []);
            const nextAtts = [...(this.draft.attachments || [])];
            for (let i = 0; i < arr.length; i++) {
                const s = arr[i];
                const p = s?.path || s?.logFullPath || '';
                if (p)
                    nextAtts.push({ name: files[i]?.name || p.split('/').pop(), path: p });
            }
            this.draft = { ...this.draft, attachments: nextAtts };
        }
        catch (err) {
            ODA.showMessage?.(err?.message || String(err));
        }
    },
    removeDraftAttachment(idx) {
        const next = [...(this.draft.attachments || [])];
        next.splice(idx, 1);
        this.draft = { ...this.draft, attachments: next };
    },
    async saveDraft() {
        if (!this.$item?.fetch) return;
        try {
            const res = await this.$item.fetch('mail_draft_save', {}, JSON.stringify(this.draft));
            this.draft = { ...this.draft, uid: res?.uid || this.draft.uid };
            ODA.showMessage?.('Черновик сохранён');
            await this.reload();
        }
        catch (e) { ODA.showMessage?.(e?.message || String(e)); }
    },
    async sendDraft() {
        if (!this.$item?.fetch) return;
        try {
            await this.$item.fetch('mail_send', {}, JSON.stringify({
                ...this.draft,
                draftUid: this.draft.uid || undefined,
            }));
            this.draft = EMPTY_DRAFT();
            this.mode = 'idle';
            this.activeBox = 'outbox';
            await this.reload();
        }
        catch (e) { ODA.showMessage?.(e?.message || String(e)); }
    },
    async openAttachment(att) {
        if (!att?.path) {
            ODA.showMessage?.(`Вложение «${att?.name || 'файл'}»`);
            return;
        }
        const item = await globalThis.WORK?.get_item?.(att.path).catch(() => null);
        if (item && typeof window?.execute === 'function')
            window.execute(item);
    },
    async openSettings() {
        const res = await openEmailSettingsDialog(this.$item);
        if (res) {
            await this.loadAccounts();
            await this.reload();
        }
    },
    async toggleAutoRefresh(val) {
        this.autoRefresh = Boolean(val);
        try {
            await this.$item?.save?.({ mailAutoRefresh: this.autoRefresh });
        }
        catch { /* ignore */ }
    },
};
