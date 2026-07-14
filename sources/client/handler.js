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
    async execute(...params){
        let $item = Reactor.activate(this);
        $item.$context = await $item.$context;
        let module = await import($item.short + '/~/class.js');
        if (module.default.execute) {
            module.default.execute.call($item, ...params);
            return;
        }
        if ($item.short.includes('form')) {
            if (window.execute) {
                window.execute($item);
                return;
            }
        }
        window.open($item.short + '/');
    }
}
