/**
 * PaaS — сервис заявок и развёртывания.
 *
 * Серверные методы — на экземпляре (как Weather), вызываются через fetch.
 * pass.order → $service/order/ (подпапка по расширению).
 */
export default {
    icon: 'carbon:ibm-cloud-pak-applications',
    label: 'PaaS',
    baseDomain: 'odant.org',
    url: 'https://argocd.odant.org',
    insecure: false,
    project: 'bis-work-app',
    repoURL: 'https://binaries.odant.org/helm/bis-work/develop',
    chart: 'bis-work',
    targetRevision: '*',
    destinationServer: 'https://kubernetes.default.svc',
    destinationNamespace: 'bis-work',
    syncPrune: true,
    syncSelfHeal: true,

    ORDER_STATUSES: {
        'in_processing': 'в обработке',
        'rejected': 'отвергнута',
        'in_progress': 'в работе',
        'completed': 'завершена',
    },

    /** Папка history pass.order: meta/order/.pass.order/history */
    _ordersHistoryDir() {
        const base = this.meta_folder?.dir || this.dir;
        return base + '/order/.pass.order/history';
    },

    async _readOrder(orderPath) {
        const fsp = await import('node:fs/promises');
        return JSON.parse(await fsp.readFile(orderPath, 'utf-8'));
    },

    async _writeOrder(orderPath, order) {
        const fsp = await import('node:fs/promises');
        await fsp.writeFile(orderPath, JSON.stringify(order, null, 2), 'utf-8');
    },

    /** Список заявок из history (новые сверху). */
    async listOrders() {
        const fsp = await import('node:fs/promises');
        const path = await import('node:path');
        const historyDir = this._ordersHistoryDir();
        const statuses = this.ORDER_STATUSES || {};
        const orders = [];
        let dates;
        try { dates = await fsp.readdir(historyDir); }
        catch { return []; }
        for (const day of dates) {
            const dayDir = path.join(historyDir, day);
            let files;
            try { files = await fsp.readdir(dayDir); }
            catch { continue; }
            for (const f of files) {
                if (!f.endsWith('.order'))
                    continue;
                const fp = path.join(dayDir, f);
                try {
                    const order = JSON.parse(await fsp.readFile(fp, 'utf-8'));
                    const status = order.status || '';
                    const nameParts = f.split('.');
                    const created = order.created || Number(nameParts[0]) || 0;
                    const domainName = order.input?.domainName || order.subdomain || '';
                    const productLabel = order.product?.label || order.tariff || '';
                    orders.push({
                        path: fp,
                        $Link: order.$Link || '',
                        domainName,
                        productLabel,
                        subdomain: domainName,
                        fqdn: order.fqdn || '',
                        tariff: productLabel,
                        product: order.product || null,
                        input: order.input || null,
                        buyer: order.buyer || nameParts[1] || '',
                        created,
                        status,
                        uiStatus: statuses[status] ?? 'в обработке',
                        error: order.error || '',
                    });
                }
                catch { /* битый снимок */ }
            }
        }
        orders.sort((a, b) => (b.created || 0) - (a.created || 0));
        return orders;
    },

    /** Принять: in_progress → provision. */
    async acceptOrder(params = {}, post) {
        const orderPath = params.orderPath || post?.orderPath;
        if (!orderPath)
            throw new Error('Нет пути заявки');
        const order = await this._readOrder(orderPath);
        const statuses = this.ORDER_STATUSES || {};
        const st = order.status || '';
        if (st && st !== 'in_processing')
            throw new Error('Заявка уже обработана: ' + (statuses[st] || st));

        order.status = 'in_progress';
        order.acceptedAt = Date.now();
        delete order.error;
        await this._writeOrder(orderPath, order);

        let baseDomain = this.baseDomain ?? this.DATA?.baseDomain;
        if (baseDomain && typeof baseDomain.then === 'function')
            baseDomain = await baseDomain;
        baseDomain = String(baseDomain || '').replace(/^\.+/, '');
        let checkDnsUrl = this.checkDnsUrl ?? this.DATA?.checkDnsUrl;
        if (checkDnsUrl && typeof checkDnsUrl.then === 'function')
            checkDnsUrl = await checkDnsUrl;
        checkDnsUrl = String(checkDnsUrl || '').trim();
        if (baseDomain && checkDnsUrl) {
            order.dns = { skipped: true, reason: 'not ready' };
            await this._writeOrder(orderPath, order);
        }

        const domainName = order.input?.domainName || order.subdomain;
        if (!domainName)
            throw new Error('В заявке нет имени домена');

        try {
            const result = await this.provision({ order, orderPath }, order);
            order.provision = result;
            await this._writeOrder(orderPath, order);
            return { ok: true, order, provision: result };
        } catch (e) {
            order.error = e.message;
            await this._writeOrder(orderPath, order);
            throw e;
        }
    },

    async rejectOrder(params = {}, post) {
        const orderPath = params.orderPath || post?.orderPath;
        if (!orderPath)
            throw new Error('Нет пути заявки');
        const order = await this._readOrder(orderPath);
        if (order.status === 'in_progress' || order.status === 'completed')
            throw new Error('Заявка уже в работе/завершена');
        order.status = 'rejected';
        order.rejectedAt = Date.now();
        delete order.error;
        await this._writeOrder(orderPath, order);
        return { ok: true, order };
    },

    async completeOrder(params = {}, post) {
        const orderPath = params.orderPath || post?.orderPath;
        if (!orderPath)
            throw new Error('Нет пути заявки');
        const order = await this._readOrder(orderPath);
        if (order.status !== 'in_progress')
            throw new Error('Завершить можно только заявку в работе');
        order.status = 'completed';
        order.completedAt = Date.now();
        await this._writeOrder(orderPath, order);
        return { ok: true, order };
    },

    /**
     * Развернуть /PAAS/{domainName} + createApplication.
     * @param {any} params
     * @param {any} post
     */
    async provision(params = {}, post) {
        let order = params.order;
        if (!order && post)
            order = typeof post === 'string' ? safeParse(post) : post;
        if (!order)
            throw new Error('provision: нет данных заявки');

        const orderPath = params.orderPath || params.orderFile?.path || '';
        const domainName = order.input?.domainName || order.subdomain;
        const productLabel = order.product?.label || order.tariff || '';
        let baseDomain = this.baseDomain ?? this.DATA?.baseDomain;
        if (baseDomain && typeof baseDomain.then === 'function')
            baseDomain = await baseDomain;
        baseDomain = String(baseDomain || '').replace(/^\.+/, '');
        const fqdn = order.fqdn || (domainName && baseDomain ? (domainName + '.' + baseDomain) : '');
        const url = order.url || (fqdn ? ('https://' + fqdn) : '');
        const buyer = order.buyer;

        if (!domainName)
            throw new Error('provision: нет имени домена (input.domainName)');

        let argoResult = { ok: true, stub: true };
        try {
            argoResult = await this.createApplication({
                name: domainName,
                namespace: this.destinationNamespace || domainName,
            });
        } catch (e) {
            console.warn('[provision] createApplication:', e.message);
            argoResult = { ok: false, error: e.message, stub: true };
        }

        const paasRoot = await WORK.get_item('/PAAS');
        if (!paasRoot?.create)
            throw new Error('provision: /PAAS недоступен');

        const paasPath = '/PAAS/' + domainName;
        let paasItem = await WORK.get_item(paasPath, 0, undefined, { user: globalThis.WORK });
        if (!paasItem || paasItem.type !== '$paas') {
            if (paasItem && paasRoot.__items__)
                delete paasRoot.__items__[domainName];
            paasRoot.reset?.();
            await paasRoot.create({
                type: '$paas',
                id: domainName,
                post: toDataJs({
                    label: domainName,
                    tariff: productLabel,
                    subdomain: domainName,
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
            delete paasRoot.__items__[domainName];
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
                data.tariff = data.tariff || productLabel;
                data.subdomain = data.subdomain || domainName;
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
        if (deployed && fqdn) {
            const nodesRoot = await WORK.get_item('/NODES');
            if (nodesRoot?.create) {
                nodePath = '/NODES/' + fqdn;
                const nodeItem = await WORK.get_item(nodePath, 0, undefined, { user: globalThis.WORK });
                if (!nodeItem || nodeItem.type !== '$node') {
                    await nodesRoot.create({
                        type: '$node',
                        id: fqdn,
                        post: toDataJs({
                            label: fqdn,
                            url,
                            subdomain: domainName,
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

        if (orderPath) {
            try {
                const fsp = await import('node:fs/promises');
                order.argo = argoResult;
                order.paasPath = paasPath;
                order.nodePath = nodePath;
                order.provisioned = Date.now();
                await fsp.writeFile(orderPath, JSON.stringify(order, null, 2), 'utf-8');
            } catch (e) {
                console.warn('[provision] update order:', e.message);
            }
        }

        return {
            ok: true,
            stub: !!argoResult?.stub,
            paasPath,
            nodePath,
            argo: argoResult,
        };
    },
};

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
