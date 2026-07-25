# sources/modules/ai-prompt/

Технические хелперы harness `task.ai` (парсер ответа, tools, history, ACL).

Канон оркестрации — TYPE-driven `execute` в
[`$server/.../prompt/$method/class.js`](/$server/$folder/$file/$ai/methods/prompt/$method/class.js/~/handlers/pages/form/).
Сюда вынесен объём, который нельзя класть рядом с `$method/class.js` (rules §1.11).

`legacy.js` — временный носитель старых хелперов; будет распилен/сокращён по мере стабилизации пайплайна.
