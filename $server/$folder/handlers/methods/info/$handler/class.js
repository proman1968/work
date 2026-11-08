export default {
    icon: 'bootstrap:info-square',
    /** Страница info — только роль BOSS. */
    roles: ['BOSS'],
    execute() {
        window.open(this.$context.short + '?info');
    },
}