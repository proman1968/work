# Подразделение ($structure) и Организация ($base)

Узел организационной структуры WORK: организация (`$base` в `/ORGANIZATIONS/<Орг>`) или её подразделение / отдел (`$structure`).

## Ключевые правила устройства

1. **Подразделения (`$structure`) vs Рабочие места (`#security.ROLES`):**
   - **Подразделение (отдел, департамент, лаборатория)** — это класс типа `$structure` внутри организации (`$base`) или крупного подразделения. Создаётся через `create_class` с `type: "$structure"`, латинским `id` в `snake_case` (например `finances`, `sales`, `ai_research`), русским `label` и **обязательной подходящей по смыслу иконкой `icon`** (например `carbon:machine-learning-model`, `carbon:chemistry`, `icons:account-balance`, `icons:shopping-cart`, `icons:store`, `icons:assignment-ind`, `lineawesome:shuttle-van-solid`, `icons:code`).
   - **Рабочее место (должность, например «Главный бухгалтер», «Менеджер по продажам», «Исследователь»)** — это **НЕ дочерний класс `$structure`**, а запись в массиве `"#security".ROLES` внутри `class.js` своего подразделения:
     ```js
     export default {
         label: 'Исследование ИИ',
         icon: 'carbon:machine-learning-model',
         '#security': {
             BOSS: ['...'],
             ROLES: [{
                 id: 'researcher',
                 label: 'Исследователь',
                 USERS: [],
                 LINKS: [
                     { id: '/ORGANIZATIONS/<Орг>/MODULES/Register/CATALOGS', access: 'read' }
                 ],
                 ROLES: [] // подчинённые рабочие места (если есть)
             }]
         }
     }
     ```
   - Для создания рабочего места, назначения на него сотрудников (`USERS`, включая псевдо-субъекты `USERS` и `GUESTS`) и привязки учётных классов (`LINKS`) используй инструмент `assign` с параметрами `path` (путь подразделения), `place` (например `"researcher"` или `"head/accountant"`), `label` (название должности по-русски), `add` / `remove`, `links`.
