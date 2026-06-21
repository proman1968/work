/*
*   <text>                  ::=     <paragraph> (<paragraph-separator> <paragraph>?)*
*   <paragraph>             ::=     <sentence> (<sentence-separator> <sentence>?)*
*   <paragraph-separator>   ::=     '\n'
*   <sentence>              ::=     <content> (<content-separator> <content>?)*
*   <content>               ::=     <word>|<numeric>|<symbol>+
*   <sentence-separator>    ::=     ('.'|'?'|'…'|'!')\s
*   <content-separator>     ::=     (','|';'|':')\s
*   <numeric>               ::=     '-'?<integer>|<float>|<scientific>
*   <integer>               ::=     <digit>+
*   <digit>                 ::=     [0-9]
*   <float>                 ::=     <integer> ('.'|',') <integer> (('E'|'e') ('-'|'+')? <integer>)?
*   <word>                  ::=     <word_part> ('-' <word_part>)*
*   <word_part>             ::=     (<letter>|<digit>)+ ((<letter>|<digit>)+)?
*   <letter>                ::=     [a-zA-Zа-яА-ЯёЁ]
*   <symbol>                ::=     [@"'!№#]
* */

/* От GROK
<текст> ::= (<элемент> <разделитель>)* <элемент> <разделитель>?
<элемент> ::= <слово> | <число> | <дата>
<слово> ::= <буква>+ (<буква_или_цифра>)*
<разделитель> ::= <пробел> | <знак_препинания> | <пробел> <знак_препинания> 
<буква_или_цифра> ::= <буква> | <цифра>
<буква> ::= "а" | "б" | "в" | "г" | "д" | "е" | "ё" | "ж" | "з" | "и" | "й" | "к" | "л" | "м" | "н" | "о" | "п" | "р" | "с" | "т" | "у" | "ф" | "х" | "ц" | "ч" | "ш" | "щ" | "ъ" | "ы" | "ь" | "э" | "ю" | "я" | "А" | "Б" | "В" | "Г" | "Д" | "Е" | "Ё" | "Ж" | "З" | "И" | "Й" | "К" | "Л" | "М" | "Н" | "О" | "П" | "Р" | "С" | "Т" | "У" | "Ф" | "Х" | "Ц" | "Ч" | "Ш" | "Щ" | "Ъ" | "Ы" | "Ь" | "Э" | "Ю" | "Я"
<цифра> ::= "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"
<пробел> ::= " "
<знак_препинания> ::= "." | "," | "!" | "?" | ";" | ":" | "-" | "—" | "(" | ")" | "«" | "»" | """ | "'"
*/


export class Parser{
    tree = [];
    index = 0;
    corpus;
    size;
    collect_separotrs;
    constructor(text = '', collect_separotrs = true) {
        this.collect_separotrs = collect_separotrs
        this.corpus = text //+ '\n';
        this.size = this.corpus.length;
        this.number2text = new NumberToRussianString();  //возвращает функцию преобразования числа в слова
        return this.parse.bind(this);
    }
    parse(){
        this.text();
        if (this.index<this.size)
            throw new Error('неполный разбор');
        return this.tree;
    }
    text(){ //  (<word>|<number>|<separator>)*
        let str, result = [];
        let collect_separotrs = this.collect_separotrs
        while(this.index < this.size){
            if(str = this.word())
                this.tree.push(str);
            else if(str = this.numeric())
                this.tree.push(...str.split(' ').filter(Boolean));
            else if((str = this.corpus[this.index++]) && collect_separotrs && str.trim().length)
                this.tree.push(str);
                // this.tree.push({key: '<char>', value: str});
        }
    }
    word(){     //  <letter>+
        let idx = this.index;
        let str, result = '';
        if (str = this.letter()){
            result += str;
            while(this.index < this.size && (str = this.letter())){
                result += str;
            }
            return result;
        }
        this.index = idx;
    }
    //   <letter>                ::=     [a-zA-Zа-яА-ЯёЁ]
    letter(){
        let char = this.corpus[this.index];
        if(/[a-zA-Zа-яА-ЯёЁ]/.test(char)){
            this.index++;
            return char;
        }
    }
    //   <digit>                ::=     [0-9]
    digit(){
        let char = this.corpus[this.index];
        if(/[0-9]/.test(char)){
            this.index++;
            return char;
        }
    }
    //   <numeric>                ::=     '-'? (<integer>|<float>|<scientific>)
    numeric() {
        let idx = this.index;
        let value, result = '';
        let sign = this.check_char('-') || '';
        if ((value = this.scientific())) {
            result = '<scientific>';
        }
        else if ((value = this.float())) {
            result = '<float>';
        }
        else if ((value = this.integer())) {
            result = '<integer>';
        }
        else {
            this.index = idx;
            return;
        }
        return this.number2text(value);
        result = {key: result, value: sign+value, text: this.number2text(value)};
        return result;
    }
    integer(){
        let idx = this.index;
        let str, result = '';
        if ((str = this.digit())){
            result += str;
            while(str && this.index < this.size){
                if ((str = this.digit()))
                    result += str;
            }
            return result;
        }
        this.index = idx;
    }
    float(){
        let idx = this.index;
        let str, result = '';
        if ((str = this.integer())){
            result += str;
        }
        if ((str = (this.check_char('.') || this.check_char(',')))){
            result += str;
            if ((str = this.integer())){
                result += str;
                return result;
            }
        }
        this.index = idx;
    }
    scientific(){
        let idx = this.index;
        let str, result = '';
        if ((str = this.float())){
            result += str;
            if ((str = (this.check_char('E') || this.check_char('e')))){
                result += str;
                if ((str = (this.check_char('-') || this.check_char('+')))){
                    result += str;
                }
                if ((str = this.integer())){
                    result += str;
                    return result;
                }
            }
        }
        this.index = idx;
    }

