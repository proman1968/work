export default {
    template: /*html*/ `
        <style>
            :host {
                @apply --vertical;
            }
        </style>
        <div content flex ~html="src" style="font-size: small; padding: 4px 8px; white-space: pre;"></div>
    `,
    get src(){
        return this.$item?.load().then(res=>{
            return res?.title
        }).catch(err=>{
            return '';
        })
    }
}