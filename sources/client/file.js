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
                let path = n.short + '/~/handlers/preview/~/data.js';
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

}
$file.previews = {};

function toBase64(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  return btoa(String.fromCharCode(...data));
}
