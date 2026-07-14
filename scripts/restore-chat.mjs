import fs from 'node:fs';

const src = 'agent-tools/chat-svn-92788.js';
const dst = '$server/$folder/$class/handlers/pages/form/chat/$handler/class.js';
let code = fs.readFileSync(src, 'utf8');

code = code.replace(
    /async _fetchLogFiles\(\)\{[\s\S]*?return this\._dedupeLogFiles\(this\._sortLogFiles\(files\.filter\(f => f\?\.[\s\S]*?\)\)\);\s*\},/,
    `async _logPathKey(file){
        if (!file?.load)
            return file?.id || '';
        try {
            const raw = await file.load();
            const row = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return row?.path || file.id;
        }
        catch {
            return file?.id || '';
        }
    },
    async _hasLogItem(file){
        if (!file?.id)
            return true;
        if (this.logItems.some(i => i.id === file.id))
            return true;
        const key = await this._logPathKey(file);
        for (const item of this.logItems) {
            if (await this._logPathKey(item) === key)
                return true;
        }
        return false;
    },
    async _fetchLogFiles(){
        const folder = this._logsFolder;
        if (!folder)
            return [];
        folder.reset?.();
        let files = await Promise.resolve(folder.files);
        if (!Array.isArray(files))
            files = files ? [files] : [];
        files = files.filter(f => f?.id?.endsWith?.('.logs'));
        return this._dedupeLogFiles(this._sortLogFiles(files));
    },`,
);

code = code.replace(
    `                let file = await folder.get_item('/' + initiator, 'info');
                if (file?.id?.endsWith?.('.logs') && !this.logItems.some(i => i.id === file.id)) {
                    this.logItems.push(file);
                    this.logItems = this._sortLogFiles(this.logItems);`,
    `                let file = await folder.get_item('/' + initiator, 'info');
                if (file?.id?.endsWith?.('.logs') && !(await this._hasLogItem(file))) {
                    this.logItems.push(file);
                    this.logItems = await this._dedupeLogFiles(this._sortLogFiles(this.logItems));`,
);

code = code.replace(
    `        for (const file of files) {
            if (this.logItems.some(i => i.id === file.id))
                continue;
            this.logItems.push(file);
            added = true;
        }
        if (!added)
            return;
        this.logItems = this._sortLogFiles(this.logItems);`,
    `        for (const file of files) {
            if (await this._hasLogItem(file))
                continue;
            this.logItems.push(file);
            added = true;
        }
        if (!added)
            return;
        this.logItems = await this._dedupeLogFiles(this._sortLogFiles(this.logItems));`,
);

code = code.replace(
    `    get logs() {
        this._ensureLogsInit();
        return this.logItems;
    },`,
    `    get logs() {
        this._ensureLogsInit();
        return this.logItems.slice().reverse();
    },`,
);

code = code.replace(
    `                const text = body.content != null ? String(body.content) : '';
                if (text && !result.has(text))
                    result.push(text);`,
    `                const text = body.content != null ? String(body.content) : '';
                if (text && !result.includes(text))
                    result.push(text);`,
);

code = code.replace(
    `    logData: {
        $def: null,
        set(n) {
            if (!n?.time)
                return;
            if (this[R]?.cache) {
                for (const key of ['itemBody', 'bodyText', 'isTextBody', 'isMdBody', 'isRichBody', 'includes', 'fileLabel', 'sender'])
                    delete this[R].cache[key];
            }
            this.messageHtml = '';
            this.mdText = '';
            this.showMd = false;
            this.showRich = false;
            this._hasIncludes = false;
            this._includeFile = null;
            this.previewIsReady = false;
            this.senderIsReady = false;
            if (n.sender != null)
                this.senderId = n.sender;
            else
                this.senderIsReady = true;
            this.updateDisplay(n);
        }
    },`,
    `    logData: {
        $def: null,
        set(n) {
            if (!n?.time)
                return;
            const same = this.logData?.time === n.time;
            if (this[R]?.cache) {
                for (const key of ['itemBody', 'bodyText', 'isTextBody', 'isMdBody', 'isRichBody', 'includes', 'fileLabel', 'sender'])
                    delete this[R].cache[key];
            }
            if (!same) {
                this.messageHtml = '';
                this.mdText = '';
                this.showMd = false;
                this.showRich = false;
                this._hasIncludes = false;
                this._includeFile = null;
                this.previewIsReady = false;
                this.senderIsReady = false;
            }
            if (n.sender != null)
                this.senderId = n.sender;
            else if (!same)
                this.senderIsReady = true;
            this.updateDisplay(n);
        }
    },`,
);

code = code.replace(
    `                this._logWatch = () => n.listen('changed', () => {
                    n.load().then(applyLog).catch(() => {});
                });`,
    `                this._logWatch = () => n.listen('changed', () => {
                    n.load().then(raw => {
                        const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
                        if (data?.time)
                            this.logData = { ...data };
                    }).catch(() => {});
                });`,
);

fs.writeFileSync(dst, code);
console.log('restored', dst, 'lines', code.split('\n').length);
