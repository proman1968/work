export default {    label: 'В отпуске',
    icon: 'carbon:filter',
    SOURCE: { registry: '/DATA/CATALOGS/Субъекты/Физ. лица', account: '/DATA/REGISTER/Кадры/В отпуске', slot: 'person' },
    OVERLAY: [{ id: 'until', label: 'Отпуск до', type: 'Date' }],
}
