export default{
    imports: '/oda//form.js',
    template: /* html */`   
        <style>
            :host{
                @apply --vertical;
                padding: 16px;
                padding-bottom: 0px;
                user-select: none;
                gap: 8px;
            }
            oda-button{
                border-radius: 4px !important;
            }
            .title{
                gap: 4px;
                border-bottom: 1px solid var(--header-background);
                padding-bottom: 16px;
                overflow: hidden;
            }
        </style>
        <div class="title" horizontal>
            <select flex id="selector" ::value :disabled="body?.disabled || skills?.length < 2" bold style="padding: 4px;">
                <option ~for="skills" :value="$for.item.id">{{$for.item.id}}</option>
            </select>
            <oda-button icon="unicon:edit" @tap="edit_skill"></oda-button>
        </div>
        <oda-form ~if="$skill && !body?.disabled" :metadata ::data></oda-form>
        <span flex ~if="body?.disabled">{{body.prompt}}</span>
        <div horizontal style="gap: 8px;" ~if="!body?.disabled">
            <div flex></div>
            <oda-button raised info-invert icon="icons:check" label="OK" @tap="ok"></oda-button>
            <oda-button raised info icon="icons:close" label="Cancel" @tap="cancel"></oda-button>
        </div>        
    `, 
    edit_skill(e){
        this.$skill.execute();
    },
    value: {
        set(n){
            this.focusedSkill = this.skills.find(s=>s.id === n);
        },
        get(){
            return this.focusedSkill?.id;
        }
    },
    data:{
        get(){
            return this.focusedSkill.data ??= {prompt: this.body.prompt};
        },
        set(n){
            if(n){
                n.prompt ??= this.body.prompt;
                this.focusedSkill.data = n;
            }     
        }
    },
    async ok(e){
        try{
            this.$pdp.colorMode = 'rainbow';
            let script = await this.script;
            this.body.disabled = true;
            await script.execute({data: this.focusedSkill.data, $item: this.$item});
            let skill = {
                name: this.focusedSkill.id, 
                path: this.focusedSkill.path, 
                data: this.focusedSkill.data, 
            } 
            this.body.skills = [skill];
            let body = JSON.stringify(this.body, null, 4);
            await this.$item.save(body);
        }
        catch(e){
            this.body.disabled = false;
            //сообщение
        }
        finally{
            this.$pdp.colorMode = '';
        }
  
    },
    cancel(){
        this.$item.delete();
    }, 
    get script(){
        return this.$skill?.script;
    },
    get metadata(){
        return this.script?.then(script => script.metadata)
    },
    get skills(){
        return this.body?.skills;
    },
    $skill: null, 
    focusedSkill: {
        $def: null,
        async set(n){
            n.data ??= {};
            this.$skill = await WORK.get_item('/'+n.path);
        }
    },
    body: null,
    $item:{
        async set(n){
            if(n){
                let body = await n.load();
                this.body = JSON.parse(body);
                this.focusedSkill = this.body.skills[0];
            }
        }  
    }
}