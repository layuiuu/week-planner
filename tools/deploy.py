"""把本项目发布到 GitHub Pages(通过 GitHub REST API 提交)。

为什么不用 git push:
  本机到 github.com 的 443 端口是被网络挡住的(github.com / raw.githubusercontent.com 超时),
  但 api.github.com 可以访问。所以这里走 API:建仓库 → 一次性提交全部文件 → 开启/更新 Pages。

凭据从 Git Credential Manager 里读(就是本机已保存的 GitHub 登录),不需要在这里填 token。

用法:
  python tools/deploy.py             # 默认仓库名 week-planner
  python tools/deploy.py 别的仓库名   # 换一个仓库名

要求:python 3.8+,本机能访问 api.github.com,且 Git Credential Manager 里存着 GitHub 凭据。
"""

import base64
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = "https://api.github.com"
PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = sys.argv[1] if len(sys.argv) > 1 else "week-planner"
SKIP_DIRS = {".git", ".zcode", ".testdata", "__pycache__", "node_modules"}

# api.github.com 的真实 IP。部分网络会污染 DNS(把它解析到 127.0.0.1),
# 所以脚本会自己挑一个能连通的 IP 直接使用,SNI / 证书校验仍然是 api.github.com。
CANDIDATE_IPS = [
    "20.205.243.168",
    "140.82.112.6",
    "140.82.113.6",
    "140.82.114.6",
    "140.82.116.6",
    "140.82.121.6",
    "20.27.177.116",
]


def pin_api_dns():
    for ip in CANDIDATE_IPS:
        try:
            with socket.create_connection((ip, 443), timeout=4):
                pass
        except OSError:
            continue
        real_getaddrinfo = socket.getaddrinfo

        def patched(host, port, *args, **kwargs):
            if host == "api.github.com":
                return real_getaddrinfo(ip, port, *args, **kwargs)
            return real_getaddrinfo(host, port, *args, **kwargs)

        socket.getaddrinfo = patched
        print(f"连接 GitHub API:{ip}")
        return ip
    print("!! 没有可直连的 GitHub API IP,尝试用系统 DNS 解析")
    return None


def get_token():
    p = subprocess.run(
        ["git", "credential", "fill"],
        input="protocol=https\nhost=github.com\n\n",
        capture_output=True, text=True, timeout=20,
    )
    for line in p.stdout.splitlines():
        if line.startswith("password="):
            return line.split("=", 1)[1]
    raise SystemExit("没读到 GitHub 凭据。先在本机用它登录过一次 GitHub(Git Credential Manager)。")


TOKEN = get_token()


def api(method, path, payload=None, ok=(200, 201, 204)):
    url = path if path.startswith("http") else API + path
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode() if payload is not None else None,
        method=method,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "weekplanner-deploy",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read().decode() or "{}"
            return r.status, (json.loads(body) if body.strip().startswith(("{", "[")) else body)
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        if e.code in ok:
            try:
                return e.code, json.loads(body)
            except Exception:
                return e.code, body
        print(f"!! {method} {path} -> {e.code}\n   {body[:600]}")
        raise


def collect_files():
    files = []
    for root, dirs, names in os.walk(PROJECT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in sorted(names):
            full = os.path.join(root, name)
            rel = os.path.relpath(full, PROJECT).replace("\\", "/")
            with open(full, "rb") as fh:
                files.append((rel, fh.read()))
    return files


def main():
    pin_api_dns()
    _, me = api("GET", "/user")
    login, uid = me["login"], me["id"]
    print(f"账号:{login}")

    status, repo = api("GET", f"/repos/{login}/{REPO}", ok=(200, 404))
    if status == 404:
        _, repo = api("POST", "/user/repos", {
            "name": REPO,
            "description": "周计划:导入周表生成每周框架,导入任务清单挂到板块,勾选完成、按周复盘。纯静态、零依赖,数据只存在本机。",
            "private": False,
            "has_wiki": False,
            "auto_init": False,
        })
        print(f"已创建公开仓库:{repo['full_name']}")
    else:
        print(f"仓库已存在:{repo['full_name']}")

    files = collect_files()
    print(f"待上传 {len(files)} 个文件")

    status, ref = api("GET", f"/repos/{login}/{REPO}/git/ref/heads/main", ok=(200, 404, 409))
    if status != 200:
        # 空仓库不能直接建 blob,先造一个初始提交
        api("PUT", f"/repos/{login}/{REPO}/contents/.gitkeep",
            {"message": "初始化仓库", "content": base64.b64encode(b"").decode()})
        _, ref = api("GET", f"/repos/{login}/{REPO}/git/ref/heads/main")

    tree = []
    for rel, blob in files:
        _, res = api("POST", f"/repos/{login}/{REPO}/git/blobs",
                     {"content": base64.b64encode(blob).decode(), "encoding": "base64"})
        tree.append({"path": rel, "mode": "100644", "type": "blob", "sha": res["sha"]})
        print(f"  + {rel}")

    parent = ref["object"]["sha"]
    _, parent_commit = api("GET", f"/repos/{login}/{REPO}/git/commits/{parent}")
    _, new_tree = api("POST", f"/repos/{login}/{REPO}/git/trees",
                      {"tree": tree, "base_tree": parent_commit["tree"]["sha"]})

    who = {"name": me.get("name") or login, "email": f"{uid}+{login}@users.noreply.github.com"}
    _, commit = api("POST", f"/repos/{login}/{REPO}/git/commits", {
        "message": "更新周计划",
        "tree": new_tree["sha"],
        "parents": [parent],
        "author": who,
        "committer": who,
    })
    api("PATCH", f"/repos/{login}/{REPO}/git/refs/heads/main", {"sha": commit["sha"]})
    print(f"提交完成:{commit['sha'][:8]}")

    source = {"source": {"branch": "main", "path": "/"}}
    status, pages = api("GET", f"/repos/{login}/{REPO}/pages", ok=(200, 404))
    if status == 404:
        _, pages = api("POST", f"/repos/{login}/{REPO}/pages", source)
        print("已开启 GitHub Pages")
    else:
        api("PUT", f"/repos/{login}/{REPO}/pages", source)

    print(f"\n线上地址:{pages.get('html_url') or f'https://{login}.github.io/{REPO}/'}")
    for i in range(24):
        time.sleep(5)
        try:
            _, b = api("GET", f"/repos/{login}/{REPO}/pages/builds/latest")
        except Exception:
            continue
        print(f"  构建:{b.get('status')} ({(i + 1) * 5}s)")
        if b.get("status") == "built":
            break
    print("完成。手机上打开上面的网址即可(可以先刷新一下)。")


if __name__ == "__main__":
    main()
