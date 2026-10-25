/**
 * Проводки операции для показа в форме (чистые функции, без DOM): строки с названиями счетов и объектов
 * аналитик из `names` ответа (`db_preview`, `db_journal`).
 */
import { formatMoney, formatNumber } from './fields.js';

const listNames = (analytics = {}, names = {}) => Object.values(analytics).map(id => names.objects?.[id] ?? id).join(', ');

/**
 * Строки таблицы проводок.
 * @param {Array<object>} items Проводки (`presentEntry`: `debit`, `credit`, `amount` в рублях, `qty`, `doc_qty`, `doc_unit`, `storno`)
 * @param {{ classes?: object, objects?: object }} names
 * @returns {Array<{ rule, debit, credit, debitNote, creditNote, amount, qty, storno }>}
 */
export function entryRows(items = [], names = {}) {
    return items.map(e => ({
        rule: e.rule,
        debit: names.classes?.[e.debit] ?? e.debit,
        credit: names.classes?.[e.credit] ?? e.credit,
        debitNote: listNames(e.debit_analytics, names),
        creditNote: listNames(e.credit_analytics, names),
        amount: e.amount,
        amountText: formatMoney(e.amount),
        qty: e.doc_qty != null ? `${formatNumber(e.doc_qty)} ${e.doc_unit ?? ''}`.trim() : e.qty ? formatNumber(e.qty) : '',
        storno: !!e.storno,
    }));
}

/** Сумма по проводкам в рублях (сторно уже отрицательные). */
export const entriesSum = items => Math.round(items.reduce((s, e) => s + (e.amount || 0), 0) * 100) / 100;
