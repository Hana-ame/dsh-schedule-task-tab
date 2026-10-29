window.__ModuleLoader__.load({
  id: 'dsh-schedule-task-tab',
  factory(require) {
    const react = require('react');
    const { jsx, jsxs } = require('react/jsx-runtime');
    require('@deepseek-ai/cordis');

    /** Locale namespace for this tab. */
    const NS = 'scheduleTaskTab';
    /** The view id this package owns, shown in the conversation tablist. */
    const VIEW_ID = 'tasks';

    /** Required browser services: the view list seat and the locale face. Host RPC rides plain fetch. */
    const INJECT = ['slots', 'locale'];

    const ROUTE = '/api/inject-manager';

    const zh = {
      'view.label': '注入',
      'section.tasks': '注入任务',
      'section.templates': '模板库',
      'section.memo': '本会话 Memo',
      'section.runs': '最近注入',
      'new.task': '新建任务',
      'new.template': '新建模板',
      'empty.tasks': '还没有注入任务',
      'empty.templates': '还没有模板',
      'empty.runs': '还没有注入记录',
      'task.name': '任务名',
      'task.every': '间隔（分钟）',
      'task.model': '模型',
      'task.model.hint': '不选则用会话默认模型',
      'task.prompt': 'System Prompt（目标任务）',
      'task.prompt.hint': '完整自定义子代理指令（步骤/格式全由你定）；可用占位符 {sessionId} {taskName}',
      'task.enabled': '启用定时触发',
      'task.useMemo': '读取 Memo',
      'task.template': '从模板填入',
      'task.template.pick': '— 选择模板即填入 —',
      'save': '保存',
      'cancel': '取消',
      'edit': '编辑',
      'delete': '删除',
      'confirm.delete': '确认删除？',
      'run.now': '立即注入',
      'on': '运行中',
      'off': '已停用',
      'next': '下次',
      'memo.save': '保存 Memo',
      'memo.clear': '清空',
      'memo.empty': '（空）memo 是子代理与本面板共享的持久笔记，子代理可通过工具读写',
      'template.name': '名称',
      'template.desc': '描述',
      'template.body': '完整子代理指令模板（跨会话通用，支持 {sessionId} {taskName}）',
      'provider': 'Provider',
      'loading': '加载中…',
      'refresh': '刷新',
      'status.ok': '已注入',
      'status.failed': '失败',
      'status.skip': '未注入',
      'no.model.catalog': '模型目录不可用',
      'scope.session': '本会话',
      'scope.all': '全部会话',
      'subagent.hint': '子代理会话不参与会话注入（注入只作用于主 agent 会话）',
      'runs.more': '展开全部',
      'runs.less': '收起',
      'subagent.session': '子代理会话',
      'saved': '已保存',
      'created': '已创建',
      'updated': '已更新',
      'triggered': '已触发一次注入',
      'memo.saved': 'Memo 已保存',
      'memo.cleared': 'Memo 已清空',
      'task.name.placeholder': '例如：每日进展注入',
      'default.model': '默认模型',
    };
    const en = {
      'view.label': 'Inject',
      'section.tasks': 'Injections',
      'section.templates': 'Templates',
      'section.memo': 'Session Memo',
      'section.runs': 'Recent runs',
      'new.task': 'New task',
      'new.template': 'New template',
      'empty.tasks': 'No injections yet',
      'empty.templates': 'No templates yet',
      'empty.runs': 'No runs yet',
      'task.name': 'Name',
      'task.every': 'Interval (minutes)',
      'task.model': 'Model',
      'task.model.hint': 'Leave empty to use the session default model',
      'task.prompt': 'System prompt (goal)',
      'task.prompt.hint': 'Full custom subagent instruction (steps/format fully yours); placeholders {sessionId} {taskName}',
      'task.enabled': 'Schedule enabled',
      'task.useMemo': 'Read memo',
      'task.template': 'Fill from template',
      'task.template.pick': '— pick a template to fill —',
      'save': 'Save',
      'cancel': 'Cancel',
      'edit': 'Edit',
      'delete': 'Delete',
      'confirm.delete': 'Confirm delete?',
      'run.now': 'Run now',
      'on': 'On',
      'off': 'Off',
      'next': 'Next',
      'memo.save': 'Save memo',
      'memo.clear': 'Clear',
      'memo.empty': '(empty) the memo is a persistent note shared with injection subagents',
      'template.name': 'Name',
      'template.desc': 'Description',
      'template.body': 'Full subagent instruction template (shared across sessions; supports {sessionId} {taskName})',
      'provider': 'Provider',
      'loading': 'Loading…',
      'refresh': 'Refresh',
      'status.ok': 'Injected',
      'status.failed': 'Failed',
      'status.skip': 'Skipped',
      'no.model.catalog': 'Model catalog unavailable',
      'scope.session': 'This session',
      'scope.all': 'All sessions',
      'subagent.hint': 'Subagent sessions never participate in injection (injection only targets root agent sessions)',
      'runs.more': 'Show all',
      'runs.less': 'Show less',
      'subagent.session': 'subagent session',
      'saved': 'Saved',
      'created': 'Created',
      'updated': 'Updated',
      'triggered': 'Triggered one injection',
      'memo.saved': 'Memo saved',
      'memo.cleared': 'Memo cleared',
      'task.name.placeholder': 'e.g. Daily progress injection',
      'default.model': 'default model',
    };

    /* 主题无关：文字继承父级，背景/边框用半透明中性色，强调色固定。
       面板按「卡片分区 + 悬浮操作」组织，窄栏（会话内嵌）下保持单列。 */
    const CSS = '' +
      '.inj-root{display:flex;flex-direction:column;gap:12px;overflow:auto;padding:14px 16px 20px;font-size:13px;line-height:1.5;color:inherit;background:transparent;max-width:760px}' +
      /* 顶栏 */
      '.inj-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}' +
      '.inj-title{font-size:15px;font-weight:650;letter-spacing:.2px}' +
      '.inj-spacer{flex:1}' +
      '.inj-seg{display:inline-flex;border:1px solid rgba(127,127,127,.28);border-radius:8px;overflow:hidden;background:rgba(127,127,127,.05)}' +
      '.inj-segBtn{border:0;background:transparent;color:inherit;font:inherit;font-size:12px;padding:4px 12px;cursor:pointer;opacity:.7}' +
      '.inj-segBtn.active{background:rgba(37,99,235,.14);color:#2563eb;opacity:1;font-weight:600}' +
      /* 分区卡片 */
      '.inj-card{border:1px solid rgba(127,127,127,.18);border-radius:12px;background:rgba(127,127,127,.05);overflow:hidden}' +
      '.inj-cardHead{display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;user-select:none}' +
      '.inj-cardHead:hover{background:rgba(127,127,127,.06)}' +
      '.inj-cardTitle{font-size:12px;font-weight:650;text-transform:uppercase;letter-spacing:.5px;opacity:.65;flex:1}' +
      '.inj-caret{font-size:10px;opacity:.5;transition:transform .15s}' +
      '.inj-caret.open{transform:rotate(90deg)}' +
      '.inj-cardBody{padding:0 12px 12px;display:flex;flex-direction:column;gap:8px}' +
      /* 任务条目 */
      '.inj-task{display:flex;flex-direction:column;gap:4px;padding:10px 12px;border:1px solid rgba(127,127,127,.18);border-radius:10px;background:rgba(127,127,127,.03);transition:border-color .15s}' +
      '.inj-task:hover{border-color:rgba(127,127,127,.4)}' +
      '.inj-taskTop{display:flex;align-items:center;gap:8px}' +
      '.inj-taskName{font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.inj-dot{flex:none;width:8px;height:8px;border-radius:50%}' +
      '.inj-dot.on{background:#16a34a;box-shadow:0 0 0 3px rgba(22,163,74,.15)}' +
      '.inj-dot.off{background:rgba(127,127,127,.5)}' +
      '.inj-actions{margin-left:auto;display:flex;gap:4px;opacity:.35;transition:opacity .15s}' +
      '.inj-task:hover .inj-actions,.inj-task.confirm .inj-actions{opacity:1}' +
      '.inj-chips{display:flex;flex-wrap:wrap;gap:4px}' +
      '.inj-chip{font-size:11px;padding:1px 8px;border-radius:999px;background:rgba(127,127,127,.12);opacity:.85;white-space:nowrap}' +
      '.inj-chip.memo{background:rgba(22,163,74,.12);color:#16a34a}' +
      '.inj-chip.nomemo{background:rgba(127,127,127,.1);opacity:.55}' +
      '.inj-chip.model{background:rgba(37,99,235,.1);color:#2563eb}' +
      /* 开关 */
      '.inj-switch{position:relative;flex:none;width:30px;height:17px;border-radius:999px;background:rgba(127,127,127,.35);border:0;cursor:pointer;padding:0;transition:background .15s}' +
      '.inj-switch.on{background:#16a34a}' +
      '.inj-switch::after{content:"";position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;background:#fff;transition:left .15s}' +
      '.inj-switch.on::after{left:15px}' +
      /* 按钮 */
      '.inj-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;border-radius:8px;padding:4px 10px;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap;transition:background .12s}' +
      '.inj-btn:hover{background:rgba(127,127,127,.12)}' +
      '.inj-btn.primary{background:#2563eb;border-color:transparent;color:#fff}' +
      '.inj-btn.primary:hover{background:#1d4ed8}' +
      '.inj-btn.danger{color:#dc2626;border-color:rgba(220,38,38,.4)}' +
      '.inj-btn.danger:hover{background:rgba(220,38,38,.08)}' +
      '.inj-btn.small{padding:2px 8px;font-size:12px;border-radius:6px}' +
      '.inj-btn.icon{padding:2px 7px;border-color:transparent;font-size:13px}' +
      /* 表单 */
      '.inj-form{display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid rgba(37,99,235,.3);border-radius:10px;background:rgba(37,99,235,.04)}' +
      '.inj-formGrid{display:grid;grid-template-columns:1fr 1fr;gap:8px 12px}' +
      '.inj-field{display:flex;flex-direction:column;gap:3px;min-width:0}' +
      '.inj-field.full{grid-column:1/-1}' +
      '.inj-label{font-size:11px;font-weight:600;opacity:.6;text-transform:uppercase;letter-spacing:.4px}' +
      '.inj-input,.inj-textarea,.inj-select{width:100%;padding:6px 9px;border:1px solid rgba(127,127,127,.35);border-radius:8px;background:inherit;color:inherit;font:inherit;font-size:13px;color-scheme:light dark;box-sizing:border-box}' +
      '.inj-input:focus,.inj-textarea:focus,.inj-select:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 2px rgba(37,99,235,.18)}' +
      '.inj-textarea{min-height:88px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.55}' +
      '.inj-select{background:#ffffff;color:#1f2328;color-scheme:light}' +
      '.inj-select option{background:#ffffff;color:#1f2328}' +
      '.inj-select:disabled{opacity:.6}' +
      '@media (prefers-color-scheme: dark){.inj-select{background:#202124;color:#e8eaed;color-scheme:dark}.inj-select option{background:#202124;color:#e8eaed}}' +
      '.inj-checks{display:flex;gap:16px;align-items:center;flex-wrap:wrap}' +
      '.inj-check{display:inline-flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;user-select:none}' +
      '.inj-formActions{display:flex;gap:8px;justify-content:flex-end}' +
      '.inj-hint{font-size:11px;opacity:.55}' +
      /* 模板管理 */
      '.inj-tplMgr{margin-top:4px;border-top:1px dashed rgba(127,127,127,.25);padding-top:10px;display:flex;flex-direction:column;gap:6px}' +
      '.inj-tpl{display:flex;flex-direction:column;gap:2px;padding:7px 9px;border:1px solid rgba(127,127,127,.2);border-radius:8px}' +
      '.inj-tplHead{display:flex;align-items:center;gap:6px}' +
      '.inj-tplBody{font-family:ui-monospace,monospace;font-size:11px;opacity:.75;white-space:pre-wrap;max-height:96px;overflow:auto}' +
      /* memo */
      '.inj-memoHint{font-size:11px;opacity:.55}' +
      /* 运行记录 */
      '.inj-run{display:flex;gap:8px;padding:7px 2px;border-bottom:1px solid rgba(127,127,127,.12)}' +
      '.inj-run:last-child{border-bottom:0}' +
      '.inj-runDot{flex:none;margin-top:5px;width:7px;height:7px;border-radius:50%}' +
      '.inj-runDot.ok{background:#16a34a}' +
      '.inj-runDot.failed{background:#dc2626}' +
      '.inj-runBody{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}' +
      '.inj-runHead{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}' +
      '.inj-runName{font-weight:600;font-size:12px}' +
      '.inj-runTime{font-size:11px;opacity:.5}' +
      '.inj-runBrief{font-size:12px;opacity:.8;overflow-wrap:anywhere;white-space:pre-wrap}' +
      '.inj-runSub{font-family:ui-monospace,monospace;font-size:10px;opacity:.45}' +
      /* 状态/通知 */
      '.inj-meta{font-size:12px;opacity:.6}' +
      '.inj-mono{font-family:ui-monospace,monospace;font-size:11px;opacity:.55}' +
      '.inj-notice{display:flex;align-items:center;gap:8px;padding:7px 11px;border-radius:8px;font-size:12px;border:1px solid rgba(22,163,74,.4);background:rgba(22,163,74,.08);color:#16a34a}' +
      '.inj-notice.err{color:#dc2626;border-color:rgba(220,38,38,.4);background:rgba(220,38,38,.07)}' +
      '.inj-state{padding:32px 12px;text-align:center;opacity:.65;font-size:13px;line-height:1.6}' +
      '.inj-empty{padding:14px;text-align:center;font-size:12px;opacity:.55;border:1px dashed rgba(127,127,127,.25);border-radius:10px}' +
      '.inj-groupLabel{font-size:11px;font-weight:600;opacity:.55;margin-top:4px;font-family:ui-monospace,monospace}';

    const TAG = 'dsh-schedule-task-tab/styles';
    function ensureStyles() {
      if (typeof document === 'undefined') return;
      if (document.querySelector('style[data-plugin-css="' + TAG + '"]')) return;
      const tag = document.createElement('style');
      tag.setAttribute('data-plugin-css', TAG);
      tag.dataset.plugin = 'dsh-schedule-task-tab';
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    /** Host RPC over same-origin fetch (the page session is already authenticated). */
    async function hostCall(method, args) {
      const res = await fetch(ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, args: args ?? {} }),
      });
      if (!res.ok) throw new Error(`host ${method} → HTTP ${res.status}`);
      const payload = await res.json();
      if (!payload || payload.ok !== true) {
        throw new Error((payload && payload.error && (payload.error.message || payload.error.code)) || `host ${method} 失败`);
      }
      return payload.value;
    }

    const formatNext = (iso) => {
      if (!iso) return '—';
      const at = new Date(iso);
      if (Number.isNaN(at.getTime())) return iso;
      return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
    };

    const formatRunTime = (iso) => {
      const at = new Date(iso);
      if (Number.isNaN(at.getTime())) return iso;
      return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(at);
    };

    /* ── 可折叠分区 ────────────────────────────────────────────────── */

    function Section({ title, open, onToggle, right, children, t }) {
      return jsxs('div', { className: 'inj-card', children: [
        jsxs('div', { className: 'inj-cardHead', onClick: onToggle, children: [
          jsx('span', { className: 'inj-caret' + (open ? ' open' : ''), children: '▶' }),
          jsx('span', { className: 'inj-cardTitle', children: title }),
          right ? jsx('span', { onClick: (e) => e.stopPropagation(), style: { display: 'inline-flex', gap: 6 }, children: right }) : null,
        ] }),
        open ? jsx('div', { className: 'inj-cardBody', children }) : null,
      ] });
    }

    /* ── 任务表单 ──────────────────────────────────────────────────── */

    function TaskForm({ initial, templates, catalog, t, onSave, onCancel, onTemplatesChanged }) {
      const [name, setName] = react.useState(initial?.name ?? '');
      const [everyMinutes, setEveryMinutes] = react.useState(String(Math.round((initial?.everySeconds ?? 600) / 60)));
      const [provider, setProvider] = react.useState(initial?.provider ?? '');
      const [model, setModel] = react.useState(initial?.model ?? '');
      const [systemPrompt, setSystemPrompt] = react.useState(initial?.systemPrompt ?? '');
      const [enabled, setEnabled] = react.useState(initial?.enabled ?? true);
      const [useMemo, setUseMemo] = react.useState(initial?.useMemo ?? true);
      const [templateId, setTemplateId] = react.useState('');
      const [managerTpls, setManagerTpls] = react.useState([]);
      const [managerEdit, setManagerEdit] = react.useState(null);
      const [managerMsg, setManagerMsg] = react.useState(null);

      const groups = catalog?.groups ?? [];
      const models = groups.find((g) => g.id === provider)?.models ?? [];

      const chooseTemplate = (id) => {
        setTemplateId(id);
        const tpl = templates.find((x) => x.id === id);
        if (tpl) setSystemPrompt(tpl.body);
      };

      react.useEffect(() => {
        hostCall('templates/list')
          .then((tpls) => setManagerTpls(tpls ?? []))
          .catch((error) => setManagerMsg({ type: 'err', text: error.message }));
      }, []);

      const refreshManager = async () => {
        try {
          setManagerTpls((await hostCall('templates/list')) ?? []);
          if (onTemplatesChanged) onTemplatesChanged();
        } catch (error) {
          setManagerMsg({ type: 'err', text: error.message });
        }
      };

      const saveManagerTemplate = async (form) => {
        try {
          if (managerEdit?.id) await hostCall('templates/update', { id: managerEdit.id, patch: form });
          else await hostCall('templates/create', form);
          setManagerEdit(null);
          setManagerMsg({ type: 'ok', text: t('saved') });
          setTimeout(() => setManagerMsg(null), 2500);
          void refreshManager();
        } catch (error) {
          setManagerMsg({ type: 'err', text: error.message });
        }
      };

      const deleteManagerTemplate = async (id) => {
        try {
          await hostCall('templates/delete', { id });
          void refreshManager();
        } catch (error) {
          setManagerMsg({ type: 'err', text: error.message });
        }
      };

      const submit = () => {
        onSave({
          name: name.trim(),
          everyMinutes: Number(everyMinutes) || 10,
          provider: provider || undefined,
          model: model || undefined,
          systemPrompt,
          enabled,
          useMemo,
        });
      };

      return jsxs('div', { className: 'inj-form', children: [
        jsxs('div', { className: 'inj-formGrid', children: [
          jsxs('div', { className: 'inj-field', children: [
            jsx('label', { className: 'inj-label', children: t('task.name') }),
            jsx('input', { className: 'inj-input', value: name, onChange: (e) => setName(e.target.value), placeholder: t('task.name.placeholder') }),
          ] }),
          jsxs('div', { className: 'inj-field', children: [
            jsx('label', { className: 'inj-label', children: t('task.every') }),
            jsx('input', { className: 'inj-input', type: 'number', min: 1, max: 1440, value: everyMinutes, onChange: (e) => setEveryMinutes(e.target.value) }),
          ] }),
          jsxs('div', { className: 'inj-field', children: [
            jsx('label', { className: 'inj-label', children: t('provider') }),
            jsx('select', { className: 'inj-select', value: provider, onChange: (e) => { setProvider(e.target.value); setModel(''); }, children: [
              jsx('option', { value: '', children: `— ${t('default.model')} —` }),
              (groups ?? []).map((g) => jsx('option', { key: g.id, value: g.id, children: g.name || g.id })),
            ] }),
          ] }),
          jsxs('div', { className: 'inj-field', children: [
            jsx('label', { className: 'inj-label', children: t('task.model') }),
            jsx('select', { className: 'inj-select', value: model, onChange: (e) => setModel(e.target.value), disabled: !provider, children: [
              jsx('option', { value: '', children: '— model —' }),
              models.map((m) => jsx('option', { key: m.id, value: m.id, children: m.name || m.id })),
            ] }),
          ] }),
          jsxs('div', { className: 'inj-field full', children: [
            jsx('label', { className: 'inj-label', children: t('task.prompt') }),
            jsx('textarea', { className: 'inj-textarea', value: systemPrompt, onChange: (e) => setSystemPrompt(e.target.value), placeholder: t('task.prompt.hint') }),
          ] }),
        ] }),
        /* 启用开关 + 保存/取消 必须在模板区上方 */
        jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }, children: [
          jsxs('div', { className: 'inj-checks', children: [
            jsxs('label', { className: 'inj-check', children: [
              jsx('input', { type: 'checkbox', checked: enabled, onChange: (e) => setEnabled(e.target.checked) }),
              t('task.enabled'),
            ] }),
            jsxs('label', { className: 'inj-check', children: [
              jsx('input', { type: 'checkbox', checked: useMemo, onChange: (e) => setUseMemo(e.target.checked) }),
              t('task.useMemo'),
            ] }),
          ] }),
          jsx('span', { className: 'inj-spacer' }),
          jsxs('div', { className: 'inj-formActions', children: [
            jsx('button', { className: 'inj-btn', onClick: onCancel, children: t('cancel') }),
            jsx('button', { className: 'inj-btn primary', onClick: submit, children: t('save') }),
          ] }),
        ] }),
        /* 模板：选择即填入 + 管理（直接展开） */
        jsxs('div', { className: 'inj-tplMgr', children: [
          jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: 8 }, children: [
            jsx('span', { className: 'inj-label', children: t('section.templates') }),
            jsx('span', { className: 'inj-spacer' }),
            jsx('button', { className: 'inj-btn small', onClick: () => setManagerEdit(managerEdit ? null : {}), children: managerEdit ? t('cancel') : t('new.template') }),
          ] }),
          jsx('select', { className: 'inj-select', value: templateId, onChange: (e) => chooseTemplate(e.target.value), children: [
            jsx('option', { value: '', children: t('task.template.pick') }),
            templates.map((x) => jsx('option', { key: x.id, value: x.id, children: x.name })),
          ] }),
          managerMsg ? jsx('div', { className: 'inj-notice' + (managerMsg.type === 'err' ? ' err' : ''), children: managerMsg.text }) : null,
          managerEdit
            ? jsx(TemplateForm, { key: managerEdit.id ?? 'new', initial: managerEdit, t, onSave: saveManagerTemplate, onCancel: () => setManagerEdit(null) })
            : null,
          managerTpls.length === 0 && !managerEdit
            ? jsx('div', { className: 'inj-meta', children: t('empty.templates') })
            : managerTpls.map((tpl) => (
              jsxs('div', { key: tpl.id, className: 'inj-tpl', children: [
                jsxs('div', { className: 'inj-tplHead', children: [
                  jsx('span', { style: { fontWeight: 600, fontSize: 12 }, children: tpl.name }),
                  jsx('span', { className: 'inj-meta', style: { flex: 1 }, children: tpl.description }),
                  jsx('button', { className: 'inj-btn small', onClick: () => setManagerEdit({ id: tpl.id, name: tpl.name, description: tpl.description, body: tpl.body }), children: t('edit') }),
                  jsx('button', { className: 'inj-btn small danger', onClick: () => deleteManagerTemplate(tpl.id), children: t('delete') }),
                ] }),
                jsx('div', { className: 'inj-tplBody', children: tpl.body }),
              ] })
            )),
        ] }),
      ] });
    }

    /* ── 模板表单 ──────────────────────────────────────────────────── */

    function TemplateForm({ initial, t, onSave, onCancel }) {
      const [name, setName] = react.useState(initial?.name ?? '');
      const [description, setDescription] = react.useState(initial?.description ?? '');
      const [body, setBody] = react.useState(initial?.body ?? '');
      return jsxs('div', { className: 'inj-formGrid', children: [
        jsxs('div', { className: 'inj-field', children: [
          jsx('label', { className: 'inj-label', children: t('template.name') }),
          jsx('input', { className: 'inj-input', value: name, onChange: (e) => setName(e.target.value) }),
        ] }),
        jsxs('div', { className: 'inj-field', children: [
          jsx('label', { className: 'inj-label', children: t('template.desc') }),
          jsx('input', { className: 'inj-input', value: description, onChange: (e) => setDescription(e.target.value) }),
        ] }),
        jsxs('div', { className: 'inj-field full', children: [
          jsx('label', { className: 'inj-label', children: t('template.body') }),
          jsx('textarea', { className: 'inj-textarea', style: { minHeight: 120 }, value: body, onChange: (e) => setBody(e.target.value) }),
        ] }),
        jsxs('div', { className: 'inj-field full', style: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }, children: [
          jsx('button', { className: 'inj-btn', onClick: onCancel, children: t('cancel') }),
          jsx('button', { className: 'inj-btn primary', onClick: () => onSave({ name: name.trim() || '未命名', description, body }), children: t('save') }),
        ] }),
      ] });
    }

    /* ── 主面板 ────────────────────────────────────────────────────── */

    const RUNS_COLLAPSED_COUNT = 5;

    function InjectPanel({ sessionId, t }) {
      const [tasks, setTasks] = react.useState([]);
      const [templates, setTemplates] = react.useState([]);
      const [memo, setMemo] = react.useState('');
      const [runs, setRuns] = react.useState([]);
      const [catalog, setCatalog] = react.useState(null);
      const [editing, setEditing] = react.useState(null);
      const [confirmId, setConfirmId] = react.useState(null);
      const [notice, setNotice] = react.useState(null);
      const [booting, setBooting] = react.useState(true);
      const [isSubagent, setIsSubagent] = react.useState(false);
      const [scope, setScope] = react.useState('session'); // 'session' | 'all'
      const [titles, setTitles] = react.useState({}); // scope=all 时各会话标题
      const [memoOpen, setMemoOpen] = react.useState(false);
      const [runsOpen, setRunsOpen] = react.useState(true);
      const [runsAll, setRunsAll] = react.useState(false);

      const refresh = react.useCallback(async () => {
        try {
          const info = await hostCall('session/info', { sessionId }).catch(() => null);
          const meta = info?.meta;
          // subagent 会话（origin=subagent 或有父会话）永远不参与注入
          setIsSubagent(!!(meta && (meta.origin === 'subagent' || meta.parentSession !== undefined)));
          const [ts, tpls, memoVal, rs, cat] = await Promise.all([
            hostCall('tasks/list', scope === 'all' ? { scope: 'all' } : { sessionId }),
            hostCall('templates/list'),
            hostCall('memo/get', { sessionId }),
            hostCall('runs/list', { sessionId, limit: 30 }),
            hostCall('model/catalog').catch(() => null),
          ]);
          // scope=all 时 host 返回 {tasks, titles}；本会话返回数组
          if (ts && !Array.isArray(ts) && Array.isArray(ts.tasks)) {
            setTasks(ts.tasks);
            setTitles(ts.titles ?? {});
          } else {
            setTasks(ts ?? []);
          }
          setTemplates(tpls ?? []);
          setMemo(memoVal?.text ?? '');
          setRuns(rs ?? []);
          if (cat) setCatalog(cat);
        } catch (error) {
          setNotice({ type: 'err', text: error.message });
        } finally {
          setBooting(false);
        }
      }, [sessionId, scope]);

      react.useEffect(() => {
        setBooting(true);
        void refresh();
        const poll = setInterval(() => void refresh().catch(() => {}), 30000);
        return () => clearInterval(poll);
      }, [refresh]);

      const flash = (type, text) => {
        setNotice({ type, text });
        if (type !== 'err') setTimeout(() => setNotice(null), 4000);
      };

      const saveTask = async (form) => {
        try {
          if (editing?.mode === 'edit') {
            await hostCall('tasks/update', {
              id: editing.task.id,
              patch: {
                name: form.name,
                everySeconds: Math.max(60, Math.round(Number(form.everyMinutes) * 60)),
                provider: form.provider,
                model: form.model,
                systemPrompt: form.systemPrompt,
                enabled: form.enabled,
                useMemo: form.useMemo,
              },
            });
            flash('ok', t('updated'));
          } else {
            await hostCall('tasks/create', {
              sessionId,
              name: form.name,
              everySeconds: Math.max(60, Math.round(Number(form.everyMinutes) * 60)),
              provider: form.provider,
              model: form.model,
              systemPrompt: form.systemPrompt,
              enabled: form.enabled,
              useMemo: form.useMemo,
            });
            flash('ok', t('created'));
          }
          setEditing(null);
          void refresh();
        } catch (error) {
          setNotice({ type: 'err', text: error.message });
        }
      };

      const toggleTask = async (task) => {
        try {
          await hostCall('tasks/toggle', { id: task.id, enabled: !task.enabled });
          void refresh();
        } catch (error) {
          setNotice({ type: 'err', text: error.message });
        }
      };

      const runNow = async (task) => {
        try {
          await hostCall('tasks/runNow', { id: task.id });
          flash('ok', t('triggered'));
          setTimeout(() => void refresh(), 1500);
        } catch (error) {
          setNotice({ type: 'err', text: error.message });
        }
      };

      const removeTask = async (task) => {
        try {
          await hostCall('tasks/delete', { id: task.id });
          setConfirmId(null);
          void refresh();
        } catch (error) {
          setNotice({ type: 'err', text: error.message });
        }
      };

      const saveMemo = async () => {
        try {
          await hostCall('memo/set', { sessionId, text: memo });
          flash('ok', t('memo.saved'));
        } catch (error) {
          setNotice({ type: 'err', text: error.message });
        }
      };

      const clearMemo = async () => {
        try {
          await hostCall('memo/set', { sessionId, text: '' });
          setMemo('');
          flash('ok', t('memo.cleared'));
        } catch (error) {
          setNotice({ type: 'err', text: error.message });
        }
      };

      if (booting) {
        return jsx('div', { className: 'inj-root', children: jsx('div', { className: 'inj-state', children: t('loading') }) });
      }

      if (isSubagent) {
        return jsx('div', { className: 'inj-root', children: jsx('div', { className: 'inj-state', children: t('subagent.hint') }) });
      }

      const modelText = (task) => (task.provider && task.model ? `${task.provider}/${task.model}` : t('default.model'));

      const renderTaskRow = (task) => {
        if (confirmId === task.id) {
          return jsxs('div', { key: task.id, className: 'inj-task confirm', children: [
            jsxs('div', { className: 'inj-taskTop', children: [
              jsx('span', { className: 'inj-taskName', children: `${task.name} — ${t('confirm.delete')}` }),
              jsxs('span', { className: 'inj-actions', style: { opacity: 1 }, children: [
                jsx('button', { className: 'inj-btn danger small', onClick: () => removeTask(task), children: t('delete') }),
                jsx('button', { className: 'inj-btn small', onClick: () => setConfirmId(null), children: t('cancel') }),
              ] }),
            ] }),
          ] });
        }
        return jsxs('div', { key: task.id, className: 'inj-task', children: [
          jsxs('div', { className: 'inj-taskTop', children: [
            jsx('button', {
              className: 'inj-switch' + (task.enabled ? ' on' : ''),
              title: task.enabled ? t('on') : t('off'),
              onClick: () => toggleTask(task),
            }),
            jsx('span', { className: 'inj-taskName', children: task.name }),
            jsxs('span', { className: 'inj-actions', children: [
              jsx('button', { className: 'inj-btn icon', title: t('run.now'), onClick: () => runNow(task), children: '▶' }),
              jsx('button', { className: 'inj-btn icon', title: t('edit'), onClick: () => setEditing({ mode: 'edit', task }), children: '✎' }),
              jsx('button', { className: 'inj-btn icon danger', title: t('delete'), onClick: () => setConfirmId(task.id), children: '✕' }),
            ] }),
          ] }),
          jsxs('div', { className: 'inj-chips', children: [
            jsx('span', { className: 'inj-chip', children: '每 ' + Math.round(task.everySeconds / 60) + ' 分钟' }),
            jsx('span', { className: 'inj-chip model', children: modelText(task) }),
            jsx('span', { className: 'inj-chip ' + (task.useMemo === false ? 'nomemo' : 'memo'), children: task.useMemo === false ? 'no memo' : 'memo' }),
            jsx('span', { className: 'inj-chip', children: t('next') + ' ' + formatNext(task.nextRunAt) }),
          ] }),
        ] });
      };

      const renderAllTasks = () => {
        const groups = new Map();
        for (const task of tasks) {
          const g = groups.get(task.sessionId) ?? [];
          g.push(task);
          groups.set(task.sessionId, g);
        }
        if (groups.size === 0) return jsx('div', { className: 'inj-empty', children: t('empty.tasks') });
        return Array.from(groups.entries()).map(([sid, items]) => (
          jsxs('div', { key: sid, style: { display: 'flex', flexDirection: 'column', gap: 6 }, children: [
            jsx('div', { className: 'inj-groupLabel', children: (titles[sid] ? titles[sid] + '  ' : '') + sid.slice(0, 13) + '… · ' + items.length }),
            items.map(renderTaskRow),
          ] })
        ));
      };

      const shownRuns = runsAll ? runs : runs.slice(0, RUNS_COLLAPSED_COUNT);

      return jsxs('div', { className: 'inj-root', children: [
        /* 顶栏 */
        jsxs('div', { className: 'inj-head', children: [
          jsx('span', { className: 'inj-title', children: t('section.tasks') }),
          jsxs('span', { className: 'inj-seg', children: [
            jsx('button', { className: 'inj-segBtn' + (scope === 'session' ? ' active' : ''), onClick: () => setScope('session'), children: t('scope.session') }),
            jsx('button', { className: 'inj-segBtn' + (scope === 'all' ? ' active' : ''), onClick: () => setScope('all'), children: t('scope.all') }),
          ] }),
          jsx('span', { className: 'inj-spacer' }),
          jsx('button', { className: 'inj-btn small', title: t('refresh'), onClick: () => void refresh(), children: '↻' }),
          jsx('button', {
            className: 'inj-btn primary small',
            style: scope === 'all' ? { opacity: 0.4, pointerEvents: 'none' } : undefined,
            onClick: () => setEditing(editing ? null : { mode: 'create' }),
            children: editing ? t('cancel') : '+ ' + t('new.task'),
          }),
        ] }),

        notice ? jsx('div', { className: 'inj-notice' + (notice.type === 'err' ? ' err' : ''), children: notice.text }) : null,

        /* 任务表单（创建/编辑） */
        editing && scope !== 'all'
          ? jsx(TaskForm, { key: editing.mode === 'edit' ? editing.task.id : 'new', initial: editing.task, templates, catalog, t, onSave: saveTask, onCancel: () => setEditing(null), onTemplatesChanged: () => void refresh() })
          : null,

        /* 任务列表 */
        scope === 'all'
          ? renderAllTasks()
          : (tasks.length === 0 && !editing
            ? jsx('div', { className: 'inj-empty', children: t('empty.tasks') })
            : tasks.map(renderTaskRow)),

        /* Memo 区（默认折叠） */
        jsx(Section, {
          title: t('section.memo'),
          open: memoOpen,
          onToggle: () => setMemoOpen(!memoOpen),
          right: memoOpen ? jsxs(react.Fragment, { children: [
            jsx('button', { className: 'inj-btn small', onClick: clearMemo, children: t('memo.clear') }),
            jsx('button', { className: 'inj-btn primary small', onClick: saveMemo, children: t('memo.save') }),
          ] }) : null,
          children: jsxs(react.Fragment, { children: [
            jsx('div', { className: 'inj-memoHint', children: t('memo.empty') }),
            jsx('textarea', { className: 'inj-textarea', style: { minHeight: 110 }, value: memo, onChange: (e) => setMemo(e.target.value), placeholder: '…' }),
          ] }),
        }),

        /* 运行记录 */
        jsx(Section, {
          title: t('section.runs') + (runs.length ? ' (' + runs.length + ')' : ''),
          open: runsOpen,
          onToggle: () => setRunsOpen(!runsOpen),
          children: runs.length === 0
            ? jsx('div', { className: 'inj-empty', children: t('empty.runs') })
            : jsxs(react.Fragment, { children: [
              shownRuns.map((run) => (
                jsxs('div', { key: run.id, className: 'inj-run', children: [
                  jsx('span', { className: 'inj-runDot ' + (run.status === 'ok' ? 'ok' : 'failed') }),
                  jsxs('div', { className: 'inj-runBody', children: [
                    jsxs('div', { className: 'inj-runHead', children: [
                      jsx('span', { className: 'inj-runName', children: run.taskName }),
                      jsx('span', { className: 'inj-runTime', children: formatRunTime(run.startedAt) }),
                    ] }),
                    jsx('div', { className: 'inj-runBrief', children: run.status === 'ok' ? run.injectedBrief : run.error }),
                    run.subagentSessionId
                      ? jsx('div', { className: 'inj-runSub', children: t('subagent.session') + ': ' + run.subagentSessionId })
                      : null,
                  ] }),
                ] })
              )),
              runs.length > RUNS_COLLAPSED_COUNT
                ? jsx('button', { className: 'inj-btn small', style: { alignSelf: 'center' }, onClick: () => setRunsAll(!runsAll), children: runsAll ? t('runs.less') : t('runs.more') + ' (' + runs.length + ')' })
                : null,
            ] }),
        }),
      ] });
    }

    /* ── 注册 ──────────────────────────────────────────────────────── */

    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'schedule-task-tab: dictionaries');
      ctx.effect(() => ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view',
        id: VIEW_ID,
        order: 20,
        locale: NS,
        label: () => t('view.label'),
        inject: (sessionId) => {
          ensureStyles();
          return { sessionId };
        },
      }, (props) => jsx(InjectPanel, { sessionId: props.sessionId, t: props.t }))), 'schedule-task-tab: view');
    }

    return { inject: INJECT, apply };
  }
});
