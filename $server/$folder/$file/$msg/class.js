export default{
    $public:{
        "MSG": true
    }
}
ODA({is:'msg-preview',
    template:`
        <div ~html="html"></div>
    `,
    html: '',
    set $item(n){
        this.html = '';
        if(n){
            n.load().then(res=>{
                this.html = res;
            })
        }
    }
})