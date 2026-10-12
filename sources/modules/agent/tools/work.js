/**
 * Инструменты работы с деревом WORK (серверный объектный API).
 * Все вызовы идут с session пользователя — права проверяет ядро (assertAccess).
 *
 * Тела инструментов — в ./work/ (fs — файлы, data — данные и вызовы, access — права, feed — лента),
 * общие вызовы — ./work/common.js. Порядок workTools — прежний, из tools/work.js до расщепления:
 * префикс кэша провайдера строится по составу и порядку инструментов; состав и порядок — снимок tests/agent-core.test.js.
 */
import * as FS_TOOLS from './work/fs.js';
import * as DATA_TOOLS from './work/data.js';
import * as ACCESS_TOOLS from './work/access.js';
import * as FEED_TOOLS from './work/feed.js';

// общие вызовы для остальных модулей (session.js, mcp/server.js, tools/sandbox.js, os-files.js, meta.js, docs.js)
export { forceTaskContext, TASK_WRITE_METHODS, absPath, getItem, callAs, writeFile, writeBinary, resolvePeople } from './work/common.js';

export const workTools = [
    FS_TOOLS.ls, FS_TOOLS.read, FS_TOOLS.find, DATA_TOOLS.search,
    ACCESS_TOOLS.access, ACCESS_TOOLS.assign, ACCESS_TOOLS.escalate,
    FEED_TOOLS.send, DATA_TOOLS.writeTable, FS_TOOLS.write, FS_TOOLS.append, FS_TOOLS.edit,
    DATA_TOOLS.createClass, DATA_TOOLS.schema, DATA_TOOLS.call, FEED_TOOLS.logs,
    DATA_TOOLS.query, FS_TOOLS.history, FS_TOOLS.restore, FS_TOOLS.deleteTool,
];
