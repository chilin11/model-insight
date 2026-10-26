export const categories = ['全部', '模型动态', '评测解读', '社区声音', '深度观点'] as const
export type Category = typeof categories[number]
export const models = ['全部模型', 'Kimi', 'OpenAI', 'Claude', 'DeepSeek', 'Qwen'] as const
export type ModelFilter = typeof models[number]
export type Source = { label: string; url: string; kind: 'official' | 'benchmark' | 'community' }
export type ArticleTable = { caption: string; columns: string[]; rows: string[][]; note: string }
export type ArticleChart = { title: string; unit: string; max: number; rows: { label: string; value: number }[]; note: string }
export type Article = {
  id: string
  category: Exclude<Category, '全部'>
  model: string
  tone: string
  title: string
  description: string
  time: number
  label: string
  status: 'draft' | 'sample' | 'published'
  publishedAt?: string
  verifiedAt?: string
  body?: string
  image?: { url: string; alt: string; caption?: string }
  commentsClosed?: boolean
  revision?: number
  createdAt?: string
  updatedAt?: string
  eventNote?: string
  takeaway: string
  highlight?: string
  sections: { heading: string; text: string; sourceNumbers?: number[]; table?: ArticleTable; chart?: ArticleChart }[]
  quote: string
  sources: Source[]
}
const official = (label: string, url: string): Source => ({ label, url, kind: 'official' })
const community = (label: string, url: string): Source => ({ label, url, kind: 'community' })
const publish = (article: Omit<Article, 'status' | 'publishedAt' | 'verifiedAt'>): Article => ({ ...article, status: 'published', publishedAt: '2026-10-26', verifiedAt: '2026-10-26' })
const kimi31 = official('Kimi K3.1 Pro 官方技术公告（页面更新于 2026-10-24）', 'https://www.kimi.com/en/blog/kimi-k3-1-pro')
const kimi3 = official('Kimi K3 官方模型卡与评测脚注', 'https://huggingface.co/moonshotai/Kimi-K3')
const kimiLicense = official('Kimi K3 License 原文（不等同于 K3.1 Pro 的最终许可）', 'https://huggingface.co/moonshotai/Kimi-K3/blob/main/LICENSE')
const dsCard = official('DeepSeek-V4.1-Flash-1017 官方模型卡', 'https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017')
const dsNews = official('DeepSeek 2026-10-17 发布公告与工具计费说明', 'https://api-docs.deepseek.com/news/news261017/')
const claude = official('Anthropic：Introducing Claude Opus 5.5（2026-09-22）', 'https://www.anthropic.com/claude-opus-5-5')
const openai = official('OpenAI：Introducing GPT-6.1 Sol（2026-09-29）', 'https://openai.com/index/introducing-gpt-6-1-sol/')
const qwen = official('Qwen3.8-27B 官方模型卡、评测设置与部署说明', 'https://huggingface.co/Qwen/Qwen3.8-27B')
const qwenNews = official('Qwen 官方仓库 News：2026-08-14 开放 27B 模型', 'https://github.com/QwenLM/Qwen3.5')
const claudeThread = community('linux.do：Claude 也没这么神吧（主帖，leinuo）', 'https://linux.do/t/topic/3075055')

