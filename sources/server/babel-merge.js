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

            // РћР±СЉРµРґРёРЅСЏРµРј РЅРѕРґС‹ СЃ СЃРѕС…СЂР°РЅРµРЅРёРµРј РїРѕСЂСЏРґРєР°
            const mergedNodes = [];

            // РРЅРґРµРєСЃС‹ РґР»СЏ РѕС‚СЃР»РµР¶РёРІР°РЅРёСЏ РїРѕР·РёС†РёР№ export default
            let exportDefaultIndex1 = -1;
            let exportDefaultIndex2 = -1;
            let exportDefault1 = null;
            let exportDefault2 = null;

            // РќР°С…РѕРґРёРј РїРѕР·РёС†РёРё export default РІ РїРµСЂРІРѕРј С„Р°Р№Р»Рµ
            ast1.program.body.forEach((node, index) => {
                if (t.isExportDefaultDeclaration(node)) {
                    exportDefaultIndex1 = index;
                    exportDefault1 = node;
                }
            });

            // РќР°С…РѕРґРёРј РїРѕР·РёС†РёРё export default РІРѕ РІС‚РѕСЂРѕРј С„Р°Р№Р»Рµ
            ast2.program.body.forEach((node, index) => {
                if (t.isExportDefaultDeclaration(node)) {
                    exportDefaultIndex2 = index;
                    exportDefault2 = node;
                }
            });

            // РћР±СЉРµРґРёРЅСЏРµРј РЅРѕРґС‹, СЃРѕС…СЂР°РЅСЏСЏ РїРѕСЂСЏРґРѕРє
            let i = 0, j = 0;
            const len1 = ast1.program.body.length;
            const len2 = ast2.program.body.length;

            while (i < len1 || j < len2) {
                // Р•СЃР»Рё СЌС‚Рѕ export default, РїСЂРѕРїСѓСЃРєР°РµРј - РґРѕР±Р°РІРёРј РїРѕР·Р¶Рµ
                if (i === exportDefaultIndex1) {
                    i++;
                    continue;
                }
                if (j === exportDefaultIndex2) {
                    j++;
                    continue;
                }

                // Р”РѕР±Р°РІР»СЏРµРј РЅРѕРґС‹ РІ РїРѕСЂСЏРґРєРµ РёС… РїРѕСЏРІР»РµРЅРёСЏ
                if (i < len1 && j < len2) {
                    // РњРѕР¶РЅРѕ РґРѕР±Р°РІРёС‚СЊ Р»РѕРіРёРєСѓ РїСЂРёРѕСЂРёС‚РµС‚Р° РёР»Рё С‡РµСЂРµРґРѕРІР°РЅРёСЏ
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

            // Р”РѕР±Р°РІР»СЏРµРј РѕР±СЉРµРґРёРЅРµРЅРЅС‹Р№ export default РІ РїРѕР·РёС†РёСЋ РёР· РїРµСЂРІРѕРіРѕ С„Р°Р№Р»Р° РёР»Рё РІ РєРѕРЅРµС†
            let mergedExportDefault = null;

            if (exportDefault1 && exportDefault2) {
                mergedExportDefault = MERGE.mergeExportDefaults(exportDefault1, exportDefault2);
            } else if (exportDefault1 || exportDefault2) {
                mergedExportDefault = exportDefault1 || exportDefault2;
            }

            // Р’СЃС‚Р°РІР»СЏРµРј export default РІ РїСЂР°РІРёР»СЊРЅСѓСЋ РїРѕР·РёС†РёСЋ
            if (mergedExportDefault) {
                const insertIndex = exportDefaultIndex1 !== -1 ?
                    Math.min(exportDefaultIndex1, mergedNodes.length) :
                    mergedNodes.length;
                mergedNodes.splice(insertIndex, 0, mergedExportDefault);
            }

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
                // Р”Р»СЏ РѕР±СЉРµРєС‚Р° Р±РµР· ID РїСЂРѕСЃС‚Рѕ РґРѕР±Р°РІР»СЏРµРј
               mergedArray.value.elements.push(t.cloneNode(prop, true))
            }
        });
        // console.log();
        return mergedArray;
    },
    deepMergeObjectExpressions(props1, props2) {
        const mergedMap = new Map();

        // Р¤СѓРЅРєС†РёСЏ РґР»СЏ РїРѕР»СѓС‡РµРЅРёСЏ РєР»СЋС‡Р° СЃРІРѕР№СЃС‚РІР°
        const getKey = (prop) => {
            if (!prop.key) return null;

            if (t.isIdentifier(prop.key)) {
                return prop.key.name + ':' + prop.kind;
            } else if (t.isStringLiteral(prop.key)) {
                return prop.key.value;
            } else if (t.isNumericLiteral(prop.key)) {
                return prop.key.value.toString();
            } else if (t.isTemplateLiteral(prop.key)) {
                // Р”Р»СЏ С€Р°Р±Р»РѕРЅРЅС‹С… СЃС‚СЂРѕРє РёСЃРїРѕР»СЊР·СѓРµРј РёС… С‚РµРєСЃС‚РѕРІРѕРµ РїСЂРµРґСЃС‚Р°РІР»РµРЅРёРµ
                return prop.key.quasis.map(q => q.value.cooked).join('');
            }
            return null;
        };

        // Р¤СѓРЅРєС†РёСЏ РґР»СЏ РіР»СѓР±РѕРєРѕРіРѕ РєР»РѕРЅРёСЂРѕРІР°РЅРёСЏ AST РЅРѕРґС‹
        const cloneNode = (node) => t.cloneNode(node, true);

        // Р”РѕР±Р°РІР»СЏРµРј СЃРІРѕР№СЃС‚РІР° РёР· РїРµСЂРІРѕРіРѕ РѕР±СЉРµРєС‚Р°
        props1.forEach(prop => {
            const key = getKey(prop);
            if (key) {
                mergedMap.set(key, cloneNode(prop));
            } else {
                // Р”Р»СЏ СЃРІРѕР№СЃС‚РІ Р±РµР· РєР»СЋС‡Р° (СЃРїСЂРµРґ РѕРїРµСЂР°С‚РѕСЂС‹) РїСЂРѕСЃС‚Рѕ РґРѕР±Р°РІР»СЏРµРј
                mergedMap.set(Symbol('spread'), prop);
            }
        });

        // РћР±СЉРµРґРёРЅСЏРµРј СЃРѕ СЃРІРѕР№СЃС‚РІР°РјРё РІС‚РѕСЂРѕРіРѕ РѕР±СЉРµРєС‚Р°
        props2.forEach(prop => {
            const key = getKey(prop);

            if (!key) {
                // Р”Р»СЏ СЃРїСЂРµРґ РѕРїРµСЂР°С‚РѕСЂРѕРІ
                mergedMap.set(Symbol('spread_' + mergedMap.size), prop);
                return;
            }

            const existing = mergedMap.get(key);

            if (!existing) {
                // РќРѕРІРѕРµ СЃРІРѕР№СЃС‚РІРѕ
                mergedMap.set(key, cloneNode(prop));
            } else {
                // РЎРІРѕР№СЃС‚РІРѕ СѓР¶Рµ СЃСѓС‰РµСЃС‚РІСѓРµС‚
                if (t.isObjectProperty(existing) && t.isObjectProperty(prop)) {
                    // Р•СЃР»Рё РѕР±Р° СЃРІРѕР№СЃС‚РІР° СЏРІР»СЏСЋС‚СЃСЏ РѕР±СЉРµРєС‚Р°РјРё СЃ РІР»РѕР¶РµРЅРЅС‹РјРё РѕР±СЉРµРєС‚Р°РјРё
                    if (t.isObjectExpression(existing.value) && t.isObjectExpression(prop.value)) {
                        // Р РµРєСѓСЂСЃРёРІРЅРѕРµ РіР»СѓР±РѕРєРѕРµ СЃР»РёСЏРЅРёРµ
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
                        // const mergedProp = t.objectProperty(
                        //     prop.key,
                        //     t.objectExpression(mergedInnerProps)
                        // );
                        mergedMap.set(key, mergedProp);
                    }
                    else {
                        // РџРµСЂРµР·Р°РїРёСЃС‹РІР°РµРј (РїСЂРёРѕСЂРёС‚РµС‚ Сѓ РІС‚РѕСЂРѕРіРѕ С„Р°Р№Р»Р°)
                        mergedMap.set(key, cloneNode(prop));
                    }
                } else if (t.isObjectMethod(existing) && t.isObjectMethod(prop)) {
                    // Р”Р»СЏ РјРµС‚РѕРґРѕРІ - РїРµСЂРµР·Р°РїРёСЃС‹РІР°РµРј
                    mergedMap.set(key, cloneNode(prop));
                } else {
                    // Р Р°Р·РЅС‹Рµ С‚РёРїС‹ СЃРІРѕР№СЃС‚РІ - РїРµСЂРµР·Р°РїРёСЃС‹РІР°РµРј
                    mergedMap.set(key, cloneNode(prop));
                }
            }
        });

        // РџСЂРµРѕР±СЂР°Р·СѓРµРј Map РІ РјР°СЃСЃРёРІ, РёРіРЅРѕСЂРёСЂСѓСЏ Symbol РєР»СЋС‡Рё РґР»СЏ СЃРїСЂРµРґ РѕРїРµСЂР°С‚РѕСЂРѕРІ
        return Array.from(mergedMap.values());
    },

    mergeExportDefaults(exp1, exp2) {
        const declaration1 = exp1.declaration;
        const declaration2 = exp2.declaration;

        // РЎР»СѓС‡Р°Р№ 1: РћР±Р° СЏРІР»СЏСЋС‚СЃСЏ РѕР±СЉРµРєС‚Р°РјРё
        if (t.isObjectExpression(declaration1) && t.isObjectExpression(declaration2)) {
            const mergedProps = MERGE.deepMergeObjectExpressions(
                declaration1.properties,
                declaration2.properties
            );
            return t.exportDefaultDeclaration(t.objectExpression(mergedProps));
        }

        // РЎР»СѓС‡Р°Р№ 2: РћР±Р° СЏРІР»СЏСЋС‚СЃСЏ С„СѓРЅРєС†РёСЏРјРё
        if (t.isFunction(declaration1) && t.isFunction(declaration2)) {
            // РЎРѕР·РґР°РµРј РѕР±РµСЂС‚РєСѓ, РєРѕС‚РѕСЂР°СЏ РІС‹Р·С‹РІР°РµС‚ РѕР±Рµ С„СѓРЅРєС†РёРё
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

        // РЎР»СѓС‡Р°Р№ 3: РћР±Р° СЏРІР»СЏСЋС‚СЃСЏ РєР»Р°СЃСЃР°РјРё - РЅРµР»СЊР·СЏ РїСЂРѕСЃС‚Рѕ РѕР±СЉРµРґРёРЅРёС‚СЊ
        if (t.isClassDeclaration(declaration1) && t.isClassDeclaration(declaration2)) {
            // РЎРѕР·РґР°РµРј РѕР±СЉРµРєС‚ СЃ РѕР±РѕРёРјРё РєР»Р°СЃСЃР°РјРё
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

        // РЎР»СѓС‡Р°Р№ 4: Р Р°Р·РЅС‹Рµ С‚РёРїС‹ - СЃРѕР·РґР°РµРј РѕР±СЉРµРєС‚ СЃ РѕР±РµРёРјРё С‡Р°СЃС‚СЏРјРё
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

        // Р¤СѓРЅРєС†РёСЏ РґР»СЏ СЃР±РѕСЂР° РІСЃРµС… СЌРєСЃРїРѕСЂС‚РѕРІ СЃ СЃРѕС…СЂР°РЅРµРЅРёРµРј РїРѕР·РёС†РёРё
        function collectExports(ast, sourceIndex) {
            ast.program.body.forEach((node, index) => {
                if (t.isExportNamedDeclaration(node)) {
                    // РЎРѕС…СЂР°РЅСЏРµРј РЅРѕРґСѓ СЌРєСЃРїРѕСЂС‚Р° С†РµР»РёРєРѕРј
                    exportNodes.push({
                        node,
                        originalIndex: index,
                        sourceIndex
                    });

                    // РўР°РєР¶Рµ СЃРѕР±РёСЂР°РµРј СЃРїРµС†РёС„РёРєР°С‚РѕСЂС‹ РґР»СЏ РїСЂРѕРІРµСЂРєРё РґСѓР±Р»РёРєР°С‚РѕРІ
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
    // Р”РѕРїРѕР»РЅРёС‚РµР»СЊРЅР°СЏ С„СѓРЅРєС†РёСЏ РґР»СЏ РѕР±СЉРµРґРёРЅРµРЅРёСЏ РґСЂСѓРіРёС… С‚РёРїРѕРІ СЌРєСЃРїРѕСЂС‚РѕРІ
    mergeOtherExports(ast1, ast2) {
        const namedExports1 = new Map();
        const namedExports2 = new Map();

        // РЎРѕР±РёСЂР°РµРј РёРјРµРЅРѕРІР°РЅРЅС‹Рµ СЌРєСЃРїРѕСЂС‚С‹ РёР· РїРµСЂРІРѕРіРѕ С„Р°Р№Р»Р°
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

        // РЎРѕР±РёСЂР°РµРј РёРјРµРЅРѕРІР°РЅРЅС‹Рµ СЌРєСЃРїРѕСЂС‚С‹ РёР· РІС‚РѕСЂРѕРіРѕ С„Р°Р№Р»Р°
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

        // РћР±СЉРµРґРёРЅСЏРµРј РёРјРµРЅРѕРІР°РЅРЅС‹Рµ СЌРєСЃРїРѕСЂС‚С‹
        const mergedNamedExports = new Map([...namedExports1, ...namedExports2]);

        // РЎРѕР·РґР°РµРј РѕР±СЉРµРґРёРЅРµРЅРЅС‹Р№ СЌРєСЃРїРѕСЂС‚
        if (mergedNamedExports.size > 0) {
            const specifiers = Array.from(mergedNamedExports.values());
            return t.exportNamedDeclaration(null, specifiers);
        }

        return null;
    }
}
