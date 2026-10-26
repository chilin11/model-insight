# 模型智见：固定发稿方法

- 站点：<https://blogs.chipubliclinks.online/>
- 后台：<https://blogs.chipubliclinks.online/admin>
- RSS：<https://blogs.chipubliclinks.online/rss.xml>

文章写入 VPS 的内容库，不改 `src/content.ts`，不需要 npm build，也不需要重新安装网站。程序更新与发稿是两回事。

## 1. 日常写稿：后台

登录后台 → 写新文章 → 保存草稿 → 补来源、发布日期与核验日期 → 预览 → 发布文章。

在 VPS 私密终端读取管理员密钥：

```sh
sudo sed -n 's/^ADMIN_TOKEN=//p' /etc/model-insight.env
```

密钥只粘贴到自己的 HTTPS 后台登录框，不发给 AI，不贴进聊天或 GitHub。现有文章先打开再编辑；不要通过“新建”覆盖旧 ID。

## 2. AI 自动投递：已有 API，只能草稿

```text
GET  https://blogs.chipubliclinks.online/api/ingest/ping
POST https://blogs.chipubliclinks.online/api/ingest/articles
Authorization: Bearer <API_TOKEN>
Content-Type: application/json
```

请求示例：

```json
{
  "article": {
    "id": "my-unique-article-id",
    "status": "draft",
    "title": "标题",
    "body": "## 正文\n\n内容。"
  }
}
```

成功返回 HTTP 201 和保存后的 article。完整字段见 [API.md](API.md)，可直接复制 [ai-draft.json](../examples/ai-draft.json)。AI 不得使用管理员密钥；`status: published` 会被草稿接口拒绝。

在 VPS 终端可读取 API_TOKEN 到子进程环境，**不打印密钥**：

```sh
# 在 article.json 所在目录执行；仅用于草稿。
(
  set +x
  export API_TOKEN="$(sudo sed -n 's/^API_TOKEN=//p' /etc/model-insight.env)"
  test -n "$API_TOKEN" || exit 1
  python3 submit-article.py article.json
)
```

此处的 submit-article.py 是下面第 3 节的工具。也可以直接用 curl 调用 API，但请勿启用 shell 调试输出或把密钥直接写进命令历史。

## 3. 站长批量发稿：Python 标准库脚本

工具位于 [`scripts/submit-article.py`](../scripts/submit-article.py)，需要 Python 3，无额外依赖。先把脚本与 JSON 稿件复制到 VPS 的私有目录（例如 `~/model-insight-posts/`），检查文件后再执行。内容文件放本地 `data/editorial/`（Git 已忽略），不要提交到公开源码仓库。

```sh
# 仅检查结构，不联网、不需要密钥；发布必填项也一起检查。
python3 submit-article.py --check --publish article-1.json article-2.json

# 默认只新增草稿；需 API_TOKEN 环境变量。
python3 submit-article.py article-1.json article-2.json

# 由站长明确执行发布；密钥仅进入临时子进程环境。
(
  set +x
  export ADMIN_TOKEN="$(sudo sed -n 's/^ADMIN_TOKEN=//p' /etc/model-insight.env)"
  test -n "$ADMIN_TOKEN" || exit 1
  python3 submit-article.py --site http://127.0.0.1:8188 --publish article-1.json article-2.json
)
```

`--publish` 使用现有管理员登录 / 新建接口，不是新增权限更大的 AI 接口。它只在发送时将 draft 改为 published，不修改本地 JSON。Cookie 只存内存，最后请求登出。默认站点为正式域名，`--site` 可指定其他站点；公网必须 HTTPS，拒绝带凭据的 URL 和 HTTP 重定向。

- 每个 JSON 格式为 `{"article":{...}}`，原稿状态必须 `draft`，使用唯一 ID。
- **仅新增，不覆盖、不删除、不改首页头条。** 已存在 ID 返回 409 后停止。
- 每篇成功会打印状态与链接。批量不是事务：前面成功的文章不会因后面的失败而撤销。
- 超时或 HTTP 错误不自动重试；先在后台核对哪些已经保存，再单独提交未保存的稿件。不要为了绕过 409 随便换 ID，否则可能重复发稿。
- `--check` 只是本地结构检查，服务端还有完整字段与来源校验。
- 发布后检查公开 `/api/articles`、文章 `/a/<id>` 和 RSS；不要只看脚本退出码。

## 4. 给下次 AI 会话的固定任务说明

> 项目在 `/Users/chi/Documents/ai model news`，网站 https://blogs.chipubliclinks.online/ 。先读 docs/PUBLISHING.md 与 docs/API.md。根据真实可读原始来源写稿，每篇生成一个 `{article: ...}` JSON，存 data/editorial/，status=draft，正文用 Markdown，附作者/楼层/原帖链接，区分社区经验和编辑观点。不得把少数回复写成共识，不编造本站实测或当前价格。不要改 seed，不上传稿库、研究原文与密钥。默认通过独立 API_TOKEN 投草稿，站长审核发布；直接发布须用户明确授权并由已有登录会话或站长在 VPS 执行 --publish，不索要明文 ADMIN_TOKEN。
