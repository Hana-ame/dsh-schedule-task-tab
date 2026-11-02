# dsh-schedule-task-tab（会话审阅注入）

DSH Web 插件：**每次主会话一轮对话结束后，自动启动子代理审阅对话内容，判断是否需要注入主会话唤醒主 agent。**

v2 起不再使用定时器——定时注入与 `schedule` 工具功能重复且已闲置，已移除；存储从 v1 自动迁移（删除 `everySeconds`/`nextRunAt`，任务增加 `trigger: "turn-end"`）。
v3 移除 per-session memo——审阅子代理不再有读写 memo 的工具，面板去掉 Memo 分区，存储迁移时删除 `memos` 与任务的 `useMemo`。
v3.1 面板人性化改版：头部一句话说明、规则卡带状态与相对时间、操作改为文字按钮（审阅/编辑/删除）、删除二次确认、空状态引导与「用默认配置直接创建」、审阅记录状态徽标（已提醒/无需提醒/失败）与可复制的子代理会话 id、表单 Esc 关闭与必填校验、自动刷新指示。

## 行为

1. Host 半监听 host 平面 `session/event`；主会话（非子代理会话）出现真实 `turn/end` 时，为该会话每条**已启用**的审阅规则排一次审阅。
2. 审阅子代理只拿到两个工具，按规则里的指令工作：
   - `inject_context_read` 读取主会话最近消息（审阅对话内容）；
   - `inject_deliver` 提交要注入的内容。
3. 只有调用了 `inject_deliver` 才注入：内容加 `[注入·规则名]` 前缀，经 `sessionController.prompt` 作为一条消息注入并唤醒主 agent；不调用则“本轮不注入”。
4. **防自唤醒**：`[注入·` 前缀标识注入唤醒的下一轮，该轮 `turn/end` 不再触发审阅；子代理会话与日志修复/分叉产生的合成 `turn/end` 同样跳过。
5. 同一会话多规则按**有界串行队列**执行（上限 4 条排队），不并发争用运行上下文。

## 面板

会话视图新增「审阅」tab：顶部一句人话说明当前行为；审阅规则 CRUD（名称、子代理模型、审阅指令、启用开关，模板可一键填入/管理）；最近审阅记录按状态徽标分组展示（已提醒/无需提醒/失败），带相对时间、结束原因与子代理会话 id（点击复制）；支持「立即审阅」、仅本会话/全部会话切换、30 秒自动刷新指示。

完整指令支持占位符：`{sessionId}` `{taskName}` `{turn}` `{reason}`；留空则使用内置默认审阅指令。

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