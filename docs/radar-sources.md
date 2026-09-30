# WorkBuddy做大做强：公开信源验证与覆盖边界

核验截止：**2026-10-01 00:20:15 +08:00**。本页只记录公开 URL、标题、文章日期与技术结果，不含群聊、客户文件、账户资料或私人信息。

## 当前默认配置

默认 11 个官方入口：7 个 `web_list`、2 个 `json_list`、2 个 `rss`。全部通过项目现有生产 collector 直连解析，得到有 URL、标题与发布日期的条目；不只依据搜索引擎摘要或 HTTP 200 判定成功。核验直接调用 `fetchWebList` / `fetchJsonList` / `fetchRss`，没有写数据库、触发模型、发送消息或发布数据。所有配置项同时经过 `unsupportedConfig` 核对。

官方来源每源首次导入最多 **6 篇**、回填窗口 **6 个月**，合计上限 **66 篇**。文末补充 1 个隔离的线索发现 RSS（另最多 6 篇），最终 12 源总上限 **72 篇**。实际按日期、内容过滤与可用条目数进一步减少。首次回填按原始日期归档，不当作今日新闻。采集无需 SocialData、公众号采集或 Jina 付费 key；GitHub 无令牌也可运行，但受其匿名限流约束。模型生成另有成本，由运行环境预算控制。

站内默认仅展示摘要与原文链接，所有信源 `site_fulltext=false`、`syndicate_fulltext=false`。以下数量为核验时解析器返回数，不等于最终入库数或精选数。