    check_char(char){
        if (char === this.corpus[this.index]){
            this.index++;
            return char;
        }
    }
    check_chars(...chars){
        chars = chars.flat();
        let char = this.corpus[this.index];
        if (chars.includes(char)){
            this.index++;
            return char;
        }
    }
}








/* БНФ-нотация от GROK для чисел, включающая целые числа в двоичной, восьмеричной, десятичной и шестнадцатеричной системах счисления,
* а также вещественные числа в десятичной системе.
*
* <число>                   ::= <десятичное_число> | <двоичное_число> | <восьмеричное_число> | <шестнадцатеричное_число>
* <десятичное_число>        ::= <целое_десятичное_число> | <вещественное_число>
* <целое_десятичное_число>  ::= <знак>? <десятичная_цифра>+
* <вещественное_число>      ::= <знак>? <десятичная_цифра>* "." <десятичная_цифра>+ (<экспонента>)?
* <двоичное_число>          ::= <знак>? "0b" <двоичная_цифра>+
* <восьмеричное_число>      ::= <знак>? "0o" <восьмеричная_цифра>+
* <шестнадцатеричное_число> ::= <знак>? "0x" <шестнадцатеричная_цифра>+
* <знак>                    ::= "+" | "-"
* <двоичная_цифра>          ::= "0" | "1"
* <восьмеричная_цифра>      ::= <двоичная_цифра> | "2" | "3" | "4" | "5" | "6" | "7"
* <десятичная_цифра>        ::= <восьмеричная_цифра> | "8" | "9"
* <шестнадцатеричная_цифра> ::= <десятичная_цифра> | "a" | "b" | "c" | "d" | "e" | "f" | "A" | "B" | "C" | "D" | "E" | "F"
* <экспонента>              ::= ("e" | "E") <знак>? <десятичная_цифра>+
*/
export class NumberToRussianString{
    constructor() {
        return this.number2text.bind(this);
    }

    number2text(val){
        let number = val.toString();
        number = number.replaceAll('_', '');
        let sep_dot_idx = number.lastIndexOf('.');
        let sep_comma_idx = number.lastIndexOf(',');
        let dec_separator = (sep_comma_idx>sep_dot_idx)?',':'.';
        let thousand_separator = (sep_comma_idx<sep_dot_idx)?',':' ';
        number = number.replaceAll(thousand_separator, '');
        number = number.split(dec_separator);
        let integer = +number[0];
        let mantissa = number[1];

        integer = this.integer2text(integer);
        mantissa = this.mantissa2text(mantissa);
        let result = integer;
        if(mantissa){
            result += ' целых ' + mantissa;
        }
        return result;
    }

