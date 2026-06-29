# 朱老师英语课堂

这是一个基于微信云开发的英语课与英语错题本小程序。

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
  teacherName,
  subject,
  createdAt
}
```

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

在 `cloudfunctions/quickstartFunctions/config.js` 中填写朱老师 openid：

```js
teacherOpenIds: ["朱老师的 openid"]
```

修改后需要重新上传并部署 `quickstartFunctions` 云函数。
