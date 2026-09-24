/**
 * story.ts —— 《Z年纪事》第一章 Demo 叙事内核（纯数据 + 状态机，不依赖 DOM）
 *
 * 设计基线：doc/02、doc/03、doc/05 正文；节点与验收要求见 doc/24。
 * 本文件只做：节点数据、选择、物品派生、日志、存档闸门与版本校验。
 * 不把原文直接当作可执行脚本；对话文本为受控数据。
 */

// ---------------------------------------------------------------- 类型

export type SceneId = 'park' | 'depot' | 'quarantine' | 'gate';
export type LightPreset = 'dawn' | 'noon' | 'dusk' | 'night';
export type LightMode = 'auto' | LightPreset;
export type LogType = 'fact' | 'uncertain' | 'choice';

export interface Page {
  /** 省略表示叙述 */
  speaker?: string;
  text: string;
}

export interface ChoiceDef {
  id: string;
  /** 按钮正文 */
  label: string;
  /** 选中后追加播放的页 */
  pages: Page[];
  /** 记入日志 */
  log?: { type: LogType; text: string };
  /** 选择与事实不能这样写：拒绝提交，返回选择页 */
  rejected?: boolean;
  rejectReason?: string;
}

export interface NodeEffects {
  addItems?: string[];
  removeItems?: string[];
  log?: { type: LogType; text: string }[];
  flags?: string[];
  /** 通知 world.ts 的场景事件（与剧情事实一一对应） */
  worldEvent?:
    | 'open-side-door'
    | 'medical-arrive'
    | 'mark-pallets'
    | 'mesh-noted'
    | 'dog-to-shed';
  /** 完成后切换到的压缩场景 */
  toScene?: SceneId;
}

export interface NodeDef {
  id: string;
  title: string;
  objective: string;
  scene: SceneId;
  /** 世界坐标 [x, z] */
  target: [number, number];
  interactLabel: string;
  pages: Page[];
  choices?: ChoiceDef[];
  effects: NodeEffects;
}

export interface LogEntry {
  type: LogType;
  text: string;
  node: string;
}

export interface ItemDef {
  id: string;
  name: string;
  tag: '个人' | '借用' | '任务';
  note: string;
}

interface ItemDelta {
  node: string;
  add: string[];
  remove: string[];
}

export interface GameState {
  version: number;
  /** 已完成节点 id（必须严格按定义顺序） */
  completed: string[];
  choices: Record<string, string>;
  log: LogEntry[];
  flags: string[];
  itemJournal: ItemDelta[];
  player: { x: number; z: number };
  scene: SceneId;
  finished: boolean;
  lightMode: LightMode;
  volume: number;
  muted: boolean;
  /** 新局开始时间戳（毫秒），通关结算展示用时 */
  startTs?: number;
  /** 通关时间戳 */
  finishTs?: number;
}

// ---------------------------------------------------------------- 常量

export const SAVE_KEY = 'yoz.chapter1.v1';
export const WORKSHOP_KEY = 'yoz.workshop.v1';
export const SAVE_VERSION = 1;
/** 交互判定距离（米） */
export const INTERACT_RANGE = 2.6;

// ---------------------------------------------------------------- 物品

export const ITEMS: Record<string, ItemDef> = {
  gloves: {
    id: 'gloves', name: '线手套', tag: '个人',
    note: '母亲搬花盆用的那双，食指尖补过。她说今天只认货、不搬东西，还是塞了过来。'
  },
  biscuit: {
    id: 'biscuit', name: '半块饼', tag: '个人',
    note: '早晨没吃完的早餐。'
  },
  vest: {
    id: 'vest', name: '反光背心', tag: '个人',
    note: '印着“临时协勤”，尺寸太大，拉链拉上以后下摆几乎盖住大腿。'
  },
  'personal-water': {
    id: 'personal-water', name: '个人水', tag: '个人',
    note: '母亲早晨灌满的。“别在外头找水喝。”'
  },
  crowbar: {
    id: 'crowbar', name: '借用撬棍', tag: '借用',
    note: '编号登记在册，返程归还。卡住的门、钉死的板子，都能用——不是武器。'
  },
  'task-sheet': {
    id: 'task-sheet', name: '任务单 · 复印件', tag: '任务',
    note: '目标：旧物流园的包装材料（空罐、封口膜），供食品厂恢复生产。'
  },
  'transfer-photo': {
    id: 'transfer-photo', name: '转位单照片', tag: '任务',
    note: '隔着透明袋拍的复写单：“空罐移交北侧雨棚。南库腾空，临时安置转运人员。”签字日期是四天前。'
  },
  'batch-photo': {
    id: 'batch-photo', name: '批号照片', tag: '任务',
    note: '雨棚外包装批号已发给物资站，哪些能收由厂里决定。'
  },
  rations: {
    id: 'rations', name: '额外口粮', tag: '个人',
    note: '按约发放，登记在名下：两小袋米，一盒肉罐头。'
  },
  'lead-liuanli': {
    id: 'lead-liuanli', name: '柳岸里线索', tag: '任务',
    note: '老郑提到的寄存库地址。他留了当时的清单——等核实数量，不先出发。'
  }
};

