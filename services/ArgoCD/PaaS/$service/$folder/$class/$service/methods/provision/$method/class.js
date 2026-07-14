export default {
    async execute(params = {}, post) {
        const orderFile = params.$context || params.orderFile;
        let order = params.order;
        if (!order && post)
            order = typeof post === 'string' ? safeParse(post) : post;
        if (!order && orderFile?.load) {
            const raw = await orderFile.load({ encoding: 'utf-8' });
            order = typeof raw === 'string' ? safeParse(raw) : raw;
        }
        if (!order)
            throw new Error('provision: нет данных заявки');

        const skip = ['в процессе создания', 'работает', 'остановлен'];
        if (order.status && skip.includes(order.status))
            return { ok: true, skipped: true, status: order.status, paasPath: order.paasPath };

        const service = await resolveService(params, orderFile);
        const subdomain = order.subdomain;
        let baseDomain = service?.baseDomain ?? service?.DATA?.baseDomain;
        if (baseDomain && typeof baseDomain.then === 'function')
            baseDomain = await baseDomain;
        baseDomain = String(baseDomain || '').replace(/^\.+/, '');
        const fqdn = order.fqdn || (subdomain + '.' + baseDomain);
        const url = order.url || ('https://' + fqdn);
        const buyer = order.buyer;
        const tariff = order.tariff;

        if (!subdomain)
            throw new Error('provision: нет subdomain');

        const appSpec = {
            metadata: { name: subdomain },
            spec: {
                project: service.defaultProject || service.DATA?.defaultProject || 'default',
                source: { stub: true, note: 'Helm chart будет задан позже' },
                destination: {
                    server: service.destinationServer || service.DATA?.destinationServer || 'https://kubernetes.default.svc',
                    namespace: subdomain,
                },
            },
        };

        let argoResult = { ok: true, stub: true };
        try {
            const argo = await resolveArgo(service);
            const methods = await argo?._methods;
            const createApp = methods?.createApplication;
            if (typeof createApp?.execute === 'function') {
                argoResult = await createApp.execute({
                    $service: argo,
                    spec: appSpec,
                    user: globalThis.WORK,
                });
            }
        } catch (e) {
            console.warn('[provision] createApplication:', e.message);
            argoResult = { ok: false, error: e.message, stub: true };
        }

        const paasRoot = await WORK.get_item('/paas');
        if (!paasRoot?.create)
            throw new Error('provision: /paas недоступен');

        const paasPath = '/paas/' + subdomain;
        let paasItem = await WORK.get_item(paasPath, 0, undefined, { user: globalThis.WORK });
        if (!paasItem || paasItem.type !== '$paas') {
            if (paasItem && paasRoot.__items__)
                delete paasRoot.__items__[subdomain];
            paasRoot.reset?.();
            await paasRoot.create({
                type: '$paas',
                id: subdomain,
                post: toDataJs({
                    label: subdomain,
                    tariff,
                    subdomain,
                    fqdn,
                    url,
                    status: 'в процессе создания',
                    buyer,
                    usersActiveToday: 0,
                    '#security': buyer ? { admin: buyer, users: [buyer] } : {},
                }),
                user: globalThis.WORK,
            });
            paasItem = await WORK.get_item(paasPath, 0, undefined, { user: globalThis.WORK });
        }
        if (paasItem && paasItem.type !== '$paas' && paasRoot.__items__) {
            delete paasRoot.__items__[subdomain];
            paasRoot.reset?.();
            paasItem = await WORK.get_item(paasPath, 0, undefined, { user: globalThis.WORK });
        }
        if (!paasItem || paasItem.type !== '$paas')
            throw new Error('provision: не удалось создать $paas ' + paasPath);

        if (buyer && paasItem?.save) {
            try {
                await paasItem.info?.();
                const data = Object.assign({}, paasItem.DATA || {});
                const security = Object.assign({}, data['#security'] || {});
                security.admin = security.admin || buyer;
                const users = Array.isArray(security.users) ? security.users.slice() : [];
                if (!users.includes(buyer))
                    users.push(buyer);
                security.users = users;
                data['#security'] = security;
                data.status = data.status || 'в процессе создания';
                data.tariff = data.tariff || tariff;
                data.subdomain = data.subdomain || subdomain;
                data.fqdn = data.fqdn || fqdn;
                data.url = data.url || url;
                data.buyer = data.buyer || buyer;
                await paasItem.save({
                    filename: 'class.js',
                    post: toDataJs(data),
                    user: globalThis.WORK,
                    ignore_save_logs: true,
                });
                paasItem.reset?.();
            } catch (e) {
                console.warn('[provision] set #security.users:', e.message);
            }
        }

        let nodePath = null;
        const deployed = argoResult?.ok && argoResult?.stub !== true;
        if (deployed) {
            const nodesRoot = await WORK.get_item('/nodes');
            if (nodesRoot?.create) {
                nodePath = '/nodes/' + fqdn;
                const nodeItem = await WORK.get_item(nodePath, 0, undefined, { user: globalThis.WORK });
                if (!nodeItem || nodeItem.type !== '$node') {
                    await nodesRoot.create({
                        type: '$node',
                        id: fqdn,
                        post: toDataJs({
                            label: fqdn,
                            url,
                            subdomain,
                            fqdn,
                            paasPath,
                            remote: { url, fqdn, status: 'ready' },
                        }),
                        user: globalThis.WORK,
                    });
                }
                try {
                    if (paasItem?.save) {
                        await paasItem.info?.();
                        await paasItem.save({
                            filename: 'class.js',
                            post: toDataJs({
                                ...(paasItem.DATA || {}),
                                status: 'работает',
                                nodePath,
                            }),
                            user: globalThis.WORK,
                            ignore_save_logs: true,
                        });
                    }
                } catch (e) {
                    console.warn('[provision] update paas status:', e.message);
                }
            }
        }

        if (orderFile?.path) {
            try {
                const fsp = await import('node:fs/promises');
                order.status = 'в процессе создания';
                order.argo = argoResult;
                order.paasPath = paasPath;
                order.nodePath = nodePath;
                order.provisioned = Date.now();
                await fsp.writeFile('.' + orderFile.path, JSON.stringify(order, null, 2), 'utf-8');
            } catch (e) {
                console.warn('[provision] update order:', e.message);
            }
        }

        return {
            ok: true,
            stub: !!argoResult?.stub,
            paasPath,
            nodePath,
            status: 'в процессе создания',
            argo: argoResult,
        };
    },
};

async function resolveService(params, orderFile) {
    if (params.$service?.save_file)
        return params.$service;
    const fromOrder = orderFile?.$class || orderFile?.$owner || orderFile?.$class;
    if (fromOrder?.type === '$service')
        return fromOrder;
    return WORK.get_item('/services/ArgoCD/PaaS/prod');
}

async function resolveArgo(paasService) {
    let p = paasService?.$parent || paasService?.parent;
    while (p) {
        if (p.type === '$service' && (p.path === '/services/ArgoCD' || p.id === 'ArgoCD'))
            return p;
        p = p.$parent || p.parent;
    }
    return WORK.get_item('/services/ArgoCD');
}

function toDataJs(obj) {
    const C = globalThis.WORK?.constructor;
    if (typeof C?.toScript === 'function')
        return 'export default ' + C.toScript(obj);
    return 'export default ' + JSON.stringify(obj, null, 4);
}

function safeParse(s) {
    try { return JSON.parse(s); }
    catch { return null; }
}
