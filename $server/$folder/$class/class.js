export default{
    $public:{
        form: 'chat'
    },
    METADATA: {},
    /**
     * Мета ролей: внешний вид и субъекты. Поведение системных ролей
     * (ADMIN, BOSS) — в коде (sources/server/access/policy.js), данными
     * меняется только отображение. Остальные роли действуют в своей точке.
     */
    ROLES: {
        ADMIN: { label: 'Администратор', icon: 'fontawesome:s-user-shield', color: 'darkred' },
        BOSS: { label: 'Руководитель', icon: 'fontawesome:s-user-tie', color: 'blue' },
        USER: { label: 'Исполнитель', icon: 'fontawesome:s-user-pen', color: 'indigo', principals: ['user', 'node'] },
        GUEST: { label: 'Гость', icon: 'fontawesome:s-user', color: 'teal', principals: ['user', 'node'] },
    }
}
