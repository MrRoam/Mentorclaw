#!/usr/bin/env python3
import os
import json
import sys
from pathlib import Path
from subprocess import run, PIPE

def check_paths():
    """Check accessibility of both paths"""
    result = {
        "path_checks": {},
        "docx_files": [],
        "sampled_files": [],
    }
    
    paths_to_check = {
        "windows": r"D:\Desktop\Obsidian\北航\冯如杯\冯如杯资料\范文",
        "wsl": "/mnt/d/Desktop/Obsidian/北航/冯如杯/冯如杯资料/范文"
    }
    
    accessible_path = None
    
    for path_type, path_str in paths_to_check.items():
        try:
            path_obj = Path(path_str)
            is_accessible = path_obj.exists() and path_obj.is_dir()
            result["path_checks"][path_type] = {
                "path": path_str,
                "accessible": is_accessible,
            }
            if is_accessible:
                accessible_path = path_str
        except Exception as e:
            result["path_checks"][path_type] = {
                "path": path_str,
                "error": str(e),
                "accessible": False
            }
    
    return result, accessible_path

def list_docx_files(path_str):
    """List all .docx files in directory"""
    try:
        path_obj = Path(path_str)
        docx_files = sorted([
            f.name for f in path_obj.glob("*.docx") 
            if not f.name.startswith("~$")
        ])
        return docx_files
    except Exception as e:
        print(f"Error listing files: {e}", file=sys.stderr)
        return []

def extract_headings_pandoc(file_path):
    """Extract headings using pandoc"""
    try:
        result = run(
            ["pandoc", str(file_path), "-t", "markdown"],
            capture_output=True,
            text=True,
            timeout=10
        )
        if result.returncode == 0:
            markdown = result.stdout
            headings = []
            for line in markdown.split('\n'):
                if line.startswith('#'):
                    level = len(line) - len(line.lstrip('#'))
                    text = line.lstrip('#').strip()
                    headings.append({
                        "level": level,
                        "text": text
                    })
            return headings, "pandoc"
        else:
            return None, None
    except Exception as e:
        print(f"Pandoc error: {e}", file=sys.stderr)
        return None, None

def extract_headings_python_docx(file_path):
    """Extract headings using python-docx"""
    try:
        from docx import Document
        from docx.enum.text import WD_STYLE_TYPE
        
        doc = Document(file_path)
        headings = []
        
        for para in doc.paragraphs:
            if para.style.name.startswith('Heading'):
                try:
                    level = int(para.style.name.split()[-1])
                except:
                    level = 0
                headings.append({
                    "level": level,
                    "text": para.text
                })
        
        return headings, "python-docx"
    except Exception as e:
        print(f"python-docx error: {e}", file=sys.stderr)
        return None, None

def process_docx_files(file_paths, target_path, max_files=3):
    """Process docx files and extract headings"""
    results = []
    
    for i, filename in enumerate(file_paths[:max_files]):
        file_full_path = Path(target_path) / filename
        
        # Try pandoc first
        headings, method = extract_headings_pandoc(file_full_path)
        
        # Fallback to python-docx if pandoc fails
        if headings is None:
            headings, method = extract_headings_python_docx(file_full_path)
        
        if headings is not None or method is not None:
            results.append({
                "filename": filename,
                "method": method if method else "none_available",
                "headings": headings if headings else [],
            })
    
    return results

def main():
    os.chdir("/home/jiaxu/mentorclaw-source")
    
    result, accessible_path = check_paths()
    
    if accessible_path:
        docx_files = list_docx_files(accessible_path)
        result["docx_files"] = docx_files
        
        if docx_files:
            sampled = process_docx_files(docx_files, accessible_path, max_files=3)
            result["sampled_files"] = sampled
    
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
