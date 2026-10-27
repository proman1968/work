/**
 * Поиск файлов, объектов данных и элементов структуры относительно узла ($class.search_tree).
 */
import { FS } from '../index.js';
import { DEV_MODE } from '../../host/config.js';
import * as WORKPLACES from '../access/workplaces.js';

const SKIP_SEARCH = new Set([
    'node_modules', 'history', 'logs', 'sources', 'oda', 'tests', 'docs',
    'torus', 'vendor', 'handlers', 'methods', 'triggers', 'ai', 'lib',
]);

export const classSearchMethods = {
    /**
     * Поиск файлов, объектов данных и элементов структуры относительно текущего узла
     * (только среди элементов, файлов и объектов, доступных пользователю по правам canSee / data_access / scope).
     */
    async search_tree(params = {}) {
        const rawQ = String(params.q ?? params.query ?? '').trim();
        const q = rawQ.toLowerCase();
        if (!q)
            return { query: '', files: [], nodes: [], objects: [] };

        const files = [];
        const nodes = [];
        const objects = [];
        const seenPaths = new Set();
        const seenFilePaths = new Set();
        const seenObjIds = new Set();
        const linkedClassPaths = new Set();
        const queriedClassPaths = new Set();
        const basePrefix = (this.path && this.path !== '/') ? this.path + '/' : '/';

        const checkFile = async (fileItem, owner) => {
            if (!fileItem || files.length >= 60)
                return;
            const fPath = fileItem.short || fileItem.path || '';
            if (!fPath || seenFilePaths.has(fPath))
                return;
            if (fileItem.id === 'class.js' || fileItem.isHidden || fileItem.id?.[0] === '.' || fileItem.id?.[0] === '#' || fileItem.id?.[0] === '$')
                return;
            if (!(await owner.canSee(fileItem, params)))
                return;
            seenFilePaths.add(fPath);
            const fName = String(fileItem.DATA?.label || fileItem.label || fileItem.name || fileItem.id || '');
            const relFilePath = fPath.startsWith(basePrefix) ? fPath.slice(basePrefix.length) : fPath;
            const nameHit = fName.toLowerCase().includes(q) || relFilePath.toLowerCase().includes(q);
            let snippet = '';
            let hitLine = 0;
            if (!nameHit) {
                try {
                    const st = fileItem.stat;
                    if (st && st.size > 0 && st.size <= 262144) {
                        const content = await fileItem.load({ encoding: 'utf-8' });
                        if (typeof content === 'string' && !content.includes('\0')) {
                            const lines = content.split(/\r?\n/);
                            for (let i = 0; i < lines.length; i++) {
                                if (lines[i].toLowerCase().includes(q)) {
                                    hitLine = i + 1;
                                    snippet = lines[i].trim().slice(0, 180);
                                    break;
                                }
                            }
                        }
                    }
                }
                catch { /* binary or unreadable */ }
            }
            if (nameHit || hitLine > 0) {
                files.push({
                    path: fPath,
                    label: fName || fPath,
                    ext: fileItem.ext || '',
                    icon: fileItem.DATA?.icon || 'files:file',
                    line: hitLine || undefined,
                    snippet: snippet || undefined,
                });
            }
        };

        const scanFolderFiles = async (folder, owner, fDepth = 0) => {
            if (!folder || fDepth > 4 || files.length >= 60)
                return;
            let entries = [];
            try {
                entries = (await folder.children) || [];
            }
            catch { return; }
            for (const entry of entries) {
                if (!entry?.id || entry.id[0] === '.' || entry.id[0] === '#' || entry.id[0] === '$' || SKIP_SEARCH.has(entry.id))
                    continue;
                if (entry instanceof FS.$class)
                    continue;
                if (entry instanceof FS.$file) {
                    await checkFile(entry, owner);
                }
                else if (entry.constructor === FS.$folder) {
                    if (await owner.canSee(entry, params))
                        await scanFolderFiles(entry, owner, fDepth + 1);
                }
            }
        };

        const queryDataClass = async (clsItem) => {
            if (!clsItem || objects.length >= 60)
                return;
            const cPath = clsItem.path || '';
            if (!cPath || queriedClassPaths.has(cPath))
                return;
            if (typeof clsItem.isModuleBlocked === 'function' && await clsItem.isModuleBlocked())
                return;
            queriedClassPaths.add(cPath);
            if ((clsItem.type === '$catalog' || clsItem.type === '$operation') && typeof clsItem.db_query === 'function') {
                try {
                    const qParams = { ...params, search: rawQ, limit: 25 };
                    if (this.type === '$structure' && clsItem.type === '$operation')
                        qParams.unit = this.path;
                    const res = await clsItem.db_query(qParams);
                    for (const it of res?.items || []) {
                        if (!it?.id || seenObjIds.has(it.id))
                            continue;
                        seenObjIds.add(it.id);
                        objects.push({
                            id: it.id,
                            cid: it.cid || cPath,
                            title: it.title || it.body?.name || it.id,
                            classLabel: res?.classes?.[it.cid]?.label || clsItem.DATA?.label || clsItem.id,
                            status: it.status || '',
                            time: it.time || 0,
                            type: clsItem.type,
                        });
                    }
                }
                catch { /* нет доступа к объектам этого класса */ }
            }
        };

        const walk = async (cur, depth = 0) => {
            if (!cur || depth > 7 || nodes.length >= 60)
                return;
            const curPath = cur.path || '/';
            if (seenPaths.has(curPath))
                return;
            seenPaths.add(curPath);

            try {
                await cur.init;
            }
            catch { /* ignore */ }

            if (cur.type === '$module' && typeof cur.isModuleBlocked === 'function' && await cur.isModuleBlocked())
                return;

            if (cur !== this) {
                const label = String(cur.DATA?.label || cur.label || cur.id || '');
                const id = String(cur.id || '');
                const relCurPath = curPath.startsWith(basePrefix) ? curPath.slice(basePrefix.length) : curPath;
                if (label.toLowerCase().includes(q) || id.toLowerCase().includes(q) || relCurPath.toLowerCase().includes(q)) {
                    nodes.push({
                        path: curPath,
                        label: label || id || curPath,
                        icon: cur.type === '$module' ? 'odant:module' : (cur.DATA?.icon || cur.icon || ''),
                        type: cur.type || '',
                    });
                }
            }

            const owner = cur instanceof FS.$class ? cur : (cur.$class || this);
            if (cur !== globalThis.WORK) {
                await scanFolderFiles(cur, owner, 0);
                if (cur instanceof FS.$class && cur.meta_folder)
                    await scanFolderFiles(cur.meta_folder, cur, 0);
            }

            if (cur.type === '$base' || cur.type === '$structure') {
                const sec = cur.DATA?.['#security'];
                if (sec) {
                    const { common, places } = WORKPLACES.normalizeSecurity(sec);
                    for (const l of common || []) {
                        if (l?.id)
                            linkedClassPaths.add(l.id);
                    }
                    for (const { node: pl, trail } of WORKPLACES.walkPlaces(places)) {
                        const plLabel = String(pl.label || pl.id || '');
                        if (plLabel.toLowerCase().includes(q) || String(pl.id || '').toLowerCase().includes(q)) {
                            nodes.push({
                                path: curPath,
                                place: WORKPLACES.trailKey(trail),
                                label: `${plLabel} (${cur.DATA?.label || cur.id})`,
                                icon: pl.icon || 'fontawesome:s-user-tie',
                                type: '$place',
                            });
                        }
                        for (const l of pl.LINKS || []) {
                            if (l?.id)
                                linkedClassPaths.add(l.id);
                        }
                    }
                }
            }

            if ((cur.type === '$catalog' || cur.type === '$operation') && cur.$parent?.type !== cur.type)
                await queryDataClass(cur);

            let children = [];
            try {
                children = (await cur.children) || [];
            }
            catch {
                return;
            }
            for (const ch of children) {
                if (!ch?.id || ch.id[0] === '$' || ch.id[0] === '.' || ch.id[0] === '#' || SKIP_SEARCH.has(ch.id))
                    continue;
                if (ch instanceof FS.$file) {
                    await checkFile(ch, owner);
                    continue;
                }
                try {
                    const visible = await owner.canSee(ch, params)
                        || (ch instanceof FS.$class && (await ch.data_access(params)) != null)
                        || (ch.id === 'MODULES' && ch.type === '$domain');
                    if (!visible)
                        continue;
                    await walk(ch, depth + 1);
                }
                catch { /* skip */ }
            }
        };

        await walk(this, 0);

        for (const lPath of linkedClassPaths) {
            if (objects.length >= 60 && nodes.length >= 60)
                break;
            try {
                let target = await globalThis.WORK?.get_item(lPath);
                if (Array.isArray(target))
                    target = target.at(-1);
                if (!target || !(target instanceof FS.$class))
                    continue;
                await target.init;
                if (typeof target.isModuleBlocked === 'function' && await target.isModuleBlocked())
                    continue;
                if ((await target.data_access(params)) == null && !(await target.canSee(target, params)))
                    continue;
                if (!seenPaths.has(target.path)) {
                    const tLabel = String(target.DATA?.label || target.label || target.id || '');
                    if (tLabel.toLowerCase().includes(q) || String(target.id || '').toLowerCase().includes(q)) {
                        seenPaths.add(target.path);
                        nodes.push({
                            path: target.path,
                            label: tLabel || target.id,
                            icon: target.DATA?.icon || target.icon || '',
                            type: target.type || '',
                        });
                    }
                }
                await queryDataClass(target);
            }
            catch { /* ignore */ }
        }

        const isAdm = DEV_MODE || (await this.roles(params).catch(() => [])).includes('ADMIN') || await this._isWorkAdmin(params).catch(() => false);
        const filteredNodes = isAdm
            ? nodes
            : nodes.filter(n => n.type !== '$module' && !(n.type === '$domain' && n.path.endsWith('/MODULES')));

        return {
            query: rawQ,
            files: files.slice(0, 60),
            nodes: filteredNodes.slice(0, 60),
            objects: objects.slice(0, 60),
        };
    },
};
