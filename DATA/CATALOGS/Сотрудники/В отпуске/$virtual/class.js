export default { label: 'В отпуске', icon: 'carbon:filter', '#security': { USER: ['CA4E097FF6C1D387'] },
    SOURCE: {
        registry: '/DATA/CATALOGS/Физлица',
        account: '/DATA/REGISTER/Управленческие/Сотрудники в отпуске',
        slot: 'person',
    },
    OVERLAY: [{ id: 'until', label: 'Отпуск до' }] }