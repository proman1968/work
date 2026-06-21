export default {
    async execute() {
        const data = {
            title: 'test notification title',
            body: 'test notification body'
        };
        WORK.sendPushNotification(this.$context.id, data);
    },
    get allowUse() {
        return true
    }
}