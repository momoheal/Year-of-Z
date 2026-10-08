/**
 * chapter5.ts —— 《Z年纪事》第五章《签过的纸》叙事数据（纯数据模块）
 *
 * 剧情基线：正文第十章《签过的纸》（文件 12），承接游戏第四章末「回执仍未补齐」。
 * 马工程师在窗口带着接驳图：图上没有「谁能伸手收药」这一栏；档案处把「状态」旁写了「不是病」。
 * 第二幕「不能恢复的人」由此开始：对手不是感染者，是**分类与授权**——
 * 签过的纸不会留在过去；系统里的"状态"不等于病情。
 *
 * 作者已定：
 *   1. 梁医生**常驻同行**（同行不入队、不做好感度，只写"人在场"与他自己的判断）；
 *   2. 职工安全区那一段**不设选择**（选了也只有一个正确答案），保持为叙述；
 *   3. 章末在日志里**补一条「山线」待核**，不预告第六章内容。
 *
 * 红线（doc/00、doc/21）：
 *   - 不给自愈/免疫确证：护士只说"有人比来时好了"，本章只拿到"可申请复核的病例索引"。
 *   - 不把梁写成英雄或先知：他本人拒绝"你早就知道"的说法；那张处理也没有被撤销。
 *   - 不追问"是不是都死了"：网门那一带只能登记查询，玩家没有这个选项。
 *   - 三处"更省事"的写法会被退回：先收药再补章、当晚把人带走、把旧表直接盖掉。
 *   - 灰灰留在物资站，不随行；母亲的治疗在章节间继续。
 */

import type { ItemDef, NodeDef, NodeEffects } from '../story';

// ---------------------------------------------------------------- 类型

/** 第五章场景（已并入 story.ts 的 SceneId 联合类型） */
export type Ch5SceneId = 'recvstation' | 'medpoint' | 'safezone' | 'checkgate';

/** 第五章场景事件 */
export type Ch5WorldEvent =
  | 'drug-refused'    // 窗口不收药：箱子退回，封签与温度记录一起交接
  | 'liang-join'      // 梁把值班交接完，跟车同行
  | 'gate-hold'       // 岗亭对讲机："带了重点人"——等核查
  | 'archive-open';   // 档案柜翻到东街回执的那一部分

export interface Ch5NodeEffects extends Omit<NodeEffects, 'worldEvent' | 'toScene'> {
  worldEvent?: Ch5WorldEvent;
  toScene?: Ch5SceneId;
}

export type Ch5Node = Omit<NodeDef, 'effects' | 'scene'> & {
  scene: Ch5SceneId;
  effects: Ch5NodeEffects;
};

// ---------------------------------------------------------------- 物品

export const CH5_ITEMS: Record<string, ItemDef> = {
  'drug-manifest': {
    id: 'drug-manifest', name: '药品交接单', tag: '任务',
    note: '封签编号与温度记录钉在一起。退回也要按原运输要求走，不能"先卸下再说"。'
  },
  'liang-note': {
    id: 'liang-note', name: '值班交接要点（梁）', tag: '任务',
    note: '一张床一张床交代过的：谁的药停了几天，谁只能侧躺，谁的家属还没联系上。'
  },
  'authz-copy': {
    id: 'authz-copy', name: '补授权材料（赵）', tag: '任务',
    note: '找到能补授权的人，花了两天。名字换了，签字权限得重新挂一次。'
  },
  'amend-note': {
    id: 'amend-note', name: '更正说明（保留原记录）', tag: '任务',
    note: '赵自己写的：转录错误在哪一行、后续未核查在哪一段。旧表不盖掉——别人要问，就让他们问得到。'
  },
  'recheck-index': {
    id: 'recheck-index', name: '可申请复核的病例索引', tag: '任务',
    note: '只有编号，没有姓名，也没有脸。护士说："我填好转会被退单。"'
  }
};

// ---------------------------------------------------------------- 节点

