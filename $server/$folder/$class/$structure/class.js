export default {
    ACCESS: {
        sql_databases: 'admin',
        sql_schema: 'admin',
        sql_rows: 'admin',
        sql_update_row: 'admin',
        sql_insert_row: 'admin',
        sql_delete_row: 'admin',
        delete_log_entry: 'admin',
    },

    async delete_log_entry(params = {}) {
        await this.assertAccess(params, 'ADMIN');
        const { pathToFileURL } = await import('node:url');
        const path = await import('node:path');
        const LOGS = await import(pathToFileURL(path.join(process.cwd(), 'sources/server/logs.js')).href);
        return LOGS.deleteLogEntry(this, params);
    },

    async _sqlInspector() {
        const { pathToFileURL } = await import('node:url');
        const path = await import('node:path');
        return import(pathToFileURL(path.join(process.cwd(), 'sources/data/sql-inspector.js')).href);
    },

    async sql_databases(params = {}) {
        const mod = await this._sqlInspector();
        return mod.listSqlDatabases(this, params);
    },

    async sql_schema(params = {}) {
        const mod = await this._sqlInspector();
        return mod.getSqlSchema(this, params);
    },

    async sql_rows(params = {}) {
        const mod = await this._sqlInspector();
        return mod.querySqlRows(this, params);
    },

    async sql_update_row(params = {}) {
        const mod = await this._sqlInspector();
        return mod.updateSqlRow(this, params);
    },

    async sql_insert_row(params = {}) {
        const mod = await this._sqlInspector();
        return mod.insertSqlRow(this, params);
    },

    async sql_delete_row(params = {}) {
        const mod = await this._sqlInspector();
        return mod.deleteSqlRows(this, params);
    },

    /**
     * Создать папки ящиков после сохранения секрета email.
     * Вызывается из UI (form/email), не из ядра save_secret.
     */
    async ensure_mailbox_folders(params = {}) {
        let data = params.post;
        if (typeof data === 'string')
            data = JSON.parse(data);
        const mailboxes = data?.mailboxes || data || {};
        const { pathToFileURL } = await import('node:url');
        const path = await import('node:path');
        const { ensureMailboxFolders } = await import(pathToFileURL(path.join(process.cwd(), '$server/$folder/lib/email/settings.js')).href);
        await ensureMailboxFolders(this, mailboxes);
    },

    get status() {
        return this.supervisors?.then(async supervisors => {
            let status = '';
            if (supervisors.length)
                status += '<b>' + supervisors[0]?.label + '</b>';

            let members = await this.members;
            if (members.length) {
                status += '<br>Users: <b>' + members.length + '</b> [' + members.map(u => u.label).join(', ') + ']';
            }
            return this.status = status;
        });
    }
}