    integer2text(value){
        if (value < 0)
            return "";
        if (value === 0)
            return NumberToRussianString.zero;
        let groups = Math.ceil(value.toString().length / 3);
        value = Array(groups).fill().map((_, i)=>{
            return this.ternary2string(value, groups-i-1)
        }).join(' ');
        return value;
    }

    mantissa2text(value = ''){
        value = value.toLowerCase().split('e');
        let mantissa = this.decimal2text(+value[0]);
        let power = this.power2text(value[1]);
        if (power)
            mantissa += ' ' + power;
        return mantissa;
    }

    decimal2text(value){
        if (value)
            value = this.integer2text(value);
        else
            value = '';
        return value;
    }

    power2text(power = ''){
        let result = '';
        if (power){
            result = ' на десять в степени ';
            let sign = power[0];
            if (sign === '-'){
                power = power.slice(1);
                result += 'минус ';
            }
            else if (sign === '+'){
                power = power.slice(1);
            }
            power = +power;
            power = this.integer2text(power);
            result += power;
        }
        return result;
    }

    ternary2string(value, group_index){
        for (let i = 0; i < group_index; i++)
            value = Math.floor(value / 1000);
        // учитываются только последние 3 разряда, т.е. 0..999
        let ternary = Math.floor(value % 1000);
        if (ternary === 0)
            return "";
        let result = this.ternary2gender(ternary, group_index?1:0);
        --group_index;
        let mode = this.endingMode(ternary);
        let big = NumberToRussianString.big_numbers[group_index];
        if (big){
            if (group_index === 0){
                big = big[mode];
            }
            else{
                big += NumberToRussianString.ends[mode];
            }

            result += ' ' + big;
        }
        return result;
    }

    ternary2gender(ternary, gender) {
        let s = '';

        let digit2 = Math.floor(ternary / 100);
        let digit1 = Math.floor((ternary % 100) / 10);
        let digit0 = Math.floor(ternary % 10);

        // сотни
        while (digit2 >= 10)
            digit2  = Math.floor(digit2%10);

        if (digit2 > 0)
            s = NumberToRussianString.number100_900[digit2 - 1] + " ";

        if (digit1 > 1) {
            s += NumberToRussianString.number20_90[digit1 - 2] + " ";
            if (digit0 >= 3) {
                s += NumberToRussianString.number3_9[digit0 - 3] + " ";
            } else {
                if (digit0 === 1) s += NumberToRussianString.number1[gender] + " ";
                if (digit0 === 2) s += NumberToRussianString.number2[gender] + " ";
            }
        } else if (digit1 === 1) {
            s += NumberToRussianString.number10_19[digit0] + " ";
        } else {
            if (digit0 >= 3) {
                s += NumberToRussianString.number3_9[digit0 - 3] + " ";
            } else if (digit0 > 0) {
                if (digit0 === 1) s += NumberToRussianString.number1[gender] + " ";
                if (digit0 === 2) s += NumberToRussianString.number2[gender] + " ";
            }
        }

        return s.trim();
    }

    endingMode(number){
        // достаточно проверять только последние 2 цифры,
        // т.к. разные падежи единицы измерения раскладываются
        // 0 рублей, 1 рубль, 2-4 рубля, 5-20 рублей,
        // дальше - аналогично первому десятку
        let digit1 = Math.floor((number % 100) / 10);
        let digit0 = Math.floor((number % 10));
        if (digit1 === 1)
            return 2;
        if (digit0 === 1)
            return 0;
        if (2 <= digit0 && digit0 <= 4)
            return 1;
        return 2;
    }
}


NumberToRussianString.ends = ['', 'а', 'ов']
NumberToRussianString.zero = "ноль";
NumberToRussianString.number1 = [ "один", "одна", "одно"];
NumberToRussianString.number2 = [ "два", "две", "два" ];
NumberToRussianString.number3_9 = [ "три", "четыре", "пять", "шесть", "семь", "восемь", "девять" ];
NumberToRussianString.number10_19 = [ "десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать" ];
NumberToRussianString.number20_90 = [ "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто" ];
NumberToRussianString.number100_900 = [ "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот" ];
NumberToRussianString.big_numbers = [
    [ "тысяча", "тысячи", "тысяч" ],
    "миллион",
    "миллиард",
    "триллион",
    "квадриллион",
    "квинтиллион",
    "секстиллион",
    "септиллион",
    "октиллион",
    "нониллион",
    "дециллион",

];