export const featured: Article = publish({
  id: 'kimi-k31-pro-release', model: 'Kimi', tone: 'kimi', category: '模型动态',
  title: 'Kimi K3.1 Pro 追到 65.7%，但别急着喊“开源第一”', highlight: '别急着喊“开源第一”',
  description: '终端任务成绩逼近 Opus 5.5，Highspeed 版号称快 2—3 倍。真正需要看清的是：评测条件不同，完整权重也还没到手。',
  label: '发布解读', time: 5, eventNote: '官方公告页面更新：2026-10-24；权重计划：2026-11-04 前',
  takeaway: '产品已经能用，不等于权重已经开放；65.7% 是特定测试下的厂商结果，不是所有编程任务的成功率。',
  sections: [
    { heading: '这次不是改个名字，重点是把长任务做完', text: '如果你用 AI 改过一个有历史包袱的项目，就知道最烦的不是它不会写函数，而是写着写着忘了要求，修一个地方又弄坏另一个。Kimi K3.1 Pro 这次瞄准的，正是这种需要反复调用工具、检查结果、继续修改的长任务。\n\n官方把它描述为在 K3 基础上大幅增加后训练计算量的版本，仍属于 3T 级模型，支持百万 token 上下文。官网、Kimi Work、Kimi Code 和 API 已提供入口；另有 Highspeed 版，官方称速度为普通版的 2—3 倍。这个速度倍率不是本站测出来的，也不能直接理解成所有任务都能提前三分之二交付。', sourceNumbers: [1] },
    { heading: '65.7% 很醒目，脚注比“赢了谁”更重要', text: '公告给出的 Terminal-Bench 4.0 成绩是 65.7%，同一公告列出的 Opus 5.5 是 66.4%，GPT-6 Astra 是 58.2%。只看这三个数字，很容易写出“追平最强”的标题。问题在于，这不是三款模型在本站同一环境里重跑的结果。\n\nKimi 说明自己使用 Claude Code harness；其余成绩取公告或官方榜单报告的最高值。默认测试设置为 max reasoning effort、temperature 1.0、top-p 0.95，个别项目另有说明。不同来源、推理档位与代理框架，都是比较时不能抹掉的变量。', sourceNumbers: [1], table: { caption: 'Kimi 公告中的 Terminal-Bench 4.0 结果', columns: ['模型', '公布成绩', '来源口径'], rows: [['Kimi K3.1 Pro', '65.7%', 'Kimi 自评，Claude Code harness'], ['Claude Opus 5.5', '66.4%', 'Kimi 汇引外部报告/榜单最高值'], ['GPT-6 Astra', '58.2%', 'Kimi 汇引外部报告/榜单最高值']], note: '来源 [1]。并非本站独立横评；0.7 个百分点的差距不能单独证明实际体验等价。' } },
    { heading: '比榜单更值得追问的，是它少说了多少错话', text: '官方内部压力测试 Kimi Hallu Bench Hard 给出了一组更贴近日常担忧的数字：claim-level 幻觉率由 K3 的 23.4% 降至 8.3%，相差 15.1 个百分点。这里的单位是“事实断言”，不是“一整段回答”。\n\n这个测试专门挑选容易出错的困难题目，官方明确说不代表日常使用的总体错误率。因此，“幻觉减少”可以作为继续验证的线索，“现在 91.7% 的回答都正确”则是错误解读。做财务研究、引用论文或读合同，核对原文这一步仍然省不了。', sourceNumbers: [1], chart: { title: 'Kimi 内部困难集：事实断言幻觉率', unit: '%', max: 100, rows: [{ label: 'Kimi K3', value: 23.4 }, { label: 'K3.1 Pro', value: 8.3 }], note: '来源 [1]，越低越好。厂商内部压力测试，非日常错误率，非本站实测。' } },
    { heading: '能用和能下载，是两张时间表', text: '截至本次核验，公告写的是完整模型权重将在 2026 年 11 月 4 日前发布，不是“现在已能下载”。企业组织的管理员还需要主动启用，发布时默认关闭。API 名称是 kimi-k3.1-pro 和 kimi-k3.1-pro-highspeed。\n\n我的建议很简单：已经在 Kimi 工作流里的用户，拿一个真实旧任务比较返工次数与总耗时；想本地部署的团队，先等权重、许可证和推理文档齐全。模型名字里多了一个 Pro，不会替你解决硬件预算、访问权限和验收标准。', sourceNumbers: [1] },
  ],
  quote: '值得期待的不是又一个“第一”，而是下一次改到第十轮时，它还能记得你最初要什么。', sources: [kimi31],
})

