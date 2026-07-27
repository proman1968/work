import { $class } from './class.js';

export class $handler extends $class{
    get size(){
        return 0;
    }
    async import(path){
        path = this.short + '/~/' + path;
        if(!path.endsWith('.js'))
            path += '.js'
        const module = await import(path);
        let prototype = module?.default;
        prototype.is ??= 'item-' + this.id;
        await WORK(prototype);
        return await prototype;
    }
    async execute(...params) {
        const module = this.module;
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
    async showSettings(e) {
        const module = await this.module;
        if (module.showSettings) {
            module.showSettings.call(this);
        }
    }
    get hasSettings() {
        return new AsyncPromise(async () => {
            try {
                const module = await this.module;
                return typeof module?.showSettings === 'function';
            } catch {
                return false;
            }
        });
    }
    get module() {
        return new AsyncPromise(async () => {
            const $item = Reactor.activate(this);
            $item.$context = await $item.$context;
            const module = await import($item.short + '/~/class.js');
            return module.default;
        });
    }
}
