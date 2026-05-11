from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import math

OUT = Path("/home/jiaxu/mentorclaw-source/output/doc/figures")
OUT.mkdir(parents=True, exist_ok=True)

FONT_PATHS = [
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/simhei.ttf",
    "C:/Windows/Fonts/simsun.ttc",
]


def load_font(size: int):
    for path in FONT_PATHS:
        try:
            return ImageFont.truetype(path, size=size)
        except Exception:
            continue
    return ImageFont.load_default()


TITLE = load_font(56)
SUB = load_font(34)
TEXT = load_font(28)
SMALL = load_font(24)

BG = "#ffffff"
INK = "#1f2937"
MUTED = "#5b6573"
LINE = "#8b95a7"


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


def arrow(draw, start, end, fill="#64748b", width=7, head=18):
    draw.line([start, end], fill=fill, width=width)
    x1, y1 = start
    x2, y2 = end
    ang = math.atan2(y2 - y1, x2 - x1)
    p1 = (x2 + head * math.cos(ang + math.pi * 0.88), y2 + head * math.sin(ang + math.pi * 0.88))
    p2 = (x2 + head * math.cos(ang - math.pi * 0.88), y2 + head * math.sin(ang - math.pi * 0.88))
    draw.polygon([end, p1, p2], fill=fill)


def add_title(draw, title, subtitle, width):
    bbox = draw.textbbox((0, 0), title, font=TITLE)
    draw.text(((width - (bbox[2] - bbox[0])) / 2, 55), title, font=TITLE, fill=INK)
    sb = draw.textbbox((0, 0), subtitle, font=SMALL)
    draw.text(((width - (sb[2] - sb[0])) / 2, 130), subtitle, font=SMALL, fill=MUTED)


def figure1():
    width, height = 2400, 1400
    img = Image.new("RGB", (width, height), BG)
    d = ImageDraw.Draw(img)
    add_title(d, "梦拓龙虾持续学习推进机制图", "从目标明确到后续推进的课程学习支持链条", width)

    nodes = [
        ("明确当前目标", "回答“这一阶段要完成什么”", "#dbeafe"),
        ("给出下一步动作", "回答“现在先做什么”", "#dcfce7"),
        ("课后总结与整理", "把刚学过的内容沉淀下来", "#ffedd5"),
        ("后续提醒与回顾", "维持复习节奏和学习连续性", "#ede9fe"),
        ("根据进度继续调整", "当情况变化时修正支持重点", "#f3f4f6"),
    ]

    left = 180
    gap = 65
    bw = 380
    bh = 190
    y = 520
    boxes = []
    for i, (title, desc, fill) in enumerate(nodes):
        x1 = left + i * (bw + gap)
        box = (x1, y, x1 + bw, y + bh)
        boxes.append(box)
        rounded(d, box, fill)
        center_text(d, (x1 + 18, y + 22, x1 + bw - 18, y + 86), title, SUB, INK)
        center_text(d, (x1 + 24, y + 94, x1 + bw - 24, y + bh - 18), desc, SMALL, MUTED)

    for i in range(len(boxes) - 1):
        arrow(d, (boxes[i][2], y + bh / 2), (boxes[i + 1][0], y + bh / 2))

    arrow(d, (boxes[-1][0] + bw / 2, y + bh), (boxes[-1][0] + bw / 2, y + bh + 110), fill="#94a3b8", width=6)
    arrow(d, (boxes[-1][0] + bw / 2, y + bh + 110), (boxes[0][0] + bw / 2, y + bh + 110), fill="#94a3b8", width=6)
    arrow(d, (boxes[0][0] + bw / 2, y + bh + 110), (boxes[0][0] + bw / 2, y + bh), fill="#94a3b8", width=6)

    left_text(d, (220, 1035), "核心含义：梦拓龙虾关注的重点不是“资料是否存在”，而是“学习是否能够持续往前推进”。", TEXT, INK)
    left_text(d, (220, 1095), "它提供的是过程中的方向、承接和推动，而不是一次性回答。", TEXT, MUTED)
    img.save(OUT / "figure1_learning_progress.png")


