export default {    label: 'В отпуске',
    icon: 'carbon:filter',
    SOURCE: { registry: '/MODULES/Register/CATALOGS/Субъекты/Физ. лица', account: '/MODULES/Register/REGISTER/Кадры/В отпуске', slot: 'person' },
    OVERLAY: [{ id: 'until', label: 'Отпуск до', type: 'Date' }],
}
