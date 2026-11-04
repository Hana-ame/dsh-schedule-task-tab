# dsh-schedule-task-tab（会话审阅注入）

DSH Web 插件：**每次主会话一轮对话结束后，自动启动子代理审阅对话内容，判断是否需要注入主会话唤醒主 agent。**

> **v3.4 关键变更（修「只审阅一次」）**
>
> v3.3.1 及以前，凡是由本插件注入唤醒的那一轮，`turn/end` 会被直接跳过（`injected-turn`）。
> 于是每条人类消息最多只能注入一次：**审阅 → 注入 → 主 agent 干活 → 该轮结束 → 跳过 → 链断**。
> 用户看到的现象就是「只审阅一次，之后再也不审」。
>
> v3.4 改为**注入链模型**：注入唤醒的轮次继续审阅（因此「自己这轮注入得到的结果」也会被审），
> 直到连续注入达到该规则的 `maxChain`（默认 3，0 = 不限但硬顶 50）才停。人类发新消息会清零链深度、
> 重新拿满额度。同时：
> - 所有「没真正启动子代理」的跳过（队列满 / 重复 / busy / 达到链上限）现在都会落一条
>   `status: "skipped"` 的运行记录，面板显示「未执行 + 原因」，不再静默消失；
> - 新建规则时可选 `reviewNow`（面板默认开启）——建完立刻补审当前对话，不用等下一条人类消息；
> - 存储路径改用 `$DSH_HOME`（此前用 `ctx.get('hmr').baseDir`，该值跨 live 重载会变，
>   重载后插件曾去读一个空的遗留 v1 文件，表现为规则/模板"全部消失"）；`DSH_HOME` 缺失时才回退。

v2 起不再使用定时器——定时注入与 `schedule` 工具功能重复且已闲置，已移除；存储从 v1 自动迁移（删除 `everySeconds`/`nextRunAt`，任务增加 `trigger: "turn-end"`）。
v3 移除 per-session memo——审阅子代理不再有读写 memo 的工具，面板去掉 Memo 分区，存储迁移时删除 `memos` 与任务的 `useMemo`。
v3.1 面板人性化改版：头部一句话说明、规则卡带状态与相对时间、操作改为文字按钮（审阅/编辑/删除）、删除二次确认、空状态引导与「用默认配置直接创建」、审阅记录状态徽标（已提醒/无需提醒/失败）与可复制的子代理会话 id、表单 Esc 关闭与必填校验、自动刷新指示。

## 行为

1. Host 半监听 host 平面 `session/event`；主会话（非子代理会话）出现真实 `turn/end` 时，为该会话每条**已启用**的审阅规则排一次审阅。注入唤醒的轮次同样审阅（受 `maxChain` 约束）。子代理判据只有 `origin === 'subagent'` 与 `delegationDepth > 0`；`parentSession` 只表示 fork 血缘（见下节），**不是**子代理判据。
2. 审阅子代理固定用 `spawn` provider（fresh 上下文，不会把主会话历史 seed 进子会话；缺该 provider 时本轮直接判失败并记录原因，不静默换 provider），只允许两个工具（toolFilter 之外还在子代理 agent scope 上补一道 guard，挡住 preset 带下来的 `list_agents`/`subagent` 等 scoped 工具）：
   - `inject_context_read` 读取主会话最近消息（审阅对话内容）；
   - `inject_deliver` 提交要注入的内容。
3. 只有调用了 `inject_deliver` 才注入：内容加 `[注入·规则名]` 前缀，经 `sessionController.prompt` 作为一条消息注入并唤醒主 agent；不调用则“本轮不注入”。
4. **防自唤醒**：`[注入·` 前缀标识注入唤醒的轮次，这类轮次按**注入链深度**继续审阅，但连续注入达到 `maxChain` 就停（默认 3）；子代理会话与日志修复/分叉产生的合成 `turn/end` 始终跳过。人类新消息重置链深度。
5. 同一会话多规则按**有界串行队列**执行（上限 4 条排队），不并发争用运行上下文。

### 版本分支（消息编辑 / 重 roll）

`@agent-stash/dsh-message-edit` 把每个版本做成父链上的子会话（`parentSession` + `isSeeded`，`origin` 为空），**不是**子代理会话，照常参与审阅：

- 规则绑定在**血缘根**（这棵版本树最上面的原会话，创建/列表都按它归一化），同一对话的所有版本共享同一套规则；
- 任一本的 `turn/end` 都会命中根上的规则，但 `inject_context_read` 与 `inject_deliver` 的目标、以及 `prompt` 注入去向都是**当前活跃的那一版**（运行记录里的 `targetSessionId`），不会读旧版本上下文、也不会唤醒旧版本；
- 版本分支里点「立即审阅」同样以当前版本为目标。

## 面板

会话视图新增「审阅」tab：顶部一句人话说明当前行为；审阅规则 CRUD（名称、子代理模型、审阅指令、启用开关，模板可一键填入/管理）；最近审阅记录按状态徽标分组展示（已提醒/无需提醒/失败），带相对时间、结束原因与子代理会话 id（点击复制）；支持「立即审阅」、仅本会话/全部会话切换、30 秒自动刷新指示。

子代理模型选择器复用了 `dsh-gear-grid-model`（v1.1 起导出的 `GearGridPicker`）：触发按钮显示「provider / model + 强度」，弹窗里「常用」显示手动 star 的模型、具体 provider tab 显示该 provider 全部模型，选中即带回 `provider`/`model`/`reasoningEffort`（强度随规则存下并透传到子代理 `agentOptions`）。该依赖是**可选**的：用 `require.async('dsh-gear-grid-model')` 懒加载，插件缺失/版本旧/加载失败时自动回退到普通「服务商 + 模型」两个下拉框。

完整指令支持占位符：`{sessionId}` `{taskName}` `{turn}` `{reason}`；留空则使用内置默认审阅指令。

「注入链上限」（`maxChain`）字段：注入唤醒的轮次继续审阅到连续第几轮为止；默认 3，填 0 = 不限（硬上限 50）。

## 存储 / RPC

- 存储：`$DSH_HOME/storages/inject-manager.json`（JSON，v3）。
- RPC：`POST /api/inject-manager`，`{method, args}` → `{ok, value|error}`。

## 测试

```bash
# 单元 + fake-Cordis 宿主集成测试（触发判定/默认 prompt/迁移/队列/RPC/注入与防自唤醒）
npm test        # node --test test/*.test.js

# live 端到端（需要运行中的 dsh-web 与本次进程的 launch token；会建临时会话并在结束时归档）
DSH_WEB_TOKEN='<dsh web 启动 URL 里的 token>' npm run test:live
#   token 可从 journalctl -u dsh-web.service | grep -o 'http[^ ]*token[^ ]*' 找回（同一进程有效）
```

`test/live-e2e.mjs` 覆盖：自动 `turn/end` 触发（非 runNow）、注入唤醒主会话、注入消息开启新一轮、注入轮结束后不再触发（防自唤醒）、清理并归档临时会话。