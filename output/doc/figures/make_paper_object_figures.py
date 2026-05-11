from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import math

OUT = Path("/home/jiaxu/mentorclaw-source/output/doc/figures")
OUT.mkdir(parents=True, exist_ok=True)

FONT_PATHS = [
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/msyhbd.ttc",
    "C:/Windows/Fonts/simhei.ttf",
    "C:/Windows/Fonts/simsun.ttc",
]


def load_font(size: int, bold: bool = False):
    paths = FONT_PATHS.copy()
    if bold:
        paths = [
            "C:/Windows/Fonts/msyhbd.ttc",
            "C:/Windows/Fonts/simhei.ttf",
            "C:/Windows/Fonts/msyh.ttc",
            "C:/Windows/Fonts/simsun.ttc",
        ]
    for path in paths:
        try:
            return ImageFont.truetype(path, size=size)
        except Exception:
            continue
    return ImageFont.load_default()


TITLE = load_font(56, bold=True)
SUB = load_font(34, bold=True)
TEXT = load_font(26)
SMALL = load_font(22)
TINY = load_font(19)

BG = "#ffffff"
INK = "#1f2937"
MUTED = "#5b6573"
LINE = "#94a3b8"
ARROW = "#64748b"


def rounded(draw, box, fill, outline=LINE, radius=28, width=3):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def center_text(draw, box, text, font, fill, spacing=8):
    x1, y1, x2, y2 = box
    bbox = draw.multiline_textbbox((0, 0), text, font=font, spacing=spacing, align="center")
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    draw.multiline_text(((x1 + x2 - w) / 2, (y1 + y2 - h) / 2), text, font=font, fill=fill, spacing=spacing, align="center")


def left_text(draw, xy, text, font, fill, spacing=8):
    draw.multiline_text(xy, text, font=font, fill=fill, spacing=spacing)


def arrow(draw, start, end, fill=ARROW, width=7, head=18):
    draw.line([start, end], fill=fill, width=width)
    x1, y1 = start
    x2, y2 = end
    ang = math.atan2(y2 - y1, x2 - x1)
    p1 = (x2 + head * math.cos(ang + math.pi * 0.88), y2 + head * math.sin(ang + math.pi * 0.88))
    p2 = (x2 + head * math.cos(ang - math.pi * 0.88), y2 + head * math.sin(ang - math.pi * 0.88))
    draw.polygon([end, p1, p2], fill=fill)


def add_title(draw, title, subtitle, width):
    bbox = draw.textbbox((0, 0), title, font=TITLE)
    draw.text(((width - (bbox[2] - bbox[0])) / 2, 50), title, font=TITLE, fill=INK)
    sb = draw.textbbox((0, 0), subtitle, font=SMALL)
    draw.text(((width - (sb[2] - sb[0])) / 2, 128), subtitle, font=SMALL, fill=MUTED)


def field_card(draw, box, title, code_line, body_lines, fill):
    rounded(draw, box, fill)
    x1, y1, x2, y2 = box
    draw.line((x1 + 28, y1 + 78, x2 - 28, y1 + 78), fill=LINE, width=2)
    left_text(draw, (x1 + 28, y1 + 22), title, SUB, INK)
    left_text(draw, (x1 + 28, y1 + 88), code_line, TINY, MUTED)
    y = y1 + 130
    for line in body_lines:
        left_text(draw, (x1 + 38, y), "• " + line, TEXT, INK)
        y += 42


def object_header(draw, box, title, subtitle, fill="#eff6ff"):
    rounded(draw, box, fill, outline="#64748b", radius=32, width=4)
    center_text(draw, (box[0] + 20, box[1] + 14, box[2] - 20, box[1] + 72), title, SUB, INK)
    center_text(draw, (box[0] + 30, box[1] + 78, box[2] - 30, box[3] - 18), subtitle, SMALL, MUTED)


