# Housely Docs Mini Program

这是一个接入微信云开发的原生微信小程序原型，包含：

- 登录、修改头像、退出登录、注销账号
- 首页文件列表、空状态、批量删除、左滑删除
- 扫描/导入后上传云存储，创建 OCR 任务，轮询结果并回填 Markdown 草稿

## 目录

- `pages/auth/*`：登录注册与密码找回
- `pages/home`：首页文档列表
- `pages/editor`：扫描生成 Markdown
- `pages/profile*`：个人中心与账号安全
- `utils/account.js`：账号存储逻辑
- `utils/docs.js`：文档存储逻辑
- `utils/scanner.js`：扫描转 Markdown 适配层
- `cloudfunctions/ocr`：OCR 任务云函数
- `services/mineru_worker`：真实 MinerU HTTP 适配服务

## 云开发开通

第一次运行前，请在微信开发者工具里：

1. 点击工具栏里的“云开发”
2. 开通一个云开发环境
3. 选择当前小程序绑定该环境
4. 重新编译项目

当前项目已固定使用环境 ID：

- `homefind-5gvurhe3ed767f0f`

## 云函数部署

账号相关逻辑已经切到云函数 `auth`：

1. 在开发者工具左侧找到 `cloudfunctions/auth`
2. 右键 `auth`
3. 选择“上传并部署：云端安装依赖”
4. 等待部署完成后重新编译

当前云函数会处理：

- 注册
- 登录
- 获取密保问题
- 重置密码
- 修改密码
- 修改密保
- 修改头像
- 注销账号

OCR 任务还需要部署云函数 `ocr`：

1. 在开发者工具左侧找到 `cloudfunctions/ocr`
2. 右键 `ocr`
3. 选择“上传并部署：云端安装依赖”
4. 等待部署完成后重新编译

并且会把密码、密保答案改成哈希存储；你之前已经创建过的明文测试账号，也会在首次成功登录或校验后自动迁移。

## 数据集合

请先在微信开发者工具的“云开发”或云控制台里手动创建三个集合：

- `users`
- `documents`
- `ocr_tasks`

推荐现在改成下面这样：

- `users`：所有用户不可读写
- `documents`：仅创建者可读写
- `ocr_tasks`：仅创建者可读写

这样更符合当前代码结构：

- `users` 已经只通过云函数访问
- `documents` 仍由当前登录用户直接读写自己的文档

## 后续加固建议

当前版本已经适合原型演示和小范围试用。若准备长期使用，建议下一步做这几项：

1. 把 `users` 集合权限改成自定义安全规则，避免任意用户读取全部账号资料。
2. 用云函数处理注册、登录、修改密码、注销账号，避免密码逻辑直接暴露在前端。
3. 对密码和密保答案做哈希存储，不再以明文写入数据库。
4. 把 `config/ocr.js` 的演示模式关闭，改为真实 MinerU worker。

## 扫描转 Markdown 接入建议

小程序端不适合直接内置大型 OCR/文档理解模型，当前项目已经把 OCR 流程抽象成任务流：

1. 小程序选择文件
2. 上传到云存储
3. 云函数 `ocr` 创建任务到 `ocr_tasks`
4. 编辑页轮询任务状态
5. 任务成功后回填 Markdown

当前仓库默认仍是演示模式，但控制开关已经迁到服务端：

- [`cloudfunctions/ocr/config.js`](./cloudfunctions/ocr/config.js)
- `mode: 'mock'` 表示回填演示 Markdown
- `mode: 'http'` 表示调用真实 MinerU 适配服务

后续推荐接：

- `opendatalab/MinerU`：更适合 PDF / 文档转 Markdown
- `PaddlePaddle/PaddleOCR`：更适合图片 OCR 识别

真实 MinerU 接入说明见：

- `services/mineru_worker/README.md`
