/**
 * $register — единый журнал проводок: корень дерева счетов ($account).
 * Отчёты — методы учётного ядра (sources/data/api.js) на журнале или счёте:
 * db_journal (журнал проводок), db_sheet (ОСВ), db_card (карточка счёта);
 * формы — form/journal и form/sheet журнала, form/postings счёта.
 */
export default {
    $public: {
        form: 'sheet',
    },
}
