# luci-theme-unifi

[English](../README.md) · [安装](#安装) · [开发指南](development.zh-CN.md)

为 OpenWrt 和 ImmortalWrt 制作的 UniFi 风格主题，提供实时仪表盘、客户端列表和浅深色模式。

## 预览

<p>
  <a href="images/dashboard.png"><img src="images/dashboard.png" alt="浅色仪表盘" width="960"></a>
</p>

<p>
  <a href="images/clients-dark.png"><img src="images/clients-dark.png" alt="深色客户端列表" width="960"></a>
</p>

<p>
  <a href="images/login.png"><img src="images/login.png" alt="登录页面" width="960"></a>
</p>

## 功能

- **仪表盘**：查看接口流量、CPU、内存、运行时间和网络状态，可选后台采样，在内存中保留最近 1 小时的记录。
- **客户端设备**：支持搜索、筛选、设备详情、自定义列及 CSV 导出，内置离线厂商识别提示。
- **浅深色外观**：跟随系统或手动切换，适配桌面和手机。
- **LuCI 集成**：紧凑导航栏、独立登录页和内置主题设置，保留原生配置页面与认证流程。

## 兼容性

已在使用 ucode 模板的 LuCI 上测试 ImmortalWrt 23.05.4、24.10.6 和 25.12.2。

- **23.05、24.10** 使用 `opkg`，安装下方 IPK。
- **25.12** 使用 `apk`。使用 CI 和后续 Release 构建的 APK。已在 25.12.2 x86-64 容器中检查安装、升级、卸载、模板、服务及浏览器页面加载。

依赖：`luci-base`、`luci-theme-bootstrap`、`luci-mod-status`、`ucode-mod-uloop`、`iputils-arping`，安装时由包管理器从固件软件源获取。

## 安装

1. 从 [Releases](https://github.com/mouse233/luci-theme-unifi/releases) 下载 IPK（23.05/24.10）或 APK（25.12）。开发版可在 [Actions → CI](https://github.com/mouse233/luci-theme-unifi/actions/workflows/ci.yml) 的成功运行中下载 `luci-theme-unifi-…` artifact，解压后取出对应软件包。
2. 将软件包上传至路由器 `/tmp/`。
3. 通过 SSH 在路由器上执行：

```sh
opkg update
opkg install /tmp/luci-theme-unifi_*.ipk
```

ImmortalWrt 25.12 改为执行 `apk update` 和 `apk add --allow-untrusted /tmp/luci-theme-unifi-*.apk`。已有 Release 可能只有 IPK；在下一个 Release 前可从 CI 获取 APK。

在 **系统 → 系统 → 语言和界面** 中选择 **Unifi**，保存并应用。安装主题不会自动切换当前外观。

在 **系统 → Unifi 主题设置** 中调整外观、刷新间隔、分页和导航栏。“总是采样网络活动”默认开启，关闭仪表盘仍会采集；历史仅保存在内存中，路由器或采集服务重启后清空。

**升级**：直接安装新版本，保留当前主题及 `/etc/config/unifi` 中的设置。从 1.0.1 及更早版本升级时，需要先切换一次其他主题，安装后再选回 Unifi；这些旧版已安装的卸载脚本会拦截正在使用 Unifi 时的升级。

**卸载**：执行以下命令；如果正在使用 Unifi，会自动切换到 Bootstrap。1.0.1 及更早版本仍需先手动切换主题。

```sh
opkg remove luci-theme-unifi
```

ImmortalWrt 25.12 使用 `apk del luci-theme-unifi`。

备份及通过 SSH 恢复主题的方法见[开发指南](development.zh-CN.md#恢复与卸载)。

## 客户端在线探测原理

后台结合以下证据判断状态，仅覆盖单个 LAN 的 IPv4 设备：

```mermaid
flowchart LR
    A["设备清单<br/>每30秒更新<br/>租约 / 静态配置 / ARP"] --> B["内核 REACHABLE<br/>绑定信任60秒"]
    A --> C["可信 IP/MAC<br/>包计数增长<br/>每10秒检查"]
    A --> D["ARP串行探测<br/>每秒调度<br/>2秒超时"]
    B --> E["在线；失败清零<br/>60秒后再探测"]
    C --> E
    D -->|IP/MAC匹配；信任120秒| E
    D -->|连续3次超时；间隔60秒| F["离线<br/>120秒后重试"]
```

设备初始状态为未知；租约或历史 ARP 记录本身不代表在线。地址绑定冲突会排除设备，命令执行错误不计为探测超时。探测排队和新的在线证据会影响实际判离线时间。

## 性能开销实测

在 **Intel N100（QEMU 虚拟机，4 个 vCPU）、ImmortalWrt 23.05.4** 上连续实测 3 分钟，期间约有 1,500–2,500 条连接、33 台被跟踪设备。

| 后台任务 | 单核平均 CPU 占用 |
| --- | --- |
| 网络活动采样（每秒一次） | **0.09%** |
| 客户端在线检测 | **0.96%** |

100% 表示占满一个 CPU 核心。两项合计约占**四核总算力的 0.26%**；实际开销会随设备和连接数变化。

大 JS 资源也进行了测量：使用 **Apple M1 / Chrome 157** 从路由器下载，**禁用浏览器缓存，共测10次**。响应均未压缩，下表为资源加载耗时的中位数，不包含其余页面加载。

| 资源 | 大小 | 下载并读取文本 | 浏览器解析／编译 |
| --- | --- | --- | --- |
| `vendor-data.js` | 约1.30 MB | **55.6 毫秒** | **6.6 毫秒** |
| `icon-data.js` | 约239 kB | **10.8 毫秒** | **0.8 毫秒** |

解析／编译发生在 Apple M1 客户端浏览器上；手机浏览器和完整首次页面加载尚未测量。

## 本地预览与开发

无需路由器，使用 Python 3.9+ 即可预览：

```sh
python3 tools/preview_server.py
```

打开 [127.0.0.1:8765](http://127.0.0.1:8765/)。预览使用虚构数据，不连接路由器。

本地打包、SDK 构建、测试及标签发布见[开发指南](development.zh-CN.md)，版本变更见[更新日志](../CHANGELOG.md)。[反馈问题](https://github.com/mouse233/luci-theme-unifi/issues/new/choose)时，请提供 OpenWrt 固件版本、描述问题表现，并按需附上截图。

## 许可与致谢

原创代码采用 [Apache-2.0](../LICENSE) 许可。

感谢以下项目与数据来源，第三方素材保留各自的许可与权利：

- LuCI Bootstrap（模板）：[项目仓库](https://github.com/openwrt/luci/tree/master/themes/luci-theme-bootstrap)
- Inter（字体）：[项目主页](https://rsms.me/inter/) · [OFL 许可](../htdocs/luci-static/unifi/fonts/LICENSE.txt)
- Simple Icons（图标）：[项目主页](https://simpleicons.org/) · [CC0 许可](../root/usr/share/licenses/luci-theme-unifi/Simple-Icons-CC0.txt)
- IEEE Registration Authority（MAC 前缀数据）：[官方网站](https://standards.ieee.org/products-programs/regauth/)

UniFi 字标：[权利说明](../htdocs/luci-static/unifi/login-wordmark.NOTICE)。

UniFi 为 Ubiquiti Inc. 的商标。本项目为独立社区主题，与 Ubiquiti、OpenWrt 或 ImmortalWrt 无隶属关系。
