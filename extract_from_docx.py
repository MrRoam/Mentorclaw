#!/usr/bin/env python3
import json
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

def extract_headings_from_docx_xml(file_path):
    """Extract headings by parsing DOCX XML structure"""
    headings = []
    try:
        with zipfile.ZipFile(str(file_path), 'r') as zip_file:
            xml_content = zip_file.read('word/document.xml')
            root = ET.fromstring(xml_content)
            
            # Namespace for Office Open XML
            ns = {
                'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
            }
            
            for para in root.findall('.//w:p', ns):
                # Get paragraph style
                pStyle = para.find('w:pPr/w:pStyle', ns)
                if pStyle is None:
                    pStyle = para.find('.//w:pStyle', ns)
                
                if pStyle is not None:
                    style_val = pStyle.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val')
                    if style_val is None:
                        style_val = pStyle.get('w:val')
                    
                    if style_val and style_val.startswith('Heading'):
                        # Extract level from style name (e.g., "Heading1" -> 1)
                        level = int(''.join(c for c in style_val if c.isdigit())) if any(c.isdigit() for c in style_val) else 0
                        
                        # Get paragraph text
                        text_elements = para.findall('.//w:t', ns)
                        text = ''.join([t.text or '' for t in text_elements]).strip()
                        
                        if text:
                            headings.append({"level": level, "text": text})
        
        return headings
    except Exception as e:
        return None

def extract_with_python_docx(file_path):
    """Try extracting with python-docx library"""
    try:
        from docx import Document
        doc = Document(str(file_path))
        headings = []
        for para in doc.paragraphs:
            if 'Heading' in para.style.name:
                level = int(''.join(c for c in para.style.name if c.isdigit())) if any(c.isdigit() for c in para.style.name) else 0
                text = para.text.strip()
                if text:
                    headings.append({"level": level, "text": text})
        return headings
    except:
        return None

def main():
    target_path = Path(r"D:/Desktop/Obsidian/北航/冯如杯/冯如杯资料/范文")
    
    result = {
        "path_checks": {
            "windows": {
                "path": r"D:\Desktop\Obsidian\北航\冯如杯\冯如杯资料\范文",
                "accessible": target_path.exists() and target_path.is_dir()
            },
            "wsl": {
                "path": "/mnt/d/Desktop/Obsidian/北航/冯如杯/冯如杯资料/范文",
                "accessible": False
            }
        },
        "docx_files": [],
        "sampled_files": []
    }
    
    if target_path.exists():
        docx_files = sorted([
            f.name for f in target_path.glob("*.docx") 
            if not f.name.startswith("~$")
        ])
        result["docx_files"] = docx_files
        
        for filename in docx_files[:3]:
            file_path = target_path / filename
            sample = {"filename": filename, "method": None, "headings": []}
            
            # Try python-docx first
            headings = extract_with_python_docx(file_path)
            if headings is not None:
                sample["method"] = "python-docx"
                sample["headings"] = headings
            else:
                # Fallback to XML parsing
                headings = extract_headings_from_docx_xml(file_path)
                if headings is not None:
                    sample["method"] = "docx_xml_structure"
                    sample["headings"] = headings
                else:
                    sample["method"] = "unavailable"
            
            result["sampled_files"].append(sample)
    
    return result

if __name__ == "__main__":
    result = main()
    print(json.dumps(result, ensure_ascii=False, indent=2))
