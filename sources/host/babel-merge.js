import parser from '@babel/parser';
import traverse from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';

export const MERGE =
{
    mergeScripts(code1, code2) {
        try {
            const ast1 = parser.parse(code1, { sourceType: 'module' });
            const ast2 = parser.parse(code2, { sourceType: 'module' });

            // Объединяем ноды с сохранением порядка
            const mergedNodes = [];

            // Индексы для отслеживания позиций export default
            let exportDefaultIndex1 = -1;
            let exportDefaultIndex2 = -1;
            let exportDefault1 = null;
            let exportDefault2 = null;

            // Находим позиции export default в первом файле
            ast1.program.body.forEach((node, index) => {
                if (t.isExportDefaultDeclaration(node)) {
                    exportDefaultIndex1 = index;
                    exportDefault1 = node;
                }
            });

            // Находим позиции export default во втором файле
            ast2.program.body.forEach((node, index) => {
                if (t.isExportDefaultDeclaration(node)) {
                    exportDefaultIndex2 = index;
                    exportDefault2 = node;
                }
            });

            // Объединяем ноды, сохраняя порядок
            let i = 0, j = 0;
            const len1 = ast1.program.body.length;
            const len2 = ast2.program.body.length;

            while (i < len1 || j < len2) {
                // Если это export default, пропускаем — добавим позже
                if (i === exportDefaultIndex1) {
                    i++;
                    continue;
                }
                if (j === exportDefaultIndex2) {
                    j++;
                    continue;
                }

                // Добавляем ноды в порядке их появления
                if (i < len1 && j < len2) {
                    mergedNodes.push(ast1.program.body[i]);
                    mergedNodes.push(ast2.program.body[j]);
                    i++;
                    j++;
                } else if (i < len1) {
                    mergedNodes.push(ast1.program.body[i]);
                    i++;
                } else if (j < len2) {
                    mergedNodes.push(ast2.program.body[j]);
                    j++;
                }
            }

            // Добавляем объединённый export default
            let mergedExportDefault = null;

            if (exportDefault1 && exportDefault2) {
                mergedExportDefault = MERGE.mergeExportDefaults(exportDefault1, exportDefault2);
            } else if (exportDefault1 || exportDefault2) {
                mergedExportDefault = exportDefault1 || exportDefault2;
            }

            // export default — всегда в конец: объектный литерал вычисляется на месте,
            // и ссылки-шортхенды на const слоёв (TDZ) должны идти после их объявлений
            if (mergedExportDefault)
                mergedNodes.push(mergedExportDefault);

            const newAST = t.program(mergedNodes);
            let code = generate.default(newAST);

            return code.code;
        }
        catch(e) {
            console.error('Merge error:', e);
            return (code1 || code2);
        }
    },
    deepMergeArrays(props1, props2){
        const mergedArray = t.cloneNode(props1, true);
        const getKey = (prop) => {
            let key = prop?.properties?.find(p=>p.key?.name === 'id');
            if(!key){
                return {
                    value: prop
                }
            }
            return key;
        };

        props2.value.elements.forEach(prop => {
            const key = getKey(prop);
            if (key) {
                let exist = mergedArray.value.elements.find(node=>{
                    return getKey(node)?.value?.value === key?.value?.value
                });
                if (!exist){
                    mergedArray.value.elements.push(t.cloneNode(prop, true))
                }
                else if(prop.type === 'ObjectExpression'){
                    let idx = mergedArray.value.elements.indexOf(exist);

                    let mergedInnerProps = MERGE.deepMergeObjectExpressions(exist.properties, prop.properties);
                    mergedArray.value.elements.splice(idx, 1, t.objectExpression(mergedInnerProps));
                }
            } else {
                // Для объекта без ID просто добавляем
                mergedArray.value.elements.push(t.cloneNode(prop, true))
            }
        });
        return mergedArray;
    },
    deepMergeObjectExpressions(props1, props2) {
        const mergedMap = new Map();

        // Функция для получения ключа свойства
        const getKey = (prop) => {
            if (!prop.key) return null;

            if (t.isIdentifier(prop.key)) {
                return prop.key.name + ':' + prop.kind;
            } else if (t.isStringLiteral(prop.key)) {
                return prop.key.value;
            } else if (t.isNumericLiteral(prop.key)) {
                return prop.key.value.toString();
            } else if (t.isTemplateLiteral(prop.key)) {
                // Для шаблонных строк используем их текстовое представление
                return prop.key.quasis.map(q => q.value.cooked).join('');
            }
            return null;
        };

        // Функция для глубокого клонирования AST ноды
        const cloneNode = (node) => t.cloneNode(node, true);

        // Добавляем свойства из первого объекта
        props1.forEach(prop => {
            const key = getKey(prop);
            if (key) {
                mergedMap.set(key, cloneNode(prop));
            } else {
                // Для свойств без ключа (спред-операторы) просто добавляем
                mergedMap.set(Symbol('spread'), prop);
            }
        });

        // Объединяем со свойствами второго объекта
        props2.forEach(prop => {
            const key = getKey(prop);

            if (!key) {
                // Для спред-операторов
                mergedMap.set(Symbol('spread_' + mergedMap.size), prop);
                return;
            }

            const existing = mergedMap.get(key);

            if (!existing) {
                // Новое свойство
                mergedMap.set(key, cloneNode(prop));
            } else {
                // Свойство уже существует
                if (t.isObjectProperty(existing) && t.isObjectProperty(prop)) {
                    // Если оба свойства являются объектами с вложенными объектами
                    if (t.isObjectExpression(existing.value) && t.isObjectExpression(prop.value)) {
                        // Рекурсивное глубокое слияние
                        const mergedInnerProps = MERGE.deepMergeObjectExpressions(
                            existing.value.properties,
                            prop.value.properties
                        );
                        const mergedProp = t.objectProperty(
                            prop.key,
                            t.objectExpression(mergedInnerProps)
                        );
                        mergedMap.set(key, mergedProp);
                    }
                    else if(t.isArrayExpression(existing.value) && t.isArrayExpression(prop.value)){
                        const mergedProp = MERGE.deepMergeArrays(
                            existing,
                            prop
                        );
                        mergedMap.set(key, mergedProp);
                    }
                    else {
                        // Перезаписываем (приоритет у второго файла)
                        mergedMap.set(key, cloneNode(prop));
                    }
                } else if (t.isObjectMethod(existing) && t.isObjectMethod(prop)) {
                    // Для методов — перезаписываем
                    mergedMap.set(key, cloneNode(prop));
                } else {
                    // Разные типы свойств — перезаписываем
                    mergedMap.set(key, cloneNode(prop));
                }
            }
        });

        // Преобразуем Map в массив
        return Array.from(mergedMap.values());
    },

    mergeExportDefaults(exp1, exp2) {
        const declaration1 = exp1.declaration;
        const declaration2 = exp2.declaration;

        // Случай 1: Оба являются объектами
        if (t.isObjectExpression(declaration1) && t.isObjectExpression(declaration2)) {
            const mergedProps = MERGE.deepMergeObjectExpressions(
                declaration1.properties,
                declaration2.properties
            );
            return t.exportDefaultDeclaration(t.objectExpression(mergedProps));
        }

        // Случай 2: Оба являются функциями
        if (t.isFunction(declaration1) && t.isFunction(declaration2)) {
            // Создаём обёртку, которая вызывает обе функции
            const wrapperFunction = t.functionDeclaration(
                t.identifier('mergedDefault'),
                [],
                t.blockStatement([
                    t.expressionStatement(t.callExpression(declaration1, [])),
                    t.expressionStatement(t.callExpression(declaration2, [])),
                    t.returnStatement(t.nullLiteral())
                ])
            );
            return t.exportDefaultDeclaration(wrapperFunction);
        }

        // Случай 3: Оба являются классами — объединяем в объект
        if (t.isClassDeclaration(declaration1) && t.isClassDeclaration(declaration2)) {
            const classObject = t.objectExpression([
                t.objectProperty(
                    t.identifier('Class1'),
                    t.functionExpression(null, [], t.blockStatement([]))
                ),
                t.objectProperty(
                    t.identifier('Class2'),
                    t.functionExpression(null, [], t.blockStatement([]))
                )
            ]);
            return t.exportDefaultDeclaration(classObject);
        }

        // Случай 4: Разные типы — создаём объект с обеими частями
        return t.exportDefaultDeclaration(
            t.objectExpression([
                t.objectProperty(
                    t.identifier('part1'),
                    declaration1
                ),
                t.objectProperty(
                    t.identifier('part2'),
                    declaration2
                )
            ])
        );
    },


    mergeNamedExports(ast1, ast2) {
        const allExports = new Map();
        const exportNodes = [];

        // Функция для сбора всех экспортов с сохранением позиции
        function collectExports(ast, sourceIndex) {
            ast.program.body.forEach((node, index) => {
                if (t.isExportNamedDeclaration(node)) {
                    // Сохраняем ноду экспорта целиком
                    exportNodes.push({
                        node,
                        originalIndex: index,
                        sourceIndex
                    });

                    // Также собираем спецификаторы для проверки дубликатов
                    if (node.specifiers) {
                        node.specifiers.forEach(spec => {
                            if (t.isExportSpecifier(spec)) {
                                const key = spec.exported.name;
                                if (!allExports.has(key)) {
                                    allExports.set(key, { spec, sourceIndex });
                                }
                            }
                        });
                    }
                }
            });
        }

        collectExports(ast1, 0);
        collectExports(ast2, 1);

        return { allExports, exportNodes };
    },
    // Дополнительная функция для объединения других типов экспортов
    mergeOtherExports(ast1, ast2) {
        const namedExports1 = new Map();
        const namedExports2 = new Map();

        // Собираем именованные экспорты из первого файла
        traverse.default(ast1, {
            ExportNamedDeclaration(path) {
                if (path.node.specifiers) {
                    path.node.specifiers.forEach(spec => {
                        if (t.isExportSpecifier(spec)) {
                            namedExports1.set(spec.exported.name, spec);
                        }
                    });
                }
            }
        });

        // Собираем именованные экспорты из второго файла
        traverse.default(ast2, {
            ExportNamedDeclaration(path) {
                if (path.node.specifiers) {
                    path.node.specifiers.forEach(spec => {
                        if (t.isExportSpecifier(spec)) {
                            namedExports2.set(spec.exported.name, spec);
                        }
                    });
                }
            }
        });

        // Объединяем именованные экспорты
        const mergedNamedExports = new Map([...namedExports1, ...namedExports2]);

        // Создаём объединённый экспорт
        if (mergedNamedExports.size > 0) {
            const specifiers = Array.from(mergedNamedExports.values());
            return t.exportNamedDeclaration(null, specifiers);
        }

        return null;
    }
};
