# 朱老师英语课堂

这是一个基于微信云开发的教师/学生学习小程序，包含英语课程与错题管理，以及可由老师逐个学生开启的法语入门学习功能。

第一阶段已经完成课程、学生、错题和图片上传的基础管理。第二阶段加入轻量身份隔离：

- 朱老师：通过云函数配置的 openid 白名单识别，可以查看所有学生并添加学生、英语课、英语错题。
- 学生：通过专属 accessCode 首次绑定微信 openid，绑定后只能查看自己的英语课和英语错题。
- 数据权限：学生端不直接读取全部 students 集合，主要业务读取由云函数 `quickstartFunctions` 校验 openid 后返回。

## 云开发集合

需要创建：

- `students`
- `lessons`
- `papers`
- `mistakes`
- `vocabularyProgress`
- `vocabularyDailyStats`
- `frenchLearningProgress`
- `systemLocks`

`students` 需要包含：

```js
{
  name,
  nickname,
  grade,
  parentName,
  status,
  accessCode,
  studentOpenId,
  studentOpenIds,
  studentBindLimit,
  teacherOpenId,
  teacherName,
  subject,
  vocabularyEnabled,
  englishCourseEnabled,
  mistakeLearningEnabled,
  frenchLearningEnabled,
  lessonTemplateKey, // general / feng_beginner / molly_oral_ket
  teacherHidden,
  createdAt
}
```

## 背单词学习流程与账号切换

- 学生主页先进入独立的“今日背单词”页面，一次只显示一个词，按“主动回忆 → 查看答案 → 自评记忆程度”完成；“没记住”和“有点难”的词会在本轮末尾再出现一次。
- 学生首页统一显示“① 先背单词 → ② 个性化小测 → ③ 课后任务”；“单词学习记录”页只负责词库总览、搜索、筛选和掌握记录，不再重复今日流程。
- 学生首页不再显示重复的“英语课程与作业”入口；课后任务直接进入任务总览，错题直接进入错题复习。旧的学生详情汇总页只保留给教师管理使用，学生访问旧链接会返回真实学生首页。
- 英语小测按每日目标、今日接触词、薄弱词、到期复习和历史正确率动态安排 8～15 题，包含看词选义、看义选词、字母补缺和完整默写；法语学习不使用这套小测。
- 今日单词数量只能由教师设置；学生端和教师预览显示同一块目标面板，但都是只读。
- 教师预览可以完整操作背词流程，但只在本地切换卡片，不调用保存接口。
- 普通学生访问码默认最多绑定 5 个微信账号；Jason 测试码保持不限人数。已有学生缺少 `studentBindLimit` 字段时也按 5 个兼容。
- 教师端和学生端首页底部都有“退出绑定”。退出只解除当前微信身份，不删除课程、错题或学习进度；教师白名单账号退出后也会停留在访问码页面，重新输入教师码即可恢复教师身份。
- 针对性检查：`node tools/validate-identity-and-vocabulary-flow.js`。

## 英语启蒙（0A 零基础）

- `0A` 位于一年级上册之前，包含 89 项：26 个大小写字母、0–20 数字、课堂动作、问候和礼貌用语、基础颜色及第一批生活词。
- 现有学生不会被自动勾选 `0A`；教师可为零基础学生只选择“英语启蒙（零基础）”。启蒙词按教学顺序进入每日任务，教师选中的词库就是学生的学习范围，不再额外按“基础词”二次过滤。
- 89 项现在都优先使用独立短 WAV，避免手机为了播放一个词先加载并跳转一条约 95 秒的音频合辑。播放器会显示“加载读音”，8 秒无响应后自动重试，并在短音频不可用时回退到原有音频精灵。
- 本地待上传目录为 `output/vocabulary-audio/beginner-direct-v1/`，共 89 个文件、约 3.9 MiB。必须把整个目录上传到 CloudBase 的 `vocabulary-audio/beginner-direct-v1/`；不要只上传外层文件夹名，也不要改文件名。
- 原有 `output/vocabulary-audio/sprites-beginner-v1/vocabulary-audio-sprite-beginner-1.wav` 保留为兼容兜底，无需删除。89 个独立短音频已经完成并由完整性检查保护，不再依赖已移除的旧基础音频目录重建。
- 上传音频后还需重新部署 `quickstartFunctions` 并上传小程序前端；只有在家长真机分别用 Wi-Fi 和移动网络试听后，才能确认线上问题已修复。
- 内容与音频校验：`node tools/validate-beginner-vocabulary.js`、`node tools/validate-vocabulary-audio-sprites.js`、`node tools/validate-vocabulary-audio-player.js`。

## 英语课程模板与电脑资料

- 教师可在学生详情选择“通用英语 / 零基础夯实 / 口语＋KET”课程记录模板；新建课程会自动继承，也可以只为某一节课临时切换。
- 冯嘉文兼容默认“零基础夯实”，Molly 兼容默认“口语＋KET”；教师一旦保存选择，后续以 `students.lessonTemplateKey` 为准。
- Windows 电脑上传课程资料时，先双击 `tools/local-material-uploader/start-local-material-uploader.cmd`，在浏览器准备文件，再到微信开发者工具的课程页点击“读取电脑资料”。
- 本机助手只监听 `127.0.0.1:3211`，资料只存在内存中。验证命令：`node tools/validate-course-workspace.js`、`node tools/validate-local-material-uploader.js`。

## Molly KET 词库音频