| 信源与类型 | 列表入口 | 本次解析数 | 原文样本标题与链接 | 来源发布日期（北京时间） | 首次上限 |
|---|---|---:|---|---|---:|
| WorkBuddy 官方更新日志 · `web_list` | [入口](https://www.codebuddy.cn/docs/workbuddy/Changelog) | 91 | [5.6.2 版本发布 🚀（2026-09-21）](https://www.codebuddy.cn/docs/workbuddy/Changelog#_5-6-2-版本发布-🚀-2026-09-21) | 2026-09-21（原文为日期） | 6 |
| 腾讯云产品公告 · `web_list` | [入口](https://cloud.tencent.com/announce) | 10 | [【大模型服务平台 TokenHub】&【智能体开发平台 ADP】& 【云开发 CloudBase】 关于腾讯云 DeepSeek-V4-Flash 0731 模型下线及自动切换的通知](https://cloud.tencent.com/announce/detail/2496) | 2026-09-30 11:17 | 6 |
| 教育部教育信息化工作月报 · `web_list` | [入口](https://www.moe.gov.cn/s78/A16/gongzuo/gzzl_yb/) | 20 | [2026年6月教育信息化和网络安全工作月报](https://www.moe.gov.cn/s78/A16/gongzuo/gzzl_yb/202608/t20260818_1447148.html) | 2026-07-20 08:37 | 6 |
| 教育部工作动态 · `web_list` | [入口](https://www.moe.gov.cn/jyb_xwfb/gzdt_gzdt/) | 20 | [顾红亮任华东师范大学党委书记](https://www.moe.gov.cn/jyb_xwfb/gzdt_gzdt/s78312/202609/t20260930_1452780.html) | 2026-09-30（列表为日期） | 6 |
| 中国政府采购网 · 中央采购公告 · `web_list` | [入口](https://www.ccgp.gov.cn/cggg/zygg/) | 20 | [某单位医疗设备物资采购项目Ⅱ公开招标公告](https://www.ccgp.gov.cn/cggg/zygg/gkzb/202609/t20260930_27435905.htm) | 2026-09-30 21:00 | 6 |
| 中国政府采购网 · 地方采购公告 · `web_list` | [入口](https://www.ccgp.gov.cn/cggg/dfgg/) | 20 | [城管辅助力量服务（综合网格十、十二）的公开招标公告](https://www.ccgp.gov.cn/cggg/dfgg/gkzb/202610/t20261001_27436976.htm) | 2026-10-01 00:10 | 6 |
| Dify 官方版本发布 · `json_list` | [入口](https://api.github.com/repos/langgenius/dify/releases?per_page=10) | 9 | [v1.17.1 - Bug Fixes and Improvements](https://github.com/langgenius/dify/releases/tag/1.17.1) | 2026-09-10 18:04 | 6 |
| 字节 DeerFlow 官方版本发布 · `json_list` | [入口](https://api.github.com/repos/bytedance/deer-flow/releases?per_page=10) | 2 | [v2.1.0 Release](https://github.com/bytedance/deer-flow/releases/tag/v2.1.0) | 2026-09-24 18:40 | 6 |
| OpenAI 官方新闻 · `rss` | [入口](https://openai.com/news/rss.xml) | 1239 | [Helping small businesses put AI to work](https://openai.com/index/helping-small-businesses-put-ai-to-work) | 2026-09-30 18:00 | 6 |
| Anthropic 官方新闻 · `web_list` | [入口](https://www.anthropic.com/news) | 10 | [Claude discovers a novel enzyme system with CRISPR-like repeats](https://www.anthropic.com/news/claude-discovers-novel-enzyme-system) | 2026-09-23（原文为日期） | 6 |
| Microsoft 官方博客 · `rss` | [入口](https://blogs.microsoft.com/feed/) | 10 | [New Microsoft data innovations unlock what only your business knows](https://blogs.microsoft.com/blog/2026/09/28/new-microsoft-data-innovations-unlock-what-only-your-business-knows/) | 2026-09-29 14:30 | 6 |

WorkBuddy 的版本页面采用 VitePress，采集器已兼容 `.vp-doc` 日期标题：版本及更新正文按锚点分节保存；无日期的子节不作为“今天新增”的依据。腾讯云按公告原始时间解析。GitHub Release 的正文直接来自公开 `body`，用 `summaryIsBody` 避免重复提取网页。

教育部月报采用原文 `PubDate`，不会把 URL 目录日期或月报所覆盖的月份当成发布日期。例如 6 月月报页面 URL 含 `202608`，但列表与原文元数据明确为 **2026-07-20**。Anthropic 列表只给日期；列表里的非业务条目还会经过相关性预筛。

## 中国培训需求与采购的独立原文证据

这部分用于确认需求确有公开依据，并说明阶段。以下单篇是核验样本，不伪装成已经由当前首页列表自动采集到的记录。

| 原文 | 原文日期 | 确认的事实与使用范围 |
|---|---|---|
| [黑龙江省教育厅黑龙江省基础教育培训团队人工智能素养提升培训中标（成交）结果公告](https://www.ccgp.gov.cn/cggg/dfgg/zbgg/202609/t20260918_27357976.htm) | 2026-09-18 18:22，原文 `PubDate` | 直连 HTTP 200。公告披露总中标金额 121.70 万元，并列出 AI 素养培训服务范围；这是已成交需求及同行服务证据，不能列为开放招标，也不是智见业绩。 |
| [人工智能高质量发展专题培训班竞争性磋商公告](https://www.ccgp.gov.cn/cggg/dfgg/jzxcs/202604/t20260417_26418172.htm) | 2026-04-17 01:03，原文 `PubDate` | 直连 HTTP 200。采购人为山东省工业和信息化厅机关，原文响应截止 2026-04-27；截至本次核验已过期，仅作企业培训需求与交易结构研究。 |
| [教育部介绍教师队伍建设有关情况和第42个教师节宣传庆祝活动图文直播](https://www.moe.gov.cn/fbh/live/2026/78355/twwd/202609/t20260904_1449210.html) | 2026-09-04，正文发言时间 | 直连 HTTP 200。教师工作司发言明确计划开展教师人工智能素养培训，包含线上课程与线下示范培训；这是主管部门公开需求信号，不等于采购公告或团队订单。 |

黑龙江公告可使用的短原文摘录：“黑龙江省基础教育培训团队人工智能素养提升培训”。对外研究内容不摘取其中的个人电话、邮箱或地址。

## 已知覆盖缺口

- **采购列表不是全国完整监测。** 中央与地方入口当前各返回首页 20 条；本次标题关键词过滤各命中 0 条，不能据此说没有 AI 采购需求。120 分钟轮询仍可能漏掉中间刷新后的公告，且本配置不翻页。默认关键词包括人工智能、智能体、大模型、AI、数字化、知识库、教师培训。非匹配标题但正文有相关需求的公告也可能漏采。
- 教育部工作动态包含很多无关消息，需预筛；月报更新滞后，适合作为需求结构证据，不假设每日有新消息。
- **同行服务商覆盖仍不足。** 默认已覆盖平台官方产品及开源供给；独立培训/陪跑服务商公开套餐、渠道和效果案例仍需补充可稳定解析的官网。未读公众号或社交图片不推断定价与效果，不把平台版本日志当作同行完整打法。
- WorkBuddy 更新日志不覆盖全部伙伴政策、订阅报价与商业渠道；相关官方页面如无日期、仅客户端渲染或缺少列表，应先核验再接入。
- 千问旧官方 RSS `https://qwenlm.github.io/blog/index.xml` 可读取 44 条，但最新样本为 2025-09-22 的 Qwen3Guard，已超默认 6 个月回填窗口，因此未配置成活跃来源。阿里、钉钉、扣子和火山引擎的主题与标签已保留，缺少可持续采集入口的部分不宣称已覆盖。
- 日期未知、仅有预告、附件未读或无法归因的效果保持材料缺口；没有补写未来文章。

## 定向采购检索的有限尝试

按最多 3 个候选、最多 10 分钟验证后停止，均未作为成功来源加入配置：

| 候选 | 公开入口或参数 | 实际结果 |
|---|---|---|
| 中国政府采购网关键词检索 | [search.ccgp.gov.cn/bxsearch](https://search.ccgp.gov.cn/bxsearch?searchtype=1&page_index=1&kw=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD)，实际请求含 2026-09-01 至 2026-10-01 日期条件 | HTTP 200，但正文标题为“频繁访问”，返回访问拦截页，未取得搜索记录；不能将状态码当成功。 |
| 全国公共资源交易平台 | [政府采购列表](https://deal.ggzy.gov.cn/ds/deal/dealList.jsp?HEADER_DEAL_TYPE=02)，并尝试 `dealList_find.jsp` 的 `DEAL_KEY=人工智能`、`DEAL_CLASSIFY=02` 查询 | 列表与查询均遇到 TLS EOF，未获得记录；查询接口字段未在有效响应中证明，不配置为有效 JSON 源。 |
| 浙江政府采购网 | [公告分类](https://zfcg.czt.zj.gov.cn/portal/category?categoryCode=ZcyAnnouncement&isGovernment=true) | HTTP 416，未取得列表或日期条目。 |

采购日报当前属于有限抽样，尚未达到持续按 AI/培训关键词全量检索的覆盖能力。未增加付费采集服务、绕过访问拦截或将历史成交填充成在招机会。

## 验收与运行口径

- `npx tsc -p industry` 通过；行业 JSON 均可解析，信源配置键全部支持。
- 六个分类技术 key、七个 itemType 和五维加权结构继续兼容；评分权重改为业务需求、证据与可行动性，精选门槛保留 T1=60、T1_5=65、T2=76，理解下限 50 未降低。新评分语义尚需用户标注样本校准，不宣称已经完成效果评估。
- 默认关闭模型榜与 Codex 重置模块。品牌改为WorkBuddy做大做强，使用新雷达图标；日报/周报/月报报头按业务主题重建。
- 私密运行实例须统一保护页面、RSS、API 与 MCP；条款文案不是访问控制的替代，外部部署由主任务负责。
- 本文证明公开入口与解析结果，不证明生产采集、模型生成、日报、选题或商业机会已经验收上线。


## 补充：免费 RSS 线索发现

在官方定向检索失败后，最多追加核验 2 个新闻检索 RSS 入口。Bing News 的 `format=rss` 响应无法通过 RSS/Atom 解析，因此未配置。Google News 中文 RSS 实际解析成功，返回 64 条有标题、链接及日期的线索，无采集密钥：

- [检索入口](https://news.google.com/rss/search?q=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD+%E5%9F%B9%E8%AE%AD+%E9%87%87%E8%B4%AD&hl=zh-CN&gl=CN&ceid=CN:zh-Hans)
- 样本：2026-09-30 11:54:47，北京时间；标题“8月银行AI项目动态：光大银行上亿元采购中高端AI算力，10家厂商中标苏州农商行AI外包 - 移动支付网”。这是 RSS 所给标题与时间，尚未核验原文事实。
- 另一条样本为 2026-09-28 14:48 的深圳技能培训公开征集新闻索引；具体是否包含 AI 培训、是否开放及条件均须回深圳政府原文核验，不能只看检索词认定相关。

`rss-google-demand-discovery` 设置为 `tier=T2`、`first_party=false`、**`participation_mode=isolated`**，只进入管理员的待核验素材，不进行业动态、精选、商业机会或每日选题，不触发正文提取和模型评审。每 360 分钟采集，初次最多 6 篇、窗口 6 个月。聚合链接编码后的跳转并不是官方公告 URL；没有完成原文核验前，保持隔离。后续只有核验官方原文、发布日期、阶段、截止时间和资格后，才可作为正式业务依据导入。

最终默认配置为 **11 个官方来源 + 1 个隔离线索来源**，共 12 个；首次导入总上限 **72 篇**。新增线索源不改变官方采购完整覆盖的缺口。

## 北京生产服务器复核（2026-10-01）

11 个官方来源均完成真实采集。Google News RSS 在本机核验成功，但北京服务器首次请求失败，生产已暂停该隔离来源，默认配置同样关闭。它不计入当前有效覆盖，不承诺已运行定向全网采购搜索。政府采购首页两路本轮均无相关词命中；另一次性导入了已核验的黑龙江教师 AI 培训成交原文，按 9 月 18 日真实日期归档，仅作为历史需求证据。
