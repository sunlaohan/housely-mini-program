# 家物小记小程序

`家物小记` 是一个基于原生微信小程序 + 微信云开发实现的家庭资料管理工具，用来把家电说明书、缴费小票、联系人名片、户号纸条等零散纸质信息沉淀成可检索、可编辑、可长期保存的电子文档。

当前版本已经不是早期的“登录注册原型”，而是一套包含登录、OCR 建稿、文档管理、文档阅读、个人中心、反馈闭环的完整小程序流程。

## 当前功能

### 1. 登录与启动

- 启动页自动判断本地登录态
- 采用“纯用户名登录”方式，首次输入用户名会自动创建账号
- 登录页和“我的”页面均可查看“关于家物小记”

### 2. 文档管理

- 首页展示当前账号下的全部文档
- 支持按标题和正文内容搜索，标题命中会高亮显示
- 支持左滑删除、批量选择删除、空状态引导
- 使用自定义 TabBar 在“家 / 我的”两个主页面之间切换

### 3. OCR 建稿与编辑

- 支持从相册或相机选择图片，单次最多 6 张
- 图片会先上传到微信云存储，再创建 OCR 任务
- 支持多图识别、状态轮询、失败提示、稍后刷新结果
- 识别完成后自动生成文档标题、摘要和 Markdown 草稿
- 草稿可继续编辑后保存为正式文档

### 4. 文档阅读

- 文档详情页支持全文关键字搜索和命中高亮
- 支持自动滚动到首个命中位置
- 支持阅读字号放大 / 缩小
- 支持从详情页跳转回编辑页继续修改

### 5. 个人中心

- 支持内置头像、本地图片、微信头像三种换头像方式
- 支持意见反馈，并上传图片 / 视频附件
- 支持退出登录
- 支持注销账号，并联动清理本人 `documents`、`ocr_tasks`、`feedbacks`

### 6. 云端能力

- `auth` 云函数：登录建号、头像更新、注销账号
- `ocr` 云函数：创建任务、处理任务、查询结果
- OCR 支持 `mock`、`official`、`http`、`auto` 四种模式
- `auto` 模式下会优先尝试微信 OCR，失败时可回退到 HTTP OCR 服务或 mock 结果

## 页面结构

| 页面 | 路径 | 作用 |
| --- | --- | --- |
| 启动页 | `pages/launch/index` | 判断登录态并跳转 |
| 登录页 | `pages/auth/login/index` | 用户名登录 / 自动建号 |
| 首页 | `pages/home/index` | 文档列表、搜索、删除、添加 |
| 文档详情 | `pages/document/index` | 阅读、检索、调字号、跳转编辑 |
| 编辑页 | `pages/editor/index` | 图片上传、OCR 建稿、保存文档 |
| 个人中心 | `pages/profile/index` | 头像、关于、反馈、退出、注销 |

## 核心目录

- `components/*`：通用 UI 组件，如按钮、底部弹层、表单项、媒体上传等
- `custom-tab-bar/*`：自定义底部导航
- `utils/account.js`：登录态、头像、注销等账号逻辑
- `utils/docs.js`：文档的新增、查询、更新、删除
- `utils/scanner.js`：图片选择、上传、OCR 任务创建 / 轮询
- `utils/feedback.js`：反馈提交与附件上传
- `utils/about.js`：关于页视频 / 封面资源读取
- `cloudfunctions/auth`：账号相关云函数
- `cloudfunctions/ocr`：OCR 任务云函数
- `cloudfunctions/feedback`：反馈落库与邮件发送
- `services/mineru_worker`：可选的 HTTP OCR / MinerU 适配服务

## 快速开始

1. 使用微信开发者工具打开本项目。
2. 确认 `project.config.json` 中的小程序 `appid` 与你的开发环境一致。
3. 开通并绑定一个微信云开发环境。
4. 在开发者工具中右键部署以下云函数，选择“上传并部署：云端安装依赖”：
   - `cloudfunctions/auth`
   - `cloudfunctions/ocr`
   - `cloudfunctions/feedback`
5. 在云开发数据库中手动创建以下集合：
   - `users`
   - `documents`
   - `ocr_tasks`
   - `feedbacks`
6. 重新编译项目。

## 集合权限建议

- `users`：所有用户不可读写，仅通过 `auth` 云函数访问
- `documents`：仅创建者可读写
- `ocr_tasks`：所有用户不可直接读写，仅通过 `ocr` 云函数访问
- `feedbacks`：仅创建者可读写，后续可按实际运营流程继续收紧

## OCR 配置说明

OCR 配置文件位于 [`cloudfunctions/ocr/config.js`](./cloudfunctions/ocr/config.js)。

- `mock`：始终返回演示 Markdown，适合本地联调和界面演示
- `official`：调用微信官方 OCR，受配额和图片访问限制影响
- `http`：调用外部 HTTP OCR 服务，适合接入 MinerU 等真实解析能力
- `auto`：优先尝试微信 OCR，失败后按配置回退到 HTTP 服务或 mock 结果

当前仓库默认配置如下：

```js
module.exports = {
  mode: 'auto',
  provider: 'MinerU',
  requestTimeoutMs: 120000,
  fallbackToMockOnFailure: true,
  service: {
    endpoint: 'http://YOUR_SERVER_IP:9000/parse',
    bearerToken: 'replace-me'
  }
};
```

修改 OCR 配置后，请重新部署 `cloudfunctions/ocr`。

## 意见反馈邮件通知

“我的”页的意见反馈会写入 `feedbacks` 集合，并通过 [`cloudfunctions/feedback/config.js`](./cloudfunctions/feedback/config.js) 中的 SMTP 配置发送到 `1291362786@qq.com`。

首次启用前请完成以下配置：

1. 打开 QQ 邮箱并开启 SMTP 服务
2. 将 `cloudfunctions/feedback/config.js` 里的 `pass` 改成 QQ 邮箱 SMTP 授权码
3. 重新部署 `cloudfunctions/feedback`

未配置授权码时，反馈仍会保存到数据库，但页面会提示“反馈已保存，邮件待配置”。

## 关于页媒体资源

登录页和“我的”页面中的“关于家物小记”会从云存储读取视频和封面资源。若你使用的是新的云环境，需要：

1. 将关于页视频和封面图上传到自己的云存储
2. 更新 [`utils/about.js`](./utils/about.js) 中对应的 file ID

如果未配置成功，页面仍会回退到静态封面图展示。

## MinerU 接入

如果你希望把 OCR 结果切到真实的 Markdown 解析链路，而不是演示数据，可以：

1. 按 [`services/mineru_worker/README.md`](./services/mineru_worker/README.md) 启动 HTTP 适配服务
2. 在 `cloudfunctions/ocr/config.js` 中把 `mode` 改成 `http` 或保留 `auto`
3. 配置 `service.endpoint` 与 `service.bearerToken`
4. 重新部署 `cloudfunctions/ocr`

## 说明

- 当前鉴权已经简化为“用户名即登即建号”，不再维护传统注册 / 密码找回 / 密保流程
- 根目录无需额外安装 npm 依赖，云函数依赖由微信开发者工具在部署时安装
- 项目内的 OCR、反馈附件、头像等文件会写入微信云存储
