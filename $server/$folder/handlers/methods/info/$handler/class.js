export default {
    icon: 'bootstrap:info-square',
    /** Страница info — только роль ADMIN. */
    roles: ['ADMIN'],
    execute() {
        window.open(this.$context.short + '?info');
    },
}