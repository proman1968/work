export default{
    get status(){
        return this.supervisors?.then(async supervisors=>{
            let status = '';
            if(supervisors.length)
                status += '<b>' + supervisors[0]?.label+'</b>';
            
            let members = await this.members;
            if(members.length){
                status += '<br>Users: <b>' + members.length+'</b> [' + members.map(u=>u.label).join(', ') + ']';

            }
            return this.status = status
        })
    }
}