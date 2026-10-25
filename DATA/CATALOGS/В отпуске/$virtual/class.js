export default {
    CID: 'cat.vacation',
    label: 'В отпуске',
    icon: 'carbon:filter',
    SOURCE: { registry: 'cat.person', account: 'acc.hr.vacation', slot: 'person' },
    OVERLAY: [{ id: 'until', label: 'Отпуск до', type: 'Date' }],
}
