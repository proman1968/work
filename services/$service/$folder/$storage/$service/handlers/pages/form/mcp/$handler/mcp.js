ODA({
    is: 'work-mcp-manager',
    imports: '@oda/icon, @oda/button',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                @apply --flex;
                background: var(--content-background, #ffffff);
                color: var(--content-color, #1e293b);
                overflow-y: auto;
                padding: 20px 24px 36px;
                box-sizing: border-box;
                font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                gap: 18px;
            }
            .top-bar {
                display: flex;
                align-items: center;
                justify-content: space-between;
                flex-wrap: wrap;
                gap: 12px;
                padding-bottom: 12px;
                border-bottom: 1px solid var(--border-color, #e2e8f0);
            }
            .title-wrap {
                display: flex;
                align-items: center;
                gap: 12px;
            }
            .title-icon {
                width: 40px;
                height: 40px;
                border-radius: 10px;
                background: var(--accent-soft, rgba(37, 99, 235, 0.1));
                color: var(--accent-color, #2563eb);
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .title-wrap h2 {
                margin: 0;
                font-size: 18px;
                font-weight: 700;
            }
            .title-wrap p {
                margin: 2px 0 0;
                font-size: 12.5px;
                opacity: 0.72;
            }
            .tabs-row {
                display: flex;
                align-items: center;
                gap: 8px;
                background: var(--subtle-background, #f8fafc);
                padding: 4px;
                border-radius: 9px;
                border: 1px solid var(--border-color, #e2e8f0);
            }
            .tab-btn {
                border: none;
                background: transparent;
                color: inherit;
                font-size: 13px;
                font-weight: 600;
                padding: 7px 14px;
                border-radius: 6px;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                gap: 6px;
            }
            .tab-btn[active] {
                background: var(--accent-color, #2563eb);
                color: #ffffff;
            }
            .badge {
                display: inline-flex;
                align-items: center;
                padding: 2px 8px;
                border-radius: 999px;
                font-size: 11px;
                font-weight: 600;
                background: rgba(100, 116, 139, 0.14);
            }
            .tab-btn[active] .badge {
                background: rgba(255, 255, 255, 0.22);
                color: #fff;
            }
            .info-banner {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
                gap: 12px;
                background: var(--subtle-background, #f8fafc);
                border: 1px solid var(--border-color, #e2e8f0);
                border-radius: 10px;
                padding: 14px 16px;
                font-size: 12.5px;
                line-height: 1.45;
            }
            .info-col strong {
                display: block;
                font-size: 13px;
                margin-bottom: 4px;
                color: var(--accent-color, #2563eb);
            }
            .code-chip {
                font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                font-size: 11.5px;
                background: rgba(15, 23, 42, 0.07);
                padding: 1px 6px;
                border-radius: 4px;
            }
            .section-card {
                border: 1px solid var(--border-color, #e2e8f0);
                border-radius: 10px;
                background: var(--content-background, #ffffff);
                padding: 16px 18px;
                display: flex;
                flex-direction: column;
                gap: 14px;
            }
            .section-head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                flex-wrap: wrap;
            }
            .section-head h3 {
                margin: 0;
                font-size: 15px;
                font-weight: 700;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .cards-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
                gap: 12px;
            }
            .srv-card {
                border: 1px solid var(--border-color, #e2e8f0);
                border-radius: 9px;
                padding: 14px;
                background: var(--subtle-background, #f8fafc);
                display: flex;
                flex-direction: column;
                gap: 10px;
            }
            .srv-head {
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                gap: 8px;
            }
            .srv-title {
                font-weight: 700;
                font-size: 14px;
                display: flex;
                align-items: center;
                gap: 6px;
            }
            .srv-sub {
                font-size: 12px;
                opacity: 0.78;
                line-height: 1.4;
            }
            .status-pill {
                font-size: 11px;
                font-weight: 600;
                padding: 2px 8px;
                border-radius: 999px;
                white-space: nowrap;
            }
            .status-on {
                background: rgba(22, 163, 74, 0.14);
                color: #15803d;
            }
            .status-off {
                background: rgba(100, 116, 139, 0.16);
                color: #475569;
            }
            .cmd-box {
                font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                font-size: 11.5px;
                background: var(--content-background, #ffffff);
                border: 1px solid var(--border-color, #e2e8f0);
                border-radius: 6px;
                padding: 6px 8px;
                overflow-x: auto;
                white-space: nowrap;
            }
            .btn-row {
                display: flex;
                align-items: center;
                gap: 6px;
                flex-wrap: wrap;
                margin-top: auto;
            }
            .btn {
                border: 1px solid var(--border-color, #cbd5e1);
                background: var(--content-background, #ffffff);
                color: inherit;
                font-size: 12px;
                font-weight: 600;
                padding: 6px 11px;
                border-radius: 6px;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                gap: 5px;
            }
            .btn:hover {
                border-color: var(--accent-color, #2563eb);
            }
            .btn-primary {
                background: var(--accent-color, #2563eb);
                border-color: var(--accent-color, #2563eb);
                color: #ffffff;
            }
            .btn-danger {
                color: #dc2626;
                border-color: rgba(220, 38, 38, 0.35);
            }
            .form-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
                gap: 10px;
            }
            .field {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            .field label {
                font-size: 12px;
                font-weight: 600;
                opacity: 0.85;
            }
            .field input, .field select, .field textarea {
                border: 1px solid var(--border-color, #cbd5e1);
                border-radius: 6px;
                padding: 7px 10px;
                font-size: 13px;
                background: var(--content-background, #ffffff);
                color: inherit;
                font-family: inherit;
                box-sizing: border-box;
            }
            .field textarea {
                font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                font-size: 12px;
                min-height: 110px;
                resize: vertical;
            }
            .tools-list {
                border-top: 1px dashed var(--border-color, #cbd5e1);
                padding-top: 8px;
                display: flex;
                flex-direction: column;
                gap: 6px;
                font-size: 12px;
            }
            .tool-item {
                background: var(--content-background, #ffffff);
                border: 1px solid var(--border-color, #e2e8f0);
                border-radius: 6px;
                padding: 6px 8px;
            }
            .notice {
                padding: 10px 14px;
                border-radius: 8px;
                font-size: 13px;
                font-weight: 500;
                background: rgba(37, 99, 235, 0.1);
                border: 1px solid rgba(37, 99, 235, 0.25);
            }
            .notice[error] {
                background: rgba(220, 38, 38, 0.1);
                border-color: rgba(220, 38, 38, 0.3);
                color: #b91c1c;
            }
            .skill-preview {
                font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                font-size: 11.5px;
                white-space: pre-wrap;
                background: var(--content-background, #ffffff);
                border: 1px solid var(--border-color, #e2e8f0);
                border-radius: 6px;
                padding: 8px 10px;
                max-height: 220px;
                overflow-y: auto;
            }
        </style>

        <div class="top-bar">
            <div class="title-wrap">
                <div class="title-icon">
                    <oda-icon icon="carbon:plug" icon-size="22"></oda-icon>
                </div>
                <div>
                    <h2>Центр расширений ИИ: MCP-серверы и Навыки (Skills)</h2>
                    <p>Подключение внешних инструментов MCP в <span class="code-chip">/SERVICES</span> и установка навыков <span class="code-chip">SKILL.md</span> (OpenCode / Claude)</p>
                </div>
            </div>
            <div class="tabs-row">
                <button class="tab-btn" :active="activeTab === 'mcp'" @tap="setTab('mcp')">
                    <span>🔌 MCP-серверы и Сервисы</span>
                    <span class="badge">{{mcpServers.length}}</span>
                </button>
                <button class="tab-btn" :active="activeTab === 'skills'" @tap="setTab('skills')">
                    <span>🧠 Навыки ИИ (Skills)</span>
                    <span class="badge">{{skills.length}}</span>
                </button>
                <button class="btn" @tap="reload" title="Обновить список">↻ Обновить</button>
            </div>
        </div>

        <div ~if="noticeText" class="notice" :error="noticeError">{{noticeText}}</div>

        <!-- ==================== ВКЛАДКА 1: MCP-СЕРВЕРЫ И СЕРВИСЫ ==================== -->
        <div ~if="activeTab === 'mcp'" style="display:flex;flex-direction:column;gap:16px;">
            <div class="info-banner">
                <div class="info-col">
                    <strong>1. Где живут MCP-серверы в WORK</strong>
                    Каждый MCP-сервер — это класс <span class="code-chip">/SERVICES/&lt;Имя&gt;/$service/class.js</span> с полем <span class="code-chip">mcp: { command, args }</span> (stdio) или <span class="code-chip">mcp: { url, headers }</span> (HTTP).
                </div>
                <div class="info-col">
                    <strong>2. Как агент вызывает инструменты MCP</strong>
                    Все инструменты включённых MCP-серверов автоматически доступны ИИ-агенту и Консультанту как <span class="code-chip">mcp_&lt;Сервис&gt;_&lt;инструмент&gt;</span> без перезапуска сервера.
                </div>
                <div class="info-col">
                    <strong>3. WORK как MCP-сервер для OpenCode / Claude</strong>
                    Сам сервер WORK также раздаёт свои инструменты наружу по адресу <span class="code-chip">{{workMcpEndpoint}}</span> (токен выпускается в Профиле пользователя).
                </div>
            </div>

            <!-- Форма добавления MCP-сервера -->
            <div class="section-card">
                <div class="section-head">
                    <h3>➕ Подключить MCP-сервер в /SERVICES</h3>
                    <div class="btn-row">
                        <button class="btn" :class="{'btn-primary': mcpMode === 'json'}" @tap="mcpMode = 'json'">Вставить JSON (Claude / Cursor / OpenCode)</button>
                        <button class="btn" :class="{'btn-primary': mcpMode === 'form'}" @tap="mcpMode = 'form'">Поля формы (stdio / HTTP)</button>
                    </div>
                </div>

                <div ~if="mcpMode === 'json'" style="display:flex;flex-direction:column;gap:10px;">
                    <div class="field">
                        <label>Вставьте стандартный конфиг <code>mcpServers</code> или <code>mcp</code>:</label>
                        <textarea :value="mcpJsonInput" @input="mcpJsonInput = $event.target.value" placeholder='{"mcpServers": {"filesystem": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]}}}'></textarea>
                    </div>
                    <div class="btn-row">
                        <button class="btn btn-primary" @tap="installMcpFromJson">⚡ Установить MCP из JSON</button>
                    </div>
                </div>

                <div ~if="mcpMode === 'form'" style="display:flex;flex-direction:column;gap:10px;">
                    <div class="form-grid">
                        <div class="field">
                            <label>ID в /SERVICES (латиницей)</label>
                            <input type="text" :value="formId" @input="formId = $event.target.value" placeholder="playwright">
                        </div>
                        <div class="field">
                            <label>Название</label>
                            <input type="text" :value="formLabel" @input="formLabel = $event.target.value" placeholder="Playwright MCP">
                        </div>
                        <div class="field">
                            <label>Транспорт</label>
                            <select :value="formTransport" @change="formTransport = $event.target.value">
                                <option value="stdio">Локальный процесс (stdio: npx / uvx / node)</option>
                                <option value="http">Удалённый сервер (Streamable HTTP / SSE)</option>
                            </select>
                        </div>
                    </div>
                    <div ~if="formTransport === 'stdio'" class="form-grid">
                        <div class="field">
                            <label>Команда (command)</label>
                            <input type="text" :value="formCommand" @input="formCommand = $event.target.value" placeholder="npx">
                        </div>
                        <div class="field">
                            <label>Аргументы (через пробел)</label>
                            <input type="text" :value="formArgs" @input="formArgs = $event.target.value" placeholder="-y @playwright/mcp@latest">
                        </div>
                    </div>
                    <div ~if="formTransport === 'http'" class="form-grid">
                        <div class="field">
                            <label>URL MCP-сервера</label>
                            <input type="text" :value="formUrl" @input="formUrl = $event.target.value" placeholder="https://example.com/mcp">
                        </div>
                        <div class="field">
                            <label>Токен Authorization (сохранится в #secret)</label>
                            <input type="password" :value="formToken" @input="formToken = $event.target.value" placeholder="Bearer ...">
                        </div>
                    </div>
                    <div class="btn-row">
                        <button class="btn btn-primary" @tap="installMcpFromForm">⚡ Сохранить MCP-сервер в /SERVICES</button>
                    </div>
                </div>
            </div>

            <!-- Установленные MCP-серверы -->
            <div class="section-card">
                <div class="section-head">
                    <h3>🔌 Установленные MCP-серверы ({{mcpServers.length}})</h3>
                </div>
                <div ~if="!mcpServers.length" style="opacity:0.7;font-size:13px;">
                    В <code>/SERVICES</code> пока нет подключённых MCP-серверов. Выберите готовый шаблон ниже или вставьте JSON выше.
                </div>
                <div ~if="mcpServers.length" class="cards-grid">
                    <div class="srv-card" ~for="mcpServers">
                        <div class="srv-head">
                            <div>
                                <div class="srv-title">
                                    <span>{{$for.item.label}}</span>
                                    <span class="code-chip">{{$for.item.path}}</span>
                                </div>
                                <div class="srv-sub">{{$for.item.description}}</div>
                            </div>
                            <span class="status-pill" :class="$for.item.enabled ? 'status-on' : 'status-off'">
                                {{$for.item.enabled ? 'Включён' : 'Выключен'}}
                            </span>
                        </div>
                        <div class="cmd-box">
                            {{$for.item.transport === 'http' ? ('HTTP: ' + $for.item.url) : ('STDIO: ' + $for.item.command + ' ' + ($for.item.args || []).join(' '))}}
                        </div>
                        <div class="btn-row">
                            <button class="btn" @tap="inspectMcp($for.item)">🔍 Проверить инструменты (tools/list)</button>
                            <button class="btn" @tap="toggleMcp($for.item)">{{$for.item.enabled ? '⏸ Выключить' : '▶ Включить'}}</button>
                            <button class="btn btn-danger" @tap="deleteMcp($for.item)">✕ Удалить</button>
                        </div>
                        <div ~if="inspectedTools[$for.item.id]" class="tools-list">
                            <div ~if="inspectedTools[$for.item.id].error" style="color:#dc2626;">
                                Ошибка: {{inspectedTools[$for.item.id].error}}
                            </div>
                            <div ~if="!inspectedTools[$for.item.id].error">
                                <strong>Доступно инструментов ({{inspectedTools[$for.item.id].tools.length}}):</strong>
                            </div>
                            <div class="tool-item" ~for="inspectedTools[$for.item.id].tools">
                                <div><span class="code-chip">{{$for.item.agentToolName}}</span></div>
                                <div style="opacity:0.8;margin-top:2px;">{{$for.item.description}}</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Быстрые пресеты MCP -->
            <div class="section-card">
                <div class="section-head">
                    <h3>🚀 Быстрая установка популярных MCP-серверов в 1 клик</h3>
                </div>
                <div class="cards-grid">
                    <div class="srv-card" ~for="presets">
                        <div class="srv-head">
                            <div>
                                <div class="srv-title">{{$for.item.label}}</div>
                                <div class="srv-sub">{{$for.item.description}}</div>
                            </div>
                            <span class="code-chip">{{$for.item.transport}}</span>
                        </div>
                        <div class="cmd-box">
                            {{$for.item.mcp.url ? $for.item.mcp.url : ($for.item.mcp.command + ' ' + ($for.item.mcp.args || []).join(' '))}}
                        </div>
                        <div class="btn-row">
                            <button class="btn btn-primary" @tap="installPreset($for.item)">＋ Установить в /SERVICES/{{$for.item.id}}</button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Встроенные коннекторы /SERVICES -->
            <div class="section-card">
                <div class="section-head">
                    <h3>🌐 Встроенные сервисы-коннекторы /SERVICES ({{connectors.length}})</h3>
                </div>
                <div class="cards-grid">
                    <div class="srv-card" ~for="connectors">
                        <div class="srv-head">
                            <div>
                                <div class="srv-title">
                                    <span>{{$for.item.label}}</span>
                                    <span class="code-chip">{{$for.item.path}}</span>
                                </div>
                                <div class="srv-sub">{{$for.item.description}}</div>
                            </div>
                            <span class="status-pill status-on">Встроенный</span>
                        </div>
                        <div ~if="$for.item.tools?.length" style="font-size:12px;">
                            Методы: <span class="code-chip">{{$for.item.tools.join(', ')}}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- ==================== ВКЛАДКА 2: НАВЫКИ ИИ (SKILLS) ==================== -->
        <div ~if="activeTab === 'skills'" style="display:flex;flex-direction:column;gap:16px;">
            <div class="info-banner">
                <div class="info-col">
                    <strong>1. Совместимость со стандартом SKILL.md</strong>
                    WORK поддерживает внешние навыки в формате <span class="code-chip">&lt;id&gt;/SKILL.md</span> и <span class="code-chip">&lt;id&gt;.md</span> из OpenCode, Claude Code и репозиториев GitHub.
                </div>
                <div class="info-col">
                    <strong>2. Как вызвать навык в чате / Консультанте</strong>
                    Напишите <span class="code-chip">@имя-навыка</span> (например <span class="code-chip">@grill-me</span>) прямо в сообщении — инструкция навыка автоматически загрузится в контекст ИИ!
                </div>
                <div class="info-col">
                    <strong>3. Где хранятся навыки</strong>
                    Глобальные навыки системы живут в <span class="code-chip">/$server/$folder/$class/ai/skills/</span>, а навыки конкретного подразделения — в <span class="code-chip">&lt;Подразделение&gt;/$structure/ai/skills/</span>.
                </div>
            </div>

            <!-- Локальные навыки OpenCode / Claude, найденные на этом ПК -->
            <div class="section-card" ~if="hostSkills.length">
                <div class="section-head">
                    <h3>💻 Найдены на этом компьютере в OpenCode / Claude Code ({{hostSkills.length}})</h3>
                </div>
                <div class="cards-grid">
                    <div class="srv-card" ~for="hostSkills">
                        <div class="srv-head">
                            <div>
                                <div class="srv-title">
                                    <span class="code-chip">@{{$for.item.id}}</span>
                                    <span>{{$for.item.sourceLabel}}</span>
                                </div>
                                <div class="srv-sub">{{$for.item.description}}</div>
                            </div>
                            <span class="status-pill" :class="$for.item.installedInWork ? 'status-on' : 'status-off'">
                                {{$for.item.installedInWork ? '✓ В WORK' : 'Внешний'}}
                            </span>
                        </div>
                        <div class="cmd-box">{{$for.item.filePath}}</div>
                        <div class="btn-row">
                            <button class="btn btn-primary" @tap="importHostSkill($for.item)">
                                {{$for.item.installedInWork ? '↻ Обновить копию в WORK' : '⬇ Импортировать в WORK в 1 клик'}}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Установка внешнего навыка по URL / GitHub или из текста SKILL.md -->
            <div class="section-card">
                <div class="section-head">
                    <h3>➕ Установить внешний навык (по ссылке GitHub / URL или из SKILL.md)</h3>
                </div>
                <div class="form-grid">
                    <div class="field" style="grid-column: span 2;">
                        <label>Ссылка на SKILL.md или папку навыка на GitHub (необязательно, если вставляете текст ниже)</label>
                        <input type="text" :value="skillUrlInput" @input="skillUrlInput = $event.target.value" placeholder="https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md">
                    </div>
                    <div class="field">
                        <label>Имя навыка (если нет во фронтматтере)</label>
                        <input type="text" :value="skillIdInput" @input="skillIdInput = $event.target.value" placeholder="grill-me">
                    </div>
                </div>
                <div class="field">
                    <label>Или вставьте содержимое файла <code>SKILL.md</code> напрямую:</label>
                    <textarea :value="skillContentInput" @input="skillContentInput = $event.target.value" placeholder="---\nname: my-skill\ndescription: Когда применять этот навык\n---\n\nИнструкция навыка..."></textarea>
                </div>
                <div class="btn-row">
                    <button class="btn btn-primary" @tap="installCustomSkill">⚡ Установить навык в WORK</button>
                </div>
            </div>

            <!-- Установленные в WORK навыки -->
            <div class="section-card">
                <div class="section-head">
                    <h3>🧠 Установленные в WORK навыки ({{skills.length}})</h3>
                </div>
                <div class="cards-grid">
                    <div class="srv-card" ~for="skills">
                        <div class="srv-head">
                            <div>
                                <div class="srv-title">
                                    <span class="code-chip">@{{$for.item.id}}</span>
                                </div>
                                <div class="srv-sub">{{$for.item.description}}</div>
                            </div>
                            <span class="status-pill status-on">{{$for.item.isFolder ? 'SKILL.md' : '.md'}}</span>
                        </div>
                        <div class="cmd-box">{{$for.item.path}}</div>
                        <div class="btn-row">
                            <button class="btn" @tap="togglePreviewSkill($for.item)">
                                {{expandedSkillId === $for.item.id ? '▲ Скрыть инструкцию' : '👁 Показать инструкцию'}}
                            </button>
                            <button class="btn" @tap="copySkillMention($for.item)">📋 Скопировать @{{$for.item.id}}</button>
                        </div>
                        <div ~if="expandedSkillId === $for.item.id" class="skill-preview">{{$for.item.body}}</div>
                    </div>
                </div>
            </div>
        </div>
    `,
    props: {
        $item: null,
        activeTab: 'mcp',
        mcpMode: 'json',
        mcpServers: { type: Array, default: () => [] },
        connectors: { type: Array, default: () => [] },
        presets: { type: Array, default: () => [] },
        skills: { type: Array, default: () => [] },
        hostSkills: { type: Array, default: () => [] },
        inspectedTools: { type: Object, default: () => ({}) },
        expandedSkillId: '',
        noticeText: '',
        noticeError: false,
        mcpJsonInput: '',
        formId: '',
        formLabel: '',
        formTransport: 'stdio',
        formCommand: 'npx',
        formArgs: '',
        formUrl: '',
        formToken: '',
        skillUrlInput: '',
        skillIdInput: '',
        skillContentInput: '',
    },
    get workMcpEndpoint() {
        return (typeof location !== 'undefined' ? location.origin : 'http://localhost:8001') + '/mcp';
    },
    observers: [
        function watchItem($item) {
            if ($item)
                this.reload();
        },
    ],
    attached() {
        this.reload();
    },
    setTab(tab) {
        this.activeTab = tab;
        this.noticeText = '';
    },
    showNotice(text, isError = false) {
        this.noticeText = String(text || '');
        this.noticeError = Boolean(isError);
    },
    async _serviceTarget() {
        if (this.$item && typeof this.$item.fetch === 'function')
            return this.$item;
        return WORK.get_item('/SERVICES');
    },
    async reload() {
        try {
            const target = await this._serviceTarget();
            const res = await target.fetch('mcp_catalog', {});
            this.mcpServers = Array.isArray(res?.mcpServers) ? res.mcpServers : [];
            this.connectors = Array.isArray(res?.connectors) ? res.connectors : [];
            this.presets = Array.isArray(res?.presets) ? res.presets : [];
            this.skills = Array.isArray(res?.skills) ? res.skills : [];
            this.hostSkills = Array.isArray(res?.hostSkills) ? res.hostSkills : [];
        }
        catch (e) {
            this.showNotice('Ошибка загрузки каталога: ' + (e?.message || e), true);
        }
    },
    async installMcpFromJson() {
        if (!String(this.mcpJsonInput || '').trim()) {
            this.showNotice('Вставьте JSON конфигурации MCP', true);
            return;
        }
        try {
            const target = await this._serviceTarget();
            const res = await target.fetch('mcp_install', { json: this.mcpJsonInput });
            const names = (res?.installed || []).map(x => x.id).join(', ');
            this.mcpJsonInput = '';
            this.showNotice(`MCP-сервер (${names}) успешно подключён в /SERVICES!`);
            await this.reload();
        }
        catch (e) {
            this.showNotice(e?.message || String(e), true);
        }
    },
    async installMcpFromForm() {
        if (!String(this.formId || '').trim()) {
            this.showNotice('Укажите ID MCP-сервера (например playwright)', true);
            return;
        }
        try {
            const target = await this._serviceTarget();
            const payload = {
                id: this.formId.trim(),
                label: (this.formLabel || this.formId).trim(),
                ...(this.formTransport === 'http'
                    ? {
                        url: this.formUrl.trim(),
                        headers: this.formToken.trim() ? { Authorization: this.formToken.trim() } : undefined,
                    }
                    : {
                        command: this.formCommand.trim(),
                        args: this.formArgs.trim() ? this.formArgs.trim().split(/\s+/) : [],
                    }),
            };
            await target.fetch('mcp_install', payload);
            this.formId = '';
            this.formLabel = '';
            this.formArgs = '';
            this.formUrl = '';
            this.formToken = '';
            this.showNotice(`MCP-сервер /SERVICES/${payload.id} успешно сохранён!`);
            await this.reload();
        }
        catch (e) {
            this.showNotice(e?.message || String(e), true);
        }
    },
    async installPreset(preset) {
        try {
            const target = await this._serviceTarget();
            await target.fetch('mcp_install', {
                id: preset.id,
                label: preset.label,
                description: preset.description,
                icon: preset.icon,
                mcp: preset.mcp,
            });
            this.showNotice(`Шаблон «${preset.label}» установлен в /SERVICES/${preset.id}!`);
            await this.reload();
        }
        catch (e) {
            this.showNotice(e?.message || String(e), true);
        }
    },
    async toggleMcp(srv) {
        try {
            const target = await this._serviceTarget();
            await target.fetch('mcp_toggle', { id: srv.id, enabled: !srv.enabled });
            await this.reload();
        }
        catch (e) {
            this.showNotice(e?.message || String(e), true);
        }
    },
    async deleteMcp(srv) {
        try {
            const target = await this._serviceTarget();
            await target.fetch('mcp_remove', { id: srv.id });
            this.showNotice(`MCP-сервер /SERVICES/${srv.id} удалён.`);
            await this.reload();
        }
        catch (e) {
            this.showNotice(e?.message || String(e), true);
        }
    },
    async inspectMcp(srv) {
        try {
            this.showNotice(`Запрос tools/list у ${srv.label}...`);
            const target = await this._serviceTarget();
            const res = await target.fetch('mcp_inspect', { id: srv.id });
            this.inspectedTools = {
                ...this.inspectedTools,
                [srv.id]: res?.ok ? { tools: res.tools || [] } : { error: res?.error || 'Не удалось получить список инструментов', tools: [] },
            };
            this.showNotice(res?.ok ? `Получено инструментов от ${srv.label}: ${(res.tools || []).length}` : `Ошибка MCP ${srv.label}: ${res?.error}`, !res?.ok);
        }
        catch (e) {
            this.inspectedTools = { ...this.inspectedTools, [srv.id]: { error: e?.message || String(e), tools: [] } };
            this.showNotice(e?.message || String(e), true);
        }
    },
    async importHostSkill(hostSkill) {
        try {
            const target = await this._serviceTarget();
            const res = await target.fetch('skill_install', {
                sourceType: 'host',
                hostId: hostSkill.id,
                scope: 'global',
            });
            this.showNotice(`Навык @${res.id} импортирован в ${res.path}! Теперь вызывайте его через @${res.id} в чате или Консультанте.`);
            await this.reload();
        }
        catch (e) {
            this.showNotice(e?.message || String(e), true);
        }
    },
    async installCustomSkill() {
        const hasUrl = Boolean(String(this.skillUrlInput || '').trim());
        const hasContent = Boolean(String(this.skillContentInput || '').trim());
        if (!hasUrl && !hasContent) {
            this.showNotice('Укажите ссылку на SKILL.md или вставьте текст навыка', true);
            return;
        }
        try {
            const target = await this._serviceTarget();
            const res = await target.fetch('skill_install', {
                sourceType: hasUrl ? 'url' : 'content',
                url: this.skillUrlInput.trim(),
                id: this.skillIdInput.trim(),
                content: this.skillContentInput.trim(),
                scope: 'global',
            });
            this.skillUrlInput = '';
            this.skillIdInput = '';
            this.skillContentInput = '';
            this.showNotice(`Навык @${res.id} установлен в ${res.path}!`);
            await this.reload();
        }
        catch (e) {
            this.showNotice(e?.message || String(e), true);
        }
    },
    togglePreviewSkill(skill) {
        this.expandedSkillId = this.expandedSkillId === skill.id ? '' : skill.id;
    },
    async copySkillMention(skill) {
        const mention = '@' + skill.id + ' ';
        try {
            await navigator.clipboard.writeText(mention);
            this.showNotice(`Скопировано «${mention.trim()}» — вставьте в сообщение чата или Консультанта!`);
        }
        catch {
            this.showNotice(`Напишите ${mention.trim()} в сообщении чата или Консультанта.`);
        }
    },
});
