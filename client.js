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
      'view.label': '审阅',
      'header.title': '会话审阅',
      'header.subtitle': '每轮对话结束后，子代理会读一遍对话；只有确实有需要推进的事，才提醒主 agent。',
      'header.subtitle.all': '这里能看到全部会话的审阅规则。',
      'scope.session': '本会话',
      'scope.all': '全部会话',
      'refresh': '刷新',
      'autoRefresh': '自动刷新',
      'autoRefresh.title': '每 30 秒自动刷新，新记录会自动出现',
      'refreshing': '刷新中…',
      'new.task': '新建规则',
      'new.task.title': '新建一条审阅规则',
      'section.templates': '模板库',
      'section.runs': '最近审阅',
      'empty.tasks.title': '还没有审阅规则',
      'empty.tasks.desc': '建一条规则后，主会话每轮对话结束时子代理会自动审阅，只在发现待办、遗漏或风险时才来提醒。不会写指令也没关系，留空用内置默认的就行。',
      'empty.tasks.create': '新建规则',
      'empty.tasks.quick': '用默认配置直接创建',
      'empty.runs.title': '还没有审阅记录',
      'empty.runs.desc': '主会话结束一轮后，这里会记下审阅结论：提醒了什么，还是判断无需打扰。',
      'empty.templates': '还没有模板',
      'tasks.summary': '{total} 条规则 · {enabled} 条启用',
      'tasks.summary.allOff': '{total} 条规则 · 全部已暂停',
      'tasks.summary.empty': '还没有规则',
      'task.name': '规则名',
      'task.name.placeholder': '例如：轮末检查还有没有没做完的事',
      'task.name.hint': '名称会显示在面板和注入消息的前缀里',
      'task.model.hint': '留空就跟随主会话的默认模型，一般不用改',
      'task.model.default': '跟随会话默认模型',
      'task.prompt': '审阅指令',
      'task.prompt.hint': '留空使用内置默认指令：读上下文 → 找待办/遗漏/风险 → 需要时注入；可用占位符 {sessionId} {taskName} {turn} {reason}',
      'task.prompt.placeholder': '留空 = 使用内置默认审阅指令',
      'task.enabled': '每轮对话结束后自动审阅',
      'task.enabled.hint': '关闭只是暂停自动审阅，规则会保留',
      'on': '已启用',
      'off': '已暂停',
      'trigger.hint': '规则每次只影响本会话：每轮结束时启动子代理审阅，需要时把提醒注入回主会话。',
      'task.template': '从模板填入',
      'task.template.pick': '选择模板…',
      'task.template.manage': '管理模板',
      'task.template.hide': '收起管理',
      'task.run': '审阅',
      'task.run.title': '立即审阅一次（不影响自动触发）',
      'task.running': '审阅中…',
      'task.edit': '编辑',
      'task.delete': '删除',
      'task.paused': '已暂停',
      'task.trigger.badge': '每轮结束',
      'task.lastReview': '上次审阅',
      'task.never': '从未审阅',
      'task.delete.title': '删除规则「{name}」？',
      'task.delete.desc': '删除后不可恢复；已经产生的审阅记录会保留。',
      'form.create': '新建审阅规则',
      'form.edit': '编辑审阅规则',
      'form.close': '关闭表单',
      'save': '保存',
      'saving': '保存中…',
      'cancel': '取消',
      'saved': '已保存',
      'created': '规则已创建，下一轮对话结束就会开始自动审阅',
      'updated': '规则已更新',
      'quick.created': '已用默认配置创建规则，下一轮结束就会自动审阅',
      'triggered': '已手动审阅一次，结果见下方记录',
      'notice.dismiss': '知道了',
      'loading': '正在读取审阅规则…',
      'subagent.hint': '这是子代理会话，不参与审阅注入。回到主会话的「审阅」标签即可配置规则。',
      'subagent.hint.title': '子代理会话',
      'run.manual': '手动触发',
      'run.turn': '第 {turn} 轮结束',
      'run.status.injected': '已提醒',
      'run.status.skipped': '无需提醒',
      'run.status.failed': '失败',
      'run.brief.skipped': '审阅后判断无需提醒',
      'run.subagent': '子代理会话',
      'run.copy': '复制 id',
      'run.copied': '已复制',
      'run.copy.failed': '复制失败，请手动选中 id 复制',
      'runs.more': '展开全部（{n}）',
      'runs.less': '收起',
      'reason.completed': '正常结束',
      'reason.interrupted': '已中断',
      'reason.forked': '已分叉',
      'reason.unknown': '未知原因',
      'time.justNow': '刚刚',
      'time.minutesAgo': '{n} 分钟前',
      'time.hoursAgo': '{n} 小时前',
      'time.daysAgo': '{n} 天前',
      'tpl.new': '新建模板',
      'tpl.name': '名称',
      'tpl.desc': '描述',
      'tpl.body': '完整审阅指令模板（跨会话通用，支持 {sessionId} {taskName} {turn} {reason}）',
      'tpl.unnamed': '未命名模板',
      'provider': '服务商',
      'model': '模型',
      'quick.name': '轮末审阅',
    };
    const en = {
      'view.label': 'Review',
      'header.title': 'Session review',
      'header.subtitle': 'After every turn a subagent reads the conversation and only nudges the main agent when something genuinely needs to move forward.',
      'header.subtitle.all': 'Every session’s review rules, in one place.',
      'scope.session': 'This session',
      'scope.all': 'All sessions',
      'refresh': 'Refresh',
      'autoRefresh': 'Live',
      'autoRefresh.title': 'Refreshes every 30 seconds; new records show up automatically',
      'refreshing': 'Refreshing…',
      'new.task': 'New rule',
      'new.task.title': 'Create a review rule',
      'section.templates': 'Templates',
      'section.runs': 'Recent reviews',
      'empty.tasks.title': 'No review rules yet',
      'empty.tasks.desc': 'Rules run after each turn ends: a subagent reviews the conversation and only nudges the main agent for real follow-ups, missed asks or risks. Leaving the instruction empty uses the built-in default.',
      'empty.tasks.create': 'Create a rule',
      'empty.tasks.quick': 'Create with defaults',
      'empty.runs.title': 'No reviews yet',
      'empty.runs.desc': 'Once a turn ends, the review outcome appears here: what was nudged, or why nothing was sent.',
      'empty.templates': 'No templates yet',
      'tasks.summary': '{total} rules · {enabled} on',
      'tasks.summary.allOff': '{total} rules · all paused',
      'tasks.summary.empty': 'No rules yet',
      'task.name': 'Name',
      'task.name.placeholder': 'e.g. Check for unfinished work at turn end',
      'task.name.hint': 'Shown in this panel and in the nudge prefix',
      'task.model.hint': 'Leave empty to follow the session default',
      'task.model.default': 'Session default model',
      'task.prompt': 'Review instruction',
      'task.prompt.hint': 'Leave empty for the built-in instruction: read context → find follow-ups/omissions/risks → inject when needed. Placeholders: {sessionId} {taskName} {turn} {reason}',
      'task.prompt.placeholder': 'Empty = use the built-in review instruction',
      'task.enabled': 'Review automatically after every turn',
      'task.enabled.hint': 'Turning this off just pauses auto review; the rule is kept',
      'on': 'On',
      'off': 'Paused',
      'trigger.hint': 'Each rule only affects this session: after every turn a subagent reviews, and only real follow-ups are injected back.',
      'task.template': 'Fill from template',
      'task.template.pick': 'Pick a template…',
      'task.template.manage': 'Manage templates',
      'task.template.hide': 'Hide templates',
      'task.run': 'Review',
      'task.run.title': 'Run one review now (does not change auto trigger)',
      'task.running': 'Reviewing…',
      'task.edit': 'Edit',
      'task.delete': 'Delete',
      'task.paused': 'Paused',
      'task.trigger.badge': 'Every turn',
      'task.lastReview': 'Last review',
      'task.never': 'never',
      'task.delete.title': 'Delete rule “{name}”?',
      'task.delete.desc': 'This cannot be undone; existing review records are kept.',
      'form.create': 'New review rule',
      'form.edit': 'Edit review rule',
      'form.close': 'Close form',
      'save': 'Save',
      'saving': 'Saving…',
      'cancel': 'Cancel',
      'saved': 'Saved',
      'created': 'Rule created — it will review from the next turn end',
      'updated': 'Rule updated',
      'quick.created': 'Rule created with defaults — it will review from the next turn end',
      'triggered': 'One review ran — see the record below',
      'notice.dismiss': 'Dismiss',
      'loading': 'Loading review rules…',
      'subagent.hint': 'This is a subagent session; review injection does not apply here. Open the “Review” tab in the main session to configure rules.',
      'subagent.hint.title': 'Subagent session',
      'run.manual': 'Manual',
      'run.turn': 'Turn {turn} ended',
      'run.status.injected': 'Nudged',
      'run.status.skipped': 'No nudge',
      'run.status.failed': 'Failed',
      'run.brief.skipped': 'Nothing worth interrupting for',
      'run.subagent': 'Subagent session',
      'run.copy': 'Copy id',
      'run.copied': 'Copied',
      'run.copy.failed': 'Copy failed — select the id and copy it manually',
      'runs.more': 'Show all ({n})',
      'runs.less': 'Show less',
      'reason.completed': 'completed',
      'reason.interrupted': 'interrupted',
      'reason.forked': 'forked',
      'reason.unknown': 'unknown',
      'time.justNow': 'just now',
      'time.minutesAgo': '{n} min ago',
      'time.hoursAgo': '{n} h ago',
      'time.daysAgo': '{n} d ago',
      'tpl.new': 'New template',
      'tpl.name': 'Name',
      'tpl.desc': 'Description',
      'tpl.body': 'Full review instruction template (shared across sessions; supports {sessionId} {taskName} {turn} {reason})',
      'tpl.unnamed': 'Untitled template',
      'provider': 'Provider',
      'model': 'Model',
      'quick.name': 'Turn-end review',
    };

    /* 主题无关：文字继承父级，背景/边框用半透明中性色，强调色固定。
       面板按「头部说明 + 规则卡 + 可折叠记录」组织，窄栏单列。 */
    const CSS = '' +
      '.inj-root{display:flex;flex-direction:column;gap:14px;overflow:auto;padding:16px 16px 24px;font-size:13px;line-height:1.55;color:inherit;background:transparent;max-width:760px}' +
      /* 头部 */
      '.inj-head{display:flex;flex-direction:column;gap:5px}' +
      '.inj-headTop{display:flex;align-items:flex-start;gap:10px}' +
      '.inj-title{font-size:16px;font-weight:650;letter-spacing:.2px;white-space:nowrap}' +
      '.inj-subtitle{font-size:12px;opacity:.6;line-height:1.6;flex:1;min-width:0}' +
      '.inj-headActions{display:flex;align-items:center;gap:6px;flex:0 0 auto;padding-top:1px}' +
      /* 工具条 */
      '.inj-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}' +
      '.inj-seg{display:inline-flex;border:1px solid rgba(127,127,127,.28);border-radius:8px;overflow:hidden;background:rgba(127,127,127,.05);flex:0 0 auto}' +
      '.inj-segBtn{border:0;background:transparent;color:inherit;font:inherit;font-size:12px;padding:4px 11px;cursor:pointer;opacity:.7;white-space:nowrap}' +
      '.inj-segBtn.active{background:rgba(37,99,235,.14);color:#2563eb;opacity:1;font-weight:600}' +
      '.inj-count{font-size:12px;opacity:.6;min-width:0}' +
      '.inj-live{display:inline-flex;align-items:center;gap:5px;font-size:11px;opacity:.55;white-space:nowrap}' +
      '.inj-liveDot{width:6px;height:6px;border-radius:50%;background:#16a34a;box-shadow:0 0 0 3px rgba(22,163,74,.12)}' +
      '.inj-liveDot.busy{background:#d97706;box-shadow:0 0 0 3px rgba(217,119,6,.14)}' +
      '.inj-spacer{flex:1;min-width:0}' +
      /* 分区卡片 */
      '.inj-card{border:1px solid rgba(127,127,127,.18);border-radius:12px;background:rgba(127,127,127,.05);overflow:hidden}' +
      '.inj-cardHead{display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;user-select:none}' +
      '.inj-cardHead:hover{background:rgba(127,127,127,.06)}' +
      '.inj-cardTitle{font-size:12px;font-weight:650;text-transform:uppercase;letter-spacing:.5px;opacity:.65;flex:1}' +
      '.inj-caret{font-size:10px;opacity:.5;transition:transform .15s}' +
      '.inj-caret.open{transform:rotate(90deg)}' +
      '.inj-cardBody{padding:0 12px 12px;display:flex;flex-direction:column;gap:8px}' +
      /* 规则条目 */
      '.inj-task{display:flex;flex-direction:column;gap:4px;padding:10px 12px;border:1px solid rgba(127,127,127,.18);border-radius:10px;background:rgba(127,127,127,.03);transition:border-color .15s,opacity .15s}' +
      '.inj-task:hover{border-color:rgba(127,127,127,.38)}' +
      '.inj-task.off{opacity:.66}' +
      '.inj-taskTop{display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap}' +
      '.inj-taskMain{flex:1;min-width:150px;display:flex;flex-direction:column;gap:2px}' +
      '.inj-taskNameRow{display:flex;align-items:center;gap:6px;min-width:0}' +
      '.inj-taskName{font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.inj-taskMeta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11.5px;opacity:.6}' +
      '.inj-taskMeta .dot{opacity:.4}' +
      '.inj-taskActions{margin-left:auto;display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}' +
      '.inj-pill{font-size:10.5px;padding:0 7px;border-radius:999px;background:rgba(127,127,127,.14);opacity:.75;white-space:nowrap}' +
      /* 开关 */
      '.inj-switch{position:relative;flex:none;width:30px;height:17px;border-radius:999px;background:rgba(127,127,127,.35);border:0;cursor:pointer;padding:0;transition:background .15s;margin-top:2px}' +
      '.inj-switch.on{background:#16a34a}' +
      '.inj-switch::after{content:"";position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;background:#fff;transition:left .15s}' +
      '.inj-switch.on::after{left:15px}' +
      '.inj-switch:focus-visible{outline:2px solid rgba(37,99,235,.5);outline-offset:2px}' +
      /* 按钮 */
      '.inj-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;border-radius:8px;padding:4px 10px;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap;transition:background .12s}' +
      '.inj-btn:hover{background:rgba(127,127,127,.12)}' +
      '.inj-btn.primary{background:#2563eb;border-color:transparent;color:#fff}' +
      '.inj-btn.primary:hover{background:#1d4ed8}' +
      '.inj-btn.danger{color:#dc2626;border-color:rgba(220,38,38,.4)}' +
      '.inj-btn.danger:hover{background:rgba(220,38,38,.08)}' +
      '.inj-btn.small{padding:3px 9px;font-size:12px;border-radius:7px}' +
      '.inj-btn.icon{padding:3px 8px;border-color:transparent}' +
      '.inj-btn:disabled{opacity:.45;cursor:default}' +
      '.inj-btn:disabled:hover{background:transparent}' +
      '.inj-btn.primary:disabled:hover{background:#2563eb}' +
      '.inj-linkBtn{border:0;background:transparent;color:#2563eb;font:inherit;font-size:12px;cursor:pointer;padding:2px 4px;border-radius:6px}' +
      '.inj-linkBtn:hover{text-decoration:underline}' +
      /* 表单 */
      '.inj-formCard{display:flex;flex-direction:column;gap:12px;padding:14px;border:1px solid rgba(37,99,235,.3);border-radius:12px;background:rgba(37,99,235,.04)}' +
      '.inj-formHead{display:flex;align-items:center;gap:8px}' +
      '.inj-formTitle{font-size:13px;font-weight:650;flex:1}' +
      '.inj-formGrid{display:grid;grid-template-columns:1fr 1fr;gap:10px 12px}' +
      '.inj-field{display:flex;flex-direction:column;gap:3px;min-width:0}' +
      '.inj-field.full{grid-column:1/-1}' +
      '.inj-label{font-size:11px;font-weight:600;opacity:.62;text-transform:uppercase;letter-spacing:.4px}' +
      '.inj-input,.inj-textarea,.inj-select{width:100%;padding:6px 9px;border:1px solid rgba(127,127,127,.35);border-radius:8px;background:inherit;color:inherit;font:inherit;font-size:13px;color-scheme:light dark;box-sizing:border-box}' +
      '.inj-input:focus,.inj-textarea:focus,.inj-select:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 2px rgba(37,99,235,.18)}' +
      '.inj-textarea{min-height:96px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.55}' +
      '.inj-select{background:#ffffff;color:#1f2328;color-scheme:light}' +
      '.inj-select option{background:#ffffff;color:#1f2328}' +
      '.inj-select:disabled{opacity:.6}' +
      '@media (prefers-color-scheme: dark){.inj-select{background:#202124;color:#e8eaed;color-scheme:dark}.inj-select option{background:#202124;color:#e8eaed}}' +
      '.inj-checks{display:flex;gap:16px;align-items:center;flex-wrap:wrap}' +
      '.inj-check{display:inline-flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;user-select:none}' +
      '.inj-inlineRow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}' +
      '.inj-inlineRow .inj-select{flex:1;min-width:170px;width:auto}' +
      '.inj-formActions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}' +
      '.inj-formFooter{display:flex;align-items:center;gap:12px;flex-wrap:wrap;border-top:1px dashed rgba(127,127,127,.25);padding-top:10px}' +
      '.inj-hint{font-size:11px;opacity:.55;line-height:1.55}' +
      /* 模板管理 */
      '.inj-tplMgr{border-top:1px dashed rgba(127,127,127,.25);padding-top:10px;display:flex;flex-direction:column;gap:6px}' +
      '.inj-tpl{display:flex;flex-direction:column;gap:2px;padding:7px 9px;border:1px solid rgba(127,127,127,.2);border-radius:8px}' +
      '.inj-tplHead{display:flex;align-items:center;gap:6px;flex-wrap:wrap}' +
      '.inj-tplBody{font-family:ui-monospace,monospace;font-size:11px;opacity:.75;white-space:pre-wrap;max-height:96px;overflow:auto}' +
      /* 确认删除 */
      '.inj-confirm{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;border:1px solid rgba(220,38,38,.35);border-radius:10px;background:rgba(220,38,38,.05)}' +
      '.inj-confirmText{flex:1;min-width:180px;display:flex;flex-direction:column;gap:1px}' +
      '.inj-confirmTitle{font-weight:600;font-size:12.5px}' +
      '.inj-confirmDesc{font-size:11.5px;opacity:.6}' +
      '.inj-confirmActions{display:flex;gap:6px;flex-wrap:wrap}' +
      /* 运行记录 */
      '.inj-run{display:flex;gap:9px;padding:9px 2px;border-bottom:1px solid rgba(127,127,127,.12)}' +
      '.inj-run:last-child{border-bottom:0}' +
      '.inj-runBadge{flex:none;font-size:10.5px;font-weight:600;padding:1px 8px;border-radius:999px;height:18px;display:inline-flex;align-items:center;white-space:nowrap}' +
      '.inj-runBadge.injected{background:rgba(22,163,74,.14);color:#16a34a}' +
      '.inj-runBadge.skipped{background:rgba(127,127,127,.14);opacity:.8}' +
      '.inj-runBadge.failed{background:rgba(220,38,38,.13);color:#dc2626}' +
      '.inj-runBody{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}' +
      '.inj-runHead{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}' +
      '.inj-runName{font-weight:600;font-size:12px}' +
      '.inj-runTime{font-size:11px;opacity:.5}' +
      '.inj-runBrief{font-size:12px;opacity:.8;overflow-wrap:anywhere;white-space:pre-wrap}' +
      '.inj-runBrief.failed{color:#dc2626;opacity:.9}' +
      '.inj-runSub{font-family:ui-monospace,monospace;font-size:10.5px;opacity:.45;display:inline-flex;align-items:center;gap:6px;cursor:pointer;align-self:flex-start;border-radius:4px}' +
      '.inj-runSub:hover{opacity:.85}' +
      '.inj-copy{opacity:.75;border-bottom:1px dotted currentColor}' +
      /* 状态/通知 */
      '.inj-meta{font-size:12px;opacity:.6}' +
      '.inj-notice{display:flex;align-items:flex-start;gap:8px;padding:8px 11px;border-radius:8px;font-size:12px;border:1px solid rgba(22,163,74,.4);background:rgba(22,163,74,.08);color:#16a34a}' +
      '.inj-notice.err{color:#dc2626;border-color:rgba(220,38,38,.4);background:rgba(220,38,38,.07)}' +
      '.inj-noticeText{flex:1;min-width:0;line-height:1.5;overflow-wrap:anywhere}' +
      '.inj-noticeClose{border:0;background:transparent;color:inherit;cursor:pointer;opacity:.65;font-size:14px;line-height:1;padding:0 2px;flex:none}' +
      '.inj-noticeClose:hover{opacity:1}' +
      '.inj-state{padding:28px 12px;text-align:center;opacity:.7;font-size:13px}' +
      '.inj-loading{display:flex;align-items:center;justify-content:center;gap:9px;padding:44px 12px;opacity:.7;font-size:12.5px}' +
      '.inj-spinner{width:14px;height:14px;border:2px solid rgba(127,127,127,.3);border-top-color:#2563eb;border-radius:50%;animation:injspin .8s linear infinite;flex:none}' +
      '@keyframes injspin{to{transform:rotate(360deg)}}' +
      '.inj-emptyHero{display:flex;flex-direction:column;align-items:center;text-align:center;gap:8px;padding:26px 18px;border:1px dashed rgba(127,127,127,.3);border-radius:12px;background:rgba(127,127,127,.03)}' +
      '.inj-emptyIcon{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(37,99,235,.12);color:#2563eb;font-size:16px;flex:none}' +
      '.inj-emptyTitle{font-size:13.5px;font-weight:650}' +
      '.inj-emptyDesc{font-size:12px;opacity:.65;line-height:1.7;max-width:360px}' +
      '.inj-emptyActions{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:4px}' +
      '.inj-empty{padding:16px;text-align:center;font-size:12px;opacity:.55;border:1px dashed rgba(127,127,127,.25);border-radius:10px}' +
      '.inj-groupLabel{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;opacity:.55;margin-top:4px;flex-wrap:wrap}' +
      '.inj-groupId{font-family:ui-monospace,monospace;font-weight:400;font-size:10px;opacity:.75}';

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

    /** Absolute time, e.g. “11月2日 23:20:56”; used for tooltips/fallback. */
    const formatRunTime = (iso) => {
      const at = new Date(iso);
      if (Number.isNaN(at.getTime())) return iso;
      return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(at);
    };

    /** Human relative time: “刚刚 / 3 分钟前 / 2 小时前 / 3 天前”, falling back to the date. */
    function formatRelativeTime(iso, msg) {
      const at = new Date(iso);
      if (Number.isNaN(at.getTime())) return iso;
      const diff = Math.max(0, Date.now() - at.getTime());
      const minutes = Math.floor(diff / 60000);
      if (minutes < 1) return msg('time.justNow');
      if (minutes < 60) return msg('time.minutesAgo', { n: minutes });
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return msg('time.hoursAgo', { n: hours });
      const days = Math.floor(hours / 24);
      if (days < 7) return msg('time.daysAgo', { n: days });
      return formatRunTime(iso);
    }

    /** Minimal {placeholder} interpolation bound to one dictionary lookup. */
    function makeMessage(t) {
      return (key, vars) => {
        let text = t(key);
        for (const [name, value] of Object.entries(vars ?? {})) text = text.split(`{${name}}`).join(String(value));
        return text;
      };
    }

    /** Copy text to the clipboard with a legacy fallback (non-secure origins). */
    async function copyText(value) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(value);
          return true;
        }
      } catch { /* fall through */ }
      try {
        const area = document.createElement('textarea');
        area.value = value;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        return ok;
      } catch { /* not copyable */ }
      return false;
    }

    /* ── 可折叠分区 ────────────────────────────────────────────────── */

    function Section({ title, open, onToggle, right, children }) {
      return jsxs('div', { className: 'inj-card', children: [
        jsxs('div', { className: 'inj-cardHead', onClick: onToggle, children: [
          jsx('span', { className: 'inj-caret' + (open ? ' open' : ''), children: '▶' }),
          jsx('span', { className: 'inj-cardTitle', children: title }),
          right ? jsx('span', { onClick: (e) => e.stopPropagation(), style: { display: 'inline-flex', gap: 6 }, children: right }) : null,
        ] }),
        open ? jsx('div', { className: 'inj-cardBody', children }) : null,
      ] });
    }

    /* ── 模板表单（模板管理内部用）───────────────────────────────── */

    function TemplateForm({ initial, t, onSave, onCancel }) {
      const [name, setName] = react.useState(initial?.name ?? '');
      const [description, setDescription] = react.useState(initial?.description ?? '');
      const [body, setBody] = react.useState(initial?.body ?? '');
      return jsxs('div', { className: 'inj-formGrid', children: [
        jsxs('div', { className: 'inj-field', children: [
          jsx('label', { className: 'inj-label', children: t('tpl.name') }),
          jsx('input', { className: 'inj-input', value: name, onChange: (e) => setName(e.target.value) }),
        ] }),
        jsxs('div', { className: 'inj-field', children: [
          jsx('label', { className: 'inj-label', children: t('tpl.desc') }),
          jsx('input', { className: 'inj-input', value: description, onChange: (e) => setDescription(e.target.value) }),
        ] }),
        jsxs('div', { className: 'inj-field full', children: [
          jsx('label', { className: 'inj-label', children: t('tpl.body') }),
          jsx('textarea', { className: 'inj-textarea', style: { minHeight: 110 }, value: body, onChange: (e) => setBody(e.target.value) }),
        ] }),
        jsxs('div', { className: 'inj-field full', style: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }, children: [
          jsx('button', { type: 'button', className: 'inj-btn', onClick: onCancel, children: t('cancel') }),
          jsx('button', {
            type: 'button',
            className: 'inj-btn primary',
            onClick: () => onSave({ name: name.trim() || t('tpl.unnamed'), description, body }),
            children: t('save'),
          }),
        ] }),
      ] });
    }

    /* ── 规则表单 ──────────────────────────────────────────────────── */

    function TaskForm({ initial, templates, catalog, t, onSave, onCancel, onTemplatesChanged }) {
      const msg = makeMessage(t);
      const [name, setName] = react.useState(initial?.name ?? '');
      const [provider, setProvider] = react.useState(initial?.provider ?? '');
      const [model, setModel] = react.useState(initial?.model ?? '');
      const [systemPrompt, setSystemPrompt] = react.useState(initial?.systemPrompt ?? '');
      const [enabled, setEnabled] = react.useState(initial?.enabled ?? true);
      const [templateId, setTemplateId] = react.useState('');
      const [showTemplates, setShowTemplates] = react.useState(false);
      const [managerTpls, setManagerTpls] = react.useState([]);
      const [managerEdit, setManagerEdit] = react.useState(null);
      const [managerMsg, setManagerMsg] = react.useState(null);
      const [saving, setSaving] = react.useState(false);

      const groups = catalog?.groups ?? [];
      const models = groups.find((g) => g.id === provider)?.models ?? [];
      const isEdit = initial?.id !== undefined;

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

      react.useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key === 'Escape') onCancel();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
      }, [onCancel]);

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

      const submit = async () => {
        if (!name.trim() || saving) return;
        setSaving(true);
        try {
          await onSave({
            name: name.trim(),
            provider: provider || undefined,
            model: model || undefined,
            systemPrompt,
            enabled,
          });
        } finally {
          setSaving(false);
        }
      };

      return jsxs('div', { className: 'inj-formCard', children: [
        jsxs('div', { className: 'inj-formHead', children: [
          jsx('span', { className: 'inj-formTitle', children: isEdit ? t('form.edit') : t('form.create') }),
          jsx('button', { type: 'button', className: 'inj-btn icon', title: t('form.close'), 'aria-label': t('form.close'), onClick: onCancel, children: '✕' }),
        ] }),

        jsxs('div', { className: 'inj-formGrid', children: [
          jsxs('div', { className: 'inj-field full', children: [
            jsx('label', { className: 'inj-label', children: t('task.name') }),
            jsx('input', {
              className: 'inj-input',
              value: name,
              autoFocus: true,
              onChange: (e) => setName(e.target.value),
              placeholder: t('task.name.placeholder'),
              'aria-label': t('task.name'),
            }),
            jsx('div', { className: 'inj-hint', children: t('task.name.hint') }),
          ] }),
          jsxs('div', { className: 'inj-field', children: [
            jsx('label', { className: 'inj-label', children: t('provider') }),
            jsx('select', {
              className: 'inj-select',
              value: provider,
              onChange: (e) => { setProvider(e.target.value); setModel(''); },
              children: [
                jsx('option', { value: '', children: t('task.model.default') }),
                groups.map((g) => jsx('option', { key: g.id, value: g.id, children: g.name || g.id })),
              ],
            }),
          ] }),
          jsxs('div', { className: 'inj-field', children: [
            jsx('label', { className: 'inj-label', children: t('model') }),
            jsx('select', {
              className: 'inj-select',
              value: model,
              onChange: (e) => setModel(e.target.value),
              disabled: !provider,
              children: [
                jsx('option', { value: '', children: '—' }),
                models.map((m) => jsx('option', { key: m.id, value: m.id, children: m.name || m.id })),
              ],
            }),
          ] }),
          jsx('div', { className: 'inj-field full', children: jsx('div', { className: 'inj-hint', children: t('task.model.hint') }) }),
          jsxs('div', { className: 'inj-field full', children: [
            jsx('label', { className: 'inj-label', children: t('task.prompt') }),
            jsx('textarea', {
              className: 'inj-textarea',
              value: systemPrompt,
              onChange: (e) => setSystemPrompt(e.target.value),
              placeholder: t('task.prompt.placeholder'),
              'aria-label': t('task.prompt'),
            }),
            jsxs('div', { className: 'inj-inlineRow', style: { marginTop: 2 }, children: [
              jsx('select', {
                className: 'inj-select',
                value: templateId,
                onChange: (e) => chooseTemplate(e.target.value),
                title: t('task.template'),
                'aria-label': t('task.template'),
                children: [
                  jsx('option', { value: '', children: t('task.template.pick') }),
                  templates.map((x) => jsx('option', { key: x.id, value: x.id, children: x.name })),
                ],
              }),
              jsx('button', {
                type: 'button',
                className: 'inj-linkBtn',
                onClick: () => setShowTemplates(!showTemplates),
                children: showTemplates ? t('task.template.hide') : t('task.template.manage'),
              }),
            ] }),
            jsx('div', { className: 'inj-hint', children: t('task.prompt.hint') }),
          ] }),
        ] }),

        showTemplates
          ? jsxs('div', { className: 'inj-tplMgr', children: [
              jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: 8 }, children: [
                jsx('span', { className: 'inj-label', children: t('section.templates') }),
                jsx('span', { className: 'inj-spacer' }),
                jsx('button', {
                  type: 'button',
                  className: 'inj-btn small',
                  onClick: () => setManagerEdit(managerEdit ? null : {}),
                  children: managerEdit ? t('cancel') : t('tpl.new'),
                }),
              ] }),
              managerMsg ? jsx('div', { className: 'inj-notice' + (managerMsg.type === 'err' ? ' err' : ''), children: jsx('span', { className: 'inj-noticeText', children: managerMsg.text }) }) : null,
              managerEdit
                ? jsx(TemplateForm, { key: managerEdit.id ?? 'new', initial: managerEdit, t, onSave: saveManagerTemplate, onCancel: () => setManagerEdit(null) })
                : null,
              managerTpls.length === 0 && !managerEdit
                ? jsx('div', { className: 'inj-empty', children: t('empty.templates') })
                : managerTpls.map((tpl) => (
                  jsxs('div', { key: tpl.id, className: 'inj-tpl', children: [
                    jsxs('div', { className: 'inj-tplHead', children: [
                      jsx('span', { style: { fontWeight: 600, fontSize: 12 }, children: tpl.name }),
                      jsx('span', { className: 'inj-meta', style: { flex: 1, minWidth: 0 }, children: tpl.description }),
                      jsx('button', { type: 'button', className: 'inj-btn small', onClick: () => setManagerEdit({ id: tpl.id, name: tpl.name, description: tpl.description, body: tpl.body }), children: t('task.edit') }),
                      jsx('button', { type: 'button', className: 'inj-btn small danger', onClick: () => deleteManagerTemplate(tpl.id), children: t('task.delete') }),
                    ] }),
                    jsx('div', { className: 'inj-tplBody', children: tpl.body }),
                  ] })
                )),
            ] })
          : null,

        jsxs('div', { className: 'inj-formFooter', children: [
          jsxs('label', { className: 'inj-check', children: [
            jsx('input', { type: 'checkbox', checked: enabled, onChange: (e) => setEnabled(e.target.checked) }),
            t('task.enabled'),
          ] }),
          jsx('span', { className: 'inj-hint', children: t('task.enabled.hint') }),
          jsx('span', { className: 'inj-spacer' }),
          jsxs('div', { className: 'inj-formActions', children: [
            jsx('button', { type: 'button', className: 'inj-btn', onClick: onCancel, children: t('cancel') }),
            jsx('button', {
              type: 'button',
              className: 'inj-btn primary',
              onClick: submit,
              disabled: !name.trim() || saving,
              children: saving ? t('saving') : t('save'),
            }),
          ] }),
        ] }),
        jsx('div', { className: 'inj-hint', children: t('trigger.hint') }),
      ] });
    }

    /* ── 主面板 ────────────────────────────────────────────────────── */

    const RUNS_COLLAPSED_COUNT = 5;

    function InjectPanel({ sessionId, t }) {
      const msg = makeMessage(t);
      const [tasks, setTasks] = react.useState([]);
      const [templates, setTemplates] = react.useState([]);
      const [runs, setRuns] = react.useState([]);
      const [catalog, setCatalog] = react.useState(null);
      const [editing, setEditing] = react.useState(null);
      const [confirmId, setConfirmId] = react.useState(null);
      const [notice, setNotice] = react.useState(null);
      const [booting, setBooting] = react.useState(true);
      const [isSubagent, setIsSubagent] = react.useState(false);
      const [scope, setScope] = react.useState('session'); // 'session' | 'all'
      const [titles, setTitles] = react.useState({}); // scope=all 时各会话标题
      const [runsOpen, setRunsOpen] = react.useState(true);
      const [runsAll, setRunsAll] = react.useState(false);
      const [runningId, setRunningId] = react.useState(null);
      const [creating, setCreating] = react.useState(false);
      const [refreshing, setRefreshing] = react.useState(false);
      const [lastUpdated, setLastUpdated] = react.useState(null);
      const [copiedRunId, setCopiedRunId] = react.useState(null);

      const refresh = react.useCallback(async () => {
        setRefreshing(true);
        try {
          const info = await hostCall('session/info', { sessionId }).catch(() => null);
          const meta = info?.meta;
          // subagent 会话（origin=subagent 或有父会话）永远不参与注入
          setIsSubagent(!!(meta && (meta.origin === 'subagent' || meta.parentSession !== undefined)));
          const [ts, tpls, rs, cat] = await Promise.all([
            hostCall('tasks/list', scope === 'all' ? { scope: 'all' } : { sessionId }),
            hostCall('templates/list'),
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
          setRuns(rs ?? []);
          if (cat) setCatalog(cat);
          setLastUpdated(new Date());
        } catch (error) {
          setNotice({ type: 'err', text: error.message });
        } finally {
          setBooting(false);
          setRefreshing(false);
        }
      }, [sessionId, scope]);

      react.useEffect(() => {
        void refresh();
        const poll = setInterval(() => void refresh().catch(() => {}), 30000);
        return () => clearInterval(poll);
      }, [refresh]);

      react.useEffect(() => {
        if (!notice || notice.type === 'err') return;
        const timer = setTimeout(() => setNotice(null), 4000);
        return () => clearTimeout(timer);
      }, [notice]);

      const flash = (type, text) => setNotice({ type, text });

      const saveTask = async (form) => {
        try {
          if (editing?.mode === 'edit') {
            await hostCall('tasks/update', {
              id: editing.task.id,
              patch: {
                name: form.name,
                provider: form.provider,
                model: form.model,
                systemPrompt: form.systemPrompt,
                enabled: form.enabled,
              },
            });
            flash('ok', t('updated'));
          } else {
            await hostCall('tasks/create', {
              sessionId,
              name: form.name,
              provider: form.provider,
              model: form.model,
              systemPrompt: form.systemPrompt,
              enabled: form.enabled,
            });
            flash('ok', t('created'));
          }
          setEditing(null);
          void refresh();
        } catch (error) {
          setNotice({ type: 'err', text: error.message });
        }
      };

      const quickCreate = async () => {
        if (creating) return;
        setCreating(true);
        try {
          await hostCall('tasks/create', { sessionId, name: t('quick.name'), systemPrompt: '', enabled: true });
          flash('ok', t('quick.created'));
          void refresh();
        } catch (error) {
          setNotice({ type: 'err', text: error.message });
        } finally {
          setCreating(false);
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
        if (runningId) return;
        setRunningId(task.id);
        try {
          await hostCall('tasks/runNow', { id: task.id });
          flash('ok', t('triggered'));
          void refresh();
        } catch (error) {
          setNotice({ type: 'err', text: error.message });
        } finally {
          setRunningId(null);
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

      const copySubagentSession = async (run) => {
        const value = String(run.subagentSessionId ?? '');
        if (!value) return;
        if (!(await copyText(value))) {
          flash('err', t('run.copy.failed'));
          return;
        }
        setCopiedRunId(run.id);
        setTimeout(() => setCopiedRunId((current) => (current === run.id ? null : current)), 2000);
      };

      if (booting) {
        return jsx('div', { className: 'inj-root', children: jsxs('div', { className: 'inj-loading', children: [
          jsx('span', { className: 'inj-spinner' }),
          jsx('span', { children: t('loading') }),
        ] }) });
      }

      if (isSubagent) {
        return jsx('div', { className: 'inj-root', children: jsxs('div', { className: 'inj-emptyHero', children: [
          jsx('span', { className: 'inj-emptyIcon', children: 'i' }),
          jsx('div', { className: 'inj-emptyTitle', children: t('subagent.hint.title') }),
          jsx('div', { className: 'inj-emptyDesc', children: t('subagent.hint') }),
        ] }) });
      }

      const modelText = (task) => (task.provider && task.model ? `${task.provider} / ${task.model}` : t('task.model.default'));
      const enabledCount = tasks.filter((task) => task.enabled).length;
      const summary = tasks.length === 0
        ? t('tasks.summary.empty')
        : msg(enabledCount === 0 ? 'tasks.summary.allOff' : 'tasks.summary', { total: tasks.length, enabled: enabledCount });

      const reasonText = (reason) => {
        if (!reason) return t('reason.unknown');
        const known = t(`reason.${reason}`);
        return known === `reason.${reason}` ? String(reason) : known;
      };

      const renderConfirm = (task) => jsxs('div', { key: task.id, className: 'inj-confirm', children: [
        jsxs('div', { className: 'inj-confirmText', children: [
          jsx('div', { className: 'inj-confirmTitle', children: msg('task.delete.title', { name: task.name }) }),
          jsx('div', { className: 'inj-confirmDesc', children: t('task.delete.desc') }),
        ] }),
        jsxs('div', { className: 'inj-confirmActions', children: [
          jsx('button', { type: 'button', className: 'inj-btn small', onClick: () => setConfirmId(null), children: t('cancel') }),
          jsx('button', { type: 'button', className: 'inj-btn small danger', onClick: () => removeTask(task), children: t('task.delete') }),
        ] }),
      ] });

      const renderTaskRow = (task) => {
        if (confirmId === task.id) return renderConfirm(task);
        const running = runningId === task.id;
        return jsxs('div', { key: task.id, className: 'inj-task' + (task.enabled ? '' : ' off'), children: [
          jsxs('div', { className: 'inj-taskTop', children: [
            jsx('button', {
              type: 'button',
              className: 'inj-switch' + (task.enabled ? ' on' : ''),
              title: task.enabled ? t('on') : t('off'),
              'aria-pressed': task.enabled,
              'aria-label': t('task.enabled'),
              onClick: () => toggleTask(task),
            }),
            jsxs('div', { className: 'inj-taskMain', children: [
              jsxs('div', { className: 'inj-taskNameRow', children: [
                jsx('span', { className: 'inj-taskName', title: task.name, children: task.name }),
                task.enabled ? null : jsx('span', { className: 'inj-pill', children: t('task.paused') }),
              ] }),
              jsxs('div', { className: 'inj-taskMeta', children: [
                jsx('span', { children: t('task.trigger.badge') }),
                jsx('span', { className: 'dot', children: '·' }),
                jsx('span', { children: modelText(task) }),
                jsx('span', { className: 'dot', children: '·' }),
                jsx('span', {
                  title: task.lastRunAt ? formatRunTime(task.lastRunAt) : undefined,
                  children: t('task.lastReview') + ' ' + (task.lastRunAt ? formatRelativeTime(task.lastRunAt, msg) : t('task.never')),
                }),
              ] }),
            ] }),
            jsxs('div', { className: 'inj-taskActions', children: [
              jsx('button', {
                type: 'button',
                className: 'inj-btn small',
                title: t('task.run.title'),
                onClick: () => runNow(task),
                disabled: running || !!runningId,
                children: running ? jsxs(react.Fragment, { children: [
                  jsx('span', { className: 'inj-spinner', style: { width: 11, height: 11, borderWidth: 1.5 } }),
                  t('task.running'),
                ] }) : t('task.run'),
              }),
              jsx('button', {
                type: 'button',
                className: 'inj-btn small',
                title: t('task.edit'),
                onClick: () => setEditing({ mode: 'edit', task }),
                children: t('task.edit'),
              }),
              jsx('button', {
                type: 'button',
                className: 'inj-btn small danger',
                title: t('task.delete'),
                onClick: () => setConfirmId(task.id),
                children: t('task.delete'),
              }),
            ] }),
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
        if (groups.size === 0) return jsx('div', { className: 'inj-empty', children: t('empty.tasks.title') });
        return Array.from(groups.entries()).map(([sid, items]) => (
          jsxs('div', { key: sid, style: { display: 'flex', flexDirection: 'column', gap: 6 }, children: [
            jsxs('div', { className: 'inj-groupLabel', children: [
              jsx('span', { children: (titles[sid] ? titles[sid] : sid.slice(0, 8) + '…') + ' · ' + items.length + ' 条' }),
              jsx('span', { className: 'inj-groupId', children: sid.slice(0, 13) + '…' }),
            ] }),
            items.map(renderTaskRow),
          ] })
        ));
      };

      const renderEmptyTasks = () => jsxs('div', { className: 'inj-emptyHero', children: [
        jsx('span', { className: 'inj-emptyIcon', children: '+' }),
        jsx('div', { className: 'inj-emptyTitle', children: t('empty.tasks.title') }),
        jsx('div', { className: 'inj-emptyDesc', children: t('empty.tasks.desc') }),
        jsxs('div', { className: 'inj-emptyActions', children: [
          jsx('button', { type: 'button', className: 'inj-btn primary', onClick: () => setEditing({ mode: 'create' }), children: t('empty.tasks.create') }),
          jsx('button', {
            type: 'button',
            className: 'inj-btn',
            onClick: quickCreate,
            disabled: creating,
            children: creating ? t('saving') : t('empty.tasks.quick'),
          }),
        ] }),
      ] });

      const renderRun = (run) => {
        const injected = run.status === 'ok' && run.injected === true;
        const skipped = run.status === 'ok' && run.injected !== true;
        const failed = run.status !== 'ok';
        const badgeClass = failed ? 'failed' : (injected ? 'injected' : 'skipped');
        const badgeText = failed ? t('run.status.failed') : (injected ? t('run.status.injected') : t('run.status.skipped'));
        const brief = failed ? (run.error || t('run.status.failed')) : (injected ? (run.injectedBrief || '') : t('run.brief.skipped'));
        const triggerText = run.manual
          ? t('run.manual')
          : msg('run.turn', { turn: run.turn ?? '?' }) + '（' + reasonText(run.reason) + '）';
        return jsxs('div', { className: 'inj-run', children: [
          jsx('span', { className: 'inj-runBadge ' + badgeClass, children: badgeText }),
          jsxs('div', { className: 'inj-runBody', children: [
            jsxs('div', { className: 'inj-runHead', children: [
              jsx('span', { className: 'inj-runName', children: run.taskName }),
              jsx('span', { className: 'inj-runTime', title: formatRunTime(run.startedAt), children: formatRelativeTime(run.startedAt, msg) }),
              jsx('span', { className: 'inj-runTime', children: triggerText }),
            ] }),
            jsx('div', { className: 'inj-runBrief' + (failed ? ' failed' : ''), children: brief }),
            run.subagentSessionId
              ? jsx('span', {
                  className: 'inj-runSub',
                  title: t('run.copy'),
                  onClick: () => void copySubagentSession(run),
                  children: jsxs(react.Fragment, { children: [
                    jsx('span', { children: t('run.subagent') + ' · ' + run.subagentSessionId.slice(0, 15) + '…' }),
                    jsx('span', { className: 'inj-copy', children: copiedRunId === run.id ? t('run.copied') : t('run.copy') }),
                  ] }),
                })
              : null,
          ] }),
        ] });
      };

      const shownRuns = runsAll ? runs : runs.slice(0, RUNS_COLLAPSED_COUNT);

      return jsxs('div', { className: 'inj-root', children: [
        /* 头部：标题 + 一句说明 + 新建 */
        jsxs('div', { className: 'inj-head', children: [
          jsxs('div', { className: 'inj-headTop', children: [
            jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }, children: [
              jsx('div', { className: 'inj-title', children: t('header.title') }),
              jsx('div', { className: 'inj-subtitle', children: scope === 'all' ? t('header.subtitle.all') : t('header.subtitle') }),
            ] }),
            jsxs('div', { className: 'inj-headActions', children: [
              jsx('button', {
                type: 'button',
                className: 'inj-btn small',
                title: t('refresh'),
                'aria-label': t('refresh'),
                onClick: () => void refresh(),
                disabled: refreshing,
                children: refreshing ? jsx('span', { className: 'inj-spinner', style: { width: 11, height: 11, borderWidth: 1.5 } }) : '↻',
              }),
              scope === 'all' ? null : jsx('button', {
                type: 'button',
                className: 'inj-btn primary small',
                title: t('new.task.title'),
                onClick: () => setEditing(editing ? null : { mode: 'create' }),
                children: editing ? t('cancel') : '+ ' + t('new.task'),
              }),
            ] }),
          ] }),
          jsxs('div', { className: 'inj-toolbar', children: [
            jsxs('span', { className: 'inj-seg', children: [
              jsx('button', { type: 'button', className: 'inj-segBtn' + (scope === 'session' ? ' active' : ''), onClick: () => setScope('session'), children: t('scope.session') }),
              jsx('button', { type: 'button', className: 'inj-segBtn' + (scope === 'all' ? ' active' : ''), onClick: () => setScope('all'), children: t('scope.all') }),
            ] }),
            jsx('span', { className: 'inj-count', children: summary }),
            jsx('span', { className: 'inj-spacer' }),
            jsxs('span', { className: 'inj-live', title: t('autoRefresh.title'), children: [
              jsx('span', { className: 'inj-liveDot' + (refreshing ? ' busy' : '') }),
              jsx('span', { children: refreshing ? t('refreshing') : t('autoRefresh') }),
            ] }),
          ] }),
        ] }),

        notice ? jsxs('div', {
          className: 'inj-notice' + (notice.type === 'err' ? ' err' : ''),
          role: notice.type === 'err' ? 'alert' : 'status',
          children: [
            jsx('span', { className: 'inj-noticeText', children: notice.text }),
            jsx('button', {
              type: 'button',
              className: 'inj-noticeClose',
              title: t('notice.dismiss'),
              'aria-label': t('notice.dismiss'),
              onClick: () => setNotice(null),
              children: '✕',
            }),
          ],
        }) : null,

        /* 规则表单（创建 / 编辑） */
        editing && (editing.mode === 'edit' || scope !== 'all')
          ? jsx(TaskForm, {
              key: editing.mode === 'edit' ? editing.task.id : 'new',
              initial: editing.task,
              templates,
              catalog,
              t,
              onSave: saveTask,
              onCancel: () => setEditing(null),
              onTemplatesChanged: () => void refresh(),
            })
          : null,

        /* 规则列表 */
        scope === 'all'
          ? renderAllTasks()
          : (tasks.length === 0 && !editing ? renderEmptyTasks() : tasks.map(renderTaskRow)),

        /* 审阅记录 */
        jsx(Section, {
          title: t('section.runs') + (runs.length ? ' (' + runs.length + ')' : ''),
          open: runsOpen,
          onToggle: () => setRunsOpen(!runsOpen),
          children: runs.length === 0
            ? jsxs('div', { className: 'inj-emptyHero', children: [
                jsx('span', { className: 'inj-emptyIcon', children: '◎' }),
                jsx('div', { className: 'inj-emptyTitle', children: t('empty.runs.title') }),
                jsx('div', { className: 'inj-emptyDesc', children: t('empty.runs.desc') }),
              ] })
            : jsxs(react.Fragment, { children: [
                shownRuns.map(renderRun),
                runs.length > RUNS_COLLAPSED_COUNT
                  ? jsx('button', { type: 'button', className: 'inj-btn small', style: { alignSelf: 'center' }, onClick: () => setRunsAll(!runsAll), children: runsAll ? t('runs.less') : msg('runs.more', { n: runs.length }) })
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