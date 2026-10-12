/** Общие данные песочницы эталонных задач (7.4): пользователи, срок, базовое дерево. */
export const U = { boss: 'EB00000000000001', user: 'EU00000000000001', petrov: 'EU00000000000002', admin: 'EA00000000000001' };
// срок поручения — послезавтра (зашитая дата устаревала, и кейс флапал с прошедшим сроком)
export const DUE = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);

export const base = {
    [`USERS/${U.boss}/$user/class.js`]: `export default { label: 'Сидоров Сергей' }`,
    [`USERS/${U.user}/$user/class.js`]: `export default { label: 'Иванов Иван' }`,
    [`USERS/${U.petrov}/$user/class.js`]: `export default { label: 'Петров Пётр' }`,
    [`USERS/${U.admin}/$user/class.js`]: `export default { label: 'Админ' }`,
    '$server/class.js': `export default { label: 'EVAL', '#security': { ADMIN: ['${U.admin}'] } }`,
    'ORG/$base/class.js': `export default { label: 'ООО Ромашка', '#security': { BOSS: ['${U.boss}'], USER: ['${U.user}', '${U.petrov}'] } }`,
    'ORG/$base/readme.md': '# ООО Ромашка\nОтчёты кладутся в папку «Отчёты». Поручения — через ленту с получателями и сроком.',
};
