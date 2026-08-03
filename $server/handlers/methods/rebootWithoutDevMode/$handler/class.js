export default {
    icon: 'carbon:reset-alt',
    get allowUse(){
        return WORK.DEV_MODE;
    },
    execute() {
        return this.$context.fetch('toggleDevMode', {}, { value: false });
    }
}