export const articles: Article[] = [
  publish({
    id: 'deepseek-1017-upgrade', model: 'DeepSeek', tone: 'deepseek', category: '模型动态',
    title: 'DeepSeek 这次“小更新”，终端任务涨了 11.1 个百分点',
    description: 'V4.1-Flash-1017 不只展示漂亮案例：同系列前后对比有实数。但工具费即将开始计收，也值得一起看。',
    label: '版本更新', time: 4, eventNote: '官方发布：2026-10-17',
    takeaway: '升级幅度应按同一测试看；工具调用费和模型 token 费是两本账。',
    sections: [
      { heading: '名字只加了日期，成绩并不算小修小补', text: 'DeepSeek 把 V4.1-Flash-1017 称为一次 minor update，但它公布的几项变化值得拿出来看。Terminal-Bench 4.0 从上一版的 31.2 升到 42.3，增加 11.1 个百分点；ProgramBench 从 20.3 到 29.1，增加 8.8 个百分点。DeepSWE v1.1 则从 74.2 到 77.0。\n\n注意这里说的是百分点，不是“提高 11.1%”。这几项测试也不是同一把尺子，不能相加平均出一个总实力分。它们来自厂商模型卡，本站没有复跑。', sourceNumbers: [1], table: { caption: '官方模型卡：同系列前后对比', columns: ['测试', 'V4.1-Flash', '1017 版', '差值'], rows: [['Terminal-Bench 4.0', '31.2', '42.3', '+11.1'], ['DeepSWE v1.1', '74.2', '77.0', '+2.8'], ['ProgramBench', '20.3', '29.1', '+8.8'], ['Automation-Bench v1.0.6', '54.8', '60.5', '+5.7']], note: '来源 [1]。差值为本站算术计算，单位为表中分数的百分点；TB4 使用 Claude Code，DeepSWE 使用 Mini-SWE-V2。' } },
      { heading: '演示能吸引人，真正要测的是返工', text: '官方发布页给了 3D 建模、网页赛车和 Godot 游戏等案例，并声称任务更快、输出更短。这说明厂商希望竞争从“会答题”转到“能完成作品”。但精选演示无法告诉你失败了多少次、人工改了多少、迁移到旧仓库后是否仍稳定。\n\n更实用的比较方式，是让新旧版本处理同一个小需求：保留相同代码、提示和工具权限，记录测试通过情况、总调用量和人工介入次数。模型卡的进步给了你升级的理由，验收记录才决定能否把任务交出去。', sourceNumbers: [1, 2], chart: { title: 'Terminal-Bench 4.0：同系列升级', unit: '分', max: 100, rows: [{ label: 'V4.1-Flash', value: 31.2 }, { label: 'Flash-1017', value: 42.3 }], note: '来源 [1]，厂商公布、Claude Code harness；越高越好，不代表全部任务成功率。' } },
      { heading: '搜索也要算钱，免费期有明确截止点', text: '同一公告开放了 Search 与 Fetch API，每个端点的价格是每 1,000 次调用 0.75 美元。公告还写明：DeepSeek Harness、Claude Code 和 Codex 经服务端工具发起的相关调用，目前对 DeepSeek API 用户免费，计费将从 2026 年 10 月 31 日 16:00 UTC 开始，也就是北京时间 11 月 1 日零点。\n\n不是所有调用渠道都能据此认定免费，也不要把这一段当作 token 单价。按公布费率纯算术估算，10,000 次 Search 加 10,000 次 Fetch 是 15 美元，模型推理费用另计。做自动研究和多代理任务时，工具调用次数可能比想象中更值得看。', sourceNumbers: [2] },
    ], quote: '便宜的模型，也可能跑出昂贵的工作流。升级模型和核对账单，最好一起做。', sources: [dsCard, dsNews],
  }),
  publish({
    id: 'claude-opus55-price', model: 'Claude', tone: 'claude', category: '评测解读',
    title: 'Claude Opus 5.5 降价了，但“省 40%”不是你的账单承诺',
    description: '输入、输出降 20%，缓存读取降 60%。三个百分比并不矛盾，差别在你到底怎么用。',
    label: '价格与性能', time: 5, eventNote: '官方发布：2026-09-22；价格按发布公告记录',
    takeaway: '单价下降是真实公告信息；任务总费用下降多少，取决于缓存命中、输出长度、推理档位与重试。',
    sections: [
      { heading: '先把三个降幅拆开', text: 'Anthropic 的公告说，Opus 5.5 在典型工作负载、默认设置下，比 Opus 5 运行成本低 40%。但价目表里输入由 5 降到 4 美元，输出由 25 降到 20 美元，单价都只降了 20%。这不是算错了，而是两种不同的口径。\n\n缓存读取从每百万 token 0.50 美元降到 0.20 美元，降幅是 60%。如果你的代理会反复使用相同上下文，这一项可能很有影响；如果每次都是全新的材料、命中很少，体感就不一样。40% 还包含厂商测试中每个任务消耗 token 的变化，不能直接套在任何人的账单上。', sourceNumbers: [1], table: { caption: '公告标准 API 单价：美元 / 百万 token', columns: ['计费项', 'Opus 5', 'Opus 5.5', '单价降幅'], rows: [['输入', '$5.00', '$4.00', '20%'], ['输出', '$25.00', '$20.00', '20%'], ['缓存读取', '$0.50', '$0.20', '60%'], ['缓存写入（公告表列项）', '$6.25', '$5.00', '20%']], note: '来源 [1]，发布时标准费率，非所有模式完整价目表；Fast mode、服务商渠道与缓存策略另核。不是 Pro/Max 订阅额度换算。' } },
      { heading: '分数上去了，执行环境也要一起读', text: 'Anthropic 给出的 Terminal-Bench 4.0 成绩为 66.4%，其同页复测的 Opus 5 为 52.3%。官方脚注写明 Opus 5.5 在该项使用 xhigh effort，并给出 ±2.6 个百分点的标准误。其他项目默认多使用 max effort。\n\n这页还说明，生产安全机制触发时，一部分安全、生物或前沿模型开发任务会交给其他 Claude 版本完成。因此这是一套带生产保护机制的评估结果，不应讲成一个裸模型在所有场景下的纯能力分。', sourceNumbers: [1] },
      { heading: '社区有人觉得普通，也有人觉得正中需求', text: 'linux.do 的一篇讨论里，leinuo 说自己使用 Opus 5.5 中等思考模式做 Android 开发，没有感到与 GPT 的明显差距，并举了 Maestro 连接真机未成功的例子。另一位用户 Gary_White007 则建议比较 PPT 生成。这两条反馈可以同时成立：他们在意的不是同一个任务。\n\n它们都是个体陈述，没有完整复现材料，不能据此判断谁的模型“被降智”或哪家绝对更强。我的建议是：如果你每天都要做文稿、演示或复杂代码修改，拿自己的旧任务比较；如果只是偶尔问答，未必需要追最高档。', sourceNumbers: [2, 3] },
    ], quote: '升级值不值，不看发布会上省了多少，要看你这周少返工了几次。', sources: [claude, claudeThread, community('linux.do：Gary_White007 关于 PPT 的回复 #4', 'https://linux.do/t/topic/3075055/4')],
  }),
  publish({
    id: 'gpt61-sol-cost', model: 'OpenAI', tone: 'openai', category: '模型动态',
    title: 'GPT-6.1 Sol 把价格打到 Astra 的五分之一，难题还要选最贵的吗？',
    description: '标准输入 $2、输出 $10，缓存输入 $0.10。价格差距很明确，“接近 Astra”则需要按具体任务理解。',
    label: '产品更新', time: 5, eventNote: '官方发布：2026-09-29；渠道与价格按公告记录',
    takeaway: '先用成本较低的模型跑能验收的任务，把预算留给真正困难的部分，比默认全开最高档更合理。',
    sections: [
      { heading: '五分之一说的是标准输入和输出单价', text: 'OpenAI 对 GPT-6.1 Sol 的定位很直接：在编程、电脑操作和专业工作上接近 Astra，但标准输入与输出 token 价格只要五分之一。公告列出的费率是每百万输入 2 美元、输出 10 美元；Astra 对应为 10 和 50 美元。\n\n缓存输入另算：Sol 是每百万 0.10 美元，Astra 是 1 美元，这一项是十分之一，不是五分之一。把三类 token 混成一个总价，反而容易看错。', sourceNumbers: [1], table: { caption: 'OpenAI 发布页所列标准 API 价格', columns: ['模型', '输入 / 百万', '缓存输入 / 百万', '输出 / 百万'], rows: [['GPT-6 Astra', '$10.00', '$1.00', '$50.00'], ['GPT-6.1 Sol', '$2.00', '$0.10', '$10.00'], ['GPT-6 Luna', '$0.10', '$0.01', '$0.50']], note: '来源 [1]，美元。仅比较发布页标准 token 单价，不含工具费、税费或订阅权益；不是能力排行榜。' } },
      { heading: '错误率下降值得看，但不是“准确率 92.3%”', text: '在官方事实准确性困难集上，低推理档位下包含事实错误的回答比例，从 GPT-6 Sol 的 11.4% 降到 7.7%。相对减少约 32%，绝对下降是 3.7 个百分点。\n\n这批题来自用户曾标记旧模型事实错误的去标识化对话，本来就更容易诱发错误。OpenAI 明确说它不代表一般使用。因此，这不是通用准确率测试，更不能据此推算你的客服或研究系统每百次会错几次。', sourceNumbers: [1], chart: { title: '官方困难集：包含事实错误的回答比例', unit: '%', max: 100, rows: [{ label: 'GPT-6 Sol（low）', value: 11.4 }, { label: 'GPT-6.1 Sol（low）', value: 7.7 }], note: '来源 [1]，越低越好；经挑选的困难对话，非日常总体错误率。不要与 Kimi 的 claim-level 指标直接比较。' } },
      { heading: '“接近”并不等于每个任务都一样', text: '公告在科学研究测试 Terminal-Bench Science 0.1 上给了很实用的提醒：最大推理档位时，Sol 平均每任务成本为 5.47 美元，Astra 为 23.80 美元；Astra 仍以 68.1% 拿到所比较模型中的最高分。低成本与最高能力并没有合并成一件事。\n\n如果任务可以用测试、数据库核对或明确规则验收，先跑 Sol 是一种合理的预算选择；遇到跨领域推理、复杂研究和验证成本很高的任务，再考虑更强档位。这是编辑建议，不是官方给所有业务的迁移承诺。', sourceNumbers: [1] },
      { heading: '别只认名字，还要确认你从哪里调用', text: '发布时，GPT-6.1 Sol 已进入 ChatGPT Work、Codex 和 API，API 名称为 gpt-6.1-sol；同一公告明确写了当时尚未进入 Chat。后续渠道会变，部署前应再次确认控制台和官方文档。\n\n模型成绩也来自研究环境或 API，系统提示、工具和推理设置可能与产品端不同。你在某个入口感觉更快、更慢或更聪明，并不一定是同一个底层条件。', sourceNumbers: [1] },
    ], quote: '最贵的模型不是每个请求的默认答案。能把难题筛出来，才算真正用好了模型分层。', sources: [openai],
  }),
  publish({
    id: 'qwen38-27b-local', model: 'Qwen', tone: 'qwen', category: '评测解读',
    title: 'Qwen3.8-27B 的吸引力，不是让你在小 VPS 上硬跑大模型',
    description: '27B、Apache 2.0、原生 262K 上下文：开放模型让选择更多，但参数、显存和实际延迟仍得分别算。',
    label: '开放模型', time: 5, eventNote: '开放发布：2026-08-14；本文为资料解读，不是今日发布快讯',
    takeaway: '开放权重降低了选择和定制的限制，不会自动消除显存、长上下文与维护成本。',
    sections: [
      { heading: '先看同尺寸模型之间的变化', text: 'Qwen3.8-27B 是一个 27B 参数模型。与其把它放在参数规模相差几十倍的混合榜单里，不如先看官方对上一代 27B 的比较：Terminal Bench 2.1 从 63.4 到 73.0，SWE-bench Pro 从 53.5 到 61.7，DeepSWE 1.1 从 13.3 到 42.2。\n\n这些都是 Qwen 公布的成绩。尤其 SWE-bench Pro，模型卡注明修正了存在问题的任务，并在修订后的基准上重跑基线；因此不能不加说明地与其他厂商旧图拼榜。这里的 Terminal Bench 也是 2.1，不是 Kimi 新公告使用的 4.0。', sourceNumbers: [1, 2], table: { caption: 'Qwen 官方同尺寸对比', columns: ['项目', 'Qwen3.6-27B', 'Qwen3.8-27B'], rows: [['Terminal Bench 2.1（Terminus）', '63.4', '73.0'], ['SWE-bench Pro（修订任务集）', '53.5', '61.7'], ['DeepSWE 1.1', '13.3', '42.2'], ['GPQA Diamond', '87.8', '89.2']], note: '来源 [1]。DeepSWE 使用 Claude Code、temperature 1.0、top-p 0.95、256K 上下文；不是本站独立测试。' } },
      { heading: '百万上下文，不是原生默认就有', text: '模型卡写得很具体：原生上下文为 262,144 token，可以通过扩展支持到 1,000,000。官方给出 YaRN/RoPE 配置和推理框架参数，也提醒只在需要长上下文时修改相关设置。\n\n对用户来说，这意味着“能塞下很多材料”和“你的机器能以可接受速度处理很多材料”是两个问题。长上下文会带来额外缓存和运行时开销。模型卡还曾把带更多生产功能的托管版本标为 coming soon，不能把这段预告当作已经开通的承诺。', sourceNumbers: [1] },
      { heading: '27B 也不是一台低配服务器随便装', text: '只做一个粗略下限估算：270 亿参数若每参数用 16 bit 存储，权重约 54 GB；若理想化按 4 bit 计算，约 13.5 GB。这里是十进制 GB，只算权重位数，未包含量化元数据、视觉部分的具体实现开销、KV cache、框架缓冲和操作系统。它不是可部署内存要求，更不是实测显存。\n\n所以不要看到“27B”和“4 bit”就推断 16 GB 机器一定能流畅运行。低配 VPS 更适合托管轻量网站或业务接口，把模型推理交给外部服务；有足够本地硬件、隐私需求和维护能力时，再认真比较自部署。', sourceNumbers: [1], table: { caption: '仅权重位数的理论估算，不是部署配置', columns: ['假设', '算式', '理论体积'], rows: [['16 bit / 参数', '27 × 10⁹ × 16 ÷ 8', '54 GB'], ['4 bit / 参数', '27 × 10⁹ × 4 ÷ 8', '13.5 GB']], note: '本站按官方 27B 参数规模计算；不含运行时开销，实际资源要求以具体模型文件与框架为准。' } },
      { heading: '开放最有价值的地方，是能自己决定怎么用', text: 'Qwen3.8-27B 模型卡标注 Apache 2.0。对有能力维护推理环境的团队，数据路径、量化方案、工具调用和部署地点都多了选择。\n\n但“免费权重”从来不是“免费服务”。算完硬件折旧、电力、开发时间和故障处理，再与托管 API 比较，才知道开放究竟是在替你省钱，还是让你承担了另一种成本。', sourceNumbers: [1] },
    ], quote: '开放模型的价值，是把决定权交给你，不是替你把服务器账单付了。', sources: [qwen, qwenNews],
  }),
  publish({
    id: 'claude-community-workflows', model: 'Claude', tone: 'claude', category: '社区声音',
    title: '“Claude 也没这么神吧”：同一个模型，为什么有人封神、有人无感？',
    description: '一位 Android 开发者的吐槽，遇上了另一位用户的 PPT 推荐。分歧背后，可能根本不是同一套考题。',
    label: '社区观察', time: 4, eventNote: '原帖及所引用回复：2026-10-26（UTC）；本次读取主帖与前五条回复',
    takeaway: '下面是一个公开讨论串的个体经验，不是用户调查；具体工具、任务与推理档位，比“谁家最强”更能解释差别。',
    sections: [
      { heading: '帖子里最有信息量的，是那个没跑通的工具', text: 'linux.do 用户 leinuo 发帖说，公司提供了 Claude，实际使用后觉得与 GPT 没有明显差别。他补充自己做 Android 开发，使用 Opus 5.5 中等思考模式，尝试让它通过 Maestro 连接真机没有成功，而此前 GPT 和 DeepSeek 可以完成。\n\n这段反馈的价值不在“Claude 不行”四个字，而在它至少给出了任务、模型和思考档位。但原帖没有提供完整提示、工具版本、权限配置和执行日志，所以我们不能确定卡住的是模型规划、工具接入，还是环境差异。', sourceNumbers: [1] },
      { heading: '回帖没有达成共识，而且没必要硬凑共识', text: 'kjsr 在 #3 回复中更认可 Claude 的审美、创新和规划，提出让 Claude 做规划、GPT 执行的搭配；Gary_White007 在 #4 建议比较 PPT 生成；jarvisWang 在 #6 则表示，自己的日常工作用 DeepSeek Flash 已经够用，速度稳定更重要。\n\n这些是署名用户各自的主张，不是本站对模型优劣的验证。本次只选读主帖及前五条回复，没有统计整串讨论，更没有抽样调查；不能写成“社区一致认为”，也不应拿点赞数替代证据。', sourceNumbers: [2, 3, 4], table: { caption: '这个讨论串里，大家实际在比较什么', columns: ['发言者 / 楼层', '关注任务', '转述与局限'], rows: [['leinuo / #1', 'Android + Maestro 真机工具', '自述连接未成功；缺日志，未复现'], ['kjsr / #3', '规划、审美与执行分工', '个人搭配建议，不是统一测试'], ['Gary_White007 / #4', 'PPT 生成', '建议换任务比较，未给完整样例'], ['jarvisWang / #6', '日常工作速度与稳定性', '个人偏好，不代表所有任务']], note: '来源 [1]—[4]。为概括转述，不是原话逐字引文；截至 2026-10-26，楼层内容可能后续编辑。' } },
      { heading: '别换信仰，换一套验收办法', text: '如果你也觉得某个“神模型”没有传说中好用，可以先选三个固定任务：一个你每天重复做的，一个以前翻过车的，一个结果能自动检查的。每次保留同一份输入、工具权限和验收要求，同时记录人工改动和等待时间。\n\n做网页的人可能在意版式与交互，做服务端的人可能更在意测试覆盖、回归和故障定位。没有哪条社区回复能替你完成这张需求表。比起问“是不是我不会用”，更有用的问题是：它到底在哪一步帮到了我，又在哪一步把工作还给了我。', sourceNumbers: [1, 2, 3, 4] },
    ], quote: '最有用的模型，不一定是别人夸得最狠的，而是能把你手上那件麻烦事做好的。', sources: [claudeThread, community('linux.do：kjsr 的规划与执行分工建议 #3', 'https://linux.do/t/topic/3075055/3'), community('linux.do：Gary_White007 的 PPT 回复 #4', 'https://linux.do/t/topic/3075055/4'), community('linux.do：jarvisWang 的日常使用反馈 #6', 'https://linux.do/t/topic/3075055/6')],
  }),
  publish({
    id: 'kimi-open-weights-reality', model: 'Kimi', tone: 'kimi', category: '深度观点',
    title: 'Kimi 开放权重，普通人就能本地跑？先看 2.8T 背后的门槛',
    description: 'K3 的权重已经开放，K3.1 Pro 的完整权重仍在时间表上。下载权限、商业许可和硬件门槛，不是同一个问题。',
    label: '部署与许可', time: 5, eventNote: 'K3 已有公开模型卡；K3.1 Pro 公告计划于 2026-11-04 前放出完整权重',
    takeaway: 'K3 的 104B 激活参数不等于只需存 104B 权重；K3 的许可也不能自动当作 K3.1 Pro 最终许可。',
    sections: [
      { heading: '先别把两个版本混在一起', text: '现在可以直接查到 Kimi K3 的模型权重、模型卡与许可证。K3.1 Pro 则是另一个发布进度：官方称产品和 API 已开放，完整权重将在 11 月 4 日前发布。\n\n报道时说“开放模型又有进展”没问题，说“K3.1 Pro 权重已经到手”就超出了已核验信息。计划、服务可用、权重可下载，这三种状态应该各写各的。', sourceNumbers: [1, 2] },
      { heading: '激活 104B，不等于只要放下 104B', text: 'K3 模型卡写了总参数 2.8T、激活参数 104B、896 个专家、每 token 选择 16 个专家，另有共享专家。MoE 的稀疏激活主要改变计算路径，不意味着剩下的权重可以凭空消失。\n\n官方 K3 技术博客还建议使用 64 个或更多加速器的 supernode 配置。这是厂商的部署建议，不是所有实现不可逾越的最低要求；但已经足以说明，它不是给几 GB 内存的小 VPS 准备的本地玩具。', sourceNumbers: [2, 3], table: { caption: 'Kimi K3 规格：不要把“激活”读成“存储”', columns: ['项目', '模型卡数值', '意味着什么'], rows: [['总参数', '2.8T', '总体权重规模'], ['激活参数', '104B', '每次计算的稀疏激活规模'], ['原生上下文', '1,048,576 token', '容量上限，不是准确率'], ['量化方案', 'MXFP4 权重 / MXFP8 激活', '仍需适配推理栈与硬件']], note: '来源 [2]。这张表只描述 K3，不把未经公布的 K3.1 Pro 部署细节补写进去。' } },
      { heading: '许可证也不是一句“随便商用”', text: 'K3 使用自定义 Kimi K3 License，而不是 Apache 2.0。条款总体授予使用、修改和分发等权利，但附有条件：例如经营 Model as a Service 的主体及关联方，连续 12 个月合计收入超过 2,000 万美元时，商业使用前需要单独协议。另有特定大规模产品的品牌展示条款。\n\n条款也对内部使用、官方产品及认证推理伙伴访问设有例外。这里是帮助读者定位条款，不是法律意见；做商业部署应读完整原文。这份 K3 许可不能预先当作 K3.1 Pro 最终权重的许可。', sourceNumbers: [4] },
      { heading: '普通用户得到的，可能是更多服务选择', text: '大模型开放权重的直接受益者往往是有推理基础设施的团队。对普通用户，价值可能通过不同服务商、部署地点、产品集成和价格竞争间接兑现，而不是自己买一台机器就能跑。\n\n如果只是搭一个模型新闻网站，静态托管和模型推理更应彻底分开：网页用轻量服务器足够，写作或分析用需要时调用的服务。不要为一个展示页面背上整套推理集群的成本。', sourceNumbers: [2, 3] },
    ], quote: '开放带来的是选择权，不是把部署难度按下归零键。', sources: [kimi31, kimi3, official('Kimi K3 技术博客与部署建议', 'https://www.kimi.com/en/blog/kimi-k3'), kimiLicense],
  }),
  publish({
    id: 'api-cache-cost-math', model: '跨模型', tone: 'industry', category: '深度观点',
    title: '同样 100 万输入，账单能差多少？把缓存这笔账算给你看',
    description: '用 GPT-6.1 Sol 和 Opus 5.5 的公告价格做两道算术题：不是横评谁更强，而是解释为什么“输入单价”常常不够用。',
    label: '成本计算', time: 4, eventNote: '采用 2026-09-22 / 09-29 发布公告费率；非实时计价器',
    takeaway: '命中的缓存 token 应从普通输入里扣除，不能再重复计一次；缓存建立成本、工具费和失败重试另算。',
    sections: [
      { heading: '先说清假设，不把计算例子包装成实测', text: '假设一次任务累计输入 100 万 token、输出 10 万 token。我们用两家发布公告里的标准 API 费率，算两种情况：全部输入未命中缓存，以及 90% 输入命中已经可用的缓存。\n\n这不是两个模型完成相同任务的实测。真实任务可能输出不同长度、重试不同次数，推理 token 的计费也要按供应商规则确认。下面只回答一个窄问题：当 token 数量固定时，缓存命中会怎样改变 token 账单。', sourceNumbers: [1, 2], table: { caption: '固定工作量示例：100 万总输入 + 10 万输出', columns: ['模型', '无缓存命中', '90% 已有缓存命中', '本例差值'], rows: [['GPT-6.1 Sol', '$3.00', '$1.29', '减少 $1.71'], ['Claude Opus 5.5', '$6.00', '$2.58', '减少 $3.42']], note: '本站按来源 [1][2] 计算。90% 是假设，不是实测命中率；忽略缓存建立/写入、工具、存储、税费和其他收费。两模型不是同质量/同任务性能比较。' } },
      { heading: '关键一步：命中的 90 万不能又算普通输入', text: 'Sol 无缓存时：1 × 2 + 0.1 × 10 = 3 美元。有 90% 缓存命中时：0.1 × 2 + 0.9 × 0.10 + 0.1 × 10 = 1.29 美元。\n\nOpus 5.5 无缓存时：1 × 4 + 0.1 × 20 = 6 美元。有 90% 缓存命中时：0.1 × 4 + 0.9 × 0.20 + 0.1 × 20 = 2.58 美元。上式中的数量单位都是百万 token。两者在这组假设下都减少 57%，这只是费率与输入结构算出的巧合，不是所有真实任务都能省 57%。', sourceNumbers: [1, 2], chart: { title: '固定 token 数量下的示例费用', unit: '美元', max: 6, rows: [{ label: 'Sol：无命中', value: 3 }, { label: 'Sol：90% 命中', value: 1.29 }, { label: 'Opus 5.5：无命中', value: 6 }, { label: 'Opus 5.5：90% 命中', value: 2.58 }], note: '本站算术示例，来源 [1][2]；不含缓存建立和工具费，不是性能/性价比实测。' } },
      { heading: '还有三笔钱，表格没有替你省掉', text: '第一，缓存不是凭空出现的，尤其有单独缓存写入收费的接口，应把建立和刷新缓存算进去。第二，搜索、抓网页、执行代码等工具可能单独收费。第三，一个便宜回答如果要返工五次，最后未必便宜。\n\n更容易混淆的是订阅：Pro、Max 或其他套餐里的用量限制，不是把 API 美元费率直接乘一下就能得出“已花多少钱”。看板若显示 API 等价估值，也应与真实扣款分开。对个人最有用的数字，始终是为一个合格结果实际付出了多少。', sourceNumbers: [1, 2] },
    ], quote: '别只问每百万 token 多便宜。先问你为了拿到一个能用的答案，到底付了几次钱。', sources: [openai, claude],
  }),
  publish({
    id: 'community-perfect-coding', model: '跨模型', tone: 'industry', category: '社区声音',
    title: '把需求写清楚，AI 就能 100% 写对？这个问题问到了痛处',
    description: 'linux.do 有人追问“明确边界后能不能百分百准确”。回复很直白，但比站队更有价值的是：验收到底验什么。',
    label: '开发者讨论', time: 4, eventNote: '公开原帖：2026-10-26（UTC）；选读主帖与 #2、#6 回复',
    takeaway: '清楚的验收标准可以降低歧义，却不能把一次成功变成未来每次成功的保证。',
    sections: [
      { heading: '提问者要的，其实是可交付的确定性', text: 'linux.do 用户 walkersing 提问：DeepSeek、GLM、Step 做 vibe coding，在边界明确、验收标准清楚时，能否达到 100% 准确率？这不是一个无聊的问题。把 AI 放进真实工作之后，人们关心的往往不是偶尔惊艳，而是下次还能不能交付。\n\nRwxct 在 #2 回复说当前还没有模型具备这种能力。Dsssyc 在 #6 则从提问者举的例子继续拆解，指出自然语言里的对象、路线与条件仍可能有歧义。这些都是讨论者的判断，不是对所有模型的系统测试结论。', sourceNumbers: [1, 2, 3] },
      { heading: '能通过测试，不等于所有问题都被测试到了', text: '软件验收通常只覆盖我们想到的输入和行为。你可以写出非常明确的测试，但仍遗漏权限、并发、网络中断、旧数据迁移和长时间运行后的状态。模型通过了现有测试，能说明它满足这批检查，不能自动证明没有其他缺陷。\n\n官方基准同样如此。DeepSeek 的模型卡给出 DeepSWE v1.1 的 77.0；这个数字描述特定任务集、代理框架和评价规则下的表现。它不能转换成“我的每个需求有 77% 概率成功”，更不是质量保证书。', sourceNumbers: [4] },
      { heading: '比许愿更有效的，是把失败变得便宜', text: '一个更稳妥的做法是把任务切成可回滚的小步：先要求列出将改哪些文件，再在隔离环境执行；修改后跑已有测试与新增用例，最后检查差异。涉及删除数据、发布服务或改权限的操作，单独确认，不让“自动完成”变成“自动扩大损失”。\n\n对普通读者也一样。让 AI 写表格，先查几个关键数字；让它总结资料，保留原文链接；让它给建议，要求说明哪些是事实、哪些是推断。我们不必等模型完美才使用它，但也不必为了使用它而假装它已经完美。', table: { caption: '把“写对”拆成可以验收的环节', columns: ['环节', '具体检查'], rows: [['动手前', '输入、边界、允许修改范围'], ['执行中', '工具权限、失败日志、可回滚点'], ['交付时', '功能测试、旧功能回归、差异检查'], ['上线后', '监控、异常恢复、真实使用反馈']], note: '编辑整理的检查清单，不是实测统计，也不承诺消除所有风险。' } },
    ], quote: '可靠不是从不出错，而是错误能被发现、影响能被限制、结果能被复查。', sources: [community('linux.do：walkersing 关于 100% 准确率的提问', 'https://linux.do/t/topic/3075577'), community('linux.do：Rwxct 回复 #2', 'https://linux.do/t/topic/3075577/2'), community('linux.do：Dsssyc 对边界歧义的讨论 #6', 'https://linux.do/t/topic/3075577/6'), dsCard],
  }),
]
export const allArticles = [featured, ...articles]
