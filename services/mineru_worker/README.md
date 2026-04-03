# MinerU Worker

这个目录现在不是说明占位，而是一个可跑的 Python 适配服务骨架：

- `app.py`：接收云函数传来的文件临时链接
- `requirements.txt`：最小依赖

## 作用

小程序不会直接调用 MinerU，而是走这条链路：

1. 小程序上传文件到微信云存储
2. 云函数 `ocr` 创建任务
3. 云函数 `ocr` 调用本服务的 `/parse`
4. 本服务下载文件并转发给 MinerU 的同步接口 `/file_parse`
5. 云函数把真实 Markdown 回写到 `ocr_tasks`
6. 小程序轮询并显示结果

## 启动前准备

需要先准备一个可访问的 MinerU API 服务。根据 MinerU 官方 README，3.0 已提供 `mineru-api`，并保留同步解析接口 `POST /file_parse`；这是我这里对接的目标接口。来源：

- https://github.com/opendatalab/MinerU/blob/master/README_zh-CN.md

## 环境变量

- `WORKER_BEARER_TOKEN`：给云函数调用本服务用的鉴权令牌
- `MINERU_API_URL`：MinerU API 地址，例如 `http://127.0.0.1:8001`
- `MINERU_API_TOKEN`：如果你的 MinerU API 需要 Bearer Token，可选

## 本地启动

```bash
cd services/mineru_worker
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export WORKER_BEARER_TOKEN='replace-me'
export MINERU_API_URL='http://127.0.0.1:8001'
uvicorn app:app --host 0.0.0.0 --port 9000
```

## 云函数配置

把 [`cloudfunctions/ocr/config.js`](../../cloudfunctions/ocr/config.js) 改成类似这样：

```js
module.exports = {
  mode: 'http',
  provider: 'MinerU',
  requestTimeoutMs: 120000,
  service: {
    endpoint: 'http://你的服务器:9000/parse',
    bearerToken: 'replace-me'
  }
};
```

改完后重新部署 `cloudfunctions/ocr`。

## 当前限制

`app.py` 对 MinerU 返回结构做的是“尽量兼容”的 Markdown 提取。如果你的 MinerU 实际返回字段和这里不同，需要按真实返回体微调 `extract_markdown()`。
