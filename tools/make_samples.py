"""生成 samples/ 下的示例 CSV(带 UTF-8 BOM,Excel 打开中文不乱码)。

用法: python tools/make_samples.py
"""

import csv
import datetime as dt
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "samples")

WEEK_ROWS = [
    ("星期", "板块名称", "类别", "开始", "结束"),
    ("周一", "上午学习", "学习", "09:00", "12:00"),
    ("周一", "下午工作", "工作", "14:00", "16:00"),
    ("周一", "力量训练", "健身", "19:00", "20:00"),
    ("周二", "上午学习", "学习", "09:00", "12:00"),
    ("周二", "下午工作", "工作", "14:00", "18:00"),
    ("周三", "上午学习", "学习", "09:00", "12:00"),
    ("周三", "夜跑", "健身", "19:00", "20:30"),
    ("周四", "上午学习", "学习", "09:00", "12:00"),
    ("周四", "下午工作", "工作", "14:00", "16:00"),
    ("周五", "上午学习", "学习", "09:00", "12:00"),
    ("周五", "下午工作", "工作", "14:00", "16:00"),
    ("周五", "睡前阅读", "学习", "20:00", "21:00"),
    ("周六", "大扫除", "生活", "10:00", "12:00"),
    ("周六", "兴趣项目", "兴趣", "15:00", "17:00"),
    ("周日", "周复盘", "生活", "10:00", "11:00"),
    ("周日", "力量训练", "健身", "15:00", "16:30"),
]

# (星期几索引 0=周一, 板块名称, 任务, 备注)
TASK_ROWS = [
    (0, "上午学习", "复习第三章 3.1–3.3", "重点看例题"),
    (0, "下午工作", "写周报", "周五交"),
    (0, "力量训练", "深蹲 5×5", ""),
    (1, "上午学习", "做完第五章练习", ""),
    (2, "上午学习", "背 50 个单词", ""),
    (2, "夜跑", "慢跑 5 公里", ""),
    (4, "睡前阅读", "读 20 分钟", ""),
    (5, "大扫除", "擦地板 + 换床单", ""),
    (6, "周复盘", "写这周的复盘", "用「复盘」页"),
]


def write_csv(path, rows):
    with open(path, "w", encoding="utf-8-sig", newline="") as fh:
        csv.writer(fh).writerows(rows)
    print("wrote", path)


def main():
    os.makedirs(OUT, exist_ok=True)
    write_csv(os.path.join(OUT, "week-template.csv"), WEEK_ROWS)

    today = dt.date.today()
    monday = today - dt.timedelta(days=today.weekday())
    rows = [("日期", "板块名称", "任务", "备注")]
    for offset, block, title, note in TASK_ROWS:
        rows.append(((monday + dt.timedelta(days=offset)).isoformat(), block, title, note))
    write_csv(os.path.join(OUT, "tasks-template.csv"), rows)


if __name__ == "__main__":
    main()
