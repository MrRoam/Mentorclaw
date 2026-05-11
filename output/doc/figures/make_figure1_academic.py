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


TITLE = load_font(50, bold=True)
SUB = load_font(30, bold=True)
TEXT = load_font(26, bold=True)
SMALL = load_font(18)

BG = "#ffffff"
INK = "#1f2937"
MUTED = "#6b7280"
LINE = "#607086"
OUTLINE = "#97a7bb"
PANEL = "#fbfcfe"
BLUE = "#edf4fb"
GREEN = "#eef8f1"
ORANGE = "#fdf4e8"
PURPLE = "#f3f0fb"
GRAY = "#f3f4f6"


def center_text(draw, box, text, font, fill, spacing=4):
    x1, y1, x2, y2 = box
    bb = draw.multiline_textbbox((0, 0), text, font=font, spacing=spacing, align="center")
    w = bb[2] - bb[0]
    h = bb[3] - bb[1]
    draw.multiline_text(((x1 + x2 - w) / 2, (y1 + y2 - h) / 2), text, font=font, fill=fill, spacing=spacing, align="center")


def arrow(draw, start, end, fill=LINE, width=6, head=16):
    draw.line([start, end], fill=fill, width=width)
    x1, y1 = start
    x2, y2 = end
    ang = math.atan2(y2 - y1, x2 - x1)
    p1 = (x2 + head * math.cos(ang + math.pi * 0.86), y2 + head * math.sin(ang + math.pi * 0.86))
    p2 = (x2 + head * math.cos(ang - math.pi * 0.86), y2 + head * math.sin(ang - math.pi * 0.86))
    draw.polygon([end, p1, p2], fill=fill)


def rounded(draw, box, fill, radius=28, width=3, outline=OUTLINE):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def title(draw, width):
    t = "梦拓龙虾课内/课外双场景持续推进机制"
    s = "课内与课外任务分别形成方案编排—执行—评估—更新的闭环"
    bb = draw.textbbox((0, 0), t, font=TITLE)
    draw.text(((width - (bb[2] - bb[0])) / 2, 42), t, font=TITLE, fill=INK)
    sb = draw.textbbox((0, 0), s, font=SMALL)
    draw.text(((width - (sb[2] - sb[0])) / 2, 110), s, font=SMALL, fill=MUTED)


def label(draw, xy, text):
    draw.text(xy, text, font=SUB, fill=INK)


def card(draw, box, text, fill):
    rounded(draw, box, fill)
    center_text(draw, box, text, TEXT, INK)


def make():
    width, height = 2400, 1320
    img = Image.new("RGB", (width, height), BG)
    d = ImageDraw.Draw(img)
    title(d, width)

    left_panel = (90, 185, 1145, 1120)
    right_panel = (1255, 185, 2310, 1120)
    rounded(d, left_panel, PANEL, radius=26, width=2, outline="#d8e0ea")
    rounded(d, right_panel, PANEL, radius=26, width=2, outline="#d8e0ea")
    label(d, (130, 220), "课内助学")
    label(d, (1295, 220), "课外助学")

    # Left loop
    L = {
        "课程任务池": (270, 320, 600, 430),
        "预习/复习方案": (640, 500, 980, 610),
        "学习执行": (500, 760, 810, 870),
        "阶段评估": (170, 760, 480, 870),
        "画像/方案更新": (170, 500, 520, 610),
    }
    card(d, L["课程任务池"], "课程任务池", BLUE)
    card(d, L["预习/复习方案"], "预习/复习方案", GREEN)
    card(d, L["学习执行"], "学习执行", ORANGE)
    card(d, L["阶段评估"], "阶段评估", PURPLE)
    card(d, L["画像/方案更新"], "画像/方案更新", GRAY)
    center_text(d, (280, 435, 590, 475), "数学分析 / 基础物理 / 其他课程", SMALL, MUTED)
    arrow(d, (600, 375), (640, 540))
    arrow(d, (810, 610), (695, 760))
    arrow(d, (500, 815), (480, 815))
    arrow(d, (325, 760), (345, 610))
    arrow(d, (520, 555), (600, 555))

    # Right loop
    R = {
        "课外目标池": (1485, 320, 1815, 430),
        "学习/备赛方案": (1845, 500, 2205, 610),
        "任务执行": (1720, 760, 2020, 870),
        "定期评估": (1350, 760, 1650, 870),
        "画像/方案更新": (1360, 500, 1710, 610),
    }
    card(d, R["课外目标池"], "课外目标池", BLUE)
    card(d, R["学习/备赛方案"], "学习/备赛方案", GREEN)
    card(d, R["任务执行"], "任务执行", ORANGE)
    card(d, R["定期评估"], "定期评估", PURPLE)
    card(d, R["画像/方案更新"], "画像/方案更新", GRAY)
    center_text(d, (1495, 435, 1805, 475), "大英赛 / 六级 / 竞赛项目", SMALL, MUTED)
    arrow(d, (1815, 375), (1845, 540))
    arrow(d, (2020, 610), (1885, 760))
    arrow(d, (1720, 815), (1650, 815))
    arrow(d, (1500, 760), (1520, 610))
    arrow(d, (1710, 555), (1845, 555))

    note = (230, 1180, 2170, 1270)
    rounded(d, note, "#eef3f8", radius=18, width=2, outline="#d5dde8")
    center_text(d, note, "共同特征：通过评估结果不断更新画像与方案，再进入下一轮推进", TEXT, INK)

    out = OUT / "figure1_dual_path_academic.png"
    img.save(out)
    print(out)


if __name__ == "__main__":
    make()