/** 初始物品（母亲手套、早餐饼、反光背心）；其他物品由节点派生，避免重复领取 */
export const INITIAL_ITEMS = ['gloves', 'biscuit', 'vest'];

// ---------------------------------------------------------------- 节点数据
// 坐标对应 world.ts 的园区布局；压缩场景（depot/quarantine/gate）为各关卡局部坐标。

export const NODES: NodeDef[] = [
  {
    id: 'C01-00',
    title: '核对任务',
    objective: '在出发车旁与老程核对任务，领取工具。',
    scene: 'park',
    target: [-12, 34],
    interactLabel: '与老程核对任务',
    pages: [
      { speaker: '老程', text: '核对任务：旧物流园，找包装材料——空罐和封口膜，送去食品厂复产。不是找吃的，更不是翻私人物资。' },
      { text: '出发口比昨天多了一名护运队员，姓程，四十来岁。他挨个确认随行人员，检查口罩和手套；母亲灌满的水和补过指尖的线手套，已在许晨口袋里。参与的人计入临时保供名单——他不用装卸，只要认库位、查标签。' },
      { text: '“工具分开拿，别放脚边。”一根撬棍横进许晨怀里，黑漆掉了不少，弯头上粘着木屑。借用，编号登记，回来要还。' },
      { speaker: '杜平', text: '都齐了就上车。今天沿途多停停——魏姐交代过。' }
    ],
    effects: {
      addItems: ['personal-water', 'crowbar', 'task-sheet'],
      log: [
        { type: 'fact', text: '任务：到旧物流园确认包装材料货位（空罐、封口膜），供食品厂恢复生产。有护运与运输人员同行。' },
        { type: 'fact', text: '领取借用撬棍一根（编号登记），返程归还；全程无枪械。母亲叮嘱：别在外头找水喝，手套戴上。' },
        { type: 'fact', text: '驾驶座上还是杜平——昨天卸货时他倒下去过一次，医生让休息；可线路许可换人就得重办，没人换得了他。' }
      ]
    }
  },
  {
    id: 'C01-01',
    title: '墙外的灰狗',
    objective: '经过西侧废弃收发亭时，留意花盆后面的动静。',
    scene: 'park',
    target: [-22.6, 33],
    interactLabel: '查看收发亭',
    pages: [
      { text: '收发亭的窗户拆了，里面摞着几只破花盆。花盆后面有东西动了——一只灰毛狗，脖子上留着项圈压过的印子，身上没有牌。它先看他的手，再看车轮。' },
      { text: '许晨从口袋里摸出早上没吃完的半块饼，掰下一小角，放在离脚几步远的地上。狗等他走开才出来，吃得太急，低头咳了一下。他本来已经转身，又回去把剩下的饼掰碎，放在原来的地方。' },
      { speaker: '老程', text: '别摸，先不知道什么情况。走了。' },
      { text: '他没伸手。狗贴着墙跟了几步，隔着一段路，不近。“灰灰。”他试着叫了一声。狗没有过来，只把一只耳朵朝向他。' }
    ],
    effects: {
      removeItems: ['biscuit'],
      flags: ['dog-follow'],
      log: [
        { type: 'fact', text: '在废弃收发亭用自己的早餐饼投喂了一只灰毛狗（灰灰）；它保持距离跟随，没伸手接触。' }
      ]
    }
  },
  {
    id: 'C01-02',
    title: '征用通知',
    objective: '查看办公楼玻璃门上的临时征用通知和手绘仓位表。',
    scene: 'park',
    target: [-15, 5.2],
    interactLabel: '查看张贴',
    pages: [
      { text: '办公楼玻璃门上贴着临时征用通知。原公司的名字还在下面，只露出最后两个字。日期是封锁后的第二周。' },
      { text: '旁边用胶带贴着一张手画的仓位表：家居退货挪到北库，南库改为应急物料周转。难怪上季度的旧表里找不到空罐。' },
      { speaker: '老程', text: '南库在哪？' },
      { speaker: '许晨', text: '那边。——以前是那边。' }
    ],
    effects: {
      log: [
        { type: 'fact', text: '园区已被征用改作应急周转：南库现为物料周转与临时安置，旧库存表对不上现状。' }
      ]
    }
  },
  {
    id: 'C01-03',
    title: '侧门',
    objective: '南库大门留着缝，人员侧门变形卡死。想办法进去。',
    scene: 'park',
    target: [-14.4, -8.1],
    interactLabel: '处理侧门',
    pages: [
      { text: '南库大门的上半截留着一条缝，风从里面出来，带着潮纸板的气味。侧面的人员门变了形，下沿卡在门框里。' },
      { speaker: '装卸工', text: '门没上锁。把撬棍递过来。' },
      { text: '许晨没有递。' }
    ],
    choices: [
      {
        id: 'self',
        label: '自己先撬一次',
        pages: [
          { text: '他把弯头伸进缝隙，试着压了一下——撬棍滑脱，铁头砸在水泥地上。响声沿着空仓传出去，他的肩膀一下缩了起来。所有人都停住了。' },
          { text: '没有东西冲出来。装卸工递来一块木头：“垫住，再压。”这一回只有很低的一声响，下沿抬起来了。许晨侧身进去，从里面扶住门。掌心已经湿透。' }
        ],
        log: { type: 'choice', text: '自己先撬，撬棍滑脱，响声惊动了所有人；垫木后打开侧门，无人受伤。' }
      },
      {
        id: 'help',
        label: '请装卸工垫木，一起开门',
        pages: [
          { speaker: '许晨', text: '你手法比我准——帮我扶一下，一起压。' },
          { text: '装卸工找了一块木头垫住。门只发出很低的一声响，下沿抬起来了。许晨侧身进去，把门从里面扶住。灰尘在高窗的光里慢慢落。' }
        ],
        log: { type: 'choice', text: '请装卸工垫木协作，侧门以最小动静打开。' }
      }
    ],
    effects: {
      flags: ['door-open'],
      worldEvent: 'open-side-door',
      log: [
        { type: 'fact', text: '南库侧门变形但未上锁，用撬棍垫木打开；门后是仓库，不是宿舍。' }
      ]
    }
  },
  {
    id: 'C01-04',
    title: '空货位',
    objective: '核对任务单上的货位——再找立柱上的转位单。',
    scene: 'park',
    target: [4, -9],
    interactLabel: '核对货位',
    pages: [
      { text: '高窗的光落在几排空货架上。地面画着黄色方框，框角留着托盘压出的黑印。许晨找到任务单上的货位号，蹲下擦掉地上的灰，再核对一遍。没找错。那里是空的。相邻六个货位也全空了。' },
      { text: '他认识仓库的习惯：急着挪货，电脑来不及录，会先把转位单夹在立柱上。第一张是去年的，第二张被水泡过。第三根立柱上还挂着透明袋，里面有两张复写单。' },
      { text: '他隔着塑料拍下照片，放大看蓝色的手写字：“空罐移交北侧雨棚。南库腾空，临时安置转运人员。”签字日期是四天前。' }
    ],
    effects: {
      addItems: ['transfer-photo'],
      log: [
        { type: 'fact', text: '货位全空：空罐四天前经签单移交北侧雨棚，南库改作临时安置。复写单照片已留存。' }
      ]
    }
  },
  {
    id: 'C01-05',
    title: '床单隔断',
    objective: '货架后面挂着床单。弄清楚里面的情况。',
    scene: 'park',
    target: [8.2, -15.4],
    interactLabel: '隔帘询问',
    pages: [
      { text: '几条床单用打包带拴成隔断，一直垂到地面。一双拖鞋摆在外面，两只鞋头朝着同一个方向。折叠桌上，纸杯排成两行，每个杯沿夹着一张写了名字的小纸条。有个杯子倒了，水已经干了。' },
      { speaker: '男声（隔帘）', text: '外头……有人吗？' },
      { text: '一个穿灰色棉外套的男人扶着立柱露出半张脸，脚下没穿鞋，手腕上缠着识别带。看见他们时，先看的是反光背心。“接我们的？”老程让他停在原处。里面还有一个——他母亲，起不来。' },
      { text: '男人从口袋里拿出一张折了很多次的纸，举到胸前。许晨举起手机想看编号，那人忽然说：“别拍我妈。她没穿好衣服。”许晨把手机放低了。号码一个数字一个数字念出来，记在便签上。' },
      { text: '接收站查到：这两个人的状态是“已转出”。可男人说，前天夜里车来过，母亲搬到门口时喘不上气，他们留下等医疗车。后来天亮了，其他人都走了，厕所的灯也灭了。' }
    ],
    choices: [
      {
        id: 'give-water',
        label: '把自己的水留给滞留者',
        pages: [
          { text: '他拿出母亲早晨灌满的水，拧开看了一眼，重新拧紧，问过老程才放到地上。想往前推，瓶子倒了，滚在两人之间，谁都没动。最后是那个男人跪下来，把瓶子够了回去。' }
        ],
        log: { type: 'choice', text: '把个人水留给了滞留者（个人财物，非公共口粮）。' }
      },
      {
        id: 'report-first',
        label: '先把编号和位置报出去',
        pages: [
          { text: '他攥了攥水瓶，又放回包里——先把位置报上去。老程按住通话键没有松：“人就在我面前。先登记现在的位置。”等对方把地址重复了一遍，他才放手。' }
        ],
        log: { type: 'choice', text: '先报位置再考虑别的；个人水仍在背包里。' }
      }
    ],
    effects: {
      removeItems: [], // 由选择决定是否移除 personal-water（见 chooseAndComplete）
      flags: ['medical-called'],
      worldEvent: 'medical-arrive',
      log: [
        { type: 'fact', text: '两名滞留者（母子）与系统“已转出”记录不符：实际在南库滞留两天。位置已登记，医护车辆已呼叫。' },
        { type: 'uncertain', text: '识别带颜色不能直接等同于诊断；母子状况待医护评估。' }
      ]
    }
  },
  {
    id: 'C01-06',
    title: '雨棚核验',
    objective: '去东侧雨棚核对空罐批号，分开受潮的物料。',
    scene: 'park',
    target: [26, -4.6],
    interactLabel: '核对批号',
    pages: [
      { text: '雨棚隔着一条装卸通道，顶棚早拆了，中间积着一大片水。空罐在靠墙的几只托盘上，一部分外包装淋过雨，下面的纸板已经塌陷。装卸工割开外层膜，看完摇头。' },
      { text: '许晨拍下外包装上的批号，站到雨棚外——园区信号断断续续，图片终于发了出去。哪些还能收，由厂里决定。' },
      { text: '靠墙的几托盘仍然干燥，封口膜放在塑料周转箱里。他核对规格。两个人用手动托盘车搬运，轮子卡进积水里的旧包装带。装卸工让他蹲下把带子拨开。他戴着母亲补过的手套，在水边蹲了好一阵。' }
    ],
    effects: {
      addItems: ['batch-photo'],
      worldEvent: 'mark-pallets',
      log: [
        { type: 'fact', text: '空罐找到：受潮批次隔离待厂方定夺；干燥批次核对规格后由装卸队装车。批号照片已上报。' }
      ]
    }
  },
  {
    id: 'C01-07',
    title: '网门',
    objective: '雨棚尽头有一道网门。观察，记录，不要去碰门。',
    scene: 'park',
    target: [35.9, -6],
    interactLabel: '观察网门',
    pages: [
      { text: '门内放着几张折叠床。最靠外的床边坐着个人，低着头，肩膀偶尔抽动。地上有一个不锈钢饭盒，倒扣着，旁边散着几粒干饭。' },
      { text: '那人忽然站起来，几步撞到门上，铁网整片晃动。许晨举起撬棍，闭了一下眼。——撞击没有继续。' },
      { text: '他睁开眼。对方一只手仍攥着铁网，另一只手伸向门下的缝隙。饭盒被撞到了门外，正在积水里轻轻晃。他不知道那只手是在够饭盒，还是在够自己。' },
      { speaker: '装卸工', text: '退回来。' },
      { text: '他没有去推饭盒。转身走了两步，又回头看——那人仍蹲在门后，手探在缝隙里。老程听完，联系接收站增加一处位置。没人凭这几句话判断门里的人处于什么阶段。剩下的货不再取，留给后续队伍。' }
    ],
    effects: {
      flags: ['mesh-reported'],
      worldEvent: 'mesh-noted',
      log: [
        { type: 'uncertain', text: '雨棚网门后人员的行为含义未知——是在够饭盒，还是在够人。位置已另报，待专业人员评估；没有接触，门没有打开。' }
      ]
    }
  },
  {
    id: 'C01-08',
    title: '交接与回收单',
    objective: '回车旁确认人员与货物交接，如实填报回收单。',
    scene: 'park',
    target: [-12, 34],
    interactLabel: '确认交接',
    pages: [
      { text: '医护车在中午过后才到。两名工作人员从南库抬出那个老人——她还抱着一件棉衣，儿子贴着她耳边说话，说了几句，自己先哭了。网门的位置，也记在了单子上。' },
      { text: '灰灰仍在门岗外。物资站答应先在墙外工具棚照看，另联系懂动物护理的人核查——不进生活区，更不能进食品厂。它迟迟不肯进笼，最后是闻着许晨的布袋，一点点走进去的。笼子固定在车尾，与包装物分隔。' },
      { speaker: '杜平', text: '先送工具棚，再送厂里。绕一小段。' },
      { text: '回收单传了三次才发出去。表格最后一栏是“现场人员情况”，下拉只有两项：无人、已移交。' }
    ],
    choices: [
      {
        id: 'report-pending',
        label: '先报数量，人员栏写明“待补记”',
        pages: [
          { text: '他把两处人员的实际情况写在照片旁边，没有选择任何一项。对方回复：“先发数量，这栏回来再补。”他照做了，但把未填完的那张也存进了手机。' }
        ],
        log: { type: 'choice', text: '回收单人员栏：先报数量与实际情况（附照片），回站补记；未勾选“无人/已移交”。' }
      },
      {
        id: 'report-none',
        label: '人员一栏直接选“无人”提交',
        rejected: true,
        rejectReason: '表单可以这么填，人不行。',
        pages: [
          { text: '手指悬在“无人”上面，停住了。南库母子刚抬上医护车，网门后那只够不到东西的手还在雨棚边上。单子可以这样填——人不行。他退回去重新写。' }
        ]
      }
    ],
    effects: {
      flags: ['dog-shed'],
      worldEvent: 'dog-to-shed',
      toScene: 'depot',
      log: [
        { type: 'fact', text: '返程：南库母子由医护接走，网门位置另报；灰灰先在墙外工具棚单独安置（笼内固定、与货物分隔），人与货随后送食品厂。' }
      ]
    }
  },
  {
    id: 'C01-09',
    title: '验收 · 还撬棍',
    objective: '在物资站卸货口配合验收，归还工具，领取额外口粮。',
    scene: 'depot',
    target: [-1, -4],
    interactLabel: '配合验收',
    pages: [
      { speaker: '检验员', text: '别急着卸，先看包装。……这个淋过。里头是干的。——先分开。' },
      { text: '取样、核尺寸、对批号，一项一项做完，她才拿起对讲机：合格的那批，车间先领。靠墙坐着的几个工人都站了起来，往同一个方向走。' },
      { text: '传送带动了，空罐碰在一起，发出连续的脆响。几分钟后，第一排封好口的罐子整齐地滑过去——后面还有杀菌、冷却和检验，急不得。' },
      { text: '物资站里，老程让归还工具。登记员照着编号打勾，用布把撬棍上的水擦掉，放回工具箱。手里一下轻得不习惯。' },
      { text: '额外口粮照约发了：两小袋米，一盒肉罐头，登记在名下。旁边有人低声说：“出去一趟，还是有用。”声音里没有明显的恶意，他却立刻想把袋子遮住。老程那边，接班司机终于下班回来了——杜平可以休息了。' }
    ],
    effects: {
      removeItems: ['crowbar'],
      addItems: ['rations'],
      toScene: 'quarantine',
      log: [
        { type: 'fact', text: '食品厂：受潮批次拒收隔离，合格批次投入生产；成品需杀菌检验后配送，不即时发放。' },
        { type: 'fact', text: '借用撬棍已归还勾销；额外口粮（米×2、罐头×1）按约发放。杜平由接班司机替换休息。' }
      ]
    }
  },
  {
    id: 'C01-10',
    title: '留观之夜',
    objective: '在观察点暂留复检。等母亲透析后的消息。',
    scene: 'quarantine',
    target: [1.4, -0.6],
    interactLabel: '查看手机',
    pages: [
      { text: '观察点就在小区围墙外，原来是物业放园艺工具的房子。两张床，窗外对着垃圾分类亭。卫生员逐项问：有没有抓伤、咬伤，是否直接接触身体或体液。问到网门时——“门有没有打开？”“没有。”“你碰到里面的人了？”“没有。”“那就按你实际经历的写。”' },
      { speaker: '值班医护', text: '今晚留在这里，接受复检。下一次评估的时间在这儿——我不许诺结果。' },
      { speaker: '母亲（消息）', text: '透析做完了，护士发了饼干。拼车快来了，魏姐约了邻居帮我上楼。' },
      { text: '她的声音很轻，但比下午有精神。他靠着墙把语音听了两遍，才把那只凉掉的馒头吃掉。接近十一点，又一条消息——“到家了。”他翻了半天表情，最后只回了一个字：好。' },
      { text: '观察点的灯没有开关，亮了一夜。半夜有人拖走几个垃圾桶，轮子在砖缝里一下一下响。他醒来，先去摸床边的撬棍，摸到一只空塑料袋——才想起已经还了。' }
    ],
    effects: {
      toScene: 'gate',
      log: [
        { type: 'fact', text: '母亲当晚完成一次透析并已到家；治疗仍需按预约持续，不是痊愈。' },
        { type: 'uncertain', text: '自己的暴露评估未结束，留观放行不等于排除潜伏风险。' }
      ]
    }
  },
  {
    id: 'C01-11',
    title: '门里门外',
    objective: '次日复检放行。回家，记下老郑给的地址。',
    scene: 'gate',
    target: [0.6, -3],
    interactLabel: '接受放行',
    pages: [
      { speaker: '值班员', text: '按卫生点的书面交接放行。——有人希望你再多留两天，为了整栋楼。' },
      { speaker: '魏姐', text: '交接单我签。出事算我的，名字在这儿。' },
      { text: '栏杆抬起来的时候，两个邻居往旁边退开，留出一条很宽的路。到家。换衣，洗手，再洗一次。中午，食品厂发来照片：合格批次在继续生产，受潮那批仍隔离存放。母亲凑近看了看，问里面装什么。他说豆子。她点点头：也好，能放住就好。' },
      { speaker: '老郑（语音）', text: '我不在园区，我们早撤了。……公司停摆前，一批员工福利食品转到了柳岸里这边一间寄存库，我留着当时的清单。你先别过来——这边刚把几个回厂上班的人挡在外头。我替你问问，能不能拿到门口。' },
      { text: '他把柳岸里的地址抄在旧笔记本上。往前翻一页，还是封城前的安排：周三核对各店库存，周四区域例会。在新地址下面，他写：等郑回复，不先出发。过了一会儿又添了三个字——问数量。' }
    ],
    effects: {
      addItems: ['lead-liuanli'],
      flags: ['chapter-done'],
      log: [
        { type: 'fact', text: '柳岸里是另一个安全区（熟人居住、拒绝外人入内、可协调窗口交货）——不能就此认定为特权区。' },
        { type: 'fact', text: '线索：柳岸里寄存库或有员工福利食品，数量待老郑核实；暂不出发。' }
      ]
    }
  }
];

