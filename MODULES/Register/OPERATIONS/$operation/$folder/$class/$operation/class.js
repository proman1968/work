/**
 * $operation — тип операций: факты деятельности и правила проводок по счетам единого журнала.
 *
 * Класс операции описывает поля в METADATA.FIELDS и правила в METADATA.POSTINGS
 * (наследуются по дереву операций, сливаются по id — docs/architecture-v2.md, Р2):
 * [{ id, each?, when?, amount?, qty?, unit?, item?, qty2?,
 *    debit: { account, analytics: { слот: выражение } }, credit: { account, analytics } }].
 * Объекты и проведение — учётное ядро (sources/data): db_create, db_register, db_correct, db_cancel.
 * AUTO_REGISTER: true — регистрация сразу при создании.
 */
export default {
    icon: 'carbon:operations',
    label: 'Операция',
}
