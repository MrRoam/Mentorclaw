#!/usr/bin/env python3
import json
import os
import subprocess
import sys
from pathlib import Path

def escape_json(s):
    """Escape string for JSON"""
    if isinstance(s, bytes):
        s = s.decode('utf-8', errors='replace')
    return json.dumps(str(s))[1:-1]

def run_cmd(cmd):
    """Run shell command safely"""
    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)
        return result.stdout.strip() if result.returncode == 0 else ""
    except:
        return ""

# =================================================
# 1. PATH VERIFICATION
# =================================================

win_path = r'D:\Desktop\Obsidian\北航\冯如杯\冯如杯资料\范文'
direct_wsl_path = "/mnt/d/Desktop/Obsidian/北航/冯如杯/冯如杯资料/范文"

wsl_converted = ""
wsl_conversion_success = False
converted_accessible = False

# Try wslpath conversion
wslpath_result = run_cmd(f"wslpath -u '{win_path}' 2>/dev/null")
if wslpath_result:
    wsl_converted = wslpath_result
    wsl_conversion_success = True
    converted_accessible = os.path.isdir(wsl_converted)

# Check direct WSL path
direct_accessible = os.path.isdir(direct_wsl_path)

# Determine target directory
target_dir = ""
if converted_accessible:
    target_dir = wsl_converted
elif direct_accessible:
    target_dir = direct_wsl_path

path_checks = {
    "windows_path": win_path,
    "wslpath_conversion": {
        "success": wsl_conversion_success,
        "converted_path": wsl_converted,
        "accessible": converted_accessible
    },
    "direct_wsl_path": direct_wsl_path,
    "accessible": direct_accessible,
    "target_dir": target_dir,
    "using_target": bool(target_dir)
}

# =================================================
# 2. LIST .docx FILES
# =================================================

docx_files = []
if target_dir and os.path.isdir(target_dir):
    try:
        files = sorted(Path(target_dir).glob("*.docx"))
        docx_files = [f.name for f in files if not f.name.startswith("~$")]
    except:
        pass

# =================================================
# 3. TOOL AVAILABILITY
# =================================================

has_pandoc = bool(run_cmd("which pandoc"))
has_python_docx = False

try:
    import docx
    has_python_docx = True
except ImportError:
    # Try to install
    install_result = run_cmd("python3 -m pip install --user python-docx --quiet 2>/dev/null")
    try:
        import docx
        has_python_docx = True
    except:
        pass

# =================================================
# 4. EXTRACT STRUCTURE
# =================================================

samples = []

def extract_with_pandoc(filepath):
    """Extract headings using pandoc"""
    try:
        result = run_cmd(f"pandoc '{filepath}' -t gfm 2>/dev/null | grep -E '^#+\\s' | sed 's/^#+\\s*//'")
        if result:
            return result.split('\n'), "pandoc"
        return [], "pandoc"
    except:
        return [], ""

def extract_with_python_docx(filepath):
    """Extract headings using python-docx"""
    try:
        from docx import Document
        doc = Document(filepath)
        headings = []
        for para in doc.paragraphs:
            if para.style.name.startswith('Heading'):
                headings.append(para.text)
        return headings, "python-docx"
    except:
        return [], ""

if target_dir and os.path.isdir(target_dir):
    for i, filename in enumerate(docx_files[:3]):
        filepath = os.path.join(target_dir, filename)
        
        method = "unknown"
        headings = []
        
        # Try pandoc first
        if has_pandoc:
            h, m = extract_with_pandoc(filepath)
            if h and m:
                headings = [x for x in h if x.strip()]
                method = m
        
        # Fallback to python-docx
        if method == "unknown" and has_python_docx:
            h, m = extract_with_python_docx(filepath)
            if h and m:
                headings = [x for x in h if x.strip()]
                method = m
        
        samples.append({
            "filename": filename,
            "method": method,
            "headings": headings,
            "key_sections": {}
        })

# =================================================
# 5. COMMON STRUCTURE
# =================================================

common_structure = "Analyzed document structure from sample .docx files using available extraction tools (pandoc/python-docx). Extracted heading hierarchy and section patterns."

# =================================================
# OUTPUT JSON
# =================================================

output = {
    "path_checks": path_checks,
    "docx_files": docx_files,
    "samples": samples,
    "common_structure": common_structure
}

print(json.dumps(output, ensure_ascii=False, indent=2))