def figure1():
    width, height = 2400, 1500
    img = Image.new("RGB", (width, height), BG)
    d = ImageDraw.Draw(img)
    add_title(d, "梦拓龙虾课内/课外双场景持续推进机制", "同一助学目标下的两条典型推进路径", width)

    center_text(d, (260, 240, 1140, 310), "课内助学路径", SUB, INK)
    center_text(d, (1260, 240, 2140, 310), "课外助学路径", SUB, INK)

    left_nodes = [
        ("上课", "#dbeafe"),
        ("课后复盘", "#dcfce7"),
        ("周期复习", "#ffedd5"),
        ("阶段检查", "#ede9fe"),
    ]
    right_nodes = [
        ("目标建立", "#dbeafe"),
        ("任务拆解", "#dcfce7"),
        ("执行推进", "#ffedd5"),
        ("阶段检查", "#ede9fe"),
        ("动态调整计划", "#f3f4f6"),
    ]

    lx1, lx2 = 260, 1140
    rx1, rx2 = 1260, 2140
    bw = 520
    bh = 120
    lgap = 60
    start_y = 350

    left_boxes = []
    for i, (title, fill) in enumerate(left_nodes):
        y1 = start_y + i * (bh + lgap)
        box = ((lx1 + lx2 - bw) / 2, y1, (lx1 + lx2 + bw) / 2, y1 + bh)
        left_boxes.append(box)
        rounded(d, box, fill)
        center_text(d, box, title, SUB, INK)
        if i < len(left_nodes) - 1:
            arrow(d, ((box[0] + box[2]) / 2, box[3]), ((box[0] + box[2]) / 2, box[3] + lgap - 18))

    right_boxes = []
    for i, (title, fill) in enumerate(right_nodes):
        y1 = start_y + i * (bh + 44)
        box = ((rx1 + rx2 - bw) / 2, y1, (rx1 + rx2 + bw) / 2, y1 + bh)
        right_boxes.append(box)
        rounded(d, box, fill)
        center_text(d, box, title, SUB, INK)
        if i < len(right_nodes) - 1:
            arrow(d, ((box[0] + box[2]) / 2, box[3]), ((box[0] + box[2]) / 2, box[3] + 26))

    rounded(d, (460, 1250, 1940, 1365), "#f8fafc", outline="#cbd5e1", radius=24, width=2)
    center_text(
        d,
        (500, 1270, 1900, 1345),
        "共同目标：把一次性答疑转化为可承接、可提醒、可继续推进的长期支持过程",
        TEXT,
        INK,
    )
    img.save(OUT / "figure1_dual_path.png")


def figure2():
    width, height = 2400, 1500
    img = Image.new("RGB", (width, height), BG)
    d = ImageDraw.Draw(img)
    add_title(d, "学生对象架构图", "对应当前实现中的 LearnerSummary 与 LearnerState", width)

    object_header(
        d,
        (760, 210, 1640, 350),
        "学生对象（Learner）",
        "跨项目共享长期信息，不直接承载某一次具体任务",
        fill="#eef6ff",
    )

    field_card(
        d,
        (160, 420, 1120, 760),
        "稳定画像",
        "profile / preferences / globalGoals / misconceptions",
        [
            "个人背景与长期偏好",
            "学习习惯与表达偏好",
            "高层目标与取舍",
            "长期误区记录",
        ],
        "#eff6ff",
    )
    field_card(
        d,
        (1280, 420, 2240, 760),
        "运行状态",
        "language / timezone / current_focus / updated_at",
        [
            "当前语言与时区",
            "当前关注重点",
            "最近一次更新时间",
            "用于决定本轮支持方向",
        ],
        "#f0fdf4",
    )
    field_card(
        d,
        (160, 820, 1120, 1140),
        "活动任务信号",
        "active_plan_count / active_plan_ids",
        [
            "当前活跃任务数量",
            "已绑定的活跃任务标识",
            "反映当前负荷与主要投入面",
        ],
        "#fff7ed",
    )
    field_card(
        d,
        (1280, 820, 2240, 1140),
        "风险与能力信号",
        "risk_flags / capability_signals",
        [
            "近期风险点",
            "能力变化线索",
            "用于提醒强度与支持方式调整",
        ],
        "#f5f3ff",
    )
    field_card(
        d,
        (520, 1180, 1880, 1410),
        "长期记忆",
        "memory",
        [
            "跨课程、跨项目共享的稳定事实",
            "不随单次对话立即重置",
            "为后续个性化支持提供连续依据",
        ],
        "#f8fafc",
    )
    img.save(OUT / "figure2_learner_object.png")


