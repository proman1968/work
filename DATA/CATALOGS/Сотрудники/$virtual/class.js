export default {
    CID: 'cat.employees',
    label: 'Сотрудники',
    icon: 'carbon:user-role',
    SOURCE: { registry: 'cat.person', account: 'acc.hr', slot: 'person' },
    OVERLAY: [
        { id: 'position', label: 'Должность' },
        { id: 'salary', label: 'Оклад', type: 'Money' },
        { id: 'personnel_number', label: 'Табельный номер' },
    ],
}
