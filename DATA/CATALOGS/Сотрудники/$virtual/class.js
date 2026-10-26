export default {    label: 'Сотрудники',
    icon: 'carbon:user-role',
    SOURCE: { registry: '/DATA/CATALOGS/Субъекты/Физ. лица', account: '/DATA/REGISTER/Кадры', slot: 'person' },
    OVERLAY: [
        { id: 'position', label: 'Должность' },
        { id: 'salary', label: 'Оклад', type: 'Money' },
        { id: 'personnel_number', label: 'Табельный номер' },
    ],
}
