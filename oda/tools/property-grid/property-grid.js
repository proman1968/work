ODA({is: 'oda-property-grid', imports: 'oda//tree.js', extends: 'oda-tree',
    inspected:{
        set(n){
            this.items = [];
            if(n){
                let inspected = n;
                let items = [];
                for(let prop of Object.values(n[R].props)){
                    if(prop.value instanceof Function ) continue;
                    if(!prop.$public) continue;
                    let category = prop.$cat || prop.$category || 'main';
                    let cat = items.find(i=>i.id === category);
                    if(!cat){
                        cat = {id: category, items: []};
                        items.push(cat);
                    }
                    let id = prop.name;
                    let editor = prop2editor(prop);
                    cat.items.push({
                        id, 
                        get descriptor(){
                            return {
                                prop,
                                readonly: !prop.set?.setter,
                                list: prop.$list,
                                editor,
                                get value(){
                                    return inspected[id];
                                },
                                set value(n){
                                    inspected[id] = n;
                                }
                            }
                        }
                    });
                }
                this.items = items;
            }
        }
    },
    onlySave: false,
    allowCategories: true,
    allowFocus: true,
    hideRoots: 1,
    showHeader: true,
    get label(){
        return this.inspected?.localName || this.inspected?.label || 'properties';
    },
    columns:[
        {
            id: 'descriptor', 
            template: 'oda-property-cell'
        }
    ]
})
ODA({is: 'oda-property-cell', imports: 'oda//tree.js', extends: 'oda-tree-cell',
    disabled:{
        $def: false,
        $attr: true,
        get (){
            return this.descriptor?.readonly;
        }
    },
    set row(n){
        if(n){
            this.descriptor = n.descriptor;
        }
    }
})
function prop2editor(prop){
    if(prop.$list)
        return 'tree-dropdown-editor';
    else if(prop.name === 'icon')
        return 'tree-icon-selector';

    switch(prop.$type){
        case Boolean:
            return 'tree-boolean-editor'            
    }
    return 'tree-string-editor'       
}
