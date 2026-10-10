/**
 * oda-date-input — дата и время на нативном input: date | time | datetime-local | month | week.
 * Тип — inputType, иначе по field.type (date, time, datetime / DateTime / timestamp, month, week), иначе date.
 * value — строка в нативном формате ('' — пусто).
 */

const TYPES = { date: 'date', time: 'time', datetime: 'datetime-local', 'datetime-local': 'datetime-local', timestamp: 'datetime-local', month: 'month', week: 'week' };

ODA({
    is: 'oda-date-input',
    imports: 'oda//input.js',
    extends: 'oda-input',
    template: /*html*/`
        <input class="control" part="control" :type="dateType" :value="value ?? ''"
            :min="min || field?.min" :max="max || field?.max" :step="field?.step"
            :readonly="isReadonly" :disabled :required="isRequired"
            @input="value = $this.value" @change="value = $this.value">
    `,
    $public: {
        value: {
            $def: '',
            $type: String
        },
        /** date | time | datetime-local | month | week; пусто — по field.type */
        inputType: '',
        min: '',
        max: ''
    },
    get dateType() {
        return TYPES[String(this.inputType || this.field?.type || 'date').toLowerCase()] ?? 'date';
    },
    get validationErrors() {
        const v = this.value, min = this.min || this.field?.min, max = this.max || this.field?.max;
        if (min && v < min)
            return ['Не раньше ' + min];
        if (max && v > max)
            return ['Не позже ' + max];
        return [];
    }
});
