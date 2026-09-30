# 商业信源发现

程序从有界官网列表与指定公开原文发现商业材料，再复用 AIHOT 的 `upsertMaterial`、URL 身份规则和 `queueProcessing`。它覆盖培训动向、采购公告、培训案例、同行培训产品与渠道自述；材料入库不代表当前存在可投标采购或已经核验厂商授权。

## 运行

```bash
# 默认只读网络，不连接数据库、不入库、不调用模型
node --env-file-if-exists=.env apps/worker/src/run-business-discovery.ts

# 显式入库并排入已有处理队列；后续模型处理使用现有服务与预算
node --env-file-if-exists=.env apps/worker/src/run-business-discovery.ts --write

# 指定来源，可以重复 --source；建议首次先单独检查历史种子
node --env-file-if-exists=.env apps/worker/src/run-business-discovery.ts \
  --source business-discovery-sic --source business-discovery-peer-channel-seeds

# 复核来源时忽略 next_fetch_at；仍尊重数据库 enabled=false
node --env-file-if-exists=.env apps/worker/src/run-business-discovery.ts --write --force-due

# 入库但不启动后续处理（操作人员自行决定何时排队）
node --env-file-if-exists=.env apps/worker/src/run-business-discovery.ts --write --no-queue

# 定向配置，支持绝对或当前目录下相对路径
node --env-file-if-exists=.env apps/worker/src/run-business-discovery.ts --config industry/business-discovery.json
```

输出一个 JSON run：requests、detailAttempts、accepted、每来源状态与错误。`accepted` 只含标题、原 URL、日期和正文长度。`status=partial/failed` 返回非零退出码，不能把错误当作完成。已经成功插入的材料不会因随后来源失败被丢弃。

正式执行、服务器验证及 systemd 调度由主 Agent 集成；此模块不自行修改服务器、定时任务或账户。执行器兼容每日 07:00/19:00 的 `--write` 调用。配置间隔代表最短抓取间隔，实际频率受定时器限制。

## 配置与预算

唯一配置是 `industry/business-discovery.json`。默认开启官网列表与历史种子；6 项定向 query 覆盖政府、工会、协会、园区培训、AI 办公采购和 WorkBuddy 代理同行，均为 disabled。query 的 `rssUrlTemplate` 是需替换的 operator-approved `.invalid` 占位地址，不会对它发请求。只有已确认可用且允许本项目用途的免费公开 RSS 查询入口才可填入并启用，无付费或反爬绕过回退。

| 限制 | 默认及硬上限 |
| --- | --- |
| 查询 | 每轮最多 6 个，每个最多 10 条 |
| 官网列表 | 最多 24 个来源，每列表最多 20 条匹配原文链接 |
| 原文请求 | 全轮最多 20，每源默认最多 4，硬上限 10 |
| 详情并发 | 最多 2 |
| 同 host 请求开始间隔 | 至少 1 秒，www 与裸域统一计数 |
| 请求预算 | 全轮最多 40 请求，硬上限 60 |
| 超时与字节 | 单请求 12 秒、1.5 MB；硬上限 20 秒、3 MB |
| 总时间 | 默认 180 秒，硬上限 300 秒 |

失败的正文请求也消耗预算。原文 HTTP 跳转每跳由既有 `guardedFetch` 校验，最多 3 跳，并共享请求超时和字节限制；主机间隔约束初始请求开始，跳转另有 SSRF 校验。单源到达 4 篇后报告 `detailCapped=true`，其余来源继续执行。已见 URL 在详情请求前跳过，因此下次可继续读取同列表更后的未见条目。总预算耗尽报告 partial；需要补齐种子时可以单独 `--source` 执行。

## 持续列表实测

2026-10-01（北京时间），本机通过项目 `guardedFetch` 进行了只读 HTTP 验证。下表记录实际原站响应；北京服务器的出口条件仍由主 Agent 独立实跑确认。网页搜索缓存时间不作为响应新鲜度依据。

