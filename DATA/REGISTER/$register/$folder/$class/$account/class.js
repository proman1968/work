/**
 * $account — счёт (субсчёт) единого журнала. Поля счёта — его аналитики:
 * METADATA.FIELDS с type: 'Link', catalog и analytic: true (required — обязательна в проводке).
 * NORMS — счёт нормативов. Проводки и остатки — учётное ядро (sources/data).
 */
export default {
    icon: 'carbon:data-base',
    label: 'Счёт',
    METADATA: {
        STATIC: [
            { id: 'label', label: 'Название', type: 'string' },
            { id: 'icon', label: 'Иконка', type: 'string' },
        ],
    },
}
