ODA({is: 'oda-secret-code-input',
    template:/* html */`
        <style>
            :host {
                display: flex;
                gap: 10px;
                justify-content: center;
            }
            .code-input {
                width: 50px;
                height: 60px;
                font-size: 28px;
                text-align: center;
                border: 2px solid #ccc;
                border-radius: 8px;
                transition: border-color 0.2s;
            }
            .code-input:focus {
                border-color: #007bff;
                outline: none;
            }
            .code-input::-webkit-inner-spin-button,
            .code-input::-webkit-outer-spin-button {
                -webkit-appearance: none;
                margin: 0;
            }
        </style> 
        <input @input @keydown @paste ~for="codeSize" type="text" :index="$for.index" class="code-input" maxlength="1" pattern="[0-9]*" inputmode="numeric" autocomplete="one-time-code" />    
    `,
    attached(){
        this.async(()=>{
            this.inputs[0]?.focus();
        })
    },
    codeSize: {
        $def: 4,
        $attr: true
    },
    _onInput(e){
        const value = e.target.value;
        let index = this.inputs.indexOf(e.target);
        if (value.length === 1 && index < this.inputs.length - 1) {
            this.inputs[index + 1].focus();
        }
        this.check();
    },
    _onKeydown(e){
        let index = this.inputs.indexOf(e.target);
        if (e.key === 'Backspace' && e.target.value === '' && index > 0) {
            this.inputs[index - 1].focus();
        }
        this.check();
    },
    _onPaste(e){
        e.preventDefault();
        const paste = (e.clipboardData || window.clipboardData).getData('text');
        this.code = paste.replace(/\D/g, '').slice(0, this.codeSize);
    },
    set code(n){
        if (n?.length === this.codeSize) {
            let index = 0;
            for (let i = 0; i < n.length && index + i < this.inputs.length; i++) {
                this.inputs[index + i].value = n[i];
            }
            // Фокус на последнюю заполненную ячейку
            const next = Math.min(index + n.length, this.inputs.length - 1);
            this.inputs[next].focus();
            this.check();
        }   
    },
    get inputs(){
        return this.$$('input');
    },
    check(){
        let code = Array.from(this.inputs).map(i => i.value).join('');
        if(code.length !== this.codeSize)
            return;
        for(let i of this.inputs)
            i.value = '';
        this.fire('code', code);
    }
})