export const NODE_INDEX: Record<string, number> = Object.fromEntries(NODES.map((n, i) => [n.id, i]));

// ---------------------------------------------------------------- 状态机

export function createNewState(): GameState {
  return {
    version: SAVE_VERSION,
    completed: [],
    choices: {},
    log: [],
    flags: [],
    itemJournal: [{ node: 'init', add: [...INITIAL_ITEMS], remove: [] }],
    player: { x: -12, z: 37 },
    scene: 'park',
    finished: false,
    lightMode: 'auto',
    volume: 0.7,
    muted: false
  };
}

export function currentNode(state: GameState): NodeDef | null {
  if (state.finished) return null;
  return NODES[state.completed.length] ?? null;
}

export function hasFlag(state: GameState, f: string): boolean {
  return state.flags.includes(f);
}

/** 存档闸门：只允许按定义顺序推进，且不能重复完成 */
export function canStart(state: GameState, nodeId: string): { ok: true } | { ok: false; reason: string } {
  const node = NODES.find((n) => n.id === nodeId);
  if (!node) return { ok: false, reason: '没有找到这个目标。' };
  if (state.finished) return { ok: false, reason: '本章已完成，可在设置或结尾处重玩。' };
  if (state.completed.includes(nodeId)) return { ok: false, reason: '这里已经处理过了。' };
  const next = currentNode(state);
  if (!next || next.id !== nodeId) {
    return { ok: false, reason: `先完成当前任务：${next ? `${next.id} ${next.title}` : '—'}` };
  }
  return { ok: true };
}

