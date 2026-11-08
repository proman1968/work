export default{
    $public:{
        form: 'chat'
    },
    METADATA: {},
    /**
     * Мета ролей: внешний вид и субъекты. Поведение системной роли
     * (BOSS) — в коде (sources/server/access/policy.js), данными
     * меняется только отображение. Остальные роли действуют в своей точке.
     */
    ROLES: {
        BOSS: { label: 'Руководитель', icon: 'fontawesome:s-user-tie', color: 'indigo' },
        USER: { label: 'Исполнитель', icon: 'fontawesome:s-user-pen', color: 'indigo', principals: ['user', 'node'] },
    }
}
