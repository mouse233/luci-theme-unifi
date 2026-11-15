# 开发指南

[返回 README](README.md) · [English](development.md)

## 备份当前主题选择

首次安装前，保存 LuCI 配置和原主题路径。以下命令会保留同名的已有备份：

```sh
[ -s /root/luci-theme-before-unifi ] || \
  uci -q get luci.main.mediaurlbase > /root/luci-theme-before-unifi
[ -f /root/luci-config-before-unifi ] || \
  cp -p /etc/config/luci /root/luci-config-before-unifi
```

## 本地预览

在仓库根目录执行，需要 Python **3.9 或更新版本**：

```sh
python3 tools/preview_server.py
```

打开[本地预览](http://127.0.0.1:8765/)。顶部选择器可以切换仪表盘、客户端设备、原生概览、接口、主题设置、登录页和组件；也可直接打开[登录预览](http://127.0.0.1:8765/?page=login)。

预览服务仅监听 `127.0.0.1`，加载主题实际资源和虚构数据，不连接路由器。设置保存只模拟写入浏览器存储，登录预览会阻止凭据提交。按 Ctrl+C 停止服务。

使用 `?page=overview&lang=en`、`?page=clients&lang=en` 或 `?page=login&lang=en` 可查看英文预览。保持预览服务运行并安装 Google Chrome 后，执行 `node tools/capture_screenshots.cjs`，即可用 Chrome 原生字体渲染更新中英文 README 的 1920×1080 截图。

## 开发与构建

### 本地生成 IPK

使用 Python 3.9 或更新版本，在仓库根目录执行：

```sh
python3 tools/build_package.py
```

生成文件位于被 Git 忽略的 `artifacts/packages/`：

- `luci-theme-unifi_<version>-1_all.ipk`：可安装的软件包。

本地打包器仅依赖 Python 标准库，收录静态资源、LuCI JavaScript 和 ucode 源码，不包含本机二进制。打包成功不代表已经通过目标固件 SDK 验证。

使用 `python3 tools/build_apk.py --apk /path/to/immortalwrt-sdk/staging_dir/host/bin/apk` 构建 ImmortalWrt 25.12 APK。该工具使用与 IPK 相同的文件及安装脚本，并调用 ImmortalWrt 25.12.2 SDK 中的 Linux x86-64 `apk` 工具。

### 使用 OpenWrt SDK 或源码树

将仓库放入 OpenWrt 源码树或 SDK 的 `package/luci-theme-unifi`，并确保 `feeds/luci` 已配置 LuCI feed。在构建配置中选择 `luci-theme-unifi`，随后从 SDK 或源码树根目录执行：

```sh
make package/luci-theme-unifi/compile V=s
```

在 ImmortalWrt 25.12 SDK 中，LuCI 构建规则会生成 `luci-theme-unifi-<version>.apk`；测试环境可使用 `apk add --allow-untrusted` 安装。SDK 构建不接受本项目默认的开发版本号，从未打标签或工作区有改动的源码构建时，请传入正式格式的 `PKG_VERSION`，例如 `make package/luci-theme-unifi/compile PKG_VERSION=1.0.2 V=s`。

### 路由器容器检查

兼容性也会通过 OrbStack 中的 ImmortalWrt x86-64 rootfs 镜像验证。导入 rootfs 压缩包，以 `/sbin/init` 和 `--privileged` 启动，并把容器地址直接配置到 `eth0`，不要保留固件默认的 `192.168.1.1` 网桥地址，否则映射的 HTTP 端口没有路由。将软件源指向可访问的镜像，安装软件包，设置 `luci.main.mediaurlbase=/luci-static/unifi`，再对映射端口运行带登录的 Playwright 检查。

### 运行测试

单元测试使用 Node.js 内置测试工具，无需安装 npm 依赖。本地验证使用 Node.js **22**：

```sh
node --test tests/*.test.cjs
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

安装 OpenWrt `ucode` 解释器后，可验证后台历史存储：

```sh
ucode tests/activity-store.uc
```

浏览器检查使用锁定版本的 Playwright，安装依赖及 Chromium：

```sh
npm ci
npx playwright install chromium
```

在另一个终端运行 `python3 tools/preview_server.py`，随后执行全部浏览器检查：

```sh
UCODE_BIN=/path/to/ucode npm run test:browser
```

`UCODE_BIN` 指向开发机上的 OpenWrt ucode 解释器，默认查找 `vendor/ucode/build/ucode`。CI 会构建固定提交的解释器，同时验证历史存储与模板编译。

可通过 `UNIFI_PREVIEW_URL` 和 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定预览地址及浏览器路径。报告和截图写入 `artifacts/`，不需要路由器凭据。

### 更新厂商数据

`tools/generate_brands.py` 生成三个纳入版本管理、完全离线的 LuCI 模块：

| 模块 | 内容 |
| --- | --- |
| `vendor-data.js` | IEEE MA-L、MA-M、MA-S 和旧 IAB 的全部前缀、紧凑排序索引及原始登记名称；名称和编号放在同一快照中 |
| `brand-map.js` | 已确认的组织匹配和目录唯一精确匹配，用来选择图标；厂商栏不替换成品牌简称 |
| `icon-data.js` | 经过验证的 SVG 路径文本，不是外部图片链接，也不是 Base64 图片 |

浏览器直接在紧凑字节数组里按 36、28、24 位顺序查找最长匹配，不为所有前缀创建对象。三个模块都记录快照标识。查不到登记信息时才采用主机名推测；约定的 `52:54:00` 前缀作为独立的 QEMU 虚拟网卡提示，其他本地管理地址不参与 IEEE 匹配。搜索支持关联品牌名，表格、详情及 CSV 保留原始登记名称。

```sh
python3 tools/generate_brands.py
python3 tools/generate_brands.py --check
python3 tools/generate_brands.py --refresh --audit-nmap
python3 tools/generate_brands.py --refresh --update-icons --audit-nmap
```

普通生成使用被忽略的 `vendor/brand-data/` 缓存，并验证 `tools/brand-data-sources.json` 中的 SHA-256；缺失的输入会下载。`--check` 不联网。只有 `--refresh` 才接受上游变化。加上 `--update-icons` 会选择 Simple Icons 最新稳定版，通过验证后更新 `tools/brand-data-config.json`。Nmap 和 OUI-Master-Database 均不参与运行时登记数据合并。

已确认映射位于 `tools/brand-definitions.json`。生成器读取固定版本的 Simple Icons 元数据和 selfh.st 目录：已确认的正则优先；只有 Simple Icons 名称或其声明别名的唯一规范化精确匹配能自动建立图标映射。部分名称匹配及歧义只进入候选报告，不更改原始厂商名称。候选搜索排除 Technology、Systems 等通用公司词。selfh.st 用于提供补充候选；当前仅支持路径的渲染器只自动嵌入 Simple Icons。采用候选时，在定义中增加经过核对的组织匹配和可用的 Simple Icons 标识，再重新生成。

`artifacts/brand-data/` 保存完整候选 JSON、前 200 个候选组织的 HTML 图标预览、不可用的已配置图标、注册表冲突、可选的 Nmap 差异和更新摘要。打开 HTML 预览会访问列出的上游图片源，这些预览链接不会安装到路由器。Nmap 名称差异常为缩写差异，不直接视为登记冲突。IEEE 同一注册表的重复前缀取最后一条，同一前缀跨 MA-S/IAB 时优先 MA-S，冲突均写入报告。生成器验证 CSV 行、输入最低规模和超过 5% 的缩减，防止下载不完整时替换快照；核实后的缩减可使用 `--allow-shrink`。

`Update vendor and icon data` Workflow 每月 2 日北京时间 11:23 运行，也支持手动触发。流程刷新数据、生成图标候选和 Nmap 报告、检查可复现性、运行单元/打包及客户端浏览器测试，再创建或更新 `automation/update-brand-data` 分支的 PR，不自动合并，也不更新已部署的路由器。报告保留 30 天。仓库需要允许 Actions 创建 PR；若需要生成的 PR 触发其他 Workflow，可配置可选的 `BRAND_DATA_TOKEN`，否则使用 `GITHUB_TOKEN` 并在创建 PR 前完成流程内的检查。

`tools/brand-data-summary.json` 记录生成文件校验和及覆盖统计。每个已收录图标的来源和可用的许可信息、图标库许可和免责声明打包在 `root/usr/share/licenses/luci-theme-unifi/`。没有可用 Logo 的厂商仍完整显示原始名称并支持搜索，使用通用图标。

### 目录与发布边界

| 路径 | 用途 |
| --- | --- |
| `htdocs/` | 安装到路由器的 CSS、JavaScript、字体与图形素材 |
| `ucode/` | LuCI 页头、页尾和认证模板 |
| `root/` | 主题注册、配置、菜单、ACL 和许可 |
| `preview/` | 本地预览及虚构数据 |
| `tests/` | 单元测试、浏览器检查及 `fixtures/reference/` 中的视觉基准 |
| `tools/` | 预览、打包、版本解析及厂商数据来源记录 |
| `docs/` | 用户与开发文档及预览截图 |
| `research/` | 被 Git 整体忽略的本地研究资料和内部记录 |

仅 `htdocs/`、`ucode/`、`root/` 提供路由器安装载荷。下载工具、生成包、原站采集内容、设备备份、实机部署证据及历史本地笔记，均由 [`.gitignore`](../.gitignore) 排除。提交内容和截图中请勿包含真实设备名称、地址、凭据或会话数据。

提交拟发布的代码后，可生成源码压缩包：

```sh
python3 tools/bundle_release.py
```

该工具只归档已经提交的 Git 源码树，并生成独立的源码校验和文件，不收录被忽略的本地采集内容或构建产物。IPK 应与源码包分别分发。

## 贡献与问题反馈

反馈问题时，请提供 OpenWrt 固件版本、描述问题表现，并按需附上截图。

请让修改范围保持集中，并运行相关检查。共享控件或布局变更应同时检查浅色、深色、桌面和手机宽度。欢迎提供兼容性反馈，请区分本地预览结果与路由器实机结果。

## 下载构建包

CI 在 Actions 的 ZIP artifact 中提供 IPK 和 APK，保留 30 天。后续 Release 将包含两种格式；旧版本可能只有 IPK。APK 的开发版及预发布版本号会经过编码以满足 apk 语法；升级时请使用正式版。

开发包的版本号低于正式版。如果需要用开发版替换已安装的正式版，请先卸载现有 Unifi 软件包，再安装开发版 IPK。卸载时若正在使用 Unifi，会自动切换到 Bootstrap。1.0.1 及更早版本仍需先手动切换主题再卸载。

## 版本与发布

发布版本以 Git 标签为唯一来源，源码无需重复维护当前版本号：

- `v0.9.0` → IPK 版本 `0.9.0-1`。
- `v0.9.0-rc.1` → IPK 版本 `0.9.0~rc.1-1`，GitHub 标记为预发布。
- 未打标签的提交 → `0~git<提交时间>.<提交号>-1`；工作区有改动时增加 `+dirty` 标记。
- 无 Git 信息的源码副本 → `0~dev-1`；可用 `python3 tools/build_package.py --version 0.9.0` 显式指定版本。SDK 构建可传入 `PKG_VERSION=0.9.0`。

`PKG_RELEASE` 仅表示软件包修订号。构建时，版本会写入 IPK 元数据、文件名和 LuCI 模板的资源缓存标识；模板使用 LuCI 原生的 `PKG_VERSION` 注释占位符，本地打包器和 SDK 均支持替换。

CI 在分支推送和 PR 时运行单元、打包、ucode 及全部浏览器检查，成功后上传 IPK artifact。推送版本标签会复用同一套检查，再将经过校验的 artifact 发布到 GitHub Releases。

以 `v0.9.0` 为例，发布步骤如下；应按实际版本替换：

1. 将 `CHANGELOG.md` 的待发布内容整理为 `## [0.9.0] - YYYY-MM-DD`，使用实际发布日期。
2. 提交并推送代码，确认 CI 通过。
3. 创建并推送标签：

```sh
git tag -a v0.9.0 -m "Release v0.9.0"
git push origin v0.9.0
```

Release workflow 会在测试前验证标签格式、标签是否指向当前提交，以及更新日志是否包含同版本的非空章节。该章节必须位于标签对应的提交中，仅修改默认分支不会改变已有标签的源码。发布附件仅包含可安装的 IPK；如果 GitHub Release 已经存在，workflow 会上传已验证的附件，并保留已有的发布说明。

## 恢复与卸载

在 LuCI 中选择之前的主题，或通过 SSH 恢复已备份的主题路径：

```sh
UNIFI_PREVIOUS_THEME="$(cat /root/luci-theme-before-unifi)" &&
  [ -n "$UNIFI_PREVIOUS_THEME" ] &&
  uci set "luci.main.mediaurlbase=$UNIFI_PREVIOUS_THEME" &&
  uci commit luci
rm -f /tmp/luci-indexcache.*
```

如果没有备份，可以切换到作为依赖安装的 Bootstrap：

```sh
uci set luci.main.mediaurlbase='/luci-static/bootstrap'
uci commit luci
```

如需卸载，执行以下命令；正在使用 Unifi 时会自动切换到 Bootstrap，已选择其他主题时则保留原选择：

```sh
opkg remove luci-theme-unifi
```

升级会保留当前主题。1.0.1 及更早版本已安装的卸载脚本会拦截正在使用 Unifi 时的升级和卸载，替换这些旧版本前仍需手动切换一次主题。切换主题不需要重启路由器或网络。

## 主题设置

| 设置 | 可选值 | 默认值 |
| --- | --- | --- |
| 外观模式 | 跟随系统、浅色、深色 | 跟随系统 |
| 客户端每页条数 | 10、25、50、100 | 50 |
| 客户端自动刷新间隔 | 5、10、30、60 秒 | 10 秒 |
| 仪表盘信息刷新间隔 | 1、2、5、10、30、60 秒 | 1 秒 |
| 默认展开导航栏 | 开启、关闭 | 关闭 |
| 总是采样网络活动 | 开启、关闭 | 开启 |

这些设置保存在 `/etc/config/unifi`，适用于所有浏览器。客户端自定义列仍作为浏览器偏好保存。登录页使用独立的固定深色背景。

网络活动每秒采样一次，曲线连续滚动，使用约 1 秒显示缓冲逐步展现已采集的线段。暂停更新、隐藏页面或启用系统“减少动态效果”时停止动画。“系统 → Unifi 主题设置”中的“总是采样网络活动”默认开启，后台持续采集，关闭网页后仍会记录。各接口最近 1 小时的数据只保存在采集进程的内存中；打开或刷新仪表盘时自动恢复历史，随后增量读取，不将流量历史写入闪存。关闭开关会停止采集并释放历史；重启路由器或采集服务也会清空。开关关闭时，仅在仪表盘打开期间采样。系统信息、接口状态和 DHCP 租约按“仪表盘信息刷新间隔”更新，默认 1 秒。

仪表盘和客户端数据采集为只读操作。主题设置权限仅允许写入 `unifi` 配置；原生 LuCI 配置页面继续使用原有写入权限。
