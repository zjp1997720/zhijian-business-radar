# WorkBuddy做大做强

服务于 WorkBuddy 培训、订阅账号销售与企业 AI 落地的内部情报网站。基于 [KKKKhazix/AIHOT](https://github.com/KKKKhazix/AIHOT) 的采集、编辑与发布框架扩展，保留 MIT 许可及原作者版权声明。

## 产品边界

- 行业动态：采集官方产品更新、教育政策、采购公告与 Agent 生态变化，保留原文链接、真实日期及来源。
- 商业机会：区分采购、需求、渠道和案例；成交结果仅作为历史需求证据，未知截止时间不推算。
- 推荐选题：每日推荐最多 5 个有来源支持的题目，包含受众、角度、业务目标与证据缺口；不足时少给，7 天内按事件去重。
- 培训侧关注消息与市场机会。课程设计、知识块和资料包留在独立培训 Wiki；本站不生成对外报价或自动联系客户。

每天北京时间 08:00 生成雷达与行业日报。读者浏览页面不会触发模型调用；生成失败保留上次成功结果。

## 本地开发

需要 Node.js 24.11+、PostgreSQL 16/17。

```bash
npm ci
cp .env.example .env
# 编辑数据库连接、站点地址、模型配置及随机密钥
npm run db:migrate
node --env-file=.env scripts/seed.ts
npm run dev:api
npm run dev:worker
npm run dev:web
```

具体部署、模型配置与行业包说明见 [docs/deploy.md](docs/deploy.md)、[docs/customize.md](docs/customize.md)。本站使用的公开信源、验证范围及缺口见 [docs/radar-sources.md](docs/radar-sources.md)。

## 独立服务器部署

`deploy/install-systemd.sh` 适用于已准备好 Node.js、PostgreSQL、Cloudflare Tunnel 的独立 Ubuntu 环境。安装路径为 `/opt/zhijian-business-radar`；运行账号 `radar`，环境文件 `runtime.env` 必须只对运行账号和管理员可读。

1. 将源码放在 `app/`，安装依赖并构建 `apps/web`。
2. 准备数据库、运行迁移和 seed；把模型每日预算调到实际业务需要，未配置的付费采集服务预算设为零。
3. 准备 `runtime.env`、Node.js 和 tunnel token；配置 `ACCESS_USER`、强随机 `ACCESS_PASSWORD`、`SESSION_SECRET` 与 `SITE_URL`。
4. 运行安装脚本，核验 API、网站和登录网关，再启用 `radar-worker`。

API、网站和登录网关只监听本机。公网 tunnel 指向登录网关 `127.0.0.1:3400`，不能直接暴露内部网站或 API。登录后使用 HttpOnly、Secure 会话 Cookie；所有页面、API、RSS 与 MCP 均受访问保护。此版本采用一个团队共享访问账号，后台管理使用另外的密码。

每天 04:10 备份 PostgreSQL 到本机 `/var/backups/zhijian-business-radar`，保留 14 天。这是同机恢复副本；异机灾备需另行配置。

手动生成雷达：

```bash
node --env-file=/opt/zhijian-business-radar/runtime.env apps/worker/src/run-radar.ts
```

环境变量、密码和私人群聊材料不得提交到 Git。

## 验证

```bash
npm run typecheck
node --env-file=.env.test --test --test-concurrency=1 'tests/*.test.ts'
npm run build -w @aihot/web
node --test apps/web/tests/*.test.ts
node --test deploy/access-gateway.test.mjs
node scripts/smoke.ts --base http://127.0.0.1:3300
```

测试库名称必须以 `_test` 或 `_ci` 结尾，先运行迁移；模型测试使用本地 stub，不连接真实模型。公网还应分别验证匿名请求被阻止、登录后数据可见、手机页面没有横向溢出。

## 当前限制

公开网站的反爬与来源覆盖会影响结果完整性，不能保证覆盖所有全国采购、渠道和培训需求，也不将“未采集到”解释为“没有机会”。候选内容需要人工核对；不把厂商宣传或模型推断写成我方已验证业绩。
