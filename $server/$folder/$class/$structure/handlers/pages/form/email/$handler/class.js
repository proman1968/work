/** Мета хендлера form/email. Визуалка — email.js. */
export default {
    icon: 'enterprise:email',
    async showSettings(...params) {
        return runEmailSettingsDialog(this);
    },
}

async function runEmailSettingsDialog($item) {
    if (runEmailSettingsDialog.opening)
        return;
    runEmailSettingsDialog.opening = true;
    let el, settings, $context;
    try {
        $context = $item.$context;
        settings = await $context.fetch('read_secret', { filename: 'email.json' });
        el = ODA.createElement('oda-email-settings', {
            accounts: mailboxesToAccounts(settings?.mailboxes),
        });
        if (!el.accounts.length) {
            el.addAccount();
        }
        else {
            el.index = 0;
        }
    }
    catch (e) {
        ODA.showMessage(e.message)
        return;
    }
    finally {
        runEmailSettingsDialog.opening = false;
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
