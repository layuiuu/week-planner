// 内置示例数据:一键载入,方便先试用整个流程。

import { weekDatesOfKey, currentWeekKey, toISODate, todayISO } from './dates.js';
import { uid } from './store.js';

const WEEK_TEMPLATE = [
  [1, '上午学习', '学习', '09:00', '12:00'],
  [1, '下午工作', '工作', '14:00', '16:00'],
  [1, '力量训练', '健身', '19:00', '20:00'],
  [2, '上午学习', '学习', '09:00', '12:00'],
  [2, '下午工作', '工作', '14:00', '18:00'],
  [3, '上午学习', '学习', '09:00', '12:00'],
  [3, '夜跑', '健身', '19:00', '20:30'],
  [4, '上午学习', '学习', '09:00', '12:00'],
  [4, '下午工作', '工作', '14:00', '16:00'],
  [5, '上午学习', '学习', '09:00', '12:00'],
  [5, '下午工作', '工作', '14:00', '16:00'],
  [5, '睡前阅读', '学习', '20:00', '21:00'],
  [6, '大扫除', '生活', '10:00', '12:00'],
  [6, '兴趣项目', '兴趣', '15:00', '17:00'],
  [7, '周复盘', '生活', '10:00', '11:00'],
  [7, '力量训练', '健身', '15:00', '16:30'],
];

// [星期, 板块名称, 任务, 备注]
const SAMPLE_TASKS = [
  [1, '上午学习', '复习第三章 3.1–3.3', '重点看例题'],
  [1, '上午学习', '整理上周错题', ''],
  [1, '下午工作', '写周报', '周五交'],
  [1, '力量训练', '深蹲 5×5', ''],
  [2, '上午学习', '做完第五章练习', ''],
  [2, '下午工作', '需求评审会', '14:30 开始'],
  [3, '上午学习', '背 50 个单词', ''],
  [3, '夜跑', '慢跑 5 公里', ''],
  [4, '上午学习', '读完《深度工作》第 2 章', ''],
  [5, '下午工作', '整理下周排期', ''],
  [5, '睡前阅读', '随便读 20 分钟', ''],
  [6, '大扫除', '擦地板 + 换床单', ''],
  [6, '兴趣项目', '把 demo 的界面搭起来', ''],
  [7, '周复盘', '写这周的复盘', '用「复盘」页'],
];

export function makeSampleState(appName = '周计划') {
  const weekKey = currentWeekKey();
  const dates = weekDatesOfKey(weekKey).map(toISODate);

  const blockTemplate = WEEK_TEMPLATE.map(([weekday, name, category, start, end]) => ({
    id: uid('b'),
    weekday,
    name,
    category,
    start,
    end,
  }));

  const byName = new Map(blockTemplate.map((b) => [`${b.weekday}|${b.name}`, b]));
  const tasks = SAMPLE_TASKS.map(([weekday, blockName, title, note]) => ({
    id: uid('t'),
    date: dates[weekday - 1],
    blockName,
    blockId: byName.get(`${weekday}|${blockName}`)?.id || null,
    title,
    note,
    done: false,
  }));

  // 给几天造一点「已完成」,这样复盘页一开始就有内容可看。
  // 如果今天正好是周一(没有「前几天」),就在今天里勾掉一半。
  const todayIndex = dates.indexOf(todayISO());
  const cutoff = todayIndex >= 0 ? todayIndex : 3;
  tasks.forEach((task, i) => {
    const dayIdx = dates.indexOf(task.date);
    if (dayIdx < cutoff) task.done = true;
    else if (cutoff === 0 && dayIdx === 0 && i % 2 === 0) task.done = true;
  });

  return {
    version: 1,
    settings: { appName, weekStart: 1 },
    blockTemplate,
    weekOverrides: {},
    tasks,
    dayNotes: { [dates[0]]: '这周先把学习节奏稳住。' },
    blockNotes: {},
    weekNotes: { [weekKey]: '示例数据:可以随便改、随便删。' },
    meta: { updatedAt: new Date().toISOString() },
  };
}
