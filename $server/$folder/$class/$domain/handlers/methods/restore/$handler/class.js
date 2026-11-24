/**
 * Загрузка организации ($base) или проекта ($project) из ZIP-архива
 * в домен с объявленным свойством archiveType ('$base' | '$project').
 */
const sanitizeTargetName = (name = '') => String(name)
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
    roles: ['BOSS'],
    order: 1,
    async allowUse($context) {
        if (!$context || $context.type !== '$domain')
            return false;
        await $context.init;
        const archiveType = $context.DATA?.archiveType;
        return archiveType === '$base' || archiveType === '$project';
    },
    async execute(directFile, directOpts) {
        const ctx = await (this.$context || this.$item?.$context);
        if (!ctx || ctx.type !== '$domain')
            return;
        await ctx.init?.catch?.(() => {});
        const archiveType = ctx.DATA?.archiveType || ctx.archiveType
            || (ctx.id === 'PROJECTS' ? '$project' : ctx.id === 'ORGANIZATIONS' ? '$base' : '');
        if (archiveType !== '$base' && archiveType !== '$project')
            return;

        const isProject = archiveType === '$project';
        const file = (directFile instanceof File || directFile instanceof Blob)
            ? directFile
            : await pickZipFile();
        if (!file)
            return;

        let targetName = sanitizeTargetName(directOpts?.name || file.name || '');
        let overwrite = directOpts?.overwrite ?? true;

        if (!(directFile instanceof File || directFile instanceof Blob) && typeof WORK?.showDialog === 'function') {
            const domainPath = ctx.path || `/${ctx.id}`;
            const dlg = ODA.createElement('domain-archive-restore-dialog', {
                fileName: file.name || 'archive.zip',
                fileSize: file.size || 0,
                targetName,
                overwrite,
                nameLegend: isProject ? `Имя проекта в ${domainPath}:` : `Имя организации в ${domainPath}:`,
                overwriteText: isProject
                    ? 'Заменить существующий проект при совпадении имени'
                    : 'Заменить существующую организацию при совпадении имени',
            });
            const res = await WORK.showDialog(dlg, {
                $item: this,
                TITLE: { label: isProject ? 'Загрузить проект из архива' : 'Загрузить организацию из архива' },
                OK: { label: 'Загрузить', icon: 'icons:check', result: 'ok', infoInvert: true },
            });
            if (res !== 'ok')
                return;
            targetName = sanitizeTargetName(dlg.targetName || file.name);
            overwrite = Boolean(dlg.overwrite);
        }

        const formData = new FormData();
        formData.append('file', file, file.name || `${targetName || (isProject ? 'project' : 'organization')}.zip`);

        const result = await ctx.fetch('import_archive', {
            name: targetName,
            overwrite: overwrite ? 'true' : 'false',
        }, formData);

        await ctx.reset?.();
        try {
            await ctx.fetch('info', { deep: 1, items: 'items' });
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
    is: 'domain-archive-restore-dialog',
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
            <legend>{{nameLegend}}</legend>
            <input type="text" :value="targetName" @input="targetName = $event.target.value" placeholder="Имя из архива">
        </fieldset>
        <label class="chk">
            <input type="checkbox" :checked="overwrite" @change="overwrite = $event.target.checked">
            <span>{{overwriteText}}</span>
        </label>
    `,
    fileName: '',
    fileSize: 0,
    targetName: '',
    overwrite: true,
    nameLegend: 'Имя в домене:',
    overwriteText: 'Заменить существующий элемент при совпадении имени',
    get sizeText() {
        const b = Number(this.fileSize) || 0;
        if (b >= 1024 * 1024)
            return `${(b / (1024 * 1024)).toFixed(1)} МБ`;
        if (b >= 1024)
            return `${Math.round(b / 1024)} КБ`;
        return b ? `${b} Б` : '';
    },
});
