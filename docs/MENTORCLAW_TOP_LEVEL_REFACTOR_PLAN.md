# mentorclaw 顶层重构计划

## 1. 新定位

mentorclaw 不再追求成为一个“通用学习 agent 框架”。

新的单一定位是：

- 它是一个**专门面向校内平台的 agent**
- 它的重点是**围绕课程、课表、作业、回放、PPT、字幕等校内资源工作**
- 它不是新的 harness
- 它不是新的通用记忆框架
- 它是在成熟 agent runtime 之上，做**校内学习场景适配**

这意味着后续所有设计都要服从一个原则：

**能复用 OpenClaw 的，就不要自造。只有校内学习场景独有的那层，才由 mentorclaw 自己实现。**

## 2. 这次重构要解决什么问题

当前复杂度过高，根因不是“功能太多”，而是“系统边界不清”。

现在的问题主要有四类：

1. 把 harness 层和业务层混在了一起  
OpenClaw 已经有 session、context compaction、prompt 组装、memory 能力，但当前 mentorclaw 又在其上额外造了 thread、memory-updater、context-builder、workflow state panel。

2. 把长期记忆、项目状态、会话状态混在了一起  
当前 learner / plan / thread 三层都在维护状态，文件太碎，职责重叠。

3. 把“说明文档”和“运行时状态”混在了一起  
`MEMORY_POLICY.md`、`WORKFLOWS.md`、`PEDAGOGY.md`、`EVALUATION_POLICY.md` 更像设计说明，不该占 live runtime 的核心位置。

4. 没有围绕“校内课程资源”建立真正的顶层模型  
当前已经有 `state/education/*`，但 mentorclaw 顶层对象仍然是通用 `plan/thread/workflow`，没有直接体现“课程内 project”和“定时 cron”这两个最关键对象。

## 3. 顶层设计原则

本次重构只保留四条原则。

### 3.1 复用成熟 harness

继续复用 OpenClaw 的：

- session / transcript
- compaction
- system prompt 主干
- 基础记忆文件
- hook 机制
- 调度能力

不再重写 prompt 主干，不再重做一套通用 memory system。

### 3.2 记忆跨项目，但项目状态独立

用户画像、长期偏好、长期背景，应该跨 project 共享。  
这类内容更接近 OpenClaw / Claude Code / ChatGPT 的长期记忆层。

但课程内的执行状态、作业推进、某门课的自学路径，必须是 project 内独立的。

因此重构后要明确区分：

- **全局记忆**：跨 project 的用户画像
- **project 状态**：某个课程/项目的结构化状态
- **session 上下文**：当前对话短期上下文，交给 OpenClaw

### 3.3 顶层对象只保留两类

新的 mentorclaw 顶层对象只有：

- `project`
- `cron`

不再把 `thread` 作为独立一级对象。

`workflow` 不再作为对外核心概念，只保留必要的内部策略判断。

### 3.4 校内平台资源是真正的业务核心

mentorclaw 的价值不在“它会总结”，而在：

- 它知道某个 project 绑定哪门课
- 它知道那门课有哪些 class / assignment / replay / ppt / subtitle / notes
- 它能围绕这些资源回答问题和推进学习

所以顶层重构要围绕“project 如何绑定课程资源”展开，而不是围绕“记忆文件如何拆得更漂亮”展开。

## 4. 目标架构

重构后的系统按三层理解。

### 4.1 Harness 层：OpenClaw

职责：

- 接收消息
- 管理 session
- 维护 transcript 和 compaction
- 加载静态 prompt 文件
- 提供 memory 主干
- 提供 hook / cron / tools 能力

这一层尽量不动。

### 4.2 mentorclaw 顶层领域层

职责：

- 管理 `project`
- 管理 `cron`
- 做 session 与 project 的绑定
- 从校内平台资源中取出与当前 project 相关的上下文
- 在必要时补充极少量领域上下文

这一层是本次重构的重点。

### 4.3 校内平台数据层

职责：

- 保存课程
- 保存课表事件
- 保存作业 / notice / replay
- 保存 PPT / 字幕 / 视频 / notes / link

这一层已经存在：

- [education-repo.ts](/home/jiaxu/mentorclaw-source/src/storage/education-repo.ts)
- [education.ts](/home/jiaxu/mentorclaw-source/src/schemas/education.ts)
- [query.ts](/home/jiaxu/mentorclaw-source/src/education/query.ts)

本次不重做这层，只做顶层对象与它的衔接。

## 5. 重构后的核心对象

### 5.1 全局记忆

作用：

- 存用户画像
- 存长期学习偏好
- 存稳定背景
- 存跨课程共享的信息

建议直接复用 OpenClaw 的长期记忆主干，比如：

- `MEMORY.md`

`memory/YYYY-MM-DD.md` 不再承担 project 状态职责。  
它可以继续作为全局 daily scratch 存在，但 mentorclaw 业务逻辑不依赖它。

### 5.2 Project

