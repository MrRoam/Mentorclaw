# Schedule 与课程存储说明

这份文档只讲存储本身，不讲北航接口细节。

目标只有一个：

- 让 mentorclaw 稳定保存课表、回放和课程资源
- 同时让 `schedule` 能直接使用这些数据

## 先说清楚：什么是 runtime

`runtime` 不是源码仓库，而是 mentorclaw 运行时真正读写的本地状态目录。

要分清两类东西：

- 源代码：在 repo 里，定义“程序怎么工作”
- 运行数据：在 `.openclaw-educlaw` 里，保存“你这个用户当前的真实状态”

所以：

- 课表
- 连接信息
- schedule 偏好
- 本地调试状态

都应该在 runtime，不应该写进 source repo。

## 一句话结构

现在的存储是 5 个核心文件：

- `connections.json`
- `courses.json`
- `course-items.json`
- `course-resources.json`
- `schedule-preferences.json`

当前唯一有效的活动 runtime 路径是：

```text
\\wsl.localhost\Ubuntu-20.04\home\jiaxu\.openclaw-educlaw\workspace\state\education\
```

注意：

- `.openclaw-educlaw` 是隐藏目录
- 它不在 source repo 里
- 现在 UI 也读这套 WSL runtime，而不是 Windows 那套

## 为什么之前会看到两套路径

之前系统里同时存在两套 runtime：

1. WSL：
   `\\wsl.localhost\Ubuntu-20.04\home\jiaxu\.openclaw-educlaw`
2. Windows：
   `C:\Users\MrRoam\.openclaw-educlaw`

这会带来一个直接问题：

- 你在一边看文件
- UI 在另一边读数据

结果就是“明明课表显示出来了，但目录里只看到一个 `schedule-preferences.json`”。

现在已经收敛成：

- **WSL 是唯一活动 runtime**
- Windows 那套只作为历史副本和备份保留，不再作为当前 UI 的读写目标

## 为什么你没找到这些文件

不是文件不存在，而是路径有两个容易踩坑的点：

1. 目录以 `.` 开头，是隐藏目录  
2. 这些文件不在 source repo 里，而在本地 runtime 目录里

也就是说：

- 源代码在 repo
- 真实用户数据在 runtime

这是刻意做的隔离，不是放错地方。

## 隔离原则

本地调试信息和“云端代码”仍然是分离的。

源码里保存的是：

- schema
- 查询逻辑
- 同步脚本
- UI 渲染代码
- 文档

runtime 里保存的是：

- 你的课表
- 本地连接状态
- 登录态/cookie
- 本地生成的课程资源索引
- UI 偏好

这意味着：

- 可以提交代码，但不应该提交 `.openclaw-educlaw`
- `connections.json` 属于本地私有数据，尤其不能入库

## 每个文件分别干什么

### `connections.json`

作用：

- 保存数据源连接状态
- 保存登录态信息
- 保存最近同步时间和错误

为什么单独放：

- 连接失败不应该污染课程数据
- 账号状态和学习数据是两类东西，应该隔离

### `courses.json`

作用：

- 保存“课程主体”

里面是长期稳定的课程对象，比如：

- 课程名
- 教师
- 学期
- 来源课程 ID

为什么要有这一层：

- `class`
- `replay`
- `ppt`
- `subtitle`

这些都要先挂到某门课上，不能直接散落在 schedule 里。

### `course-items.json`

作用：

- 保存所有“时间性事件”

当前支持：

- `class`
- `exam`
- `assignment`
- `notice`
- `replay`

为什么这样设计：

- 课表、本周作业、课程通知、课程回放，本质上都是“和课程有关的事件”
- 用一层统一结构，比每种数据单开一张表更容易维护

当前最重要的两类：

- `class`
  - 用于课表和 `schedule`
- `replay`
  - 用于后续课程回放、知识点切片

### `course-resources.json`

作用：

- 保存课程资源和回放资源

当前支持：

- `folder`
- `ppt`
- `pptx`
- `pdf`
- `video`
- `subtitle`
- `notes`
- `link`

关键字段：

- `courseId`
- `linkedItemId`

其中：

- 如果资源只属于课程，就只有 `courseId`
- 如果资源属于某一节回放，就用 `linkedItemId` 指向那条 `replay`

这就是后续“字幕/PPT 绑定到某节课回放”的基础。

