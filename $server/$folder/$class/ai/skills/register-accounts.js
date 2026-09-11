/** Навык: типовые счета налоговой отчётности в журнале /REGISTER. */
export default {
    id: 'register-accounts',
    label: 'Счета налоговой отчётности',
    icon: 'carbon:receipt',
    when: {
        need: 'side',
        phrases: [
            'добавь счета',
            'план счетов',
            'налогов',
            'налоговой отчётности',
        ],
    },
    points: {
        journal: '/REGISTER',
        accountType: '/REGISTER/$register/$folder/$class/$account',
    },
    slots: {
        accounts: {
            from: ['user', 'activation'],
            item: { id: 'номер', label: 'название', icon: 'набор:имя' },
        },
    },
    defaults: {
        accounts: [
            { id: '41', label: '41.00 Товары', icon: 'carbon:package' },
            { id: '43', label: '43.00 Готовая продукция', icon: 'carbon:cube' },
            { id: '50', label: '50.00 Касса', icon: 'carbon:wallet' },
            { id: '51', label: '51.00 Расчётные счета', icon: 'carbon:bank' },
            { id: '60', label: '60.00 Расчёты с поставщиками', icon: 'carbon:exchange' },
            { id: '62', label: '62.00 Расчёты с покупателями', icon: 'carbon:users' },
            { id: '66', label: '66.00 Краткосрочные кредиты', icon: 'carbon:percent' },
            { id: '67', label: '67.00 Долгосрочные кредиты', icon: 'carbon:calendar' },
            { id: '68', label: '68.00 Расчёты по налогам и сборам', icon: 'carbon:receipt' },
            { id: '69', label: '69.00 Расчёты по социальному страхованию', icon: 'carbon:health' },
            { id: '70', label: '70.00 Расчёты с персоналом', icon: 'carbon:user' },
            { id: '71', label: '71.00 Расчёты по возмещению расходов', icon: 'carbon:wallet' },
            { id: '76', label: '76.00 Расчёты с разными дебиторами', icon: 'carbon:network' },
            { id: '90', label: '90.00 Продажи', icon: 'carbon:chart' },
            { id: '91', label: '91.00 Прочие доходы и расходы', icon: 'carbon:plus' },
            { id: '99', label: '99.00 Прибыли и убытки', icon: 'carbon:flag' },
        ],
    },
    pipe: [
        {
            type: 'explore',
            tools: ['ls', 'read'],
            system: [
                '# Навык: осмотр журнала',
                'Только points.journal. ls deep=2 и readme журнала.',
                'Не карта `/`. Нет точки — отказ, не искать другой журнал.',
            ].join('\n'),
            prompt: [
                'ls и read /REGISTER.',
                'Состав счетов — из ls этой ветки, не из памяти и не из FIELDS.',
            ].join('\n'),
        },
        {
            type: 'work',
            tools: ['read', 'activation', 'create'],
            system: [
                '# Навык: счета $account',
                'Счёт — класс type `$account` под points.journal, id = номер.',
                'Сначала read points.accountType.',
                'icon в class.js — только carbon:, icons:, ai:, lineawesome:, bootstrap:, iconoir:, editor:.',
                'Не декларации и не вопрос про НДС. Не FIELDS журнала.',
            ].join('\n'),
            prompt: [
                'read только points.accountType (тип $account), не путь ещё не созданного счёта.',
                'activation: id, label, icon из реплики или defaults. create под journal. Уже есть в ls — пропустить.',
            ].join('\n'),
        },
        {
            type: 'check',
            system: [
                '# Навык: постусловие',
                'targets из [create …] в ленте. exist + class.js + readme. Не создавать.',
            ].join('\n'),
        },
    ],
};