export const CH5_NODES: Ch5Node[] = [
  {
    id: 'C05-00',
    title: '窗口不收药',
    objective: '在接收窗口核对文件：药没人签收。',
    scene: 'recvstation',
    target: [1.8, -1.4],
    interactLabel: '核对交接单',
    pages: [
      { text: '查回执那天，他跟一辆药品交接车同行。文件归他核，药归随车人员管。' },
      { text: '灰灰留在物资站。赵拿着两个区的补录材料，陈工顺路去附近维修点查料。' },
      { text: '马工程师也来了，夹着他改过一回的接驳图。' },
      { text: '到了窗口才发现，图上没有「谁能伸手收药」这一栏。' },
      { speaker: '马工程师', text: '我把车次画对了。收药的人没画上。' },
      { text: '接收窗口没有收药。' },
      { text: '原来署名的那位医生已经调走。新接班的人还不在授权名单上。' },
      { speaker: '窗口', text: '缺是缺。你们等盖章。' },
      { text: '窗口里的人说缺，手却不肯伸出来。' }
    ],
    choices: [
      {
        id: 'return-by-rule',
        label: '按原运输要求退回，封签与温度记录一起交接',
        pages: [
          { text: '等到配送车必须返程，章还是没有来。' },
          { text: '药按原运输要求退回临时医疗点。封签编号、温度记录，一并交接。' },
          { text: '许晨在单子上写清退回原因：署名人已调走，接班人未在授权名单。' },
          { text: '这一趟没有把药送到。至少没有把它送丢。' }
        ],
        log: { type: 'choice', text: '药品按原运输要求退回临时医疗点，封签与温度记录一并交接，退回原因写明"授权名单未更新"。' }
      },
      {
        id: 'push-window',
        label: '先收下，章明天补',
        rejected: true,
        rejectReason: '冷链和封签不认"明天"——收下了就没人对温度记录负责。',
        pages: [
          { text: '话到嘴边：先收下，章明天补。' },
          { text: '可温度记录一断，这批药之后谁都不敢用。收得下，用不了。' },
          { speaker: '随车人员', text: '要退就现在退。车不能再等了。' },
          { text: '他把话咽回去，改问：退回按哪一条走。' }
        ]
      }
    ],
    effects: {
      addItems: ['drug-manifest'],
      flags: ['drug-returned'],
      worldEvent: 'drug-refused',
      toScene: 'medpoint',
      log: [
        { type: 'fact', text: '接收窗口拒收药品：原署名医生已调走，接班人未列入授权名单，需盖章确认。' },
        { type: 'uncertain', text: '章什么时候能下来，窗口没有给时间。' }
      ]
    }
  },
  {
    id: 'C05-01',
    title: '收药的人不在',
    objective: '把药送回临时医疗点，向值班的梁医生说明。',
    scene: 'medpoint',
    target: [-1.2, -1.0],
    interactLabel: '说明拒收缘由',
    pages: [
      { text: '坐在门边的医生姓梁。以前看眼科。' },
      { text: '许晨把拒收的缘由说了一遍：名字换了，权限没挂上。' }
    ],
    choices: [
      {
        id: 'ask-storage',
        label: '先请管药的人核验箱子，再问病人那边怎么办',
        pages: [
          { text: '梁没有先说话。他让管药品的人核验箱子，问能不能入原储存条件。' },
          { text: '能。封签没动过。' },
          { speaker: '梁', text: '那边的病人呢？有没有替代安排。' },
          { text: '许晨答不上来。' },
          { speaker: '梁', text: '下回帮我问这个。' },
          { text: '他说得很平。像是在交代一件明天就要用到的事。' }
        ],
        log: { type: 'choice', text: '退回药品经核验可入原储存条件；梁医生要求下次同时问清"延误用药者的替代安排"。' }
      },
      {
        id: 'blame-window',
        label: '先替病人抱怨窗口那帮人',
        rejected: true,
        rejectReason: '骂完窗口，药还是在箱子里——他要的是"病人那边怎么办"。',
        pages: [
          { text: '他刚说"那边的人太死板"，梁抬了抬手。' },
          { speaker: '梁', text: '先看箱子。' },
          { text: '许晨闭了嘴。管药的人已经蹲下去核封签了。' }
        ]
      }
    ],
    effects: {
      addItems: ['liang-note'],
      flags: ['met-liang'],
      log: [
        { type: 'fact', text: '退回药品封签完好，可入原储存条件；临时医疗点接收并登记。' },
        { type: 'uncertain', text: '延误用药的病人是否有替代安排，当天没有人能回答。' }
      ]
    }
  },
  {
    id: 'C05-02',
    title: '压着杯子的那张纸',
    objective: '桌上那张旧纸，露出一行字。',
    scene: 'medpoint',
    target: [1.4, 0.6],
    interactLabel: '看桌上的旧纸',
    pages: [
      { text: '桌上一张旧纸压着杯子。纸角露出一行：不再散布不实言论。' },
      { text: '许晨看了一眼。梁没有遮——反而把杯子挪开了。' },
      { text: '早期他在同行的小群里发过异常病例提醒。' },
      { text: '处理的人说没有统一口径，他造成了恐慌。' },
      { speaker: '梁', text: '签字的时候，人家说只是例行手续。签了就回去工作。' },
      { text: '后来正式通知采用了相近的警示。他问过，原处理能不能撤销。' },
      { speaker: '梁', text: '对方说，现在忙这些没有意义。' }
    ],
    choices: [
      {
        id: 'ask-revoke',
        label: '只问那份处理撤销了没有',
        pages: [
          { speaker: '许晨', text: '所以那张纸还在。' },
          { speaker: '梁', text: '在。压杯子正好。' },
          { text: '他说完就去翻值班表，像是刚才那句只是顺口。' }
        ],
        log: { type: 'choice', text: '梁医生早期因在同行群提示异常病例被要求签署"不再散布不实言论"；后续正式通知采用相近警示，原处理未撤销。' }
      },
      {
        id: 'praise-prophet',
        label: '你早就知道会这样',
        rejected: true,
        rejectReason: '他拒绝这句话——把他写成先知，等于把当时的不确定一笔勾销。',
        pages: [
          { speaker: '许晨', text: '当时你就知道会发展成这样？' },
          { text: '梁抬眼。' },
          { speaker: '梁', text: '当时连会发展成什么样都不清楚。别替我添本事。' },
          { text: '许晨点头，把那句话收了回去。' }
        ]
      }
    ],
    effects: {
      flags: ['paper-signed'],
      log: [
        { type: 'uncertain', text: '原处理是否会撤销，没有答复；对方称"现在忙这些没有意义"。' }
      ]
    }
  },
  {
    id: 'C05-03',
    title: '去一趟',
    objective: '等两天：补授权、补手续，把人交接清楚再走。',
    scene: 'medpoint',
    target: [-2.6, 1.6],
    interactLabel: '等交接完成',
    pages: [
      { text: '许晨没有当晚把他带走。' }
    ],
    choices: [
      {
        id: 'wait-handover',
        label: '等两天：手续补齐，床位一张张交代完',
        pages: [
          { text: '接下来两天，赵找到了能补授权的人。药车补齐接收手续。' },
          { text: '许晨带回两名延误用药者的转诊去向——上回答不上来的那个问题。' },
          { text: '梁核对完，才把值班记录交给接班的医护。一张床一张床地交代。' },
          { speaker: '梁', text: '这里有人接了。我跟你们去接收站。' },
          { text: '他把签字纸放进防水袋。动作很仔细。' }
        ],
        log: { type: 'choice', text: '补授权到位、药车手续补齐；梁医生完成床位交接后随车同行，两名延误用药者的转诊去向已带回。' }
      },
      {
        id: 'take-tonight',
        label: '当晚就带他走，路上再说',
        rejected: true,
        rejectReason: '他手上还有一屋子床位——这一走，交接就断在半路。',
        pages: [
          { text: '车就在门口。今晚走，明早就能进档案室。' },
          { speaker: '梁', text: '我这里有十九张床。你替我交接？' },
          { text: '许晨没有再说。他去问药车明后天还有没有班次。' }
        ]
      }
    ],
    effects: {
      addItems: ['authz-copy'],
      flags: ['authz-fixed', 'liang-joined'],
      worldEvent: 'liang-join',
      toScene: 'safezone',
      log: [
        { type: 'fact', text: '梁医生完成值班交接后随车同行；此后行程中他以医护身份在场，不编入任何队列。' }
      ]
    }
  },
  {
    id: 'C05-04',
    title: '带了重点人',
    objective: '路上两站：一个认出他的人，一个认出他名字的岗亭。',
    scene: 'safezone',
    target: [0.6, -1.6],
    interactLabel: '在窗口边等',
    pages: [
      { text: '途经一个职工安全区。窗口里的女人认出了梁。' },
      { text: '她母亲的眼病是他看的。她搬开挡门的桶，低声问他要不要进去喝口水。' },
      { speaker: '梁', text: '车上还有别人。' },
      { text: '她迟疑了一下，把几杯水送到外面。没有让所有人进去。' },
      { text: '水是温的。桶又被挪了回去。' },
      { text: '再往前一站，岗亭听见他的名字，转身按了对讲机。' },
      { speaker: '岗亭', text: '带了重点人。' },
      { text: '赵的肩膀立刻绷紧。' },
      { text: '梁坐在车边等核查，把工作证明打开给人看。' },
      { text: '等到接收站回电确认任务，太阳已经挪过车顶。' },
      { text: '他没有骂人。接过退回的证件，抹平折起来的一角。' },
      { text: '许晨这才明白：那张纸并不是被他收好，就留在了过去。' }
    ],
    effects: {
      flags: ['marked-person'],
      worldEvent: 'gate-hold',
      toScene: 'recvstation',
      log: [
        { type: 'fact', text: '途经岗亭时梁医生被以"重点人"称呼并滞留核查，接收站回电确认任务后放行。' },
        { type: 'uncertain', text: '"重点人"这一标注挂在哪个系统里、能否申请撤销，无人说明。' }
      ]
    }
  },
  {
    id: 'C05-05',
    title: '接到与没接到',
    objective: '在档案柜前，把能查的三条线各查一遍。',
    scene: 'recvstation',
    target: [-2.2, 1.4],
    interactLabel: '翻档案柜',
    pages: [
      { text: '东街的回执，在档案柜里找到了一部分。' },
      { text: '已经接收的人里，有的转去亲属区，有的仍留观，有的又被送往山线。' },
      { text: '未接的几人有退回原因。只是退回联没传到配给端。' },
      { text: '赵要把自己的转录错误和后续未核查写进更正说明。' },
      { speaker: '工作人员', text: '你想清楚。这样别人会问，最初是谁报的。' },
      { text: '赵低头把名字签完。' }
    ],
    choices: [
      {
        id: 'keep-original',
        label: '保留原记录，另附更正说明',
        pages: [
          { text: '旧表不盖掉。错在哪一行、哪一段没核，写在后面。' },
          { text: '他们又查了旧物流园南库那对母子的交接编号。' },
          { text: '能确认医护确实接到了人。不能把这两行记录当作以后都平安。' },
          { text: '许晨报出雨棚网门的位置。' },
          { speaker: '接待员', text: '那一带后来并入另一组。我这里只有清场回执，没有逐人去向。' },
          { text: '许晨请他登记查询。' },
          { text: '他没有再问"是不是都死了"。谁也没有能回答的资料。' },
          { text: '走廊末端的广播在催：状态不变的按旧类别转运，不得自行撤销。' },
          { text: '梁停了下来。' },
          { speaker: '梁', text: '什么叫状态不变？' },
          { speaker: '医护', text: '这里讲的不是病情，是系统里的分类。' },
          { text: '马工程师把「状态」两个字圈起来，旁边写：不是病。' },
          { speaker: '梁', text: '合并的时候，人还在不在原来的格子里？' },
          { speaker: '马工程师', text: '分类是为了运力。格子并了，人不一定还在。' },
          { text: '梁没有立即反驳。他问能不能看这批人的交接记录。' },
          { speaker: '医护', text: '申请之后再说。' },
          { text: '临走前，一名值班护士递来几个复诊编号。' },
          { speaker: '护士', text: '有人比来时好了。可我填"好转"会被退单——上面要求原感染类别不动。' },
          { text: '她不肯让许晨拍自己的脸，只给能申请复核的病例索引。' },
          { speaker: '梁', text: '我先去看人。' },
          { text: '许晨本以为他们已经查到东街为什么断粮。' },
          { text: '走出楼才发现：梁握着的那几行号码，指向的是另一道没有被允许打开的门。' },
          { text: '车上，赵把补粮申请又看了一遍。' },
          { text: '他说还能煮两天。那两天已经过了。' }
        ],
        log: { type: 'choice', text: '更正说明与原记录并存（不覆盖旧表）；南库母子确认由医护接收，网门一带仅有清场回执、无逐人去向，已登记查询。' }
      },
      {
        id: 'overwrite',
        label: '把旧表直接盖掉，省得别人问',
        rejected: true,
        rejectReason: '盖掉之后，就再没有人能查到最初那一行是怎么写的。',
        pages: [
          { text: '换一张干净的表，谁也不会追到他头上。' },
          { speaker: '赵网格', text: '那就等于没错过。' },
          { text: '他把新表推到一边，翻回原来那页。' }
        ]
      }
    ],
    effects: {
      addItems: ['amend-note', 'recheck-index'],
      flags: ['chapter5-done', 'shanxian-pending'],
      worldEvent: 'archive-open',
      log: [
        { type: 'fact', text: '东街部分回执确认：分别转入亲属区、继续留观或再次转往山线；未接收者有退回原因，退回联未传至配给端。' },
        { type: 'fact', text: '广播口径："状态不变的按旧类别转运，不得自行撤销"；医护说明此处的"状态"指系统分类，不指病情。' },
        { type: 'fact', text: '马工程师在「状态」旁手写「不是病」；接驳图无「谁能伸手收药」栏，窗口因此无人签收。' },
        { type: 'uncertain', text: '山线接收后的去向没有任何回执，本条待核。' },
        { type: 'uncertain', text: '有病人比来时好转，但"好转"填报会被退单；仅取得可申请复核的病例索引，未取得任何痊愈或免疫结论。' }
      ]
    }
  }
];

/**
 * story.ts 集成方式（已执行，记录备查）：
 *   SceneId 追加 Ch5SceneId；worldEvent 追加 Ch5WorldEvent；
 *   ITEMS / NODES 拼接 CH5_*；SAVE_VERSION 升为 5（v4 → v5 仅推进版本号）。
 */
