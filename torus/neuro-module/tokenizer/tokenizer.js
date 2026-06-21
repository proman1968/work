import {tensor, torus} from "../../torus.js";
import {Linear, nn} from "../neuro-module.js";
export class Tokenizer extends nn.NeuroModule{
    stats = {};
    constructor(dim = 16, char_step = 3, win_size = 10, negative_size = 5, lex_separator = '_') {
        super(...arguments);
    }
    get targetSize(){
        return this._targetSize ??= this.win_size * (this.negative_size + 1);
    }
    get TARGET(){
        return this._TARGET ??= (()=>{
            const _bins =  Array(this.win_size).fill(1).map((v, i)=>(2. ** - (i + 1) + .5));
            while (_bins.length < this.targetSize)
                _bins.push(0);
            return tensor.from(_bins);
        })();
    }
    __init__(){
        this.vocabulary = {
            "[start]": {t: "[start]", start: true, type: 'sep',
                emb: tensor.ones(this.dim)._label('emb: [start]'),
                cnt: tensor.rand(this.dim)._label('cnt: [start]')
            },
            "[stop]": {t: "[stop]", stop: true, type: 'sep',
                emb: tensor.zeros(this.dim)._label('emb: [stop]'),
                cnt: tensor.rand(this.dim)._label('cnt: [stop]')
            }
        }
    }
    predict(data, token, target){

        if (token?.stat?.length < 2) {
            if (token?.stat?.length === 1)
                return this.vocabulary[token.stat[0]];
            return this.vocabulary['[stop]'];
        }

        data = tensor.from(data);
        let id;
        if (target) {
           id = token.stat.indexOf(target.t)
        }
        let logit = torus.einsum('lx, x->l', [token.logit, data])._label('logit: '+token.t);
        if (id !== undefined) {
            try{
                let loss = logit.cross_entropy(id);
                // let loss = torus.cross_entropy(logit, id);
                loss.back();
                token = target;
            }

            catch (e){
                throw new Error(e);
            }
        }
        else{

            let probs = logit.softmax(-1);
            let idx_next = probs.multinomial(1);
            idx_next = idx_next.get();
            token = token?.stat?.[idx_next];
            token = this.vocabulary[token];
        }
        return token;
    }
    get tokens_error(){
        const size = this.size;
        return this['#tokens_error'] ??= (()=>{
            const tokens = this.tokens.filter(i=>(i.error>0 && i.error<1))

            if (!size)
                return 1;
            let error = tokens.reduce((r, t) =>{
                return r + t.error;
            }, 0)
            error /= size;
            return  error;
        })()
    }
    get error(){
        return this.tokens.filter((_,i)=>i).map(i=>i.error).avg();
    }
    async train(text){
        let tokens = this.tokenize(text);
        let win_size = this.win_size;
        let size = this.targetSize;
        // let paragraphs = tokens.reduce((res, token)=>{
        //     if(token.t === '\n'){
        //         if(res.last.length)
        //             res.push([]);
        //     }
        //     else/* if (token.lex)*/{
        //         token = this.add_token(token.t);
        //         res.last.push(token);
        //     }
        //     return res;
        // }, [[]]);
        try{
            // let p_length = paragraphs.length;
            // for (let j = 0; j < p_length; j++) {
            //
            //     let tokens = paragraphs[j];
                let length = tokens.length;
                for (let i = 0 ; i < length; i++) {
                    let token = tokens[i];

                    let next = i+1;
                    let window = tokens.filter(t=>t.t).slice(next, next + win_size);
                    if(!window.length)
                        window.push(this.vocabulary['[stop]']);
                    while(window.length < win_size) {
                        window.unshift(window[0])
                    }
                    let cnt = length;   //Защита от зацикливания
                    while (cnt-- > 0 && window.length < size) {
                        const idx = Math.floor(torus.generator() * this.tokens.length);
                        const t = this.tokens[idx];
                        if (t !== token && !t.system && !window.includes(t))
                            window.push(t);
                    }
                    while(window.length < size) {
                        window.push(this.vocabulary['[stop]']);
                    }
                    let window_cnt = window.map(i=>i.cnt);
                    window_cnt = torus.stack.call(this, window_cnt);
                    let mul = torus.einsum(`ld, d -> l`, [window_cnt, token.emb]);
                    let sigm = mul.sigm();
                    let res = sigm.MSE(this.TARGET);
                    token.error = res.data[0];
                    res.back();


                }

            // }
        }
        finally {
            this['#tokens_error'] = undefined;
            this.losses.push(this.tokens_error);
        }
        return tokens;
    }
    get symbols(){
        return this._logit_tokens ??= this.tokens.filter(t => t.id !== undefined).sort((a,b)=>{
            return a.id<b.id?-1:1;
        })
    }
    get tokens(){
        return this._tokens ??= Object.values(this.vocabulary);
    }
    get size(){
        return this.tokens.length;
    }
    tokenize(text, train = false) {
        let max = this.char_step;
        let reg = new RegExp(`.{1,${max}}`, 'gs');
        let words = text.match(/[а-яА-Яa-zA-ZЁё]+|./gs);    // Разбили текст на слова и разделители
        words = words.map(w=>{        // Разбили слова на группы букв
            if (w.length < max + 2)
                return w;
            return w.match(reg).map((t, i, items) => {
                if (i > 0)
                    t = '_' + t;
                if (items.length > 1 && i < items.length - 1)
                    t += '_';
                return t;
            });
        });
        words = words.flat();
        let token;
        return words.map(w => {
            token = this.add_token(w, token);
            return (token.emb.token = token);
            // return (token.emb.token = token.emb.freezed.token = token);
        });
    }
    add_token(word, prev){
        let token = this.vocabulary[word] ??= ((t) => {
            this._tokens = undefined;
            let lex = /[а-яА-Яa-zA-ZЁё]+/.test(t) || undefined;
            let type = !lex?'sep':(!t.endsWith('_')?'end':'mid');
            return {
                t,
                type,
                lex,
                stat: [],
                emb: tensor.param(tensor.rand(this.dim, lex?.1:1))._label('emb: ' + t),
                cnt: tensor.param(tensor.rand(this.dim))._label('cnt: ' + t),
            }
        })(word)
        if (prev){
            prev.stat.add(word);
            prev.logit ??= tensor.param(tensor.rand([prev.stat.length, this.dim], .1)._label('Unembedding: ' + prev.t));
            // prev.logit ??= tensor.param(tensor.rand_init([prev.stat.length, this.dim], .1)._label('Unembedding: ' + prev.t));
            let delta = prev.stat.length - prev.logit.shape[0];
            if (delta > 0){
                prev.logit = prev.logit.expand(0, delta)
            }
        }


        return token;
    }
}