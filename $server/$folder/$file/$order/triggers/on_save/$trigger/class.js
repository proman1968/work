export default {
    label: 'on_save (.order)',
    icon: 'carbon:flow',
    async execute() {
        // Авто-provision заявки отключён: принятие/отклонение выполняется
        // вручную через серверные методы ArgoCD (acceptOrder/rejectOrder).
        return;
    },
};