def figure2():
    width, height = 2400, 1400
    img = Image.new("RGB", (width, height), BG)
    d = ImageDraw.Draw(img)
    add_title(d, "梦拓龙虾总体功能架构图", "面向高校课程学习场景的四层结构", width)

    layers = [
        ("用户交互层", "目标输入  课程提问  课后复盘  主动任务设置", "#eff6ff", 220),
        ("学习编排层", "状态识别  任务拆解  计划调整  提醒触发", "#f0fdf4", 420),
        ("课程资料层", "课表  课件  作业  录播  通知  学习记录", "#fff7ed", 620),
        ("支持输出层", "学习计划  课后总结  复习提醒  阶段检查", "#f5f3ff", 820),
    ]

    for title, body, fill, top in layers:
        rounded(d, (250, top, 2150, top + 125), fill, outline="#94a3b8")
        left_text(d, (320, top + 26), title, SUB, INK)
        left_text(d, (760, top + 38), body, TEXT, MUTED)

    for i in range(len(layers) - 1):
        arrow(d, (1200, layers[i][3] + 125), (1200, layers[i + 1][3] - 18))

    left_text(d, (260, 1110), "说明：系统先判断当前学习阶段，再围绕任务调用课程信息，最后形成面向“持续推进”的支持结果。", TEXT, INK)
    img.save(OUT / "figure2_architecture.png")


def figure3():
    width, height = 2400, 1400
    img = Image.new("RGB", (width, height), BG)
    d = ImageDraw.Draw(img)
    add_title(d, "梦拓龙虾典型应用场景示意图", "将零散学习活动组织为连续推进过程", width)

    rounded(d, (180, 330, 700, 1080), "#f3f4f6", outline="#cbd5e1")
    center_text(d, (220, 360, 660, 420), "课程信息输入", SUB, INK)
    sources = [
        ("课表与时间安排", "#dbeafe"),
        ("作业与阶段目标", "#dcfce7"),
        ("课件与课堂重点", "#ffedd5"),
        ("录播与课后回看", "#ede9fe"),
    ]
    y = 460
    for text, fill in sources:
        rounded(d, (240, y, 640, y + 110), fill, outline="#94a3b8", radius=22, width=2)
        center_text(d, (255, y + 16, 625, y + 94), text, TEXT, INK)
        y += 145

    rounded(d, (860, 300, 1540, 1110), "#eff6ff", outline="#64748b", radius=34, width=4)
    center_text(d, (900, 350, 1500, 430), "梦拓龙虾", TITLE, INK)
    center_text(d, (940, 470, 1460, 970), "明确当前目标\n↓\n给出下一步动作\n↓\n承接课后总结\n↓\n维持后续推进", SUB, INK)
    left_text(d, (940, 995), "定位：持续推进型助学智能体", TEXT, MUTED)

    rounded(d, (1700, 330, 2220, 1080), "#f3f4f6", outline="#cbd5e1")
    center_text(d, (1740, 360, 2180, 420), "学生获得的支持", SUB, INK)
    outputs = [
        ("今日该做什么", "#dbeafe"),
        ("课后重点整理", "#dcfce7"),
        ("后续复习提醒", "#ffedd5"),
        ("阶段进度调整", "#ede9fe"),
    ]
    y = 460
    for text, fill in outputs:
        rounded(d, (1760, y, 2160, y + 110), fill, outline="#94a3b8", radius=22, width=2)
        center_text(d, (1775, y + 16, 2145, y + 94), text, TEXT, INK)
        y += 145

    arrow(d, (700, 700), (860, 700), width=8, head=22)
    arrow(d, (1540, 700), (1700, 700), width=8, head=22)
    left_text(d, (220, 1160), "场景要点：学生真正需要的不是更多零散信息，而是一个能够围绕课程持续推动自己前进的支持者。", TEXT, INK)
    img.save(OUT / "figure3_scenario.png")


figure1()
figure2()
figure3()
print("ok")
