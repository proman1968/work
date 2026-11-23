export default {
    label: 'Сотрудники',
    icon: 'carbon:user-role',
    SOURCE: { registry: '/MODULES/Register/CATALOGS/Субъекты/Физ. лица', account: '/MODULES/Register/REGISTER/Кадры', slot: 'person' },
    OVERLAY: [
        { id: 'position', label: 'Должность', type: 'link', target: '/MODULES/Register/CATALOGS/Должности' },
        { id: 'salary', label: 'Оклад', type: 'money' },
        { id: 'personnel_number', label: 'Табельный номер', type: 'string' },
        { id: 'hire_date', label: 'Дата приёма', type: 'date' },
    ],
}