def figure3():
    width, height = 2400, 1560
    img = Image.new("RGB", (width, height), BG)
    d = ImageDraw.Draw(img)
    add_title(d, "项目对象架构图", "对应当前实现中的 ProjectState", width)

    object_header(
        d,
        (760, 210, 1640, 350),
        "项目对象（Project）",
        "梦拓龙虾的核心业务单元，可对应课程项目或课外项目",
        fill="#eef6ff",
    )

    cards = [
        (
            (110, 420, 760, 800),
            "基本信息",
            "projectId / title / status / createdAt / updatedAt / summary",
            ["项目标识与标题", "项目状态与时间信息", "整体摘要与当前定位"],
            "#eff6ff",
        ),
        (
            (875, 420, 1525, 800),
            "作用范围",
            "scope.type / scope.courseIds",
            ["区分课程项目或一般项目", "必要时绑定课程范围", "决定可调用的资料边界"],
            "#f0fdf4",
        ),
        (
            (1640, 420, 2290, 800),
            "项目目标",
            "goal.summary / targetOutcome / constraints / successDefinition",
            ["目标摘要", "目标产出", "约束条件", "成功判定标准"],
            "#fff7ed",
        ),
        (
            (110, 860, 760, 1240),
            "执行状态",
            "execution.mode / nextAction / tasks / milestones",
            ["当前工作模式", "下一步动作", "任务列表", "里程碑推进情况"],
            "#f5f3ff",
        ),
        (
            (875, 860, 1525, 1240),
            "项目记忆",
            "memory.misconceptions / durableNotes",
            ["项目内误区记录", "稳定备注", "跨轮次保留的重要事实"],
            "#fef2f2",
        ),
        (
            (1640, 860, 2290, 1240),
            "资源策略",
            "resources.pinnedResourceIds / preferredTypes / notes",
            ["固定关注资料", "偏好资源类型", "项目级资料说明"],
            "#f8fafc",
        ),
    ]

    for box, title, code_line, body, fill in cards:
        field_card(d, box, title, code_line, body, fill)

    rounded(d, (450, 1290, 1950, 1490), "#f8fafc", outline="#cbd5e1", radius=24, width=2)
    center_text(
        d,
        (500, 1320, 1900, 1460),
        "项目对象负责承载“当前要推进什么、推进到哪里、下一步做什么”，\n是持续推进能力的主要状态载体。",
        TEXT,
        INK,
    )
    img.save(OUT / "figure3_project_object.png")


def figure4():
    width, height = 2400, 1440
    img = Image.new("RGB", (width, height), BG)
    d = ImageDraw.Draw(img)
    add_title(d, "定时任务对象架构图", "对应当前实现中的 CronDefinition", width)

    object_header(
        d,
        (760, 210, 1640, 350),
        "定时任务对象（Cron）",
        "负责在合适时间主动触发支持，而不是等待学生再次提问",
        fill="#eef6ff",
    )

    field_card(
        d,
        (180, 430, 1060, 780),
        "基本信息",
        "cronId / title / enabled / updatedAt",
        [
            "任务标识与名称",
            "启用状态",
            "最近更新时间",
        ],
        "#eff6ff",
    )
    field_card(
        d,
        (1340, 430, 2220, 780),
        "触发规则",
        "schedule",
        [
            "定义何时触发",
            "可承载课后推送、周检、阶段提醒",
            "体现主动支持节奏",
        ],
        "#f0fdf4",
    )
    field_card(
        d,
        (180, 840, 1060, 1190),
        "绑定范围",
        "projectId / courseIds",
        [
            "可绑定某个项目",
            "也可绑定课程范围",
            "决定触发时应作用于哪里",
        ],
        "#fff7ed",
    )
    field_card(
        d,
        (1340, 840, 2220, 1190),
        "执行语义",
        "prompt",
        [
            "描述触发后要执行什么支持动作",
            "例如课后总结、复习提醒、阶段检查",
            "体现 cron 的业务含义",
        ],
        "#f5f3ff",
    )

    arrow(d, (1200, 350), (1200, 410), fill="#94a3b8", width=6, head=14)
    rounded(d, (490, 1240, 1910, 1380), "#f8fafc", outline="#cbd5e1", radius=22, width=2)
    center_text(
        d,
        (540, 1265, 1860, 1360),
        "当前项目中，cron 的成熟重点是“任务语义表达 + 绑定关系 + 主动触发入口”，\n而不是完整的产品级调度链路。",
        SMALL,
        INK,
    )
    img.save(OUT / "figure4_cron_object.png")


def main():
    figure1()
    figure2()
    figure3()
    figure4()
    print("ok")


if __name__ == "__main__":
    main()
