import { parsePathSteps } from '../shared/path-syntax.js';

export async function resolveGetItem(item, path = [], deep = 0, $tilde) {
    const steps = parsePathSteps(path);
    let step = steps.shift();
    const first_char = step?.[0];
    let result;

    switch (first_char) {
        case undefined:
        case '': {
            if (deep && steps.join()) {
                step = steps.shift();
                let folders = [item];
                result = [];
                while (folders.length) {
                    let next = await folders.map(f => f.get_item(step, deep + 1, $tilde));
                    next = await Promise.all(next);
                    next = next.flat().filter(Boolean);
                    if (next.length) {
                        result = next;
                        break;
                    }
                    folders = folders.filter(f => !f.isMetaFolder);
                    if (!item.isType)
                        folders = folders.filter(f => !f.isType);
                    folders = folders.map(f => f.children);
                    folders = await Promise.all(folders);
                    folders = folders.flat().filter(Boolean);
                }
                if (result.length === 0) {
                    if (step[0] === '$' && item.id[0] === '$')
                        result = item;
                    else
                        result = null;
                }
                else
                    result = result.last;
            }
            else if ($tilde) {
                return WORK.getIndexForPage(item, $tilde);
            }
            else {
                result = item;
            }
        } break;
        case '~': {
            const inherit = step.slice(1);
            if (inherit)
                result = await item.collect_tilde({ inherit });
            else
                result = await item.tilde;
            const next = steps.shift();
            if (next)
                result = result.filter(f => f.id === next);
            $tilde = item;
        } break;
        case '@': {
            result = await item[step.slice(1) || 'ancestor'];
            if (result === undefined) {
                result = await item.children;
                result = result.find(f => f.id === step);
            }
        } break;
        case '*': {
            result = (await item.children).flat(Infinity).filter(Boolean);
            step = step.slice(1);
            if (step) {
                result = result.filter(f => f.id.endsWith(step));
            }
        } break;
        case '.': {
            if (step === '.')
                result = item;
        }
        default: {
            if (!result && item.constructor.server_item && step === 'index.html') {
                switch (item.type) {
                    case '$handler': {
                        return WORK.getIndexForPage(item, $tilde);
                    }
                    case '$folder': {
                        result = await item._get_item(step);
                        if (!result) {
                            const file = await item._get_item(item.id + '.js');
                            if (file) {
                                result = WORK.getIndexForTest(file);
                            }
                        }
                    }
                }
            }
            if (!result) {
                result = await item.children;
                result = result.find(f => f.id === step);
            }
        } break;
    }
    if (result) {
        if (steps.length > 0) {
            deep++;
            if (Array.isArray(result)) {
                result = result.filter(f => !f.isMetaFolder);
                if (!item.isType)
                    result = result.filter(f => !f.isType);
                result = result.map(child => child.get_item(steps, deep, $tilde));
                result = await Promise.all(result);
                result = result.flat(Infinity).filter(Boolean);
            }
            else
                result = await result.get_item(steps, deep, $tilde);
        }
    }
    else if (steps.includes('*'))
        result = [];

    if (Array.isArray(result)) {
        if (steps.last === 'index.html')
            result = result.last;
        else if (result.length && result.last?.info)
            await Promise.all(result.map(child => child.info()));
        else if ($tilde && !result.length)
            result = null;
    }
    else if (result?.info)
        await result?.info?.();

    return result;
}