- Molly 的 640 个 KET 词必须全部带有读音；`node tools/validate-molly-ket-vocabulary.js` 会同时检查 640 个词、16 周分组、每日 8 个以及 640/640 音频覆盖率。
- Molly 不再使用或依赖 `sprites-molly-ket-v1` 大合辑。640 个词的独立文件全部集中在 `output/vocabulary-audio/molly-ket-direct-v1/`（约 30.6 MiB），文件名使用 `001-name.wav`、`002-age.wav` 这种“顺序号＋单词/短语”格式，便于人工核对。
- 上线前把该目录中的 640 个 WAV 原样上传到云存储 `vocabulary-audio/molly-ket-direct-v1/`，不要再创建或上传 `sprites-molly-ket-v1`。运行时为了不破坏冯嘉文现有映射，Molly 与启蒙词库重复的 20 个词仍共用 `beginner-direct-v1`；因此该目录也必须保留并完成上传。640 个独立文件已经完成并由 `node tools/validate-vocabulary-audio-sprites.js` 检查，不再依赖已移除的旧基础音频目录重建。
- 冯嘉文或 Molly 以真实学生身份进入首页后，客户端会在后台获取并临时缓存当天最多 30 个待学词的短音频；通常每日目标为 8 个。教师预览不会触发预下载，下载失败也不会阻塞首页，进入背词页后仍保留在线地址和合辑回退。

## 译林 2024 七年级上册与现用共享音频

- 2012 课标旧版六册词库已经移除；教师端只保留已核对的“译林版 · 2024新教材（2022课标）”七年级上册，并按八个单元分别开关。
- 新教材音频目录现有 309 个短音频；在原 307 个文件基础上新增 `308-informal.wav` 与 `309-keep-to.wav`。本地位于 `output/vocabulary-audio/yilin-2024-7a-direct-v1/`，上传到云存储同名目录 `vocabulary-audio/yilin-2024-7a-direct-v1/`。
- 另有 206 个仍被现有基础词库和错题释义使用的共享读音，已从旧合辑迁移到 `output/vocabulary-audio/shared-current-direct-v1/`，上传到云存储 `vocabulary-audio/shared-current-direct-v1/`。
- 两个新目录上传并部署新版 `quickstartFunctions` 后，云存储中的旧目录 `vocabulary-audio/v1/` 与 `vocabulary-audio/sprites-v1/` 才可以删除。不要删除 `beginner-direct-v1`、`molly-ket-direct-v1`、`sprites-beginner-v1` 或 `sprites-extra-v1`。
- 完整性检查：`node tools/validate-yilin-2024-7a-vocabulary.js`、`node tools/validate-vocabulary-audio-sprites.js`。

## 法语学习（Phase 2）

- 老师端始终可从首页进入法语学习，并使用独立的老师进度。
- 学生端仅在该学生的 `frenchLearningEnabled` 为 `true` 时显示入口；云函数也会再次校验权限。
- 当前内容为 CEFR 对齐的编辑性课程（不是官方固定词表）：A1 词汇 180、A2 词汇 220、语法 34、表达 56、阅读 18、句子搭建 28；新增跟读 68 条，另保留旧版 30 条句子。
- 单词页提供法语发音、中文义、词性、性别、IPA 和四级间隔复习。
- 句子页只播放示范音频并记录“我跟读了”，不请求录音或麦克风权限。

旧版 90 个本地 MP3 位于 `output/french-audio/v1/`（该目录不纳入 Git）。如果修正 v1 音频，修正只会留在本地，必须由人工在 CloudBase 覆盖同名对象后才会影响云端。当前 manifest 已回填全部 572 个 File ID（90 个 v1 + 482 个 v2），并通过本地严格校验。正式使用前仍需要：

1. 人工试听并确认法语发音。
2. 如尚未操作，把 `output/french-audio/v1/words` 和 `output/french-audio/v1/sentences` 上传到云存储中的同名 `french-audio/v1/...` 路径。
3. 后续新增音频时，保存完整上传路径清单，再按 `tools/french-audio/README.md` 的安全流程回填新 File ID。
4. 每次音频清单变化后运行 `node tools/french-audio/validate-content.js --strict-audio --strict-cloud`。
5. 云函数上传、部署和老师/学生端预览仍需另行人工执行与确认；本文不宣称已部署。

音频生成方式、模型校验值和许可归属见 `tools/french-audio/README.md` 与 `tools/french-audio/ATTRIBUTION.md`。
代码回归可运行 `node tools/validate-french-learning.js` 和 `npm --prefix cloudfunctions/quickstartFunctions run test:french`。

`papers` 作为课程资料集合使用，每条资料类似：

```js
{
  studentId,
  lessonId,
  title,
  type, // pdf / image / audio / canva
  fileID,
  fileName,
  fileSize,
  createdAt
}
```

## 老师 openid 配置

先复制 `cloudfunctions/quickstartFunctions/config.example.js` 为同目录下的 `config.js`，再在本地 `config.js` 中填写教师 OpenID、教师访问码、学生访问码和订阅模板 ID。`config.js` 已被 Git 忽略，不得提交到 GitHub：

```js
teacherOpenIds: ["朱老师的 openid"]
```

修改后需要重新上传并部署 `quickstartFunctions` 云函数。

## 课后任务单次提醒

家长可在学生端的单节课详情页主动开启一次提醒。授权成功后，如课后任务仍未完成，系统会在下一个香港时间 18:00 使用“日程提醒”模板发送一次通知。长期订阅提醒和上课预约功能均已移除。

提醒代码更新后需要：

1. 重新上传并部署 `quickstartFunctions`（云端安装依赖）。
2. 创建并部署 `lessonReminder`（云端安装依赖）。
3. 上传 `lessonReminder/config.json` 中的定时触发器，确认 `lessonReminderEveryMinute` 已启用。
4. 在云函数配置中确认 `lessonReminder` 超时时间为 60 秒。
