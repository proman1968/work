import { $folder } from './folder.js';

export class $file extends $folder{
    get $public(){
        return{
            form: 'file',
        }
    }
    /** load() возвращает сырые данные файла без __bind */
    load(params = {}) {
        return this.body ??= new AsyncPromise(async _ => {
            return WORK.fetch(this.short || '/', 'load', {...params, version: this.__version});
        });
    }
    reset() {
        this.body = undefined;
        super.reset();
    }
    import(){
        return this.load().then(body=>{
            body = toBase64(body);
            return import('data:text/javascript;base64,' + body).then(module => module?.default)
        })
    }
    get name(){
        let idx = this.id?.lastIndexOf('.');
        if (idx>-1)
            return this.id.substring(0, idx);
        return this.id || ''
    }
    get label(){
        if (!this.path)
            return this.id || '';
        let parts = this.path.split('/');
        this.id = parts.pop();
        parts.pop();
        if (parts.pop() === 'history')
            return this.constructor.historyUserLabelAsync(this.path);
        return this.id;
    }
    get ext(){
        return this.id?.split('.').pop() || '';
    }
    get icon(){
        if(this.ext)
            return 'files-color:s-' + this.ext;
        return 'files:document';
    }
    static loadPreview(n){
        if(!n?.ext)
            return false;
        if ($file.previews[n.ext] !== undefined)
            return $file.previews[n.ext];
        return $file.previews[n.ext] = new AsyncPromise(async _=>{
            try{
                let path = n.short + '/~/handlers/preview/~/class.js';
                let module = await import(path);
                let def = module?.default;
                def.is ??= n.ext + '-preview';
                WORK(def);
                return true;
            }
            catch(e){
                delete $file.previews[n.ext];
                return false;
            }

        })
    }
    static parseHistoryEntryPath(path) {
        if (!path) return null;
        const parts = path.split('/');
        const id = parts.pop();
        if (!id) return null;
        parts.pop();
        if (parts.pop() !== 'history') return null;
        const sourceId = parts.pop() || '';
        const extDot = id.lastIndexOf('.');
        const name = extDot > 0 ? id.slice(0, extDot) : id;
        const nameParts = name.split('.');
        const timestamp = nameParts[0];
        const userId = nameParts.length > 1 ? nameParts[1] : '';
        const fileName = sourceId.startsWith('.') ? sourceId.slice(1) : sourceId;
        const ms = +timestamp;
        const time = Number.isFinite(ms)
            ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '';
        return { timestamp, userId, fileName, time };
    }

    static historyEntryLabel(path) {
        const p = this.parseHistoryEntryPath(path);
        if (!p) return '';
        return p.fileName ? `${p.time} | ${p.fileName}` : p.time;
    }

    static historyUserLabel(path) {
        const p = this.parseHistoryEntryPath(path);
        if (!p) return '';
        return p.userId ? `${p.time} | ${p.userId}` : p.time;
    }

    static async historyUserLabelAsync(path) {
        const p = this.parseHistoryEntryPath(path);
        if (!p) return '';
        if (!p.userId) return p.time;
        let who = p.userId;
        try {
            if (globalThis.WORK?.users) {
                const users = await WORK.users;
                who = users.find(u => u.id === p.userId)?.label || who;
            }
            else if (globalThis.WORK?.$users) {
                const user = await WORK.$users().then(u => u.get_item('//' + p.userId));
                who = user?.label || who;
            }
        } catch { /* uid */ }
        return `${p.time} | ${who}`;
    }

