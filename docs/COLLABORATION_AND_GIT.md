# Educlaw 协作和 Git 方案

这份文档是给准备一起做 Educlaw 的同学看的。目标只有两个：

1. 让前端可以先开工，不被内核开发卡死。
2. 不把本地账号、日志、记忆、凭证混进 Git。

## 一句话先讲清楚

前端现在可以开始做，而且不需要直接碰 OpenClaw 的内部代码。

前端真正需要的，不是 OpenClaw 的整套实现，而是几类稳定的数据：

- 当前用户是谁
- 当前计划是什么
- 计划里有哪些任务
- 最近进展是什么
- 聊天区返回了什么
- 资源有哪些

所以，前端和内核之间不要直接耦合到文件结构。  
前端只认“后端返回的数据长什么样”。

这里说的“数据格式约定”，就是之前提到的 `contracts`。不用把它想复杂，它本质上就是：

- 后端承诺返回什么字段
- 前端按这些字段来渲染

比如：

```json
{
  "planId": "plan-001",
  "title": "两周内完成线性代数第一章",
  "tasks": [
    {
      "id": "task-01",
      "title": "看教材第 1 章第 1 节",
      "status": "todo"
    }
  ]
}
```

只要这个格式不乱改，前端就能持续工作。

## 最重要的边界

### 你负责的部分

- Educlaw 内核
- OpenClaw 接入
- 计划生成逻辑
- 三层记忆
- 资源解析和资源绑定
- 多租户隔离
- 后端 API

### 同学负责的部分

- 浏览器 UI
- 页面布局
- 交互细节
- 上传入口
- 计划展示
- 进度展示
- demo 演示效果

### 不要让同学负责的部分

- OpenClaw runtime 配置
- 你的本地飞书/Slack/Google Calendar
- 你本地的 `.openclaw-educlaw`
- 任何真实 token
- 任何真实 learner memory

## 仓库应该怎么放

建议继续只用一个私有 Git 仓库，但把结构分清楚。

建议目标结构：

```text
educlaw-source/
  apps/
    web/
  src/
    core/
    integration/
    resources/
    schemas/
    storage/
  docs/
  scripts/
  plugin/
```

解释：

- `src/` 还是你现在的内核和接入代码
- `apps/web/` 是同学做浏览器 UI 的地方
- `docs/` 放你们协作说明和接口说明
- `plugin/` 继续放 OpenClaw 插件

这样做的好处是：

- 只有一个仓库，大家同步简单
- 前端和内核版本能一起管理
- 但代码区域还是分开的，不会乱

## 哪些东西绝对不能进 Git

这些必须永远放在仓库外面：

- `.openclaw-educlaw/`
- 日志
- sessions
- credentials
- devices
- secrets
- 任何真实 token
- 任何真实用户记忆
- 任何你自己的日历绑定

这也是为什么源码仓和 runtime 实例必须分开。

## 同学现在需要哪些代码

同学现在只需要这些：

- 这个源码仓
- `docs/BROWSER_UI_SPEC.md`
- `templates/runtime/workspace/`
- 后面你补的 API 文档
- 一份假的 mock 数据

他不需要：

- 你的 OpenClaw 本地目录
- 你的飞书账号
- 你的 Slack 配置
- 你的 Google Calendar
- 你的真实测试数据

`templates/runtime/workspace/` 里同步了 Educlaw 的共享架构材料，比如：

- `AGENTS.md`
- `SOUL.md`
- `TOOLS.md`
- `agent/PEDAGOGY.md`
- `agent/WORKFLOWS.md`
- `agent/MEMORY_POLICY.md`
- `agent/EVALUATION_POLICY.md`

这些文件应该进 Git，因为它们描述的是系统设计，不是个人隐私。

## 前端为什么可以先做

因为浏览器 UI 第一版主要是“展示”和“交互”，不是“真正执行 OpenClaw”。

同学可以先用假数据把这些做出来：

- 首页
- 聊天区
- 计划面板
- 今日任务面板
- 资源面板
- 学习进度页
- 复盘页

等你后面把后端接口补上，再把假数据换成真实数据。

这就叫“前端先用 mock 数据开发”。

意思很简单：

