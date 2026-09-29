/**
 * $node — узел сети WORK в реестре `/NODES` (сам `/NODES` — тоже $node: корень реестра).
 *
 * Взаимный доступ:
 *  - у нас: `/NODES/SRV` — локальный класс удалённого сервера; в его ROLES — роли, объявленные на SRV;
 *    в `#security` мы назначаем НАШИХ пользователей на роли SRV (Иванов → CUSTOMER: наш
 *    представитель по закупкам у SRV). Только такой пользователь может действовать на SRV в этой роли.
 *  - у SRV: наш сервер добавлен в его `/NODES` и как субъект (host_id) назначен на его точку
 *    (например, «Продажи» → CUSTOMER). Запрос приходит подписанным ключом нашего сервера.
 * Субъект-узел в чужом дереве: права узла, ограниченные ролью, заявленной представителем.
 */
import { $class } from './class.js';

const ACCESS_DENIED = 'Доступ запрещён';

export class $node extends $class {
    static sourceUrl = import.meta.url;

    /** Корень реестра (/NODES), а не конкретный узел. */
    get isRegistry() {
        return !(this.$parent instanceof $node);
    }

    /** Идентификатор субъекта узла в #security других классов — id его сервера. */
    get principalId() {
        return this.DATA?.host_id ? String(this.DATA.host_id).toUpperCase() : this.id;
    }

    async _assertRegistry() {
        await this.init;
        if (!this.isRegistry)
            throw new Error('Метод реестра узлов вызывается на /NODES');
    }

    async _assertNode() {
        await this.init;
        if (this.isRegistry)
            throw new Error('Метод узла вызывается на узле /NODES/<узел>');
    }

    /**
     * Добавить узел сети в реестр. Первый вызов возвращает карточку узла и отпечаток ключа;
     * повторный вызов с тем же fingerprint (сверенным с администратором узла) — добавляет.
     * @param {object} params
     * @param {string} params.origin Адрес узла (https://host)
     * @param {string} [params.fingerprint] Подтверждённый отпечаток ключа узла
     * @param {string} [params.label] Название узла в реестре
     * @param {boolean} [params.announce] Публиковать узел в нашей карточке (реестр сети)
     * @returns {Promise<object>} {confirm, card} | {added, fingerprint}
     */
    async node_add(params = {}) {
        await this.assertAccess(params, $class.ACCESS_LEVEL.ADMIN);
        await this._assertRegistry();
        const { addNode } = await import('../modules/nodes/registry.js');
        return addNode(this, params);
    }

    /**
     * Граф сети для визуализации: наш сервер, узлы реестра и их объявленные соседи.
     * @param {object} [params]
     * @param {number} [params.depth] Глубина обхода (1–3, по умолчанию 2)
     * @returns {Promise<{nodes: Array, edges: Array}>} Узлы и связи
     */
    async network_graph(params = {}) {
        await this.assertAccess(params, $class.ACCESS_LEVEL.READ);
        const { networkGraph } = await import('../modules/nodes/registry.js');
        return networkGraph({ depth: params.depth });
    }

    /**
     * Обновить карточку узла: роли, объявленные на нём, назначения нашего сервера у него.
     * Смена ключа узла блокирует его (status key_changed) до решения администратора.
     * @param {object} [params]
     * @returns {Promise<object>} {status, remote}
     */
    async node_refresh(params = {}) {
        await this.assertAccess(params, $class.ACCESS_LEVEL.ADMIN);
        await this._assertNode();
        const { refreshNode } = await import('../modules/nodes/registry.js');
        return refreshNode(this, params);
    }

    /**
     * Действовать на удалённом узле от имени нашего сервера: вызов метода элемента узла
     * представителем в роли узла, на которую он назначен у нас (#security этого класса).
     * @param {object} params
     * @param {string} params.as Роль на удалённом узле (CUSTOMER и т.п.)
     * @param {string} params.path Путь элемента на удалённом узле
     * @param {string} [params.method] Метод (по умолчанию info)
     * @param {object} [params.args] Параметры метода
     * @returns {Promise<*>} Ответ удалённого узла
     */
    async remote(params = {}, post) {
        await this._assertNode();
        const body = post && typeof post === 'object' && !Buffer.isBuffer(post) ? post : {};
        const as = String(params.as ?? body.as ?? '');
        const path = String(params.path ?? body.path ?? '/');
        const method = String(params.method ?? body.method ?? 'info');
        let args = params.args ?? body.args ?? {};
        if (typeof args === 'string') {
            try { args = JSON.parse(args); } catch { args = {}; }
        }
        const session = params.session;
        const uid = $class.resolveUid(params);
        if (!uid || session?.principal?.kind === 'node')
            throw new Error(ACCESS_DENIED);
        if (this.DATA.status !== 'active')
            throw new Error('Узел не активен: ' + (this.DATA.status || 'pending'));
        const declared = await this.declared_roles;
        if (!declared[as] || ['ADMIN', 'BOSS'].includes(as))
            throw new Error('Роль «' + as + '» не объявлена узлом');
        // представитель — только назначенный у нас на эту роль узла (локально, не по наследованию)
        if (!this._roleIds(as, declared).includes(uid)) {
            const { audit } = await import('./access/audit.js');
            audit('deny', { path: this.path, method: 'remote', reason: 'not representative', as, params });
            throw new Error(ACCESS_DENIED);
        }
        const { nodeFetch } = await import('../modules/nodes/outbound.js');
        const { audit } = await import('./access/audit.js');
        audit('node_out', { node: this.principalId, as, path, method, params });
        return nodeFetch(this.DATA, {
            path, method, params: args, post: body.post,
            actor: uid, actorLabel: session?.$user?.label, roles: [as],
        });
    }
}
$node.type_chain = Object.create(null);
