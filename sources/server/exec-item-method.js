import * as CORE from '../server.js';

async function tryHandlerMethod(item, method, params, request) {
    try {
        const handlerItem = await item.get_item('~/handlers/methods/' + method);
        if (!handlerItem) return undefined;
        const data = await handlerItem.import();
        if (typeof data?.execute === 'function') {
            return data.execute.call({ $item: handlerItem, $context: item }, params, request.post);
        }
    }
    catch {
        // handler not found or not executable on server
    }
    return undefined;
}

function resolveClassMethod(item, method, params, request) {
    if (!(method in item)) {
        let prop;
        let t = item;
        while (t && !prop) {
            prop = Object.getOwnPropertyDescriptor(t, method);
            t = t.__proto__;
        }
        if (prop) {
            if (prop.value) {
                if (typeof prop.value === 'function')
                    return prop.value.call(item, params, request.post);
                return prop.value;
            }
            else if (prop.set && request.post)
                return prop.set.call(item, request.post);
        }
        return null;
    }
    const handler = item[method];
    if (typeof handler === 'function')
        return handler.call(item, params);
    return handler;
}

export function execItemMethod(item, method, params, request) {
    if (!(item instanceof CORE.$folder))
        return item;

    method ||= item[request.method];
    if (!method)
        return item;

    const runMethod = async () => {
        const classResult = resolveClassMethod(item, method, params, request);
        if (classResult !== null)
            return classResult;

        const handlerResult = await tryHandlerMethod(item, method, params, request);
        if (handlerResult !== undefined)
            return handlerResult;

        throw new Error(`Unknown method "${method}" for:<br>${item.path}`);
    };

    return runMethod();
}
