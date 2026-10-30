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
    get button(){
        return Boolean(this.DATA?.button || this.DATA?.isButton);
    }
    get isButton(){
        return Boolean(this.DATA?.isButton || this.DATA?.button);
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
        const module = await this.getModule();
        if (module.execute) {
            module.execute.call(this, ...params);
            return;
        }

        if (this.short.includes('form')) {
            if (window.execute) {
                window.execute(this);
                return;
            }
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
