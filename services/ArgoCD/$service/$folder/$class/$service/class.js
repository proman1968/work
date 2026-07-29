/**
 * ArgoCD — базовая точка подключения к Argo CD.
 *
 * STATIC — параметры подключения и шаблон Application (тело POST /api/v1/applications).
 * Token хранится только в #secret/argocd.json и никогда не отдаётся на клиент.
 *
 * Серверные методы (по канону Weather/SearXNG — прямо в class.js):
 *   tokenStatus / saveToken           — управление token в #secret
 *   checkDnsName                       — проверка свободности имени через ns1.odant.org
 *   createApplication                 — POST заявки в Argo CD API
 *   listOrders / acceptOrder / rejectOrder / completeOrder — заявки клиентов
 *
 * Статусы заявки (в JSON записи .order в history pass.order):
 *   ''            — ещё не обработана (default после submitOrder)
 *   'rejected'    — отвергнута
 *   'in_progress' — запущена в работу
 *   'completed'   — завершена вручную
 *
 * Тело pass.order: { status, $Link → .bid, product (снимок), input: { domainName } }.
 * Продукт — не enum тарифов; имя хоста — input.domainName.
 */
export default {
    icon: 'carbon:kubernetes',
    label: 'Argo CD',
    METADATA: {
        STATIC: {
            id: 'STATIC',
            icon: 'iconoir:input-field',
            fields: [{
                id: 'url',
                type: 'String',
                placeholder: 'https://argocd.example.com',
                required: true,
            }, {
                id: 'insecure',
                type: 'Boolean',
                placeholder: 'false',
            }, {
                id: 'project',
                type: 'String',
                placeholder: 'default',
            }, {
                id: 'repoURL',
                type: 'String',
                placeholder: 'https://binaries.example.com/helm/chart/develop',
            }, {
                id: 'chart',
                type: 'String',
                placeholder: 'chart',
            }, {
                id: 'targetRevision',
                type: 'String',
                placeholder: '*',
            }, {
                id: 'destinationServer',
                type: 'String',
                placeholder: 'https://kubernetes.default.svc',
            }, {
                id: 'destinationNamespace',
                type: 'String',
                placeholder: 'default',
            }, {
                id: 'syncPrune',
                type: 'Boolean',
                placeholder: 'true',
            }, {
                id: 'syncSelfHeal',
                type: 'Boolean',
                placeholder: 'true',
            }],
        },
    },

    /** Статусы заявки для UI/методов. */
    ORDER_STATUSES: {
        '': 'в обработке',
        'rejected': 'отвергнута',
        'in_progress': 'в работе',
        'completed': 'завершена',
    },

    // ── token (#secret) ─────────────────────────────────────────────

    /** Признак заданного token (без значения). */
    async tokenStatus() {
        const s = /** @type {any} */ (this);
        const secret = await s.read_secret({ filename: 'argocd.json' });
        return { tokenSet: !!secret?.token };
    },

    /** Записать новый token в #secret; пустой ввод — no-op.
     * @param {any} params
     * @param {any} post
     */
    async saveToken(params = {}, post) {
        const s = /** @type {any} */ (this);
        const token = String(typeof post === 'string' ? post : (params.token || '')).trim();
        if (!token)
            return { ok: false, skipped: true };
        await s.save_secret({ filename: 'argocd.json', post: JSON.stringify({ token }) });
        return { ok: true };
    },

    // ── DNS ────────────────────────────────────────────────────────

    /** Свободно ли имя (резолв через ns1.odant.org: IP без ошибки ⇒ занято).
     * @param {any} params
     */
    async checkDnsName(params = {}) {
        const dns = await import('node:dns').then(m => m.promises);
        const fqdn = String(params.fqdn || params.name || '').trim().toLowerCase();
        if (!fqdn)
            return { free: false, message: 'Нет имени' };
        const resolver = new dns.Resolver();
        try {
            const servers = await dns.resolve4('ns1.odant.org');
            if (servers?.length)
                resolver.setServers(servers);
        } catch { /* системный resolver */ }
        try {
            const ips = await resolver.resolve4(fqdn);
            if (ips?.length)
                return { free: false, message: 'Имя занято', ips };
            return { free: true };
        } catch (e) {
            const code = /** @type {any} */ (e).code;
            if (['ENOTFOUND', 'ESERVFAIL', 'EAI_AGAIN'].includes(code))
                return { free: true };
            return { free: true, message: /** @type {any} */ (e).message };
        }
    },

    // ── Argo CD API ─────────────────────────────────────────────────

    /** HTTP-запрос к Argo CD с Bearer из #secret; поддерживает insecure.
     * @param {any} path
     * @param {any} opts
     */
    async _argoRequest(path, opts = {}) {
        const s = /** @type {any} */ (this);
        const method = opts.method || 'GET';
        const url = String(s.url || '').replace(/\/$/, '') + path;
        if (!url)
            throw new Error('URL ArgoCD не задан');
        const secret = await s.read_secret({ filename: 'argocd.json' });
        const token = secret?.token;
        if (!token)
            throw new Error('Token ArgoCD не задан');
        const headers = /** @type {any} */ ({ 'Authorization': 'Bearer ' + token });
        if (opts.body !== undefined)
            headers['Content-Type'] = 'application/json';
        const u = new URL(url);
        const lib = u.protocol === 'https:' ? await import('node:https') : await import('node:http');
        const agent = u.protocol === 'https:' ? new lib.Agent({ rejectUnauthorized: !s.insecure }) : undefined;
        return new Promise((resolve, reject) => {
            const req = lib.request(url, { method, headers, agent }, (res) => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => resolve({
                    ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
                    status: res.statusCode,
                    data,
                }));
            });
            req.on('error', reject);
            req.setTimeout(15000, () => req.destroy(new Error('Таймаут ArgoCD API')));
            if (opts.body !== undefined)
                req.write(opts.body);
            req.end();
        });
    },

    /** Собрать тело Application из STATIC + параметров заявки.
     * @param {any} params
     */
    _buildAppSpec(params = {}) {
        const s = /** @type {any} */ (this);
        const name = params.name || params.subdomain;
        return {
            metadata: { name },
            spec: {
                project: s.project || 'default',
                source: {
                    repoURL: s.repoURL || '',
                    chart: s.chart || '',
                    targetRevision: s.targetRevision || '*',
                },
                destination: {
                    server: s.destinationServer || 'https://kubernetes.default.svc',
                    namespace: params.namespace || s.destinationNamespace || name || 'default',
                },
                syncPolicy: {
                    automated: {
                        prune: s.syncPrune ?? true,
                        selfHeal: s.syncSelfHeal ?? true,
                    },
                },
            },
        };
    },

    /** POST /api/v1/applications — развернуть экземпляр.
     * @param {any} params
     */
    async createApplication(params = {}) {
        const s = /** @type {any} */ (this);
        const spec = params.spec || this._buildAppSpec({
            name: params.name || params.subdomain,
            namespace: params.namespace,
        });
        const res = await this._argoRequest('/api/v1/applications', {
            method: 'POST',
            body: JSON.stringify(spec),
        });
        if (!res.ok)
            throw new Error('ArgoCD API ' + res.status + ': ' + res.data);
        try { return JSON.parse(res.data); }
        catch { return { ok: true, raw: res.data }; }
    },

    // ── заявки (.order в history) ───────────────────────────────────

    /** Папка history файла pass.order (на диске).
     * save_file кладёт pass.order в meta/order/ (подпапка по расширению). */
    _ordersHistoryDir() {
        const s = /** @type {any} */ (this);
        const base = s.meta_folder?.dir || s.dir;
        return base + '/order/.pass.order/history';
    },

    /** @param {any} orderPath */
    async _readOrder(orderPath) {
        const fsp = await import('node:fs/promises');
        const raw = await fsp.readFile(orderPath, 'utf-8');
        return JSON.parse(raw);
    },

    /** @param {any} orderPath @param {any} order */
    async _writeOrder(orderPath, order) {
        const fsp = await import('node:fs/promises');
        await fsp.writeFile(orderPath, JSON.stringify(order, null, 2), 'utf-8');
    },

    /** Список заявок из history снимков pass.order (новые сверху). */
    async listOrders() {
        const s = /** @type {any} */ (this);
        const fsp = await import('node:fs/promises');
        const path = await import('node:path');
        const historyDir = this._ordersHistoryDir();
        const statuses = s.ORDER_STATUSES || {};
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
                catch { /* битый снимок пропускаем */ }
            }
        }
        orders.sort((a, b) => (b.created || 0) - (a.created || 0));
        return orders;
    },

    /** Принять заявку: in_progress → DNS → provision (PaaS) или createApplication.
     * @param {any} params
     * @param {any} post
     */
    async acceptOrder(params = {}, post) {
        const s = /** @type {any} */ (this);
        const orderPath = params.orderPath || post?.orderPath;
        if (!orderPath)
            throw new Error('Нет пути заявки');
        const order = await this._readOrder(orderPath);
        const statuses = s.ORDER_STATUSES || {};
        if (order.status && order.status !== '')
            throw new Error('Заявка уже обработана: ' + (statuses[order.status] || order.status));

        order.status = 'in_progress';
        order.acceptedAt = Date.now();
        delete order.error;
        await this._writeOrder(orderPath, order);

        let baseDomain = s.baseDomain ?? s.DATA?.baseDomain;
        if (baseDomain && typeof baseDomain.then === 'function')
            baseDomain = await baseDomain;
        baseDomain = String(baseDomain || '').replace(/^\.+/, '');
        let checkDnsUrl = s.checkDnsUrl ?? s.DATA?.checkDnsUrl;
        if (checkDnsUrl && typeof checkDnsUrl.then === 'function')
            checkDnsUrl = await checkDnsUrl;
        checkDnsUrl = String(checkDnsUrl || '').trim();

        // DNS-проверка полного имени — только когда заданы baseDomain и checkDnsUrl.
        // HTTP к checkDnsUrl ещё не готов: гейт оставлен, пока всегда skip.
        if (baseDomain && checkDnsUrl) {
            order.dns = { skipped: true, reason: 'not ready' };
            await this._writeOrder(orderPath, order);
        }

        const domainName = order.input?.domainName || order.subdomain;
        if (!domainName)
            throw new Error('В заявке нет имени домена');

        try {
            if (typeof s.provision === 'function') {
                const result = await s.provision({ order, orderPath }, order);
                order.provision = result;
                await this._writeOrder(orderPath, order);
                return { ok: true, order, provision: result };
            }
            const argo = await this.createApplication({
                name: domainName,
                namespace: s.destinationNamespace || domainName,
            });
            order.argo = argo;
            await this._writeOrder(orderPath, order);
            return { ok: true, order };
        } catch (e) {
            order.error = /** @type {any} */ (e).message;
            await this._writeOrder(orderPath, order);
            throw e;
        }
    },

    /** Отвергнуть заявку.
     * @param {any} params
     * @param {any} post
     */
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

    /** Завершить заявку (вручную, только из in_progress).
     * @param {any} params
     * @param {any} post
     */
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
};
