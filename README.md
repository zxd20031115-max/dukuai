# Market Lab · 网页试玩版

这是独立的纯前端版本，打开网站即可玩。保留 53 个品种、18 对外汇、最高 500 倍模拟杠杆、历史行情回放、委托、止盈止损、强平、虚拟充值、统计和记录导出。

原有 Node.js + SQLite 本地登录版仍然完整保留在另一份文件夹和压缩包里。本版本不包含、不会访问原版的账户数据库，也不会同步原版资金或持仓。

## 上传 GitHub 并生成网址

1. 解压 **market-lab-web-github-pages.zip**，进入里面的 `market-lab-web` 文件夹。
2. 在 GitHub 创建一个用于公开网站的仓库，例如 `market-lab-web`，选择 Public，可初始化 README。
3. 点击 **Add file → Upload files**，把该文件夹里面的文件和子文件夹一起拖进去。不要只上传 ZIP；仓库根目录应直接出现 `index.html`、`app.js`、`data`、`lib` 等。
4. 点击 **Commit changes** 完成上传。
5. 进入仓库 **Settings → Pages**，在 **Build and deployment** 中选择 **Deploy from a branch**。
6. 选择分支 **main**，文件夹 **/(root)**，点击 **Save**。
7. 等待部署完成后，Pages 页面会显示网站地址，通常为 `https://你的用户名.github.io/market-lab-web/`。打开该网址即可试玩，使用者不需要安装 Node.js，也不需要启动本地服务器。

所有资源都使用相对路径，支持 GitHub Pages 的仓库子目录。历史数据 `data/history.json` 约 14 MB，小于 GitHub 网页上传的单文件 25 MiB 限制。首次打开需要载入历史数据，请等待页面加载完成。

参考：[GitHub Pages 分支发布官方说明](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)。

## 浏览器里的保存方式

- 默认直接进入「浏览器试玩账户」，初始虚拟资金 100 万元，无注册和密码。
- 资金、持仓、委托、自选和回放进度写入当前网站的 IndexedDB，刷新后会恢复。
- 不同设备、浏览器或网站域名分别保存。清除网站数据、无痕窗口结束或浏览器清理存储，会失去该浏览器的存档。
- 「账户设置」或「委托与记录」可导出 JSON / CSV。导出用于保留和分析记录，目前没有导入恢复功能。
- 回放只在网页打开且可见时推进；关闭或隐藏页面不会补算离线时间。同一网站多个标签页共享存档，使用事务与互斥锁避免重复推进和相互覆盖。

## 数据与交易模型

随包提供 50 个品种的 Yahoo Finance 历史日线，范围为 2006—2025，上市较晚的品种从实际数据起点开始。共有 236,806 根有效日线；2,689 根异常 OHLC 已排除。逐个品种来源和覆盖见「学习中心」。三个普通基金是合成示例。

界面只显示当前回放日以前的数据；纯前端版本的完整历史文件可在浏览器内查看，适合随便练习。手续费 0.03%、滑点 0.015%，使用固定训练汇率和统一虚拟保证金合约，未模拟全部真实市场制度。具体规则见网页学习中心。

代码使用 MIT；历史数据不属于 MIT 授权，原始提供方保留相应权利与使用条款。全部资金与交易为模拟。

## 本地预览（开发时可选）

```sh
python -m http.server 4312
```

然后打开 `http://127.0.0.1:4312/`。不要直接双击 `index.html`：浏览器模块和历史数据需要通过 HTTP 或 HTTPS 加载。部署到 GitHub Pages 后只需打开网址。

## 验证

```sh
node --test tests/*.test.mjs
```

纯前端代码不需要安装依赖，也不需要构建。`tests/` 和 `package.json` 只供开发测试，网站运行不依赖它们。