    static fixMdHistoryLinks(md) {
        if (!md || typeof md !== 'string') return md;
        return md.replace(/\[([^\]]*)\]\((.+?\/~\/[^)]+)\)/g, (match, _text, url) => {
            try {
                const path = decodeURI(url).split('/~/')[0];
                if (!path.includes('/history/')) return match;
                const label = this.historyEntryLabel(path);
                return label ? `[${label}](${url})` : match;
            } catch {
                return match;
            }
        });
    }

    /** dirname of file path, or path itself if already a directory */
    static mdBaseDir(path = '') {
        if (!path || typeof path !== 'string') return '';
        let p = path.replace(/\\/g, '/').replace(/\/+$/, '');
        const last = p.split('/').pop() || '';
        if (last.includes('.'))
            p = p.replace(/\/[^/]+$/, '') || '';
        return p;
    }

    static normalizeWorkPath(path = '') {
        const parts = [];
        for (const seg of path.replace(/\\/g, '/').split('/')) {
            if (!seg || seg === '.') continue;
            if (seg === '..') {
                parts.pop();
                continue;
            }
            parts.push(seg);
        }
        return '/' + parts.join('/');
    }

    /** Path-like work reference worth turning into a navigable WORK form URL */
    static isWorkPathLike(text) {
        if (!text || typeof text !== 'string') return false;
        if (/\s/.test(text) || text.length < 3) return false;
        if (/^(https?:|mailto:|data:)/i.test(text)) return false;
        // образцы / шаблоны в документации, не реальные пути
        if (/[<>{}]|→/.test(text)) return false;
        if (/\b(TIME|USER|YYYY|MM|DD)\b/.test(text)) return false;
        const t = text.replace(/^\//, '');
        if (t.startsWith('.') || t.startsWith('~/') || t.startsWith('~')) return false;
        if (t.startsWith('$') && t.includes('/')) return true;
        if (/^(sources|oda|docs|paas|register|tests)\//i.test(t)) return true;
        return false;
    }

    /**
     * Build `/path/~/handlers/pages/form/` or null if href must stay as-is.
     * @param {string} href
     * @param {string} baseDir dirname of current md file (short path)
     */
    static toWorkFormHref(href, baseDir = '') {
        if (!href || typeof href !== 'string') return null;
        const raw = href.trim();
        if (/^(https?:|mailto:|data:)/i.test(raw)) return null;
        if (raw.startsWith('#')) return null;
        if (raw.includes('/~/')) return null;
        // образцы / шаблоны в документации
        if (/[<>{}]|→/.test(raw)) return null;
        if (/\b(TIME|USER|YYYY|MM|DD)\b/.test(raw)) return null;
        let path = decodeURI(raw.split('?')[0].split('#')[0]).replace(/\\/g, '/');
        if (!path) return null;
        // `.progress.md/...` и т.п. — не относительный ../ и не абсолютный work-путь
        if (path.startsWith('.') && !path.startsWith('./') && !path.startsWith('../'))
            return null;
        if (path.startsWith('/.'))
            return null;
        if (!path.startsWith('/')) {
            const base = (baseDir || '').replace(/\\/g, '/').replace(/\/+$/, '');
            path = this.normalizeWorkPath((base ? base + '/' : '/') + path);
        } else {
            path = this.normalizeWorkPath(path);
        }
        if (path === '/' || path.startsWith('/.')) return null;
        return path + '/~/handlers/pages/form/';
    }

    /**
     * Rewrite md so internal work paths become WORK form links.
     * - [text](relative-or-absolute) → WORK form URL
     * - `path/like` outside fences → [`path`](WORK url) when path-like
     */
    static fixWorkMdLinks(md, basePath = '') {
        if (!md || typeof md !== 'string') return md;
        const baseDir = this.mdBaseDir(basePath);
        const parts = md.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/);
        return parts.map((part, i) => {
            if (i % 2 === 1) return part;
            return this._fixWorkMdSegment(part, baseDir);
        }).join('');
    }

    static _fixWorkMdSegment(text, baseDir) {
        text = text.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (match, label, href) => {
            const url = this.toWorkFormHref(href.trim(), baseDir);
            return url ? `[${label}](${url})` : match;
        });
        text = text.replace(/`([^`\n]+)`/g, (match, code, offset) => {
            const before = text[offset - 1];
            const after = text.slice(offset + match.length, offset + match.length + 2);
            if (before === '[' && after === '](') return match;
            if (!this.isWorkPathLike(code)) return match;
            const url = this.toWorkFormHref(code, baseDir);
            return url ? `[${code}](${url})` : match;
        });
        return text;
    }

}
$file.previews = {};

function toBase64(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  return btoa(String.fromCharCode(...data));
}