/** 交互距离判定（测试用例直接覆盖此纯函数） */
export function canInteract(distance: number): boolean {
  return distance <= INTERACT_RANGE;
}

export function distanceToNode(state: GameState, nodeId: string): number {
  const node = NODES.find((n) => n.id === nodeId);
  if (!node) return Infinity;
  const dx = state.player.x - node.target[0];
  const dz = state.player.z - node.target[1];
  return Math.hypot(dx, dz);
}

export type CompletionResult =
  | {
      ok: true;
      node: NodeDef;
      choice?: ChoiceDef;
      worldEvent?: NodeEffects['worldEvent'];
      toScene?: SceneId;
      finishedNow: boolean;
    }
  | { ok: false; reason: string; rejected?: boolean; pages?: Page[] };

/**
 * 完成节点。带选择的节点必须给出合法且未被拒绝的 choiceId；
 * 被拒绝的提交（如回收单勾选“无人”）不改变状态，返回回退页。
 */
export function completeNode(state: GameState, nodeId: string, choiceId?: string): CompletionResult {
  const start = canStart(state, nodeId);
  if (!start.ok) return { ok: false, reason: start.reason };
  const node = NODES.find((n) => n.id === nodeId)!;

  let choice: ChoiceDef | undefined;
  if (node.choices && node.choices.length > 0) {
    choice = node.choices.find((c) => c.id === choiceId);
    if (!choice) {
      return { ok: false, reason: '需要先作出一个选择。' };
    }
    if (choice.rejected) {
      return { ok: false, reason: choice.rejectReason ?? '这个提交方式被退回了。', rejected: true, pages: choice.pages };
    }
  }

  // 应用：完成顺序、选择记录
  state.completed.push(node.id);
  if (choice) state.choices[node.id] = choice.id;

  // 物品派生：结点效果 + 选择特例（C01-05 给水）
  const add = [...(node.effects.addItems ?? [])];
  const remove = [...(node.effects.removeItems ?? [])];
  if (node.id === 'C01-05' && choice?.id === 'give-water') remove.push('personal-water');
  state.itemJournal.push({ node: node.id, add, remove });

  // 日志：结点事实 + 选择记录
  for (const entry of node.effects.log ?? []) state.log.push({ ...entry, node: node.id });
  if (choice?.log) state.log.push({ ...choice.log, node: node.id });

  // 标志
  for (const f of node.effects.flags ?? []) {
    if (!state.flags.includes(f)) state.flags.push(f);
  }

  if (choice) {
    // 分支事实以 flag 形式留档（供后续章节读取）
    if (!state.flags.includes(`choice:${node.id}=${choice.id}`)) {
      state.flags.push(`choice:${node.id}=${choice.id}`);
    }
  }

  if (state.completed.length >= NODES.length) {
    state.finished = true;
    if (!state.finishTs) state.finishTs = Date.now();
  }

  return {
    ok: true,
    node,
    choice,
    worldEvent: node.effects.worldEvent,
    toScene: node.effects.toScene,
    finishedNow: state.finished && node.id === NODES[NODES.length - 1].id
  };
}

