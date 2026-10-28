/**
 * Загрузка организации ($base) из ZIP-архива в домен /ORGANIZATIONS.
 */
const sanitizeOrgName = (name = '') => String(name)
    .replace(/\.zip$/i, '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();

function pickZipFile() {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip,application/zip';
        input.style.display = 'none';
        input.onchange = () => {
            const file = input.files?.[0] || null;
            input.remove();
            resolve(file);
        };
        input.oncancel = () => {
            input.remove();
            resolve(null);
        };
        document.body.appendChild(input);
        input.click();
    });
}

export default {
    icon: 'icons:file-upload',
    label: 'Загрузить из архива',
    roles: ['ADMIN', 'BOSS'],
    button: true,
    isButton: true,
    order: 1,
    async execute(directFile, directOpts) {
        const ctx = await (this.$context || this.$item?.$context || WORK.get_item('/ORGANIZATIONS'));
        const target = (ctx?.id === 'ORGANIZATIONS' || ctx?.type === '$domain')
            ? ctx
            : await WORK.get_item('/ORGANIZATIONS');
        if (!target)
            return;

        const file = (directFile instanceof File || directFile instanceof Blob)
            ? directFile
            : await pickZipFile();
        if (!file)
            return;

        let orgName = sanitizeOrgName(directOpts?.name || file.name || '');
        let overwrite = directOpts?.overwrite ?? true;

        if (!(directFile instanceof File || directFile instanceof Blob) && typeof WORK?.showDialog === 'function') {
            const dlg = ODA.createElement('org-archive-restore-dialog', {
                fileName: file.name || 'archive.zip',
                fileSize: file.size || 0,
                orgName,
                overwrite,
            });
            const res = await WORK.showDialog(dlg, {
                $item: this,
                TITLE: { label: 'Загрузить организацию из архива' },
                OK: { label: 'Загрузить', icon: 'icons:check', result: 'ok', infoInvert: true },
            });
            if (res !== 'ok')
                return;
            orgName = sanitizeOrgName(dlg.orgName || file.name);
            overwrite = Boolean(dlg.overwrite);
        }

        const formData = new FormData();
        formData.append('file', file, file.name || `${orgName || 'organization'}.zip`);

        const result = await target.fetch('import_archive', {
            name: orgName,
            overwrite: overwrite ? 'true' : 'false',
        }, formData);

        await target.reset?.();
        try {
            await target.fetch('info', { deep: 1, items: 'items' });
        }
        catch { /* ignore */ }

        if (result?.path && typeof window?.execute === 'function') {
            const restored = await WORK.get_item(result.path).catch(() => null);
            if (restored)
                window.execute(restored);
        }
        return result;
    },
}

ODA({
    is: 'org-archive-restore-dialog',
    imports: '/oda//icon.js',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                gap: 10px;
                padding: 12px 16px;
                min-width: 340px;
            }
            .file-row {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                padding: 6px 10px;
                border-radius: 6px;
                background: light-dark(#f3f4f6, #26282e);
                font-size: 13px;
            }
            fieldset {
                @apply --horizontal;
                align-items: center;
                margin: 0;
                padding: 4px 10px 6px;
                border: 1px solid var(--subtle-border, var(--border-color));
                border-radius: 8px;
            }
            legend {
                font-size: 12px;
                padding: 0 4px;
                opacity: 0.75;
            }
            input[type="text"] {
                @apply --flex;
                border: none;
                outline: none;
                background: transparent;
                color: inherit;
                font: inherit;
                font-weight: 600;
                padding: 2px 0;
            }
            label.chk {
                @apply --horizontal;
                align-items: center;
                gap: 6px;
                font-size: 12.5px;
                cursor: pointer;
                user-select: none;
            }
        </style>
        <div class="file-row">
            <oda-icon icon="icons:archive" icon-size="20"></oda-icon>
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{fileName}}</span>
            <span style="opacity:0.65;font-size:12px;">{{sizeText}}</span>
        </div>
        <fieldset>
            <legend>Имя организации в /ORGANIZATIONS:</legend>
            <input type="text" :value="orgName" @input="orgName = $event.target.value" placeholder="Имя из архива">
        </fieldset>
        <label class="chk">
            <input type="checkbox" :checked="overwrite" @change="overwrite = $event.target.checked">
            <span>Заменить существующую организацию при совпадении имени</span>
        </label>
    `,
    fileName: '',
    fileSize: 0,
    orgName: '',
    overwrite: true,
    get sizeText() {
        const b = Number(this.fileSize) || 0;
        if (b >= 1024 * 1024)
            return `${(b / (1024 * 1024)).toFixed(1)} МБ`;
        if (b >= 1024)
            return `${Math.round(b / 1024)} КБ`;
        return b ? `${b} Б` : '';
    },
});
