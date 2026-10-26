#!/usr/bin/env python3
"""Submit new articles only; draft by default, explicitly publish as site owner."""
import argparse
import copy
import http.cookiejar
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_SITE = "https://blogs.chipubliclinks.online"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward a credential to a redirect target.


def site_url(value):
    parsed = urllib.parse.urlsplit(value)
    local = parsed.hostname in {"127.0.0.1", "localhost", "::1"}
    if (parsed.scheme not in {"http", "https"} or not parsed.hostname
            or (parsed.scheme == "http" and not local)
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in {"", "/"}):
        raise ValueError("站点须为 HTTPS 根地址（仅本机允许 HTTP），不得含账号或查询参数")
    return value.rstrip("/")


def unique_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("JSON 包含重复字段")
        result[key] = value
    return result


def load_articles(paths, publish):
    result, ids = [], set()
    for path in paths:
        data = Path(path).read_bytes()
        if len(data) > 2 * 1024 * 1024:
            raise ValueError("JSON 文件超过 2 MiB")
        obj = json.loads(data, object_pairs_hook=unique_keys)
        if not isinstance(obj, dict) or set(obj) != {"article"} or not isinstance(obj["article"], dict):
            raise ValueError("每个文件须为 {\"article\": {...}}")
        article = copy.deepcopy(obj["article"])
        aid = article.get("id", "")
        if not isinstance(aid, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,79}", aid):
            raise ValueError("文章 ID 不合法")
        if aid in ids:
            raise ValueError("批次中存在重复 ID")
        ids.add(aid)
        if article.get("status", "draft") != "draft":
            raise ValueError("输入稿须为 draft；发布必须显式加 --publish")
        if publish:
            for field in ("title", "description", "sources", "publishedAt", "verifiedAt"):
                if not article.get(field):
                    raise ValueError("发布稿缺少必要字段：" + field)
            if not article.get("body") and not article.get("sections"):
                raise ValueError("发布稿缺少正文")
        article["status"] = "published" if publish else "draft"
        result.append(article)
    return result


def submit(site, articles, publish, token):
    if not token or any(ord(c) < 33 or ord(c) > 126 for c in token):
        raise ValueError("请在私密终端设置有效的 ADMIN_TOKEN（发布）或 API_TOKEN（草稿）")
    cookies = http.cookiejar.CookieJar()  # Memory only, never save cookies to disk.
    opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPCookieProcessor(cookies))

    def request(path, payload, bearer=False):
        headers = {"Content-Type": "application/json", "Origin": site,
                   "X-Requested-With": "model-insight"}
        if bearer:
            headers["Authorization"] = "Bearer " + token
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(site + path, data=data, headers=headers, method="POST")
        try:
            with opener.open(req, timeout=40) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            # Do not echo response bodies: a misconfigured proxy could reflect secrets.
            raise RuntimeError(f"HTTP {exc.code}：已停止；请到后台核对，不会自动重试或覆盖") from None
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            raise RuntimeError("连接或响应异常：保存状态不确定；请先到后台核对，勿直接重试") from None

    authenticated = False
    try:
        if publish:
            response = request("/api/admin/login", {"token": token})
            if response.get("authenticated") is not True:
                raise RuntimeError("登录未确认，已停止")
            authenticated = True
        for article in articles:
            route = "/api/admin/articles" if publish else "/api/ingest/articles"
            response = request(route, {"article": article}, bearer=not publish)
            saved = response.get("article", {})
            if saved.get("id") != article["id"] or saved.get("status") != article["status"]:
                raise RuntimeError("响应与提交内容不符；请到后台核对，勿直接重试")
            print(f"{saved['status']}: {saved['id']}", flush=True)
            if publish:
                print(f"{site}/a/{saved['id']}", flush=True)
    finally:
        if authenticated:
            try:
                request("/api/admin/logout", {})
            except RuntimeError:
                print("警告：登出未确认，会话将按服务端期限失效", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="+", help="One {article: ...} JSON file per article")
    parser.add_argument("--site", default=os.environ.get("SITE_URL", DEFAULT_SITE))
    parser.add_argument("--publish", action="store_true", help="Owner-only: publish using ADMIN_TOKEN")
    parser.add_argument("--check", action="store_true", help="Check local files only; no network or credential needed")
    args = parser.parse_args()
    try:
        site = site_url(args.site)
        articles = load_articles(args.files, args.publish)
        if args.check:
            print(f"本地结构检查通过：{len(articles)} 篇（不代表服务端校验或发布成功）")
            return 0
        token = os.environ.get("ADMIN_TOKEN" if args.publish else "API_TOKEN", "")
        submit(site, articles, args.publish, token)
        return 0
    except (ValueError, OSError, RuntimeError) as exc:
        print(f"未完成：{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