/** 物品派生：折叠流水账，重复领取与不匹配移除在这里被折叠消除 */
export function itemsFor(state: GameState): ItemDef[] {
  const owned = new Set<string>();
  for (const d of state.itemJournal) {
    for (const r of d.remove) owned.delete(r);
    for (const a of d.add) owned.add(a);
  }
  return [...owned].map((id) => ITEMS[id]).filter(Boolean);
}

export function hasItem(state: GameState, id: string): boolean {
  return itemsFor(state).some((i) => i.id === id);
}

/** 自动光照：跟随剧情时段（清晨出发—午后—傍晚交货—夜间留观—次日回家） */
export function autoLight(state: GameState): LightPreset {
  const n = state.completed.length;
  if (state.scene === 'gate') return 'dawn';
  if (state.scene === 'quarantine') return 'night';
  if (state.scene === 'depot') return 'dusk';
  if (n <= 4) return 'dawn';
  return 'noon';
}

// ---------------------------------------------------------------- 存档

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

export interface ParseResult {
  state: GameState;
  /** true 表示原存档不可用，已恢复为新局（UI 应提示且不白屏） */
  recovered: boolean;
  reason?: string;
}

export function parseSave(raw: string | null): ParseResult {
  if (raw == null) return { state: createNewState(), recovered: false };
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { state: createNewState(), recovered: true, reason: '存档数据损坏' };
  }
  const s = obj as Partial<GameState>;
  if (!s || typeof s !== 'object') {
    return { state: createNewState(), recovered: true, reason: '存档数据损坏' };
  }
  if (s.version !== SAVE_VERSION) {
    return { state: createNewState(), recovered: true, reason: '存档版本不兼容' };
  }
  // 结构校验：completed 必须是 NODES 的前缀（与闸门同一不变量）
  const completed = Array.isArray(s.completed) ? (s.completed as string[]) : null;
  if (!completed || completed.length > NODES.length ||
      !completed.every((id, i) => NODES[i]?.id === id)) {
    return { state: createNewState(), recovered: true, reason: '存档进度不合法' };
  }
  if (!Array.isArray(s.itemJournal) || !Array.isArray(s.log) || !Array.isArray(s.flags) ||
      typeof s.choices !== 'object' || s.choices === null ||
      typeof s.player !== 'object' || s.player === null) {
    return { state: createNewState(), recovered: true, reason: '存档字段缺失' };
  }
  const scenes: SceneId[] = ['park', 'depot', 'quarantine', 'gate'];
  const scene = scenes.includes(s.scene as SceneId) ? (s.scene as SceneId) : 'park';
  return {
    state: {
      version: SAVE_VERSION,
      completed,
      choices: s.choices as Record<string, string>,
      log: s.log as LogEntry[],
      flags: [...new Set(s.flags as string[])],
      itemJournal: s.itemJournal as ItemDelta[],
      player: {
        x: typeof (s.player as { x?: unknown }).x === 'number' ? (s.player as { x: number }).x : -12,
        z: typeof (s.player as { z?: unknown }).z === 'number' ? (s.player as { z: number }).z : 37
      },
      scene,
      finished: s.finished === true && completed.length >= NODES.length,
      lightMode: (['auto', 'dawn', 'dusk', 'night'] as LightMode[]).includes(s.lightMode as LightMode)
        ? (s.lightMode as LightMode)
        : 'auto',
      volume: typeof s.volume === 'number' ? Math.min(1, Math.max(0, s.volume)) : 0.7,
      muted: s.muted === true,
      startTs: typeof s.startTs === 'number' ? s.startTs : undefined,
      finishTs: typeof s.finishTs === 'number' ? s.finishTs : undefined
    },
    recovered: false
  };
}