### `schedule-preferences.json`

作用：

- 保存 `schedule` 页的最小偏好

当前只存两件事：

- 是否显示课表
- 默认打开月视图还是周视图

为什么只存这么少：

- 这是 UI 偏好，不是学习数据
- 只保留真正跨刷新需要记住的部分

## 为什么课表不直接复制进 schedule

因为 `schedule` 是视图，不是主数据库。

现在的规则是：

- 课表主数据在 `course-items.json` 的 `type=class`
- `schedule` 查询时再把这些课表项投影成日历事件

这样做有两个直接好处：

1. 关掉“显示课表”时，只是隐藏，不会删数据  
2. 不会出现“课表改了，但 schedule 里还有旧副本”这种双份数据问题

## 现在的课表显示逻辑

`schedule` 页已经支持：

- 月视图
- 周视图
- “显示课表”开关

代码位置：

- [app.js](/home/jiaxu/mentorclaw-source/src/debug-ui/static/app.js)
- [query.ts](/home/jiaxu/mentorclaw-source/src/education/query.ts)

所以结论是：

- 只要 `course-items.json` 里有 `type=class`
- 并且 `schedule-preferences.json` 里 `showTimetableInSchedule=true`

课表就能在 `schedule` 里看到。

## 如何确认 UI 看到的是导入结果

看下面两层是否一致：

1. `course-items.json` 里是否有 `type=class`
2. `schedule` 开关是否打开

如果文件里有课表项，但 UI 没显示，问题就在展示层。  
如果文件里本身没有课表项，问题就在同步层。

## 手工修改为什么不会被下次同步冲掉

因为 `course-items.json` 里留了人工覆盖字段：

- `isHidden`
- `manualTitle`
- `manualLocation`
- `manualStartAt`
- `manualEndAt`
- `manualNote`

规则是：

- 同步只更新源字段
- 展示时优先用人工字段

所以重新同步不会把用户自己改过的内容覆盖掉。

## 回放、字幕、PPT 是怎么绑定的

规则很简单：

1. 一节回放先写成一条 `course-item(type=replay)`
2. 这节回放相关的字幕、PPT、视频写到 `course-resources.json`

## 现在你应该去哪里看文件

如果你要直接核对文件，优先看这个路径：

```text
\\wsl.localhost\Ubuntu-20.04\home\jiaxu\.openclaw-educlaw\workspace\state\education\
```

应该能看到：

- `connections.json`
- `courses.json`
- `course-items.json`
- `course-resources.json`
- `schedule-preferences.json`

如果这里看不到，问题不是“文件没生成”，而是你打开的不是当前活动 runtime。
3. 再通过 `linkedItemId` 绑到那条 replay 上

这样以后做知识点切片时，就可以直接从：

- replay
- subtitle
- ppt
- video

这几层往下走，不需要改课表和 schedule 的结构。

## 以后做知识点切片应该扩哪里

现在不要提前加复杂模型。

正确扩法是后面单独新增一层，例如：

- `replay_segments`

里面再存：

- replay 对应哪一节
- 开始时间
- 结束时间
- 文本
- PPT 页码
- 标签

这样现在的课表和资源结构都不用推翻。

## 相关代码位置

- [education.ts](/home/jiaxu/mentorclaw-source/src/schemas/education.ts)
- [education-repo.ts](/home/jiaxu/mentorclaw-source/src/storage/education-repo.ts)
- [importer.ts](/home/jiaxu/mentorclaw-source/src/education/importer.ts)
- [query.ts](/home/jiaxu/mentorclaw-source/src/education/query.ts)
- [sync.ts](/home/jiaxu/mentorclaw-source/src/education/sync.ts)
- [byxt.ts](/home/jiaxu/mentorclaw-source/src/education/providers/buaa/byxt.ts)
- [msa.ts](/home/jiaxu/mentorclaw-source/src/education/providers/buaa/msa.ts)
- [service.ts](/home/jiaxu/mentorclaw-source/src/debug-ui/service.ts)
- [app.js](/home/jiaxu/mentorclaw-source/src/debug-ui/static/app.js)

## 最后一句话

现在这套存储不是为了“抽象漂亮”，而是为了保证一件事：

- 课程主数据稳定
- schedule 不复制课表
- 回放和资源可以继续往下长

这就是最小复杂度下，能支撑你后面做课程回放和知识点切片的底座。