- 先假装后端已经完成
- 用一份手写 JSON 代替后端返回
- 页面先做出来
- 真接口好了再接

## 我建议你们现在就固定的最小接口

前端第一版只围绕这 6 个接口设计。

### 1. 获取当前用户首页数据

`GET /api/dashboard`

返回：

```json
{
  "learner": {
    "name": "Jiaxu",
    "focus": "两周内完成一个主题",
    "riskFlags": []
  },
  "activePlan": {
    "planId": "plan-001",
    "title": "两周完成主题学习",
    "phase": "planning",
    "progress": 0.25
  },
  "todayTasks": [
    {
      "id": "task-01",
      "title": "看教材第 1 章第 1 节",
      "status": "todo",
      "dueAt": "2026-04-05T12:00:00Z"
    }
  ],
  "recentEvents": [
    {
      "type": "turn_processed",
      "text": "系统已识别为 planning",
      "time": "2026-04-02T18:00:00Z"
    }
  ]
}
```

### 2. 发送一条消息

`POST /api/turn`

请求：

```json
{
  "message": "我两周后要完成一个主题，帮我拆计划"
}
```

返回：

```json
{
  "reply": "好的，我先帮你确认目标。",
  "workflow": "planning",
  "planId": "plan-001",
  "threadId": "thread-001"
}
```

### 3. 获取一个计划详情

`GET /api/plans/:planId`

返回：

```json
{
  "planId": "plan-001",
  "title": "两周完成主题学习",
  "phase": "planning",
  "goals": [
    "明确范围",
    "安排资源",
    "拆成日任务"
  ],
  "tasks": [
    {
      "id": "task-01",
      "title": "看教材第 12-18 页",
      "status": "todo",
      "resourceRef": "book-1#p12-p18"
    }
  ],
  "resources": [
    {
      "id": "book-1",
      "title": "教材 A",
      "kind": "pdf"
    }
  ]
}
```

### 4. 更新任务状态

`PATCH /api/tasks/:taskId`

请求：

```json
{
  "status": "done"
}
```

### 5. 上传资料

`POST /api/resources/upload`

先不用真的实现很复杂。  
前端先把上传入口和文件列表做出来即可。

### 6. 获取资源列表

`GET /api/resources`

## Git 怎么协作最省事

最简单、够用的方案如下。

### 主分支规则

- `main`：始终保持可运行、可演示

### 分支规则

- 你开发内核：`kernel/...`
- 同学开发前端：`web/...`

例如：

- `kernel/tenant-isolation`
- `kernel/resource-binding`
- `web/dashboard-v1`
- `web/chat-layout`

### 提交流程

1. 两个人都从 `main` 拉最新代码
2. 各自在自己的分支开发
3. 做完后发起合并请求
4. 只在 `main` 保持稳定时合并

### 你们怎么避免互相卡住

规则很简单：

- 前端不要直接读 runtime 文件
- 前端只读 API 返回的数据
- 内核改动如果影响前端，优先保持字段兼容
- 如果必须改字段，就提前在文档里改掉

## 哪种改动会让前端很痛苦

这些事要尽量少做：

- 今天叫 `planId`，明天改成 `id`
- 今天返回 `tasks` 数组，明天又拆成三层嵌套
- 今天 `progress` 是数字，明天变成字符串
- 页面已经用了的字段频繁重命名

你可以改内核逻辑，但尽量不要每天改前端依赖的数据名字。

## 具体协作建议

如果你准备让同学马上开工，我建议就按这个节奏：

### 你这周做

- 把 UI 需要的 6 个接口定下来
- 先不一定全实现，但要把字段写清楚
- 提供一份 mock JSON

### 同学这周做

- 搭浏览器 UI
- 用 mock JSON 做首页、聊天区、计划页、资源页
- 不碰 OpenClaw 内部

### 下周你再做

- 把 mock JSON 换成真实接口
- 一页一页接起来

## 最后的判断

是的，你完全可以让同学现在就开始做。

前提不是“你的框架完全定型”，而是：

- 你先把前端需要的那一小层数据格式定下来
- 前端只依赖这一小层
- 不直接依赖 OpenClaw 的内部结构

只要这样做，后面你改内核，大多数时候前端都能继续工作，或者只需要很小的适配。
