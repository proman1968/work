import { $class } from './class.js';

export class $handler extends $class{
    get size(){
        return 0;
    }
    get service(){
        return Boolean(this.DATA?.service || this.DATA?.isService);
    }
    get isService(){
        return Boolean(this.DATA?.isService || this.DATA?.service);
    }
    get isButton(){
        return Boolean(this.DATA?.isButton);
    }
    get allowList(){
        return Boolean(this.DATA?.allowList);
    }
    get allowSave(){
        return Boolean(this.DATA?.allowSave);
    }
    get allowTools(){
        return this.DATA?.allowTools !== false;
    }
    get hiddenInViewList(){
        return Boolean(this.DATA?.hiddenInViewList);
    }
    get order(){
        return this.DATA?.order ?? 99;
    }
    get usable(){
        return this.DATA?.usable;
    }
    get allowUse(){
        return this.DATA?.allowUse;
    }
    async import(path, is){
        path = this.short + '/~/' + (path || this.id);
        if(!path.endsWith('.js'))
            path += '.js'
        const module = await import(path);
        const rawProto = module?.default;
        if (!rawProto || typeof rawProto !== 'object')
            return rawProto;
        const want = is || rawProto.is || ('item-' + this.id);
        // Всегда клонируем экспорт ES-модуля с сохранением дескрипторов (геттеры/сеттеры),
        // чтобы регистрация в WORK/ODA не мутировала общий кэшированный объект module.default.
        const prototype = Object.defineProperties(
            Object.create(Object.getPrototypeOf(rawProto)),
            Object.getOwnPropertyDescriptors(rawProto)
        );
        if (Array.isArray(rawProto.extends))
            prototype.extends = [...rawProto.extends];
        if (Array.isArray(rawProto.imports))
            prototype.imports = [...rawProto.imports];
        prototype.is = want;
        await WORK(prototype);
        return await prototype;
    }
    /** Визуалка: `{id}.js` в метапапке, иначе class.js. `is` — тег страницы (pages-explorer), иначе item-{id}. */
    async importView(is) {
        try {
            return await this.import(this.id, is);
        } catch {
            return await this.import('class.js', is);
        }
    }
    async execute(...params) {
        const rawPath = String(this.path || this.short || '');
        const pageMatch = rawPath.match(/\/handlers\/pages\/([^/$]+)(?:\/([^/$]+))?/);
        const execFn = (typeof window !== 'undefined' && (window.execute || window.top?.execute)) || null;
        if (pageMatch && execFn) {
            const pageName = pageMatch[1];
            const subView = pageMatch[2] || '';
            const rawSelf = this[R]?.target || this;
            const hasOwnCtx = Object.prototype.hasOwnProperty.call(rawSelf, '$context') || Object.prototype.hasOwnProperty.call(this, '$context');
            const ctx = hasOwnCtx ? await this.$context : null;
            const ev = params?.[0];
            if (ev?.ctrlKey || ev?.shiftKey || ev?.metaKey) {
                const targetShort = (ctx && ctx.type !== '$handler' ? ctx.short : this.short) || '';
                const url = (ctx && ctx.type !== '$handler')
                    ? `${targetShort}/~/handlers/pages/${pageName}/`
                    : `${this.short}/`;
                window.open(encodeURI(url), '_blank');
                return;
            }
            let nav;
            if (pageName === 'form') {
                const viewId = subView || (this.id && this.id !== 'form' ? this.id : '');
                nav = viewId ? { view: viewId } : undefined;
            }
            else {
                nav = { page: pageName };
            }
            if (ctx && ctx.type !== '$handler') {
                execFn(ctx, nav);
                return;
            }
            execFn(this, nav);
            return;
        }

        const module = await this.getModule();
        if (module?.execute) {
            module.execute.call(this, ...params);
            return;
        }

        if (this.short.includes('form') && execFn) {
            execFn(this);
            return;
        }
        window.open(this.short + '/');
    }
    async showSettings(...params) {
        const module = await this.getModule();
        if (module.showSettings) {
            return await module.showSettings.call(this, ...params);
        }
    }
    get hasSettings() {
        if (this.DATA?.hasSettings != null)
            return Boolean(this.DATA.hasSettings);
        return new AsyncPromise(async () => {
            try {
                const module = await this.getModule();
                return typeof module?.showSettings === 'function';
            } catch {
                return false;
            }
        });
    }
    async getModule() {
        const $item = Reactor.activate(this);
        $item.$context = await $item.$context;
        const module = await import(`${$item.short}/~/class.js`);
        return module.default;
    }
}