| 来源/原站列表 | 结果与首屏范围 | 配置最短间隔 |
| --- | --- | --- |
| [东莞市总工会·工会新闻](https://dgzgh.dg.gov.cn/dgzgh/ghxw/list.shtml) | HTTP 200；6 个同域新闻详情链接；本轮无 AI 标题命中 | 360 分钟 |
| [甘肃经济信息网·公开招标](https://www.gsei.com.cn/html/1336/) | HTTP 200；前 20 个采购详情；本轮无 AI 标题命中 | 360 分钟 |
| [甘肃经济信息网·中标公示](https://www.gsei.com.cn/html/1337/) | HTTP 200；前 20 个成交详情；本轮无 AI 标题命中；指定天水公安 AI 办公成交原文可抓取 | 360 分钟 |
| [苏州工业园区教育局·通知公告](https://www.sipac.gov.cn/yqjyj/tzgg/common_list.shtml) | HTTP 200；15 个同栏目详情；本轮无 AI 标题命中 | 360 分钟 |
| [中国互联网协会·通知公告](https://www.isc.org.cn/category/7330.html) | HTTP 200；前 20 条可解析，原文正文与 `.new-tips` 日期可取 | 360 分钟 |
| [海睿数科·公司动态](https://www.hiruiai.com/news) | HTTP 200；10 个新闻详情链接，原文 `article.article-body` 和日期可取；来源为同行自述 | 360 分钟 |
| [中国政府采购网·地方公告](https://www.ccgp.gov.cn/cggg/dfgg/) | HTTP 200；前 20 个公告链接可解析；单条正文及 PubDate 可取；本轮无 AI 标题命中 | 120 分钟 |

没有将一次性文章当作持续列表。苏州园区两个猜测栏目地址实际返回首页，已弃用；列表配置校验标题和详情 URL 路径，空匹配或首页回退会失败。东莞 `index.shtml` 不是有效入口，配置使用经原站栏目导航验证的 `list.shtml`。

免费查询探索仅进行了 2 个替代请求：quoted `www.bing.com/search?format=rss` 的“人工智能/培训/工会”仍返回“人工”释义噪声；`cn.bing.com/search?format=rss` 的 WorkBuddy 培训有相关标题，但返回 XML 含仅个人非商业用途声明。两者均未配置为活动入口、未作为材料导入。Google News RSS 在北京不可达、Bing News format=rss 不是 XML、中国政府采购搜索页频繁访问拦截是已有运行证据，未继续反爬尝试。

## 历史与同行种子

配置 `seedUrls` 表示显式原文，不抓列表。这些链接仍通过同样的免费 HTTP、原文正文与相关性门槛；日期仅读原文，不能采用路径里的数字。它们写入 `backfill=curated-historical-seed`，并标注 `raw.businessDiscovery.historicalSeed=true`。活动已经结束的培训不升级为当前招标。

已配置：国家信息中心、淮安社保、龙岗城投、华中科技大学、岳阳科协、柳州中小企业服务中心、珠海人社，以及海睿渠道、Anspire 渠道、分呀合作与 gotoAI 培训产品公开页面。原始链接逐项保留在配置中，不另造发布日。

本机定向 dry-run 6 个原文请求：国家信息中心与 4 个同行渠道/产品页正文成功，Anspire 原页面日期为 2026-09-09，其余同行未知日期保持 null。国家信息中心原文发布日期显示 2026-09-21（URL 中 0923 不是发布日期），已配置 `.articleDetailsTop`；华科页面通用 Readability 未提取成功，原站已确认正文在 `.v_news_content`，配置已改为该容器。上述调整后，北京服务器首轮负责复核结果。

## 入库、日期和失败证据

来源 ID 全部以 `business-discovery-` 开头，kind 为 external。原文官网来源经配置显式设置 participationMode=editorial，可以进入原有出版/雷达流程；查询来源始终 isolated，等待人工或独立核验后的显式提升。数据库已暂停的来源不会被配置重新开启。

所有此类源 `first_party=false`、`site_fulltext=false`、`syndicate_fulltext=false`。这保留内部原文分析能力，并沿用公开摘要展示。同行 `sourceNature=peer-self-report` 和 `authority=publisher-self-report` 会保留在原始材料中，不能把官网自述变成腾讯官方授权、已验收效果或客户背书。政府、工会、协会等 nature 只标记发布者类型，引用或转述仍需机会分析区分。

详情入库需要：HTTP 200、HTML 正文、至少 200 字、正文中 AI/WorkBuddy/智能体等词与培训/采购/办公/渠道等业务词距离不超过 240 字。列表标题只能决定是否花一次原文请求，不能替代正文验证。正文未取得、反爬、跳到其他发布者、非 HTML 或无业务相关性均不入库。模板、附件、图片型正文和列表首屏以外内容不自动补抓。

日期证据优先来自原页面 PubDate/`article:published_time`/datePublished 等 meta、特定发布者日期容器、Article JSON-LD 或 article/main 的 time。dateModified、正文会议时间、URL 日期、RSS/索引 pubDate 都不能充当发布日期。无可靠日期时 publishedAt=null；发现时间单独保存，indexDateClaim 明确 indexDateTrusted=false。无时区的中国机构日期按 +08:00 解析；不可能日历值及超过未来 1 小时的声明不被采信。

原文 URL、请求 URL、列表/查询入口、sourceNature、query、日期依据、相关性命中和 runId 保存于 `raw.businessDiscovery`。`upsertMaterial` 与 queueProcessing 在同一事务内完成，队列失败不会留下下次跳过且永远未排队的半成品。已见 URL 全局跳过，不能宣称会持续重抓所有历史正文修订。

写模式每源 `fetch_runs.detail` 保存 found、seen、detailAttempts、verified、created、rejected、错误阶段/URL及时间。源失败时 last_ok_at 不更新，fail_count 增加、health=degraded；反爬错误不能当作成功。纯正文相关性不足记 rejected，与请求失败分开。dry-run 同样返回证据但不写数据库。持久化证据失败也写入返回 JSON 并令该源失败。

## 验证与边界

```bash
node --test tests/business-discovery.test.ts
npx tsc -p packages/backend
npx tsc -p apps/worker
npx tsc -p tests
```

16 项纯 stub 测试通过，覆盖预算/并发、单源公平、已见跳过、离线 dry-run、日期门槛、索引日期、正文相关性、反爬、列表回退、种子标记及跨发布者跳转。typecheck 通过。测试不连接数据库、不联网、不调用模型；真实 PostgreSQL 插入和北京出口由主 Agent 的隔离集成/服务器验收负责。

此程序是一组可复核来源的有界采样，不是全网全量发现。高频采购栏目 20 条首屏可能错过中间发布的 AI 公告；标题没有 AI 词但正文提及 AI 的条目不会花详情预算。扩大覆盖应新增确切栏目或调整已获授权的配置，不能宣称“没有新需求”。