`project` 替代当前 `plan`，成为 mentorclaw 的核心业务对象。

典型例子：

- 一门课的期中复习项目
- 某门课的自学理解项目
- 某门课的作业推进项目

每个 project 是一个独立文件：

```text
workspace/projects/<projectId>.yaml
workspace/projects/<projectId>.events.jsonl
```

project 应包含：

- 基本信息
- 绑定的课程范围
- 当前目标
- 执行状态
- 当前任务
- 误区和 durable notes
- 与课程资源的绑定策略

### 5.3 Cron

`cron` 是第二个顶层对象，但它不是另一套复杂状态机。

它的本质是：

- 一个定时触发器
- 在某个条件下，对某个课程或 project 执行一个任务

典型例子：

- 每节课下课后发送本节课总结
- 每周日晚汇总本周某门课的作业和待办
- 每天晚上提醒明天有课/有 ddl 的课程

原则：

- 调度能力尽量复用 OpenClaw 或宿主侧已有 cron
- mentorclaw 只负责“cron 的业务语义”，不负责发明自己的调度系统

## 6. 重构后的文件结构

顶层目标结构：

```text
workspace/
  AGENTS.md
  SOUL.md
  TOOLS.md
  MEMORY.md

  projects/
    <projectId>.yaml
    <projectId>.events.jsonl

  state/
    education/
      connections.json
      courses.json
      course-items.json
      course-resources.json
      schedule-preferences.json

  .openclaw/
    mentorclaw-session-bindings.json
```

解释：

- `AGENTS.md / SOUL.md / TOOLS.md`
  继续作为静态规则文件
- `MEMORY.md`
  全局用户画像
- `projects/*.yaml`
  课程内 project 的结构化状态
- `projects/*.events.jsonl`
  project 演化历史
- `state/education/*`
  校内资源真相源
- `session-bindings`
  session -> project 的映射

## 7. 需要删除或废弃的旧设计

### 7.1 删除 thread 体系

待删除：

- [thread-manager.ts](/home/jiaxu/mentorclaw-source/src/core/thread-manager.ts)
- `thread` 目录及其状态文件
- `thread summary`
- `working_memory`
- `thread events`
- `threadId` 作为顶层主概念

原因：

- 与 OpenClaw session 职责重叠
- 增加大量状态同步成本
- 对当前“校内平台专用 agent”定位没有必要

### 7.2 删除碎片化 learner 状态体系

待废弃：

- `PROFILE.md`
- `PREFERENCES.md`
- `GLOBAL_GOALS.md`
- `GLOBAL_MISCONCEPTIONS.yaml`
- `LEARNER_STATE.yaml`

原因：

- 这些内容本质上属于跨项目用户画像
- 更适合收束到 `MEMORY.md`
- 当前拆分过细，维护成本过高

### 7.3 删除碎片化 plan 状态体系

待废弃：

- `PLAN.md`
- `GOALS.md`
- `PROGRESS.yaml`
- `TASKS.yaml`
- `MILESTONES.yaml`
- `MISCONCEPTIONS.yaml`
- `RESOURCES.md`
- `SUMMARY.md`
- `INDEX.yaml`

替代：

- `projects/<projectId>.yaml`
- `projects/<projectId>.events.jsonl`

### 7.4 删除过重的 prompt 状态卡

当前待删除的思路：

- learnerSummary / planSummary / threadSummary / resourceSummary 面板式注入
- “Primary workflow / Secondary workflow / Why This Workflow” 这类大块上下文卡

保留的只有：

- 极少量当前 project 事实
- 极少量当前课程资源事实

### 7.5 将说明型文档移出 live runtime

移出运行时主路径，放入 docs：

- `MEMORY_POLICY.md`
- `WORKFLOWS.md`
- `PEDAGOGY.md`
- `EVALUATION_POLICY.md`

它们不再是运行时真相源。

## 8. 代码层面的修改范围

### 8.1 需要删除或大幅收缩的模块

- [src/core/thread-manager.ts](/home/jiaxu/mentorclaw-source/src/core/thread-manager.ts)
- [src/core/memory-updater.ts](/home/jiaxu/mentorclaw-source/src/core/memory-updater.ts)
- [src/core/context-builder.ts](/home/jiaxu/mentorclaw-source/src/core/context-builder.ts)

这三个是最主要的复杂度来源。

### 8.2 需要重写的模块

- [src/core/orchestrator.ts](/home/jiaxu/mentorclaw-source/src/core/orchestrator.ts)
- [src/integration/openclaw-adapter.ts](/home/jiaxu/mentorclaw-source/src/integration/openclaw-adapter.ts)
- [src/storage/workspace-repo.ts](/home/jiaxu/mentorclaw-source/src/storage/workspace-repo.ts)

重写目标：

- 从 `learner + plan + thread` 变为 `memory + project`
- 从面板式 prompt 注入变为最小桥接
- 从碎文件读写变为单 project 文件读写

### 8.3 需要保留但收缩的模块

