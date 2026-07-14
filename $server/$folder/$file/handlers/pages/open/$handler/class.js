export default{
    allowZoom: true,
    attached(){
        if(!(this.template?.trim?.()))
            window.open(this.$item.path, '_self');
    }
}