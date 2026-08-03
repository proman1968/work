export default {
    icon: 'carbon:reset',
    get allowUse(){
        return !WORK.DEV_MODE;
    },
    execute() {
        return this.$context.fetch('toggleDevMode', {}, { value: true });
    }
}