- [src/core/workflow-router.ts](/home/jiaxu/mentorclaw-source/src/core/workflow-router.ts)

新的要求：

- 不再承担大而全 workflow 系统
- 只保留必要的内部 turn 策略判断
- 不再作为系统主概念暴露

### 8.4 应尽量保持不动的模块

- [src/storage/education-repo.ts](/home/jiaxu/mentorclaw-source/src/storage/education-repo.ts)
- [src/education/query.ts](/home/jiaxu/mentorclaw-source/src/education/query.ts)
- [src/education/importer.ts](/home/jiaxu/mentorclaw-source/src/education/importer.ts)
- `src/education/providers/*`

原因：

- 这层已经是你面向校内平台的真实资产
- 这次重构不该再去扩散复杂度

## 9. 分层实施计划

### 第 0 层：冻结新定位

目标：

- 用文档固定新的产品定位
- 停止继续按旧 `plan/thread/workflow` 心智扩展功能

完成标志：

- 本文档成为后续重构的单一顶层依据

### 第 1 层：清理概念复杂度

目标：

- 把说明文档从 runtime 核心里拿出去
- 把系统主概念从 `plan/thread/workflow` 收敛到 `project/cron`

修改：

- 停止在 bootstrap 脚本里强调旧 policy 文档
- 更新 docs 和命名

完成标志：

- 新增 `project` / `cron` 作为顶层对象
- 不再新增 thread 相关能力

### 第 2 层：删除 thread

目标：

- 把短期上下文职责完全交回 OpenClaw session

修改：

- 删除 thread manager
- 删除 thread 状态文件
- 删除 session -> thread 绑定
- 将绑定收缩为 session -> project

完成标志：

- 当前系统不再依赖 thread 才能正常回答

### 第 3 层：收缩记忆体系

目标：

- learner 长期信息回归 `MEMORY.md`
- project 状态收束为单文件

修改：

- 废弃 learner 多文件体系
- 废弃 plan 多文件体系
- 建立 `projects/<projectId>.yaml`

完成标志：

- 只有 `MEMORY.md + project.yaml + project.events.jsonl + session` 四类核心状态

### 第 4 层：建立 cron/project 顶层模型

目标：

- 让 mentorclaw 真正围绕“课程内 project”和“定时任务”工作

修改：

- project 支持绑定课程
- cron 支持绑定 project 或课程范围
- 定时总结、提醒等走这套对象模型

完成标志：

- 用户可感知的主要能力都能映射到 `project` 或 `cron`

### 第 5 层：资源桥接

目标：

- project 能安全读取和使用校内课程资源

说明：

- 这层很重要，但不属于本次顶层设计的主计划
- 单独放在另一份文档中说明

## 10. 重构后的最终用户体验

### 场景 A：课后自动总结

用户说：

“每节《信号与系统》下课后，自动给我发这节课总结。”

系统内部应该理解为：

- 创建一个 `cron`
- 这个 cron 绑定到《信号与系统》课程
- 每次课后触发时，从这门课最近一次 class / replay / subtitle / ppt 中取上下文
- 生成课后总结

这里不需要 thread，不需要 tutor/evaluate workflow 大系统。

### 场景 B：课程内自学 project

用户说：

“帮我建一个《信号与系统》期中复习项目。”

系统内部应该理解为：

- 创建一个 `project`
- 这个 project 绑定该课程
- 后续所有会话默认在这个 project 范围内进行

此后用户问：

- “老师第 5 讲怎么讲卷积的？”
- “这节课作业是什么？”
- “我应该先看 PPT 还是先看回放？”

系统都通过：

- session -> project
- project -> course binding
- course binding -> education store

来回答。

### 场景 C：跨项目用户画像

用户在不同课程项目里都表现出：

- 喜欢先讲直觉再讲定义
- 更适合例题驱动
- 晚上学习效率更高

这些不是某个 project 的状态，而是全局画像。  
它们最终进入：

- `MEMORY.md`

这样新的课程 project 也能继承这些偏好。

## 11. 本次顶层计划不包含什么

为了降低认知负担，本计划刻意不展开以下内容：

- 课程资源接口的详细 schema
- resource ranking / retrieval 规则
- 课程资源如何切片
- 引用权限与缓存策略
- 具体 UI 交互细节

这些内容单独放在课程接口文档中。

## 12. 验收标准

当这轮顶层重构完成后，应该满足：

1. mentorclaw 的顶层对象可以一口气说清  
只有全局 memory、project、cron、session、education store。

2. 系统不再依赖 thread 才能工作

3. 系统不再依赖一堆 learner / plan / thread 碎文件

4. 系统不再依赖大块 workflow prompt 注入

5. project 能自然地绑定课程，并围绕课程资源工作

6. 用户画像是跨 project 的，不再混在各类 project 状态里

7. 后续新增功能时，优先落到：
   - `project`
   - `cron`
   - `education store`
   其中之一，而不是继续加新抽象层
