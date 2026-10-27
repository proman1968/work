/**
 * form/analysis — Экран 2 ODANT: Анализ счёта в разрезе аналитик (`db_sheet`).
 */
import postingsProto from '../../postings/$handler/postings.js';

const proto = Object.defineProperties({}, Object.getOwnPropertyDescriptors(postingsProto));
proto.mode = 'analysis';

export default proto;
