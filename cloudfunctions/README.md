当前项目已接入以下云函数：

- `auth`：账号登录、头像、注销等账号能力
- `ocr`：OCR 任务创建、处理、查询
- `contentSafety`：调用微信内容安全 API 校验文档文本与图片
- `feedback`：意见反馈落库与邮件发送

使用前请在微信开发者工具中分别右键以下目录：

1. `cloudfunctions/auth`
2. `cloudfunctions/ocr`
3. `cloudfunctions/contentSafety`
4. `cloudfunctions/feedback`

然后选择“上传并部署：云端安装依赖”。

其中 `contentSafety` 已在 `config.json` 中声明：

- `security.msgSecCheck`
- `security.mediaCheckAsync`

用于满足小程序发布内容前的内容安全校验要求。
