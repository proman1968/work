export default{
    icon: 'enterprise:email',
    template: /* html */`
        <style>
            :host{
                @apply --vertical;
                overflow: hidden;
                position: relative;
            }
        </style>
        <oda-email flex :$item></oda-email>
    `    
}
ODA({ is: 'oda-email', imports: 'oda//app-layout', extends: 'oda-app-layout',
    template: /* html */ `
        <oda-email-navigation-tree slot="left-panel" icon="icons:inbox" label="Вход."></oda-email-navigation-tree>
        <oda-email-navigation-tree slot="left-panel" icon="communication:present-to-all" label="Отпр."></oda-email-navigation-tree>
        <oda-email-navigation-tree slot="left-panel" icon="bootstrap:sign-stop-fill" label="Спам"></oda-email-navigation-tree>
    `

})