/**
 * form/turnovers — Экран 3 ODANT: Двухпанельные Обороты счёта (`db_turnovers`).
 */
import postingsProto from '../../postings/$handler/postings.js';

const proto = Object.defineProperties({}, Object.getOwnPropertyDescriptors(postingsProto));
proto.mode = 'turnovers';

export default proto;
