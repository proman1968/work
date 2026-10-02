export default {
    allowSave: true,
    fileControl: 'oda-calendar-event-form'
}

ODA({
    is: 'oda-calendar-event-form',
    imports: '~/lib//calendar-form.js',
    extends: 'calendar-form',
})
